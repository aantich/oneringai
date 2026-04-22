/**
 * Narrow collection contract the MongoMemoryAdapter depends on.
 *
 * Two implementations ship in-tree: RawMongoCollection (wraps a mongodb-driver
 * Collection) and MeteorMongoCollection (wraps a Meteor Mongo.Collection).
 * Users with different plumbing can implement this interface themselves.
 *
 * Writes are expected to trigger whatever reactivity mechanism the underlying
 * collection provides (Meteor publications, change streams) — the adapter
 * deliberately routes material updates through these methods so memory writes
 * propagate to subscribers.
 *
 * Reads are expected to run on the raw driver when complex pipelines are
 * needed (`aggregate`), which is why `aggregate` is optional — implementations
 * that can't support it gracefully disable the fast paths that depend on it.
 */

export type MongoFilter = Record<string, unknown>;
export type MongoUpdate = Record<string, unknown>;
export type MongoSort = Record<string, 1 | -1>;

export interface MongoFindOptions {
  sort?: MongoSort;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

export interface MongoUpdateOptions {
  upsert?: boolean;
}

export interface MongoUpdateResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
}

export interface IMongoCollectionLike<T extends { id: string }> {
  // ===== Writes (route through Meteor / reactivity layer when wrapped) =====
  /**
   * Insert a document. Any `id` field on the input is IGNORED — the collection
   * assigns the primary key (Mongo: ObjectId → hex string; Meteor: Random.id()).
   * Returns the assigned id as a string.
   */
  insertOne(doc: T): Promise<string>;
  /** Batch insert. Returned ids are in the same order as input. */
  insertMany(docs: T[]): Promise<string[]>;
  /**
   * Update. `filter` may contain `id: <string>` — wrappers translate to the
   * native primary-key form (Mongo: `_id: ObjectId(...)`; Meteor: `_id: <string>`).
   * Any `id` field in the update payload is stripped (ids are immutable).
   */
  updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    opts?: MongoUpdateOptions,
  ): Promise<MongoUpdateResult>;
  deleteOne(filter: MongoFilter): Promise<void>;
  deleteMany(filter: MongoFilter): Promise<void>;

  // ===== Reads =====
  /**
   * Returned documents always have `id` populated (mapped from the native
   * primary key — `_id.toHexString()` for Mongo ObjectId, or the string form
   * for Meteor). `_id` is not present on returned documents.
   */
  findOne(filter: MongoFilter, opts?: MongoFindOptions): Promise<T | null>;
  find(filter: MongoFilter, opts?: MongoFindOptions): Promise<T[]>;
  countDocuments(filter: MongoFilter): Promise<number>;

  /**
   * Aggregation pipeline. Optional — adapters gate `$graphLookup` and
   * `$vectorSearch` fast paths on its presence.
   */
  aggregate?(pipeline: unknown[]): Promise<unknown[]>;

  /**
   * Index management hook. Optional — the adapter's `ensureIndexes()` helper
   * calls this when available; otherwise users must create indexes themselves.
   */
  createIndex?(spec: Record<string, 1 | -1>, opts?: { unique?: boolean; name?: string }): Promise<void>;

  /**
   * Atlas Search / Vector Search index management. Optional — available on
   * Atlas Server 6.0.11+ via the node driver's `createSearchIndex()` +
   * `listSearchIndexes()`. Meteor wrappers delegate to `rawCollection()`.
   * When absent, callers must create vector-search indexes via the Atlas UI
   * or admin API out-of-band.
   *
   * `createSearchIndex` is idempotent only in the "already exists" sense —
   * Atlas returns an error if the name clashes. Callers should `listSearchIndexes`
   * first to skip creation when the index is present.
   */
  createSearchIndex?(definition: SearchIndexDefinition): Promise<string>;
  /** Returns all search indexes (or one named index) with lifecycle status. */
  listSearchIndexes?(name?: string): Promise<SearchIndexInfo[]>;

  /**
   * Transaction hook — present on raw-driver wrappers when a client is
   * available, absent on Meteor wrappers. When present, MongoMemoryAdapter
   * wraps supersession in a transaction; when absent, it relies on the
   * crash-safe ordering that MemorySystem already enforces.
   */
  withTransaction?<R>(fn: () => Promise<R>): Promise<R>;
}

/**
 * Atlas Search / Vector Search index definition. Mirrors the shape the
 * mongodb Node.js driver `createSearchIndex()` expects. The `type` discriminator
 * is REQUIRED on Atlas Server 6.0.11+ for vector indexes — pass `'vectorSearch'`.
 */
export interface SearchIndexDefinition {
  name: string;
  /** 'vectorSearch' for vector-search indexes; 'search' (or omitted) for text. */
  type?: 'search' | 'vectorSearch';
  definition: {
    /** Vector-search variant — array of vector + (optional) filter fields. */
    fields?: Array<
      | {
          type: 'vector';
          path: string;
          numDimensions: number;
          similarity: 'cosine' | 'dotProduct' | 'euclidean';
        }
      | { type: 'filter'; path: string }
    >;
    /** Text-search variant — arbitrary mapping spec. Passed through. */
    mappings?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

/** Lifecycle record returned by `listSearchIndexes`. */
export interface SearchIndexInfo {
  name: string;
  /** Atlas lifecycle — 'PENDING' | 'BUILDING' | 'READY' | 'FAILED' | 'STALE' | ... */
  status: string;
  /** True once the index is built and available for queries. */
  queryable: boolean;
  /** The stored definition echoed back — type + fields/mappings. */
  latestDefinition?: Record<string, unknown>;
}
