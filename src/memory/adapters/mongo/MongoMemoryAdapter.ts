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
import type { IMongoCollectionLike, MongoFilter, MongoSort } from './IMongoCollectionLike.js';
import { mergeFilters, scopeToFilter } from './scopeFilter.js';
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
   * Number of vector candidates to ask Atlas Vector Search to consider before
   * returning topK. Only used when `vectorIndexName` is set. Default: topK * 10.
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
    this.vectorCandidateMultiplier = opts.vectorCandidateMultiplier ?? 10;
    this.factsCollectionName = opts.factsCollectionName;
    this.defaultPageSize = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
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

    const restrict: MongoFilter = mergeFilters(
      scopeToFilter(scope),
      ARCHIVED_HIDDEN,
      opts.predicates && opts.predicates.length > 0
        ? { predicate: { $in: opts.predicates } }
        : {},
    );

    type EdgeAccum = { from: EntityId; to: EntityId; fact: IFact; depth: number };
    const edgesOut: EdgeAccum[] = [];
    const edgesIn: EdgeAccum[] = [];

    // Outbound — match subjectId=start, then recurse object->subject chains.
    if (opts.direction === 'out' || opts.direction === 'both') {
      const pipeline = [
        { $match: mergeFilters(scopeToFilter(scope), ARCHIVED_HIDDEN, { subjectId: startId }) },
        {
          $graphLookup: {
            from: this.factsCollectionName!,
            startWith: '$objectId',
            connectFromField: 'objectId',
            connectToField: 'subjectId',
            as: 'descendants',
            maxDepth: Math.max(0, opts.maxDepth - 1),
            depthField: 'depth',
            restrictSearchWithMatch: restrict,
          },
        },
      ];
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
    if (opts.direction === 'in' || opts.direction === 'both') {
      const pipeline = [
        { $match: mergeFilters(scopeToFilter(scope), ARCHIVED_HIDDEN, { objectId: startId }) },
        {
          $graphLookup: {
            from: this.factsCollectionName!,
            startWith: '$subjectId',
            connectFromField: 'subjectId',
            connectToField: 'objectId',
            as: 'ancestors',
            maxDepth: Math.max(0, opts.maxDepth - 1),
            depthField: 'depth',
            restrictSearchWithMatch: restrict,
          },
        },
      ];
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

    // Resolve entities for every node we touched.
    const allEdges = [...edgesOut, ...edgesIn];
    const visited = new Map<EntityId, number>();
    visited.set(startId, 0);
    for (const e of allEdges) {
      const prev1 = visited.get(e.from);
      if (prev1 === undefined || prev1 > e.depth) visited.set(e.from, e.depth);
      const prev2 = visited.get(e.to);
      if (prev2 === undefined || prev2 > e.depth) visited.set(e.to, e.depth);
    }

    const nodes: Neighborhood['nodes'] = [];
    const limit = opts.limit ?? Infinity;
    // Resolve in batches; respect limit.
    for (const [id, depth] of visited) {
      if (nodes.length >= limit) break;
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
