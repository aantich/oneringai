/**
 * Filter + sort + cursor builders shared across the Mongo adapter's read paths.
 */

import type { FactFilter, FactOrderBy } from '../../types.js';
import { mergeFilters, scopeToFilter } from './scopeFilter.js';
import type { MongoFilter, MongoSort } from './IMongoCollectionLike.js';
import type { ScopeFilter } from '../../types.js';

/**
 * Build a Mongo filter from a FactFilter + ScopeFilter.
 * Pushes archived and asOf into the DB so the app never scans hidden docs.
 */
export function factFilterToMongo(filter: FactFilter, scope: ScopeFilter): MongoFilter {
  const clauses: MongoFilter[] = [scopeToFilter(scope)];

  // Archived handling
  if (filter.archived === true) {
    clauses.push({ archived: true });
  } else if (filter.archived === false) {
    clauses.push({ $or: [{ archived: false }, { archived: { $exists: false } }] });
  } else {
    // Default: hide archived
    clauses.push({ $or: [{ archived: false }, { archived: { $exists: false } }] });
  }

  if (filter.subjectId !== undefined) clauses.push({ subjectId: filter.subjectId });
  if (filter.objectId !== undefined) clauses.push({ objectId: filter.objectId });
  if (filter.contextId !== undefined) clauses.push({ contextIds: filter.contextId });
  if (filter.touchesEntity !== undefined) {
    const e = filter.touchesEntity;
    clauses.push({
      $or: [{ subjectId: e }, { objectId: e }, { contextIds: e }],
    });
  }
  if (filter.predicate !== undefined) clauses.push({ predicate: filter.predicate });
  if (filter.predicates && filter.predicates.length > 0) {
    clauses.push({ predicate: { $in: filter.predicates } });
  }
  if (filter.kind !== undefined) clauses.push({ kind: filter.kind });
  // F1: supersession-chain lookup — find the successor of a specific fact.
  if (filter.supersedes !== undefined) clauses.push({ supersedes: filter.supersedes });
  if (filter.minConfidence !== undefined) {
    // H6: require explicit confidence at/above threshold. MemorySystem.addFact
    // defaults missing confidence to 1.0 at write, so legacy un-scored facts
    // are the only reason `$exists:false` would matter — and including them
    // pollutes high-quality queries with unknown-quality data. Callers who
    // need to include legacy facts can use a dedicated backfill + re-query.
    clauses.push({ confidence: { $gte: filter.minConfidence } });
  }

  // Temporal filters
  if (filter.observedAfter instanceof Date) {
    clauses.push({
      $or: [
        { observedAt: { $gt: filter.observedAfter } },
        // If observedAt missing, fall back to createdAt — MemorySystem sets
        // observedAt on write so this is mainly defensive.
        {
          observedAt: { $exists: false },
          createdAt: { $gt: filter.observedAfter },
        },
      ],
    });
  }
  if (filter.observedBefore instanceof Date) {
    clauses.push({
      $or: [
        { observedAt: { $lt: filter.observedBefore } },
        {
          observedAt: { $exists: false },
          createdAt: { $lt: filter.observedBefore },
        },
      ],
    });
  }
  if (filter.asOf instanceof Date) {
    clauses.push({
      createdAt: { $lte: filter.asOf },
    });
    clauses.push({
      $or: [{ validFrom: { $exists: false } }, { validFrom: { $lte: filter.asOf } }],
    });
    clauses.push({
      $or: [{ validUntil: { $exists: false } }, { validUntil: { $gte: filter.asOf } }],
    });
  }

  return mergeFilters(...clauses);
}

export function orderByToSort(orderBy?: FactOrderBy): MongoSort | undefined {
  if (!orderBy) return undefined;
  const dir = orderBy.direction === 'asc' ? 1 : -1;
  const field =
    orderBy.field === 'observedAt'
      ? 'observedAt'
      : orderBy.field === 'confidence'
        ? 'confidence'
        : 'createdAt';
  return { [field]: dir };
}

/** Encode/decode a simple numeric offset cursor. */
export function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function formatCursor(offset: number, pageSize: number, totalReturned: number): string | undefined {
  return totalReturned === pageSize ? String(offset + pageSize) : undefined;
}
