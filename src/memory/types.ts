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
 *
 *   'canonical'     — library-blessed identifier kind for deterministic
 *                     convergence on entities that lack a natural external
 *                     strong key (tasks, events, topics). See
 *                     `canonicalIdentifier()` in `src/memory/identifiers.ts`.
 *                     Example: `{ kind: 'canonical', value: 'task:alice:acme:send-budget' }`
 *   'project'       — metadata: { status, stakeholderIds }
 *   'task'          — metadata: { state, dueAt, priority, assigneeId,
 *                                  reporterId, projectId, completedAt }
 *                     contextIds: [projectIds, dealIds, meetingIds, …]
 *   'event'         — metadata: { startTime, endTime, location, kind, attendeeIds }
 *                     contextIds: [projectIds, dealIds, topicIds, …]
 *   'topic'         — free-form topical anchor
 *                     contextIds: [projectIds, parentTopicIds, …]
 *   'cluster'       — metadata: { anchorEntityIds, firstSeen, lastSeen }
 *
 * Tasks and events are entities (not facts). Their state, due dates, and
 * attendees are a mix of entity.metadata (for fast query) and relationship
 * facts (for history + provenance). See `getContext` which auto-surfaces
 * `relatedTasks` and `relatedEvents` for any subject entity.
 *
 * `contextIds` on entities is the multi-valued "lives within" edge — analogous
 * to (but distinct from) `IFact.contextIds`. A task with `contextIds: [proj,
 * deal]` surfaces on getContext queries for either anchor. Surfaces through
 * `EntityListFilter.contextId`, `resolveRelatedTasks` / `resolveRelatedEvents`,
 * and `findSimilarOpenTasks`. Does NOT participate in `traverse` / `neighbors`
 * graph walks (those are fact-edge only — entity contextIds carries no
 * predicate so it has no place in a predicate-keyed walk).
 */

import type { IDisposable } from '../domain/interfaces/IDisposable.js';
import type { Permissions, VisibilityPolicy } from './AccessControl.js';
import type { ACLEntry } from '../access/principals.js';

// Re-export access-control surface so callers only need to import from
// `oneringai` (or the memory barrel) to get the full type set.
export type {
  AccessLevel,
  Permission,
  Permissions,
  AccessControlled,
  VisibilityContext,
  VisibilityPolicy,
} from './AccessControl.js';
export {
  PermissionDeniedError,
  OwnerRequiredError,
  canAccess,
  effectivePermissions,
  assertCanAccess,
  levelGrants,
  DEFAULT_GROUP_LEVEL,
  DEFAULT_WORLD_LEVEL,
} from './AccessControl.js';

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
  /**
   * Caller's principal token set (`user:<id>`, `entity:<id>`, `group:<id>`,
   * `world`, …). Its PRESENCE (not its length) is AUTHORITATIVE: read/write
   * filtering and `canAccess` use the principal model
   * (`readPrincipals`/`writePrincipals` intersect this set) and ignore
   * `userId`/`groupId` for the access decision — those identities are expected
   * to already be encoded as tokens here. An empty array means "principal mode,
   * no grants" → matches/authorizes nothing. When the field is ABSENT, the
   * legacy owner/group/world path runs unchanged (backward compatible for
   * consumers that don't supply principals).
   *
   * MIGRATION: there is NO legacy fallback for principal callers in EITHER
   * path. Query-time, a principal `$in` won't match rows lacking
   * `readPrincipals`; in-process, `canAccess` denies them. So an un-materialized
   * row is invisible to a principal caller everywhere. Every entity/fact row
   * MUST be backfilled (see `MemorySystem.backfillAccessPrincipals`) BEFORE a
   * host starts passing `principals`. See `access/principals.ts`.
   */
  principals?: string[];
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
  /**
   * Indexed normalized form of `displayName` (lowercase, corp-suffix-stripped,
   * punctuation-stripped — see `resolution/fuzzy.ts/normalizeSurface`).
   * Populated automatically by adapters on every create/update from v0.8.0+.
   * Drives `IMemoryStore.findEntitiesByNormalizedName` — the O(1) lookup used
   * by `EntityResolver` Tier 2 and the atomic-upsert path.
   *
   * Optional on the interface because pre-0.8.0 entities don't carry it;
   * `findEntitiesByNormalizedName` skips entities where it is absent (treated
   * as "needs backfill"). Run `MemorySystem.backfillNormalizedFields` to
   * populate.
   */
  normalizedDisplayName?: string;
  /**
   * Indexed normalized form of each entry in `aliases`. Same normalization as
   * `normalizedDisplayName`; empties dropped; deduped (first-seen wins).
   * Populated automatically alongside `normalizedDisplayName`.
   */
  normalizedAliases?: string[];
  identifiers: Identifier[];
  /**
   * Type-specific fields. See file header for conventional fields per type
   * (tasks carry state/dueAt/assigneeId, events carry startTime/attendeeIds, etc.).
   * Free-form — adapters support equality filtering via EntityListFilter.metadataFilter.
   */
  metadata?: Record<string, unknown>;
  /**
   * Multi-valued "lives within" edge — other entities this one is *about* or
   * *contained within*. Mirrors `IFact.contextIds` semantically: a task in
   * `[projectA, dealQ3]` surfaces when querying either anchor.
   *
   * Conventional consumers: `task`, `event`, `topic` (entities that exist
   * within larger contexts). `project`, `organization`, `person`, `document`,
   * `cluster` typically do NOT carry contextIds — they ARE contexts, not
   * in-context things. The type is open: callers may use it for any type.
   *
   * Surfaced via `EntityListFilter.contextId`, the tier-1.5 path in
   * `resolveRelatedTasks` / `resolveRelatedEvents`, and the `opts.contextId`
   * filter on `findSimilarOpenTasks`. NOT participated in by `traverse`
   * (predicate-keyed graph walks).
   *
   * Merge semantics on resolve: **union** — re-extracting the same canonical
   * task with new contextIds adds them to the existing set rather than
   * filling-missing or overwriting. See `MemorySystem.addEntityContextIds`.
   */
  contextIds?: EntityId[];
  archived?: boolean;
  /**
   * Access-control block governing non-owner reads/writes. Undefined → library
   * defaults (`group: 'read'` when `groupId` set, `world: 'read'` always).
   * See `AccessControl.ts` for semantics. Owner always has full access.
   */
  permissions?: Permissions;
  /**
   * Explicit access grants beyond owner/group/world — principal tokens with
   * read/write actions. Unioned with the owner/group/world projection when
   * materializing `readPrincipals`/`writePrincipals`. The seam hosts use to
   * grant participant (`entity:<id>`) or service access. See
   * `access/principals.ts`.
   */
  acl?: ACLEntry[];
  /**
   * Materialized read-principal token set, derived at the storage boundary from
   * `ownerId` + `groupId` + `permissions` + `acl`. Queried via `$in` against
   * the caller's principal set. Library-owned — never set this by hand; it is
   * recomputed on every write. Absent on pre-migration rows (access falls back
   * to the legacy owner/group/world check).
   */
  readPrincipals?: string[];
  /** Materialized write-principal token set (⊆ `readPrincipals`). */
  writePrincipals?: string[];
  /**
   * Lightweight embedding over `displayName + top aliases + primary identifier
   * values`, used by EntityResolver for semantic fallback when string matching
   * fails. Populated async by the embedding queue when enabled.
   */
  identityEmbedding?: number[];
  /**
   * Embedding over the entity's semantic content — produced by a per-type
   * `EntityContentComposer` (see `composers/`). Used by `findSimilarOpenTasks`,
   * `searchDocuments`, and any caller of
   * `semanticSearchEntities({ embeddingField: 'content' })`. Distinct from
   * `identityEmbedding` so semantic matching on content never bleeds into
   * EntityResolver's identity resolution tier.
   *
   * Populated async by the embedding queue on every entity mutation that
   * meaningfully changes the composed text (compared via
   * `contentEmbeddingText`). Entity types without a registered composer never
   * get this populated — they fall back to identity-only matching.
   */
  contentEmbedding?: number[];
  /**
   * Verbatim text that produced `contentEmbedding`. Stored so call sites can
   * cheaply diff "did the composed text change?" without re-running the
   * composer twice (once for the prior, once for the new). Whenever
   * `contentEmbedding` is written, this is written alongside; whenever the
   * composer produces a string identical to this, the embed is skipped.
   *
   * Operators inspecting `why did this entity match the query?` can read the
   * field directly — composers produce deterministic, human-readable text.
   */
  contentEmbeddingText?: string;
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
  /**
   * Caller-supplied short gist. Document facts use it as the embedding input
   * (preferred over `details`); atomic facts use it as an OPTIONAL caller
   * override of the composed text (when set + non-empty, the atomic-fact
   * composer returns it verbatim instead of composing
   * `subject predicate object` from the surface forms).
   *
   * **Caller-owned**: the library never overwrites this field. To track what
   * the embedder actually saw on the last embed, see `embeddingText` below.
   */
  summaryForEmbedding?: string;
  embedding?: number[];
  /**
   * Verbatim text that produced the current `embedding`. Library-owned —
   * the embedding queue writes this alongside the vector on every embed so
   * `queueFactContentEmbeddingIfChanged` can cheaply skip re-embeds when the
   * composed text hasn't changed. Distinct from `summaryForEmbedding`
   * (which is caller-owned and used as an override of the composer).
   *
   * Operators inspecting "why did this fact match my query?" can read this
   * field directly — it's the exact string the embedder consumed.
   */
  embeddingText?: string;
  /** Computed at write-time. Gates embedding eligibility. */
  isSemantic?: boolean;

  // Quality + provenance
  confidence?: number;
  /**
   * Verbatim quote from the source signal that justifies this fact.
   *
   * When `EagernessProfile.requireEvidenceQuote` is `'strict'`, the extraction
   * pipeline rejects facts missing this field — that single rule eliminates
   * the "LLM invented a description" failure mode in restraint-first
   * deployments (ICOS Chief of Staff and similar).
   *
   * Library-side: optional. Existing callers and chatty deployments can
   * write facts without it; downstream consumers that care can read it
   * to render "why this card is here" in UI.
   */
  evidenceQuote?: string;
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
   * Example: (John, committed_to, "Build deck") with contextIds=[AcmeDeal]
   * lets the deal view surface this commitment without the deal being subject
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

  /**
   * Access-control block governing non-owner reads/writes. Undefined → library
   * defaults (`group: 'read'` when `groupId` set, `world: 'read'` always).
   * See `AccessControl.ts` for semantics. Owner always has full access.
   */
  permissions?: Permissions;

  /**
   * Explicit access grants beyond owner/group/world — principal tokens with
   * read/write actions. Unioned into `readPrincipals`/`writePrincipals` at
   * write time. For a fact about shared participants, the host passes e.g.
   * `[{ principal: 'entity:alice', actions: ['read'] }, …]` so every
   * participant can read it (overriding the user-private default). See
   * `access/principals.ts`.
   */
  acl?: ACLEntry[];
  /**
   * Materialized read-principal token set, derived at the storage boundary from
   * `ownerId` + `groupId` + `permissions` + `acl`. Queried via `$in`.
   * Library-owned — recomputed on every write. Absent on pre-migration rows.
   */
  readPrincipals?: string[];
  /** Materialized write-principal token set (⊆ `readPrincipals`). */
  writePrincipals?: string[];

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

/** A related-task / related-event hit augmented with the input entity that produced the match. */
export type RelatedItemHit<T> = T & { matchedEntityId: EntityId };

export interface RelatedItemsResult {
  tasks: RelatedItemHit<RelatedTask>[];
  events: RelatedItemHit<RelatedEvent>[];
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
  /**
   * Match facts whose `sourceSignalId` equals this id — i.e. all facts that
   * were extracted from one specific source signal (an email, a calendar
   * event, a meeting transcript, etc.). The signal id is opaque from the
   * library's point of view; the embedding application is responsible for
   * resolving "this meeting" / "this email" → signal id.
   */
  sourceSignalId?: string;
  /** Defaults to false (archived rows hidden). Pass true to include only archived, or undefined for default. */
  archived?: boolean;
  minConfidence?: number;
  observedAfter?: Date;
  observedBefore?: Date;
  /** Temporal filter: validFrom ≤ asOf ≤ (validUntil ?? ∞) AND createdAt ≤ asOf. */
  asOf?: Date;
  /**
   * Match facts whose `validUntil` is set AND strictly less than this date.
   * Used by `MemorySystem.expireFacts` to find facts past their validity
   * window. Facts with no `validUntil` are NEVER matched by this filter —
   * they are valid forever by design.
   */
  validUntilBefore?: Date;
  /**
   * Match facts whose `supersedes` field equals this fact id. Used by
   * `restoreFact` to detect an existing non-archived successor before
   * un-archiving a previously superseded predecessor. Pass `null` to match
   * facts with no `supersedes` (not currently supported — implement only if
   * needed).
   */
  supersedes?: FactId;
}

export interface FactOrderBy {
  /**
   * `observedAt` / `createdAt` / `confidence` are semantic sorts. `_id` is the
   * adapter's unique, immutable primary key — a TOTAL order with no ties. Use it
   * when a caller must iterate every fact exactly once under offset pagination
   * (e.g. `backfillAccessPrincipals`): `createdAt` can tie for bulk-ingested
   * facts, and Mongo's order among ties isn't stable across paged queries, so a
   * boundary row can be skipped or double-read. `_id` removes that hazard.
   */
  field: 'observedAt' | 'createdAt' | 'confidence' | '_id';
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
   * Match entities whose top-level `contextIds` array includes this entity id.
   * Symmetric to `FactFilter.contextId`. Adapter maps directly to
   * `{contextIds: filter.contextId}` — does NOT use `metadataFilter` (which
   * would query the wrong path: `metadata.contextIds`).
   */
  contextId?: EntityId;
  /**
   * Filter on entity.metadata fields. Keys may use dot-notation to reach
   * nested paths (e.g. `'jarvis.importance'` → `metadata.jarvis.importance`).
   * Keys whose path segments begin with `$` are rejected — no operator
   * injection. Supported value shapes per key:
   *   - literal scalar: `state: 'pending'`
   *   - literal Date
   *   - array of primitives/Dates (equality against array field)
   *   - `{ $in: [...] }` — membership
   *   - one or more range operators (may combine): `{ $gte: 10, $lt: 20 }` —
   *     operators allowed: `$lt`, `$lte`, `$gt`, `$gte`. RHS must be scalar
   *     or Date.
   * Example:
   *   {
   *     'state': { $in: ['pending', 'in_progress'] },
   *     'dueAt': { $lt: new Date('2026-05-01') },
   *     'jarvis.importance': { $gte: 70 },
   *   }
   */
  metadataFilter?: Record<string, unknown>;
}

/**
 * Sort key for `listEntities`. `field` is a dot-path into the entity document
 * (e.g. `'displayName'`, `'updatedAt'`, `'metadata.jarvis.importance'`).
 * Missing values sort to the end regardless of direction.
 */
export interface EntityOrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface EntitySearchOptions {
  types?: string[];
  limit?: number;
  cursor?: string;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
  /**
   * Stable multi-key sort. Single `EntityOrderBy` or array (earlier keys
   * dominant). Nested metadata paths allowed. When omitted the adapter's
   * natural order is used (Mongo: _id asc; InMemory: insertion order).
   */
  orderBy?: EntityOrderBy | EntityOrderBy[];
  /**
   * Field projection (dot-paths allowed). When omitted, full entity is
   * returned. When provided, the response always includes a required minimum
   * (`id`, `type`, `displayName`, `version`, `createdAt`, `updatedAt`,
   * `ownerId`, `groupId`, `archived`) plus the requested paths. Unrequested
   * optional fields (`identifiers`, `aliases`, `metadata`, `permissions`,
   * `identityEmbedding`) are absent from returned objects.
   */
  select?: string[];
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
 * Which entity embedding to search against in
 * `IMemoryStore.semanticSearchEntities`. `'identity'` (default) targets
 * `IEntity.identityEmbedding` — name/alias/identifier embedding consumed by
 * EntityResolver's semantic tier. `'content'` targets `IEntity.contentEmbedding`
 * — long-form-content embedding currently used for document search.
 *
 * Adapters that don't implement the requested field SHOULD return an empty
 * array (they will be skipped); they MUST NOT silently fall back to the other
 * field or callers risk leaking identity matches into content searches.
 */
export type EntityEmbeddingField = 'identity' | 'content';

/**
 * Narrow filter for `IMemoryStore.semanticSearchEntities`. Type narrowing is
 * the primary pre-filter — resolver tier-4 always knows (or guesses) the type.
 * `contextId` is the second narrow, pushed into the underlying vector-search
 * pipeline as a `filter: {contextIds: …}` clause so the search returns only
 * entities whose top-level `contextIds` contains the given anchor.
 * Scope still flows through `scope: ScopeFilter` separately.
 */
export interface EntitySemanticSearchFilter {
  /** Single-type narrow — preferred when known. */
  type?: string;
  /** Multi-type narrow — union. Ignored when `type` is set. */
  types?: string[];
  /**
   * Narrow to entities whose top-level `contextIds` array includes this id.
   * On Mongo Atlas, the filter must be declared on the entities vector index
   * (`'contextIds'` in `ENTITIES_FILTER_PATHS` — see MongoMemoryAdapter).
   * Adapters that lack the filter path declaration would silently drop the
   * clause; the library shipped path declares it so this works out of the box.
   */
  contextId?: EntityId;
  /**
   * Narrow by task-state vocabulary (`metadata.state ∈ {states}`). Atlas
   * filter path: `metadata.state`. Use with `type: 'task'` to constrain
   * semantic search to active tasks at the vector pipeline level rather than
   * post-filtering client-side. Empty array → no constraint.
   */
  states?: string[];
  /**
   * Narrow by assignee entity id (`metadata.assigneeId === id`). Atlas filter
   * path: `metadata.assigneeId`. Use with `type: 'task'`.
   */
  assigneeId?: EntityId;
  /**
   * Narrow by reporter entity id (`metadata.reporterId === id`). Atlas filter
   * path: `metadata.reporterId`. Use with `type: 'task'`.
   */
  reporterId?: EntityId;
  /**
   * Narrow by project entity id (`metadata.projectId === id`). Atlas filter
   * path: `metadata.projectId`. Use with `type: 'task'`.
   */
  projectId?: EntityId;
  /**
   * Narrow by due-date range (`metadata.dueAt` within window). At least one
   * of `from`/`to` must be set. Atlas filter path: `metadata.dueAt`.
   * Use with `type: 'task'`.
   */
  dueAtRange?: { from?: Date; to?: Date };
  /**
   * OR-wildcard role match — returns entities where this id appears in any
   * relational role for the filter's entity type. The entity-side analog of
   * `FactFilter.touchesEntity`.
   *
   * Expansion is keyed by `filter.type`:
   *   - `'task'` → `$or` over `metadata.assigneeId`, `metadata.reporterId`,
   *     `metadata.projectId`, and top-level `contextIds`.
   *   - Any other type, or when `type` is unset → `$or` over `contextIds` only
   *     (the one relational anchor universal across all entity types).
   *
   * Pushed into the Atlas `$vectorSearch.filter` clause. All referenced paths
   * are declared in `ENTITIES_FILTER_PATHS`, so the union is honoured rather
   * than silently dropped.
   *
   * When combined with a per-role narrow (e.g. `assigneeId`), both clauses
   * apply and are ANDed — the per-role narrow further filters within the
   * touched set.
   */
  touchesEntity?: EntityId;
  /**
   * Multi-anchor OR-wildcard match — returns entities touched by ANY id in
   * this array. The set-valued analog of `touchesEntity`: where the single
   * form fans out across one entity's relational roles, this fans out across
   * MANY anchors in a single ranked vector query.
   *
   * Expansion mirrors `touchesEntity`, keyed by `filter.type`:
   *   - `'task'` → entity matches if any anchor appears in `metadata.assigneeId`,
   *     `metadata.reporterId`, `metadata.projectId`, or top-level `contextIds`.
   *   - Any other type / unset → match on `contextIds` membership only.
   *
   * Pushed into the Atlas `$vectorSearch.filter` as one compound `$or` over
   * `$in` clauses, so the vector ranker sees every anchor-touching candidate
   * together rather than competing across N separate per-anchor top-K cuts
   * (the inferior client-side-union pattern this field exists to replace).
   *
   * ANDs with `touchesEntity` when both are set, and with any per-role narrow.
   * Empty array is treated as "no constraint" (the clause is dropped).
   */
  touchesAnyOf?: EntityId[];
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
  /**
   * Batch fetch entities by id. Returned array is in the same order as input;
   * ids not found or filtered out by scope resolve to `null` in-place. Lets
   * callers render references (e.g. `fact.objectId` → entity displayName)
   * without firing N round-trips. Adapters SHOULD implement this as a single
   * native batch query (e.g. Mongo `{_id:{$in:[…]}}`); the default InMemory
   * impl maps over `getEntity`.
   */
  getEntities(ids: EntityId[], scope: ScopeFilter): Promise<Array<IEntity | null>>;
  findEntitiesByIdentifier(kind: string, value: string, scope: ScopeFilter): Promise<IEntity[]>;
  /**
   * O(1) indexed exact-match lookup for entities whose `normalizedDisplayName`
   * (or, when `opts.matchAliases`, `normalizedAliases`) equals `normalized`.
   * Used by `EntityResolver` Tier 2/3 in place of the legacy
   * `searchEntities(q, {limit:50})` substring-then-filter path which was both
   * order-sensitive (Mongo oversample cap could truncate exact matches under
   * heavy substring fan-out) and non-atomic.
   *
   * Contract:
   *  - Returns at most `opts.limit` entities (default 20).
   *  - Equality is byte-for-byte against the stored normalized field — callers
   *    must normalize the query string the same way (`normalizeSurface`).
   *  - Archived entities excluded.
   *  - Scope filter applied identically to other reads.
   *  - Entities lacking `normalizedDisplayName` (legacy pre-0.8.0 data) are
   *    treated as if the field doesn't match — they are NOT returned. Hosts
   *    upgrading from <0.8.0 must run `MemorySystem.backfillNormalizedFields`
   *    to populate.
   *  - When `opts.matchAliases` is true, the method returns entities matching
   *    EITHER `normalizedDisplayName === normalized` OR `normalized ∈ normalizedAliases`.
   *    Default is `false` (displayName only).
   */
  findEntitiesByNormalizedName(
    type: string | undefined,
    normalized: string,
    scope: ScopeFilter,
    opts?: { matchAliases?: boolean; limit?: number },
  ): Promise<IEntity[]>;
  /**
   * Atomically find-or-create an entity by `(type, normalizedDisplayName,
   * scope)`. The load-bearing primitive for eliminating concurrent-insert
   * duplicates — two callers racing the same surface converge on a single row.
   *
   * Returns:
   *  - `{ entity, created: true }` — no prior row existed; the adapter inserted
   *    `input` and returned the fresh entity.
   *  - `{ entity, created: false }` — a row was already present (or another
   *    writer beat us to insert); the adapter returned the winner unchanged.
   *    Callers are responsible for accumulating aliases/identifiers/metadata
   *    onto the winner after the fact (see
   *    `MemorySystem.tryAtomicCreateOrResolve`).
   *
   * Atomicity guarantees:
   *  - InMemory: enforced by the JS event-loop (no `await` between read and
   *    write inside the method body) — single-process only.
   *  - Mongo: enforced by a unique partial index on
   *    `{groupId, ownerId, type, normalizedDisplayName}`. **Hosts must install
   *    this index via `ensureNormalizedNameUniqueIndex` (exported from the
   *    library) — otherwise the method degrades to a non-atomic
   *    find-then-create that still races.** Adding a unique index to a
   *    collection containing duplicates fails hard, so the library refuses to
   *    auto-create it; run after `backfillNormalizedFields` + a dedup pass.
   *
   * Degraded path:
   *  - When `normalizeSurface(input.displayName)` collapses to empty (pure
   *    punctuation / whitespace), the adapter cannot index a stable key.
   *    Falls back to plain `createEntity` — guaranteed `created: true`. The
   *    caller will see a duplicate in the rare case of two concurrent writes
   *    of pure-punctuation displayNames.
   */
  atomicCreateOrFindByNormalizedName(
    input: NewEntity,
    scope: ScopeFilter,
  ): Promise<{ entity: IEntity; created: boolean }>;
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

  /**
   * Rewrite every `entity:<fromEntityId>` access grant to `entity:<toEntityId>`
   * across all entities + facts (in `readPrincipals`, `writePrincipals`, and
   * `acl`). Used by `mergeEntities` so access grants follow identity
   * convergence — when a duplicate Person is merged away, records previously
   * readable via the loser's principal become readable via the winner's. Bulk
   * identity fix: scoped to the caller's tenant (`scope.groupId`) for safety,
   * but does not run per-record write checks (the merge already enforced
   * same-tenant + write access on winner/loser).
   *
   * Optional capability — stores that don't implement it simply skip this step
   * (their merges won't rewrite ACL grants). Both built-in adapters implement it.
   */
  rewriteEntityPrincipal?(
    fromEntityId: EntityId,
    toEntityId: EntityId,
    scope: ScopeFilter,
  ): Promise<void>;

  // ----- Graph (optional capability) -----
  traverse?(startId: EntityId, opts: TraversalOptions, scope: ScopeFilter): Promise<Neighborhood>;

  // ----- Vector (optional capability) -----
  semanticSearch?(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>>;

  /**
   * Entity-level semantic search. Default field is `identityEmbedding`,
   * consumed by `EntityResolver`'s semantic tier (Tier 4) when
   * `EntityResolutionConfig.enableSemanticResolution` is on. With
   * `opts.embeddingField:'content'`, the same method searches
   * `contentEmbedding` — used by `MemorySystem.searchDocuments`. Adapters
   * that don't implement this are skipped — the resolver falls back to
   * Tiers 1-3.
   *
   * Contract:
   *  - `filter.type` / `filter.types` narrow by `IEntity.type`. At least one
   *    should be used in practice — otherwise every entity type is a candidate.
   *  - `opts.topK` clamped by the caller (resolver passes small values, ~10).
   *  - `opts.minScore` optional noise floor (adapter MAY pre-filter; resolver
   *    post-filters regardless, so implementations can ignore it).
   *  - `opts.embeddingField` selects which entity embedding to search; defaults
   *    to `'identity'` for backward compatibility. Adapters MUST NOT silently
   *    fall back to the other field on misses — return an empty result.
   *  - Results ordered by descending `score` (cosine similarity, 0..1).
   *  - Archived entities MUST be excluded.
   *  - `scope` enforcement identical to every other read.
   */
  semanticSearchEntities?(
    queryVector: number[],
    filter: EntitySemanticSearchFilter,
    opts: SemanticSearchOptions & { minScore?: number; embeddingField?: EntityEmbeddingField },
    scope: ScopeFilter,
  ): Promise<Array<{ entity: IEntity; score: number }>>;

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

/**
 * Input passed to `IProfileGenerator.generate`. Regeneration is **incremental**:
 * the generator receives the prior profile (if any) as its starting point and
 * only the deltas since then — new facts plus IDs of facts whose claims should
 * be dropped because they've been archived or superseded.
 *
 * **First regen (no prior):** `priorProfile` is undefined, `newFacts` is the
 * full set of atomic facts visible to the target scope, and `invalidatedFactIds`
 * is empty. Generator should synthesize from scratch.
 *
 * **Subsequent regens:** `priorProfile.details` is the authoritative starting
 * text; the generator should *evolve* it by folding in `newFacts` and removing
 * any claims backed only by facts whose IDs appear in `invalidatedFactIds`.
 */
export interface ProfileGeneratorInput {
  entity: IEntity;
  /**
   * Atomic facts added since the prior profile was generated (observedAt >
   * prior.createdAt, archived=false). On first regen: all atomic facts.
   * Capped at 500 by MemorySystem.
   */
  newFacts: IFact[];
  /** The prior profile document, if one exists at this scope. */
  priorProfile: IFact | undefined;
  /**
   * IDs of facts the generator should *drop* from the profile:
   *   - Facts superseded by new ones (`supersedes` → predecessor id).
   *   - Facts archived directly (via `archiveFact`) that were visible at prior
   *     regen time.
   * The generator never sees these facts' contents — only their IDs — so it
   * cannot reference them in the updated profile, only remove existing mentions.
   */
  invalidatedFactIds: FactId[];
  targetScope: ScopeFields;
}

export interface IProfileGenerator {
  generate(
    input: ProfileGeneratorInput,
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
  | { type: 'fact.restore'; factId: FactId }
  | { type: 'fact.supersede'; oldId: FactId; newId: FactId }
  /**
   * Emitted by `MemorySystem.expireFacts` during a scheduled lifecycle sweep,
   * in addition to (not instead of) the generic `fact.archive` event for the
   * same fact. The dual emit means existing `fact.archive` subscribers (cache
   * invalidators, audit log appenders) keep receiving every archival, while
   * observability that wants to break out automatic expiry vs. operator/agent
   * archives can subscribe to `fact.expire` and read predicate + validUntil.
   */
  | { type: 'fact.expire'; factId: FactId; predicate: string; validUntil: Date }
  /**
   * H3: emitted when a singleValued predicate's auto-supersede couldn't see a
   * prior fact in the caller's scope, but a prior DOES exist in an outer scope
   * (group-shared or global). The new fact lands in the caller's scope as a
   * new "current" coexisting with the invisible outer one. Intentional — the
   * event lets operators observe the drift without changing isolation.
   */
  | {
      type: 'fact.supersede_skipped_outer_scope';
      subjectId: EntityId;
      predicate: string;
      outerFactId: FactId;
      callerScope: ScopeFields;
    }
  | { type: 'profile.regenerate'; entityId: EntityId; scope: ScopeFields; factId: FactId }
  /**
   * Emitted once per embedding job that exhausted all retries. Lets operators
   * surface a dead-letter signal (metrics, alerts) rather than silently
   * dropping the embedding. Applies to both fact and entity-identity jobs.
   */
  | {
      type: 'fact.embedding.failed';
      /** Populated for fact-level embeddings; null for entity-identity jobs. */
      factId: FactId | null;
      /** Populated for entity-identity embeddings; null for fact jobs. */
      entityId: EntityId | null;
      attempts: number;
      reason: string;
    }
  /**
   * Emitted when a reconciliation op (Pillar 1 thread or Pillar 2 entity-anchored)
   * is rejected — either because the LLM hallucinated a factId not in priorFacts,
   * or because Pillar 2 emitted a `create` op (it only resolves). Lets observers
   * surface LLM-drift in the audit log without grepping logger output.
   */
  | {
      type: 'fact.reconcile.rejected';
      /** Null when the op had no factId (e.g. a stray create in Pillar 2). */
      factId: FactId | null;
      reason: string;
    }
  /**
   * Emitted when bare `MemorySystem.upsertEntity` (no identifier match) hits
   * multiple entities sharing the incoming `normalizedDisplayName` in the
   * caller's scope. The library cannot pick one safely — typically the
   * legacy-data signature where prior dups exist — so it falls through to
   * creating a NEW entity to avoid arbitrarily merging into a wrong row.
   * Hosts should subscribe and run a dedup pass to consolidate.
   */
  | {
      type: 'entity.upsert.ambiguous';
      type_: string;
      normalizedDisplayName: string;
      candidates: EntityId[];
      createdId: EntityId;
    }
  /**
   * Emitted when `EntityResolver.upsertBySurface` auto-resolves to an existing
   * entity via the semantic tier (Tier 4) — i.e. no identifier or exact-name
   * hit, but cosine similarity over `identityEmbedding` cleared the
   * type-scoped auto-resolve threshold. Lets hosts write to an activity log
   * without parsing console warnings, and lets observability count silent
   * merges happening at write time.
   *
   * `cosine` is the raw similarity (BEFORE the confidence cap). `mergeCandidateIds`
   * lists OTHER candidates that also scored above the semantic threshold but
   * lost the top-ranked spot — useful for surfacing "maybe this should have
   * merged into B instead" cases for review.
   */
  | {
      type: 'entity.upsert.semantic_automerge';
      entityId: EntityId;
      mergedSurface: string;
      cosine: number;
      mergeCandidateIds: EntityId[];
    };

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
  /**
   * Raw cosine score from Tier 4 (semantic) — set ONLY when `matchedOn ===
   * 'embedding'`. Differs from `confidence` because semantic candidates have
   * the cosine capped per type (default 0.95 for auto-merge-eligible types,
   * 0.89 for advisory types like person). Hosts auditing semantic decisions
   * want the raw cosine; ranking against other tiers wants the capped value.
   */
  rawSemanticScore?: number;
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
   * Resolution-time hint only; does NOT persist on the resolved entity.
   * (For the persistent multi-entity binding, see `IEntity.contextIds`.)
   */
  disambiguationEntityIds?: EntityId[];
  /**
   * @deprecated Renamed to `disambiguationEntityIds` to avoid collision with
   * the persistent `IEntity.contextIds` field. Will be removed in a future
   * release. The resolver accepts both; `disambiguationEntityIds` wins on
   * collision.
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
  /**
   * Other entities resolved earlier in the same extraction — disambiguation
   * hint for the resolver. Does NOT persist. See `ResolveEntityQuery.disambiguationEntityIds`.
   */
  disambiguationEntityIds?: EntityId[];
  /**
   * @deprecated Renamed to `disambiguationEntityIds`. The library accepts both;
   * `disambiguationEntityIds` wins on collision.
   */
  contextEntityIds?: EntityId[];
  /**
   * Persistent multi-entity binding for the resolved entity — written to
   * `IEntity.contextIds`. Re-extraction with new ids **unions** into the
   * existing set (never overwrites, never fills-missing). Self-references
   * and ids invisible to the caller are silently dropped.
   *
   * Convention: set on `task`, `event`, `topic` mentions to bind them to
   * the project/deal/meeting they live within. Empty / omitted means no
   * change to existing contextIds on resolve, no contextIds on create.
   */
  contextIds?: EntityId[];
  /**
   * Type-specific fields (task.state, event.startTime, etc.). See the file
   * header for conventional fields per entity type.
   *
   * **Merge semantics on resolve (existing entity):** governed by
   * `UpsertBySurfaceOptions.metadataMerge`. Default `'fillMissing'` — only
   * keys absent from the stored entity's metadata are set; existing values
   * are never overwritten. This is the guardrail for LLM-driven ingestion:
   * re-extracting a task should never silently flip `state` or `dueAt`.
   *
   * To deliberately change existing metadata, use `updateEntityMetadata` (raw
   * patch) or `transitionTaskState` (state machine + audit). The upsert path
   * is for *first observation* of fields, not updates.
   *
   * On create (no match), all keys are set verbatim.
   */
  metadata?: Record<string, unknown>;
  /**
   * Optional explicit `acl` to stamp on the entity at CREATE time. Used by the
   * extraction resolver (via `ExtractionResolverOptions.defaultAcl`) to grant
   * read access to signal participants for content-bearing entity types (e.g.
   * Task / Topic created from an email) so other ICOS users on the same thread
   * can read the entity without re-extracting.
   *
   * **Create-only.** The match-existing branches (Tier 1 / Tier 4 dedup,
   * normalized-name find) IGNORE this field and leave any pre-existing entity
   * `acl` untouched — re-resolving across signals must never narrow or
   * clobber access state another signal's writer established. The host
   * grants additional access via `MemorySystem.setAccess` post-resolve when
   * a per-entity update is genuinely intended.
   */
  acl?: ACLEntry[];
}

export interface UpsertBySurfaceOptions {
  /**
   * Candidates must clear this confidence to auto-resolve to an existing
   * entity. Conservative default (0.90) — favors fewer false merges at the
   * cost of creating more duplicates that can be merged later.
   */
  autoResolveThreshold?: number;
  /**
   * How to merge `input.metadata` into an existing entity on resolve.
   * - `'fillMissing'` (default): only set keys absent from stored metadata.
   *   Never overwrites existing values. Safe default for LLM-driven ingestion.
   * - `'overwrite'`: shallow-merge (incoming keys win). Use when the caller
   *   is authoritative (e.g. sync job from a system of record).
   *
   * Irrelevant on create — all keys are set.
   */
  metadataMerge?: 'fillMissing' | 'overwrite';
}

export interface UpsertBySurfaceResult {
  entity: IEntity;
  /** True if we matched an existing entity; false if we created a new one. */
  resolved: boolean;
  /** Other near-matches that didn't win — surfaced for human review / deferred merges. */
  mergeCandidates: EntityCandidate[];
  /**
   * Which tier produced the auto-resolve winner. Undefined when `resolved`
   * is false (we created a new entity) OR when resolved via the
   * atomic-create-or-resolve race-loss path (the racer's tier is opaque).
   *
   * Hosts use this to audit semantic auto-merges specifically — the
   * `entity.upsert.semantic_automerge` ChangeEvent fires whenever
   * `matchedOn === 'embedding'` and `resolved === true`.
   */
  matchedOn?: 'identifier' | 'displayName' | 'alias' | 'fuzzy' | 'embedding';
  /**
   * Raw cosine that drove a Tier-4 auto-resolve. Set ONLY when `matchedOn ===
   * 'embedding'`. Useful for audit logs / activity feeds — `confidence` on
   * the winning candidate is the type-capped value, not the raw score.
   */
  rawSemanticScore?: number;
}

export interface EntityResolutionConfig {
  /** Default threshold for auto-resolve in upsertEntityBySurface. Default 0.90 (conservative). */
  autoResolveThreshold?: number;
  /**
   * When true AND an embedder is configured, entities get an identity
   * embedding (over displayName + aliases + primary identifier values).
   * Default true.
   *
   * Consumed by Tier 4 of `EntityResolver` when `enableSemanticResolution`
   * is on. Set to `false` to skip the embedder cost if you neither use
   * semantic resolution nor plan to enable it later.
   */
  enableIdentityEmbedding?: boolean;
  /**
   * Enable the semantic tier in `EntityResolver` — matches surface forms
   * against `identityEmbedding` via `IMemoryStore.semanticSearchEntities`.
   * Requires an embedder AND an adapter that implements
   * `semanticSearchEntities` (currently `InMemoryAdapter` and
   * `MongoMemoryAdapter`).
   *
   * **Default changed to `true` in 0.9.1.** Calibrated against production
   * data showing a clean separation between within-cluster cosines (median
   * 0.95-1.00 for known dups) and cross-cluster cosines (max 0.86 for the
   * noisiest type). Semantic auto-resolve now catches the structural dup
   * pattern that exact-tier matching misses on pre-0.8.0 data (rows without
   * `normalizedDisplayName`) — without it, every LLM re-mention of an
   * existing entity creates a new row.
   *
   * Auto-resolve eligibility is type-scoped via `semanticAutoResolveTypes`.
   * Persons are EXCLUDED by default — same-first-name collisions in a tenant
   * make semantic-alone unsafe. Persons fall back to Tier 1 (identifier) /
   * Tier 2-3 (multi-token name equality) only.
   */
  enableSemanticResolution?: boolean;

  /**
   * Entity types where Tier 4 (semantic match) can drive auto-resolve.
   *
   * **Default:** `['organization', 'project', 'event', 'topic', 'task', 'cluster']`.
   *
   * Types in this list get the full `semanticConfidenceCap` (default 0.95)
   * so a strong semantic match clears the auto-resolve threshold (default
   * 0.90). Types NOT in the list have their semantic confidence capped at
   * 0.89 — the candidate appears in `mergeCandidates` for operator review
   * but never auto-merges.
   *
   * **Persons are intentionally excluded.** "Pavel" matching another "Pavel"
   * with cosine 1.0 is NOT a same-person signal in a multi-Pavel tenant —
   * persons require either an identifier match or multi-token name equality
   * (first + last). Tier 2-3 enforce the multi-token rule for type=person.
   *
   * Set to an empty array to disable semantic auto-resolve entirely (every
   * type goes through the operator review queue).
   */
  semanticAutoResolveTypes?: string[];

  /**
   * Maximum confidence assigned to a Tier-4 (semantic) match for types in
   * `semanticAutoResolveTypes`. Default `0.95`. The capped value lets cosine
   * matches clear the default `autoResolveThreshold` (0.90) so dup-extraction
   * actually converges at write time.
   *
   * Picked to leave headroom below identifier-match confidence (1.0) so a
   * Tier-1 hit still wins ranking ties against semantic candidates. Lower
   * this if you want stricter auto-resolve gating; raise toward 1.0 only if
   * you've validated your embedder produces clean cross-entity separation.
   */
  semanticConfidenceCap?: number;

  /**
   * Minimum cosine score for a semantic candidate to be considered at all.
   * Default `0.75`. Calibrated against production data: cross-entity-cluster
   * cosines top out around 0.86; within-cluster cosines have a long tail to
   * 0.59-0.70 for loose clusters. Lowering this floor surfaces more
   * candidates (some real dups, some noise); raising it filters more
   * aggressively. Most callers should leave it at the default.
   */
  semanticMinScore?: number;
  /**
   * Confidence assigned to a Tier-2 exact normalized-displayName match.
   * Default 0.90 — equal to the default `autoResolveThreshold`, so a Tier-2
   * match auto-resolves on `upsertEntityBySurface`. Lower this to make
   * displayName matches advisory rather than authoritative.
   */
  displayNameMatchConfidence?: number;
  /**
   * Confidence assigned to a Tier-3 exact normalized-alias match.
   *
   * **Default changed to 0.90 in 0.8.0** (previously hardcoded 0.85). Rationale:
   * with `normalizedAliases` now indexed (Commit 1) + scoped via the
   * type-aware `findEntitiesByNormalizedName` (Commit 2), an exact alias
   * match is structurally as strong as a displayName match — both come from
   * a single O(1) lookup against deduped storage. Keeping it at 0.85 meant
   * alias-only matches fell below the default `autoResolveThreshold` (0.90)
   * and the resolver created a new entity on every hit (R2 from Step 0).
   *
   * Hosts that want the old "alias = advisory" behavior can set this to
   * 0.85 — the resolver returns the candidate but `upsertBySurface` will
   * create a new entity unless `autoResolveThreshold` is also lowered.
   */
  aliasMatchConfidence?: number;
}

/**
 * Task-state vocabulary configuration. Drives which states `getContext`
 * surfaces as "open" in `relatedTasks`, and which are treated as "terminal"
 * (done/cancelled) for side effects like auto-setting `completedAt`.
 *
 * Library default preserves the legacy vocabulary. Apps using different
 * lifecycles (e.g. `'proposed' | 'scheduled' | 'in_progress' | 'done'`)
 * override here rather than hardcoding state strings in metadata queries.
 */
export interface TaskStatesConfig {
  /** States treated as "still open" — surfaced in getContext.relatedTasks. */
  active: string[];
  /** States treated as "finished" — transitions into these auto-set completedAt. */
  terminal: string[];
}

export interface MemorySystemConfig {
  store: IMemoryStore;
  embedder?: IEmbedder;
  profileGenerator?: IProfileGenerator;
  ruleEngine?: IRuleEngine;
  /**
   * Task-state vocabulary. Defaults to:
   *   { active: ['pending','in_progress','blocked','deferred'],
   *     terminal: ['done','cancelled'] }
   * The two arrays must be disjoint and non-empty.
   */
  taskStates?: TaskStatesConfig;
  /**
   * Maximum number of entries retained in `task.metadata.stateHistory`.
   * `transitionTaskState` keeps the most-recent N entries (older entries are
   * dropped in FIFO order). Guards against unbounded metadata growth on chatty
   * tasks — a task that cycles through states thousands of times could
   * otherwise push the entity document past Mongo's 16 MB cap. Entries past
   * the cap are lost; callers that need unbounded audit must maintain it
   * externally.
   *
   * Default: 200. Must be >= 1.
   */
  stateHistoryCap?: number;
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
   * Pass `PredicateRegistry.standard()` for the built-in 44-predicate starter
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
   * H5 — how the LLM extraction pipeline handles a predicate that isn't in the
   * registry (after canonicalisation). Only used when a registry is configured.
   *
   * - `'fuzzy_map'` (default): try to snap onto the closest registered
   *   predicate via edit distance (length-aware — see
   *   `unknownPredicateFuzzyMaxDistance`). Typical wins: `work_at`→`works_at`,
   *   `mention`→`mentioned`. No match → fall through to `'keep'`.
   * - `'keep'`: write the unknown predicate verbatim (pre-H5 behaviour).
   *   Surfaces in `IngestionResult.newPredicates` for human review.
   * - `'drop'`: skip the fact entirely, record the reason in `unresolved`.
   *
   * Regardless of policy, the unknown predicate is always added to
   * `newPredicates` (with the mapping target if one was chosen) so operators
   * can still audit drift.
   */
  unknownPredicatePolicy?: 'fuzzy_map' | 'keep' | 'drop';
  /**
   * F3 — absolute cap on the Levenshtein distance used by `findClosest` when
   * `unknownPredicatePolicy='fuzzy_map'`. The effective budget is also
   * clamped by predicate length (`floor(min(lenA,lenB)/4)`, min 1), so
   * lowering this only tightens further. Default: 2 (registry's built-in
   * budget).
   *
   * Tune down (e.g. 1) if your vocabulary has semantically-distinct
   * predicates within edit distance 2 of each other (`talks_at` vs
   * `works_at`). Tune up only with confidence your predicates are
   * well-separated in edit-distance space.
   */
  unknownPredicateFuzzyMaxDistance?: number;
  /**
   * When true (default), `addFact` auto-supersedes the prior visible fact for
   * a `(subject, predicate)` pair when the predicate is marked `singleValued`.
   * Set to false to opt out while still getting canonicalization + defaults.
   */
  predicateAutoSupersede?: boolean;
  onChange?: (event: ChangeEvent) => void;
  /**
   * Invoked when `onChange` throws. Lets operators surface listener failures
   * to their logging / telemetry pipeline rather than losing them silently.
   * Falls back to `console.warn` when unset.
   */
  onError?: (error: unknown, event: ChangeEvent) => void;
  /**
   * Host-supplied default `permissions` for every entity / fact write where
   * the caller didn't specify `permissions` explicitly. Lets hosts express
   * policies like "entities are group-readable, facts are owner-private by
   * default" in one place instead of at every call site — and, critically,
   * applies to writes emitted from inside the library (e.g., by
   * `ExtractionResolver` or `ProfileGenerator` paths) that the host can't
   * intercept directly.
   *
   * Callers that pass `permissions` on the write input always win — the
   * policy only fills the blanks. Return `undefined` from the policy to
   * fall through to the library defaults (`DEFAULT_GROUP_LEVEL` /
   * `DEFAULT_WORLD_LEVEL`, both `'read'`).
   *
   * Keep the function cheap — it runs on every entity / fact create.
   */
  visibilityPolicy?: VisibilityPolicy;
  /**
   * Per-type content-embedding composers. Library ships defaults for `task`,
   * `event`, `person`, `organization`, `topic`, `project`, `document`,
   * `cluster` — see `composers/defaults.ts`. Caller-supplied entries override
   * the default for that type; unspecified types fall back to the default
   * (or get no content embedding if there is no default).
   *
   * Composers run on every entity mutation site; `contentEmbedding` and
   * `contentEmbeddingText` refresh whenever the composed text changes.
   * Empty-string composer output skips the embed for that entity entirely.
   */
  entityContentComposers?: Record<
    string,
    import('./composers/types.js').EntityContentComposer
  >;
  /**
   * Fact content-embedding composer. Library ships a default that composes
   * atomic facts as `"<subject.displayName> <predicate> <object.displayName | value>"`
   * (resolving entity ids to surface forms) and document facts as their
   * `details`/`summaryForEmbedding` verbatim. Override to customize the
   * embedded fact text or to skip embedding for specific predicates (return
   * `''` from `compose`).
   */
  factContentComposer?: import('./composers/types.js').FactContentComposer;
}

// Re-export IDisposable so consumers can use the same symbol.
export type { IDisposable };
