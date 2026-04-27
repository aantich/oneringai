/**
 * MemorySystem — the facade. All business logic lives here; adapters stay thin.
 *
 * Responsibilities:
 *   - Entity upsert with identifier-based deduplication
 *   - Fact writes with scope invariant enforcement + supersession chain
 *   - Async embedding queue (writes return immediately; embeddings settle in background)
 *   - Context assembly (profile resolution, top-facts ranking, optional tiers)
 *   - Profile regeneration triggered by threshold or manually
 *   - Rule-engine hook (sandboxed via IScopedMemoryView)
 */

import { assertNotDestroyed } from '../domain/interfaces/IDisposable.js';
import type { IDisposable } from '../domain/interfaces/IDisposable.js';
import {
  assertCanAccess,
  canAccess,
  OwnerRequiredError,
  type Permissions,
  type VisibilityContext,
  type VisibilityPolicy,
} from './AccessControl.js';
import { coerceFactTemporalFields, coerceMetadataDates } from './dateCoercion.js';
import { genericTraverse } from './GenericTraversal.js';
import { metadataDeepEqual } from './metadataDiff.js';
import { rankFacts } from './Ranking.js';
import type { PredicateRegistry } from './predicates/PredicateRegistry.js';
import type { PredicateDefinition } from './predicates/types.js';
import { EntityResolver, buildIdentityString } from './resolution/EntityResolver.js';
import type {
  ChangeEvent,
  ContextOptions,
  EmbeddingQueueConfig,
  EntityCandidate,
  EntityId,
  EntityResolutionConfig,
  EntityView,
  FactFilter,
  FactId,
  IEmbedder,
  IEntity,
  IFact,
  IMemoryStore,
  IProfileGenerator,
  IRuleEngine,
  IScopedMemoryView,
  Identifier,
  MemorySystemConfig,
  Neighborhood,
  NewEntity,
  NewFact,
  RankingConfig,
  RelatedEvent,
  RelatedItemHit,
  RelatedItemsResult,
  RelatedTask,
  ResolveEntityOptions,
  ResolveEntityQuery,
  ScopeFields,
  ScopeFilter,
  TaskStatesConfig,
  TraversalOptions,
  UpsertBySurfaceInput,
  UpsertBySurfaceOptions,
  UpsertBySurfaceResult,
  UpsertEntityResult,
} from './types.js';

// Defaults --------------------------------------------------------------------

const DEFAULT_TOP_FACTS_LIMIT = 15;
const DEFAULT_SEMANTIC_TOP_K = 5;
const DEFAULT_NEIGHBOR_DEPTH = 1;
const DEFAULT_PROFILE_THRESHOLD = 3;
/**
 * Threshold (chars of estimated input) above which `regenerateProfile` emits
 * an operator warn log. No cap is applied — the log is purely observability
 * so large profiles don't cost a surprise without the operator knowing.
 */
const PROFILE_GEN_WARN_CHARS = 200_000;
const DEFAULT_EMBED_CONCURRENCY = 4;
const DEFAULT_EMBED_RETRIES = 3;
const SEMANTIC_MIN_DETAILS_LENGTH = 80;

/** Legacy task-state vocabulary — used when caller doesn't override via config. */
const DEFAULT_TASK_STATES = {
  active: ['pending', 'in_progress', 'blocked', 'deferred'],
  terminal: ['done', 'cancelled'],
} as const;

/**
 * Minimum candidate pool fetched from the semantic store inside
 * `findSimilarOpenTasks` before the post-state-filter runs. Picked so that
 * even `topK=1` still surveys enough of the vector neighbourhood to find an
 * active match if one exists slightly below the top hit.
 */
const FIND_SIMILAR_OVER_FETCH_FLOOR = 30;

/** Conventional metadata fields on task entities that reference other entities. */
const RELATIONAL_TASK_FIELDS = ['assigneeId', 'reporterId', 'projectId'] as const;

const ROLE_BY_FIELD: Record<string, string> = {
  assigneeId: 'assigned_to',
  reporterId: 'reporter_of',
  projectId: 'project_of',
};

// Error types -----------------------------------------------------------------

export class ScopeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeInvariantError';
  }
}

export class ProfileGeneratorMissingError extends Error {
  constructor() {
    super('regenerateProfile() called but no profileGenerator configured');
    this.name = 'ProfileGeneratorMissingError';
  }
}

export class SemanticSearchUnavailableError extends Error {
  constructor(reason: string) {
    super(`semanticSearch unavailable: ${reason}`);
    this.name = 'SemanticSearchUnavailableError';
  }
}

/**
 * Thrown when `transitionTaskState` is called with `validate: 'strict'` and
 * the (from, to) pair is not allowed by the caller-supplied transition matrix.
 */
export class InvalidTaskTransitionError extends Error {
  readonly from: string | undefined;
  readonly to: string;
  readonly taskId: EntityId;
  constructor(taskId: EntityId, from: string | undefined, to: string) {
    super(
      `InvalidTaskTransitionError: task ${taskId} cannot transition ` +
        `from '${from ?? '(unset)'}' to '${to}' under the supplied transitions matrix`,
    );
    this.name = 'InvalidTaskTransitionError';
    this.from = from;
    this.to = to;
    this.taskId = taskId;
  }
}

/**
 * F1 — thrown by `restoreFact` when the target fact was superseded by a later
 * non-archived fact. Un-archiving the predecessor without first handling the
 * successor would leave two "current" values for the same predicate, breaking
 * ranking and the singleValued invariant. Callers handle this by (a) archiving
 * the successor first, or (b) using `memory_forget` on the successor.
 */
export class FactSupersededError extends Error {
  readonly factId: FactId;
  readonly supersededBy: FactId;
  constructor(factId: FactId, supersededBy: FactId) {
    super(
      `Cannot restore fact ${factId}: it was superseded by fact ${supersededBy} ` +
        `which is still active. Archive ${supersededBy} first (or use ` +
        `memory_forget on it) before restoring ${factId}.`,
    );
    this.name = 'FactSupersededError';
    this.factId = factId;
    this.supersededBy = supersededBy;
  }
}

/**
 * Single entry appended to `task.metadata.stateHistory` on every transition.
 * No cap — retention is the caller's problem (audit systems, GDPR, archival).
 */
export interface TaskStateHistoryEntry {
  from: string | undefined;
  to: string;
  at: Date;
  signalId?: string;
  reason?: string;
}

export interface TransitionTaskStateOptions {
  /** Stable audit pointer — typically the ingest signal id. Flows into the history entry AND the written fact. */
  signalId?: string;
  /** When the transition happened. Defaults to now. */
  at?: Date;
  /** Free-form audit note. Stored in the history entry. */
  reason?: string;
  /**
   * Validation mode.
   * - `'warn'` (default): any transition allowed; out-of-matrix transitions route through `onError` and proceed.
   * - `'strict'`: out-of-matrix transitions throw `InvalidTaskTransitionError` — metadata + fact writes are skipped.
   * - `'none'`: no validation, no warnings.
   */
  validate?: 'strict' | 'warn' | 'none';
  /**
   * Explicit allowed transitions: `{ from: [allowed, to, states] }`. When omitted,
   * every transition is allowed (with a warning for duplicates in `'warn'`).
   * Keys include `'__initial'` for transitions into a first-time state.
   */
  transitions?: Record<string, string[]>;
  /**
   * Optional overrides applied to the written `state_changed` audit fact.
   * Unset fields fall back to the method's defaults (`importance: 0.7`,
   * `confidence: undefined`, no `contextIds`, etc.).
   *
   * The LLM extraction pipeline populates this when it routes a
   * `state_changed` fact through `transitionTaskState` — without it, the
   * caller's `importance` / `confidence` / `contextIds` would be silently
   * dropped and the audit fact would not surface on retrieval queries that
   * pivot on `contextIds` (e.g. "everything about the Acme deal").
   */
  factOverrides?: {
    importance?: number;
    confidence?: number;
    contextIds?: EntityId[];
    validFrom?: Date;
    validUntil?: Date;
    summaryForEmbedding?: string;
    evidenceQuote?: string;
  };
}

export interface TransitionTaskStateResult {
  task: IEntity;
  fact: IFact | null;
  /** Set when `validate='strict'` rejected the transition. */
  rejected?: string;
}

// =============================================================================
// MemorySystem
// =============================================================================

export class MemorySystem implements IDisposable {
  private readonly store: IMemoryStore;
  private readonly embedder?: IEmbedder;
  private readonly profileGenerator?: IProfileGenerator;
  private readonly ruleEngine?: IRuleEngine;
  private readonly profileThreshold: number;
  private readonly ranking: RankingConfig;
  private readonly onChange?: (event: ChangeEvent) => void;
  private readonly onError?: (error: unknown, event: ChangeEvent) => void;
  private readonly queue: EmbeddingQueue;
  private readonly resolver: EntityResolver;
  private readonly resolutionConfig: EntityResolutionConfig;
  private readonly predicates?: PredicateRegistry;
  private readonly predicateMode: 'permissive' | 'strict';
  private readonly predicateAutoSupersede: boolean;
  private readonly unknownPredicatePolicy: 'fuzzy_map' | 'keep' | 'drop';
  private readonly unknownPredicateFuzzyMaxDistance: number | undefined;
  private readonly _taskStates: TaskStatesConfig;
  private readonly _autoApplyTaskTransitions: boolean;
  private readonly _stateHistoryCap: number;
  private readonly visibilityPolicy?: VisibilityPolicy;

  /** Tracks pending profile regenerations per (entityId + scopeKey) to prevent overlap. */
  private readonly regenInFlight = new Set<string>();

  private destroyed = false;

  constructor(config: MemorySystemConfig) {
    this.store = config.store;
    this.embedder = config.embedder;
    this.profileGenerator = config.profileGenerator;
    this.ruleEngine = config.ruleEngine;
    this.profileThreshold = config.profileRegenerationThreshold ?? DEFAULT_PROFILE_THRESHOLD;
    this.predicates = config.predicates;
    this.predicateMode = config.predicateMode ?? 'permissive';
    this.predicateAutoSupersede = config.predicateAutoSupersede ?? true;
    this.unknownPredicatePolicy = config.unknownPredicatePolicy ?? 'fuzzy_map';
    this.unknownPredicateFuzzyMaxDistance = config.unknownPredicateFuzzyMaxDistance;
    if (this.predicateMode === 'strict' && !this.predicates) {
      throw new Error(
        "MemorySystem: predicateMode='strict' requires a `predicates` registry",
      );
    }
    // F2: caller explicitly set the policy but didn't configure a registry —
    // `resolveUnknownPredicate` would silently return {policy:'keep'} for
    // every unknown, quietly ignoring the caller's intent. Fail loudly so
    // misconfiguration surfaces at startup rather than in production drift.
    // The default value alone doesn't trigger — absent a registry, the
    // default 'fuzzy_map' is inert (findClosest needs a registry to run).
    if (config.unknownPredicatePolicy !== undefined && !this.predicates) {
      throw new Error(
        `MemorySystem: unknownPredicatePolicy='${config.unknownPredicatePolicy}' ` +
          'has no effect without a `predicates` registry. Configure a registry ' +
          'or omit the policy from config.',
      );
    }
    this._taskStates = validateTaskStates(config.taskStates);
    this._autoApplyTaskTransitions = config.autoApplyTaskTransitions ?? true;
    this._stateHistoryCap = validateStateHistoryCap(config.stateHistoryCap);
    this.visibilityPolicy = config.visibilityPolicy;
    // Fold registry ranking weights into the base ranking config. Caller-supplied
    // weights win on collision — user config always trumps registry defaults.
    const userWeights = config.topFactsRanking?.predicateWeights ?? {};
    const mergedWeights = this.predicates
      ? this.predicates.toRankingWeights(userWeights)
      : userWeights;
    this.ranking = {
      ...(config.topFactsRanking ?? {}),
      predicateWeights: mergedWeights,
    };
    this.onChange = config.onChange;
    this.onError = config.onError;
    this.queue = new EmbeddingQueue(
      this.store,
      this.embedder,
      config.embeddingQueue,
      (item, error) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.emit({
          type: 'fact.embedding.failed',
          factId: item.factId,
          entityId: item.entityId,
          attempts: item.attempts,
          reason,
        });
      },
    );
    this.resolutionConfig = config.entityResolution ?? {};
    this.resolver = new EntityResolver(
      {
        store: this.store,
        embedQuery: this.embedder
          ? (text: string) => this.embedder!.embed(text)
          : undefined,
        upsertEntity: async (input, scope) => {
          const res = await this.upsertEntity(input, scope);
          return { entity: res.entity, created: res.created };
        },
        appendAliasesAndIdentifiers: async (id, aliases, identifiers, scope, opts) => {
          return this.appendAliasesAndIdentifiers(id, aliases, identifiers, scope, opts);
        },
      },
      this.resolutionConfig,
    );
  }

  // ==========================================================================
  // Entities
  // ==========================================================================

  async upsertEntity(
    input: Partial<IEntity> & {
      identifiers: Identifier[];
      displayName: string;
      type: string;
      /**
       * How `input.metadata` is folded into an existing entity on resolve.
       * Default: undefined → metadata is ignored on resolve (current behavior,
       * backward-compatible).
       *  - `'fillMissing'`: only set keys absent from stored metadata; existing
       *    values are never overwritten. Safe for LLM-driven re-extraction.
       *  - `'overwrite'`: shallow-merge — incoming keys win. Use when the
       *    caller is authoritative (calendar API for events, sync from system
       *    of record).
       *
       * On create (no match) all keys are set verbatim regardless of this option.
       */
      metadataMerge?: 'fillMissing' | 'overwrite';
      /**
       * Optional whitelist applied when `metadataMerge` is set: only these
       * top-level keys are touched. Other incoming keys are ignored. Lets the
       * caller pin the merge to a known set (e.g. `['startTime','endTime',
       * 'status']` for events) without leaking unrelated extracted fields.
       *
       * Has no effect when `metadataMerge` is unset.
       */
      metadataMergeKeys?: string[];
    },
    scope: ScopeFilter,
  ): Promise<UpsertEntityResult> {
    assertNotDestroyed(this, 'upsertEntity');
    // Coerce ISO-string date values in metadata to `Date` instances. Callers
    // (LLM extraction, REST sync) frequently emit ISO strings; storing those
    // as strings silently breaks `$gte/$lt` Mongo range queries. See
    // `dateCoercion.ts` for the contract.
    if (input.metadata) {
      input = { ...input, metadata: coerceMetadataDates(input.metadata) };
    }
    // Empty identifiers is allowed — entities like projects, topics, clusters
    // may genuinely have no external strong key. They can still be found via
    // displayName/alias search + fuzzy + identity embedding.

    // Lookup every identifier; collect (entityId → match count)
    const matchCounts = new Map<EntityId, number>();
    for (const ident of input.identifiers) {
      const matches = await this.store.findEntitiesByIdentifier(ident.kind, ident.value, scope);
      for (const m of matches) {
        matchCounts.set(m.id, (matchCounts.get(m.id) ?? 0) + 1);
      }
    }

    if (matchCounts.size === 0) {
      return this.createEntity(input, scope);
    }

    // Pick best match (most identifier hits). Tiebreak: most recently updated.
    const sortedIds = [...matchCounts.entries()].sort((a, b) => b[1] - a[1]);
    const bestId = sortedIds[0]![0];
    const best = await this.store.getEntity(bestId, scope);
    if (!best) {
      return this.createEntity(input, scope);
    }

    const mergeCandidates = sortedIds
      .slice(1)
      .map(([id]) => id)
      .filter((id) => id !== bestId);

    const merged = mergeIdentifiersAndAliases(best, input);
    const changedCount = merged.entity.identifiers.length - best.identifiers.length;

    // Optional metadata merge. Mirrors the contract on appendAliasesAndIdentifiers
    // and UpsertBySurfaceOptions; default is no-op so existing callers are
    // unaffected.
    const mergedWithMetadata = applyMetadataMerge(
      merged.entity,
      input.metadata,
      input.metadataMerge,
      input.metadataMergeKeys,
    );
    const dirty = merged.dirty || mergedWithMetadata.changed;

    if (dirty) {
      // Dirty path mutates an existing entity — write access required.
      assertCanAccess(best, scope, 'write', 'entity');
      const next: IEntity = {
        ...mergedWithMetadata.entity,
        version: best.version + 1,
        updatedAt: new Date(),
      };
      await this.store.updateEntity(next);
      this.queueIdentityEmbedding(next, scope, best);
      this.emit({ type: 'entity.upsert', entity: next, created: false });
      return {
        entity: next,
        created: false,
        mergedIdentifiers: changedCount,
        mergeCandidates,
      };
    }

    return {
      entity: best,
      created: false,
      mergedIdentifiers: 0,
      mergeCandidates,
    };
  }

  /**
   * Resolve `permissions` for a write. Caller-supplied permissions always
   * win; when absent, consult the `visibilityPolicy` (if any). When the
   * policy returns `undefined` — or no policy is configured — leave
   * permissions undefined so the library defaults (`DEFAULT_GROUP_LEVEL` /
   * `DEFAULT_WORLD_LEVEL`) apply.
   */
  private resolvePermissions(
    explicit: Permissions | undefined,
    ctx: VisibilityContext,
  ): Permissions | undefined {
    if (explicit !== undefined) return explicit;
    return this.visibilityPolicy?.(ctx);
  }

  private async createEntity(
    input: Partial<IEntity> & {
      identifiers: Identifier[];
      displayName: string;
      type: string;
    },
    scope: ScopeFilter,
  ): Promise<UpsertEntityResult> {
    const now = new Date();
    // Owner invariant: every record must carry an ownerId. Callers can set
    // ownerId explicitly (admin delegation) or rely on scope.userId fallback.
    // When neither is present, we reject up front — the library refuses to
    // create ownerless records because the owner principal is a cornerstone of
    // access control.
    const ownerId = input.ownerId ?? scope.userId;
    if (!ownerId) {
      throw new OwnerRequiredError('entity');
    }
    // Build the NewEntity input (no id, version, createdAt, updatedAt).
    const newEntity: NewEntity = {
      type: input.type,
      displayName: input.displayName,
      aliases: input.aliases ? [...input.aliases] : undefined,
      identifiers: input.identifiers.map((i) => ({ ...i, addedAt: i.addedAt ?? now })),
      groupId: input.groupId ?? scope.groupId,
      ownerId,
      metadata: input.metadata,
      permissions: this.resolvePermissions(input.permissions, {
        kind: 'entity',
        entityType: input.type,
      }),
    };
    const entity = await this.store.createEntity(newEntity);
    this.queueIdentityEmbedding(entity, scope);
    this.emit({ type: 'entity.upsert', entity, created: true });
    return {
      entity,
      created: true,
      mergedIdentifiers: entity.identifiers.length,
      mergeCandidates: [],
    };
  }

  /**
   * Merge new aliases + identifiers into an existing entity (no-op if all are
   * already present). Bumps version, writes, emits event, and triggers identity
   * embedding refresh. Used by EntityResolver when it matches a surface to an
   * existing entity.
   */
  private async appendAliasesAndIdentifiers(
    id: EntityId,
    newAliases: string[],
    newIdentifiers: Identifier[],
    scope: ScopeFilter,
    opts?: {
      metadata?: Record<string, unknown>;
      metadataMerge?: 'fillMissing' | 'overwrite';
    },
  ): Promise<IEntity> {
    const current = await this.store.getEntity(id, scope);
    if (!current) throw new Error(`appendAliasesAndIdentifiers: entity ${id} not found`);
    assertCanAccess(current, scope, 'write', 'entity');

    const aliases = [...(current.aliases ?? [])];
    let dirty = false;
    for (const a of newAliases) {
      if (!a || a.trim().length === 0) continue;
      const exists =
        aliases.some((x) => x.toLowerCase() === a.toLowerCase()) ||
        current.displayName.toLowerCase() === a.toLowerCase();
      if (!exists) {
        aliases.push(a);
        dirty = true;
      }
    }

    const identifiers = [...current.identifiers];
    for (const ident of newIdentifiers) {
      const present = identifiers.some(
        (i) => i.kind === ident.kind && i.value.toLowerCase() === ident.value.toLowerCase(),
      );
      if (!present) {
        identifiers.push({ ...ident, addedAt: ident.addedAt ?? new Date() });
        dirty = true;
      }
    }

    // Metadata merge — fillMissing (default) never overwrites existing keys;
    // overwrite is a shallow merge where incoming wins. No-op if no incoming.
    // Coerce incoming ISO-string dates to `Date` before merge so stored
    // metadata is type-consistent and survives Mongo range queries.
    let nextMetadata: Record<string, unknown> | undefined = current.metadata;
    const incomingMetadata = coerceMetadataDates(opts?.metadata);
    if (incomingMetadata && Object.keys(incomingMetadata).length > 0) {
      const existing = (current.metadata ?? {}) as Record<string, unknown>;
      const mode = opts?.metadataMerge ?? 'fillMissing';
      const merged: Record<string, unknown> = { ...existing };
      for (const [k, v] of Object.entries(incomingMetadata)) {
        if (v === undefined) continue;
        if (mode === 'fillMissing' && k in existing) continue;
        if (!metadataDeepEqual(merged[k], v)) {
          merged[k] = v;
          dirty = true;
        }
      }
      nextMetadata = merged;
    }

    if (!dirty) return current;

    const next: IEntity = {
      ...current,
      aliases: aliases.length > 0 ? aliases : current.aliases,
      identifiers,
      metadata: nextMetadata,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    await this.store.updateEntity(next);
    this.queueIdentityEmbedding(next, scope, current);
    this.emit({ type: 'entity.upsert', entity: next, created: false });
    return next;
  }

  /**
   * Queue an identity-embedding refresh if the feature is enabled + embedder
   * present. Skips the enqueue (saving an embedder round-trip) when the new
   * identity string is identical to the previously-embedded one.
   *
   * `prior` — the entity as it existed before this write. Omit for brand-new
   * entities (no prior state to compare to).
   */
  private queueIdentityEmbedding(
    entity: IEntity,
    scope: ScopeFilter,
    prior?: IEntity,
  ): void {
    if (!this.embedder) return;
    if (this.resolutionConfig.enableIdentityEmbedding === false) return;
    const text = buildIdentityString({
      type: entity.type,
      displayName: entity.displayName,
      aliases: entity.aliases ?? [],
      identifiers: entity.identifiers,
    });
    if (prior) {
      const priorText = buildIdentityString({
        type: prior.type,
        displayName: prior.displayName,
        aliases: prior.aliases ?? [],
        identifiers: prior.identifiers,
      });
      if (priorText === text) return; // no identity change → no need to re-embed
    }
    this.queue.enqueueIdentity(entity.id, text, scope);
  }

  getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null> {
    assertNotDestroyed(this, 'getEntity');
    return this.store.getEntity(id, scope);
  }

  /**
   * Batch fetch. Returned array aligns with `ids` positionally; missing ids /
   * scope-filtered-out entries become `null`. Intended for call sites that
   * need to resolve many EntityId references cheaply (e.g. rendering
   * `fact.objectId` as a displayName in the system message).
   */
  getEntities(ids: EntityId[], scope: ScopeFilter): Promise<Array<IEntity | null>> {
    assertNotDestroyed(this, 'getEntities');
    if (ids.length === 0) return Promise.resolve([]);
    return this.store.getEntities(ids, scope);
  }

  /**
   * Return every entity visible at `scope` whose identifier list contains
   * `(kind, value)`. Thin pass-through to the store — exposed so callers that
   * need to detect bootstrap duplicates (e.g. `MemoryPluginNextGen`) don't
   * have to reach into `store` directly.
   */
  findEntitiesByIdentifier(
    kind: string,
    value: string,
    scope: ScopeFilter,
  ): Promise<IEntity[]> {
    assertNotDestroyed(this, 'findEntitiesByIdentifier');
    return this.store.findEntitiesByIdentifier(kind, value, scope);
  }

  /**
   * Configured task-state vocabulary. Read-only snapshot — arrays are copied
   * at construction so mutating the returned object does not affect behavior.
   */
  get taskStates(): TaskStatesConfig {
    return { active: [...this._taskStates.active], terminal: [...this._taskStates.terminal] };
  }

  /** True when the extraction pipeline should route `state_changed` facts through `transitionTaskState`. */
  get autoApplyTaskTransitions(): boolean {
    return this._autoApplyTaskTransitions;
  }

  searchEntities(
    query: string,
    opts: { types?: string[]; limit?: number; cursor?: string },
    scope: ScopeFilter,
  ) {
    assertNotDestroyed(this, 'searchEntities');
    return this.store.searchEntities(query, opts, scope);
  }

  /**
   * List entities by type + optional metadata equality filter. Thin pass-through
   * to the store's `listEntities` — exposed on MemorySystem so tool layers
   * don't need to reach into the store directly.
   */
  listEntities(
    filter: import('./types.js').EntityListFilter,
    opts: import('./types.js').ListOptions,
    scope: ScopeFilter,
  ) {
    assertNotDestroyed(this, 'listEntities');
    return this.store.listEntities(filter, opts, scope);
  }

  /**
   * Enumerate facts directly. Pass-through to the store's `findFacts` so tool
   * layers can list raw facts without reaching into the store. For ranked/
   * retrieval-oriented queries prefer `getContext` or `semanticSearch`.
   */
  findFacts(
    filter: FactFilter,
    opts: import('./types.js').FactQueryOptions,
    scope: ScopeFilter,
  ) {
    assertNotDestroyed(this, 'findFacts');
    return this.store.findFacts(filter, opts, scope);
  }

  /**
   * Fetch a single fact by id. Returns null when the fact does not exist or
   * is not visible to the caller's scope.
   */
  getFact(id: FactId, scope: ScopeFilter) {
    assertNotDestroyed(this, 'getFact');
    return this.store.getFact(id, scope);
  }

  /**
   * Resolve a surface form ("Microsoft", "Q3 Planning", "John") to ranked
   * candidate entities. Matching tiers: strong identifier → exact displayName →
   * exact alias → fuzzy → semantic (identityEmbedding). Returns candidates
   * sorted by confidence; empty if nothing meets `opts.threshold` (default 0.5).
   */
  resolveEntity(
    query: ResolveEntityQuery,
    scope: ScopeFilter,
    opts?: ResolveEntityOptions,
  ): Promise<EntityCandidate[]> {
    assertNotDestroyed(this, 'resolveEntity');
    return this.resolver.resolve(query, scope, opts);
  }

  /**
   * Upsert-or-resolve by surface form. If the top candidate clears
   * `autoResolveThreshold` (default conservative 0.90), returns that entity
   * with the new surface + identifiers merged in (alias accumulation).
   * Otherwise creates a new entity and reports near-matches as
   * `mergeCandidates` for deferred human review.
   */
  upsertEntityBySurface(
    input: UpsertBySurfaceInput,
    scope: ScopeFilter,
    opts?: UpsertBySurfaceOptions,
  ): Promise<UpsertBySurfaceResult> {
    assertNotDestroyed(this, 'upsertEntityBySurface');
    return this.resolver.upsertBySurface(input, scope, opts);
  }

  /**
   * Merge two entities — copy loser's identifiers + aliases onto winner, rewrite
   * every fact whose subject or object is the loser to point at the winner, and
   * archive the loser.
   *
   * **Scope-window limitation (defence-in-depth, by design):** the rewrite step
   * only touches facts visible to the caller's scope. Facts scoped more narrowly
   * than the caller (e.g. other users' private facts on either entity) are left
   * untouched and will continue to reference the archived loser. This prevents a
   * user from rewriting data they cannot see, but means a "complete" merge
   * requires a caller with broad-enough scope to see every referencing fact.
   */
  async mergeEntities(
    winnerId: EntityId,
    loserId: EntityId,
    scope: ScopeFilter,
  ): Promise<IEntity> {
    assertNotDestroyed(this, 'mergeEntities');
    if (winnerId === loserId) throw new Error('mergeEntities: winner and loser must differ');

    const winner = await this.store.getEntity(winnerId, scope);
    const loser = await this.store.getEntity(loserId, scope);
    if (!winner) {
      throw new Error(
        `mergeEntities: winner ${winnerId} not found or not visible in caller scope`,
      );
    }
    if (!loser) {
      throw new Error(
        `mergeEntities: loser ${loserId} not found or not visible in caller scope`,
      );
    }
    // Write access required on both: winner is updated (identifiers + aliases +
    // version bump), loser is archived. Either being read-only denies the merge.
    assertCanAccess(winner, scope, 'write', 'entity');
    assertCanAccess(loser, scope, 'write', 'entity');

    // Merge identifiers + aliases into winner
    const merged = mergeIdentifiersAndAliases(winner, {
      identifiers: loser.identifiers,
      aliases: loser.aliases,
    });
    const nextWinner: IEntity = {
      ...merged.entity,
      version: winner.version + 1,
      updatedAt: new Date(),
    };
    await this.store.updateEntity(nextWinner);

    // Rewrite facts: subjectId or objectId === loserId → winnerId
    await this.rewriteFactReferences(loserId, winnerId, scope);

    // Archive loser
    await this.store.archiveEntity(loserId, scope);

    this.emit({ type: 'entity.merge', winnerId, loserId });
    return nextWinner;
  }

  private async rewriteFactReferences(
    fromId: EntityId,
    toId: EntityId,
    scope: ScopeFilter,
  ): Promise<void> {
    // Permission-window caveat (composes with scope-window caveat on mergeEntities):
    // we skip facts the caller can see but cannot write. Those facts keep their
    // old reference — the merge is incomplete for that subset. Document on
    // mergeEntities; no warning here to avoid log spam.
    // Subjects
    let cursor: string | undefined;
    do {
      const page = await this.store.findFacts(
        { subjectId: fromId },
        { limit: 200, cursor },
        scope,
      );
      for (const f of page.items) {
        if (!canAccess(f, scope, 'write')) continue;
        await this.store.updateFact(f.id, { subjectId: toId }, scope);
      }
      cursor = page.nextCursor;
    } while (cursor);

    // Objects
    cursor = undefined;
    do {
      const page = await this.store.findFacts(
        { objectId: fromId },
        { limit: 200, cursor },
        scope,
      );
      for (const f of page.items) {
        if (!canAccess(f, scope, 'write')) continue;
        await this.store.updateFact(f.id, { objectId: toId }, scope);
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  async archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    assertNotDestroyed(this, 'archiveEntity');
    const entity = await this.store.getEntity(id, scope);
    if (!entity) {
      throw new Error(`archiveEntity: entity ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(entity, scope, 'write', 'entity');
    // Cascade: archive facts referencing this entity first so consumers never
    // see active edges pointing at an archived (null on getEntity) node.
    await this.archiveFactsReferencing(id, scope);
    await this.store.archiveEntity(id, scope);
    this.emit({ type: 'entity.archive', entityId: id });
  }

  async deleteEntity(
    id: EntityId,
    scope: ScopeFilter,
    opts: { hard?: boolean } = {},
  ): Promise<void> {
    assertNotDestroyed(this, 'deleteEntity');
    const entity = await this.store.getEntity(id, scope);
    if (!entity) {
      throw new Error(`deleteEntity: entity ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(entity, scope, 'write', 'entity');
    if (opts.hard) {
      // Hard delete: remove entity + every fact referencing it.
      await this.rewriteFactsForDeletion(id, scope);
      await this.store.deleteEntity(id, scope);
    } else {
      // Soft delete: archive entity + archive facts referencing it.
      await this.archiveFactsReferencing(id, scope);
      await this.store.archiveEntity(id, scope);
    }
    this.emit({ type: 'entity.archive', entityId: id });
  }

  private async rewriteFactsForDeletion(entityId: EntityId, scope: ScopeFilter): Promise<void> {
    // Permission-window caveat: we silently skip facts the caller can see but
    // cannot write (analogous to the scope-window caveat documented on
    // mergeEntities). A caller deleting an entity they own may leave behind
    // group/world facts that reference it unless they also hold write on those
    // facts. Those facts will dangle — document but don't fight it here.
    for (const filter of [{ subjectId: entityId }, { objectId: entityId }]) {
      let cursor: string | undefined;
      do {
        const page = await this.store.findFacts(filter, { limit: 200, cursor }, scope);
        for (const f of page.items) {
          if (!canAccess(f, scope, 'write')) continue;
          await this.store.updateFact(f.id, { archived: true }, scope);
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
  }

  private async archiveFactsReferencing(entityId: EntityId, scope: ScopeFilter): Promise<void> {
    for (const filter of [{ subjectId: entityId }, { objectId: entityId }]) {
      let cursor: string | undefined;
      do {
        const page = await this.store.findFacts(filter, { limit: 200, cursor }, scope);
        for (const f of page.items) {
          if (!canAccess(f, scope, 'write')) continue;
          await this.store.updateFact(f.id, { archived: true }, scope);
          this.emit({ type: 'fact.archive', factId: f.id });
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
  }

  // ==========================================================================
  // Facts
  // ==========================================================================

  /**
   * Normalize a predicate string to its canonical form. When no registry is
   * configured, returns the input unchanged.
   *
   * Used by ExtractionResolver and available to external callers that want to
   * pre-normalize predicates before querying.
   */
  canonicalizePredicate(input: string): string {
    return this.predicates ? this.predicates.canonicalize(input) : input;
  }

  /** True when a predicate registry is configured on this MemorySystem. */
  hasPredicateRegistry(): boolean {
    return !!this.predicates;
  }

  /**
   * H7: ensure the configured adapter has all recommended indexes. No-op for
   * adapters that don't expose `ensureIndexes` (InMemoryAdapter has nothing
   * to index). Delegates to the adapter's own method — typically
   * `MongoMemoryAdapter.ensureIndexes()`. Idempotent.
   *
   * **Call from your migration system, not from application hot paths.**
   * Index creation on production collections can be expensive; the library
   * intentionally does not call this automatically at construction time.
   *
   * See `docs/MEMORY_PERMISSIONS.md` (or the memory README) for the full
   * list of recommended indexes and why each matters. Cross-process
   * deployments with MemoryPluginNextGen additionally need a unique index on
   * `{identifiers.kind: 1, identifiers.value: 1}` (partial, filtered on
   * `identifiers.$.value: {$exists: true}`) — this one is not created by
   * `ensureIndexes()` because adding a unique index to a collection with
   * existing duplicates fails hard; callers should build + verify it
   * explicitly in a migration.
   */
  async ensureAdapterIndexes(): Promise<void> {
    const withIndexes = this.store as unknown as {
      ensureIndexes?: () => Promise<void>;
    };
    if (typeof withIndexes.ensureIndexes === 'function') {
      await withIndexes.ensureIndexes();
    }
  }

  /** Lookup a predicate definition (by canonical name or alias). Null when no registry or unknown. */
  getPredicateDefinition(nameOrAlias: string): PredicateDefinition | null {
    return this.predicates?.get(nameOrAlias) ?? null;
  }

  /**
   * H5: the configured drift policy + closest known predicate for an unknown.
   * Returns `{ policy: 'fuzzy_map', mappedTo? }` / `{ policy: 'keep' }` /
   * `{ policy: 'drop' }`. `mappedTo` is only present when the policy is
   * `'fuzzy_map'` AND a close registry match exists. Intended for callers
   * (`ExtractionResolver`) that want to apply the policy themselves and record
   * the decision in their result payload.
   */
  resolveUnknownPredicate(canonical: string): {
    policy: 'fuzzy_map' | 'keep' | 'drop';
    mappedTo?: string;
    distance?: number;
  } {
    if (!this.predicates) return { policy: 'keep' };
    if (this.unknownPredicatePolicy !== 'fuzzy_map') {
      return { policy: this.unknownPredicatePolicy };
    }
    // F3: let caller-configured absolute cap tighten the default budget.
    const opts = this.unknownPredicateFuzzyMaxDistance !== undefined
      ? { maxDistance: this.unknownPredicateFuzzyMaxDistance }
      : undefined;
    const hit = this.predicates.findClosest(canonical, opts);
    if (hit) return { policy: 'fuzzy_map', mappedTo: hit.name, distance: hit.distance };
    return { policy: 'fuzzy_map' }; // no mapping — caller falls back to keep
  }

  async addFact(
    input: Partial<IFact> & {
      subjectId: EntityId;
      predicate: string;
      kind: IFact['kind'];
      /**
       * When true: before inserting, look for a non-archived fact with the same
       * (subjectId, canonicalized predicate, kind) and matching (value, objectId).
       * On match → bump `observedAt` on the existing fact and return it — NO new
       * row is inserted. Used by the session ingestor to prevent bloat across
       * repeated observations ("anton works_at everworker" re-extracted).
       * Details merging is the caller's responsibility (see updateFactDetails).
       * Defaults to false for backward-compatibility.
       */
      dedup?: boolean;
    },
    scope: ScopeFilter,
  ): Promise<IFact> {
    assertNotDestroyed(this, 'addFact');

    // Coerce ISO-string temporal fields (`observedAt`, `validFrom`, `validUntil`)
    // and any ISO-date strings in `metadata` to `Date`. These fields are typed
    // `Date | undefined` on `IFact`, so a string here is a contract violation
    // we silently repair — a string in Mongo silently breaks `$gte/$lt` queries.
    input = coerceFactTemporalFields(input);

    // Reject empty/whitespace predicates regardless of mode — these are almost
    // always a caller bug and corrupt ranking/retrieval if they land in storage.
    if (typeof input.predicate !== 'string' || input.predicate.trim().length === 0) {
      throw new Error('addFact: predicate must be a non-empty string');
    }

    // Reject self-referential facts. A fact (A, p, A) is almost always a
    // caller bug — if a legitimate self-loop is ever needed for a specific
    // predicate we can opt that predicate in explicitly.
    if (input.objectId !== undefined && input.objectId === input.subjectId) {
      throw new Error(
        `addFact: subjectId and objectId must differ (self-referential facts not allowed)`,
      );
    }

    // Kind validation — the storage type is `'atomic' | 'document'` but TS
    // unions aren't enforced at runtime. LLM-driven callers (extractors) can
    // emit any string; unknown kinds silently break computeIsSemantic,
    // findFacts({kind}), graph traversal, and profile-regen gating. Reject
    // at the boundary.
    if (input.kind !== 'atomic' && input.kind !== 'document') {
      throw new Error(
        `addFact: kind must be 'atomic' or 'document', got '${String(input.kind)}'`,
      );
    }

    // Mutual exclusion — a fact is either relational (objectId) or attribute
    // (value). Storing both creates ambiguous records (findFacts by
    // predicate+objectId and by predicate+value both match).
    if (input.value !== undefined && input.objectId !== undefined) {
      throw new Error(
        'addFact: must set either value or objectId, not both',
      );
    }

    // Predicate canonicalization + registry-driven defaults.
    // When no registry is configured, `predicate` is left as-is and `def` is
    // undefined — addFact behaves exactly as before.
    const predicate = this.predicates
      ? this.predicates.canonicalize(input.predicate)
      : input.predicate;
    if (
      this.predicateMode === 'strict' &&
      this.predicates &&
      !this.predicates.has(predicate)
    ) {
      throw new Error(
        `addFact: predicate '${input.predicate}' (canonical: '${predicate}') ` +
          `not in registry. Use predicateMode='permissive' or register the predicate.`,
      );
    }
    const def = this.predicates?.get(predicate);

    // Dedup fast path — opt-in, used by the session ingestor. Skips the full
    // validation/insert path when an equivalent non-archived fact already
    // exists, bumping its observedAt so ranking stays fresh. Runs BEFORE
    // subject loading because on match we don't need the subject at all.
    if (input.dedup === true) {
      const existing = await this.findDedupMatch(input, predicate, scope);
      // Writing to an existing fact (bumping observedAt) requires write
      // access — matching via `findDedupMatch` only proves READ (group/world
      // read-visible facts can also match). On write-denied, fall through
      // to the insert path so a new fact is created under the caller's
      // own scope rather than mutating someone else's.
      if (existing && canAccess(existing, scope, 'write')) {
        const now = input.observedAt ?? new Date();
        await this.store.updateFact(existing.id, { observedAt: now }, scope);
        return { ...existing, observedAt: now };
      }
    }

    const subject = await this.store.getEntity(input.subjectId, scope);
    if (!subject) throw new Error(`addFact: subject entity ${input.subjectId} not found`);

    // Object visibility check — a caller must not be able to create a relational
    // fact that references an entity outside their scope, since doing so would
    // leak the object's existence via subsequent findFacts({objectId}) or
    // traversal queries.
    if (input.objectId) {
      const object = await this.store.getEntity(input.objectId, scope);
      if (!object) {
        throw new Error(
          `addFact: object entity ${input.objectId} not visible or not found`,
        );
      }
    }

    // Context visibility check — same reasoning as object. Every entity listed
    // in contextIds must be visible to the caller.
    if (input.contextIds && input.contextIds.length > 0) {
      for (const cid of input.contextIds) {
        const ent = await this.store.getEntity(cid, scope);
        if (!ent) {
          throw new Error(
            `addFact: context entity ${cid} not visible or not found`,
          );
        }
      }
    }

    const factScope = deriveFactScope(input, subject, scope);
    if (!factScope.ownerId) {
      // Owner invariant: every fact must carry an ownerId. deriveFactScope
      // falls back to input.ownerId → subject.ownerId → undefined. Undefined
      // means the caller provided none AND the subject entity is itself
      // ownerless (legacy data). Reject explicitly.
      throw new OwnerRequiredError('fact');
    }
    assertScopeInvariant(subject, factScope);

    // Auto-supersede for singleValued predicates (e.g. current_title, has_due_date).
    // Only fires when: registry knows the predicate, it's marked singleValued,
    // auto-supersede is enabled, and the caller did not set `supersedes` already.
    //
    // Scope caveat (H3): findFacts is scope-bounded. A prior fact in an outer
    // scope (group-shared / global) invisible to the caller will NOT be
    // superseded here — isolation is deliberate, but callers should know. We
    // emit a `fact.supersede_skipped_outer_scope` ChangeEvent below when this
    // happens so observers (logs, metrics) can flag the drift. Detection uses
    // an admin-widened scope read — the event fires only for singleValued
    // predicates, so the extra lookup is scoped to the narrow auto-supersede
    // hot path.
    let supersedes = input.supersedes;
    if (!supersedes && this.predicateAutoSupersede && def?.singleValued) {
      const prior = await this.store.findFacts(
        { subjectId: input.subjectId, predicate, archived: false },
        { limit: 1, orderBy: { field: 'createdAt', direction: 'desc' } },
        scope,
      );
      if (prior.items.length > 0) {
        supersedes = prior.items[0]!.id;
      } else {
        // Caller couldn't see any prior in their scope. Check whether an outer
        // scope holds one — if yes, we're about to create a per-scope "current"
        // that coexists with an outer one. Emit a signal.
        const outer = await this.findOuterScopePrior(
          input.subjectId,
          predicate,
          scope,
        );
        if (outer) {
          this.emit({
            type: 'fact.supersede_skipped_outer_scope',
            subjectId: input.subjectId,
            predicate,
            outerFactId: outer.id,
            callerScope: {
              ownerId: scope.userId,
              groupId: scope.groupId,
            },
          });
        }
      }
    }

    const now = new Date();
    const newFact: NewFact = {
      subjectId: input.subjectId,
      predicate,
      kind: input.kind,
      objectId: input.objectId,
      value: input.value,
      details: input.details,
      summaryForEmbedding: input.summaryForEmbedding,
      embedding: input.embedding,
      isSemantic: input.isSemantic ?? computeIsSemantic(input),
      // Clamp to [0,1] at the boundary — LLM callers may emit out-of-range
      // values that would corrupt ranking. Applies to caller-supplied
      // values only; registry defaults (def?.defaultImportance) are trusted.
      //
      // H6: default unset confidence to 1.0 (matches Ranking.ts interpretation
      // of missing confidence). Storing an explicit value means the Mongo
      // minConfidence filter can drop the `$exists:false` branch — callers
      // asking "give me facts with confidence ≥ X" no longer get un-scored
      // legacy facts mixed into high-quality results.
      confidence: clampUnit01(input.confidence) ?? 1.0,
      evidenceQuote: input.evidenceQuote,
      sourceSignalId: input.sourceSignalId,
      derivedBy: input.derivedBy,
      importance: clampUnit01(input.importance) ?? def?.defaultImportance,
      contextIds: input.contextIds && input.contextIds.length > 0 ? input.contextIds : undefined,
      supersedes,
      archived: input.archived,
      isAggregate: input.isAggregate ?? def?.isAggregate,
      observedAt: input.observedAt ?? now,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      metadata: input.metadata,
      permissions: this.resolvePermissions(input.permissions, {
        kind: 'fact',
        predicate,
        factKind: input.kind,
      }),
      groupId: factScope.groupId,
      ownerId: factScope.ownerId,
    };

    // Supersession write check — caller must have write access to the
    // predecessor fact they're archiving. This may differ from read access
    // (e.g. a group-readable record with permissions.group='read' is not
    // group-writable). Loading first with scope-read filter distinguishes
    // "not found/invisible" from "visible but denied".
    //
    // We also enforce that the predecessor lives on the same subject: a
    // supersession chain must stay per-subject or retrieval semantics break
    // ("what superseded F1?" would return a fact about a different subject).
    if (supersedes) {
      const predecessor = await this.store.getFact(supersedes, scope);
      if (!predecessor) {
        throw new Error(
          `addFact: predecessor fact ${supersedes} not found or not visible in caller scope`,
        );
      }
      assertCanAccess(predecessor, scope, 'write', 'fact');
      if (predecessor.subjectId !== input.subjectId) {
        throw new Error(
          `addFact: predecessor ${supersedes} has subjectId=${predecessor.subjectId}, ` +
            `but new fact targets ${input.subjectId} (supersession chains are per-subject)`,
        );
      }
    }

    // Crash-safe supersession: write the new fact first, THEN archive the
    // predecessor. If the process dies between the two, the worst case is a
    // recoverable duplicate (old + new both visible), not an invisible gap.
    // Adapters with native transactions can make this truly atomic.
    const fact = await this.store.createFact(newFact);
    if (fact.supersedes) {
      await this.store.updateFact(fact.supersedes, { archived: true }, scope);
    }

    if (fact.supersedes) {
      this.emit({ type: 'fact.supersede', oldId: fact.supersedes, newId: fact.id });
    }
    this.emit({ type: 'fact.add', fact });

    // Queue embedding if eligible.
    if (fact.isSemantic && this.embedder && !fact.embedding) {
      const text = fact.summaryForEmbedding ?? fact.details ?? '';
      if (text.length > 0) {
        this.queue.enqueue(fact.id, text, scope);
      }
    }

    // Profile regen check for atomic facts only.
    if (fact.kind === 'atomic' && this.profileGenerator) {
      void this.maybeRegenerateProfile(fact.subjectId, factScope);
    }

    return fact;
  }

  async addFacts(
    inputs: Array<
      Partial<IFact> & { subjectId: EntityId; predicate: string; kind: IFact['kind'] }
    >,
    scope: ScopeFilter,
  ): Promise<IFact[]> {
    const results: IFact[] = [];
    for (const input of inputs) {
      results.push(await this.addFact(input, scope));
    }
    return results;
  }

  supersedeFact(
    oldId: FactId,
    newInput: Partial<IFact> & { predicate: string; kind: IFact['kind']; subjectId: EntityId },
    scope: ScopeFilter,
  ): Promise<IFact> {
    return this.addFact({ ...newInput, supersedes: oldId }, scope);
  }

  async archiveFact(id: FactId, scope: ScopeFilter): Promise<void> {
    assertNotDestroyed(this, 'archiveFact');
    const fact = await this.store.getFact(id, scope);
    if (!fact) {
      throw new Error(`archiveFact: fact ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(fact, scope, 'write', 'fact');
    await this.store.updateFact(id, { archived: true }, scope);
    this.emit({ type: 'fact.archive', factId: id });
  }

  /**
   * Reverse of `archiveFact` — restore a previously-archived fact so it
   * participates in queries again. Used by the `memory_restore` tool to give
   * agents an undo path for mistaken archives.
   *
   * F1 guard: if the target fact was archived as part of a supersession
   * (i.e. another non-archived fact has `supersedes: targetId`), restoring it
   * would create two "current" facts for the same (subject, predicate) pair.
   * Throws `FactSupersededError` with the successor's id so callers can
   * handle the successor first. The tool layer surfaces this as a structured
   * error to the LLM.
   */
  async restoreFact(id: FactId, scope: ScopeFilter): Promise<void> {
    assertNotDestroyed(this, 'restoreFact');
    // `getFact` returns archived facts too — no archived filter applied.
    const fact = await this.store.getFact(id, scope);
    if (!fact) {
      throw new Error(`restoreFact: fact ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(fact, scope, 'write', 'fact');
    if (!fact.archived) return; // idempotent — nothing to do.

    // F1: detect an existing non-archived successor. `findFacts` defaults to
    // hiding archived, so a hit here means "live successor".
    const successors = await this.store.findFacts(
      { supersedes: id },
      { limit: 1 },
      scope,
    );
    if (successors.items.length > 0) {
      throw new FactSupersededError(id, successors.items[0]!.id);
    }

    await this.store.updateFact(id, { archived: false }, scope);
    this.emit({ type: 'fact.restore', factId: id });
  }

  /**
   * Update an existing fact's `details` field in place. Intended for merging
   * narrative context when the session ingestor finds a duplicate fact and
   * produces an LLM-merged details string. Recomputes `isSemantic` (the merged
   * text may cross the length threshold), clears the stale embedding, and
   * re-embeds if an embedder is configured.
   *
   * This mutates the fact — the prior `details` is lost. Use supersession if
   * you need the full audit chain.
   */
  async updateFactDetails(
    id: FactId,
    details: string,
    scope: ScopeFilter,
  ): Promise<IFact> {
    assertNotDestroyed(this, 'updateFactDetails');
    const fact = await this.store.getFact(id, scope);
    if (!fact) {
      throw new Error(`updateFactDetails: fact ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(fact, scope, 'write', 'fact');

    const isSemantic = computeIsSemantic({ ...fact, details });
    const patch: Partial<IFact> = {
      details,
      isSemantic,
      embedding: undefined,
      summaryForEmbedding: undefined,
    };
    await this.store.updateFact(id, patch, scope);

    if (isSemantic && this.embedder && details.length > 0) {
      try {
        const vec = await this.embedder.embed(details);
        await this.store.updateFact(id, { embedding: vec }, scope);
      } catch (err) {
        // Embedding failure is non-fatal — the fact is still retrievable by
        // id/filter, just not via semanticSearch until re-embedding succeeds.
        this.emit({
          type: 'fact.embedding.failed',
          factId: id,
          entityId: null,
          attempts: 1,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const updated = await this.store.getFact(id, scope);
    return updated ?? { ...fact, ...patch };
  }

  private async findDedupMatch(
    input: Partial<IFact>,
    canonicalPredicate: string,
    scope: ScopeFilter,
  ): Promise<IFact | null> {
    if (!input.subjectId || !input.kind) return null;
    // Scan same-subject same-predicate same-kind non-archived facts. We cap at
    // a small page — duplicates realistically cluster, not sprawl — and match
    // exactly on (value, objectId).
    const page = await this.store.findFacts(
      {
        subjectId: input.subjectId,
        predicate: canonicalPredicate,
        kind: input.kind,
        archived: false,
      },
      { limit: 50, orderBy: { field: 'createdAt', direction: 'desc' } },
      scope,
    );
    for (const f of page.items) {
      // H4: dedup is case/whitespace-insensitive on string values. LLM
      // extraction is non-deterministic in capitalisation/whitespace; without
      // normalisation, `"Alice"` / `"alice"` / `"Alice "` produce three facts
      // for the same knowledge. Object values fall back to stableEqual
      // (key-sorted deep equality).
      const sameValue = dedupValueEqual(f.value, input.value);
      const sameObject = (f.objectId ?? null) === (input.objectId ?? null);
      if (sameValue && sameObject) return f;
    }
    return null;
  }

  /**
   * H3: look for a same-subject same-predicate non-archived fact that lives
   * OUTSIDE the caller's scope (group-shared or global) — used by addFact's
   * auto-supersede path to detect when a caller-scope write will coexist with
   * an invisible outer "current" value.
   *
   * Only invoked on the narrow singleValued-predicate auto-supersede branch
   * when the caller's own scope has no prior; the widened admin scope adds
   * one extra read per such write, not a general overhead.
   */
  private async findOuterScopePrior(
    subjectId: EntityId,
    predicate: string,
    callerScope: ScopeFilter,
  ): Promise<IFact | null> {
    // Admin scope: no userId, no groupId → sees everything.
    const all = await this.store.findFacts(
      { subjectId, predicate, archived: false },
      { limit: 10, orderBy: { field: 'createdAt', direction: 'desc' } },
      {},
    );
    for (const f of all.items) {
      // Skip anything that WOULD be visible to the caller — those cases
      // already use supersedes. We're looking for the outer-scope "current".
      if (callerScope.userId && f.ownerId === callerScope.userId) continue;
      // A group-scoped fact (no ownerId, specific groupId) may still be
      // visible to the caller if they're in that group — that's already
      // handled by the caller-scope query. Anything remaining is genuinely
      // outside the caller's view.
      return f;
    }
    return null;
  }

  /**
   * Find an existing non-archived fact matching the `(subjectId, predicate,
   * kind, value, objectId)` signature of `input`. Returns null on no match.
   *
   * Exposed for callers (the session ingestor) that need to split insert vs
   * merge paths themselves — e.g. to batch LLM-based details merging across
   * several duplicates rather than merging one at a time.
   *
   * Predicate is canonicalized via the registry (if one is configured) so
   * aliases match the same way `addFact` would treat them.
   */
  async findDuplicateFact(
    input: Partial<IFact> & {
      subjectId: EntityId;
      predicate: string;
      kind: IFact['kind'];
    },
    scope: ScopeFilter,
  ): Promise<IFact | null> {
    assertNotDestroyed(this, 'findDuplicateFact');
    const canonical = this.predicates
      ? this.predicates.canonicalize(input.predicate)
      : input.predicate;
    return this.findDedupMatch(input, canonical, scope);
  }

  // ==========================================================================
  // Retrieval
  // ==========================================================================

  async getContext(
    entityId: EntityId,
    opts: ContextOptions,
    scope: ScopeFilter,
  ): Promise<EntityView> {
    assertNotDestroyed(this, 'getContext');
    const entity = await this.store.getEntity(entityId, scope);
    if (!entity) throw new Error(`getContext: entity ${entityId} not found`);

    const now = new Date();
    const topFactsLimit = opts.topFactsLimit ?? DEFAULT_TOP_FACTS_LIMIT;
    const includeSet = new Set(opts.include ?? []);

    const [profile, candidatePage] = await Promise.all([
      this.getProfile(entityId, scope),
      this.store.findFacts(
        {
          // touchesEntity: subject OR object OR contextIds includes entityId.
          // Broader than v1 (subject-only) — enables "activity around this deal"
          // queries where the deal is referenced via contextIds.
          touchesEntity: entityId,
          kind: 'atomic',
          minConfidence: this.ranking.minConfidence,
          asOf: opts.asOf,
        },
        {
          // Fetch a superset; we re-rank in memory for confidence × recency × predicate weight × importance.
          limit: topFactsLimit * 3,
          orderBy: { field: 'observedAt', direction: 'desc' },
        },
        scope,
      ),
    ]);

    const topFacts = rankFacts(candidatePage.items, this.ranking, now).slice(0, topFactsLimit);

    const view: EntityView = { entity, profile, topFacts };

    // Default-on tiers: relatedTasks + relatedEvents (unless caller opted out).
    if (opts.tiers !== 'minimal') {
      view.relatedTasks = await this.resolveRelatedTasks(entityId, opts, scope);
      view.relatedEvents = await this.resolveRelatedEvents(entityId, opts, scope);
    }

    if (includeSet.has('documents')) {
      const docPredicates = opts.documentPredicates ?? [];
      const docPage = await this.store.findFacts(
        {
          subjectId: entityId,
          kind: 'document',
          predicates: docPredicates.length > 0 ? docPredicates : undefined,
          asOf: opts.asOf,
        },
        { limit: 50, orderBy: { field: 'createdAt', direction: 'desc' } },
        scope,
      );
      // Exclude the profile fact — it is surfaced separately as `view.profile`.
      view.documents = docPage.items.filter(
        (f) => !(f.predicate === 'profile' && f.id === profile?.id),
      );
    }

    if (includeSet.has('semantic') && opts.semanticQuery) {
      try {
        view.semantic = await this.semanticSearch(
          opts.semanticQuery,
          { subjectId: entityId, asOf: opts.asOf },
          scope,
          opts.semanticTopK ?? DEFAULT_SEMANTIC_TOP_K,
        );
      } catch (err) {
        if (!(err instanceof SemanticSearchUnavailableError)) throw err;
        // Graceful degradation: semantic tier absent.
      }
    }

    if (includeSet.has('neighbors')) {
      view.neighbors = await this.traverse(
        entityId,
        {
          direction: 'both',
          maxDepth: opts.neighborDepth ?? DEFAULT_NEIGHBOR_DEPTH,
          predicates: opts.neighborPredicates,
          asOf: opts.asOf,
          limit: 100,
        },
        scope,
      );
    }

    return view;
  }

  /**
   * Tasks related to a subject entity. Finds task entities (type='task') where
   * any of the common relational metadata fields point at the subject, OR
   * where a relational fact ties a task to the subject. Returns only non-
   * terminal states by default.
   */
  /**
   * Multi-entity public traversal used by external pipelines (e.g. v25
   * reconciler relevance set). Resolves tasks + events that touch ANY of
   * `entityIds` via metadata role fields or fact contextIds, dedupes by id,
   * and tags each hit with the input entity that matched it (so callers can
   * trace why an item is in the set).
   *
   * Cost: O(entityIds.length) underlying queries. Suitable for relevance-set
   * construction over a handful (~5–20) of input entities.
   *
   * **Limit semantics**: `limit` is a *per-bucket* cap — the result holds at
   * most `limit` tasks AND at most `limit` events (so up to `2 * limit` items
   * total). Default 50, hard ceiling 200 per bucket.
   *
   * **Attribution**: when `limit` is reached, later `entityIds` do not
   * contribute attribution — the first input entity to surface a given hit
   * wins `matchedEntityId`. Pass entities ordered by relevance.
   */
  async resolveRelatedItems(
    entityIds: EntityId[],
    scope: ScopeFilter,
    opts?: {
      types?: ('task' | 'event')[];
      /** Task state filter. Default: configured `taskStates.active`. Pass empty array to disable filtering. */
      taskStates?: string[];
      /** Per-bucket cap (tasks and events each capped at this value). Default 50, hard ceiling 200. */
      limit?: number;
      asOf?: Date;
      recentEventsWindowDays?: number;
    },
  ): Promise<RelatedItemsResult> {
    assertNotDestroyed(this, 'resolveRelatedItems');
    const types = opts?.types ?? ['task', 'event'];
    const wantTasks = types.includes('task');
    const wantEvents = types.includes('event');
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);

    // Re-use the per-entity resolvers and reshape into the multi-entity view.
    const taskCtxOpts: ContextOptions & { activeStatesOverride?: readonly string[] } = {
      relatedTasksLimit: limit,
      relatedEventsLimit: limit,
      asOf: opts?.asOf,
      recentEventsWindowDays: opts?.recentEventsWindowDays,
      activeStatesOverride: opts?.taskStates,
    };
    const eventCtxOpts: ContextOptions = {
      relatedEventsLimit: limit,
      asOf: opts?.asOf,
      recentEventsWindowDays: opts?.recentEventsWindowDays,
    };

    const tasksById = new Map<EntityId, RelatedItemHit<RelatedTask>>();
    const eventsById = new Map<EntityId, RelatedItemHit<RelatedEvent>>();

    for (const eid of entityIds) {
      if (tasksById.size >= limit && eventsById.size >= limit) break;
      if (wantTasks) {
        const hits = await this.resolveRelatedTasks(eid, taskCtxOpts, scope);
        for (const h of hits) {
          if (!tasksById.has(h.task.id) && tasksById.size < limit) {
            tasksById.set(h.task.id, { ...h, matchedEntityId: eid });
          }
        }
      }
      if (wantEvents) {
        const hits = await this.resolveRelatedEvents(eid, eventCtxOpts, scope);
        for (const h of hits) {
          if (!eventsById.has(h.event.id) && eventsById.size < limit) {
            eventsById.set(h.event.id, { ...h, matchedEntityId: eid });
          }
        }
      }
    }

    return {
      tasks: [...tasksById.values()],
      events: [...eventsById.values()],
    };
  }

  /**
   * Semantic kNN over open task summaries. Embeds `queryText` and ranks active
   * tasks by similarity against their identityEmbedding (which covers
   * displayName + aliases + primary identifier values — typically the task
   * summary). Used by the v25 reconciler to catch cross-channel mentions
   * ("the JPM thing") that don't share a contextId with the new signal.
   *
   * Returns empty array when no embedder/semantic adapter is configured —
   * callers should treat semantic similarity as opportunistic, not load-bearing.
   */
  async findSimilarOpenTasks(
    queryText: string,
    scope: ScopeFilter,
    opts?: {
      topK?: number;
      minScore?: number;
      taskStates?: string[];
    },
  ): Promise<Array<{ task: IEntity; score: number }>> {
    assertNotDestroyed(this, 'findSimilarOpenTasks');
    // Clamp caller-supplied limits per project convention (topK ≤ 100). Guards
    // against an LLM-driven caller asking for 100k results — the over-fetch
    // multiplier below would otherwise issue a 300k-row vector search.
    const requestedTopK = Number.isFinite(opts?.topK) ? (opts!.topK as number) : 10;
    const topK = Math.min(Math.max(Math.trunc(requestedTopK), 1), 100);
    const requestedMin = Number.isFinite(opts?.minScore) ? (opts!.minScore as number) : 0;
    const minScore = Math.min(Math.max(requestedMin, 0), 1);
    const activeStates =
      opts?.taskStates && opts.taskStates.length > 0
        ? opts.taskStates
        : this._taskStates.active;

    if (!this.embedder) return [];
    if (typeof this.store.semanticSearchEntities !== 'function') return [];

    let queryVector: number[];
    try {
      queryVector = await this.embedder.embed(queryText);
    } catch (err) {
      console.warn('[MemorySystem.findSimilarOpenTasks] embed failed:', err);
      return [];
    }

    let candidates: Array<{ entity: IEntity; score: number }>;
    try {
      // Over-fetch with a real floor so small `topK` still survives the
      // post-state-filter (e.g. topK=1 would otherwise pull only 3 rows; if all
      // are terminal the result is empty when an active match existed at rank 4).
      const overFetch = Math.min(Math.max(topK * 3, FIND_SIMILAR_OVER_FETCH_FLOOR), 300);
      candidates = await this.store.semanticSearchEntities(
        queryVector,
        { type: 'task' },
        { topK: overFetch, minScore },
        scope,
      );
    } catch (err) {
      console.warn('[MemorySystem.findSimilarOpenTasks] semanticSearchEntities failed:', err);
      return [];
    }

    const out: Array<{ task: IEntity; score: number }> = [];
    for (const c of candidates) {
      if (c.score < minScore) continue;
      const state = (c.entity.metadata as Record<string, unknown> | undefined)?.state;
      if (typeof state !== 'string' || !activeStates.includes(state)) continue;
      out.push({ task: c.entity, score: c.score });
      if (out.length >= topK) break;
    }
    return out;
  }

  private async resolveRelatedTasks(
    entityId: EntityId,
    opts: ContextOptions & { activeStatesOverride?: readonly string[] },
    scope: ScopeFilter,
  ): Promise<RelatedTask[]> {
    const limit = opts.relatedTasksLimit ?? 15;
    const acc = new Map<EntityId, RelatedTask>();

    const activeStates =
      opts.activeStatesOverride && opts.activeStatesOverride.length > 0
        ? [...opts.activeStatesOverride]
        : this._taskStates.active;
    for (const role of RELATIONAL_TASK_FIELDS) {
      if (acc.size >= limit) break;
      const page = await this.store.listEntities(
        {
          type: 'task',
          metadataFilter: {
            [role]: entityId,
            state: { $in: activeStates },
          },
        },
        { limit: limit - acc.size },
        scope,
      );
      for (const t of page.items) {
        if (!acc.has(t.id)) acc.set(t.id, { task: t, role: ROLE_BY_FIELD[role]! });
      }
    }

    // Also include tasks where `entityId` appears in contextIds of any fact
    // whose subject is a task entity.
    if (acc.size < limit) {
      const contextFacts = await this.store.findFacts(
        { contextId: entityId, kind: 'atomic', asOf: opts.asOf },
        { limit: 200 },
        scope,
      );
      const seenTaskIds = new Set<EntityId>();
      for (const f of contextFacts.items) {
        seenTaskIds.add(f.subjectId);
        if (f.objectId) seenTaskIds.add(f.objectId);
      }
      for (const tid of seenTaskIds) {
        if (acc.has(tid) || acc.size >= limit) continue;
        const t = await this.store.getEntity(tid, scope);
        if (!t || t.type !== 'task') continue;
        const state = (t.metadata as Record<string, unknown> | undefined)?.state;
        if (!activeStates.includes(state as string)) continue;
        acc.set(t.id, { task: t, role: 'context_of' });
      }
    }

    return [...acc.values()].slice(0, limit);
  }

  /**
   * Events related to a subject entity. Finds event entities in a recent
   * window where subject is the designated attendee/host/reference, plus
   * events surfacing via contextIds on facts about the subject.
   */
  private async resolveRelatedEvents(
    entityId: EntityId,
    opts: ContextOptions,
    scope: ScopeFilter,
  ): Promise<RelatedEvent[]> {
    const limit = opts.relatedEventsLimit ?? 15;
    const windowDays = opts.recentEventsWindowDays ?? 90;
    const windowStart = new Date(Date.now() - windowDays * 86_400_000);

    const acc = new Map<EntityId, RelatedEvent>();

    // Events where this entity is in attendeeIds (simple equality — adapters
    // don't yet support array-membership on metadataFilter, so fall back to
    // listing events in window and filtering client-side here).
    // For now we query by group and filter in-memory; this is still bounded
    // because we cap with `limit: 200`.
    const eventsPage = await this.store.listEntities(
      { type: 'event' },
      { limit: 200 },
      scope,
    );
    for (const ev of eventsPage.items) {
      if (acc.size >= limit) break;
      const md = (ev.metadata ?? {}) as Record<string, unknown>;
      const startTime = toDateMaybe(md.startTime);
      if (startTime && startTime < windowStart) continue;
      const attendeeIds = Array.isArray(md.attendeeIds) ? (md.attendeeIds as string[]) : [];
      const hostId = typeof md.hostId === 'string' ? md.hostId : undefined;
      let role: string | null = null;
      if (attendeeIds.includes(entityId)) role = 'attended';
      else if (hostId === entityId) role = 'hosted';
      if (!role) continue;
      acc.set(ev.id, { event: ev, role, when: startTime });
    }

    // Also include events where entity appears in contextIds of facts whose
    // subject or object is an event entity.
    if (acc.size < limit) {
      const contextFacts = await this.store.findFacts(
        { contextId: entityId, kind: 'atomic', asOf: opts.asOf },
        { limit: 200 },
        scope,
      );
      const candidateIds = new Set<EntityId>();
      for (const f of contextFacts.items) {
        candidateIds.add(f.subjectId);
        if (f.objectId) candidateIds.add(f.objectId);
      }
      for (const cid of candidateIds) {
        if (acc.has(cid) || acc.size >= limit) continue;
        const ev = await this.store.getEntity(cid, scope);
        if (!ev || ev.type !== 'event') continue;
        const md = (ev.metadata ?? {}) as Record<string, unknown>;
        const startTime = toDateMaybe(md.startTime);
        acc.set(ev.id, { event: ev, role: 'context_of', when: startTime });
      }
    }

    // Third tier: walk `attended` / `hosted` facts where subject=entity and
    // object is an event. Covers the case where attendance was recorded as a
    // relational fact (e.g. seeded by CalendarSignalAdapter.seedFacts or
    // emitted by an LLM) rather than as attendeeIds metadata.
    if (acc.size < limit) {
      for (const predicate of ['attended', 'hosted'] as const) {
        if (acc.size >= limit) break;
        const facts = await this.store.findFacts(
          { subjectId: entityId, predicate, kind: 'atomic', asOf: opts.asOf },
          { limit: 100 },
          scope,
        );
        for (const f of facts.items) {
          if (!f.objectId || acc.has(f.objectId) || acc.size >= limit) continue;
          const ev = await this.store.getEntity(f.objectId, scope);
          if (!ev || ev.type !== 'event') continue;
          const md = (ev.metadata ?? {}) as Record<string, unknown>;
          const startTime = toDateMaybe(md.startTime);
          if (startTime && startTime < windowStart) continue;
          acc.set(ev.id, { event: ev, role: predicate, when: startTime });
        }
      }
    }

    return [...acc.values()].slice(0, limit);
  }

  /**
   * Shallow-merge a patch into entity.metadata. Version-bumping, scope-checked,
   * emits entity.upsert event. Caller does NOT read-modify-write — this helper
   * handles all of that atomically (from the caller's perspective).
   */
  async updateEntityMetadata(
    id: EntityId,
    patch: Record<string, unknown>,
    scope: ScopeFilter,
  ): Promise<IEntity> {
    assertNotDestroyed(this, 'updateEntityMetadata');
    const current = await this.store.getEntity(id, scope);
    if (!current) throw new Error(`updateEntityMetadata: entity ${id} not found`);
    // Coerce ISO-string date values in the patch before merging so stored
    // metadata stays Date-typed for Mongo range queries.
    const coercedPatch = coerceMetadataDates(patch);
    const next: IEntity = {
      ...current,
      metadata: { ...(current.metadata ?? {}), ...coercedPatch },
      version: current.version + 1,
      updatedAt: new Date(),
    };
    await this.store.updateEntity(next);
    this.emit({ type: 'entity.upsert', entity: next, created: false });
    return next;
  }

  /**
   * Transition a task entity to a new state — the canonical way to mutate
   * `task.metadata.state` after creation.
   *
   * Side effects (atomic from the caller's perspective, but read-modify-write
   * at the MemorySystem layer — adapters with native transactions may promote):
   *   - Sets `metadata.state = newState`.
   *   - Appends `metadata.stateHistory: TaskStateHistoryEntry[]`, keeping only
   *     the most-recent `stateHistoryCap` entries (default 200). Older entries
   *     drop in FIFO order — full audit history is still recoverable from the
   *     `state_changed` facts themselves.
   *   - When `newState` is in `taskStates.terminal` AND `metadata.completedAt`
   *     is unset, sets `metadata.completedAt = at`.
   *   - Writes a `state_changed` fact with `value: { from, to }`, the provided
   *     `signalId` as `sourceSignalId`, and `importance: 0.7` (override via
   *     `opts.factOverrides`).
   *
   * **Validate modes:**
   *  - `'warn'` (default): any transition allowed; out-of-matrix transitions
   *    log to `console.warn` and still proceed.
   *  - `'strict'`: out-of-matrix transitions throw `InvalidTaskTransitionError`
   *    and NO writes happen.
   *  - `'none'`: silent.
   *
   * **Crash-safety:** the metadata update and the audit fact write are NOT
   * atomic — this method commits the metadata mutation first, then calls
   * `addFact`. If the process dies between the two writes (or `addFact`
   * throws after validation), the task's `state` + `stateHistory` are
   * persisted but the audit fact is missing. The metadata is authoritative
   * and `stateHistory` preserves the transition record, so queries keep
   * working; only the fact-level provenance (ranking, retrieval via
   * `state_changed` predicate) is lost for that specific transition.
   * Callers that need transactional audit should wrap the call at their
   * adapter layer.
   *
   * Subject must be a `type: 'task'` entity. For non-task subjects, call
   * `addFact` + `updateEntityMetadata` directly.
   */
  async transitionTaskState(
    taskId: EntityId,
    newState: string,
    opts: TransitionTaskStateOptions,
    scope: ScopeFilter,
  ): Promise<TransitionTaskStateResult> {
    assertNotDestroyed(this, 'transitionTaskState');
    const task = await this.store.getEntity(taskId, scope);
    if (!task) {
      throw new Error(`transitionTaskState: task ${taskId} not found or not visible`);
    }
    if (task.type !== 'task') {
      throw new Error(
        `transitionTaskState: entity ${taskId} has type '${task.type}', expected 'task'`,
      );
    }
    if (typeof newState !== 'string' || newState.trim().length === 0) {
      throw new Error('transitionTaskState: newState must be a non-empty string');
    }
    assertCanAccess(task, scope, 'write', 'entity');

    const md = (task.metadata ?? {}) as Record<string, unknown>;
    const from = typeof md.state === 'string' ? (md.state as string) : undefined;
    const at = opts.at ?? new Date();
    const validate = opts.validate ?? 'warn';

    // Short-circuit no-op — same state, no side effects.
    if (from === newState) {
      return { task, fact: null };
    }

    // Transition-matrix validation.
    if (opts.transitions) {
      const allowed = opts.transitions[from ?? '__initial'];
      const ok = Array.isArray(allowed) && allowed.includes(newState);
      if (!ok) {
        if (validate === 'strict') {
          throw new InvalidTaskTransitionError(taskId, from, newState);
        }
        if (validate === 'warn') {
          const err = new InvalidTaskTransitionError(taskId, from, newState);
          this.reportWarning(err);
        }
      }
    }

    // Assemble new metadata: state + appended history + completedAt (if terminal).
    const historyEntry: TaskStateHistoryEntry = {
      from,
      to: newState,
      at,
      signalId: opts.signalId,
      reason: opts.reason,
    };
    const priorHistory = Array.isArray(md.stateHistory)
      ? (md.stateHistory as TaskStateHistoryEntry[])
      : [];
    // Cap retained entries so chatty tasks can't grow the entity document
    // unbounded. Full audit history lives on the `state_changed` facts.
    const cap = this._stateHistoryCap;
    const retainedPrior =
      priorHistory.length >= cap ? priorHistory.slice(priorHistory.length - (cap - 1)) : priorHistory;
    const stateHistory = [...retainedPrior, historyEntry];

    const nextMetadata: Record<string, unknown> = {
      ...md,
      state: newState,
      stateHistory,
    };
    if (this._taskStates.terminal.includes(newState) && !md.completedAt) {
      nextMetadata.completedAt = at;
    }

    const nextTask: IEntity = {
      ...task,
      metadata: nextMetadata,
      version: task.version + 1,
      updatedAt: at,
    };
    await this.store.updateEntity(nextTask);
    this.emit({ type: 'entity.upsert', entity: nextTask, created: false });

    // Audit fact — separate from metadata history so ranking + provenance work.
    // factOverrides lets callers (notably ExtractionResolver auto-routing)
    // preserve the LLM-supplied importance / confidence / contextIds / validity
    // that would otherwise be dropped.
    const o = opts.factOverrides ?? {};
    let fact: IFact | null = null;
    try {
      fact = await this.addFact(
        {
          subjectId: taskId,
          predicate: 'state_changed',
          kind: 'atomic',
          value: { from, to: newState },
          details: opts.reason,
          sourceSignalId: opts.signalId,
          observedAt: at,
          importance: o.importance ?? 0.7,
          confidence: o.confidence,
          contextIds: o.contextIds,
          validFrom: o.validFrom,
          validUntil: o.validUntil,
          summaryForEmbedding: o.summaryForEmbedding,
          evidenceQuote: o.evidenceQuote,
        },
        scope,
      );
    } catch (err) {
      // Don't fail the transition if the fact write fails — metadata is the
      // authoritative state. Surface to onError for observability.
      this.reportWarning(err);
    }

    return { task: nextTask, fact };
  }

  /**
   * Report a non-fatal warning. Uses `console.warn` directly — `onError` is
   * typed for `ChangeEvent` (a closed discriminated union) and forcing a
   * synthetic "warning" event through it would break exhaustive `switch`
   * handlers that callers write against the union. Library-internal warnings
   * stay on the console until we add a dedicated `onWarning` channel.
   */
  private reportWarning(error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn('[MemorySystem.transitionTaskState]', error);
  }

  /**
   * List open (non-terminal) tasks for a scope, optionally filtered by
   * assignee or project. Thin wrapper around `listEntities` — uses the
   * configured `taskStates.active` as the `$in` filter on `metadata.state`.
   *
   * Client-side sort: `metadata.dueAt` ascending (undefined last), then
   * `updatedAt` descending. TODO: push down once `EntityListFilter.orderBy`
   * lands on adapters.
   *
   * Hard cap 200; default limit 50. Pass a smaller limit explicitly to
   * constrain prompt-token budget when injecting into an extraction prompt.
   */
  async listOpenTasks(
    scope: ScopeFilter,
    opts: { assigneeId?: EntityId; projectId?: EntityId; limit?: number } = {},
  ): Promise<IEntity[]> {
    assertNotDestroyed(this, 'listOpenTasks');
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const metadataFilter: Record<string, unknown> = {
      state: { $in: this._taskStates.active },
    };
    if (opts.assigneeId) metadataFilter.assigneeId = opts.assigneeId;
    if (opts.projectId) metadataFilter.projectId = opts.projectId;
    // Push-down sort: dueAt asc primarily, updatedAt desc as tiebreak.
    // Missing-dueAt sorts to the end (adapter-enforced nulls-last). The
    // updatedAt tiebreak preserves the previous client-side ordering.
    const page = await this.store.listEntities(
      { type: 'task', metadataFilter },
      {
        limit,
        orderBy: [
          { field: 'metadata.dueAt', direction: 'asc' },
          { field: 'updatedAt', direction: 'desc' },
        ],
      },
      scope,
    );
    return page.items;
  }

  /**
   * List recent topic entities for a scope. Fetches up to `limit * 4` (capped
   * at 200) topics and filters client-side by `updatedAt >= cutoff` where
   * cutoff defaults to now - `days` days. Sorted by `updatedAt` descending.
   *
   * TODO: push down once `EntityListFilter.updatedAfter` + `orderBy` land on
   * adapters.
   */
  async listRecentTopics(
    scope: ScopeFilter,
    opts: { days?: number; limit?: number } = {},
  ): Promise<IEntity[]> {
    assertNotDestroyed(this, 'listRecentTopics');
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const days = Math.max(1, opts.days ?? 30);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    // Push-down: updatedAt desc + filter can't be pushed for updatedAt (not
    // in metadata grammar), so we still post-filter, but at least the sort
    // is adapter-side and we can trim the fetch tightly.
    const page = await this.store.listEntities(
      { type: 'topic' },
      {
        limit: Math.min(limit * 4, 200),
        orderBy: { field: 'updatedAt', direction: 'desc' },
      },
      scope,
    );
    return page.items
      .filter((e) => e.updatedAt.getTime() >= cutoff.getTime())
      .slice(0, limit);
  }

  /**
   * Resolve the most-specific profile visible to the caller.
   * Precedence: ownerId match > groupId match > global. First hit wins.
   */
  async getProfile(entityId: EntityId, scope: ScopeFilter): Promise<IFact | null> {
    assertNotDestroyed(this, 'getProfile');
    const page = await this.store.findFacts(
      { subjectId: entityId, predicate: 'profile', kind: 'document' },
      { limit: 50, orderBy: { field: 'createdAt', direction: 'desc' } },
      scope,
    );
    if (page.items.length === 0) return null;
    return pickMostSpecificProfile(page.items, scope);
  }

  async traverse(
    entityId: EntityId,
    opts: TraversalOptions,
    scope: ScopeFilter,
  ): Promise<Neighborhood> {
    assertNotDestroyed(this, 'traverse');
    if (this.store.traverse) {
      return this.store.traverse(entityId, opts, scope);
    }
    return genericTraverse(this.store, entityId, opts, scope);
  }

  async semanticSearch(
    query: string,
    filter: FactFilter,
    scope: ScopeFilter,
    topK: number = DEFAULT_SEMANTIC_TOP_K,
  ): Promise<Array<{ fact: IFact; score: number }>> {
    assertNotDestroyed(this, 'semanticSearch');
    if (!this.embedder) {
      throw new SemanticSearchUnavailableError('no embedder configured');
    }
    if (!this.store.semanticSearch) {
      throw new SemanticSearchUnavailableError('store does not support semantic search');
    }
    const vector = await this.embedder.embed(query);
    return this.store.semanticSearch(vector, filter, { topK }, scope);
  }

  // ==========================================================================
  // Profile lifecycle
  // ==========================================================================

  async regenerateProfile(
    entityId: EntityId,
    targetScope: ScopeFields,
    _trigger: 'threshold' | 'manual' = 'manual',
  ): Promise<IFact> {
    assertNotDestroyed(this, 'regenerateProfile');
    if (!this.profileGenerator) throw new ProfileGeneratorMissingError();

    const readScope: ScopeFilter = {
      groupId: targetScope.groupId,
      userId: targetScope.ownerId,
    };

    const entity = await this.store.getEntity(entityId, readScope);
    if (!entity) throw new Error(`regenerateProfile: entity ${entityId} not found`);

    // Prior profile at this exact target scope (not merely visible — same groupId/ownerId).
    const priorPage = await this.store.findFacts(
      { subjectId: entityId, predicate: 'profile', kind: 'document' },
      { limit: 10, orderBy: { field: 'createdAt', direction: 'desc' } },
      readScope,
    );
    const priorProfile = priorPage.items.find(
      (f) => sameScope(f, targetScope) && !f.archived,
    );

    // Incremental input: pass the prior profile as the authoritative starting
    // point and only the deltas since it was generated. Two tranches:
    //   1. NEW atomic facts (observedAt > prior.createdAt, not archived).
    //   2. INVALIDATED fact IDs — claims the generator should drop from the
    //      evolved profile. Sources:
    //      (a) Supersession: any new fact with `supersedes` invalidates its
    //          predecessor.
    //      (b) Direct archival: facts visible at scope that are now archived
    //          AND would have been eligible input at prior regen time
    //          (observedBefore prior.createdAt). Slightly overbroad if prior
    //          itself predated some archivals, but the signal is "don't
    //          mention these," which is safe.
    //
    // On first regen (no prior), `newFacts` = all atomic facts (capped),
    // `invalidatedFactIds` = [].
    const since = priorProfile?.createdAt;

    const newFactsPage = await this.store.findFacts(
      {
        subjectId: entityId,
        kind: 'atomic',
        archived: false,
        observedAfter: since,
      },
      { limit: 500, orderBy: { field: 'observedAt', direction: 'desc' } },
      readScope,
    );
    // All newly-observed facts flow to the generator — no in-library
    // truncation or token-budget drop. Modern generators have 200k–1M token
    // input windows and can handle the full delta; the 500-item query cap
    // above is already generous. If a specific host needs a tighter input
    // (e.g. cost control on a small model), they can lower that cap via a
    // future config knob. See feedback_no_truncation.md.
    const newFacts = newFactsPage.items;

    let invalidatedFactIds: FactId[] = [];
    if (since) {
      // (a) Supersession chain: predecessors that the new facts replaced.
      const supersededIds = newFacts
        .map((f) => f.supersedes)
        .filter((id): id is FactId => typeof id === 'string');

      // (b) Direct archivals. Query archived atomic facts observed before prior
      // regen; these are the ones that could have been in prior's input and are
      // now gone. Exclude supersession-archived (already covered in (a)).
      const archivedPage = await this.store.findFacts(
        {
          subjectId: entityId,
          kind: 'atomic',
          archived: true,
          observedBefore: since,
        },
        { limit: 200, orderBy: { field: 'observedAt', direction: 'desc' } },
        readScope,
      );
      const directlyArchived = archivedPage.items.map((f) => f.id);

      invalidatedFactIds = Array.from(new Set([...supersededIds, ...directlyArchived]));
    }

    // Observability: surface when the generator input is unusually large so
    // operators see cost/latency spikes. No cap is applied — policy is
    // "warn and proceed" (see feedback_no_truncation.md). Estimate input
    // chars as prior profile + sum of fact details/value/summary.
    const estimatedInputChars = estimateProfileGenInputChars(priorProfile, newFacts);
    if (estimatedInputChars >= PROFILE_GEN_WARN_CHARS) {
      // eslint-disable-next-line no-console
      console.warn(
        '[MemorySystem.regenerateProfile] large generator input',
        {
          entityId,
          estimatedInputChars,
          newFactsCount: newFacts.length,
          priorProfileChars: priorProfile?.details?.length ?? 0,
          invalidatedFactCount: invalidatedFactIds.length,
        },
      );
    }

    const { details, summaryForEmbedding } = await this.profileGenerator.generate({
      entity,
      newFacts,
      priorProfile,
      invalidatedFactIds,
      targetScope,
    });

    const newProfile = await this.addFact(
      {
        subjectId: entityId,
        predicate: 'profile',
        kind: 'document',
        details,
        summaryForEmbedding,
        supersedes: priorProfile?.id,
        groupId: targetScope.groupId,
        ownerId: targetScope.ownerId,
        // Inherit prior profile's permissions so auto-regen never silently
        // widens visibility. A private (world='none') prior profile stays
        // private across regenerations; undefined on first regen falls back
        // to library defaults (public-read).
        permissions: priorProfile?.permissions,
      },
      readScope,
    );

    this.emit({
      type: 'profile.regenerate',
      entityId,
      scope: targetScope,
      factId: newProfile.id,
    });

    return newProfile;
  }

  private async maybeRegenerateProfile(entityId: EntityId, scope: ScopeFields): Promise<void> {
    if (!this.profileGenerator) return;
    const key = regenKey(entityId, scope);
    if (this.regenInFlight.has(key)) return;

    const readScope: ScopeFilter = { groupId: scope.groupId, userId: scope.ownerId };
    try {
      // Skip regen for agent-type entities. Agent profiles are not rendered
      // into the system message any more (admin-controlled instructions live
      // on `Agent.create({instructions})` instead). Spending an LLM call to
      // synthesize a profile nobody reads is pure waste — the only writes
      // that land on an agent entity today are user-specific behavior rules
      // from `memory_set_agent_rule`, which have their own render path.
      const subject = await this.store.getEntity(entityId, readScope);
      if (subject?.type === 'agent') return;

      const priorPage = await this.store.findFacts(
        { subjectId: entityId, predicate: 'profile', kind: 'document' },
        { limit: 10, orderBy: { field: 'createdAt', direction: 'desc' } },
        readScope,
      );
      const prior = priorPage.items.find((f) => sameScope(f, scope) && !f.archived);
      const observedAfter = prior?.createdAt;

      const newFactCount = await this.store.countFacts(
        { subjectId: entityId, kind: 'atomic', observedAfter },
        readScope,
      );

      // Threshold: if no prior profile exists, require at least threshold atomic facts total.
      const threshold = this.profileThreshold;
      if (newFactCount < threshold) return;

      this.regenInFlight.add(key);
      try {
        await this.regenerateProfile(entityId, scope, 'threshold');
      } finally {
        this.regenInFlight.delete(key);
      }
    } catch (err) {
      // Background regen failures must not impact the write path — but they
      // must never be silent. Surface via console.warn (same pattern as
      // reportWarning / onChange listener failures elsewhere in this file).
      this.regenInFlight.delete(key);
      // eslint-disable-next-line no-console
      console.warn(
        '[MemorySystem.maybeRegenerateProfile] background profile regeneration failed',
        { entityId, groupId: scope.groupId, ownerId: scope.ownerId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      );
    }
  }

  // ==========================================================================
  // Rules
  // ==========================================================================

  async deriveFactsFor(entityId: EntityId, scope: ScopeFilter): Promise<IFact[]> {
    assertNotDestroyed(this, 'deriveFactsFor');
    if (!this.ruleEngine) return [];
    const view = new ScopedMemoryView(this.store, scope);
    const derived = await this.ruleEngine.deriveFor(entityId, view, scope);
    const written: IFact[] = [];
    for (const d of derived) {
      if (!d.subjectId || !d.predicate || !d.kind) continue;
      const fact = await this.addFact(
        {
          ...d,
          subjectId: d.subjectId,
          predicate: d.predicate,
          kind: d.kind,
        },
        scope,
      );
      written.push(fact);
    }
    return written;
  }

  // ==========================================================================
  // Embedding queue control
  // ==========================================================================

  flushEmbeddings(): Promise<void> {
    return this.queue.flush();
  }

  pendingEmbeddings(): number {
    return this.queue.pending();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue.stop();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  async shutdown(): Promise<void> {
    await this.queue.flush();
    this.destroy();
    if (this.store.shutdown) await this.store.shutdown();
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private emit(event: ChangeEvent): void {
    if (!this.onChange) return;
    try {
      this.onChange(event);
    } catch (err) {
      // Listener failures must not impact the data path. Route to onError if
      // provided; otherwise warn on console so the failure is never completely
      // invisible.
      if (this.onError) {
        try {
          this.onError(err, event);
        } catch {
          // An onError that throws is a bug we cannot fix here — swallow.
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `MemorySystem.onChange listener threw during '${event.type}':`,
          err,
        );
      }
    }
  }
}

// =============================================================================
// ScopedMemoryView — read-only sandbox for the rule engine
// =============================================================================

class ScopedMemoryView implements IScopedMemoryView {
  constructor(
    private readonly store: IMemoryStore,
    private readonly scope: ScopeFilter,
  ) {}

  getEntity(id: EntityId): Promise<IEntity | null> {
    return this.store.getEntity(id, this.scope);
  }

  async findFacts(filter: FactFilter, opts?: { limit?: number }): Promise<IFact[]> {
    const page = await this.store.findFacts(filter, { limit: opts?.limit ?? 100 }, this.scope);
    return page.items;
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function computeIsSemantic(input: Partial<IFact>): boolean {
  if (input.kind === 'document') return true;
  if (input.kind !== 'atomic') return false;
  const text = input.details ?? '';
  return text.length >= SEMANTIC_MIN_DETAILS_LENGTH;
}

/** Clamp to [0, 1]; preserve undefined (so registry defaults still apply). */
function clampUnit01(v: number | undefined): number | undefined {
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

/**
 * Order-independent deep equality for LLM-extracted fact `value` payloads.
 *
 * `JSON.stringify` is not sufficient because:
 *   - `{a:1, b:2}` vs `{b:2, a:1}` stringify differently (key order).
 *   - `NaN`, `Infinity`, `-Infinity` all stringify to `"null"` → false positives.
 *   - Arrays of different ordering stringify differently (correctly — order matters).
 *
 * Handles: primitives (incl. `NaN === NaN` special case), arrays (positional),
 * plain objects (key-sorted). Does NOT attempt Map/Set/Date — LLM output is
 * JSON, so these won't appear.
 */
/**
 * Dedup-boundary comparison for fact `value`. Mirrors `stableEqual` except
 * string values are compared case-insensitively and whitespace-normalised
 * (trim + collapse internal runs to a single space). Intended ONLY for the
 * `findDedupMatch` hot path — not a general-purpose equality.
 *
 * Rationale (H4): the extraction LLM is non-deterministic in casing and
 * whitespace (`"Alice"` vs `"ALICE"` vs `"Alice "`). Without normalisation
 * every ingest turn could produce a new "duplicate" fact for the same
 * knowledge, bloating the store and defeating the "one fact per knowledge"
 * contract of prompt v2.
 */
export function dedupValueEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return normalizeStringForDedup(a) === normalizeStringForDedup(b);
  }
  return stableEqual(a, b);
}

function normalizeStringForDedup(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stableEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!stableEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (
      !stableEqual(
        (a as Record<string, unknown>)[aKeys[i]!],
        (b as Record<string, unknown>)[bKeys[i]!],
      )
    ) {
      return false;
    }
  }
  return true;
}

function deriveFactScope(
  input: Partial<IFact>,
  subject: IEntity,
  scope: ScopeFilter,
): ScopeFields {
  // Precedence: explicit input > subject entity's scope > caller scope.
  // Subject fields are constraints — the fact can only narrow, never widen.
  const groupId =
    input.groupId ?? (subject.groupId ?? scope.groupId);
  const ownerId =
    input.ownerId ?? (subject.ownerId ?? undefined);
  return { groupId, ownerId };
}

function assertScopeInvariant(subject: IEntity, factScope: ScopeFields): void {
  if (subject.groupId && factScope.groupId !== subject.groupId) {
    throw new ScopeInvariantError(
      `fact groupId=${factScope.groupId ?? 'none'} must equal subject groupId=${subject.groupId}`,
    );
  }
  if (subject.ownerId && factScope.ownerId !== subject.ownerId) {
    throw new ScopeInvariantError(
      `fact ownerId=${factScope.ownerId ?? 'none'} must equal subject ownerId=${subject.ownerId}`,
    );
  }
}

function sameScope(a: ScopeFields, b: ScopeFields): boolean {
  return (a.groupId ?? null) === (b.groupId ?? null) && (a.ownerId ?? null) === (b.ownerId ?? null);
}

function regenKey(entityId: EntityId, scope: ScopeFields): string {
  return `${entityId}|${scope.groupId ?? ''}|${scope.ownerId ?? ''}`;
}

/**
 * Precedence: ownerId match > groupId match > global. First hit wins.
 */
function pickMostSpecificProfile(facts: IFact[], scope: ScopeFilter): IFact | null {
  const byOwner = facts.find(
    (f) => f.ownerId && f.ownerId === scope.userId && !f.archived,
  );
  if (byOwner) return byOwner;
  const byGroup = facts.find(
    (f) => f.groupId && f.groupId === scope.groupId && !f.ownerId && !f.archived,
  );
  if (byGroup) return byGroup;
  const global = facts.find((f) => !f.groupId && !f.ownerId && !f.archived);
  return global ?? null;
}

function mergeIdentifiersAndAliases(
  existing: IEntity,
  incoming: { identifiers?: Identifier[]; aliases?: string[] },
): { entity: IEntity; dirty: boolean } {
  let dirty = false;
  const identifiers = [...existing.identifiers];
  if (incoming.identifiers) {
    for (const ident of incoming.identifiers) {
      const already = identifiers.some(
        (i) => i.kind === ident.kind && i.value.toLowerCase() === ident.value.toLowerCase(),
      );
      if (!already) {
        identifiers.push({ ...ident, addedAt: ident.addedAt ?? new Date() });
        dirty = true;
      }
    }
  }
  const aliases = existing.aliases ? [...existing.aliases] : [];
  if (incoming.aliases) {
    for (const alias of incoming.aliases) {
      if (!aliases.includes(alias)) {
        aliases.push(alias);
        dirty = true;
      }
    }
  }
  return {
    entity: {
      ...existing,
      identifiers,
      aliases: aliases.length > 0 ? aliases : existing.aliases,
    },
    dirty,
  };
}

/**
 * Shallow-merge `incoming` into `existing.metadata` per the chosen mode,
 * optionally restricted to `keys`. Returns the (possibly updated) entity and
 * a `changed` flag. No-op when `incoming` is empty or `mode` is undefined.
 *
 * - `fillMissing`: only sets keys absent from the stored metadata.
 * - `overwrite`: incoming keys win (shallow).
 *
 * Equality check uses deep-equal on the value to avoid spurious version bumps
 * when callers re-pass identical data.
 */
function applyMetadataMerge(
  existing: IEntity,
  incoming: Record<string, unknown> | undefined,
  mode: 'fillMissing' | 'overwrite' | undefined,
  keys: string[] | undefined,
): { entity: IEntity; changed: boolean } {
  if (!mode || !incoming) return { entity: existing, changed: false };
  const incomingEntries = Object.entries(incoming).filter(([, v]) => v !== undefined);
  if (incomingEntries.length === 0) return { entity: existing, changed: false };

  const allowedKeys = keys && keys.length > 0 ? new Set(keys) : null;
  const current = (existing.metadata ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  let changed = false;

  for (const [k, v] of incomingEntries) {
    if (allowedKeys && !allowedKeys.has(k)) continue;
    if (mode === 'fillMissing' && k in current) continue;
    if (!metadataDeepEqual(current[k], v)) {
      next[k] = v;
      changed = true;
    }
  }

  if (!changed) return { entity: existing, changed: false };
  return { entity: { ...existing, metadata: next }, changed: true };
}

function embeddingsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // Allow tiny floating-point drift — if providers return the same vector
    // across calls it's identical, but be defensive.
    if (Math.abs(a[i]! - b[i]!) > 1e-6) return false;
  }
  return true;
}

// =============================================================================
// Embedding queue — async, bounded concurrency, retried
// =============================================================================

interface QueueItem {
  text: string;
  scope: ScopeFilter;
  attempts: number;
  /** Identifying metadata for observability on final failure. */
  factId: FactId | null;
  entityId: EntityId | null;
  /** Called with the computed embedding vector; queue retries if this or embed() throws. */
  onComplete: (embedding: number[]) => Promise<void>;
}

class EmbeddingQueue {
  private readonly store: IMemoryStore;
  private readonly embedder?: IEmbedder;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly queue: QueueItem[] = [];
  private activeWorkers = 0;
  private stopped = false;
  private readonly idleWaiters: Array<() => void> = [];
  /** Hook fired when an item exhausts all retries. */
  private readonly onFinalFailure?: (
    item: QueueItem,
    error: unknown,
  ) => void;

  constructor(
    store: IMemoryStore,
    embedder: IEmbedder | undefined,
    config?: EmbeddingQueueConfig,
    onFinalFailure?: (item: QueueItem, error: unknown) => void,
  ) {
    this.store = store;
    this.embedder = embedder;
    this.concurrency = config?.concurrency ?? DEFAULT_EMBED_CONCURRENCY;
    this.maxRetries = config?.retries ?? DEFAULT_EMBED_RETRIES;
    this.onFinalFailure = onFinalFailure;
  }

  /** Enqueue a fact's embedding — writes to IFact.embedding via updateFact. */
  enqueue(factId: FactId, text: string, scope: ScopeFilter): void {
    if (this.stopped || !this.embedder) return;
    this.queue.push({
      text,
      scope,
      attempts: 0,
      factId,
      entityId: null,
      onComplete: async (embedding) => {
        await this.store.updateFact(factId, { embedding }, scope);
      },
    });
    this.kick();
  }

  /** Enqueue an entity's identity embedding — read/modify/write on IEntity.identityEmbedding. */
  enqueueIdentity(entityId: EntityId, text: string, scope: ScopeFilter): void {
    if (this.stopped || !this.embedder) return;
    this.queue.push({
      text,
      scope,
      attempts: 0,
      factId: null,
      entityId,
      onComplete: async (embedding) => {
        const cur = await this.store.getEntity(entityId, scope);
        if (!cur) return;
        // Skip write if the embedding hasn't changed — avoids version churn.
        if (
          cur.identityEmbedding &&
          embeddingsEqual(cur.identityEmbedding, embedding)
        ) {
          return;
        }
        const next: IEntity = {
          ...cur,
          identityEmbedding: embedding,
          version: cur.version + 1,
          updatedAt: new Date(),
        };
        await this.store.updateEntity(next);
      },
    });
    this.kick();
  }

  pending(): number {
    return this.queue.length + this.activeWorkers;
  }

  async flush(): Promise<void> {
    if (this.pending() === 0) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.notifyIdle();
  }

  private kick(): void {
    if (this.stopped) return;
    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      this.activeWorkers++;
      void this.runOne(item);
    }
  }

  private async runOne(item: QueueItem): Promise<void> {
    try {
      if (!this.embedder) return;
      const vector = await this.embedder.embed(item.text);
      await item.onComplete(vector);
    } catch (err) {
      if (item.attempts < this.maxRetries) {
        item.attempts++;
        this.queue.push(item);
      } else if (this.onFinalFailure) {
        // Final failure — notify the observer hook. Callers can map this to a
        // dead-letter queue / metric / alert rather than silently drop.
        try {
          this.onFinalFailure(item, err);
        } catch {
          // Never let a failing observer break the queue.
        }
      }
    } finally {
      this.activeWorkers--;
      if (this.queue.length > 0) {
        this.kick();
      } else if (this.activeWorkers === 0) {
        this.notifyIdle();
      }
    }
  }

  private notifyIdle(): void {
    while (this.idleWaiters.length > 0) {
      const resolve = this.idleWaiters.shift();
      if (resolve) resolve();
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function toDateMaybe(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function validateTaskStates(cfg: TaskStatesConfig | undefined): TaskStatesConfig {
  if (!cfg) {
    return {
      active: [...DEFAULT_TASK_STATES.active],
      terminal: [...DEFAULT_TASK_STATES.terminal],
    };
  }
  if (!Array.isArray(cfg.active) || cfg.active.length === 0) {
    throw new Error("MemorySystem: taskStates.active must be a non-empty string[]");
  }
  if (!Array.isArray(cfg.terminal) || cfg.terminal.length === 0) {
    throw new Error("MemorySystem: taskStates.terminal must be a non-empty string[]");
  }
  const activeSet = new Set(cfg.active);
  if (activeSet.size !== cfg.active.length) {
    throw new Error("MemorySystem: taskStates.active contains duplicates");
  }
  const terminalSet = new Set(cfg.terminal);
  if (terminalSet.size !== cfg.terminal.length) {
    throw new Error("MemorySystem: taskStates.terminal contains duplicates");
  }
  for (const s of cfg.active) {
    if (typeof s !== 'string' || s.trim().length === 0) {
      throw new Error("MemorySystem: taskStates.active entries must be non-empty strings");
    }
    if (terminalSet.has(s)) {
      throw new Error(
        `MemorySystem: taskStates '${s}' appears in both active and terminal — must be disjoint`,
      );
    }
  }
  for (const s of cfg.terminal) {
    if (typeof s !== 'string' || s.trim().length === 0) {
      throw new Error("MemorySystem: taskStates.terminal entries must be non-empty strings");
    }
  }
  return { active: [...cfg.active], terminal: [...cfg.terminal] };
}

/** Default retained entries in `task.metadata.stateHistory`. */
const DEFAULT_STATE_HISTORY_CAP = 200;

function validateStateHistoryCap(v: number | undefined): number {
  if (v === undefined) return DEFAULT_STATE_HISTORY_CAP;
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
    throw new Error(
      `MemorySystem: stateHistoryCap must be a positive integer (got ${String(v)})`,
    );
  }
  return v;
}

/**
 * Estimate the char count that will be fed into the profile generator. Rough
 * upper-bound: prior profile details + every new fact's details / stringified
 * value / summary. Only used for the "large input" warn log — a slight
 * over-estimate is harmless (errs on the side of warning).
 */
function estimateProfileGenInputChars(
  priorProfile: IFact | undefined,
  newFacts: readonly IFact[],
): number {
  let total = typeof priorProfile?.details === 'string' ? priorProfile.details.length : 0;
  for (const f of newFacts) {
    if (typeof f.details === 'string') total += f.details.length;
    if (typeof f.summaryForEmbedding === 'string') total += f.summaryForEmbedding.length;
    if (f.value !== undefined && f.value !== null) {
      total += typeof f.value === 'string' ? f.value.length : JSON.stringify(f.value).length;
    }
  }
  return total;
}

