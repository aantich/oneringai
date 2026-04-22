/**
 * FakeMongoCollection — a minimal in-memory implementation of
 * IMongoCollectionLike used for unit testing MongoMemoryAdapter without a real
 * Mongo instance.
 *
 * Implements the wrapper-level contract (post-id-translation), so it sees
 * `id: <string>` in filters and returns documents with `id` populated. No
 * ObjectId or _id handling needed — wrappers encapsulate that.
 *
 * Supports the subset of Mongo operators the adapter uses:
 *   $and, $or, $in, $exists, $elemMatch, $regex (with $options 'i'),
 *   $gte, $lte, $gt, $lt, $ne
 * plus $set / $inc update operators and minimal aggregation
 * ($match + $graphLookup + $addFields + $vectorSearch).
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
} from '@/memory/adapters/mongo/IMongoCollectionLike.js';

export class FakeMongoCollection<T extends { id: string }> implements IMongoCollectionLike<T> {
  private docs: T[] = [];
  private indexes: Array<{ spec: Record<string, 1 | -1>; unique: boolean; name?: string }> = [];
  private searchIndexes: SearchIndexInfo[] = [];
  private txActive = false;
  private seq = 0;

  /** For verifying aggregate path. */
  public aggregateCalls = 0;
  /** For verifying search-index calls. */
  public createSearchIndexCalls: SearchIndexDefinition[] = [];
  public listSearchIndexCalls = 0;
  /** When set, successive listSearchIndexes calls yield from this queue (oldest first). */
  public searchIndexSequence?: SearchIndexInfo[][];

  constructor(private readonly name: string = 'fake') {}

  // ---------- helpers ----------
  get all(): T[] {
    return this.docs;
  }

  reset(): void {
    this.docs = [];
    this.indexes = [];
    this.aggregateCalls = 0;
  }

  // ---------- writes ----------
  async insertOne(doc: T): Promise<string> {
    // Strip incoming id (wrapper contract: collection assigns)
    const { id: _omit, ...rest } = doc as T & { id?: string };
    void _omit;
    const assignedId = `fake_${this.name}_${++this.seq}`;
    const stored = { ...rest, id: assignedId } as T;
    this.docs.push(clone(stored));
    return assignedId;
  }

  async insertMany(docs: T[]): Promise<string[]> {
    const ids: string[] = [];
    for (const d of docs) ids.push(await this.insertOne(d));
    return ids;
  }

  async updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    opts?: MongoUpdateOptions,
  ): Promise<MongoUpdateResult> {
    const cleanUpdate = stripIdFromUpdate(update);
    const idx = this.docs.findIndex((d) => matches(d, filter));
    if (idx === -1) {
      if (opts?.upsert) {
        const setPart = (cleanUpdate as { $set?: Record<string, unknown> }).$set ?? {};
        const idFromFilter = (filter as { id?: string }).id;
        if (!idFromFilter) {
          throw new Error('FakeMongoCollection upsert requires id in filter');
        }
        const doc = { ...setPart, id: idFromFilter } as T;
        this.docs.push(clone(doc));
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    const current = this.docs[idx]!;
    const next = applyUpdate(current, cleanUpdate);
    this.docs[idx] = clone(next);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  async deleteOne(filter: MongoFilter): Promise<void> {
    const idx = this.docs.findIndex((d) => matches(d, filter));
    if (idx >= 0) this.docs.splice(idx, 1);
  }

  async deleteMany(filter: MongoFilter): Promise<void> {
    this.docs = this.docs.filter((d) => !matches(d, filter));
  }

  // ---------- reads ----------
  async findOne(filter: MongoFilter, opts?: MongoFindOptions): Promise<T | null> {
    const hits = this.applyFind(filter, opts);
    return hits[0] ? clone(hits[0]) : null;
  }

  async find(filter: MongoFilter, opts?: MongoFindOptions): Promise<T[]> {
    return this.applyFind(filter, opts).map(clone);
  }

  async countDocuments(filter: MongoFilter): Promise<number> {
    return this.applyFind(filter).length;
  }

  private applyFind(filter: MongoFilter, opts?: MongoFindOptions): T[] {
    let out = this.docs.filter((d) => matches(d, filter));
    if (opts?.sort) {
      const entries = Object.entries(opts.sort);
      out = [...out].sort((a, b) => {
        for (const [field, dir] of entries) {
          const av = (a as Record<string, unknown>)[field];
          const bv = (b as Record<string, unknown>)[field];
          const cmp = compareAny(av, bv);
          if (cmp !== 0) return cmp * dir;
        }
        return 0;
      });
    }
    const skip = opts?.skip ?? 0;
    const limit = opts?.limit;
    out = out.slice(skip, limit ? skip + limit : undefined);
    return out;
  }

  async aggregate(pipeline: unknown[]): Promise<unknown[]> {
    this.aggregateCalls++;
    return evaluatePipeline(this.docs, pipeline);
  }

  async createIndex(
    spec: Record<string, 1 | -1>,
    opts?: { unique?: boolean; name?: string },
  ): Promise<void> {
    this.indexes.push({ spec, unique: !!opts?.unique, name: opts?.name });
  }

  async createSearchIndex(definition: SearchIndexDefinition): Promise<string> {
    this.createSearchIndexCalls.push(definition);
    this.searchIndexes.push({
      name: definition.name,
      status: 'PENDING',
      queryable: false,
      latestDefinition: definition.definition as Record<string, unknown>,
    });
    return definition.name;
  }

  async listSearchIndexes(name?: string): Promise<SearchIndexInfo[]> {
    this.listSearchIndexCalls++;
    // Optional scripted sequence — each call pops the next snapshot. Useful
    // for simulating the PENDING → BUILDING → READY lifecycle under polling.
    if (this.searchIndexSequence && this.searchIndexSequence.length > 0) {
      const snapshot = this.searchIndexSequence.shift()!;
      const filtered = name ? snapshot.filter((i) => i.name === name) : snapshot;
      return filtered;
    }
    const all = this.searchIndexes;
    return name ? all.filter((i) => i.name === name) : [...all];
  }

  /** Test helper: mark a scripted index as READY without using the sequence. */
  markSearchIndexReady(name: string): void {
    const i = this.searchIndexes.find((x) => x.name === name);
    if (i) {
      i.status = 'READY';
      i.queryable = true;
    }
  }

  get createdIndexes(): Array<{ spec: Record<string, 1 | -1>; name?: string }> {
    return [...this.indexes];
  }

  async withTransaction<R>(fn: () => Promise<R>): Promise<R> {
    if (this.txActive) return fn();
    this.txActive = true;
    try {
      return await fn();
    } finally {
      this.txActive = false;
    }
  }
}

/** Collection variant with NO aggregate, NO createIndex — for fallback coverage. */
export class MinimalFakeMongoCollection<T extends { id: string }>
  implements IMongoCollectionLike<T>
{
  private readonly backing = new FakeMongoCollection<T>();

  insertOne(doc: T): Promise<string> {
    return this.backing.insertOne(doc);
  }
  insertMany(docs: T[]): Promise<string[]> {
    return this.backing.insertMany(docs);
  }
  updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    opts?: MongoUpdateOptions,
  ): Promise<MongoUpdateResult> {
    return this.backing.updateOne(filter, update, opts);
  }
  deleteOne(filter: MongoFilter): Promise<void> {
    return this.backing.deleteOne(filter);
  }
  deleteMany(filter: MongoFilter): Promise<void> {
    return this.backing.deleteMany(filter);
  }
  findOne(filter: MongoFilter, opts?: MongoFindOptions): Promise<T | null> {
    return this.backing.findOne(filter, opts);
  }
  find(filter: MongoFilter, opts?: MongoFindOptions): Promise<T[]> {
    return this.backing.find(filter, opts);
  }
  countDocuments(filter: MongoFilter): Promise<number> {
    return this.backing.countDocuments(filter);
  }
}

// =============================================================================
// Filter matcher — subset of Mongo query operators
// =============================================================================

function matches(doc: unknown, filter: MongoFilter): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and') {
      const list = value as MongoFilter[];
      if (!list.every((f) => matches(doc, f))) return false;
      continue;
    }
    if (key === '$or') {
      const list = value as MongoFilter[];
      if (!list.some((f) => matches(doc, f))) return false;
      continue;
    }

    const fieldVal = getField(doc, key);
    if (!fieldMatches(fieldVal, value)) return false;
  }
  return true;
}

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected === null) {
    return actual === null || actual === undefined;
  }
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  if (typeof expected === 'object' && !Array.isArray(expected) && expected !== null) {
    const ops = expected as Record<string, unknown>;
    const keys = Object.keys(ops);
    if (keys.some((k) => k.startsWith('$'))) {
      return evaluateOperators(actual, ops);
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  if (Array.isArray(actual)) {
    return actual.some((v) => v === expected);
  }
  return actual === expected;
}

function evaluateOperators(actual: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, expected] of Object.entries(ops)) {
    switch (op) {
      case '$exists': {
        const present = actual !== undefined;
        if (present !== !!expected) return false;
        break;
      }
      case '$eq':
        if (actual !== expected) return false;
        break;
      case '$ne':
        if (actual === expected) return false;
        break;
      case '$gt':
        if (!(compareAny(actual, expected) > 0)) return false;
        break;
      case '$gte':
        if (!(compareAny(actual, expected) >= 0)) return false;
        break;
      case '$lt':
        if (!(compareAny(actual, expected) < 0)) return false;
        break;
      case '$lte':
        if (!(compareAny(actual, expected) <= 0)) return false;
        break;
      case '$in': {
        const arr = expected as unknown[];
        if (Array.isArray(actual)) {
          if (!actual.some((v) => arr.includes(v))) return false;
        } else {
          if (!arr.includes(actual)) return false;
        }
        break;
      }
      case '$nin': {
        const arr = expected as unknown[];
        if (Array.isArray(actual)) {
          if (actual.some((v) => arr.includes(v))) return false;
        } else {
          if (arr.includes(actual)) return false;
        }
        break;
      }
      case '$regex': {
        const pattern = expected as string;
        const flags =
          (ops.$options as string | undefined) !== undefined ? (ops.$options as string) : '';
        const re = new RegExp(pattern, flags);
        if (Array.isArray(actual)) {
          if (!actual.some((v) => typeof v === 'string' && re.test(v))) return false;
        } else if (typeof actual !== 'string' || !re.test(actual)) {
          return false;
        }
        break;
      }
      case '$options':
        break;
      case '$elemMatch': {
        if (!Array.isArray(actual)) return false;
        if (!actual.some((el) => matches(el, expected as MongoFilter))) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

function compareAny(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1;
  return 0;
}

function getField(doc: unknown, path: string): unknown {
  if (!doc || typeof doc !== 'object') return undefined;
  if (!path.includes('.')) return (doc as Record<string, unknown>)[path];
  const parts = path.split('.');
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const collected: unknown[] = [];
      for (const el of cur) {
        const v = getField(el, p);
        if (Array.isArray(v)) collected.push(...v);
        else if (v !== undefined) collected.push(v);
      }
      cur = collected;
    } else {
      cur = (cur as Record<string, unknown>)[p];
    }
  }
  return cur;
}

function applyUpdate<T>(doc: T, update: MongoUpdate): T {
  const next = { ...(doc as Record<string, unknown>) };
  const $set = (update as { $set?: Record<string, unknown> }).$set;
  const $inc = (update as { $inc?: Record<string, number> }).$inc;
  if ($set) Object.assign(next, $set);
  if ($inc) {
    for (const [k, v] of Object.entries($inc)) {
      const cur = typeof next[k] === 'number' ? (next[k] as number) : 0;
      next[k] = cur + v;
    }
  }
  return next as T;
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

function evaluatePipeline(docs: unknown[], pipeline: unknown[]): unknown[] {
  let current = docs.map((d) => clone(d));
  for (const stage of pipeline as Array<Record<string, unknown>>) {
    if ('$match' in stage) {
      const filter = stage.$match as MongoFilter;
      current = current.filter((d) => matches(d, filter));
    } else if ('$addFields' in stage) {
      const fields = stage.$addFields as Record<string, unknown>;
      current = current.map((d) => {
        const out = { ...(d as Record<string, unknown>) };
        for (const [k, v] of Object.entries(fields)) {
          if (typeof v === 'object' && v && '$meta' in v) {
            out[k] = (d as Record<string, unknown>)[k] ?? 0;
          } else {
            out[k] = v;
          }
        }
        return out;
      });
    } else if ('$graphLookup' in stage) {
      const params = stage.$graphLookup as { as: string };
      current = current.map((d) => ({ ...(d as Record<string, unknown>), [params.as]: [] }));
    } else if ('$vectorSearch' in stage) {
      // Minimal functional stand-in for Atlas $vectorSearch: apply the filter,
      // extract the embedding at `path`, score cosine vs `queryVector`, top K.
      // `vectorSearchScore` is stashed under the same field name `$addFields`
      // will look for via `$meta`.
      const params = stage.$vectorSearch as {
        path: string;
        queryVector: number[];
        filter?: MongoFilter;
        limit?: number;
      };
      let filtered = current;
      if (params.filter) {
        filtered = filtered.filter((d) => matches(d, params.filter!));
      }
      const scored: Array<{ doc: Record<string, unknown>; score: number }> = [];
      for (const d of filtered) {
        const vec = getField(d, params.path);
        if (!Array.isArray(vec)) continue;
        if (vec.length !== params.queryVector.length) continue;
        const score = cosineVec(vec as number[], params.queryVector);
        scored.push({ doc: d as Record<string, unknown>, score });
      }
      scored.sort((a, b) => b.score - a.score);
      const limit = params.limit ?? scored.length;
      current = scored.slice(0, limit).map((s) => ({ ...s.doc, score: s.score }));
    }
  }
  return current;
}

function cosineVec(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function clone<T>(x: T): T {
  return structuredClone(x);
}
