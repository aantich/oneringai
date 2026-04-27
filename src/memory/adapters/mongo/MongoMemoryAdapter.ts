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
import { coerceFactTemporalFields, coerceMetadataDates } from '../../dateCoercion.js';
import { genericTraverse } from '../../GenericTraversal.js';
import type {
  IMongoCollectionLike,
  MongoFilter,
  MongoSort,
  SearchIndexDefinition,
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
    const sort = entityOrderByToSort(opts.orderBy);
    const projection = selectToProjection(opts.select);
    const docs = await this.entities.find(mongoFilter, { limit, skip, sort, projection });
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
   * name are detected via `listSearchIndexes` and skipped. Concurrent-create
   * races (two migrations running at once) are absorbed: if
   * `createSearchIndex` fails but the index is present on re-check, we
   * treat it as "another process won" and continue.
   *
   * Fire-and-forget: returns as soon as Atlas accepts the create request.
   * The index builds asynchronously on Atlas (30–60s typical). Runs during
   * startup migrations, so the index is ready well before real traffic.
   * The typical first query lands minutes after the migration, not seconds —
   * no readiness wait needed.
   *
   * **Index names come from the adapter's config by default.** If the adapter
   * was constructed with `vectorIndexName: 'custom_facts'` (or
   * `entityVectorIndexName: 'custom_entities'`), this helper creates indexes
   * under those names automatically. Callers can still override via
   * `factsIndexName` / `entitiesIndexName`, but the default is the safe
   * choice — runtime queries and helper output always agree.
   *
   * **Filter fields are auto-declared in the index definition.** Atlas
   * `$vectorSearch` silently ignores `filter` clauses whose paths aren't
   * declared as `type: 'filter'` in the index. We declare scope + archived
   * + discriminator paths for both collections so scope enforcement works
   * on the `$vectorSearch` fast path. See the field lists in
   * `FACTS_FILTER_PATHS` / `ENTITIES_FILTER_PATHS` below — manual Atlas-UI
   * creators must match or the filter is silently ignored (scope bypass).
   */
  async ensureVectorSearchIndexes(opts: {
    /** Embedding dimensionality — MUST match your embedder. Must be a positive integer. */
    dimensions: number;
    /** Default: 'cosine'. Match the similarity your embedder was trained for. */
    similarity?: 'cosine' | 'dotProduct' | 'euclidean';
    /**
     * Atlas index name for facts. Default: the adapter's own `vectorIndexName`
     * option, or `'facts_vector'` when that's also unset. Pass `null` to skip
     * the facts index entirely.
     */
    factsIndexName?: string | null;
    /**
     * Atlas index name for entities. Default: the adapter's own
     * `entityVectorIndexName` option, or `'entities_vector'` when unset.
     * Pass `null` to skip.
     */
    entitiesIndexName?: string | null;
  }): Promise<void> {
    this.assertLive();
    if (!Number.isInteger(opts.dimensions) || opts.dimensions <= 0) {
      throw new Error(
        `ensureVectorSearchIndexes: dimensions must be a positive integer (got ${String(opts.dimensions)})`,
      );
    }
    const similarity = opts.similarity ?? 'cosine';

    // Name resolution: explicit arg > adapter config > literal default.
    // `null` explicitly skips; `undefined` falls through to adapter config.
    const factsName =
      opts.factsIndexName === undefined
        ? (this.vectorIndexName ?? 'facts_vector')
        : opts.factsIndexName;
    const entitiesName =
      opts.entitiesIndexName === undefined
        ? (this.entityVectorIndexName ?? 'entities_vector')
        : opts.entitiesIndexName;

    if (factsName !== null) {
      await ensureOneVectorSearchIndex({
        collection: this.facts as unknown as IMongoCollectionLike<{ id: string }>,
        name: factsName,
        path: 'embedding',
        dimensions: opts.dimensions,
        similarity,
        filterPaths: FACTS_FILTER_PATHS,
      });
    }
    if (entitiesName !== null) {
      await ensureOneVectorSearchIndex({
        collection: this.entities as unknown as IMongoCollectionLike<{ id: string }>,
        name: entitiesName,
        path: 'identityEmbedding',
        dimensions: opts.dimensions,
        similarity,
        filterPaths: ENTITIES_FILTER_PATHS,
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
    // Belt-and-suspenders: re-coerce metadata at the storage boundary so
    // bypass paths (direct adapter use) can't smuggle ISO strings into BSON.
    metadata: coerceMetadataDates(entity.metadata),
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
    metadata: coerceMetadataDates(input.metadata),
  };
}

function normalizeNewFactForStorage(
  input: NewFact & { createdAt: Date },
): Omit<IFact, 'id'> {
  // Belt-and-suspenders: enforce Date typing on temporal fields + nested
  // metadata at the storage boundary.
  const coerced = coerceFactTemporalFields(input);
  return {
    ...coerced,
    groupId: coerced.groupId ?? (null as unknown as undefined),
    ownerId: coerced.ownerId ?? (null as unknown as undefined),
  };
}

function normalizePartialFactForStorage(patch: Partial<IFact>): Partial<IFact> {
  // Coerce ISO-string temporal fields to `Date` so $set patches don't smuggle
  // strings into BSON. `IFact` types these as `Date | undefined`; a string
  // here means a caller violated the contract.
  return coerceFactTemporalFields(patch);
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
 * Translate
 *   { state: 'pending', 'jarvis.importance': { $gte: 70 }, dueAt: { $lt: d } }
 * into
 *   { 'metadata.state': 'pending',
 *     'metadata.jarvis.importance': { $gte: 70 },
 *     'metadata.dueAt': { $lt: d } }.
 *
 * Hardened against operator injection:
 *  - Keys may use dot-notation for nested paths, but NO path segment may start
 *    with `$` — blocks `$where`, `a.$function`, etc.
 *  - Values must be one of: literal scalar / Date / array of those / one
 *    allowed operator object. Allowed operators: `$in`, `$lt`, `$lte`, `$gt`,
 *    `$gte`. Range ops may be combined (e.g. `{ $gte: 10, $lt: 20 }`).
 *  - Anything else (bare object, unknown operator keys, `$regex`, `$where`)
 *    throws.
 *
 * Callers who forward untrusted input into `metadataFilter` get defense in
 * depth: a user can't smuggle `{$where: "..."}` through even by accident.
 */
function metadataFilterToMongo(filter: Record<string, unknown>): MongoFilter {
  const out: MongoFilter = {};
  for (const [key, expected] of Object.entries(filter)) {
    assertAllowedMetadataKey(key);
    const path = `metadata.${key}`;
    assertAllowedMetadataValue(key, expected);
    out[path] = expected;
  }
  return out;
}

function assertAllowedMetadataKey(key: string): void {
  assertAllowedFieldPath('metadataFilter', key);
}

/**
 * Shared path validator for any LLM-reachable field reference — metadataFilter
 * keys, `orderBy.field`, `select` projection paths. Rejects empty / trailing /
 * consecutive dots and any segment starting with `$`. Defense-in-depth:
 *  - `$natural` as a sort key is valid Mongo but forces a full collection scan
 *    (index-bypass DoS).
 *  - `$where`, `$function`, `$expr` segments aren't evaluated in sort/projection
 *    keys, but the library contract is "no `$`-prefixed segments anywhere a
 *    caller controls the path" — consistent with metadataFilter hardening.
 */
function assertAllowedFieldPath(context: string, path: string): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`${context}: empty path`);
  }
  const segments = path.split('.');
  for (const seg of segments) {
    if (seg.length === 0) {
      throw new Error(
        `${context}: invalid path '${path}' — empty path segment (leading/trailing or consecutive dots)`,
      );
    }
    if (seg.startsWith('$')) {
      throw new Error(
        `${context}: invalid path '${path}' — path segments must not start with '$'`,
      );
    }
  }
}

/** Range operators permitted on metadata values. */
const RANGE_OPS = new Set(['$lt', '$lte', '$gt', '$gte']);

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
    const opKeys = Object.keys(value as Record<string, unknown>);
    if (opKeys.length === 0) {
      throw new Error(
        `metadataFilter['${key}']: empty operator object — use a literal or one of {$in, $lt, $lte, $gt, $gte}`,
      );
    }
    // $in must stand alone (array value). Range ops may combine.
    if (opKeys.includes('$in')) {
      if (opKeys.length !== 1) {
        throw new Error(
          `metadataFilter['${key}']: $in cannot be combined with other operators`,
        );
      }
      const inArr = (value as { $in: unknown }).$in;
      if (!Array.isArray(inArr)) {
        throw new Error(`metadataFilter['${key}']: $in must be an array`);
      }
      assertAllowedMetadataValue(key, inArr);
      return;
    }
    // Range-ops path: every key must be a range op; every RHS must be scalar/Date.
    for (const op of opKeys) {
      if (!RANGE_OPS.has(op)) {
        throw new Error(
          `metadataFilter['${key}']: unsupported operator '${op}' ` +
            `(allowed: $in, $lt, $lte, $gt, $gte)`,
        );
      }
      const rhs = (value as Record<string, unknown>)[op];
      const rt = typeof rhs;
      if (
        rhs === null ||
        rhs === undefined ||
        !(rt === 'string' || rt === 'number' || rt === 'boolean' || rhs instanceof Date)
      ) {
        throw new Error(
          `metadataFilter['${key}']: range operator '${op}' requires a scalar or Date value`,
        );
      }
    }
    return;
  }
  throw new Error(`metadataFilter['${key}']: unsupported value type '${t}'`);
}

/**
 * Translate `EntityOrderBy | EntityOrderBy[]` to a Mongo sort spec. Preserves
 * insertion order so multi-key sorts behave predictably. Paths are used
 * verbatim — callers pre-dotted (e.g. `'metadata.jarvis.importance'`).
 */
function entityOrderByToSort(
  orderBy: import('../../types.js').EntityOrderBy | import('../../types.js').EntityOrderBy[] | undefined,
): MongoSort | undefined {
  if (!orderBy) return undefined;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (keys.length === 0) return undefined;
  const sort: MongoSort = {};
  for (const k of keys) {
    if (!k.field || k.field.length === 0) continue;
    assertAllowedFieldPath('orderBy.field', k.field);
    sort[k.field] = k.direction === 'asc' ? 1 : -1;
  }
  return Object.keys(sort).length > 0 ? sort : undefined;
}

/**
 * Fields the caller ALWAYS receives on a projected `listEntities` result.
 * These are the identity + scope + lifecycle columns — without them the
 * returned object isn't interpretable (reviveEntity needs createdAt/updatedAt;
 * scope filtering needs ownerId/groupId; identity needs id/type/displayName;
 * optimistic concurrency needs version).
 */
const REQUIRED_PROJECTION_FIELDS: readonly string[] = Object.freeze([
  'id',
  'type',
  'displayName',
  'version',
  'createdAt',
  'updatedAt',
  'ownerId',
  'groupId',
  'archived',
]);

/**
 * Translate a caller `select: string[]` into a Mongo projection doc. Always
 * merges `REQUIRED_PROJECTION_FIELDS` so the result remains a valid `IEntity`.
 */
function selectToProjection(
  select: string[] | undefined,
): Record<string, 0 | 1> | undefined {
  if (!select || select.length === 0) return undefined;
  const projection: Record<string, 0 | 1> = {};
  for (const f of REQUIRED_PROJECTION_FIELDS) projection[f] = 1;
  for (const f of select) {
    if (typeof f !== 'string' || f.length === 0) continue;
    assertAllowedFieldPath('select', f);
    projection[f] = 1;
  }
  return projection;
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

/**
 * Filter paths declared as `type:'filter'` in the entities vector-search
 * index. Any path that `$vectorSearch.filter` might reference MUST be here,
 * otherwise Atlas silently ignores the filter clause — a scope bypass.
 *
 * Derived from `scopeToFilter` (scope + permission enforcement),
 * `ARCHIVED_HIDDEN`, and `entitySemanticFilterToMongo` (type narrow).
 */
const ENTITIES_FILTER_PATHS: readonly string[] = [
  'groupId',
  'ownerId',
  'permissions.group',
  'permissions.world',
  'archived',
  'type',
];

/**
 * Filter paths declared as `type:'filter'` in the facts vector-search index.
 * Derived from `scopeToFilter`, `ARCHIVED_HIDDEN`, and the subset of
 * `factFilterToMongo` paths commonly passed to `$vectorSearch.filter`
 * (subject, object, predicate, kind). Temporal filters (`createdAt`,
 * `validFrom`, `validUntil`) are post-filtered by MemorySystem rather than
 * pushed into the vector pipeline, so they're omitted here.
 */
const FACTS_FILTER_PATHS: readonly string[] = [
  'groupId',
  'ownerId',
  'permissions.group',
  'permissions.world',
  'archived',
  'subjectId',
  'objectId',
  'predicate',
  'kind',
];

interface EnsureVectorIndexArgs {
  collection: IMongoCollectionLike<{ id: string }>;
  name: string;
  path: string;
  dimensions: number;
  similarity: 'cosine' | 'dotProduct' | 'euclidean';
  filterPaths: readonly string[];
}

/**
 * Ensure a single Atlas Vector Search index exists on a collection.
 * - List existing indexes; if our name is present, skip creation.
 * - Otherwise create with the given path/dimensions/similarity plus the
 *   filter paths declared in `filterPaths`.
 * - Concurrent-create races are absorbed: if `createSearchIndex` throws but
 *   the index shows up on re-check, another process won — continue.
 *
 * Fire-and-forget: returns as soon as Atlas accepts the create request. The
 * index builds asynchronously on Atlas (30–60s typical); runs during
 * startup migrations so it's ready well before real traffic arrives.
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
        ...args.filterPaths.map((path) => ({ type: 'filter' as const, path })),
      ],
    },
  };

  const existing = await collection.listSearchIndexes(name);
  if (existing.some((i) => i.name === name)) return;

  try {
    await collection.createSearchIndex(definition);
  } catch (err) {
    // Concurrent-create race: another process may have created this index
    // in the gap between our listSearchIndexes and createSearchIndex calls.
    // Re-check — if it's there, absorb the error. Otherwise rethrow.
    const retry = await collection.listSearchIndexes(name);
    if (!retry.some((i) => i.name === name)) throw err;
  }
}
