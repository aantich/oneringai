/**
 * MeteorMongoCollection — wraps a Meteor Mongo.Collection.
 *
 * Material writes flow through Meteor's async collection API (insertAsync,
 * updateAsync, removeAsync), which triggers reactive publications on the wire.
 * Complex reads ($graphLookup, $vectorSearch) drop to the raw mongodb driver
 * via `rawCollection()`, bypassing reactivity (which is fine — reads don't
 * mutate anyway).
 *
 * Id mapping:
 *   - Meteor's `_id` is a string (Meteor's `Random.id()`, 17 chars).
 *   - On insert, any `id` field on the input is stripped. Meteor assigns the
 *     string id; we return it directly.
 *   - On reads, documents have `_id` renamed to `id`.
 *   - In filters, `id: <string>` is translated to `_id: <string>` (no casting).
 *
 * No runtime import of 'meteor/mongo'. Callers pass any object matching the
 * structural shape below; Meteor's real Collection object satisfies it.
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
 * Structural shape of a Meteor Mongo.Collection. The real Meteor class adds
 * many more methods, but this is what the adapter uses.
 */
export interface MeteorCollectionLike<T> {
  insertAsync(doc: T): Promise<string>;
  updateAsync(
    selector: MongoFilter,
    modifier: MongoUpdate,
    opts?: { multi?: boolean; upsert?: boolean },
  ): Promise<number>;
  removeAsync(selector: MongoFilter): Promise<number>;
  findOneAsync(selector: MongoFilter, opts?: MongoFindOptions): Promise<T | null>;
  find(
    selector: MongoFilter,
    opts?: MongoFindOptions,
  ): { fetchAsync(): Promise<T[]>; countAsync(): Promise<number> };
  rawCollection(): {
    aggregate(pipeline: unknown[]): { toArray(): Promise<unknown[]> };
    createIndex(spec: Record<string, 1 | -1>, opts?: unknown): Promise<string>;
    /** Atlas Search / Vector Search hooks — present on node driver v6.6+. */
    createSearchIndex?(definition: {
      name: string;
      type?: 'search' | 'vectorSearch';
      definition: Record<string, unknown>;
    }): Promise<string>;
    listSearchIndexes?(name?: string): { toArray(): Promise<Array<Record<string, unknown>>> };
  };
}

export class MeteorMongoCollection<T extends { id: string }> implements IMongoCollectionLike<T> {
  constructor(private col: MeteorCollectionLike<T>) {}

  // ----- Writes: Meteor API (reactive-safe) -----

  async insertOne(doc: T): Promise<string> {
    const stripped = stripId(doc) as T;
    return this.col.insertAsync(stripped);
  }

  async insertMany(docs: T[]): Promise<string[]> {
    const out: string[] = [];
    for (const d of docs) out.push(await this.insertOne(d));
    return out;
  }

  async updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    opts?: MongoUpdateOptions,
  ): Promise<MongoUpdateResult> {
    const translated = translateIdField(filter);
    const cleanUpdate = stripIdFromUpdate(update);
    const n = await this.col.updateAsync(translated, cleanUpdate, { upsert: opts?.upsert });
    // Meteor's updateAsync returns modified count; we can't distinguish upsert
    // vs update from its return. For our adapter's needs, matched=modified.
    return { matchedCount: n, modifiedCount: n, upsertedCount: 0 };
  }

  async deleteOne(filter: MongoFilter): Promise<void> {
    await this.col.removeAsync(translateIdField(filter));
  }

  async deleteMany(filter: MongoFilter): Promise<void> {
    await this.col.removeAsync(translateIdField(filter));
  }

  // ----- Reads -----

  async findOne(filter: MongoFilter, opts?: MongoFindOptions): Promise<T | null> {
    const doc = await this.col.findOneAsync(translateIdField(filter), opts);
    return doc ? reviveDoc(doc) : null;
  }

  async find(filter: MongoFilter, opts?: MongoFindOptions): Promise<T[]> {
    const docs = await this.col.find(translateIdField(filter), opts).fetchAsync();
    return docs.map(reviveDoc);
  }

  async countDocuments(filter: MongoFilter): Promise<number> {
    return this.col.find(translateIdField(filter)).countAsync();
  }

  async aggregate(pipeline: unknown[]): Promise<unknown[]> {
    const rows = await this.col.rawCollection().aggregate(pipeline).toArray();
    return rows.map(reviveRawRow);
  }

  async createIndex(
    spec: Record<string, 1 | -1>,
    opts?: { unique?: boolean; name?: string },
  ): Promise<void> {
    await this.col.rawCollection().createIndex(spec, opts);
  }

  async createSearchIndex(definition: SearchIndexDefinition): Promise<string> {
    const raw = this.col.rawCollection();
    if (!raw.createSearchIndex) {
      throw new Error(
        'MeteorMongoCollection.createSearchIndex: Meteor raw collection does not expose createSearchIndex. ' +
          'Atlas Vector Search requires the underlying mongodb node driver v6.6+ and Atlas Server v6.0.11+.',
      );
    }
    return raw.createSearchIndex({
      name: definition.name,
      type: definition.type,
      definition: definition.definition as Record<string, unknown>,
    });
  }

  async listSearchIndexes(name?: string): Promise<SearchIndexInfo[]> {
    const raw = this.col.rawCollection();
    if (!raw.listSearchIndexes) {
      throw new Error(
        'MeteorMongoCollection.listSearchIndexes: Meteor raw collection does not expose listSearchIndexes. ' +
          'Requires mongodb node driver v6.6+.',
      );
    }
    const rows = await raw.listSearchIndexes(name).toArray();
    return rows.map(reviveSearchIndexInfo);
  }

  // No withTransaction — Meteor + transactions is fragile; callers that need
  // it can use RawMongoCollection against the same collection alongside.
}

// ============================================================================
// Helpers — identical shape to RawMongoCollection's but without ObjectId cast
// ============================================================================

function stripId<T extends { id?: string }>(doc: T): Omit<T, 'id'> {
  const { id: _omit, ...rest } = doc;
  void _omit;
  return rest;
}

function stripIdFromUpdate(update: MongoUpdate): MongoUpdate {
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

function reviveDoc<T extends { id: string }>(doc: T & { _id?: string }): T {
  if (doc._id === undefined) return doc;
  const { _id, id: _ignoreIncoming, ...rest } = doc as T & { _id: string; id?: string };
  void _ignoreIncoming;
  return { ...rest, id: _id } as unknown as T;
}

function reviveRawRow(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  if ('_id' in row) {
    const { _id, ...rest } = row as { _id: string } & Record<string, unknown>;
    return { id: _id, ...rest };
  }
  return row;
}

function translateIdField(filter: MongoFilter): MongoFilter {
  return walkFilter(filter, (key, value) => (key === 'id' ? ['_id', value] : null));
}

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
