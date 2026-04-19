/**
 * Memory layer — core types and interfaces (v2).
 *
 * The memory layer is self-contained. It depends only on IDisposable from domain/interfaces.
 * Everything else (LLM, persistence, embedding) is injected by the caller.
 *
 * ---------------------------------------------------------------------------
 * Well-known entity type conventions
 * ---------------------------------------------------------------------------
 *
 * `IEntity.type` is an open string, but these conventional types carry
 * recognized metadata fields that retrieval + profile generation know about.
 * Tools and LLM prompts should prefer these names when applicable:
 *
 *   'person'        — identifiers: email / slack_id / phone / github
 *   'organization'  — identifiers: domain / legal_name / ticker / duns
 *   'project'       — metadata: { status, stakeholderIds }
 *   'task'          — metadata: { state, dueAt, priority, assigneeId,
 *                                  reporterId, projectId, completedAt }
 *   'event'         — metadata: { startTime, endTime, location, kind, attendeeIds }
 *   'topic'         — free-form topical anchor
 *   'cluster'       — metadata: { anchorEntityIds, firstSeen, lastSeen }
 *
 * Tasks and events are entities (not facts). Their state, due dates, and
 * attendees are a mix of entity.metadata (for fast query) and relationship
 * facts (for history + provenance). See `getContext` which auto-surfaces
 * `relatedTasks` and `relatedEvents` for any subject entity.
 */

import type { IDisposable } from '../domain/interfaces/IDisposable.js';

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * Visibility scope on an entity or fact.
 *
 * - (none, none)       → global (visible to all)
 * - (groupId, none)    → group-wide
 * - (none, ownerId)    → user-private across all groups
 * - (groupId, ownerId) → user-private within a specific group
 */
export interface ScopeFields {
  groupId?: string;
  ownerId?: string;
}

/**
 * Caller's scope context. A record is visible iff:
 *   (!record.groupId || record.groupId === filter.groupId)
 *   AND
 *   (!record.ownerId || record.ownerId === filter.userId)
 */
export interface ScopeFilter {
  groupId?: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type EntityId = string;

/**
 * A strong, uniqueness-bearing identifier for an entity.
 * Aliases (on IEntity) are display hints — NOT identifiers.
 */
export interface Identifier {
  /** e.g. 'email' | 'slack_id' | 'phone' | 'domain' | 'github' | 'legal_name' | 'ticker' | 'duns' */
  kind: string;
  value: string;
  isPrimary?: boolean;
  verified?: boolean;
  /** Which signal/source added this identifier. */
  source?: string;
  addedAt?: Date;
}

export interface IEntity extends ScopeFields {
  id: EntityId;
  /** Open string. See well-known conventions in file header. */
  type: string;
  displayName: string;
  aliases?: string[];
  identifiers: Identifier[];
  /**
   * Type-specific fields. See file header for conventional fields per type
   * (tasks carry state/dueAt/assigneeId, events carry startTime/attendeeIds, etc.).
   * Free-form — adapters support equality filtering via EntityListFilter.metadataFilter.
   */
  metadata?: Record<string, unknown>;
  archived?: boolean;
  /**
   * Lightweight embedding over `displayName + top aliases + primary identifier
   * values`, used by EntityResolver for semantic fallback when string matching
   * fails. Populated async by the embedding queue when enabled.
   */
  identityEmbedding?: number[];
  /** Optimistic concurrency token — incremented on every write. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export type FactId = string;

/**
 * - 'atomic'   → short triple: (subject, predicate, objectId | value), optional short `details`.
 * - 'document' → long-form narrative in `details` (profiles, memos, notes, bios).
 */
export type FactKind = 'atomic' | 'document';

export interface IFact extends ScopeFields {
  id: FactId;
  subjectId: EntityId;
  predicate: string;
  kind: FactKind;

  // Payload — atomic uses objectId XOR value; document uses details.
  objectId?: EntityId;
  value?: unknown;
  details?: string;

  // Retrieval
  /** Short gist used as the embedding input for document facts. */
  summaryForEmbedding?: string;
  embedding?: number[];
  /** Computed at write-time. Gates embedding eligibility. */
  isSemantic?: boolean;

  // Quality + provenance
  confidence?: number;
  /**
   * Opaque identifier of the signal/source this fact was derived from.
   * Memory layer makes no assumptions about the id's format — library users
   * own the signal store. Each observation is one fact with one source;
   * reinforcement creates a new (possibly superseding) fact.
   */
  sourceSignalId?: string;
  /** Rule id if the fact was inferred by the rule engine. */
  derivedBy?: string;

  // Salience
  /**
   * 0..1 importance. Drives ranking (multiplies recency × confidence × predicateWeight)
   * and controls effective decay (more-important facts decay slower).
   * Default 0.5. Identity-level facts → 1.0. Trivial observations → 0.1.
   */
  importance?: number;

  // Multi-entity binding
  /**
   * Additional entities this fact is "about" beyond subject/object.
   * Example: (John, assigned_task, PowerPoint) with contextIds=[AcmeDeal]
   * lets the deal view surface this action without the deal being subject
   * or object. `getContext` queries subject OR object OR contextIds.
   */
  contextIds?: EntityId[];

  // Lifecycle
  supersedes?: FactId;
  archived?: boolean;
  /** Numeric aggregates update in place; never supersede. */
  isAggregate?: boolean;

  // Temporal
  observedAt?: Date;
  validFrom?: Date;
  validUntil?: Date;

  metadata?: Record<string, unknown>;

  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Retrieval shapes
// ---------------------------------------------------------------------------

export interface RelatedTask {
  task: IEntity;
  /** Relationship that links this task to the subject entity
   *  (e.g. 'assigned_to', 'reporter_of', 'project_of', 'context_of'). */
  role: string;
}

export interface RelatedEvent {
  event: IEntity;
  role: string;
  /** Start time pulled from event.metadata, if present. */
  when?: Date;
}

export interface EntityView {
  entity: IEntity;
  /** Most-specific visible document fact with predicate='profile', or null if none. */
  profile: IFact | null;
  /**
   * Atomic facts where the subject is the target entity OR the target appears
   * as object OR in contextIds, ranked by confidence × recency × predicateWeight
   * × importance. Duplicates dropped.
   */
  topFacts: IFact[];
  /** Tasks linked to this entity via metadata or fact relationships. Non-terminal state by default. */
  relatedTasks?: RelatedTask[];
  /** Events linked to this entity (attendance, subject/object, context). Recent by default. */
  relatedEvents?: RelatedEvent[];
  documents?: IFact[];
  semantic?: Array<{ fact: IFact; score: number }>;
  neighbors?: Neighborhood;
}

/** Tiers that callers can explicitly include; relatedTasks + relatedEvents are
 * included BY DEFAULT unless the caller passes { tiers: 'minimal' }. */
export type ContextTier = 'documents' | 'semantic' | 'neighbors';

export interface ContextOptions {
  topFactsLimit?: number;
  /**
   * Opt-in tiers. Tasks + events are on by default; semantic/neighbors/documents
   * are opt-in. Pass `tiers: 'minimal'` to suppress tasks + events for perf.
   */
  include?: ContextTier[];
  /** 'full' (default): include relatedTasks + relatedEvents automatically.
   *  'minimal': skip those tiers. */
  tiers?: 'full' | 'minimal';
  documentPredicates?: string[];
  semanticQuery?: string;
  semanticTopK?: number;
  neighborPredicates?: string[];
  neighborDepth?: number;
  asOf?: Date;
  /** Limits on the task/event tiers. Defaults: 15 each. */
  relatedTasksLimit?: number;
  relatedEventsLimit?: number;
  /** How far back to look for "recent" events. Default 90 days. */
  recentEventsWindowDays?: number;
}

export interface Neighborhood {
  nodes: Array<{ entity: IEntity; depth: number }>;
  edges: Array<{ fact: IFact; from: EntityId; to: EntityId; depth: number }>;
}

export interface TraversalOptions {
  predicates?: string[];
  direction: 'out' | 'in' | 'both';
  /** Required hard bound — no unbounded traversals. */
  maxDepth: number;
  limit?: number;
  asOf?: Date;
}

export interface UpsertEntityResult {
  entity: IEntity;
  created: boolean;
  /** How many new identifiers were added to an existing entity. */
  mergedIdentifiers: number;
  /** Other entities that matched by some identifiers but were not chosen. */
  mergeCandidates: EntityId[];
}

export interface FactFilter {
  subjectId?: EntityId;
  objectId?: EntityId;
  /** Matches facts where `contextIds` array includes this entity id. */
  contextId?: EntityId;
  /**
   * OR-wildcard entity match — returns facts where this id appears as
   * subject, object, OR in contextIds. Used by `getContext` for the
   * "everything about X" query.
   */
  touchesEntity?: EntityId;
  predicate?: string;
  predicates?: string[];
  kind?: FactKind;
  /** Defaults to false (archived rows hidden). Pass true to include only archived, or undefined for default. */
  archived?: boolean;
  minConfidence?: number;
  observedAfter?: Date;
  observedBefore?: Date;
  /** Temporal filter: validFrom ≤ asOf ≤ (validUntil ?? ∞) AND createdAt ≤ asOf. */
  asOf?: Date;
}

export interface FactOrderBy {
  field: 'observedAt' | 'createdAt' | 'confidence';
  direction: 'asc' | 'desc';
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Store contract (pluggable backend)
// ---------------------------------------------------------------------------

export interface EntityListFilter {
  type?: string;
  ids?: EntityId[];
  archived?: boolean;
  /**
   * Equality filter on entity.metadata fields. Adapters support literal values
   * AND the one operator `{ $in: [...] }`. Example:
   *   { assigneeId: 'user_123', state: { $in: ['pending', 'in_progress'] } }
   */
  metadataFilter?: Record<string, unknown>;
}

export interface EntitySearchOptions {
  types?: string[];
  limit?: number;
  cursor?: string;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
}

export interface FactQueryOptions {
  orderBy?: FactOrderBy;
  limit?: number;
  cursor?: string;
}

export interface SemanticSearchOptions {
  topK: number;
}

/**
 * Input type for creating a new entity. `id`, `version`, `createdAt`, and
 * `updatedAt` are assigned by the storage layer (adapter) — callers never
 * set them.
 */
export type NewEntity = Omit<IEntity, 'id' | 'version' | 'createdAt' | 'updatedAt'>;

/**
 * Input type for creating a new fact. `id` and `createdAt` are assigned by
 * the storage layer.
 */
export type NewFact = Omit<IFact, 'id' | 'createdAt'>;

/**
 * Storage contract. Required methods are the minimum capability; optional
 * methods (`traverse`, `semanticSearch`) are discovered by duck-typing.
 *
 * **Id generation:** adapters own id assignment. `createEntity` / `createFact`
 * return a fully-formed record with its id populated. Callers never pass ids
 * for new records.
 *
 * **Adapter responsibilities:**
 *  - Apply `ScopeFilter` to every read — MemorySystem also filters, but the
 *    adapter must provide defence-in-depth.
 *  - Assign primary ids on create. Native mechanisms preferred (Mongo ObjectId,
 *    Meteor Random.id(), UUID for in-memory).
 *  - Enforce optimistic concurrency on `updateEntity`: reject if incoming
 *    `version !== stored.version + 1`.
 *  - Hide archived records by default; return them only when an explicit
 *    `archived: true` filter is passed.
 *  - Support `asOf` on fact queries (`validFrom ≤ asOf ≤ validUntil ?? ∞`
 *    AND `createdAt ≤ asOf`).
 *  - When possible, expose a transactional primitive for supersession —
 *    MemorySystem currently writes the new fact before archiving the
 *    predecessor (crash-safe ordering) but adapters with native transactions
 *    may promote this to a single atomic operation.
 */
export interface IMemoryStore {
  // ----- Entities (required) -----
  /** Insert a new entity. Adapter assigns id + version (1) + timestamps. Returns the created record. */
  createEntity(input: NewEntity): Promise<IEntity>;
  /** Batch insert. Returned array is in the same order as input. */
  createEntities(inputs: NewEntity[]): Promise<IEntity[]>;
  /** Update an existing entity. Incoming version must equal stored.version + 1. */
  updateEntity(entity: IEntity): Promise<void>;
  getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null>;
  findEntitiesByIdentifier(kind: string, value: string, scope: ScopeFilter): Promise<IEntity[]>;
  searchEntities(query: string, opts: EntitySearchOptions, scope: ScopeFilter): Promise<Page<IEntity>>;
  listEntities(filter: EntityListFilter, opts: ListOptions, scope: ScopeFilter): Promise<Page<IEntity>>;
  archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void>;
  /** Hard delete — MemorySystem gates this with an explicit flag. */
  deleteEntity(id: EntityId, scope: ScopeFilter): Promise<void>;

  // ----- Facts (required) -----
  /** Insert a new fact. Adapter assigns id + createdAt. Returns the created record. */
  createFact(input: NewFact): Promise<IFact>;
  /** Batch insert. Returned array is in the same order as input. */
  createFacts(inputs: NewFact[]): Promise<IFact[]>;
  getFact(id: FactId, scope: ScopeFilter): Promise<IFact | null>;
  findFacts(filter: FactFilter, opts: FactQueryOptions, scope: ScopeFilter): Promise<Page<IFact>>;
  /** Patch fields on an existing fact. Used for archiving + embedding writes. */
  updateFact(id: FactId, patch: Partial<IFact>, scope: ScopeFilter): Promise<void>;
  countFacts(filter: FactFilter, scope: ScopeFilter): Promise<number>;

  // ----- Graph (optional capability) -----
  traverse?(startId: EntityId, opts: TraversalOptions, scope: ScopeFilter): Promise<Neighborhood>;

  // ----- Vector (optional capability) -----
  semanticSearch?(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>>;

  // ----- Lifecycle -----
  destroy(): void;
  shutdown?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Extension points
// ---------------------------------------------------------------------------

export interface IEmbedder {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface IProfileGenerator {
  generate(
    entity: IEntity,
    atomicFacts: IFact[],
    priorProfile: IFact | undefined,
    targetScope: ScopeFields,
  ): Promise<{ details: string; summaryForEmbedding: string }>;
}

/**
 * Read-only view scoped to a specific caller, passed to the rule engine.
 * Rules CANNOT write through this view — they return partial IFact specs
 * that MemorySystem validates and persists.
 */
export interface IScopedMemoryView {
  getEntity(id: EntityId): Promise<IEntity | null>;
  findFacts(filter: FactFilter, opts?: { limit?: number }): Promise<IFact[]>;
}

export interface IRuleEngine {
  deriveFor(
    entityId: EntityId,
    view: IScopedMemoryView,
    scope: ScopeFilter,
  ): Promise<Array<Partial<IFact>>>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ChangeEvent =
  | { type: 'entity.upsert'; entity: IEntity; created: boolean }
  | { type: 'entity.archive'; entityId: EntityId }
  | { type: 'entity.merge'; winnerId: EntityId; loserId: EntityId }
  | { type: 'fact.add'; fact: IFact }
  | { type: 'fact.archive'; factId: FactId }
  | { type: 'fact.supersede'; oldId: FactId; newId: FactId }
  | { type: 'profile.regenerate'; entityId: EntityId; scope: ScopeFields; factId: FactId };

// ---------------------------------------------------------------------------
// Ranking config
// ---------------------------------------------------------------------------

export interface RankingConfig {
  predicateWeights?: Record<string, number>;
  recencyHalfLifeDays?: number;
  minConfidence?: number;
}

// ---------------------------------------------------------------------------
// MemorySystem config
// ---------------------------------------------------------------------------

export interface EmbeddingQueueConfig {
  concurrency?: number;
  retries?: number;
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

export interface EntityCandidate {
  entity: IEntity;
  /** 0..1 — 1.0 is an identifier-exact match; decreases through fuzzy/semantic. */
  confidence: number;
  matchedOn: 'identifier' | 'displayName' | 'alias' | 'fuzzy' | 'embedding';
}

export interface ResolveEntityQuery {
  /** The raw text the LLM extracted — e.g. "Microsoft", "Q3 Planning", "John". */
  surface: string;
  /** Hint — 'person', 'organization', 'task', 'event', etc. */
  type?: string;
  /** Strong identifiers parsed from the signal, if any. */
  identifiers?: Identifier[];
  /**
   * Other entities already resolved in the same extraction — used to
   * disambiguate among multiple fuzzy candidates by shared context.
   */
  contextEntityIds?: EntityId[];
}

export interface ResolveEntityOptions {
  limit?: number;
  /** Minimum confidence for a candidate to be returned. Default: 0.5. */
  threshold?: number;
}

export interface UpsertBySurfaceInput {
  surface: string;
  type: string;
  identifiers?: Identifier[];
  /** Alternate forms spotted alongside the primary surface (e.g. "MSFT" next to "Microsoft"). */
  aliases?: string[];
  contextEntityIds?: EntityId[];
}

export interface UpsertBySurfaceOptions {
  /**
   * Candidates must clear this confidence to auto-resolve to an existing
   * entity. Conservative default (0.90) — favors fewer false merges at the
   * cost of creating more duplicates that can be merged later.
   */
  autoResolveThreshold?: number;
}

export interface UpsertBySurfaceResult {
  entity: IEntity;
  /** True if we matched an existing entity; false if we created a new one. */
  resolved: boolean;
  /** Other near-matches that didn't win — surfaced for human review / deferred merges. */
  mergeCandidates: EntityCandidate[];
}

export interface EntityResolutionConfig {
  /** Default threshold for auto-resolve in upsertEntityBySurface. Default 0.90 (conservative). */
  autoResolveThreshold?: number;
  /** Minimum normalized Levenshtein ratio for fuzzy match. Default 0.85. */
  minFuzzyRatio?: number;
  /**
   * When true AND an embedder is configured, entities get an identity
   * embedding (over displayName + aliases + primary identifier values) used
   * as a fallback when string matching fails. Default true.
   */
  enableIdentityEmbedding?: boolean;
}

export interface MemorySystemConfig {
  store: IMemoryStore;
  embedder?: IEmbedder;
  profileGenerator?: IProfileGenerator;
  ruleEngine?: IRuleEngine;
  /** Number of new atomic facts since last profile regen that triggers auto-regeneration. */
  profileRegenerationThreshold?: number;
  topFactsRanking?: RankingConfig;
  embeddingQueue?: EmbeddingQueueConfig;
  entityResolution?: EntityResolutionConfig;
  /**
   * Pluggable predicate vocabulary. When present, `addFact` canonicalizes the
   * predicate (camelCase/dash/alias → snake_case), applies `defaultImportance`
   * / `isAggregate` defaults, auto-supersedes prior facts for `singleValued`
   * predicates, and folds registry weights into ranking. Absent = free-form
   * predicate strings (pre-registry behavior).
   *
   * Pass `PredicateRegistry.standard()` for the built-in 51-predicate starter
   * set, `PredicateRegistry.empty()` plus `.registerAll(...)` for a fully
   * custom vocabulary.
   */
  predicates?: import('./predicates/PredicateRegistry.js').PredicateRegistry;
  /**
   * 'strict' rejects any `addFact` whose (canonicalized) predicate is not in
   * the registry. 'permissive' (default) writes unknowns verbatim — they show
   * up in `IngestionResult.newPredicates` for drift monitoring.
   * Throws at construction if set to 'strict' without a registry.
   */
  predicateMode?: 'permissive' | 'strict';
  /**
   * When true (default), `addFact` auto-supersedes the prior visible fact for
   * a `(subject, predicate)` pair when the predicate is marked `singleValued`.
   * Set to false to opt out while still getting canonicalization + defaults.
   */
  predicateAutoSupersede?: boolean;
  onChange?: (event: ChangeEvent) => void;
}

// Re-export IDisposable so consumers can use the same symbol.
export type { IDisposable };
