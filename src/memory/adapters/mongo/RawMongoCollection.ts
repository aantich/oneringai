/**
 * RawMongoCollection — wraps a native mongodb-driver Collection.
 *
 * Id mapping:
 *   - On insert, any `id` field on the input document is stripped. Mongo
 *     assigns `_id` (ObjectId). We read the assigned id back as a hex string.
 *   - On reads, returned documents have `_id` removed and `id` set to the
 *     hex-string form of `_id`.
 *   - In filters, `id: <string>` is translated to `_id: <ObjectId>` (with
 *     recursive handling of `$and`/`$or` clauses).
 *
 * No runtime dependency on the `mongodb` package — we use structural typing
 * so callers can pass any object that matches the narrow interface.
 */

import type {
  IMongoCollectionLike,
  MongoFilter,
  MongoFindOptions,
  MongoUpdate,
  MongoUpdateOptions,
  MongoUpdateResult,
  SearchIndexDefinition,
  SearchIndexInfo,
} from './IMongoCollectionLike.js';

/**
 * Minimal structural shape of a mongodb-driver ObjectId. Just enough to
 * construct and read back. We never import from `mongodb` at runtime — callers
 * pass their Collection object.
 */
export interface ObjectIdLike {
  toHexString(): string;
}
export type ObjectIdCtor = (hex: string) => ObjectIdLike;

/**
 * Structural shape of the subset of mongodb-driver's Collection we use.
 * Matches mongodb@5+ and mongodb@6+ Collection surface.
 */
export interface RawMongoDriverCollection<T> {
  insertOne(doc: T): Promise<{ insertedId: ObjectIdLike | string }>;
  insertMany(docs: T[]): Promise<{ insertedIds: Record<number, ObjectIdLike | string> }>;
  updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    opts?: { upsert?: boolean },
  ): Promise<MongoUpdateResult>;
  deleteOne(filter: MongoFilter): Promise<unknown>;
  deleteMany(filter: MongoFilter): Promise<unknown>;
  findOne(filter: MongoFilter, opts?: MongoFindOptions): Promise<T | null>;
  find(filter: MongoFilter, opts?: MongoFindOptions): {
    toArray(): Promise<T[]>;
  };
  countDocuments(filter: MongoFilter): Promise<number>;
  aggregate(pipeline: unknown[]): { toArray(): Promise<unknown[]> };
  createIndex(spec: Record<string, 1 | -1>, opts?: unknown): Promise<string>;
  /** Atlas Search / Vector Search creation (node driver v6+). Optional on the
   *  underlying driver so structural typing stays permissive. */
  createSearchIndex?(definition: {
    name: string;
    type?: 'search' | 'vectorSearch';
    definition: Record<string, unknown>;
  }): Promise<string>;
  listSearchIndexes?(name?: string): { toArray(): Promise<Array<Record<string, unknown>>> };
}

/** Optional client surface for sessions/transactions. */
export interface RawMongoClientLike {
  startSession(): {
    withTransaction<R>(fn: () => Promise<R>): Promise<R>;
    endSession(): Promise<void> | void;
  };
}

export class RawMongoCollection<T extends { id: string }> implements IMongoCollectionLike<T> {
  constructor(
    private col: RawMongoDriverCollection<T>,
    /** ObjectId constructor from the `mongodb` package (e.g. `ObjectId` imported from 'mongodb'). */
    private ObjectId: ObjectIdCtor,
    private client?: RawMongoClientLike,
  ) {}

  async insertOne(doc: T): Promise<string> {
    const stripped = stripId(doc);
    const result = await this.col.insertOne(stripped as T);
    return idToString(result.insertedId);
  }

  async insertMany(docs: T[]): Promise<string[]> {
    if (docs.length === 0) return [];
    const stripped = docs.map(stripId) as T[];
    const result = await this.col.insertMany(stripped);
    const out: string[] = [];
    for (let i = 0; i < docs.length; i++) {
      const id = result.insertedIds[i];
      if (id === undefined) {
        throw new Error(`insertMany: driver did not return an id for index ${i}`);
      }
      out.push(idToString(id));
    }
    return out;
  }

  async updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    opts?: MongoUpdateOptions,
  ): Promise<MongoUpdateResult> {
    const translatedFilter = this.translateFilter(filter);
    const cleanUpdate = stripIdFromUpdate(update);
    const res = await this.col.updateOne(translatedFilter, cleanUpdate, opts);
    return {
      matchedCount: res.matchedCount ?? 0,
      modifiedCount: res.modifiedCount ?? 0,
      upsertedCount: res.upsertedCount ?? 0,
    };
  }

  async deleteOne(filter: MongoFilter): Promise<void> {
    await this.col.deleteOne(this.translateFilter(filter));
  }

  async deleteMany(filter: MongoFilter): Promise<void> {
    await this.col.deleteMany(this.translateFilter(filter));
  }

  async findOne(filter: MongoFilter, opts?: MongoFindOptions): Promise<T | null> {
    const doc = await this.col.findOne(this.translateFilter(filter), opts);
    return doc ? this.reviveDoc(doc) : null;
  }

  async find(filter: MongoFilter, opts?: MongoFindOptions): Promise<T[]> {
    const docs = await this.col.find(this.translateFilter(filter), opts).toArray();
    return docs.map((d) => this.reviveDoc(d));
  }

  countDocuments(filter: MongoFilter): Promise<number> {
    return this.col.countDocuments(this.translateFilter(filter));
  }

  async aggregate(pipeline: unknown[]): Promise<unknown[]> {
    // Pipelines operate on native docs — caller (adapter) is responsible for
    // writing pipelines that don't rely on `id` at the top level. Revive _id
    // in results.
    const rows = await this.col.aggregate(pipeline).toArray();
    return rows.map((row) => this.reviveRawRow(row));
  }

  async createIndex(
    spec: Record<string, 1 | -1>,
    opts?: { unique?: boolean; name?: string },
  ): Promise<void> {
    await this.col.createIndex(spec, opts);
  }

  async createSearchIndex(definition: SearchIndexDefinition): Promise<string> {
    if (!this.col.createSearchIndex) {
      throw new Error(
        'RawMongoCollection.createSearchIndex: underlying driver does not expose createSearchIndex. ' +
          'Atlas Vector Search requires mongodb-node-driver v6.6+ and Atlas Server v6.0.11+.',
      );
    }
    return this.col.createSearchIndex({
      name: definition.name,
      type: definition.type,
      definition: definition.definition as Record<string, unknown>,
    });
  }

  async listSearchIndexes(name?: string): Promise<SearchIndexInfo[]> {
    if (!this.col.listSearchIndexes) {
      throw new Error(
        'RawMongoCollection.listSearchIndexes: underlying driver does not expose listSearchIndexes. ' +
          'Atlas Search index management requires mongodb-node-driver v6.6+.',
      );
    }
    const rows = await this.col.listSearchIndexes(name).toArray();
    return rows.map(reviveSearchIndexInfo);
  }

  async withTransaction<R>(fn: () => Promise<R>): Promise<R> {
    if (!this.client) return fn();
    const session = this.client.startSession();
    try {
      return await session.withTransaction(fn);
    } finally {
      await session.endSession();
    }
  }

  // ==========================================================================
  // Private — id/filter translation
  // ==========================================================================

  private translateFilter(filter: MongoFilter): MongoFilter {
    return walkFilter(filter, (key, value) => {
      if (key === 'id') {
        if (typeof value === 'string') {
          return ['_id', this.ObjectId(value)];
        }
        if (isInFilter(value)) {
          return ['_id', { $in: value.$in.map((v) => (typeof v === 'string' ? this.ObjectId(v) : v)) }];
        }
        return ['_id', value];
      }
      return null;
    });
  }

  private reviveDoc(doc: T & { _id?: ObjectIdLike | string }): T {
    const { _id, id: _ignoreIncoming, ...rest } = doc as T & {
      _id?: ObjectIdLike | string;
      id?: string;
    };
    void _ignoreIncoming;
    const idStr = _id === undefined ? (doc as T).id : idToString(_id);
    return { ...rest, id: idStr } as unknown as T;
  }

  private reviveRawRow(row: unknown): unknown {
    if (!row || typeof row !== 'object') return row;
    if ('_id' in row) {
      const { _id, ...rest } = row as { _id: ObjectIdLike | string } & Record<string, unknown>;
      return { id: idToString(_id), ...rest };
    }
    return row;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function stripId<T extends { id?: string }>(doc: T): Omit<T, 'id'> {
  const { id: _omit, ...rest } = doc;
  void _omit;
  return rest;
}

function stripIdFromUpdate(update: MongoUpdate): MongoUpdate {
  // Remove `id` from top-level $set / $setOnInsert. Ids are primary keys and
  // must not be mutated. Any other operators pass through.
  const out: MongoUpdate = {};
  for (const [op, value] of Object.entries(update)) {
    if ((op === '$set' || op === '$setOnInsert') && value && typeof value === 'object') {
      const { id: _omit, ...rest } = value as Record<string, unknown>;
      void _omit;
      out[op] = rest;
    } else {
      out[op] = value;
    }
  }
  return out;
}

function idToString(id: ObjectIdLike | string): string {
  if (typeof id === 'string') return id;
  return id.toHexString();
}

function isInFilter(v: unknown): v is { $in: unknown[] } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && '$in' in v && Array.isArray((v as { $in: unknown[] }).$in);
}

/**
 * Recursively walk a Mongo filter, allowing per-key rewrites. Handles
 * top-level keys plus logical combinators `$and`, `$or`, `$nor`.
 *
 * `rewrite` returns `[newKey, newValue]` to replace the entry, or `null` to
 * keep it as-is.
 */
/**
 * Map Atlas's `listSearchIndexes` row shape onto our normalized `SearchIndexInfo`.
 * Atlas returns a `queryable: boolean` plus `status: string` — we pass both
 * through verbatim and surface the echoed definition for callers that want to
 * diff existing vs desired specs.
 */
function reviveSearchIndexInfo(row: Record<string, unknown>): SearchIndexInfo {
  const name = typeof row.name === 'string' ? row.name : '';
  const status = typeof row.status === 'string' ? row.status : 'UNKNOWN';
  const queryable = row.queryable === true;
  const latestDefinition =
    row.latestDefinition && typeof row.latestDefinition === 'object'
      ? (row.latestDefinition as Record<string, unknown>)
      : undefined;
  return { name, status, queryable, latestDefinition };
}

function walkFilter(
  filter: MongoFilter,
  rewrite: (key: string, value: unknown) => [string, unknown] | null,
): MongoFilter {
  const out: MongoFilter = {};
  for (const [key, value] of Object.entries(filter)) {
    if ((key === '$and' || key === '$or' || key === '$nor') && Array.isArray(value)) {
      out[key] = (value as MongoFilter[]).map((f) => walkFilter(f, rewrite));
      continue;
    }
    const replaced = rewrite(key, value);
    if (replaced) {
      const [newKey, newValue] = replaced;
      out[newKey] = newValue;
    } else {
      out[key] = value;
    }
  }
  return out;
}
