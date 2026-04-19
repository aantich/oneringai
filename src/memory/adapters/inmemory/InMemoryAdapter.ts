/**
 * InMemoryAdapter — zero-dependency default implementation of IMemoryStore.
 *
 * Used for tests and small-scale deployments. Implements the full capability
 * surface including traverse (optional) and semanticSearch (optional, brute-force
 * cosine). External adapters (Mongo, Neo4j, NeDB) live outside this folder.
 *
 * Scope filtering, archived hiding, asOf temporal filtering, and optimistic
 * concurrency are all enforced inline on every read/write path.
 */

import type {
  EntityId,
  EntityListFilter,
  EntitySearchOptions,
  FactFilter,
  FactId,
  FactQueryOptions,
  FactOrderBy,
  IEntity,
  IFact,
  IMemoryStore,
  Identifier,
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

export interface InMemoryAdapterOptions {
  /** Seed data for tests. */
  entities?: IEntity[];
  facts?: IFact[];
}

export class InMemoryAdapter implements IMemoryStore {
  private readonly entitiesById = new Map<EntityId, IEntity>();
  private readonly entitiesByIdent = new Map<string, Set<EntityId>>();
  private readonly factsById = new Map<FactId, IFact>();
  private readonly factsBySubject = new Map<EntityId, Set<FactId>>();
  private readonly factsByObject = new Map<EntityId, Set<FactId>>();
  private readonly factsByContext = new Map<EntityId, Set<FactId>>();
  private destroyed = false;

  constructor(opts: InMemoryAdapterOptions = {}) {
    if (opts.entities) {
      for (const e of opts.entities) this.indexEntity(e);
    }
    if (opts.facts) {
      for (const f of opts.facts) this.indexFact(f);
    }
  }

  // ==========================================================================
  // Entities
  // ==========================================================================

  async createEntity(input: NewEntity): Promise<IEntity> {
    this.assertLive();
    const now = new Date();
    const entity: IEntity = {
      ...input,
      id: newId(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.indexEntity(entity);
    return clone(entity);
  }

  async createEntities(inputs: NewEntity[]): Promise<IEntity[]> {
    const out: IEntity[] = [];
    for (const input of inputs) out.push(await this.createEntity(input));
    return out;
  }

  async updateEntity(entity: IEntity): Promise<void> {
    this.assertLive();
    const existing = this.entitiesById.get(entity.id);
    if (!existing) {
      throw new OptimisticConcurrencyError(
        `Entity ${entity.id}: cannot update non-existent entity`,
      );
    }
    if (entity.version !== existing.version + 1) {
      throw new OptimisticConcurrencyError(
        `Entity ${entity.id}: expected version ${existing.version + 1}, got ${entity.version}`,
      );
    }
    this.unindexEntityIdentifiers(existing);
    this.indexEntity(entity);
  }

  async getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null> {
    this.assertLive();
    const e = this.entitiesById.get(id);
    if (!e) return null;
    if (e.archived) return null;
    if (!isVisible(e, scope)) return null;
    return clone(e);
  }

  async findEntitiesByIdentifier(
    kind: string,
    value: string,
    scope: ScopeFilter,
  ): Promise<IEntity[]> {
    this.assertLive();
    const results: IEntity[] = [];
    const normalized = value.toLowerCase();
    // Secondary index lookup — we key by kind:value only (scope filtered post-lookup).
    const ids = this.entitiesByIdent.get(identKey(kind, normalized));
    if (!ids) return results;
    for (const id of ids) {
      const e = this.entitiesById.get(id);
      if (!e || e.archived) continue;
      if (!isVisible(e, scope)) continue;
      results.push(clone(e));
    }
    return results;
  }

  async searchEntities(
    query: string,
    opts: EntitySearchOptions,
    scope: ScopeFilter,
  ): Promise<Page<IEntity>> {
    this.assertLive();
    const q = query.toLowerCase().trim();
    const types = opts.types && opts.types.length > 0 ? new Set(opts.types) : null;
    const scored: Array<{ entity: IEntity; score: number }> = [];
    for (const e of this.entitiesById.values()) {
      if (e.archived) continue;
      if (!isVisible(e, scope)) continue;
      if (types && !types.has(e.type)) continue;
      if (q.length === 0) {
        scored.push({ entity: e, score: 0 });
        continue;
      }
      const score = entityRelevance(e, q);
      if (score > 0) scored.push({ entity: e, score });
    }
    // Stable rank by score desc; tiebreak by displayName alphabetical for determinism.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entity.displayName.localeCompare(b.entity.displayName);
    });
    return paginate(scored.map((s) => clone(s.entity)), opts.limit, opts.cursor);
  }

  async listEntities(
    filter: EntityListFilter,
    opts: ListOptions,
    scope: ScopeFilter,
  ): Promise<Page<IEntity>> {
    this.assertLive();
    const idSet = filter.ids && filter.ids.length > 0 ? new Set(filter.ids) : null;
    const wantArchived = filter.archived === true;
    const results: IEntity[] = [];
    for (const e of this.entitiesById.values()) {
      if (idSet && !idSet.has(e.id)) continue;
      const isArchived = !!e.archived;
      if (wantArchived !== isArchived) continue;
      if (filter.type && e.type !== filter.type) continue;
      if (!isVisible(e, scope)) continue;
      if (filter.metadataFilter && !matchesMetadataFilter(e.metadata, filter.metadataFilter)) continue;
      results.push(e);
    }
    return paginate(results.map(clone), opts.limit, opts.cursor);
  }

  async archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    this.assertLive();
    const e = this.entitiesById.get(id);
    if (!e) return;
    if (!isVisible(e, scope)) {
      throw new ScopeViolationError(`Entity ${id} not visible in scope`);
    }
    if (e.archived) return;
    const next: IEntity = {
      ...e,
      archived: true,
      version: e.version + 1,
      updatedAt: new Date(),
    };
    this.indexEntity(next);
  }

  async deleteEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    this.assertLive();
    const e = this.entitiesById.get(id);
    if (!e) return;
    if (!isVisible(e, scope)) {
      throw new ScopeViolationError(`Entity ${id} not visible in scope`);
    }
    this.unindexEntityIdentifiers(e);
    this.entitiesById.delete(id);
  }

  // ==========================================================================
  // Facts
  // ==========================================================================

  async createFact(input: NewFact): Promise<IFact> {
    this.assertLive();
    const fact: IFact = {
      ...input,
      id: newId(),
      createdAt: new Date(),
    };
    this.indexFact(fact);
    return clone(fact);
  }

  async createFacts(inputs: NewFact[]): Promise<IFact[]> {
    const out: IFact[] = [];
    for (const input of inputs) out.push(await this.createFact(input));
    return out;
  }

  async getFact(id: FactId, scope: ScopeFilter): Promise<IFact | null> {
    this.assertLive();
    const f = this.factsById.get(id);
    if (!f) return null;
    if (!isVisible(f, scope)) return null;
    return clone(f);
  }

  async findFacts(
    filter: FactFilter,
    opts: FactQueryOptions,
    scope: ScopeFilter,
  ): Promise<Page<IFact>> {
    this.assertLive();
    const candidates = this.selectCandidateFacts(filter);
    const filtered: IFact[] = [];
    for (const f of candidates) {
      if (!factMatches(f, filter, scope)) continue;
      filtered.push(f);
    }
    sortFacts(filtered, opts.orderBy);
    return paginate(filtered.map(clone), opts.limit, opts.cursor);
  }

  async updateFact(id: FactId, patch: Partial<IFact>, scope: ScopeFilter): Promise<void> {
    this.assertLive();
    const f = this.factsById.get(id);
    if (!f) return;
    if (!isVisible(f, scope)) {
      throw new ScopeViolationError(`Fact ${id} not visible in scope`);
    }
    const next: IFact = { ...f, ...patch, id: f.id };
    this.unindexFact(f);
    this.indexFact(next);
  }

  async countFacts(filter: FactFilter, scope: ScopeFilter): Promise<number> {
    this.assertLive();
    const candidates = this.selectCandidateFacts(filter);
    let n = 0;
    for (const f of candidates) {
      if (factMatches(f, filter, scope)) n++;
    }
    return n;
  }

  // ==========================================================================
  // Graph (uses generic traversal)
  // ==========================================================================

  async traverse(
    startId: EntityId,
    opts: TraversalOptions,
    scope: ScopeFilter,
  ): Promise<Neighborhood> {
    this.assertLive();
    return genericTraverse(this, startId, opts, scope);
  }

  // ==========================================================================
  // Vector (brute-force cosine)
  // ==========================================================================

  async semanticSearch(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>> {
    this.assertLive();
    const scored: Array<{ fact: IFact; score: number }> = [];
    const candidates = this.selectCandidateFacts(filter);
    for (const f of candidates) {
      if (!f.embedding || f.embedding.length !== queryVector.length) continue;
      if (!factMatches(f, filter, scope)) continue;
      const score = cosine(queryVector, f.embedding);
      scored.push({ fact: clone(f), score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.topK);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  destroy(): void {
    this.destroyed = true;
    this.entitiesById.clear();
    this.entitiesByIdent.clear();
    this.factsById.clear();
    this.factsBySubject.clear();
    this.factsByObject.clear();
    this.factsByContext.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private assertLive(): void {
    if (this.destroyed) throw new Error('InMemoryAdapter: instance has been destroyed');
  }

  private indexEntity(entity: IEntity): void {
    this.entitiesById.set(entity.id, clone(entity));
    for (const ident of entity.identifiers) {
      const key = identKey(ident.kind, ident.value.toLowerCase());
      let set = this.entitiesByIdent.get(key);
      if (!set) {
        set = new Set();
        this.entitiesByIdent.set(key, set);
      }
      set.add(entity.id);
    }
  }

  private unindexEntityIdentifiers(entity: IEntity): void {
    for (const ident of entity.identifiers) {
      const key = identKey(ident.kind, ident.value.toLowerCase());
      const set = this.entitiesByIdent.get(key);
      if (!set) continue;
      set.delete(entity.id);
      if (set.size === 0) this.entitiesByIdent.delete(key);
    }
  }

  private indexFact(fact: IFact): void {
    this.factsById.set(fact.id, clone(fact));
    addToSetMap(this.factsBySubject, fact.subjectId, fact.id);
    if (fact.objectId) {
      addToSetMap(this.factsByObject, fact.objectId, fact.id);
    }
    if (fact.contextIds) {
      for (const cid of fact.contextIds) {
        addToSetMap(this.factsByContext, cid, fact.id);
      }
    }
  }

  private unindexFact(fact: IFact): void {
    this.factsById.delete(fact.id);
    removeFromSetMap(this.factsBySubject, fact.subjectId, fact.id);
    if (fact.objectId) {
      removeFromSetMap(this.factsByObject, fact.objectId, fact.id);
    }
    if (fact.contextIds) {
      for (const cid of fact.contextIds) {
        removeFromSetMap(this.factsByContext, cid, fact.id);
      }
    }
  }

  /**
   * Narrow the candidate pool using the best available secondary index.
   * Caller still applies full filter via factMatches().
   */
  private selectCandidateFacts(filter: FactFilter): Iterable<IFact> {
    // touchesEntity: union of subject, object, and context index lookups.
    if (filter.touchesEntity) {
      const eid = filter.touchesEntity;
      const ids = new Set<FactId>();
      this.factsBySubject.get(eid)?.forEach((id) => ids.add(id));
      this.factsByObject.get(eid)?.forEach((id) => ids.add(id));
      this.factsByContext.get(eid)?.forEach((id) => ids.add(id));
      return mapLookup(this.factsById, ids);
    }
    if (filter.subjectId) {
      const ids = this.factsBySubject.get(filter.subjectId);
      if (!ids) return [];
      return mapLookup(this.factsById, ids);
    }
    if (filter.objectId) {
      const ids = this.factsByObject.get(filter.objectId);
      if (!ids) return [];
      return mapLookup(this.factsById, ids);
    }
    if (filter.contextId) {
      const ids = this.factsByContext.get(filter.contextId);
      if (!ids) return [];
      return mapLookup(this.factsById, ids);
    }
    return this.factsById.values();
  }
}

// =============================================================================
// Errors
// =============================================================================

export class OptimisticConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticConcurrencyError';
  }
}

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

// =============================================================================
// Helpers
// =============================================================================

function identKey(kind: string, value: string): string {
  return `${kind}:${value}`;
}

function isVisible(record: { groupId?: string; ownerId?: string }, scope: ScopeFilter): boolean {
  if (record.groupId && record.groupId !== scope.groupId) return false;
  if (record.ownerId && record.ownerId !== scope.userId) return false;
  return true;
}

/**
 * Relevance score for searchEntities ranking. Higher = better match.
 *   4 — displayName equals query (case-insensitive)
 *   3 — alias equals query
 *   2 — displayName contains query
 *   1 — alias contains query
 *   1 — identifier value contains query
 *   0 — no match
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

function factMatches(fact: IFact, filter: FactFilter, scope: ScopeFilter): boolean {
  if (!isVisible(fact, scope)) return false;

  const archivedWanted = filter.archived === true;
  if (!!fact.archived !== archivedWanted && filter.archived !== undefined) return false;
  if (filter.archived === undefined && fact.archived) return false;

  if (filter.subjectId && fact.subjectId !== filter.subjectId) return false;
  if (filter.objectId && fact.objectId !== filter.objectId) return false;
  if (filter.contextId !== undefined) {
    if (!fact.contextIds || !fact.contextIds.includes(filter.contextId)) return false;
  }
  if (filter.touchesEntity !== undefined) {
    const e = filter.touchesEntity;
    const hit =
      fact.subjectId === e ||
      fact.objectId === e ||
      (fact.contextIds ? fact.contextIds.includes(e) : false);
    if (!hit) return false;
  }
  if (filter.predicate && fact.predicate !== filter.predicate) return false;
  if (filter.predicates && filter.predicates.length > 0 && !filter.predicates.includes(fact.predicate)) {
    return false;
  }
  if (filter.kind && fact.kind !== filter.kind) return false;
  if (filter.minConfidence !== undefined && (fact.confidence ?? 1) < filter.minConfidence) return false;

  const observedAt = fact.observedAt ?? fact.createdAt;
  if (filter.observedAfter && observedAt < filter.observedAfter) return false;
  if (filter.observedBefore && observedAt > filter.observedBefore) return false;

  if (filter.asOf) {
    if (fact.createdAt > filter.asOf) return false;
    if (fact.validFrom && fact.validFrom > filter.asOf) return false;
    if (fact.validUntil && fact.validUntil < filter.asOf) return false;
  }

  return true;
}

function sortFacts(facts: IFact[], orderBy?: FactOrderBy): void {
  if (!orderBy) return;
  const dir = orderBy.direction === 'asc' ? 1 : -1;
  facts.sort((a, b) => {
    let av: number;
    let bv: number;
    if (orderBy.field === 'confidence') {
      av = a.confidence ?? 0;
      bv = b.confidence ?? 0;
    } else if (orderBy.field === 'observedAt') {
      av = (a.observedAt ?? a.createdAt).getTime();
      bv = (b.observedAt ?? b.createdAt).getTime();
    } else {
      av = a.createdAt.getTime();
      bv = b.createdAt.getTime();
    }
    return (av - bv) * dir;
  });
}

function paginate<T>(items: T[], limit?: number, cursor?: string): Page<T> {
  const offset = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const end = limit ? offset + limit : items.length;
  const slice = items.slice(offset, end);
  const nextCursor = end < items.length ? String(end) : undefined;
  return { items: slice, nextCursor };
}

function addToSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function removeFromSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}

function* mapLookup<K, V>(map: Map<K, V>, keys: Iterable<K>): Iterable<V> {
  for (const k of keys) {
    const v = map.get(k);
    if (v !== undefined) yield v;
  }
}

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

function clone<T>(x: T): T {
  return structuredClone(x);
}

/** Generate a fresh id for a new record. Uses crypto.randomUUID() — plain UUID, no prefix. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  // Fallback for environments without crypto.randomUUID — unlikely on Node 18+.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Equality match on entity.metadata fields. Supports literal values and
 * the `{ $in: [...] }` operator. All conditions must match (AND semantics).
 */
function matchesMetadataFilter(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return Object.keys(filter).length === 0;
  for (const [key, expected] of Object.entries(filter)) {
    const actual = metadata[key];
    if (expected && typeof expected === 'object' && '$in' in expected) {
      const list = (expected as { $in: unknown[] }).$in;
      if (!list.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

// Keep Identifier type live-referenced to avoid accidental import pruning in tooling.
export type { Identifier };
