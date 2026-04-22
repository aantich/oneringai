/**
 * MongoMemoryAdapter — implements IMemoryStore on top of two Mongo-like
 * collections (entities + facts). Works identically with the raw mongodb
 * driver and Meteor's Mongo.Collection via the two provided wrappers.
 *
 * Design notes:
 *   - Scope filtering is pushed into every query (never post-filtered in app).
 *   - Optimistic concurrency is enforced via a `version` guard in the filter.
 *   - Bulk writes use `bulkWrite` when the collection supports it, else fall
 *     back to sequential writes.
 *   - `traverse` has two modes: iterative (always works) or native `$graphLookup`
 *     (faster, requires `aggregate` capability + `useNativeGraphLookup: true`).
 *   - `semanticSearch` has two modes: cursor-scan cosine (always works) or
 *     Atlas Vector Search (requires `aggregate` + `vectorIndexName`).
 */

import type {
  EntityId,
  EntityListFilter,
  EntitySearchOptions,
  EntitySemanticSearchFilter,
  FactFilter,
  FactId,
  FactQueryOptions,
  IEntity,
  IFact,
  IMemoryStore,
  ListOptions,
  Neighborhood,
  NewEntity,
  NewFact,
  Page,
  ScopeFilter,
  SemanticSearchOptions,
  TraversalOptions,
} from '../../types.js';
import { genericTraverse } from '../../GenericTraversal.js';
import type {
  IMongoCollectionLike,
  MongoFilter,
  MongoSort,
  SearchIndexDefinition,
  SearchIndexInfo,
} from './IMongoCollectionLike.js';
import { mergeFilters, scopeToFilter } from './scopeFilter.js';
import { ensureIndexes } from './indexes.js';
import {
  factFilterToMongo,
  formatCursor,
  orderByToSort,
  parseCursor,
} from './queries.js';

// =============================================================================
// Errors
// =============================================================================

export class MongoOptimisticConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MongoOptimisticConcurrencyError';
  }
}

// =============================================================================
// Options
// =============================================================================

export interface MongoMemoryAdapterOptions {
  entities: IMongoCollectionLike<IEntity>;
  facts: IMongoCollectionLike<IFact>;

  /**
   * When true AND `facts.aggregate` is present, `traverse()` uses a single
   * native `$graphLookup` pipeline per direction instead of iterative BFS.
   * Default: false.
   */
  useNativeGraphLookup?: boolean;

  /**
   * When set AND `facts.aggregate` is present, `semanticSearch()` uses Atlas
   * Vector Search via `$vectorSearch` against this index name. Otherwise
   * falls back to cursor-scan cosine.
   */
  vectorIndexName?: string;

  /**
   * When set AND `entities.aggregate` is present, `semanticSearchEntities()`
   * uses Atlas Vector Search via `$vectorSearch` against this index name.
   * Otherwise falls back to cursor-scan cosine over `entity.identityEmbedding`.
   *
   * Index is NOT auto-created by `ensureIndexes()` (which only handles regular
   * b-tree indexes). Create it via `ensureVectorSearchIndexes()` (programmatic,
   * requires mongodb node driver v6.6+ + Atlas Server v6.0.11+) or via the
   * Atlas UI / admin API. See `ensureVectorSearchIndexes` JSDoc for details.
   */
  entityVectorIndexName?: string;

  /**
   * Number of vector candidates to ask Atlas Vector Search to consider before
   * returning topK. Used by both `semanticSearch` (facts) and
   * `semanticSearchEntities` when the corresponding index name is set.
   * Default: topK * 10.
   */
  vectorCandidateMultiplier?: number;

  /**
   * Name of the facts collection — required by `$graphLookup` (it needs the
   * collection name to recurse over). If omitted, `useNativeGraphLookup` is
   * disabled and iterative BFS is used instead.
   */
  factsCollectionName?: string;

  /** Default page size when a caller doesn't specify `limit`. */
  defaultPageSize?: number;
}

// =============================================================================
// Adapter
// =============================================================================

const DEFAULT_PAGE_SIZE = 100;
const ARCHIVED_HIDDEN: MongoFilter = {
  $or: [{ archived: false }, { archived: { $exists: false } }],
};

export class MongoMemoryAdapter implements IMemoryStore {
  private readonly entities: IMongoCollectionLike<IEntity>;
  private readonly facts: IMongoCollectionLike<IFact>;
  private readonly useNativeGraphLookup: boolean;
  private readonly vectorIndexName?: string;
  private readonly entityVectorIndexName?: string;
  private readonly vectorCandidateMultiplier: number;
  private readonly factsCollectionName?: string;
  private readonly defaultPageSize: number;
  private destroyed = false;

  constructor(opts: MongoMemoryAdapterOptions) {
    this.entities = opts.entities;
    this.facts = opts.facts;
    this.useNativeGraphLookup =
      !!opts.useNativeGraphLookup && !!opts.facts.aggregate && !!opts.factsCollectionName;
    this.vectorIndexName = opts.vectorIndexName;
    this.entityVectorIndexName = opts.entityVectorIndexName;
    this.vectorCandidateMultiplier = opts.vectorCandidateMultiplier ?? 10;
    this.factsCollectionName = opts.factsCollectionName;
    this.defaultPageSize = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  }

  /**
   * H7: ensure the recommended indexes exist. Idempotent — Mongo's
   * `createIndex` is a no-op when the index is already present with matching
   * specification. Callers integrate this into their migration system; the
   * adapter does NOT call it automatically (indexes are the client app's
   * responsibility, not a library concern).
   *
   * Invokes the shared `ensureIndexes(...)` function against this adapter's
   * collections. See `indexes.ts` for the index list and why each exists.
   */
  async ensureIndexes(): Promise<void> {
    this.assertLive();
    await ensureIndexes({ entities: this.entities, facts: this.facts });
  }

  // ==========================================================================
  // Entities
  // ==========================================================================

  async createEntity(input: NewEntity): Promise<IEntity> {
    this.assertLive();
    const now = new Date();
    const doc = normalizeNewEntityForStorage({
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const id = await this.entities.insertOne(doc as unknown as IEntity);
    return reviveEntity({ ...doc, id } as IEntity);
  }

  async createEntities(inputs: NewEntity[]): Promise<IEntity[]> {
    this.assertLive();
    if (inputs.length === 0) return [];
    const now = new Date();
    const docs = inputs.map((input) =>
      normalizeNewEntityForStorage({
        ...input,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const ids = await this.entities.insertMany(docs as unknown as IEntity[]);
    return docs.map((d, i) => reviveEntity({ ...d, id: ids[i]! } as IEntity));
  }

  async updateEntity(entity: IEntity): Promise<void> {
    this.assertLive();
    if (entity.version < 2) {
      throw new MongoOptimisticConcurrencyError(
        `Entity ${entity.id}: update requires version >= 2 (got ${entity.version})`,
      );
    }
    const normalized = normalizeEntityForStorage(entity);
    const res = await this.entities.updateOne(
      { id: entity.id, version: entity.version - 1 },
      { $set: normalized },
    );
    if (res.matchedCount === 0) {
      throw new MongoOptimisticConcurrencyError(
        `Entity ${entity.id}: version mismatch (expected stored version = ${entity.version - 1})`,
      );
    }
  }

  async getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null> {
    this.assertLive();
    const filter = mergeFilters(scopeToFilter(scope), ARCHIVED_HIDDEN, { id });
    const doc = await this.entities.findOne(filter);
    return doc ? reviveEntity(doc) : null;
  }

  async getEntities(ids: EntityId[], scope: ScopeFilter): Promise<Array<IEntity | null>> {
    this.assertLive();
    if (ids.length === 0) return [];
    const filter = mergeFilters(scopeToFilter(scope), ARCHIVED_HIDDEN, {
      id: { $in: ids },
    });
    // Single batch query — one round-trip regardless of ids.length.
    const docs = await this.entities.find(filter, { limit: ids.length });
    const byId = new Map<string, IEntity>();
    for (const d of docs) {
      const e = reviveEntity(d);
      byId.set(e.id, e);
    }
    // Preserve input order; null for missing / scope-filtered-out.
    return ids.map((id) => byId.get(id) ?? null);
  }

  async findEntitiesByIdentifier(
    kind: string,
    value: string,
    scope: ScopeFilter,
  ): Promise<IEntity[]> {
    this.assertLive();
    const filter = mergeFilters(scopeToFilter(scope), ARCHIVED_HIDDEN, {
      identifiers: {
        $elemMatch: { kind, value: value.toLowerCase() },
      },
    });
    const docs = await this.entities.find(filter, { limit: 50 });
    return docs.map(reviveEntity);
  }

  async searchEntities(
    query: string,
    opts: EntitySearchOptions,
    scope: ScopeFilter,
  ): Promise<Page<IEntity>> {
    this.assertLive();
    const q = query.trim();
    const qLower = q.toLowerCase();
    const clauses: MongoFilter[] = [scopeToFilter(scope), ARCHIVED_HIDDEN];

    if (opts.types && opts.types.length > 0) {
      clauses.push({ type: { $in: opts.types } });
    }
    if (q.length > 0) {
      // Case-insensitive substring match on displayName, aliases, identifier values.
      const escaped = escapeRegex(q);
      clauses.push({
        $or: [
          { displayName: { $regex: escaped, $options: 'i' } },
          { aliases: { $regex: escaped, $options: 'i' } },
          { 'identifiers.value': { $regex: escaped, $options: 'i' } },
        ],
      });
    }
    const filter = mergeFilters(...clauses);

    const skip = parseCursor(opts.cursor);
    const limit = opts.limit ?? this.defaultPageSize;

    // Oversample so we can rank client-side, then paginate by skip/limit over
    // the ranked list. Cap at a reasonable total pool to bound work.
    const oversamplePool = Math.max(500, skip + limit * 5);
    const docs = await this.entities.find(filter, { limit: oversamplePool });
    const revived = docs.map(reviveEntity);

    // Rank by relevance when q is non-empty; otherwise preserve fetch order.
    if (qLower.length > 0) {
      const scored = revived.map((entity) => ({
        entity,
        score: entityRelevance(entity, qLower),
      }));
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.entity.displayName.localeCompare(b.entity.displayName);
      });
      const items = scored.slice(skip, skip + limit).map((s) => s.entity);
      return {
        items,
        nextCursor: formatCursor(skip, limit, items.length),
      };
    }

    const items = revived.slice(skip, skip + limit);
    return {
      items,
      nextCursor: formatCursor(skip, limit, items.length),
    };
  }

  async listEntities(
    filter: EntityListFilter,
    opts: ListOptions,
    scope: ScopeFilter,
  ): Promise<Page<IEntity>> {
    this.assertLive();
    const clauses: MongoFilter[] = [scopeToFilter(scope)];
    if (filter.archived === true) clauses.push({ archived: true });
    else if (filter.archived === false) clauses.push(ARCHIVED_HIDDEN);
    else clauses.push(ARCHIVED_HIDDEN);
    if (filter.type) clauses.push({ type: filter.type });
    if (filter.ids && filter.ids.length > 0) clauses.push({ id: { $in: filter.ids } });
    if (filter.metadataFilter) {
      clauses.push(metadataFilterToMongo(filter.metadataFilter));
    }
    const mongoFilter = mergeFilters(...clauses);

    const skip = parseCursor(opts.cursor);
    const limit = opts.limit ?? this.defaultPageSize;
    const docs = await this.entities.find(mongoFilter, { limit, skip });
    return {
      items: docs.map(reviveEntity),
      nextCursor: formatCursor(skip, limit, docs.length),
    };
  }

  async archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    this.assertLive();
    const filter = mergeFilters(scopeToFilter(scope), { id });
    await this.entities.updateOne(filter, {
      $set: { archived: true, updatedAt: new Date() },
      $inc: { version: 1 },
    });
  }

  async deleteEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    this.assertLive();
    const filter = mergeFilters(scopeToFilter(scope), { id });
    await this.entities.deleteOne(filter);
  }

  // ==========================================================================
  // Facts
  // ==========================================================================

  async createFact(input: NewFact): Promise<IFact> {
    this.assertLive();
    const now = new Date();
    const doc = normalizeNewFactForStorage({ ...input, createdAt: now });
    const id = await this.facts.insertOne(doc as unknown as IFact);
    return reviveFact({ ...doc, id } as IFact);
  }

  async createFacts(inputs: NewFact[]): Promise<IFact[]> {
    this.assertLive();
    if (inputs.length === 0) return [];
    const now = new Date();
    const docs = inputs.map((input) => normalizeNewFactForStorage({ ...input, createdAt: now }));
    const ids = await this.facts.insertMany(docs as unknown as IFact[]);
    return docs.map((d, i) => reviveFact({ ...d, id: ids[i]! } as IFact));
  }

  async getFact(id: FactId, scope: ScopeFilter): Promise<IFact | null> {
    this.assertLive();
    const filter = mergeFilters(scopeToFilter(scope), { id });
    const doc = await this.facts.findOne(filter);
    return doc ? reviveFact(doc) : null;
  }

  async findFacts(
    filter: FactFilter,
    opts: FactQueryOptions,
    scope: ScopeFilter,
  ): Promise<Page<IFact>> {
    this.assertLive();
    const mongoFilter = factFilterToMongo(filter, scope);
    const sort: MongoSort | undefined = orderByToSort(opts.orderBy);
    const skip = parseCursor(opts.cursor);
    const limit = opts.limit ?? this.defaultPageSize;
    const docs = await this.facts.find(mongoFilter, { limit, skip, sort });
    return {
      items: docs.map(reviveFact),
      nextCursor: formatCursor(skip, limit, docs.length),
    };
  }

  async updateFact(id: FactId, patch: Partial<IFact>, scope: ScopeFilter): Promise<void> {
    this.assertLive();
    const filter = mergeFilters(scopeToFilter(scope), { id });
    const { id: _ignoreId, ...rest } = patch;
    void _ignoreId;
    await this.facts.updateOne(filter, { $set: normalizePartialFactForStorage(rest) });
  }

  async countFacts(filter: FactFilter, scope: ScopeFilter): Promise<number> {
    this.assertLive();
    return this.facts.countDocuments(factFilterToMongo(filter, scope));
  }

  // ==========================================================================
  // Graph traversal
  // ==========================================================================

  async traverse(
    startId: EntityId,
    opts: TraversalOptions,
    scope: ScopeFilter,
  ): Promise<Neighborhood> {
    this.assertLive();

    // `direction: 'both'` requires per-hop direction flipping — at each node,
    // BOTH outbound and inbound edges are considered and may extend the
    // frontier. A single `$graphLookup` pipeline fixes the direction for the
    // whole chain (`connectFromField` / `connectToField` are static) — firing
    // one out + one in pipeline walks two PURE chains, which misses the
    // common "co-subject" pattern ("who works at the same company as X?"
    // reaches X → Company via out, then Company → co-workers via in — the
    // direction flip at Company is lost). Generic BFS handles the flip
    // correctly, so for `both` we fall back to it. Pure `out` / `in` stay on
    // the native fast path.
    if (opts.direction === 'both') {
      return genericTraverse(this, startId, opts, scope);
    }

    if (this.useNativeGraphLookup && this.facts.aggregate && this.factsCollectionName) {
      return this.nativeGraphTraverse(startId, opts, scope);
    }
    return genericTraverse(this, startId, opts, scope);
  }

  private async nativeGraphTraverse(
    startId: EntityId,
    opts: TraversalOptions,
    scope: ScopeFilter,
  ): Promise<Neighborhood> {
    const startEntity = await this.getEntity(startId, scope);
    if (!startEntity) return { nodes: [], edges: [] };

    // asOf — push the same three clauses factFilterToMongo uses, so the
    // native path behaves identically to the generic path for point-in-time
    // queries. Previously these were silently dropped.
    const asOfClauses = buildAsOfClauses(opts.asOf);
    const predicateClause: MongoFilter =
      opts.predicates && opts.predicates.length > 0
        ? { predicate: { $in: opts.predicates } }
        : {};
    const restrict: MongoFilter = mergeFilters(
      scopeToFilter(scope),
      ARCHIVED_HIDDEN,
      predicateClause,
      ...asOfClauses,
    );

    type EdgeAccum = { from: EntityId; to: EntityId; fact: IFact; depth: number };
    const edgesOut: EdgeAccum[] = [];
    const edgesIn: EdgeAccum[] = [];

    // Off-by-one: $graphLookup.maxDepth=N returns (N+1) levels of documents
    // (0..N). The outer $match already emits depth-1 edges, so $graphLookup
    // should produce at most (opts.maxDepth - 1) additional levels, i.e.
    // maxDepth in mongo = opts.maxDepth - 2. When opts.maxDepth <= 1, we
    // skip $graphLookup entirely — the outer $match is sufficient.
    const useGraphLookup = opts.maxDepth >= 2;
    const graphLookupMaxDepth = Math.max(0, opts.maxDepth - 2);

    // Outbound — match subjectId=start, then (optionally) recurse object→subject chains.
    if (opts.direction === 'out') {
      const match: MongoFilter = mergeFilters(
        scopeToFilter(scope),
        ARCHIVED_HIDDEN,
        { subjectId: startId },
        predicateClause,
        ...asOfClauses,
      );
      const pipeline: unknown[] = [{ $match: match }];
      if (useGraphLookup) {
        pipeline.push({
          $graphLookup: {
            from: this.factsCollectionName!,
            startWith: '$objectId',
            connectFromField: 'objectId',
            connectToField: 'subjectId',
            as: 'descendants',
            maxDepth: graphLookupMaxDepth,
            depthField: 'depth',
            restrictSearchWithMatch: restrict,
          },
        });
      }
      const rows = (await this.facts.aggregate!(pipeline)) as Array<
        IFact & { descendants?: Array<IFact & { depth: number }> }
      >;
      for (const row of rows) {
        if (!row.objectId) continue;
        edgesOut.push({ from: row.subjectId, to: row.objectId, fact: reviveFact(row), depth: 1 });
        for (const d of row.descendants ?? []) {
          if (!d.objectId) continue;
          edgesOut.push({
            from: d.subjectId,
            to: d.objectId,
            fact: reviveFact(d),
            depth: (d.depth ?? 0) + 2,
          });
        }
      }
    }

    // Inbound — mirror.
    if (opts.direction === 'in') {
      const match: MongoFilter = mergeFilters(
        scopeToFilter(scope),
        ARCHIVED_HIDDEN,
        { objectId: startId },
        predicateClause,
        ...asOfClauses,
      );
      const pipeline: unknown[] = [{ $match: match }];
      if (useGraphLookup) {
        pipeline.push({
          $graphLookup: {
            from: this.factsCollectionName!,
            startWith: '$subjectId',
            connectFromField: 'subjectId',
            connectToField: 'objectId',
            as: 'ancestors',
            maxDepth: graphLookupMaxDepth,
            depthField: 'depth',
            restrictSearchWithMatch: restrict,
          },
        });
      }
      const rows = (await this.facts.aggregate!(pipeline)) as Array<
        IFact & { ancestors?: Array<IFact & { depth: number }> }
      >;
      for (const row of rows) {
        if (!row.objectId) continue;
        edgesIn.push({ from: row.subjectId, to: row.objectId, fact: reviveFact(row), depth: 1 });
        for (const a of row.ancestors ?? []) {
          if (!a.objectId) continue;
          edgesIn.push({
            from: a.subjectId,
            to: a.objectId,
            fact: reviveFact(a),
            depth: (a.depth ?? 0) + 2,
          });
        }
      }
    }

    // Apply edge limit BEFORE resolving nodes — the `opts.limit` contract
    // caps edges. Sort by depth first so that under a tight limit we keep
    // the nearest (shallowest) edges — matches BFS-ordering users expect and
    // the behavior of `genericTraverse` for parity across backends.
    const edgeLimit = opts.limit ?? Infinity;
    const allEdges = [...edgesOut, ...edgesIn]
      .sort((a, b) => a.depth - b.depth)
      .slice(0, edgeLimit);

    // Resolve entities for every node referenced by the (already-limited)
    // edges — no separate node cap. Node count is naturally bounded at
    // 2*edgeLimit + 1 via the edge cap above, so every returned edge is
    // guaranteed to have both endpoints present in `nodes`.
    const visited = new Map<EntityId, number>();
    visited.set(startId, 0);
    for (const e of allEdges) {
      const prev1 = visited.get(e.from);
      if (prev1 === undefined || prev1 > e.depth) visited.set(e.from, e.depth);
      const prev2 = visited.get(e.to);
      if (prev2 === undefined || prev2 > e.depth) visited.set(e.to, e.depth);
    }

    const nodes: Neighborhood['nodes'] = [];
    for (const [id, depth] of visited) {
      const ent = await this.getEntity(id, scope);
      if (ent) nodes.push({ entity: ent, depth });
    }

    return {
      nodes,
      edges: allEdges.map((e) => ({ fact: e.fact, from: e.from, to: e.to, depth: e.depth })),
    };
  }

  // ==========================================================================
  // Semantic search
  // ==========================================================================

  async semanticSearch(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>> {
    this.assertLive();
    if (this.vectorIndexName && this.facts.aggregate) {
      return this.atlasVectorSearch(queryVector, filter, opts, scope);
    }
    return this.cursorCosine(queryVector, filter, opts, scope);
  }

  private async atlasVectorSearch(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>> {
    const pipeline = [
      {
        $vectorSearch: {
          index: this.vectorIndexName!,
          path: 'embedding',
          queryVector,
          numCandidates: opts.topK * this.vectorCandidateMultiplier,
          limit: opts.topK,
          filter: factFilterToMongo(filter, scope),
        },
      },
      { $addFields: { score: { $meta: 'vectorSearchScore' } } },
    ];
    const rows = (await this.facts.aggregate!(pipeline)) as Array<IFact & { score?: number }>;
    return rows.map((r) => ({ fact: reviveFact(r), score: r.score ?? 0 }));
  }

  private async cursorCosine(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>> {
    // Fall back: scan facts matching the filter + scope, cosine in memory.
    // Only consider facts with an embedding of matching dimension.
    const mongoFilter = mergeFilters(factFilterToMongo(filter, scope), {
      embedding: { $exists: true },
    });
    const docs = await this.facts.find(mongoFilter, { limit: 5000 });
    const scored: Array<{ fact: IFact; score: number }> = [];
    for (const doc of docs) {
      if (!doc.embedding || doc.embedding.length !== queryVector.length) continue;
      const score = cosine(queryVector, doc.embedding);
      scored.push({ fact: reviveFact(doc), score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.topK);
  }

  // ==========================================================================
  // Semantic entity search (identityEmbedding)
  // ==========================================================================

  async semanticSearchEntities(
    queryVector: number[],
    filter: EntitySemanticSearchFilter,
    opts: SemanticSearchOptions & { minScore?: number },
    scope: ScopeFilter,
  ): Promise<Array<{ entity: IEntity; score: number }>> {
    this.assertLive();
    if (this.entityVectorIndexName && this.entities.aggregate) {
      return this.atlasVectorSearchEntities(queryVector, filter, opts, scope);
    }
    return this.cursorCosineEntities(queryVector, filter, opts, scope);
  }

  private async atlasVectorSearchEntities(
    queryVector: number[],
    filter: EntitySemanticSearchFilter,
    opts: SemanticSearchOptions & { minScore?: number },
    scope: ScopeFilter,
  ): Promise<Array<{ entity: IEntity; score: number }>> {
    const vectorFilter = mergeFilters(
      scopeToFilter(scope),
      ARCHIVED_HIDDEN,
      entitySemanticFilterToMongo(filter),
    );
    const pipeline = [
      {
        $vectorSearch: {
          index: this.entityVectorIndexName!,
          path: 'identityEmbedding',
          queryVector,
          numCandidates: opts.topK * this.vectorCandidateMultiplier,
          limit: opts.topK,
          filter: vectorFilter,
        },
      },
      { $addFields: { score: { $meta: 'vectorSearchScore' } } },
    ];
    const rows = (await this.entities.aggregate!(pipeline)) as Array<IEntity & { score?: number }>;
    const minScore = opts.minScore;
    const scored = rows
      .map((r) => ({ entity: reviveEntity(r), score: r.score ?? 0 }))
      .filter((r) => (minScore === undefined ? true : r.score >= minScore));
    return scored;
  }

  private async cursorCosineEntities(
    queryVector: number[],
    filter: EntitySemanticSearchFilter,
    opts: SemanticSearchOptions & { minScore?: number },
    scope: ScopeFilter,
  ): Promise<Array<{ entity: IEntity; score: number }>> {
    const mongoFilter = mergeFilters(
      scopeToFilter(scope),
      ARCHIVED_HIDDEN,
      entitySemanticFilterToMongo(filter),
      { identityEmbedding: { $exists: true } },
    );
    // Cap at 5000 to match fact-level cursor scan — scope + type narrows early.
    const docs = await this.entities.find(mongoFilter, { limit: 5000 });
    const minScore = opts.minScore;
    const scored: Array<{ entity: IEntity; score: number }> = [];
    for (const doc of docs) {
      if (!doc.identityEmbedding || doc.identityEmbedding.length !== queryVector.length) continue;
      const score = cosine(queryVector, doc.identityEmbedding);
      if (minScore !== undefined && score < minScore) continue;
      scored.push({ entity: reviveEntity(doc), score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.topK);
  }

  // ==========================================================================
  // Atlas Search / Vector Search index management
  // ==========================================================================

  /**
   * Create the Atlas Vector Search indexes for facts and/or entities if they
   * aren't already present. Separate from `ensureIndexes()` because vector
   * indexes need runtime parameters (`dimensions`, `similarity`) and take
   * longer to build — callers shouldn't pay that cost unless they use
   * semantic search.
   *
   * Requires:
   *   - Atlas Server v6.0.11+ and mongodb node driver v6.6+ (the driver
   *     exposes `createSearchIndex` / `listSearchIndexes`).
   *   - The `IMongoCollectionLike` wrapper must implement `createSearchIndex`
   *     (both bundled wrappers do; custom wrappers may need updating).
   *
   * Idempotent — re-running is safe: existing indexes with the configured
   * name are detected via `listSearchIndexes` and skipped. If
   * `waitUntilReady` is true, polls each created index until `queryable: true`
   * or timeout.
   *
   * The adapter's `vectorIndexName` / `entityVectorIndexName` options must
   * match the `factsIndexName` / `entitiesIndexName` used here, otherwise
   * runtime queries won't hit the index.
   */
  async ensureVectorSearchIndexes(opts: {
    /** Embedding dimensionality — MUST match your embedder. Fixed per-index. */
    dimensions: number;
    /** Default: 'cosine'. Match the similarity your embedder was trained for. */
    similarity?: 'cosine' | 'dotProduct' | 'euclidean';
    /**
     * Atlas index name for facts. Default: 'facts_vector'. Must match
     * `vectorIndexName` on this adapter for runtime queries to use it.
     * Pass `null` to skip the facts index entirely.
     */
    factsIndexName?: string | null;
    /**
     * Atlas index name for entities. Default: 'entities_vector'. Must match
     * `entityVectorIndexName` on this adapter. Pass `null` to skip.
     */
    entitiesIndexName?: string | null;
    /** Poll until queryable=true. Default: true. */
    waitUntilReady?: boolean;
    /** Poll timeout when `waitUntilReady`. Default: 120000 (2 min). */
    readyTimeoutMs?: number;
    /** Poll interval when `waitUntilReady`. Default: 2000 (2s). */
    readyPollMs?: number;
  }): Promise<void> {
    this.assertLive();
    const similarity = opts.similarity ?? 'cosine';
    const waitUntilReady = opts.waitUntilReady ?? true;
    const readyTimeoutMs = opts.readyTimeoutMs ?? 120_000;
    const readyPollMs = opts.readyPollMs ?? 2_000;

    const factsName = opts.factsIndexName === undefined ? 'facts_vector' : opts.factsIndexName;
    const entitiesName =
      opts.entitiesIndexName === undefined ? 'entities_vector' : opts.entitiesIndexName;

    if (factsName !== null) {
      await ensureOneVectorSearchIndex({
        collection: this.facts as unknown as IMongoCollectionLike<{ id: string }>,
        name: factsName,
        path: 'embedding',
        dimensions: opts.dimensions,
        similarity,
        waitUntilReady,
        readyTimeoutMs,
        readyPollMs,
      });
    }
    if (entitiesName !== null) {
      await ensureOneVectorSearchIndex({
        collection: this.entities as unknown as IMongoCollectionLike<{ id: string }>,
        name: entitiesName,
        path: 'identityEmbedding',
        dimensions: opts.dimensions,
        similarity,
        waitUntilReady,
        readyTimeoutMs,
        readyPollMs,
      });
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  destroy(): void {
    this.destroyed = true;
    // Collection lifecycle is the caller's concern — they own the client/
    // Mongo.Collection. We deliberately do not close anything.
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  async shutdown(): Promise<void> {
    this.destroy();
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private assertLive(): void {
    if (this.destroyed) throw new Error('MongoMemoryAdapter: instance has been destroyed');
  }
}

// =============================================================================
// Normalization — store `null` (not undefined) for scope fields so indexes hit
// consistently across records.
// =============================================================================

function normalizeEntityForStorage(entity: IEntity): IEntity {
  return {
    ...entity,
    groupId: entity.groupId ?? (null as unknown as undefined),
    ownerId: entity.ownerId ?? (null as unknown as undefined),
    identifiers: entity.identifiers.map((i) => ({
      ...i,
      value: i.value.toLowerCase(),
    })),
  };
}

/** Same as normalizeEntityForStorage but for records without id (pre-insert). */
function normalizeNewEntityForStorage(
  input: NewEntity & { version: number; createdAt: Date; updatedAt: Date },
): Omit<IEntity, 'id'> {
  return {
    ...input,
    groupId: input.groupId ?? (null as unknown as undefined),
    ownerId: input.ownerId ?? (null as unknown as undefined),
    identifiers: input.identifiers.map((i) => ({
      ...i,
      value: i.value.toLowerCase(),
    })),
  };
}

function normalizeNewFactForStorage(
  input: NewFact & { createdAt: Date },
): Omit<IFact, 'id'> {
  return {
    ...input,
    groupId: input.groupId ?? (null as unknown as undefined),
    ownerId: input.ownerId ?? (null as unknown as undefined),
  };
}

function normalizePartialFactForStorage(patch: Partial<IFact>): Partial<IFact> {
  return patch;
}

function reviveEntity(doc: IEntity): IEntity {
  return {
    ...doc,
    groupId: nullToUndefined(doc.groupId),
    ownerId: nullToUndefined(doc.ownerId),
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt),
  };
}

function reviveFact(doc: IFact): IFact {
  return {
    ...doc,
    groupId: nullToUndefined(doc.groupId),
    ownerId: nullToUndefined(doc.ownerId),
    createdAt: toDate(doc.createdAt),
    observedAt: doc.observedAt ? toDate(doc.observedAt) : undefined,
    validFrom: doc.validFrom ? toDate(doc.validFrom) : undefined,
    validUntil: doc.validUntil ? toDate(doc.validUntil) : undefined,
  };
}

function nullToUndefined<T>(v: T | null | undefined): T | undefined {
  return v === null ? undefined : (v as T | undefined);
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return new Date(0);
}

/**
 * Clauses pushed into native traversal filters so point-in-time queries
 * behave the same on Mongo as on the generic BFS path. Mirrors the asOf
 * handling in `queries.ts:factFilterToMongo` — kept inline here to avoid
 * pulling the full fact-filter machinery into the traversal path.
 */
function buildAsOfClauses(asOf: Date | undefined): MongoFilter[] {
  if (!(asOf instanceof Date)) return [];
  return [
    { createdAt: { $lte: asOf } },
    { $or: [{ validFrom: { $exists: false } }, { validFrom: { $lte: asOf } }] },
    { $or: [{ validUntil: { $exists: false } }, { validUntil: { $gte: asOf } }] },
  ];
}

// =============================================================================
// Helpers
// =============================================================================

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Relevance score for searchEntities ranking. Higher = better match.
 * Mirrored from InMemoryAdapter so behavior is consistent across adapters.
 */
function entityRelevance(entity: IEntity, q: string): number {
  if (!q) return 0;
  const dn = entity.displayName.toLowerCase();
  if (dn === q) return 4;
  if (entity.aliases) {
    for (const a of entity.aliases) if (a.toLowerCase() === q) return 3;
  }
  if (dn.includes(q)) return 2;
  if (entity.aliases) {
    for (const a of entity.aliases) if (a.toLowerCase().includes(q)) return 1;
  }
  for (const ident of entity.identifiers) {
    if (ident.value.toLowerCase().includes(q)) return 1;
  }
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translate { state: 'pending', priority: { $in: ['high','urgent'] } } into
 * { 'metadata.state': 'pending', 'metadata.priority': { $in: [...] } }.
 *
 * Hardened against operator injection: only literal scalars/arrays and a
 * single `{ $in: [...] }` shape are accepted. Keys starting with `$` or
 * containing `.` are rejected. Any other object shape (multiple keys, other
 * Mongo operators like `$where`, `$regex`, `$function`) throws.
 *
 * Callers who forward untrusted input into `metadataFilter` get defense in
 * depth: a user can't smuggle `{$where: "..."}` through even by accident.
 */
function metadataFilterToMongo(filter: Record<string, unknown>): MongoFilter {
  const out: MongoFilter = {};
  for (const [key, expected] of Object.entries(filter)) {
    if (key.startsWith('$') || key.includes('.')) {
      throw new Error(
        `metadataFilter: invalid key '${key}' — keys must not start with '$' or contain '.'`,
      );
    }
    const path = `metadata.${key}`;
    assertAllowedMetadataValue(key, expected);
    out[path] = expected;
  }
  return out;
}

function assertAllowedMetadataValue(key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return;
  if (value instanceof Date) return;
  if (Array.isArray(value)) {
    // Only arrays of primitives / Dates are allowed.
    for (const v of value) {
      const tv = typeof v;
      if (
        v !== null &&
        v !== undefined &&
        tv !== 'string' &&
        tv !== 'number' &&
        tv !== 'boolean' &&
        !(v instanceof Date)
      ) {
        throw new Error(
          `metadataFilter['${key}']: array must contain only primitives or Dates`,
        );
      }
    }
    return;
  }
  if (t === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 1 && keys[0] === '$in') {
      const inArr = (value as { $in: unknown }).$in;
      if (!Array.isArray(inArr)) {
        throw new Error(`metadataFilter['${key}']: $in must be an array`);
      }
      assertAllowedMetadataValue(key, inArr);
      return;
    }
    throw new Error(
      `metadataFilter['${key}']: only literal values or {$in: [...]} are allowed ` +
        `(got keys: ${keys.join(', ')})`,
    );
  }
  throw new Error(`metadataFilter['${key}']: unsupported value type '${t}'`);
}

// =============================================================================
// Entity semantic search helpers
// =============================================================================

/** Translate the narrow `EntitySemanticSearchFilter` into a Mongo filter clause. */
function entitySemanticFilterToMongo(filter: EntitySemanticSearchFilter): MongoFilter {
  if (filter.type !== undefined) return { type: filter.type };
  if (filter.types && filter.types.length > 0) return { type: { $in: filter.types } };
  return {};
}

// =============================================================================
// Atlas Vector Search index management
// =============================================================================

interface EnsureVectorIndexArgs {
  collection: IMongoCollectionLike<{ id: string }>;
  name: string;
  path: string;
  dimensions: number;
  similarity: 'cosine' | 'dotProduct' | 'euclidean';
  waitUntilReady: boolean;
  readyTimeoutMs: number;
  readyPollMs: number;
}

/**
 * Ensure a single Atlas Vector Search index exists on a collection.
 * - List existing indexes; if our name is present, skip creation.
 * - Otherwise create with the given path/dimensions/similarity.
 * - If `waitUntilReady`, poll until the index reports `queryable: true` or
 *   the timeout elapses.
 *
 * Throws if the wrapper does not implement `createSearchIndex` /
 * `listSearchIndexes` (non-Atlas Mongo, older driver, custom wrapper).
 */
async function ensureOneVectorSearchIndex(args: EnsureVectorIndexArgs): Promise<void> {
  const { collection, name } = args;
  if (!collection.createSearchIndex || !collection.listSearchIndexes) {
    throw new Error(
      `ensureVectorSearchIndexes: collection wrapper does not implement createSearchIndex / listSearchIndexes. ` +
        `Atlas Vector Search requires mongodb node driver v6.6+ and Atlas Server v6.0.11+.`,
    );
  }
  const definition: SearchIndexDefinition = {
    name,
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: args.path,
          numDimensions: args.dimensions,
          similarity: args.similarity,
        },
      ],
    },
  };

  const existing = await collection.listSearchIndexes(name);
  const present = existing.find((i) => i.name === name);
  if (!present) {
    await collection.createSearchIndex(definition);
  }
  if (!args.waitUntilReady) return;
  await waitForSearchIndexReady(collection, name, args.readyTimeoutMs, args.readyPollMs);
}

async function waitForSearchIndexReady(
  collection: IMongoCollectionLike<{ id: string }>,
  name: string,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  if (!collection.listSearchIndexes) return;
  const deadline = Date.now() + timeoutMs;
  let last: SearchIndexInfo | undefined;
  while (Date.now() < deadline) {
    const rows = await collection.listSearchIndexes(name);
    last = rows.find((i) => i.name === name);
    if (last && last.queryable) return;
    if (last && last.status === 'FAILED') {
      throw new Error(
        `ensureVectorSearchIndexes: Atlas reported index '${name}' as FAILED. Inspect the latest definition and recreate.`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `ensureVectorSearchIndexes: timed out after ${timeoutMs}ms waiting for index '${name}' to become queryable ` +
      `(last status: ${last?.status ?? 'UNKNOWN'}). Index build is async on Atlas; try increasing readyTimeoutMs.`,
  );
}
