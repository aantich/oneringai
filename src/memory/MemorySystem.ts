import { byteLength } from '../infrastructure/runtime/primitives.js';
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
import { logger } from '../infrastructure/observability/Logger.js';
import {
  assertCanAccess,
  canAccess,
  OwnerRequiredError,
  type Permissions,
  type VisibilityContext,
  type VisibilityPolicy,
} from './AccessControl.js';
import { coerceFactTemporalFields, coerceMetadataDates } from './dateCoercion.js';
import { makeEnvFlag } from './envFlag.js';
import {
  DOCUMENT_SLUG_KIND,
  DOCUMENT_SLUG_PREFIX,
  DOCUMENT_TYPE,
  HAS_DOCUMENT_PREDICATE,
  documentSlugIdentifier,
} from './documents/types.js';
import type {
  CreateDocumentInput,
  DetachDocumentResult,
  Document,
  DocumentSearchHit,
  ListDocumentsFilter,
  SearchDocumentsInput,
  UpdateDocumentInput,
} from './documents/types.js';
import { genericTraverse } from './GenericTraversal.js';
import { identifierValuesEqual } from './identifiers.js';
import { metadataDeepEqual } from './metadataDiff.js';
import { rankFacts } from './Ranking.js';
import type { PredicateRegistry } from './predicates/PredicateRegistry.js';
import type { PredicateDefinition } from './predicates/types.js';
import { EntityResolver, buildIdentityString } from './resolution/EntityResolver.js';
import { normalizeSurface } from './resolution/fuzzy.js';
import {
  CachedComposeContext,
  DEFAULT_ENTITY_COMPOSERS,
  defaultFactContentComposer,
} from './composers/index.js';
import type {
  EntityContentComposer,
  FactContentComposer,
} from './composers/index.js';
import type {
  OperationOutcome,
  ReconciliationOp,
  SignalReconciliationOp,
  SignalReconciliationOutcome,
  TaskReconciliationOp,
} from './integration/ExtractionResolver.js';
import type {
  ChangeEvent,
  ContextOptions,
  EmbeddingQueueConfig,
  EntityCandidate,
  EntityEmbeddingField,
  EntityId,
  EntityListFilter,
  EntityOrderBy,
  EntityResolutionConfig,
  EntitySemanticSearchFilter,
  EntityView,
  FactFilter,
  FactId,
  FactOrderBy,
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
import { computeNormalizedFields } from './normalize.js';
import { principalsForLibraryRecord } from '../access/principals.js';
import type { ACLEntry } from '../access/principals.js';

// Defaults --------------------------------------------------------------------

const DEFAULT_TOP_FACTS_LIMIT = 15;
/**
 * Over-fetch ratio for getContext.topFacts: we pull `topFactsLimit * N`
 * candidates from the store (ordered observedAt desc), then re-rank in memory
 * by confidence × recency × predicate weight × importance and slice to
 * topFactsLimit. A larger multiplier means the ranker sees a meaningful pool;
 * too small and a high-importance fact slightly older than position
 * (topFactsLimit * N) never reaches the ranker.
 */
const TOP_FACTS_OVERFETCH_MULTIPLIER = 10;
/**
 * `resolveRelatedTasks` / `resolveRelatedEvents` context-fact and event-list
 * fetches. The cap exists because we filter client-side (attendee membership,
 * task-state check, etc.) and don't want to pull the entire collection. With
 * push-down `orderBy` in place, this becomes a "most-recent N" window rather
 * than insertion-order roulette.
 */
const RELATED_FACT_FETCH_LIMIT = 200;
/**
 * `resolveRelatedEvents` per-predicate (`attended` / `hosted`) fact fetches.
 * Smaller than `RELATED_FACT_FETCH_LIMIT` because these are scoped to a single
 * subject + predicate and `200` would be deep in long-tail territory.
 */
const RELATED_PREDICATE_FACT_LIMIT = 100;
/**
 * `listRecentTopics` over-fetch ratio. We over-fetch by 4× to give the
 * client-side `updatedAt >= cutoff` filter headroom, capped at
 * `RECENT_TOPICS_OVERFETCH_CEILING`. Smaller than `TOP_FACTS_OVERFETCH_MULTIPLIER`
 * because the post-filter doesn't drop as aggressively — a topic that surfaces
 * in the desc-ordered fetch is, by definition, within the window unless it's
 * older than `days`, in which case all subsequent items are too.
 */
const RECENT_TOPICS_OVERFETCH_MULTIPLIER = 4;
const RECENT_TOPICS_OVERFETCH_CEILING = 200;
/**
 * Push-down `orderBy` for "open tasks" queries. Used by `listOpenTasks`,
 * `iterateOpenTasks`, and `resolveRelatedTasks`. Overdue/soonest-due first,
 * `updatedAt` desc as recency tiebreak, `id` asc as a final deterministic
 * tiebreak so cursor pagination yields each row exactly once.
 */
const OPEN_TASK_ORDER_BY: readonly EntityOrderBy[] = [
  { field: 'metadata.dueAt', direction: 'asc' },
  { field: 'updatedAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];
const DEFAULT_SEMANTIC_TOP_K = 5;
const DEFAULT_NEIGHBOR_DEPTH = 1;
const DEFAULT_PROFILE_THRESHOLD = 3;
const MILLIS_PER_DAY = 86_400_000;
/**
 * Threshold (chars of estimated input) above which `regenerateProfile` emits
 * an operator warn log. No cap is applied — the log is purely observability
 * so large profiles don't cost a surprise without the operator knowing.
 */
const PROFILE_GEN_WARN_CHARS = 200_000;
const DEFAULT_EMBED_CONCURRENCY = 4;
const DEFAULT_EMBED_RETRIES = 3;
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
   * - `'strict'`: out-of-matrix transitions throw `InvalidTaskTransitionError` — the metadata write is skipped.
   * - `'none'`: no validation, no warnings.
   */
  validate?: 'strict' | 'warn' | 'none';
  /**
   * Explicit allowed transitions: `{ from: [allowed, to, states] }`. When omitted,
   * every transition is allowed (with a warning for duplicates in `'warn'`).
   * Keys include `'__initial'` for transitions into a first-time state.
   */
  transitions?: Record<string, string[]>;
}

export interface TransitionTaskStateResult {
  task: IEntity;
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
  private readonly _stateHistoryCap: number;
  private readonly visibilityPolicy?: VisibilityPolicy;
  /**
   * Per-type entity content-embedding composers. Built at construction from
   * `DEFAULT_ENTITY_COMPOSERS` overlaid with `config.entityContentComposers`.
   * Entries are looked up by `entity.type`; missing entries mean the type
   * gets no content embedding.
   */
  private readonly contentComposers: ReadonlyMap<string, EntityContentComposer>;
  /**
   * Fact content-embedding composer. `config.factContentComposer` overrides
   * the default; default ships meaningful surface-form composition for
   * atomic facts plus details-verbatim for document facts.
   */
  private readonly factComposer: FactContentComposer;

  /**
   * Single-flight registry for profile regenerations, keyed by entityId+scope.
   * Concurrent callers for the same key SHARE the in-flight promise — both
   * the explicit `regenerateProfile()` path and the threshold-driven
   * `maybeRegenerateProfile()` path dedup through this map, so racing agent
   * runs or pipeline ticks against a hot entity collapse to one LLM call.
   */
  private readonly regenInFlight = new Map<string, Promise<IFact>>();

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
        atomicCreateOrResolve: async (input, scope) => {
          return this.tryAtomicCreateOrResolve(input, scope);
        },
        appendAliasesAndIdentifiers: async (id, aliases, identifiers, scope, opts) => {
          return this.appendAliasesAndIdentifiers(id, aliases, identifiers, scope, opts);
        },
      },
      this.resolutionConfig,
    );

    // Build the content-composer map: defaults overlaid with caller overrides.
    // Frozen ReadonlyMap so accidental late mutation can't leak into the queue.
    const composers = new Map<string, EntityContentComposer>(DEFAULT_ENTITY_COMPOSERS);
    if (config.entityContentComposers) {
      for (const [type, composer] of Object.entries(config.entityContentComposers)) {
        if (composer) composers.set(type, composer);
      }
    }
    this.contentComposers = composers;
    this.factComposer = config.factContentComposer ?? defaultFactContentComposer;
  }

  /**
   * Atomic create-or-resolve by `(type, normalizedDisplayName, scope)`.
   * Used by `EntityResolver.upsertBySurface` when Tier 1-3 returned no
   * candidate at-or-above `autoResolveThreshold`. Single point of contact
   * with `IMemoryStore.atomicCreateOrFindByNormalizedName`.
   *
   * On `created: true` — emits `entity.upsert` and returns the fresh entity.
   * On `created: false` — a racer or a now-visible row owns the normalized
   * name. Merges the caller's incoming aliases / identifiers / metadata
   * onto the winner via `appendAliasesAndIdentifiers` (same path as a
   * resolver hit would have used), so re-extractions across concurrent
   * writers converge on a single entity with the union of seen surfaces.
   */
  private async tryAtomicCreateOrResolve(
    input: Partial<IEntity> & {
      identifiers: Identifier[];
      displayName: string;
      type: string;
      aliasesForMerge?: string[];
      metadataMerge?: 'fillMissing' | 'overwrite';
      /**
       * Caller-supplied contextIds. On create: stored verbatim (post visibility-
       * validation). On race-loss: unioned into the winner via the existing
       * `appendAliasesAndIdentifiers` call below (extended to handle contextIds).
       */
      contextIds?: EntityId[];
    },
    scope: ScopeFilter,
  ): Promise<{ entity: IEntity; created: boolean }> {
    assertNotDestroyed(this, 'tryAtomicCreateOrResolve');
    // Owner invariant lives in createEntity, not here — but the adapter's
    // atomic primitive ultimately calls createEntity which enforces it.
    // We just pre-compute the resolved owner so the find-side filter and
    // the eventual insert use the same scope key.
    const ownerId = input.ownerId ?? scope.userId;
    if (!ownerId) {
      throw new OwnerRequiredError('entity');
    }
    if (input.metadata) {
      input = { ...input, metadata: coerceMetadataDates(input.metadata) };
    }
    const sanitizedContextIds = await this.sanitizeContextIdsForCreate(
      input.contextIds,
      scope,
    );
    const newEntity: NewEntity = {
      type: input.type,
      displayName: input.displayName,
      aliases: input.aliases ? [...input.aliases] : undefined,
      identifiers: input.identifiers.map((i) => ({
        ...i,
        addedAt: i.addedAt ?? new Date(),
      })),
      groupId: input.groupId ?? scope.groupId,
      ownerId,
      metadata: input.metadata,
      contextIds: sanitizedContextIds,
      permissions: this.resolvePermissions(input.permissions, {
        kind: 'entity',
        entityType: input.type,
      }),
      acl: input.acl,
    };
    // 0.9.1 person rule: single-token person displayName with NO identifier
    // is structurally too weak to dedupe by name — "Pavel" / "John" / "Vlad"
    // identify a class of humans, not a unique person. Bypass the atomic
    // find-or-create primitive (which would merge by normalizedDisplayName)
    // and create a new row directly. Concurrent identical-name inserts will
    // produce separate rows — the operator dedup queue handles the rest.
    // Identifier-bearing persons (email, slack_id) hit Tier 1 upstream and
    // never reach this path; multi-token persons ("Pavel Khasanov") DO dedupe
    // by normalized name as before.
    if (shouldBypassNameDedup(input.type, input.identifiers, input.displayName)) {
      const created = await this.store.createEntity(newEntity);
      this.queueIdentityEmbedding(created, scope);
      await this.queueContentEmbeddingIfChanged(created, scope);
      this.emit({ type: 'entity.upsert', entity: created, created: true });
      return { entity: created, created: true };
    }
    const res = await this.store.atomicCreateOrFindByNormalizedName(newEntity, scope);
    if (res.created) {
      this.queueIdentityEmbedding(res.entity, scope);
      await this.queueContentEmbeddingIfChanged(res.entity, scope);
      this.emit({ type: 'entity.upsert', entity: res.entity, created: true });
      return { entity: res.entity, created: true };
    }
    // Race-loss path — winner exists. Merge any aliases/identifiers/metadata
    // the caller passed into it so the union of seen surfaces converges on
    // a single entity. Identical semantics to a resolver-hit accumulation.
    const aliasesForMerge = input.aliasesForMerge ?? [
      input.displayName,
      ...(input.aliases ?? []),
    ];
    const merged = await this.appendAliasesAndIdentifiers(
      res.entity.id,
      aliasesForMerge,
      newEntity.identifiers,
      scope,
      input.metadata || sanitizedContextIds
        ? {
            metadata: input.metadata,
            metadataMerge: input.metadataMerge ?? 'fillMissing',
            // Race-loss: union-merge the caller's contextIds onto the winner.
            // Already visibility-validated by sanitizeContextIdsForCreate above.
            contextIdsToUnion: sanitizedContextIds,
          }
        : undefined,
    );
    return { entity: merged, created: false };
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
    options?: {
      /**
       * Allow a resolve-and-update to mutate an existing entity owned by a
       * different user WITHIN THE SAME GROUP/TENANT. Default `false`.
       *
       * When `true`: if the best-match entity shares `scope.groupId`, the
       * per-owner `assertCanAccess(write)` check is skipped — so trusted
       * server-side consolidation (e.g. the signal pipeline converging a
       * group-visible Person/Organization that another user in the same group
       * created) can enrich it without re-owning it first. Mirrors the
       * `allowCrossOwner` option on `mergeEntities`.
       *
       * Tenancy invariant is preserved: a cross-tenant best-match (different
       * `groupId`) still goes through `assertCanAccess`, which denies it — the
       * flag never enables cross-tenant writes. The host is responsible for
       * gating which callers may pass it (server pipeline code only — never an
       * agent/tool surface).
       */
      allowCrossOwner?: boolean;
    },
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
      // **Truly-bare** form (R4): caller passed NO identifiers AND none
      // matched an existing row → fall through to a normalized-name lookup
      // so direct `upsertEntity` callers (LLM-extracted entities, projects
      // with no natural strong key) get the same dedup the resolver enforces.
      //
      // When the caller DID supply identifiers but none matched, treat them
      // as authoritative — the caller is expressing "this is a distinct
      // entity even if it shares a displayName". Skip the normalized lookup
      // and create a new row. This preserves the long-standing semantic where
      // identifier-bearing upserts are independent.
      const norm =
        input.identifiers.length === 0
          ? computeNormalizedFields({
              displayName: input.displayName,
              aliases: input.aliases,
            })
          : { normalizedDisplayName: '', normalizedAliases: [] as string[] };
      if (norm.normalizedDisplayName) {
        const matches = await this.store.findEntitiesByNormalizedName(
          input.type,
          norm.normalizedDisplayName,
          scope,
          { matchAliases: false, limit: 2 },
        );
        if (matches.length === 1) {
          // Unambiguous existing entity. Route through the atomic primitive
          // so any concurrent racer also converges here.
          const res = await this.tryAtomicCreateOrResolve(
            {
              type: input.type,
              displayName: input.displayName,
              aliases: input.aliases,
              identifiers: input.identifiers,
              metadata: input.metadata,
              contextIds: input.contextIds,
              groupId: input.groupId,
              ownerId: input.ownerId,
              permissions: input.permissions,
              acl: input.acl,
              metadataMerge: input.metadataMerge,
            },
            scope,
          );
          return {
            entity: res.entity,
            created: res.created,
            mergedIdentifiers: res.created ? res.entity.identifiers.length : 0,
            mergeCandidates: [],
          };
        }
        if (matches.length > 1) {
          // Legacy data with pre-existing duplicates sharing this normalized
          // name. The library refuses to pick one — falls through to a
          // plain createEntity (yielding another row) and emits an
          // `entity.upsert.ambiguous` event so observers can run a dedup pass.
          const result = await this.createEntity(input, scope);
          this.emit({
            type: 'entity.upsert.ambiguous',
            type_: input.type,
            normalizedDisplayName: norm.normalizedDisplayName,
            candidates: matches.map((m) => m.id),
            createdId: result.entity.id,
          });
          return result;
        }
        // matches.length === 0 → use atomic primitive to guard against
        // concurrent writers reaching here with the same surface.
        const res = await this.tryAtomicCreateOrResolve(
          {
            type: input.type,
            displayName: input.displayName,
            aliases: input.aliases,
            identifiers: input.identifiers,
            metadata: input.metadata,
            contextIds: input.contextIds,
            groupId: input.groupId,
            ownerId: input.ownerId,
            permissions: input.permissions,
            acl: input.acl,
            metadataMerge: input.metadataMerge,
          },
          scope,
        );
        return {
          entity: res.entity,
          created: res.created,
          mergedIdentifiers: res.created ? res.entity.identifiers.length : 0,
          mergeCandidates: [],
        };
      }
      // Either the caller supplied identifiers (handled above by skipping
      // norm computation) OR the normalized form collapsed to empty (pure
      // punctuation displayName). Either way, no atomic dedup is appropriate
      // — fall back to plain createEntity.
      return this.createEntity(input, scope);
    }

    // Pick best match (most identifier hits). Tiebreak: most recently updated.
    const sortedIds = [...matchCounts.entries()].sort((a, b) => b[1] - a[1]);
    const bestId = sortedIds[0]![0];

    const mergeCandidates = sortedIds
      .slice(1)
      .map(([id]) => id)
      .filter((id) => id !== bestId);

    // Sanitize contextIds (visibility-validate + dedupe) ONCE before the
    // retry loop. Visibility is stable across retries, so paying the
    // round-trip per attempt would be wasteful.
    const sanitizedContextIds = input.contextIds && input.contextIds.length > 0
      ? await this.sanitizeContextIdsForCreate(input.contextIds, scope)
      : undefined;

    // RMW retry loop — two concurrent identifier-match resolves of the same
    // entity must converge instead of one failing on version mismatch.
    // Re-reads `best` on each attempt so the merge is computed against fresh
    // state. Side effects (queueIdentityEmbedding, emit) fire only on
    // successful write.
    const maxAttempts = 3;
    let finalChangedCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const best = await this.store.getEntity(bestId, scope);
      if (!best) {
        return this.createEntity(input, scope);
      }

      const merged = mergeIdentifiersAndAliases(best, input);
      const changedCount = merged.entity.identifiers.length - best.identifiers.length;

      const mergedWithMetadata = applyMetadataMerge(
        merged.entity,
        input.metadata,
        input.metadataMerge,
        input.metadataMergeKeys,
      );

      // contextIds union — dedupe + filter self-references against the
      // current state. Visibility was validated above the retry loop.
      let mergedContextIds: EntityId[] | undefined = mergedWithMetadata.entity.contextIds;
      let contextIdsChanged = false;
      if (sanitizedContextIds && sanitizedContextIds.length > 0) {
        const existing = new Set(mergedContextIds ?? []);
        const toAdd: EntityId[] = [];
        for (const cid of sanitizedContextIds) {
          if (cid === best.id) continue;
          if (existing.has(cid)) continue;
          toAdd.push(cid);
          existing.add(cid);
        }
        if (toAdd.length > 0) {
          mergedContextIds = [...(mergedContextIds ?? []), ...toAdd];
          contextIdsChanged = true;
        }
      }

      const dirty = merged.dirty || mergedWithMetadata.changed || contextIdsChanged;

      if (!dirty) {
        return {
          entity: best,
          created: false,
          mergedIdentifiers: 0,
          mergeCandidates,
        };
      }

      // Dirty path mutates an existing entity — write access required.
      // `allowCrossOwner` lets trusted server-side consolidation update a
      // group-visible entity owned by another user within the SAME group
      // (mirrors `mergeEntities`). The tenancy invariant holds: a cross-tenant
      // best-match still goes through `assertCanAccess`, which denies it.
      const bestGroup = (best as IEntity & { groupId?: string }).groupId;
      const sameGroupTrustedConsolidation =
        options?.allowCrossOwner === true &&
        bestGroup !== undefined &&
        bestGroup === scope.groupId;
      if (!sameGroupTrustedConsolidation) {
        assertCanAccess(best, scope, 'write', 'entity');
      }
      const norm = computeNormalizedFields({
        displayName: mergedWithMetadata.entity.displayName,
        aliases: mergedWithMetadata.entity.aliases,
      });
      const next: IEntity = {
        ...mergedWithMetadata.entity,
        contextIds: mergedContextIds,
        normalizedDisplayName: norm.normalizedDisplayName,
        normalizedAliases: norm.normalizedAliases,
        version: best.version + 1,
        updatedAt: new Date(),
      };
      try {
        await this.store.updateEntity(next);
        this.queueIdentityEmbedding(next, scope, best);
        await this.queueContentEmbeddingIfChanged(next, scope);
        this.emit({ type: 'entity.upsert', entity: next, created: false });
        finalChangedCount = changedCount;
        return {
          entity: next,
          created: false,
          mergedIdentifiers: finalChangedCount,
          mergeCandidates,
        };
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        const isContention = /ConcurrencyError/i.test(name);
        if (!isContention || attempt === maxAttempts) throw err;
        logger.info(
          {
            component: 'MemorySystem.upsertEntity',
            entityId: bestId,
            attempt,
            maxAttempts,
            error: err instanceof Error ? err.message : String(err),
          },
          'retrying after version-mismatch',
        );
      }
    }
    // Unreachable — last iteration's catch re-throws on `attempt === maxAttempts`.
    throw new Error(
      `upsertEntity: exhausted ${maxAttempts} attempts for ${bestId}`,
    );
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
    // Validate any caller-supplied `contextIds`: visibility, dedupe, drop
    // self-references. New entity has no id yet so the self-reference filter
    // is moot here — but downstream union helpers rely on the invariant
    // "contextIds never contains the entity's own id", so apply it cheaply.
    const sanitizedContextIds = await this.sanitizeContextIdsForCreate(
      input.contextIds,
      scope,
    );
    // Build the NewEntity input (no id, version, createdAt, updatedAt).
    const newEntity: NewEntity = {
      type: input.type,
      displayName: input.displayName,
      aliases: input.aliases ? [...input.aliases] : undefined,
      identifiers: input.identifiers.map((i) => ({ ...i, addedAt: i.addedAt ?? now })),
      groupId: input.groupId ?? scope.groupId,
      ownerId,
      metadata: input.metadata,
      contextIds: sanitizedContextIds,
      permissions: this.resolvePermissions(input.permissions, {
        kind: 'entity',
        entityType: input.type,
      }),
      acl: input.acl,
    };
    const entity = await this.store.createEntity(newEntity);
    this.queueIdentityEmbedding(entity, scope);
    await this.queueContentEmbeddingIfChanged(entity, scope);
    this.emit({ type: 'entity.upsert', entity, created: true });
    return {
      entity,
      created: true,
      mergedIdentifiers: entity.identifiers.length,
      mergeCandidates: [],
    };
  }

  /**
   * Sanitize a caller-supplied `contextIds` array before write — visibility
   * check, dedupe, drop empties, drop any id present in `selfReferenceIds`.
   * Returns `undefined` when the resulting array would be empty so we don't
   * store an empty field on the record.
   *
   * Used by both the entity-create path (`createEntity` / `upsertEntity`)
   * and the fact-create path (`addFact`). For facts, `selfReferenceIds`
   * carries `[subjectId, objectId]` — LLM extractions frequently include
   * the subject or object redundantly in `contextIds`, adding graph noise
   * (`memory_list_facts({contextId: subjectId})` would surface every fact
   * about that subject). For entity create the array is moot (no id yet);
   * for entity-update the union path (`addEntityContextIds`) re-filters
   * against the now-known id.
   *
   * @param raw caller-supplied contextIds (possibly undefined / empty)
   * @param scope visibility scope to validate each id against
   * @param opts.selfReferenceIds ids to drop silently (subject/object on facts)
   * @param opts.callerLabel string used in the not-visible error message
   */
  private async sanitizeContextIds(
    raw: EntityId[] | undefined,
    scope: ScopeFilter,
    opts: {
      selfReferenceIds?: ReadonlyArray<EntityId | undefined>;
      callerLabel: string;
    },
  ): Promise<EntityId[] | undefined> {
    if (!raw || raw.length === 0) return undefined;
    const blocked = new Set<EntityId>(
      (opts.selfReferenceIds ?? []).filter((id): id is EntityId => !!id),
    );
    const deduped = [...new Set(raw.filter((id) => !!id && !blocked.has(id)))];
    if (deduped.length === 0) return undefined;
    for (const cid of deduped) {
      const ent = await this.store.getEntity(cid, scope);
      if (!ent) {
        throw new Error(
          `${opts.callerLabel}: context entity ${cid} not visible or not found`,
        );
      }
    }
    return deduped;
  }

  /**
   * @deprecated Backwards-compat alias for the entity-create path. Prefer
   * `sanitizeContextIds` directly with `callerLabel: 'createEntity'`.
   */
  private async sanitizeContextIdsForCreate(
    raw: EntityId[] | undefined,
    scope: ScopeFilter,
  ): Promise<EntityId[] | undefined> {
    return this.sanitizeContextIds(raw, scope, { callerLabel: 'createEntity' });
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
      /**
       * Pre-validated contextIds to union into the entity's existing list.
       * Caller is responsible for visibility-validating these — this helper
       * does the dedupe + self-reference filter + single-write merge.
       */
      contextIdsToUnion?: EntityId[];
    },
  ): Promise<IEntity> {
    // Visibility-check contextIds candidates ONCE before the retry loop.
    // Visibility is stable across retries (an entity doesn't become
    // visible/invisible mid-RMW under realistic deployments), so paying the
    // round-trip per attempt is wasteful and would risk inconsistent errors
    // between retries.
    if (opts?.contextIdsToUnion && opts.contextIdsToUnion.length > 0) {
      for (const cid of opts.contextIdsToUnion) {
        if (!cid || cid === id) continue;
        const ent = await this.store.getEntity(cid, scope);
        if (!ent) {
          throw new Error(
            `appendAliasesAndIdentifiers: context entity ${cid} not visible or not found`,
          );
        }
      }
    }
    // Coerce incoming ISO-string dates to `Date` ONCE before the retry loop.
    const incomingMetadata = coerceMetadataDates(opts?.metadata);
    const incomingMetadataKind = opts?.metadataMerge ?? 'fillMissing';

    // RMW retry loop — two concurrent resolves of the same entity must
    // converge instead of one failing on version mismatch. Cap at 3 attempts;
    // beyond that, the contention is real and the caller should know.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        // Kind-aware equality: case-insensitive only for email/domain/phone/url_host;
        // case-preserving for system_user_id, canonical, slack_id, etc.
        const present = identifiers.some((i) =>
          identifierValuesEqual(i.kind, i.value, ident.kind, ident.value),
        );
        if (!present) {
          identifiers.push({ ...ident, addedAt: ident.addedAt ?? new Date() });
          dirty = true;
        }
      }

      // Metadata merge — fillMissing (default) never overwrites existing keys;
      // overwrite is a shallow merge where incoming wins. No-op if no incoming.
      let nextMetadata: Record<string, unknown> | undefined = current.metadata;
      if (incomingMetadata && Object.keys(incomingMetadata).length > 0) {
        const existing = (current.metadata ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...existing };
        for (const [k, v] of Object.entries(incomingMetadata)) {
          if (v === undefined) continue;
          if (incomingMetadataKind === 'fillMissing' && k in existing) continue;
          if (!metadataDeepEqual(merged[k], v)) {
            merged[k] = v;
            dirty = true;
          }
        }
        nextMetadata = merged;
      }

      // contextIds union — dedupe against existing, drop self-references.
      // Visibility was checked above the retry loop.
      let nextContextIds: EntityId[] | undefined = current.contextIds;
      if (opts?.contextIdsToUnion && opts.contextIdsToUnion.length > 0) {
        const existing = new Set(current.contextIds ?? []);
        const toAdd: EntityId[] = [];
        for (const cid of opts.contextIdsToUnion) {
          if (!cid || cid === id) continue;
          if (existing.has(cid)) continue;
          toAdd.push(cid);
          existing.add(cid);
        }
        if (toAdd.length > 0) {
          nextContextIds = [...(current.contextIds ?? []), ...toAdd];
          dirty = true;
        }
      }

      if (!dirty) return current;

      const nextAliases = aliases.length > 0 ? aliases : current.aliases;
      const norm = computeNormalizedFields({
        displayName: current.displayName,
        aliases: nextAliases,
      });
      const next: IEntity = {
        ...current,
        aliases: nextAliases,
        identifiers,
        metadata: nextMetadata,
        contextIds: nextContextIds,
        normalizedDisplayName: norm.normalizedDisplayName,
        normalizedAliases: norm.normalizedAliases,
        version: current.version + 1,
        updatedAt: new Date(),
      };
      try {
        await this.store.updateEntity(next);
        this.queueIdentityEmbedding(next, scope, current);
        await this.queueContentEmbeddingIfChanged(next, scope);
        this.emit({ type: 'entity.upsert', entity: next, created: false });
        return next;
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        const isContention = /ConcurrencyError/i.test(name);
        if (!isContention || attempt === maxAttempts) throw err;
        logger.info(
          {
            component: 'MemorySystem.appendAliasesAndIdentifiers',
            entityId: id,
            attempt,
            maxAttempts,
            error: err instanceof Error ? err.message : String(err),
          },
          'retrying after version-mismatch',
        );
      }
    }
    // Unreachable — last iteration's catch re-throws on `attempt === maxAttempts`.
    throw new Error(
      `appendAliasesAndIdentifiers: exhausted ${maxAttempts} attempts for ${id}`,
    );
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

  /**
   * Queue a content-embedding refresh for any entity mutation. Composes the
   * type-specific content text via the registered `EntityContentComposer`,
   * diffs against the stored `contentEmbeddingText`, and enqueues only when
   * the text actually changed.
   *
   * **Diff strategy:** the freshly-composed text is compared to
   * `entity.contentEmbeddingText` (the text-of-record from the prior embed).
   * This means:
   *   - No composer registered for the type → no-op.
   *   - Composer returns `''` → no embedding; clears any stale stored embedding.
   *   - Composed text equals stored text → no-op (saves an embedder call).
   *   - Composed text differs → enqueue. Queue worker writes both
   *     `contentEmbedding` and `contentEmbeddingText` atomically on success.
   *
   * Async because composers resolve referenced entity ids
   * (`assigneeId`, `projectId`, `contextIds`, ...) to displayNames. Cost is
   * one batched `getEntities` round-trip per call site — bounded by the
   * referenced-id count, typically ≤ 10.
   *
   * **Errors are surfaced via logger.warn, never thrown.** Embedding is a
   * best-effort retrieval enhancement; a composer crash should never break
   * the mutation that triggered it. The composed text is also logged on
   * error so operators can reproduce the failure.
   *
   * **Cross-scope caveat:** the `CachedComposeContext` is bound to `scope`,
   * so the composer sees only entities visible to the *writer*. If two
   * writers with different visibility (e.g. one can see a referenced
   * `assigneeId`, the other cannot) update the same entity in succession,
   * each will compose different text and the stored `contentEmbedding` /
   * `contentEmbeddingText` will flip back and forth between writes. This is
   * a rare edge — in practice referenced entities are co-visible with their
   * referent — but worth knowing if you build a host with split-visibility
   * scopes that share write access on the same entity.
   *
   * **Composer removal caveat:** if the composer for `entity.type` is removed
   * (e.g. operator changed `entityContentComposers` config without restarting
   * a migration), this method short-circuits without clearing the prior
   * embedding. Existing entities keep stale `contentEmbedding` /
   * `contentEmbeddingText` forever. To converge, run
   * `backfillContentEmbeddings(scope, {types: ['<type>']})` after the config
   * change; the backfill skips entities whose composer no longer exists, so
   * a follow-up pass that clears the field would be needed to fully drop the
   * stale state (the library does not currently ship such a helper — open an
   * issue if you hit this).
   */
  private async queueContentEmbeddingIfChanged(
    entity: IEntity,
    scope: ScopeFilter,
  ): Promise<void> {
    if (!this.embedder) return;
    const composer = this.contentComposers.get(entity.type);
    if (!composer) return;
    let text: string;
    try {
      const ctx = new CachedComposeContext(this.store, scope);
      text = await composer.compose(entity, ctx);
    } catch (err) {
      logger.warn(
        {
          component: 'MemorySystem.queueContentEmbeddingIfChanged',
          entityId: entity.id,
          entityType: entity.type,
          error: err instanceof Error ? err.message : String(err),
        },
        'composer threw; skipping content embedding for this write',
      );
      return;
    }
    if (text.length === 0) return;
    if (entity.contentEmbeddingText === text) return; // No change → no re-embed.
    this.queue.enqueueContent(entity.id, text, scope);
  }

  /**
   * Queue a fact's content-embedding refresh via the configured fact composer.
   * Same model as `queueContentEmbeddingIfChanged` for entities: compose,
   * diff against the prior embedded text (stored on the fact as
   * `summaryForEmbedding`), enqueue when different. Empty composer output
   * skips the embed.
   *
   * Per-fact errors are logged and swallowed.
   */
  private async queueFactContentEmbeddingIfChanged(
    fact: IFact,
    scope: ScopeFilter,
  ): Promise<void> {
    if (!this.embedder) return;
    if (fact.isSemantic === false) return; // Caller explicitly opted out.
    let text: string;
    try {
      const ctx = new CachedComposeContext(this.store, scope);
      text = await this.factComposer.compose(fact, ctx);
    } catch (err) {
      logger.warn(
        {
          component: 'MemorySystem.queueFactContentEmbeddingIfChanged',
          factId: fact.id,
          predicate: fact.predicate,
          error: err instanceof Error ? err.message : String(err),
        },
        'fact composer threw; skipping embedding for this write',
      );
      return;
    }
    if (text.length === 0) return;
    // Diff against `embeddingText` (library-owned), NOT `summaryForEmbedding`
    // (caller-owned). The queue writes `embeddingText` after every successful
    // embed; callers manage `summaryForEmbedding` independently.
    if ((fact.embeddingText ?? '') === text && fact.embedding) return;
    this.queue.enqueueFact(fact.id, text, scope);
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
   *
   * Read-side date coercion: ISO-8601 strings inside `metadataFilter` are
   * coerced to `Date` here (once, at the public boundary) so adapters always
   * see Date-typed values in range/equality clauses. Without it, callers (LLM
   * tools especially) writing the natural shape — `{ startTime: { $gte:
   * "2026-05-14T00:00:00Z" } }` — would silently get zero matches against
   * `metadata.startTime` (BSON Date), because Mongo and the InMemory comparator
   * treat String and Date as distinct types in range comparisons. Adapters do
   * not re-coerce — DRY, single point of responsibility across all backends.
   */
  listEntities(
    filter: import('./types.js').EntityListFilter,
    opts: import('./types.js').ListOptions,
    scope: ScopeFilter,
  ) {
    assertNotDestroyed(this, 'listEntities');
    const normalized = filter.metadataFilter
      ? { ...filter, metadataFilter: coerceMetadataDates(filter.metadataFilter) }
      : filter;
    return this.store.listEntities(normalized, opts, scope);
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
  async upsertEntityBySurface(
    input: UpsertBySurfaceInput,
    scope: ScopeFilter,
    opts?: UpsertBySurfaceOptions,
  ): Promise<UpsertBySurfaceResult> {
    assertNotDestroyed(this, 'upsertEntityBySurface');
    const result = await this.resolver.upsertBySurface(input, scope, opts);
    // 0.9.1: structured event for Tier-4 auto-merges. Resolver also logs at
    // warn level for operator visibility; this event lets hosts route to an
    // activity log (e.g. jarvis_activity_log on v25) without scraping logs.
    if (result.resolved && result.matchedOn === 'embedding') {
      this.emit({
        type: 'entity.upsert.semantic_automerge',
        entityId: result.entity.id,
        mergedSurface: input.surface,
        cosine: result.rawSemanticScore ?? 0,
        mergeCandidateIds: result.mergeCandidates.map((c) => c.entity.id),
      });
    }
    return result;
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
    options?: {
      /**
       * Allow merging entities owned by different users within the same
       * group/tenant. Default `false`.
       *
       * When `true`: the per-entity `assertCanAccess(write)` check is
       * skipped (both winner and loser may be owned by users other than
       * `scope.userId`), AND the same bypass is applied while rewriting
       * fact references so the graph stays coherent post-merge.
       *
       * Tenancy invariant is preserved: the call refuses if
       * `winner.groupId !== loser.groupId`. The host is responsible for
       * gating which callers may pass the flag (typically a group/super
       * admin running a legitimate consolidation pass).
       *
       * The owner of the surviving winner is unchanged either way — only
       * the loser is archived, so its ownerId becomes irrelevant after.
       */
      allowCrossOwner?: boolean;
    },
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

    // Permission model:
    //   - Default: caller must have write access to BOTH winner and loser
    //     (matches the rest of the write surface — assertCanAccess uses
    //     ownerId / explicit permissions / group `write` level).
    //   - `allowCrossOwner: true`: callers running a legitimate consolidation
    //     of group-visible types (e.g., Person/Organization records that the
    //     host's pipeline duplicated across multiple users in the same group)
    //     can merge without re-owning each loser first. The tenancy invariant
    //     is preserved — both entities MUST share `groupId` — so this never
    //     enables cross-tenant data movement. The host is responsible for
    //     gating which callers may pass the flag.
    //
    // The owner of the surviving WINNER is unchanged either way — only the
    // loser is archived, so its ownerId becomes irrelevant after the call.
    if (options?.allowCrossOwner) {
      const winnerGroup = (winner as IEntity & { groupId?: string }).groupId;
      const loserGroup = (loser as IEntity & { groupId?: string }).groupId;
      if (winnerGroup !== loserGroup) {
        throw new Error(
          `mergeEntities: allowCrossOwner refuses cross-tenant merge ` +
            `(winner.groupId=${winnerGroup ?? 'null'} loser.groupId=${loserGroup ?? 'null'})`,
        );
      }
    } else {
      // Write access required on both: winner is updated (identifiers + aliases +
      // version bump), loser is archived. Either being read-only denies the merge.
      assertCanAccess(winner, scope, 'write', 'entity');
      assertCanAccess(loser, scope, 'write', 'entity');
    }

    // Merge identifiers + aliases into winner
    const merged = mergeIdentifiersAndAliases(winner, {
      identifiers: loser.identifiers,
      aliases: loser.aliases,
    });
    const norm = computeNormalizedFields({
      displayName: merged.entity.displayName,
      aliases: merged.entity.aliases,
    });
    const nextWinner: IEntity = {
      ...merged.entity,
      normalizedDisplayName: norm.normalizedDisplayName,
      normalizedAliases: norm.normalizedAliases,
      version: winner.version + 1,
      updatedAt: new Date(),
    };
    await this.store.updateEntity(nextWinner);

    // Rewrite facts: subjectId, objectId, or contextIds entry === loserId → winnerId.
    // In cross-owner mode the same authorization bypass applies — otherwise
    // facts owned by other users in the group would keep their dangling
    // pointers to the archived loser entity, leaving the graph incoherent.
    await this.rewriteFactReferences(loserId, winnerId, scope, {
      allowCrossOwner: !!options?.allowCrossOwner,
    });

    // Rewrite entity-level contextIds — entities whose contextIds array
    // contains loserId get the reference replaced with winnerId (deduped,
    // self-reference suppressed). Mirrors the fact-side rewrite above. Without
    // this step, the first entity merge after entity-contextIds shipped would
    // leave permanent dangling pointers — the same v25 wrapper gap the fact
    // path closed.
    await this.rewriteEntityContextIdReferences(loserId, winnerId, scope, {
      allowCrossOwner: !!options?.allowCrossOwner,
    });

    // Rewrite access grants: any record readable/writable via `entity:loserId`
    // now grants `entity:winnerId` instead. Without this, records granted to
    // the loser's principal become invisible to callers holding the winner's
    // principal after the loser is archived — the substrate for "account links
    // later, prior facts stay visible". Optional store capability; stores that
    // don't implement it simply skip ACL-grant rewriting.
    await this.store.rewriteEntityPrincipal?.(loserId, winnerId, scope);

    // Archive loser
    await this.store.archiveEntity(loserId, scope);

    this.emit({ type: 'entity.merge', winnerId, loserId });

    // Winner's identity surface (aliases ∪ identifiers) may have grown — re-embed
    // if changed. Helper compares pre/post identity strings and no-ops on no-change.
    this.queueIdentityEmbedding(nextWinner, scope, winner);
    // Winner's content (aliases + identifiers + possibly referenced entities)
    // may now compose to different text — re-run composer + diff to refresh.
    await this.queueContentEmbeddingIfChanged(nextWinner, scope);

    // Winner's effective atomic-fact count grew (loser's subject-facts now point at
    // winner). Trigger a profile regen check on the winner's scope. Background; never
    // blocks the merge return. Uses void to surface unhandled-rejection failures via
    // maybeRegenerateProfile's own console.warn.
    const winnerScope: ScopeFields = {
      groupId: nextWinner.groupId,
      ownerId: nextWinner.ownerId ?? scope.userId,
    };
    void this.maybeRegenerateProfile(winnerId, winnerScope);

    return nextWinner;
  }

  /**
   * Replace the explicit `acl` on an entity or fact and re-materialize its
   * `readPrincipals`/`writePrincipals` in place. The sanctioned exception to
   * fact-immutability for ACCESS changes (same category as the merge rewrite).
   * Caller must have `write` on the record.
   *
   * Backs host grant/revoke surfaces. Returns the updated record.
   */
  async setAccess(
    kind: 'entity' | 'fact',
    id: string,
    acl: ACLEntry[],
    scope: ScopeFilter,
  ): Promise<IEntity | IFact> {
    assertNotDestroyed(this, 'setAccess');
    if (kind === 'entity') {
      const entity = await this.store.getEntity(id, scope);
      if (!entity) {
        throw new Error(`setAccess: entity ${id} not found or not visible in caller scope`);
      }
      assertCanAccess(entity, scope, 'write', 'entity');
      const { readPrincipals, writePrincipals } = principalsForLibraryRecord({ ...entity, acl });
      const next: IEntity = {
        ...entity,
        acl,
        readPrincipals,
        writePrincipals,
        version: entity.version + 1,
        updatedAt: new Date(),
      };
      await this.store.updateEntity(next);
      this.emit({ type: 'entity.upsert', entity: next, created: false });
      return next;
    }
    const fact = await this.store.getFact(id, scope);
    if (!fact) {
      throw new Error(`setAccess: fact ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(fact, scope, 'write', 'fact');
    const { readPrincipals, writePrincipals } = principalsForLibraryRecord({ ...fact, acl });
    await this.store.updateFact(id, { acl, readPrincipals, writePrincipals }, scope);
    return { ...fact, acl, readPrincipals, writePrincipals };
  }

  private async rewriteFactReferences(
    fromId: EntityId,
    toId: EntityId,
    scope: ScopeFilter,
    options?: { allowCrossOwner?: boolean },
  ): Promise<void> {
    // Permission-window caveat (composes with scope-window caveat on mergeEntities):
    // by default we skip facts the caller can see but cannot write. Those
    // facts keep their old reference — the merge is incomplete for that
    // subset. Documented on mergeEntities; no warning here to avoid log spam.
    //
    // With `allowCrossOwner: true` (host running a legitimate cross-owner
    // consolidation), per-fact authorization is bypassed too — otherwise
    // facts owned by other users in the same group would dangle pointing
    // at the archived loser entity, leaving the graph incoherent.
    const allowCrossOwner = options?.allowCrossOwner === true;
    //
    // **Pagination shape — load-bearing (was previously buggy).** Loops
    // re-query from offset 0 each iteration with NO cursor. Each rewrite
    // removes the fact from its current filter set (e.g. `subjectId: fromId`
    // no longer matches after subject is set to `toId`), so the next pass
    // picks up the remainder without advancing an offset. Cursor-based
    // pagination would silently leak unrewritten facts past 200: after page 1
    // rewrites N items, the filtered result has shrunk by N, and `skip:N`
    // lands past the remaining matches → empty page → loop exits with N
    // unwritten facts still holding the loser reference. Verified bug on
    // both InMemoryAdapter (offset-slice in `paginate`) and MongoMemoryAdapter
    // (offset via `parseCursor` → Mongo `skip`).
    //
    // Termination: "no writes this round" exits the loop in case every
    // remaining item is write-denied (caller lacks write on those facts).
    // Without the guard the loop would spin forever — the filter still
    // matches them, the cursor-free re-query keeps returning them.
    //
    // orderBy is required by the adapter pagination contract (see
    // adapters/orderByWarning.ts). `createdAt asc` is stable, monotonic, and
    // unaffected by the mutations the loop performs.
    const REWRITE_ORDER: FactOrderBy = { field: 'createdAt', direction: 'asc' };

    // Subjects
    while (true) {
      const page = await this.store.findFacts(
        { subjectId: fromId },
        { limit: 200, orderBy: REWRITE_ORDER },
        scope,
      );
      if (page.items.length === 0) break;
      let writtenThisRound = 0;
      for (const f of page.items) {
        if (!allowCrossOwner && !canAccess(f, scope, 'write')) continue;
        await this.store.updateFact(f.id, { subjectId: toId }, scope);
        writtenThisRound++;
      }
      if (writtenThisRound === 0) break;
    }

    // Objects
    while (true) {
      const page = await this.store.findFacts(
        { objectId: fromId },
        { limit: 200, orderBy: REWRITE_ORDER },
        scope,
      );
      if (page.items.length === 0) break;
      let writtenThisRound = 0;
      for (const f of page.items) {
        if (!allowCrossOwner && !canAccess(f, scope, 'write')) continue;
        await this.store.updateFact(f.id, { objectId: toId }, scope);
        writtenThisRound++;
      }
      if (writtenThisRound === 0) break;
    }

    // ContextIds. Previously this method left contextIds pointing at the archived
    // loser, so any fact with `contextIds: [loser, ...]` would never surface for
    // the winner via `getContext` traversal. Closes the v25 host wrapper gap
    // documented in oneringai memory reference_oneringai_merge_contextids_gap.
    //
    // Dedupe rules when rewriting:
    //   - Drop loser from the array (filter).
    //   - Add winner if not already present.
    //   - Drop winner if it equals the fact's own subject or object — a fact
    //     "in the context of itself" is redundant noise; getContext already
    //     surfaces via subject/object.
    //   - If the resulting array is empty, write `[]` (not undefined) — the
    //     Mongo driver coerces $set-undefined into a stored null which read
    //     paths treat differently from a missing field; empty array is
    //     observationally equivalent to undefined in all readers (truthy but
    //     `.includes()` returns false).
    while (true) {
      const page = await this.store.findFacts(
        { contextId: fromId },
        { limit: 200, orderBy: REWRITE_ORDER },
        scope,
      );
      if (page.items.length === 0) break;
      let writtenThisRound = 0;
      for (const f of page.items) {
        if (!allowCrossOwner && !canAccess(f, scope, 'write')) continue;
        const filtered = (f.contextIds ?? []).filter((id) => id !== fromId);
        if (toId !== f.subjectId && toId !== f.objectId && !filtered.includes(toId)) {
          filtered.push(toId);
        }
        await this.store.updateFact(f.id, { contextIds: filtered }, scope);
        writtenThisRound++;
      }
      if (writtenThisRound === 0) break;
    }
  }

  /**
   * Rewrite entity-level `contextIds` references — same shape as
   * `rewriteFactReferences`' contextIds pass, applied to entities instead of
   * facts. Walks entities whose `contextIds` array contains `fromId` and
   * patches each to point at `toId` (dedup + self-reference filter).
   *
   * Authorization mirrors the fact rewrite: by default skips entities the
   * caller can't write (entity stays pointing at the archived loser — a known
   * scope-window cost, documented on `mergeEntities`). `allowCrossOwner`
   * bypasses per-record write for legitimate consolidation passes.
   *
   * Empty results array is written as `undefined` rather than `[]` so the
   * stored shape matches "no contextIds" — symmetric with how this method
   * treats facts (`[]` for facts because the index path tolerates either;
   * for entities we prefer omitting the field entirely for cleaner reads).
   *
   * **Pagination shape — load-bearing.** Loops with NO cursor — re-queries
   * from offset 0 each iteration. The rewrite removes each item from the
   * filter set (`contextIds: fromId` no longer matches after the write), so
   * the next iteration naturally picks up the remaining matches without
   * needing to advance an offset. Using cursor-based pagination here would
   * silently leak unrewritten items: page 1 rewrites N items and advances
   * cursor to N, but the filter result has shrunk by N, so cursor:N lands
   * past the remaining matches → empty page → loop exits with items still
   * holding the loser reference. The "no writes this round" termination
   * guard handles the case where every remaining item is write-denied
   * (preventing an infinite loop).
   */
  private async rewriteEntityContextIdReferences(
    fromId: EntityId,
    toId: EntityId,
    scope: ScopeFilter,
    options?: { allowCrossOwner?: boolean },
  ): Promise<void> {
    const allowCrossOwner = options?.allowCrossOwner === true;
    while (true) {
      const page = await this.store.listEntities(
        { contextId: fromId },
        {
          limit: 200,
          orderBy: [
            { field: 'updatedAt', direction: 'asc' },
            { field: 'id', direction: 'asc' },
          ],
        },
        scope,
      );
      if (page.items.length === 0) break;
      let writtenThisRound = 0;
      for (const e of page.items) {
        if (!allowCrossOwner && !canAccess(e, scope, 'write')) continue;
        // Drop fromId; add toId unless it's the entity itself (self-reference
        // suppression) or already present.
        const filtered = (e.contextIds ?? []).filter((id) => id !== fromId);
        if (toId !== e.id && !filtered.includes(toId)) {
          filtered.push(toId);
        }
        const next: IEntity = {
          ...e,
          contextIds: filtered.length > 0 ? filtered : undefined,
          version: e.version + 1,
          updatedAt: new Date(),
        };
        await this.store.updateEntity(next);
        this.emit({ type: 'entity.upsert', entity: next, created: false });
        writtenThisRound++;
      }
      // Fixed-point: every item in this page was write-denied. Stop —
      // continuing would loop forever (filter still matches them).
      if (writtenThisRound === 0) break;
    }
  }

  /**
   * Archive an entity (soft delete). Cascades to facts where the entity is
   * `subjectId` or `objectId` — those get archived too.
   *
   * **Tombstone semantics for `contextIds` (NO cascade):** facts whose
   * `contextIds` array references this entity, and other entities whose
   * top-level `contextIds` references this one, are LEFT UNCHANGED. The
   * reference becomes a dangling pointer — readers resolving the id see
   * `null` (archived), the referencing record stays live. Symmetric across
   * fact-contextIds (long-standing behavior) and entity-contextIds.
   * Rationale: contextIds is a soft multi-anchor binding, not a hard
   * structural edge; force-removing it on archive would destructively
   * mutate consumer records the caller may not even own. Hosts that want
   * a stronger semantic should run a sweep after archive.
   */
  async archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    assertNotDestroyed(this, 'archiveEntity');
    const entity = await this.store.getEntity(id, scope);
    if (!entity) {
      throw new Error(`archiveEntity: entity ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(entity, scope, 'write', 'entity');
    // Cascade: archive facts referencing this entity first so consumers never
    // see active edges pointing at an archived (null on getEntity) node.
    // NOTE: `archiveFactsReferencing` cascades only via subjectId/objectId —
    // contextIds references (both fact-level and entity-level) follow the
    // tombstone rule documented above.
    await this.archiveFactsReferencing(id, scope);
    await this.store.archiveEntity(id, scope);
    this.emit({ type: 'entity.archive', entityId: id });
  }

  /**
   * Delete an entity. Soft (default): same cascade rules as `archiveEntity`.
   * Hard (`opts.hard: true`): the entity row is removed; facts where it's
   * subject/object are archived. **Same tombstone rule for `contextIds`:**
   * contextIds references — fact-level and entity-level — are left as dangling
   * pointers. See `archiveEntity` JSDoc for rationale.
   */
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
      // Hard delete: remove entity + archive every fact referencing it via
      // subject/object. contextIds references untouched (tombstone rule).
      await this.rewriteFactsForDeletion(id, scope);
      await this.store.deleteEntity(id, scope);
    } else {
      // Soft delete: archive entity + archive facts referencing it via
      // subject/object. contextIds references untouched (tombstone rule).
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
   * Return the configured predicate registry, or `undefined` when none is
   * set. Exposed so prompt-rendering layers (e.g. `MemoryWritePluginNextGen`)
   * can generate LLM-facing predicate vocabulary from the same source of
   * truth — avoids hand-maintained predicate lists drifting out of sync
   * with what the storage layer actually accepts and ranks.
   */
  getPredicateRegistry(): PredicateRegistry | undefined {
    return this.predicates;
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

  /**
   * Surface configuration drift that would make this MemorySystem unsafe for
   * enterprise multi-tenant deployment. Returns a list of human-readable
   * failings rather than throwing — hosts gate startup on `findings.length`.
   *
   * **Two readiness tiers — `ok` is not "fully enterprise ready":**
   *
   *  - **`ok === true`** → the MINIMUM-SAFETY tier passed: **data integrity
   *    invariants are held + tenant isolation is enforceable**. No
   *    `severity: 'error'` findings remain. The host can boot without
   *    risking cross-tenant data leaks, owner-required violations, or
   *    permission-denial bypasses, but the LLM-writer ergonomics may still
   *    be lax.
   *  - **`ok === true` AND `findings.every(f => f.severity !== 'warn')`** →
   *    the FULL enterprise-readiness tier. Adds the strict-vocabulary
   *    guarantee (LLM writers can't invent predicates), enables Mongo's
   *    fast paths for vector search, and confirms the adapter is fully
   *    tuned. This is what production deployments should actually gate on.
   *
   * Operators who want the stricter gate:
   * ```ts
   * const { ok, findings } = memory.assertEnterpriseReady();
   * const enterpriseReady = ok && findings.every((f) => f.severity !== 'warn');
   * if (!enterpriseReady) throw new Error(`Memory not fully ready: ${JSON.stringify(findings)}`);
   * ```
   *
   * **Severity rationale:**
   *  - `'error'` is reserved for invariant violations — config that lets
   *    bad data into the store or leaks across tenants (no
   *    `visibilityPolicy`, no `PredicateRegistry` at all).
   *  - `'warn'` covers quality / ergonomics — config that hurts retrieval,
   *    consistency, or LLM-write hygiene but doesn't compromise integrity
   *    (permissive predicate mode, missing vector index names).
   *
   * **What's checked:**
   *  - **error** — `PredicateRegistry` is configured. Without one,
   *    predicates remain free-form strings; fragmentation is guaranteed
   *    under any LLM-driven write path.
   *  - **error** — `visibilityPolicy` is set. Library defaults grant
   *    world-read to every entity/fact (`644`-style) — unsafe by default
   *    for enterprise. A policy that returns `{ world: 'none' }` (private)
   *    or `{ world: 'none', group: 'read' }` (group-readable) is the
   *    typical enterprise baseline.
   *  - **warn** — `predicateMode === 'strict'`. Permissive mode + LLM
   *    writers fragments the predicate vocabulary over time (`prefers` vs
   *    `prefer` vs `preference`), eroding dedup and ranking quality. Not
   *    an error because the data still has owners + permissions; only the
   *    vocabulary hygiene is at risk.
   *  - **warn** — Mongo adapter: `vectorIndexName` is set (drives Atlas
   *    Vector Search fast paths). Skipped for InMemoryAdapter.
   *  - **warn** — Mongo adapter + embedder present: `entityContentVectorIndexName`
   *    is set. Without it `findSimilarOpenTasks`, document search, and any
   *    composer-driven retrieval fall back to the slow path.
   *
   * **What's NOT checked** (require side effects the library shouldn't
   * trigger from a readonly probe):
   *  - Whether the Mongo unique partial index on
   *    `{identifiers.kind, identifiers.value}` actually exists. Run a
   *    migration-side probe (`db.entities.getIndexes()`).
   *  - Whether the unique normalized-name partial index from
   *    `ensureNormalizedNameUniqueIndex` exists. Same — migration-side.
   *  - Whether `ensureVectorSearchIndexes()` has been called against Atlas.
   *    Idempotent to call again from your migration; that's the supported path.
   *
   * @returns `{ ok, findings }` where `findings[i] = { severity, code, message }`.
   *          `ok === findings.every(f => f.severity !== 'error')` — the
   *          MINIMUM-SAFETY tier. See JSDoc for the full enterprise gate.
   */
  assertEnterpriseReady(): {
    ok: boolean;
    findings: Array<{ severity: 'error' | 'warn'; code: string; message: string }>;
  } {
    assertNotDestroyed(this, 'assertEnterpriseReady');
    const findings: Array<{ severity: 'error' | 'warn'; code: string; message: string }> = [];

    // 1. Predicate mode + registry.
    if (this.predicateMode !== 'strict') {
      findings.push({
        severity: 'warn',
        code: 'predicate-mode-permissive',
        message:
          "predicateMode is 'permissive' — LLM writers can invent predicates that " +
          "bypass the registry's canonicalization, dedup, and ranking weights. " +
          "Set predicateMode='strict' + supply `predicates: PredicateRegistry.standard()` " +
          'for enterprise deployments.',
      });
    }
    if (!this.predicates) {
      findings.push({
        severity: 'error',
        code: 'no-predicate-registry',
        message:
          'No PredicateRegistry configured. Without one, predicates remain ' +
          'free-form strings — fragmentation is guaranteed under any LLM-driven write path. ' +
          'Supply `predicates: PredicateRegistry.standard()` on MemorySystem construction.',
      });
    }

    // 2. Visibility policy.
    if (!this.visibilityPolicy) {
      findings.push({
        severity: 'error',
        code: 'no-visibility-policy',
        message:
          'No `visibilityPolicy` configured. Library defaults grant world-read ' +
          "on every entity and fact (UNIX `644`-style) — unsafe for multi-tenant " +
          'deployment. Supply a policy that returns `{ world: \'none\' }` (or ' +
          "`{ world: 'none', group: 'read' }` for group-shared records).",
      });
    }

    // 3. Mongo-adapter specifics. Probe via duck-typing — the library doesn't
    // depend on `mongodb` directly here so we avoid `instanceof`.
    const mongoLike = this.store as unknown as {
      vectorIndexName?: string;
      entityVectorIndexName?: string;
      entityContentVectorIndexName?: string;
      ensureVectorSearchIndexes?: unknown;
    };
    const isMongoLike = typeof mongoLike.ensureVectorSearchIndexes === 'function';
    if (isMongoLike) {
      if (!mongoLike.vectorIndexName) {
        findings.push({
          severity: 'warn',
          code: 'mongo-no-fact-vector-index',
          message:
            "Mongo adapter has no `vectorIndexName` — semantic fact search " +
            'will fall back to the slow path. Configure on adapter construction ' +
            "AND call `adapter.ensureVectorSearchIndexes({ dimensions })` from " +
            'your migration.',
        });
      }
      if (this.embedder && !mongoLike.entityContentVectorIndexName) {
        findings.push({
          severity: 'warn',
          code: 'mongo-no-entity-content-vector-index',
          message:
            'Embedder is configured but Mongo adapter has no ' +
            '`entityContentVectorIndexName` — `findSimilarOpenTasks`, document ' +
            'semantic search, and any `semanticSearchEntities({embeddingField:\'content\'})` ' +
            'caller will fall back to the slow path.',
        });
      }
    }

    const ok = findings.every((f) => f.severity !== 'error');
    return { ok, findings };
  }

  /**
   * Backfill `normalizedDisplayName` + `normalizedAliases` on entities written
   * before v0.8.0 (or by adapter paths that bypassed the storage-boundary
   * stamp). Iterates entities in `scope` in batches, recomputes the fields
   * from each entity's current `displayName` / `aliases`, and writes when the
   * stored value differs.
   *
   * Idempotent — running twice with the same data is a no-op. Run before
   * `ensureNormalizedNameUniqueIndex` (the unique partial index would fail
   * to build if pre-backfill dups exist).
   *
   * Returns `{ scanned, updated, skipped }` for caller observability:
   *  - `scanned` — total entities visited.
   *  - `updated` — wrote an entity because at least one field differed.
   *  - `skipped` — entity already had both fields populated and consistent;
   *    no write performed.
   *
   * **Concurrency caveat:** the backfill uses `updateEntity` (optimistic
   * concurrency on `version`). Concurrent writers bumping the version
   * between read and write trigger a retry once; further conflicts surface
   * as `OptimisticConcurrencyError` on the helper.
   *
   * **Force mode:** pass `{ force: true }` to write every scanned entity
   * regardless of whether the stored value differs. Useful when
   * `normalizeSurface` has been tweaked and the entire population needs
   * re-stamping. Default is the cheaper differ-only path.
   */
  async backfillNormalizedFields(
    scope: ScopeFilter,
    opts?: { batchSize?: number; force?: boolean },
  ): Promise<{ scanned: number; updated: number; skipped: number }> {
    assertNotDestroyed(this, 'backfillNormalizedFields');
    const batchSize = Math.max(1, Math.min(opts?.batchSize ?? 500, 1000));
    const force = opts?.force === true;
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let cursor: string | undefined;
    do {
      const page = await this.store.listEntities(
        {},
        // Explicit `_id asc` for stable pagination — backfill must touch every
        // row exactly once, and natural-order pagination loses items when the
        // cursor's anchor moves. Also silences the listEntities order-warning
        // when run against MongoMemoryAdapter.
        { limit: batchSize, cursor, orderBy: { field: '_id', direction: 'asc' } },
        scope,
      );
      for (const entity of page.items) {
        scanned++;
        const norm = computeNormalizedFields({
          displayName: entity.displayName,
          aliases: entity.aliases,
        });
        const sameDisplay = entity.normalizedDisplayName === norm.normalizedDisplayName;
        const storedAliases = entity.normalizedAliases ?? [];
        const sameAliases =
          storedAliases.length === norm.normalizedAliases.length &&
          storedAliases.every((a, i) => a === norm.normalizedAliases[i]);
        if (!force && sameDisplay && sameAliases) {
          skipped++;
          continue;
        }
        const next: IEntity = {
          ...entity,
          normalizedDisplayName: norm.normalizedDisplayName,
          normalizedAliases: norm.normalizedAliases,
          version: entity.version + 1,
          updatedAt: new Date(),
        };
        try {
          await this.store.updateEntity(next);
          updated++;
        } catch (err) {
          // Re-read and retry once — adapter's optimistic-concurrency error
          // means another writer bumped the version in the gap. Second pass
          // gets the latest version; if that also conflicts, surface the
          // error (caller can re-run the backfill).
          const fresh = await this.store.getEntity(entity.id, scope);
          if (!fresh) {
            // Race-deleted between list + retry; skip silently.
            skipped++;
            continue;
          }
          const freshNorm = computeNormalizedFields({
            displayName: fresh.displayName,
            aliases: fresh.aliases,
          });
          await this.store.updateEntity({
            ...fresh,
            normalizedDisplayName: freshNorm.normalizedDisplayName,
            normalizedAliases: freshNorm.normalizedAliases,
            version: fresh.version + 1,
            updatedAt: new Date(),
          });
          updated++;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    return { scanned, updated, skipped };
  }

  /**
   * Backfill `readPrincipals` / `writePrincipals` on every entity + fact (live
   * AND archived) written before the principal model — or by any path that
   * predates the storage-boundary stamp. Recomputes each row's arrays from its
   * `ownerId` / `groupId` / `permissions` / `acl` and writes when they differ.
   *
   * THE MIGRATION GATE: a host MUST run this to completion before it starts
   * passing `scope.principals`. Query-time (Mongo) filtering has NO legacy
   * fallback for rows lacking `readPrincipals` — an un-backfilled row is simply
   * invisible to a principal caller (see `ScopeFilter.principals`).
   *
   * Idempotent — re-running with the same data is a no-op (arrays are recomputed
   * deterministically and compared before writing). `{ force: true }` rewrites
   * every row regardless (use after the materialization rules change).
   *
   * Entities go through `updateEntity` (the storage boundary re-stamps the
   * arrays) with the same retry-once optimistic-concurrency handling as
   * `backfillNormalizedFields`. Facts are patched directly with the computed
   * arrays (no `updateFact` recompute is triggered — the patch carries the
   * arrays, not the access-source fields).
   */
  async backfillAccessPrincipals(
    scope: ScopeFilter,
    opts?: { batchSize?: number; force?: boolean },
  ): Promise<{
    entitiesScanned: number;
    entitiesUpdated: number;
    factsScanned: number;
    factsUpdated: number;
  }> {
    assertNotDestroyed(this, 'backfillAccessPrincipals');
    const batchSize = Math.max(1, Math.min(opts?.batchSize ?? 500, 1000));
    const force = opts?.force === true;
    const arrEq = (a: string[] | undefined, b: string[] | undefined): boolean => {
      const x = a ?? [];
      const y = b ?? [];
      return x.length === y.length && x.every((v, i) => v === y[i]);
    };
    const matches = (
      rec: { readPrincipals?: string[]; writePrincipals?: string[] },
      expected: { readPrincipals: string[]; writePrincipals: string[] },
    ): boolean =>
      arrEq(rec.readPrincipals, expected.readPrincipals) &&
      arrEq(rec.writePrincipals, expected.writePrincipals);

    let entitiesScanned = 0;
    let entitiesUpdated = 0;
    // Two passes: live (archived hidden by default) + archived. Entities are
    // soft-deleted in place (no separate archive collection), so updateEntity
    // re-stamps archived rows too — and the merge rewrite already touches them.
    for (const archivedPass of [undefined, true] as const) {
      let cursor: string | undefined;
      do {
        const page = await this.store.listEntities(
          archivedPass === undefined ? {} : { archived: true },
          { limit: batchSize, cursor, orderBy: { field: '_id', direction: 'asc' } },
          scope,
        );
        for (const entity of page.items) {
          entitiesScanned++;
          if (!force && matches(entity, principalsForLibraryRecord(entity))) continue;
          // updateEntity re-stamps the arrays at the storage boundary.
          try {
            await this.store.updateEntity({
              ...entity,
              version: entity.version + 1,
              updatedAt: new Date(),
            });
            entitiesUpdated++;
          } catch (err) {
            // Treated as an optimistic-concurrency conflict: another writer
            // bumped the version in the gap. Re-read and retry once against the
            // fresh version. `getEntity` hides archived rows, so on the archived
            // pass a conflict simply defers to a later run / force. NEVER
            // swallow silently — log with full context so a genuine storage
            // fault (not a benign race) is visible, then let the retry surface
            // it by throwing if it recurs.
            logger.warn(
              {
                component: 'MemorySystem.backfillAccessPrincipals',
                entityId: entity.id,
                archivedPass: archivedPass === true,
                error: err instanceof Error ? err.message : String(err),
              },
              'updateEntity failed during access-principal backfill; re-reading and retrying once',
            );
            const fresh = await this.store.getEntity(entity.id, scope);
            if (!fresh) continue;
            await this.store.updateEntity({
              ...fresh,
              version: fresh.version + 1,
              updatedAt: new Date(),
            });
            entitiesUpdated++;
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
    }

    let factsScanned = 0;
    let factsUpdated = 0;
    // Two passes: live (archived hidden by default) + archived. updateFact
    // resolves the archive collection on its own when the id lives there.
    // Order by `_id` (unique, immutable) — NOT `createdAt`: bulk-ingested facts
    // share a millisecond, and offset pagination over a non-unique sort can skip
    // a tied boundary fact, leaving it un-materialized and so invisible to every
    // principal caller (this is the migration gate). `_id` is a total order, so
    // each fact is touched exactly once. Mirrors the entity pass above.
    for (const archivedPass of [undefined, true] as const) {
      let cursor: string | undefined;
      do {
        const page = await this.store.findFacts(
          archivedPass === undefined ? {} : { archived: true },
          { limit: batchSize, cursor, orderBy: { field: '_id', direction: 'asc' } },
          scope,
        );
        for (const fact of page.items) {
          factsScanned++;
          const expected = principalsForLibraryRecord(fact);
          if (!force && matches(fact, expected)) continue;
          await this.store.updateFact(
            fact.id,
            {
              readPrincipals: expected.readPrincipals,
              writePrincipals: expected.writePrincipals,
            },
            scope,
          );
          factsUpdated++;
        }
        cursor = page.nextCursor;
      } while (cursor);
    }

    return { entitiesScanned, entitiesUpdated, factsScanned, factsUpdated };
  }

  /**
   * Migration helper — for every fact with the given `predicate`, hoist the
   * fact's `contextIds` array onto the target entity's `contextIds` (union
   * merge). Target entity is the fact's `subject` or `object` depending on
   * `entitySide`.
   *
   * Reference recipe — hoist legacy `committed_to(person, task)` linkage onto
   * task entities (the v10-era pattern that v11+ writes natively as
   * `task.contextIds`):
   *
   * ```ts
   * await memory.hoistContextIdsFromFactsToEntities({
   *   predicate: 'committed_to',
   *   entitySide: 'object',
   *   entityType: 'task',
   *   archiveSource: false, // keep originals as provenance until host confirms
   * }, scope);
   * ```
   *
   * Idempotent — `addEntityContextIds` deduplicates against existing values.
   * Safe to re-run. Skips facts with empty `contextIds`, missing target id,
   * or where the target entity type doesn't match `entityType`.
   *
   * **Performance.** O(facts-with-this-predicate). Pass `batchSize` to tune
   * memory pressure vs round-trips (default 200, hard ceiling 1000).
   *
   * **Source archival.** When `archiveSource: true`, the source fact is
   * archived after the hoist succeeds for that fact. Defaults to `false`
   * because hosts often want to keep the original fact for provenance — the
   * migration is informational, not destructive.
   */
  async hoistContextIdsFromFactsToEntities(
    opts: {
      predicate: string;
      entitySide: 'subject' | 'object';
      entityType?: string;
      batchSize?: number;
      dryRun?: boolean;
      archiveSource?: boolean;
    },
    scope: ScopeFilter,
  ): Promise<{
    scannedFacts: number;
    /** Facts that triggered a real entity write (added >= 1 new contextId). */
    hoistedEntities: number;
    /**
     * Facts where the target entity already had every contextId — no write
     * performed. Important for migration planning: re-runs of an idempotent
     * migration are expected to land entirely in this bucket. Also bumped on
     * dry-run when the simulated hoist would have been a no-op.
     */
    skippedAlreadyHoisted: number;
    skippedNoContextIds: number;
    skippedWrongType: number;
    skippedNoTarget: number;
    archivedFacts: number;
    errors: number;
  }> {
    assertNotDestroyed(this, 'hoistContextIdsFromFactsToEntities');
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 1000));
    const archiveSource = opts.archiveSource === true;
    const dryRun = opts.dryRun === true;
    const predicate = this.predicates
      ? this.predicates.canonicalize(opts.predicate)
      : opts.predicate;
    const result = {
      scannedFacts: 0,
      hoistedEntities: 0,
      skippedAlreadyHoisted: 0,
      skippedNoContextIds: 0,
      skippedWrongType: 0,
      skippedNoTarget: 0,
      archivedFacts: 0,
      errors: 0,
    };
    // Pagination shape mirrors `rewriteFactReferences` / `rewriteEntityContextIdReferences`:
    // when `archiveSource: true`, archiving the source fact removes it from
    // the `archived:false` filter — cursor offsets advance past unhoisted
    // facts. We track `seenIds` across iterations so a non-archiving run
    // (dryRun OR archiveSource=false) doesn't reprocess the same fact
    // forever. `seenIds` plus the "no progress this round" exit handles both
    // modes uniformly.
    const seenIds = new Set<FactId>();
    while (true) {
      const page = await this.store.findFacts(
        { predicate, archived: false },
        {
          limit: batchSize,
          orderBy: { field: 'createdAt', direction: 'asc' },
        },
        scope,
      );
      if (page.items.length === 0) break;
      let progressedThisRound = 0;
      for (const f of page.items) {
        if (seenIds.has(f.id)) continue;
        seenIds.add(f.id);
        result.scannedFacts++;
        progressedThisRound++;
        if (!f.contextIds || f.contextIds.length === 0) {
          result.skippedNoContextIds++;
          continue;
        }
        const targetId = opts.entitySide === 'object' ? f.objectId : f.subjectId;
        if (!targetId) {
          result.skippedNoTarget++;
          continue;
        }
        // Resolve the target entity. Needed for both entityType filtering
        // AND (for accurate counters / dry-run) for the pre-check of how
        // many additions would actually take effect. Done once per fact.
        const target = await this.store.getEntity(targetId, scope);
        if (!target) {
          result.skippedNoTarget++;
          continue;
        }
        if (opts.entityType !== undefined && target.type !== opts.entityType) {
          result.skippedWrongType++;
          continue;
        }
        // Pre-compute how many of the fact's contextIds would be NEW on the
        // target. Mirrors the dedupe + self-reference logic in
        // `addEntityContextIds` (deliberately duplicated rather than read
        // back from the helper's return so dry-run gets the same answer
        // without writing). Visibility is NOT checked here — that's
        // `addEntityContextIds`'s job on the real-run path. For dry-run we
        // accept that a visibility-rejected addition would inflate the
        // "would-hoist" count slightly; this is an acceptable estimate
        // because dry-run is for planning, not strict accounting.
        const existingCtx = new Set(target.contextIds ?? []);
        let wouldAdd = 0;
        for (const cid of f.contextIds) {
          if (!cid || cid === target.id) continue;
          if (existingCtx.has(cid)) continue;
          wouldAdd++;
          existingCtx.add(cid);
        }
        if (wouldAdd === 0) {
          result.skippedAlreadyHoisted++;
          continue;
        }
        if (dryRun) {
          // Would have hoisted ≥1 new contextId — counted.
          result.hoistedEntities++;
          continue;
        }
        try {
          const hoist = await this.addEntityContextIds(targetId, f.contextIds, scope);
          if (hoist.added > 0) {
            result.hoistedEntities++;
          } else {
            // Race: another writer landed the same additions between our
            // pre-check and the addEntityContextIds call. Reflect what
            // actually happened.
            result.skippedAlreadyHoisted++;
          }
          if (archiveSource) {
            await this.archiveFact(f.id, scope);
            result.archivedFacts++;
          }
        } catch (err) {
          result.errors++;
          logger.warn(
            {
              component: 'MemorySystem.hoistContextIdsFromFactsToEntities',
              factId: f.id,
              targetId,
              error: err instanceof Error ? err.message : String(err),
            },
            'hoist failed for fact — continuing',
          );
        }
      }
      // Termination: every fact in this page was already seen (re-query
      // returned the same docs we've already processed). Happens when
      // archiveSource=false — facts stay in the filter forever otherwise.
      if (progressedThisRound === 0) break;
    }
    return result;
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
        // Monotonic bump: re-ingesting an OLDER signal (replay, late delivery,
        // backfill) must not move `observedAt` backwards — recency ranking
        // depends on forward-only progression. Pick the max of incoming vs.
        // existing.
        const incoming = input.observedAt ?? new Date();
        const bumped =
          existing.observedAt && incoming < existing.observedAt
            ? existing.observedAt
            : incoming;
        await this.store.updateFact(existing.id, { observedAt: bumped }, scope);
        return { ...existing, observedAt: bumped };
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

    // Sanitize contextIds: visibility-check + dedupe + drop empties + drop
    // self-references (subjectId/objectId). LLM extractions frequently emit
    // the subject or object redundantly in contextIds, which adds graph
    // noise (`memory_list_facts({contextId: subjectId})` would surface every
    // fact about that subject) and inflates retrieval ranking via duplicate
    // context-binding boosts. Mirrors the entity-create path's sanitation.
    const sanitizedFactContextIds = await this.sanitizeContextIds(
      input.contextIds,
      scope,
      {
        selfReferenceIds: [input.subjectId, input.objectId],
        callerLabel: 'addFact',
      },
    );

    const factScope = deriveFactScope(input, subject, scope);
    if (!factScope.ownerId) {
      // Owner invariant: every fact must carry an ownerId. deriveFactScope
      // falls back to input.ownerId → subject.ownerId → undefined. Undefined
      // means the caller provided none AND the subject entity is itself
      // ownerless (legacy data). Reject explicitly.
      throw new OwnerRequiredError('fact');
    }
    assertScopeInvariant(subject, factScope);

    // Auto-supersede for singleValued predicates (e.g. current_title, current_role).
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
    const observedAt = input.observedAt ?? now;

    // Auto-stamp `validUntil` from predicate lifecycle. Only fires when the
    // caller did not provide `validUntil` AND the registry definition has
    // `defaultValidityDays`. Used by ephemeral/episodic predicates so old
    // commitments and per-message observations naturally expire instead of
    // accumulating in the active graph. Stable/stateful predicates have no
    // `defaultValidityDays` and therefore remain valid forever (stateful
    // ones get superseded; stable ones live indefinitely).
    let autoValidUntil = input.validUntil;
    if (autoValidUntil === undefined && def?.defaultValidityDays !== undefined) {
      const days = def.defaultValidityDays;
      if (Number.isFinite(days) && days > 0) {
        autoValidUntil = new Date(observedAt.getTime() + days * MILLIS_PER_DAY);
      }
    }

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
      contextIds: sanitizedFactContextIds,
      supersedes,
      archived: input.archived,
      isAggregate: input.isAggregate ?? def?.isAggregate,
      observedAt,
      validFrom: input.validFrom,
      validUntil: autoValidUntil,
      metadata: input.metadata,
      permissions: this.resolvePermissions(input.permissions, {
        kind: 'fact',
        predicate,
        factKind: input.kind,
      }),
      acl: input.acl,
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

    // Compose + queue content embedding via the fact composer. Composer
    // produces meaningful surface text even for short atomic facts (replaces
    // the legacy 80-char threshold). `queueFactContentEmbeddingIfChanged`
    // handles all opt-outs:
    //   - caller pre-supplied `fact.embedding` → trust it, skip
    //   - `fact.isSemantic === false` → caller opted out
    //   - composer returns '' → fact has no embeddable content
    //   - composed text matches stored `summaryForEmbedding` → no re-embed
    if (!fact.embedding) {
      await this.queueFactContentEmbeddingIfChanged(fact, scope);
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
   * Scheduled lifecycle sweep — archives facts whose `validUntil` is in the
   * past relative to `asOf` (defaults to "now"). Host applications call this
   * on a daily cadence to keep the visible graph trimmed.
   *
   * Contract:
   * - Only affects facts that already have `validUntil` set. Facts without
   *   `validUntil` are valid forever and never touched.
   * - Only archives facts that are NOT already archived.
   * - Archived facts remain queryable via `archivedOnly` / `includeArchived`
   *   paths — this is soft archive, not hard delete.
   * - Scope-bounded: the caller's scope determines which facts are visible.
   *   Multi-tenant schedulers iterate over scopes and call once per scope.
   * - Emits BOTH `fact.archive` and `fact.expire` per archived fact. The
   *   `fact.archive` event preserves the "any archival" contract that
   *   existing subscribers (cache invalidators, audit appenders) depend on;
   *   `fact.expire` is the lifecycle-specific signal carrying predicate +
   *   validUntil for observability that wants to distinguish automatic
   *   expiry from operator/agent archives.
   *
   * Returns the count of facts archived in this sweep. Paginated internally
   * to bound memory; pageSize defaults to 500.
   */
  async expireFacts(
    opts: {
      /** Cutoff. Facts with `validUntil < asOf` are eligible. Defaults to `new Date()`. */
      asOf?: Date;
      /**
       * Restrict to specific predicates. When omitted, all expired facts in
       * scope are archived. Pass `[]` to short-circuit to 0 (no-op).
       */
      predicates?: string[];
      /** Maximum number of facts to archive in this call. Defaults to unbounded. */
      limit?: number;
      /** Internal page size for findFacts. Defaults to 500. */
      pageSize?: number;
    },
    scope: ScopeFilter,
  ): Promise<{ archived: number }> {
    assertNotDestroyed(this, 'expireFacts');

    const asOf = opts.asOf ?? new Date();
    const predicates = opts.predicates;
    if (predicates && predicates.length === 0) return { archived: 0 };
    const hardLimit = opts.limit;
    const pageSize = Math.max(1, opts.pageSize ?? 500);

    const filter: FactFilter = {
      validUntilBefore: asOf,
      archived: false,
    };
    if (predicates && predicates.length > 0) filter.predicates = predicates;

    let archived = 0;
    // Drain in pages. Each page is bounded; we re-query because the previous
    // page's facts have moved out of the non-archived set so the next page's
    // offset would shift anyway.
    while (true) {
      if (hardLimit !== undefined && archived >= hardLimit) break;
      const remaining =
        hardLimit !== undefined ? Math.min(pageSize, hardLimit - archived) : pageSize;
      const page = await this.store.findFacts(
        filter,
        { limit: remaining, orderBy: { field: 'observedAt', direction: 'asc' } },
        scope,
      );
      if (page.items.length === 0) break;
      for (const fact of page.items) {
        // Defensive — store SHOULD honor the filter, but if not we'd loop.
        if (fact.archived) continue;
        if (!fact.validUntil || fact.validUntil >= asOf) continue;
        await this.store.updateFact(fact.id, { archived: true }, scope);
        archived += 1;
        // Emit both: `fact.archive` for the generic "any archival" contract,
        // `fact.expire` for callers that want to distinguish automatic
        // expiry from operator/agent archives.
        this.emit({ type: 'fact.archive', factId: fact.id });
        this.emit({
          type: 'fact.expire',
          factId: fact.id,
          predicate: fact.predicate,
          validUntil: fact.validUntil,
        });
      }
      // Loop break when the page is smaller than the requested size — there
      // is no next page even if we have remaining budget.
      if (page.items.length < remaining) break;
    }

    return { archived };
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

    const patch: Partial<IFact> = {
      details,
      // Clear stale embedding state — the queue will repopulate via composer.
      // Caller-owned `summaryForEmbedding` is preserved (caller's override
      // intent must survive a details-only update).
      embedding: undefined,
      embeddingText: undefined,
    };
    await this.store.updateFact(id, patch, scope);

    // Re-embed via composer through the queue. The queue handles retries +
    // failure observability via the existing `fact.embedding.failed` event,
    // so we drop the inline embed-and-write path used pre-composer.
    if (this.embedder && details.length > 0) {
      const refreshed = await this.store.getFact(id, scope);
      if (refreshed) {
        await this.queueFactContentEmbeddingIfChanged(refreshed, scope);
      }
    }

    const updated = await this.store.getFact(id, scope);
    return updated ?? { ...fact, ...patch };
  }

  /**
   * Apply entity-anchored reconciliation operations (Pillar 2).
   *
   * Caller has:
   *   1. Built an `entityReconciliationPrompt` for ONE entity's non-archived facts.
   *   2. Run that prompt through an extractor (LLM call).
   *   3. Parsed the LLM output into `ReconciliationOp[]` via `parseExtractionWithStatus`.
   *
   * This method dispatches the resulting ops against the fact graph:
   *   - `update` → `updateFact` (value / details / observedAt patch).
   *   - `archive` → `archiveFact`.
   *   - `create` ops are REJECTED (counted as `rejectedHallucinated` in the
   *     outcome) — Pillar 2 only resolves, never creates.
   *
   * factId validation: every `update`/`archive` op's `factId` MUST appear in
   * `priorFacts`. Hallucinations are rejected with a warn-level log entry.
   *
   * Returns op-level counts so callers can log decisions + emit activity-log
   * entries (per `feedback_log_every_decision`).
   */
  async applyEntityReconciliationOps(
    ops: ReconciliationOp[],
    priorFacts: IFact[],
    scope: ScopeFilter,
    opts?: {
      /** Optional skeptic filter — return false to drop an op with logging. */
      skepticFilter?: (op: ReconciliationOp) => boolean;
      /**
       * Source signal id to stamp on `updateFact` patches. Optional — entity
       * reconciliation isn't bound to a single source signal (that's the
       * point), so callers may leave it undefined.
       */
      sourceSignalId?: string;
    },
  ): Promise<OperationOutcome> {
    assertNotDestroyed(this, 'applyEntityReconciliationOps');

    const outcome: OperationOutcome = {
      creates: 0,
      updates: 0,
      archives: 0,
      rejectedHallucinated: 0,
      rejectedSkeptic: 0,
    };
    const priorFactIds = new Set(priorFacts.map((f) => f.id));
    const priorById = new Map(priorFacts.map((f) => [f.id, f]));

    for (const op of ops) {
      if (opts?.skepticFilter && !opts.skepticFilter(op)) {
        outcome.rejectedSkeptic++;
        continue;
      }

      if (op.op === 'create') {
        // Pillar 2 doesn't create. The LLM emitting a create op here is a
        // contract violation — log and skip.
        outcome.rejectedHallucinated++;
        this.emit({
          type: 'fact.reconcile.rejected',
          factId: null,
          reason: 'create op emitted in entity-reconciliation (Pillar 2 only resolves)',
        });
        continue;
      }

      if (!priorFactIds.has(op.factId)) {
        outcome.rejectedHallucinated++;
        this.emit({
          type: 'fact.reconcile.rejected',
          factId: op.factId,
          reason: `${op.op}: factId not in priorFacts (hallucinated)`,
        });
        continue;
      }

      if (op.op === 'update') {
        const target = priorById.get(op.factId)!;
        const patch: Partial<IFact> = {
          observedAt: new Date(),
        };
        if (opts?.sourceSignalId) {
          patch.sourceSignalId = opts.sourceSignalId;
        }
        if (op.newValue !== undefined) {
          if (target.kind === 'document' && op.details === undefined) {
            patch.details = typeof op.newValue === 'string'
              ? op.newValue
              : JSON.stringify(op.newValue);
          } else {
            patch.value = op.newValue;
          }
        }
        if (op.details !== undefined) {
          patch.details = op.details;
        }
        if (op.evidenceQuote !== undefined) {
          patch.evidenceQuote = op.evidenceQuote;
        }
        await this.updateFact(op.factId, patch, scope);
        outcome.updates++;
      } else if (op.op === 'archive') {
        await this.archiveFact(op.factId, scope);
        outcome.archives++;
      }
    }

    return outcome;
  }

  /**
   * Apply signal-reconciliation operations (the SECOND pass — see
   * `signalReconciliationPrompt`). Generic over signal source: the caller has
   * extracted NEW facts/tasks in pass 1, loaded the PRIOR facts/tasks
   * (deterministic + semantic, de-duplicated), run `signalReconciliationPrompt`,
   * and parsed the output via `parseSignalReconciliationOpsWithStatus`.
   *
   * Dispatch:
   *   - FACT ops are delegated to {@link applyEntityReconciliationOps} — `archive`
   *     supersedes, `update` mutates in place, `create` is rejected (the pass
   *     reconciles, it does not create — pass 1 owns creation). Every fact op's
   *     `factId` is validated against `context.priorFacts`.
   *   - `task_update` ops mutate the task in place: `newState` routes through
   *     {@link transitionTaskState} (state + `stateHistory` + `completedAt`),
   *     and `narrative` / `dueAt` / `assigneeId` patch the metadata. Every
   *     `taskId` is validated against `context.priorTasks`; hallucinated ids are
   *     rejected. When `newState` moves the task into a TERMINAL state, the task
   *     metadata is stamped with AI-resolution provenance (`aiResolved`,
   *     `aiResolutionReason`, `aiResolutionEvidenceQuote`, `aiResolvedAt`) so the
   *     host can distinguish AI auto-resolution from user action.
   *
   * Returns op-level counts (fact creates/updates/archives + task updates/resolves
   * + rejections) so callers can log every decision per
   * `feedback_log_every_decision`.
   */
  async applyReconciliationOps(
    ops: SignalReconciliationOp[],
    context: { priorFacts: IFact[]; priorTasks: IEntity[] },
    scope: ScopeFilter,
    opts?: {
      /** Optional skeptic filter — return false to drop an op with logging. */
      skepticFilter?: (op: SignalReconciliationOp) => boolean;
      /** Source signal id stamped on fact-update patches + task state history. */
      sourceSignalId?: string;
      /** Transition timestamp. Defaults to now. */
      at?: Date;
    },
  ): Promise<SignalReconciliationOutcome> {
    assertNotDestroyed(this, 'applyReconciliationOps');

    const taskOps = ops.filter((o): o is TaskReconciliationOp => o.op === 'task_update');
    const factOps = ops.filter((o): o is ReconciliationOp => o.op !== 'task_update');

    // Fact ops reuse the existing, well-tested entity-reconciliation dispatch
    // (archive/update; create rejected). A `(SignalReconciliationOp) => boolean`
    // filter is assignable where `(ReconciliationOp) => boolean` is expected
    // (contravariant param — ReconciliationOp ⊆ SignalReconciliationOp).
    const factOutcome = await this.applyEntityReconciliationOps(factOps, context.priorFacts, scope, {
      ...(opts?.skepticFilter ? { skepticFilter: opts.skepticFilter } : {}),
      ...(opts?.sourceSignalId ? { sourceSignalId: opts.sourceSignalId } : {}),
    });

    const outcome: SignalReconciliationOutcome = {
      ...factOutcome,
      taskUpdates: 0,
      taskResolves: 0,
    };

    const priorTaskIds = new Set(context.priorTasks.map((t) => t.id));
    const at = opts?.at ?? new Date();

    for (const op of taskOps) {
      if (opts?.skepticFilter && !opts.skepticFilter(op)) {
        outcome.rejectedSkeptic++;
        continue;
      }
      if (!priorTaskIds.has(op.taskId)) {
        outcome.rejectedHallucinated++;
        this.emit({
          type: 'fact.reconcile.rejected',
          factId: op.taskId,
          reason: 'task_update: taskId not in priorTasks (hallucinated)',
        });
        continue;
      }
      try {
        const resolved = await this.applyTaskUpdateOp(op, scope, at, opts?.sourceSignalId);
        outcome.taskUpdates++;
        if (resolved) outcome.taskResolves++;
      } catch (err) {
        outcome.rejectedHallucinated++;
        this.emit({
          type: 'fact.reconcile.rejected',
          factId: op.taskId,
          reason: `task_update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return outcome;
  }

  /**
   * Apply a single `task_update` reconciliation op. Returns `true` when the op
   * moved the task into a TERMINAL state (AI-resolved), `false` otherwise.
   *
   * Sequencing: state transition first (so `stateHistory`/`completedAt` are
   * written by the canonical path), then a single metadata patch for the
   * remaining fields plus AI-resolution provenance when terminal.
   */
  private async applyTaskUpdateOp(
    op: TaskReconciliationOp,
    scope: ScopeFilter,
    at: Date,
    sourceSignalId: string | undefined,
  ): Promise<boolean> {
    const task = await this.store.getEntity(op.taskId, scope);
    if (!task) {
      throw new Error(`applyTaskUpdateOp: task ${op.taskId} not found or not visible`);
    }
    if (task.type !== 'task') {
      throw new Error(`applyTaskUpdateOp: entity ${op.taskId} is type '${task.type}', expected 'task'`);
    }

    let movedToTerminal = false;
    if (typeof op.newState === 'string' && op.newState.trim().length > 0) {
      const before = (task.metadata as Record<string, unknown> | undefined)?.state;
      await this.transitionTaskState(
        op.taskId,
        op.newState,
        { reason: op.reason, signalId: sourceSignalId, at },
        scope,
      );
      movedToTerminal = this._taskStates.terminal.includes(op.newState) && before !== op.newState;
    }

    const patch: Record<string, unknown> = {};
    if (typeof op.narrative === 'string') patch.narrative = op.narrative;
    if (typeof op.dueAt === 'string') patch.dueAt = op.dueAt; // coerced to Date by updateEntityMetadata
    if (typeof op.assigneeId === 'string') patch.assigneeId = op.assigneeId;
    if (movedToTerminal) {
      patch.aiResolved = true;
      patch.aiResolutionReason = op.reason ?? '';
      if (typeof op.evidenceQuote === 'string') patch.aiResolutionEvidenceQuote = op.evidenceQuote;
      patch.aiResolvedAt = at;
    }
    if (Object.keys(patch).length > 0) {
      if (!('refreshedAt' in patch)) patch.refreshedAt = at;
      await this.updateEntityMetadata(op.taskId, patch, scope);
    }

    return movedToTerminal;
  }

  /**
   * Mutate a fact in-place. Used by per-conversation reconciliation
   * (ExtractionResolver) to update `value` / `details` / `observedAt` /
   * `sourceSignalId` / `evidenceQuote` on a prior fact when the LLM emits
   * an `update` op — replacing the legacy "supersede chain" pattern that
   * left tombstones behind.
   *
   * Restrictions:
   * - Cannot change `subjectId`, `predicate`, `kind`, `objectId`, `id`,
   *   `createdAt`, `archived` (use `archiveFact` / `restoreFact`).
   * - Caller's scope must have write access to the fact.
   *
   * Side effects:
   * - When `details` changes, re-computes `isSemantic`, clears stale
   *   `embedding` + `summaryForEmbedding`, and re-embeds on the embedder
   *   queue (best-effort).
   */
  async updateFact(
    id: FactId,
    patch: Partial<
      Pick<
        IFact,
        | 'value'
        | 'details'
        | 'observedAt'
        | 'sourceSignalId'
        | 'evidenceQuote'
        | 'confidence'
        | 'importance'
        | 'metadata'
      >
    >,
    scope: ScopeFilter,
  ): Promise<IFact> {
    assertNotDestroyed(this, 'updateFact');
    const fact = await this.store.getFact(id, scope);
    if (!fact) {
      throw new Error(`updateFact: fact ${id} not found or not visible in caller scope`);
    }
    assertCanAccess(fact, scope, 'write', 'fact');

    const storePatch: Partial<IFact> = { ...patch };
    // Clamp ranking inputs at the boundary — mirrors `addFact:confidence/
    // importance` so a reconciliation pass that emits e.g. `importance: 99`
    // (LLM hallucination) can't distort retrieval. Only clamps when the
    // caller actually provided the field; missing keys stay missing.
    if (patch.confidence !== undefined) {
      storePatch.confidence = clampUnit01(patch.confidence) ?? 1.0;
    }
    if (patch.importance !== undefined) {
      storePatch.importance = clampUnit01(patch.importance);
    }
    // Detect any composer-input change that requires the embedding to be
    // refreshed. Default atomic-fact composer reads `details` and `value`
    // (subject/object surface forms are resolved at embed time, so subject/
    // object id changes are out of scope here — and `updateFact`'s Pick
    // doesn't allow patching `subjectId`/`objectId` anyway).
    //
    // Custom composers that read other fact fields can call
    // `queueFactContentEmbeddingIfChanged` directly; the helper is idempotent.
    const composerInputChanged =
      ('details' in patch && patch.details !== fact.details) ||
      ('value' in patch && !metadataDeepEqual(patch.value, fact.value));

    if (composerInputChanged) {
      // Clear the stale embedding + library-owned text. Caller-owned
      // `summaryForEmbedding` is preserved (the composer may use it as an
      // override on the next pass).
      storePatch.embedding = undefined;
      storePatch.embeddingText = undefined;
    }
    await this.store.updateFact(id, storePatch, scope);

    if (composerInputChanged && this.embedder) {
      const refreshed = await this.store.getFact(id, scope);
      if (refreshed) {
        await this.queueFactContentEmbeddingIfChanged(refreshed, scope);
      }
    }

    const updated = await this.store.getFact(id, scope);
    return updated ?? { ...fact, ...storePatch };
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
   * when the caller's own scope has no prior; the extra read is scoped to
   * that hot path, not a general overhead.
   *
   * **Detection caveat (BOTH adapters).** The empty `ScopeFilter` passed
   * here is NOT a true admin view — it's a world-readable view. Both Mongo
   * (`scopeFilter.ts`) and InMemory (`AccessControl.canAccess`) translate
   * `{}` into "owner shortcut off, group shortcut off, world permission
   * gate applies", which means private (`permissions.world: 'none'`) or
   * group-only outer facts WILL be missed here and the corresponding
   * `supersede_skipped_outer_scope` event won't fire for them. The
   * resulting per-caller "current" is still correct for the caller's
   * read view — only the cross-scope observability signal is partial.
   * A true admin-bypass scope flag would close this gap but is invasive;
   * tracked separately.
   */
  private async findOuterScopePrior(
    subjectId: EntityId,
    predicate: string,
    callerScope: ScopeFilter,
  ): Promise<IFact | null> {
    // Empty scope = world-readable view (see JSDoc caveat). NOT a true
    // admin bypass — private/group-only outer facts are skipped.
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
          // Fetch a wide superset (10× the keep-rate); we re-rank in memory
          // for confidence × recency × predicate weight × importance. The 10×
          // multiplier means rankFacts sees a meaningful candidate pool — at
          // 3× a high-importance fact at storage position 46 never reaches
          // the ranker. Memory cost is bounded (15 default × 10 = 150 facts).
          limit: topFactsLimit * TOP_FACTS_OVERFETCH_MULTIPLIER,
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
   * Semantic kNN over open tasks. Embeds `queryText` and ranks active tasks
   * by similarity against their **`contentEmbedding`** — the metadata-rich
   * composed text (state, due date, assignee/project displayNames,
   * description, contextIds — see `taskContentComposer` in
   * `composers/defaults.ts`). This is what lets generic-title tasks like
   * "Follow up" rank correctly when 50 tasks share a name but differ on
   * assignee/project/dueAt.
   *
   * Pushes the task-state filter into the vector pipeline via
   * `EntitySemanticSearchFilter.states` when configured filter paths support
   * it (`metadata.state` in `ENTITIES_FILTER_PATHS` on Mongo Atlas). The
   * post-filter loop is kept as belt-and-suspenders for adapters that
   * silently ignore unknown filter fields.
   *
   * Returns empty array when no embedder/semantic adapter is configured —
   * callers should treat semantic similarity as opportunistic, not load-bearing.
   */
  async findSimilarOpenTasks(
    queryOrVector: string | number[],
    scope: ScopeFilter,
    opts?: {
      topK?: number;
      minScore?: number;
      taskStates?: string[];
      /**
       * Narrow the search to tasks whose top-level `contextIds` includes this
       * entity id. Pushed into the underlying `semanticSearchEntities` filter
       * → Atlas `$vectorSearch.filter` clause. Requires `'contextIds'` in the
       * entities vector index's filter paths (declared by default — see
       * `ENTITIES_FILTER_PATHS` in MongoMemoryAdapter).
       */
      contextId?: EntityId;
      /**
       * Narrow by assignee entity id. Pushed into vector pipeline filter via
       * `metadata.assigneeId` path. Useful for "tasks for Alice similar to X"
       * scoped queries.
       */
      assigneeId?: EntityId;
      /**
       * Narrow by project entity id. Pushed into vector pipeline filter via
       * `metadata.projectId` path.
       */
      projectId?: EntityId;
      /**
       * Narrow by reporter entity id. Pushed into vector pipeline filter via
       * `metadata.reporterId` path. Mirrors `assigneeId`. Useful for surgical
       * "tasks where X is reporter" queries — e.g. "what did I ask Y to do?".
       */
      reporterId?: EntityId;
      /**
       * OR-wildcard role match — narrows to tasks where this entity appears
       * in any of `metadata.assigneeId`, `metadata.reporterId`,
       * `metadata.projectId`, or top-level `contextIds`. The entity-side
       * analog of `FactFilter.touchesEntity`.
       *
       * Prefer this over fanning out N separate role-narrowed searches and
       * unioning client-side: the union is pushed into Atlas
       * `$vectorSearch.filter` as one compound `$or`, so vector ranking sees
       * the participant-touching candidates together rather than competing
       * across role-specific top-K cuts.
       */
      touchesEntity?: EntityId;
      /**
       * Multi-anchor variant of `touchesEntity` — narrows to tasks touched by
       * ANY id in this array (any of `assigneeId`/`reporterId`/`projectId`/
       * `contextIds`). Use for participant fan-out: pass every participant +
       * context-anchor entity id and let ONE ranked vector query surface the
       * tasks relevant to the whole signal, instead of N per-anchor searches
       * unioned client-side. ANDs with `touchesEntity` when both are set.
       */
      touchesAnyOf?: EntityId[];
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

    if (typeof this.store.semanticSearchEntities !== 'function') return [];

    // Accept a pre-computed vector (from `embedQuery`) to skip the per-call
    // embed round-trip when fanning out searches with the same query.
    let queryVector: number[];
    if (typeof queryOrVector === 'string') {
      if (!this.embedder) return [];
      try {
        queryVector = await this.embedder.embed(queryOrVector);
      } catch (err) {
        logger.warn(
          {
            component: 'MemorySystem.findSimilarOpenTasks',
            error: err instanceof Error ? err.message : String(err),
          },
          'embed failed; returning empty result',
        );
        return [];
      }
    } else {
      queryVector = queryOrVector;
    }

    // Push every available filter into the vector pipeline. Adapter +
    // ENTITIES_FILTER_PATHS declare which fields are honored; unknown fields
    // are silently dropped by the adapter (acceptable — post-filter catches
    // the rest).
    const semanticFilter: EntitySemanticSearchFilter = { type: 'task', states: activeStates };
    if (opts?.contextId !== undefined) semanticFilter.contextId = opts.contextId;
    if (opts?.assigneeId !== undefined) semanticFilter.assigneeId = opts.assigneeId;
    if (opts?.reporterId !== undefined) semanticFilter.reporterId = opts.reporterId;
    if (opts?.projectId !== undefined) semanticFilter.projectId = opts.projectId;
    if (opts?.touchesEntity !== undefined) semanticFilter.touchesEntity = opts.touchesEntity;
    if (opts?.touchesAnyOf !== undefined && opts.touchesAnyOf.length > 0) {
      semanticFilter.touchesAnyOf = opts.touchesAnyOf;
    }

    let candidates: Array<{ entity: IEntity; score: number }>;
    try {
      // Over-fetch with a real floor so small `topK` still survives the
      // post-state-filter (e.g. topK=1 would otherwise pull only 3 rows; if
      // all happen to fail the post-filter the result is empty when an
      // active match existed at rank 4). Once `metadata.state` is declared
      // as a filter path everywhere, the over-fetch could shrink — leaving
      // it as defence-in-depth.
      const overFetch = Math.min(Math.max(topK * 3, FIND_SIMILAR_OVER_FETCH_FLOOR), 300);
      candidates = await this.store.semanticSearchEntities(
        queryVector,
        semanticFilter,
        { topK: overFetch, minScore, embeddingField: 'content' },
        scope,
      );
    } catch (err) {
      logger.warn(
        {
          component: 'MemorySystem.findSimilarOpenTasks',
          error: err instanceof Error ? err.message : String(err),
        },
        'semanticSearchEntities failed; returning empty result',
      );
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

  /**
   * General-purpose entity-level semantic search over the content embedding
   * (`IEntity.contentEmbedding`, populated by the registered per-type content
   * composers). The type-agnostic analog of `findSimilarOpenTasks` (task-only)
   * and `searchDocuments` (document-only): rank ANY entity type by semantic
   * similarity to a query, narrowed by the full `EntitySemanticSearchFilter`
   * set (type(s), contextId, task-role fields, and the single/multi
   * `touchesEntity` / `touchesAnyOf` OR-wildcards).
   *
   * Why it exists: hosts building signal-time retrieval ("which entities is
   * this email about?") previously had to fall back to fact-level
   * `semanticSearch` + manual subject/object/contextIds aggregation. This
   * exposes the entity content vector directly, so the composed entity text
   * (display name, identifiers, narrative, contextIds, host-specific fields)
   * is what gets matched — strictly better recall than re-deriving entities
   * from fact hits.
   *
   * Accepts a precomputed vector (from `embedQuery`) to skip the per-call
   * embed round-trip when fanning out several searches over one query.
   *
   * Error contract mirrors `findSimilarOpenTasks`: returns `[]` when the store
   * lacks a semantic-entity capability, when a string query is passed but no
   * embedder is configured, or when the underlying search throws. Semantic
   * similarity is opportunistic, never load-bearing.
   *
   * `embeddingField` defaults to `'content'` (the composer-backed vector). Pass
   * `'identity'` to search the name/identifier vector used by entity
   * resolution. Adapters MUST NOT silently fall back to the other field —
   * entities lacking the selected vector are simply absent from results.
   */
  async semanticSearchEntities(
    queryOrVector: string | number[],
    filter: EntitySemanticSearchFilter,
    scope: ScopeFilter,
    opts?: { topK?: number; minScore?: number; embeddingField?: EntityEmbeddingField },
  ): Promise<Array<{ entity: IEntity; score: number }>> {
    assertNotDestroyed(this, 'semanticSearchEntities');
    if (typeof this.store.semanticSearchEntities !== 'function') return [];

    // Clamp per project convention (topK ≤ 100, minScore ∈ [0,1]).
    const requestedTopK = Number.isFinite(opts?.topK) ? (opts!.topK as number) : 10;
    const topK = Math.min(Math.max(Math.trunc(requestedTopK), 1), 100);
    const requestedMin = Number.isFinite(opts?.minScore) ? (opts!.minScore as number) : 0;
    const minScore = Math.min(Math.max(requestedMin, 0), 1);
    const embeddingField: EntityEmbeddingField = opts?.embeddingField ?? 'content';

    // Accept a pre-computed vector to skip the embed round-trip on fan-out.
    let queryVector: number[];
    if (typeof queryOrVector === 'string') {
      if (!this.embedder) return [];
      try {
        queryVector = await this.embedder.embed(queryOrVector);
      } catch (err) {
        logger.warn(
          {
            component: 'MemorySystem.semanticSearchEntities',
            error: err instanceof Error ? err.message : String(err),
          },
          'embed failed; returning empty result',
        );
        return [];
      }
    } else {
      queryVector = queryOrVector;
    }

    try {
      return await this.store.semanticSearchEntities(
        queryVector,
        filter,
        { topK, minScore, embeddingField },
        scope,
      );
    } catch (err) {
      logger.warn(
        {
          component: 'MemorySystem.semanticSearchEntities',
          error: err instanceof Error ? err.message : String(err),
        },
        'semanticSearchEntities failed; returning empty result',
      );
      return [];
    }
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
        { limit: limit - acc.size, orderBy: [...OPEN_TASK_ORDER_BY] },
        scope,
      );
      for (const t of page.items) {
        if (!acc.has(t.id)) acc.set(t.id, { task: t, role: ROLE_BY_FIELD[role]! });
      }
    }

    // Tier 1.5: tasks whose top-level `contextIds` includes the subject.
    // First-class O(index-seek) path — backed by the `{groupId, type,
    // contextIds}` and `{ownerId, type, contextIds}` indexes installed by
    // `ensureIndexes`. Runs before the fact-walk tier below because direct
    // entity-edge bindings are stronger signals than fact-mediated ones.
    if (acc.size < limit) {
      const page = await this.store.listEntities(
        {
          type: 'task',
          contextId: entityId,
          metadataFilter: { state: { $in: activeStates } },
        },
        { limit: limit - acc.size, orderBy: [...OPEN_TASK_ORDER_BY] },
        scope,
      );
      for (const t of page.items) {
        if (!acc.has(t.id)) acc.set(t.id, { task: t, role: 'context_of' });
      }
    }

    // Tier 2: tasks where `entityId` appears in contextIds of any fact whose
    // subject is a task entity. Retained as the legacy / fallback path —
    // pre-Phase-4 data lacks entity-level contextIds, so the fact-walk is
    // still the only signal for older rows. Most-recent facts win when the
    // cap is reached, so freshly-relevant tasks aren't dropped behind
    // ancient ones.
    if (acc.size < limit) {
      const contextFacts = await this.store.findFacts(
        { contextId: entityId, kind: 'atomic', asOf: opts.asOf },
        {
          limit: RELATED_FACT_FETCH_LIMIT,
          orderBy: { field: 'observedAt', direction: 'desc' },
        },
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

    // Final relevance sort across BOTH sources (per-role + context_of) before
    // the slice. Without this, the merge order biases by source (all assignee
    // first, then reporter, etc., then context_of last) regardless of dueAt.
    return [...acc.values()]
      .sort((a, b) => compareTaskByDueThenRecency(a.task, b.task))
      .slice(0, limit);
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
    // listing events and filtering client-side here). Bounded by
    // `RELATED_FACT_FETCH_LIMIT`; sort puts the most-recent events first so
    // the window+attendance filter survives the truncation — without this,
    // ancient events dominate insertion order and recent meetings get
    // silently dropped past the cap.
    const eventsPage = await this.store.listEntities(
      { type: 'event' },
      {
        limit: RELATED_FACT_FETCH_LIMIT,
        orderBy: [
          { field: 'metadata.startTime', direction: 'desc' },
          { field: 'id', direction: 'asc' },
        ],
      },
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

    // Tier 1.5: events whose top-level `contextIds` includes the subject.
    // First-class O(index-seek) path — same shape as the parallel tier in
    // `resolveRelatedTasks`. Most-recent events first so the window filter
    // survives the truncation. Backed by the entity contextIds indexes.
    if (acc.size < limit) {
      const page = await this.store.listEntities(
        { type: 'event', contextId: entityId },
        {
          limit: limit - acc.size,
          orderBy: [
            { field: 'metadata.startTime', direction: 'desc' },
            { field: 'id', direction: 'asc' },
          ],
        },
        scope,
      );
      for (const ev of page.items) {
        if (acc.has(ev.id)) continue;
        const md = (ev.metadata ?? {}) as Record<string, unknown>;
        const startTime = toDateMaybe(md.startTime);
        if (startTime && startTime < windowStart) continue;
        acc.set(ev.id, { event: ev, role: 'context_of', when: startTime });
      }
    }

    // Tier 2: legacy / fallback — events surfacing via fact-level contextIds.
    // Retained for pre-Phase-4 data without entity-level contextIds. Events
    // appear in contextIds of facts whose subject or object is an event entity.
    if (acc.size < limit) {
      const contextFacts = await this.store.findFacts(
        { contextId: entityId, kind: 'atomic', asOf: opts.asOf },
        {
          limit: RELATED_FACT_FETCH_LIMIT,
          orderBy: { field: 'observedAt', direction: 'desc' },
        },
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
          {
            limit: RELATED_PREDICATE_FACT_LIMIT,
            orderBy: { field: 'observedAt', direction: 'desc' },
          },
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

    // Final relevance sort across all three tiers before the slice. Without
    // this, the merge order biases by source (attendees first, then context,
    // then attended/hosted facts) regardless of recency. Most-recent events
    // win the cap so the LLM sees what's actually relevant now.
    return [...acc.values()]
      .sort((a, b) => compareEventByWhenDesc(a, b))
      .slice(0, limit);
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
    // Write-authz: reads pass scope-visibility (group/world readable records
    // surface here), but mutating metadata requires write access. Without
    // this any caller who can READ an entity could overwrite its metadata
    // through this API — a real cross-tenant data integrity hole.
    assertCanAccess(current, scope, 'write', 'entity');
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
    // Metadata change → composed content text may have changed (task.state,
    // event.location, etc.). Refresh content embedding so semantic search
    // reflects the new state.
    await this.queueContentEmbeddingIfChanged(next, scope);
    this.emit({ type: 'entity.upsert', entity: next, created: false });
    return next;
  }

  /**
   * Union-merge new entity ids into `entity.contextIds`. The canonical way to
   * mutate the top-level multi-entity binding after creation.
   *
   * Semantics:
   *  - Visibility-validate every addition (each must be visible to the caller;
   *    invisible ids throw — mirrors `addFact`'s context-visibility rule).
   *  - Filter self-references silently (id === entityId).
   *  - Dedupe against existing `contextIds`.
   *  - No-op fast path when every addition is already present.
   *
   * **Return shape:** `{ entity, added }` — `added` is the count of new
   * contextIds actually persisted (post dedupe + self-reference filter).
   * `added === 0` means the call was a no-op (everything was already there or
   * filtered out); the returned entity is unchanged from storage. Migration /
   * audit callers branch on `added > 0` to count real mutations.
   *
   * Concurrency: read-modify-write with optimistic-version retry. Two callers
   * unioning different additions onto the same entity converge because the
   * losing-retry observes the winner's write and computes a fresh union.
   * `maxAttempts` caps at 3 — the last attempt's
   * `OptimisticConcurrencyError` bubbles on exhaustion (caller's choice to
   * surface or further-retry at a higher level).
   */
  async addEntityContextIds(
    entityId: EntityId,
    additions: EntityId[],
    scope: ScopeFilter,
    opts?: { maxAttempts?: number },
  ): Promise<{ entity: IEntity; added: number }> {
    assertNotDestroyed(this, 'addEntityContextIds');
    if (additions.length === 0) {
      const current = await this.store.getEntity(entityId, scope);
      if (!current) {
        throw new Error(
          `addEntityContextIds: entity ${entityId} not found or not visible`,
        );
      }
      return { entity: current, added: 0 };
    }
    // De-dupe + drop self-references before the visibility round-trips.
    const candidateSet = new Set<EntityId>();
    for (const id of additions) {
      if (!id || id === entityId) continue;
      candidateSet.add(id);
    }
    if (candidateSet.size === 0) {
      const current = await this.store.getEntity(entityId, scope);
      if (!current) {
        throw new Error(
          `addEntityContextIds: entity ${entityId} not found or not visible`,
        );
      }
      return { entity: current, added: 0 };
    }
    // Visibility check — refuse to write a contextId for an entity the caller
    // can't see. Once before the retry loop because invisibility is stable.
    const candidates = [...candidateSet];
    for (const cid of candidates) {
      const ent = await this.store.getEntity(cid, scope);
      if (!ent) {
        throw new Error(
          `addEntityContextIds: context entity ${cid} not visible or not found`,
        );
      }
    }
    const maxAttempts = Math.max(1, Math.min(opts?.maxAttempts ?? 3, 10));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const current = await this.store.getEntity(entityId, scope);
      if (!current) {
        throw new Error(
          `addEntityContextIds: entity ${entityId} not found or not visible`,
        );
      }
      assertCanAccess(current, scope, 'write', 'entity');
      const existing = new Set(current.contextIds ?? []);
      const toAdd = candidates.filter((id) => !existing.has(id));
      if (toAdd.length === 0) {
        return { entity: current, added: 0 };
      }
      const next: IEntity = {
        ...current,
        contextIds: [...(current.contextIds ?? []), ...toAdd],
        version: current.version + 1,
        updatedAt: new Date(),
      };
      try {
        await this.store.updateEntity(next);
        // contextIds changed → composer (task/event/topic) renders new
        // anchor displayNames in its output → re-embed.
        await this.queueContentEmbeddingIfChanged(next, scope);
        this.emit({ type: 'entity.upsert', entity: next, created: false });
        return { entity: next, added: toAdd.length };
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        const isContention = /ConcurrencyError/i.test(name);
        if (!isContention || attempt === maxAttempts) throw err;
        // Log every retry except the last (which would either succeed or
        // bubble up). Operators want to see contention without log spam.
        logger.info(
          {
            component: 'MemorySystem.addEntityContextIds',
            entityId,
            attempt,
            maxAttempts,
            error: err instanceof Error ? err.message : String(err),
          },
          'retrying after version-mismatch',
        );
      }
    }
    // Unreachable — `maxAttempts >= 1` guarantees the final iteration's
    // catch re-throws. TypeScript can't see that, hence this fallback throw.
    throw new Error(
      `addEntityContextIds: exhausted ${maxAttempts} attempts for ${entityId}`,
    );
  }

  /**
   * Transition a task entity to a new state — the canonical way to mutate
   * `task.metadata.state` after creation.
   *
   * Side effects (read-modify-write at the MemorySystem layer; adapters with
   * native transactions may promote to atomic):
   *   - Sets `metadata.state = newState`.
   *   - Appends `metadata.stateHistory: TaskStateHistoryEntry[]`, keeping only
   *     the most-recent `stateHistoryCap` entries (default 200). Older entries
   *     drop in FIFO order. `stateHistory` is the only audit trail — no
   *     separate audit fact is written.
   *   - When `newState` is in `taskStates.terminal` AND `metadata.completedAt`
   *     is unset, sets `metadata.completedAt = at`.
   *
   * **Validate modes:**
   *  - `'warn'` (default): any transition allowed; out-of-matrix transitions
   *    log to `console.warn` and still proceed.
   *  - `'strict'`: out-of-matrix transitions throw `InvalidTaskTransitionError`
   *    and the metadata write is skipped.
   *  - `'none'`: silent.
   *
   * Subject must be a `type: 'task'` entity. For non-task subjects, update
   * metadata directly via `updateEntityMetadata`.
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
      return { task };
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
    // unbounded. Older entries past the cap are lost — callers that need
    // unbounded audit history should maintain it externally.
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
    // State transition changes the composer output (state, completedAt
    // appear in the embedded text), so refresh the content embedding —
    // critical for "open tasks I should do next"-style semantic queries to
    // stop matching terminal tasks.
    await this.queueContentEmbeddingIfChanged(nextTask, scope);
    this.emit({ type: 'entity.upsert', entity: nextTask, created: false });

    return { task: nextTask };
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
    opts: {
      assigneeId?: EntityId;
      projectId?: EntityId;
      /**
       * Narrow to tasks whose top-level `contextIds` array includes this
       * anchor (project, deal, meeting, etc.). First-class filter — does NOT
       * go through `metadataFilter` (which would query the wrong path).
       */
      contextId?: EntityId;
      limit?: number;
    } = {},
  ): Promise<IEntity[]> {
    assertNotDestroyed(this, 'listOpenTasks');
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const metadataFilter: Record<string, unknown> = {
      state: { $in: this._taskStates.active },
    };
    if (opts.assigneeId) metadataFilter.assigneeId = opts.assigneeId;
    if (opts.projectId) metadataFilter.projectId = opts.projectId;
    const page = await this.store.listEntities(
      {
        type: 'task',
        metadataFilter,
        ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
      },
      { limit, orderBy: [...OPEN_TASK_ORDER_BY] },
      scope,
    );
    warnIfTruncated('listOpenTasks', page.items.length, limit, page.nextCursor, 'iterateOpenTasks');
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
    const overFetchLimit = Math.min(
      limit * RECENT_TOPICS_OVERFETCH_MULTIPLIER,
      RECENT_TOPICS_OVERFETCH_CEILING,
    );
    const page = await this.store.listEntities(
      { type: 'topic' },
      {
        limit: overFetchLimit,
        orderBy: { field: 'updatedAt', direction: 'desc' },
      },
      scope,
    );
    const result = page.items
      .filter((e) => e.updatedAt.getTime() >= cutoff.getTime())
      .slice(0, limit);
    // Warn against the USER-FACING result count, not the over-fetch ceiling.
    // Firing on `overFetchLimit` would mis-attribute the cap and produce
    // confusing log lines ("returned 200 items (== limit)") when the caller
    // only sees their `limit` (default 50) items back.
    warnIfTruncated('listRecentTopics', result.length, limit, page.nextCursor, 'iterateRecentTopics');
    return result;
  }

  // ==========================================================================
  // Async iterators — exhaustive iteration with cursor pagination
  //
  // Each iterator wraps the store-level cursor. Callers consume ALL matching
  // rows via `for await`. No silent cap; the only bound is the row count
  // actually in the store. Pass `startAfter` to resume from a checkpoint
  // (e.g., a long-running job that crashed and wants to pick up where it
  // left off). Pass `batchSize` to tune memory pressure vs round-trip count.
  // ==========================================================================

  /**
   * Async iterator over all open tasks visible to `scope`, yielded in batches.
   *
   * Sort: `metadata.dueAt` asc nulls-last, then `updatedAt` desc, then `id`
   * asc tiebreak. Same as `listOpenTasks`, but iterates the full result set
   * rather than truncating at 200.
   *
   * Use this when you need EVERY open task (status refresh, audit sweeps,
   * backfills). Use `listOpenTasks` when you need a small bounded slice
   * (prompt injection).
   *
   * @example
   * for await (const batch of memory.iterateOpenTasks(scope, { batchSize: 200 })) {
   *   for (const task of batch) {
   *     await processTask(task);
   *   }
   * }
   */
  async *iterateOpenTasks(
    scope: ScopeFilter,
    opts: {
      assigneeId?: EntityId;
      projectId?: EntityId;
      /** Narrow to tasks whose top-level `contextIds` includes this anchor. */
      contextId?: EntityId;
      batchSize?: number;
      /** Resume from a cursor returned by a prior interrupted iteration. */
      startAfter?: string;
    } = {},
  ): AsyncIterable<IEntity[]> {
    assertNotDestroyed(this, 'iterateOpenTasks');
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 1000));
    const metadataFilter: Record<string, unknown> = {
      state: { $in: this._taskStates.active },
    };
    if (opts.assigneeId) metadataFilter.assigneeId = opts.assigneeId;
    if (opts.projectId) metadataFilter.projectId = opts.projectId;
    let cursor = opts.startAfter;
    while (true) {
      const page = await this.store.listEntities(
        {
          type: 'task',
          metadataFilter,
          ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
        },
        { limit: batchSize, cursor, orderBy: [...OPEN_TASK_ORDER_BY] },
        scope,
      );
      if (page.items.length > 0) yield page.items;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }

  /**
   * Async iterator over recent topic entities visible to `scope`, yielded in
   * batches. Sort: `updatedAt` desc. The `days` window is applied client-side
   * (consistent with `listRecentTopics`); iteration stops when either the
   * store is exhausted OR the first batch with all entries older than the
   * cutoff is encountered (since sort is desc, no younger ones exist past
   * that point).
   */
  async *iterateRecentTopics(
    scope: ScopeFilter,
    opts: { days?: number; batchSize?: number; startAfter?: string } = {},
  ): AsyncIterable<IEntity[]> {
    assertNotDestroyed(this, 'iterateRecentTopics');
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 1000));
    const days = Math.max(1, opts.days ?? 30);
    const cutoff = new Date(Date.now() - days * MILLIS_PER_DAY);
    let cursor = opts.startAfter;
    while (true) {
      const page = await this.store.listEntities(
        { type: 'topic' },
        {
          limit: batchSize,
          cursor,
          orderBy: { field: 'updatedAt', direction: 'desc' },
        },
        scope,
      );
      if (page.items.length === 0) {
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        continue;
      }
      const filtered = page.items.filter((e) => e.updatedAt.getTime() >= cutoff.getTime());
      if (filtered.length > 0) yield filtered;
      // Early termination: if any item fell outside the window, all subsequent
      // pages (sorted older-first by desc cursor advance) will also be outside.
      if (filtered.length < page.items.length) break;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }

  /**
   * Generic async iterator over entities matching `filter`. The caller MUST
   * pass `orderBy` to guarantee deterministic iteration — without it, the
   * adapter's natural order kicks in and the iteration result is non-portable
   * across stores. This method does not warn (the adapter does) but does
   * require the caller to be explicit.
   */
  async *iterateEntitiesByFilter(
    filter: EntityListFilter,
    scope: ScopeFilter,
    opts: {
      batchSize?: number;
      startAfter?: string;
      orderBy: EntityOrderBy | EntityOrderBy[];
    },
  ): AsyncIterable<IEntity[]> {
    assertNotDestroyed(this, 'iterateEntitiesByFilter');
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 1000));
    let cursor = opts.startAfter;
    while (true) {
      const page = await this.store.listEntities(
        filter,
        { limit: batchSize, cursor, orderBy: opts.orderBy },
        scope,
      );
      if (page.items.length > 0) yield page.items;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }

  /**
   * Generic async iterator over facts matching `query`. Like
   * `iterateEntitiesByFilter`, the caller MUST pass `orderBy` (FactOrderBy
   * accepts `observedAt | createdAt | confidence`) to ensure deterministic
   * iteration across stores.
   */
  async *iterateFacts(
    query: FactFilter,
    scope: ScopeFilter,
    opts: {
      batchSize?: number;
      startAfter?: string;
      orderBy: FactOrderBy;
    },
  ): AsyncIterable<IFact[]> {
    assertNotDestroyed(this, 'iterateFacts');
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 1000));
    let cursor = opts.startAfter;
    while (true) {
      const page = await this.store.findFacts(
        query,
        { limit: batchSize, cursor, orderBy: opts.orderBy },
        scope,
      );
      if (page.items.length > 0) yield page.items;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
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

  /**
   * Embed a query string once so the resulting vector can be reused across
   * multiple `semanticSearch` / `findSimilarOpenTasks` calls with different
   * filters. Avoids re-embedding the same query in fan-out workloads
   * (multi-predicate searches, RAG with per-tenant filters, etc.).
   *
   * Throws `SemanticSearchUnavailableError` when no embedder is configured —
   * mirroring `semanticSearch`'s error contract so callers can rely on
   * `embedQuery` succeeding wherever `semanticSearch(string, ...)` would.
   */
  async embedQuery(query: string): Promise<number[]> {
    assertNotDestroyed(this, 'embedQuery');
    if (!this.embedder) {
      throw new SemanticSearchUnavailableError('no embedder configured');
    }
    return this.embedder.embed(query);
  }

  /**
   * Semantic kNN over facts. Accepts either:
   *   - `string` — embeds internally (one round-trip per call), OR
   *   - `number[]` — a pre-computed vector from `embedQuery`, reused across
   *     fan-out calls so the embed cost is paid once.
   *
   * The `number[]` form throws only on the store-capability check; no
   * embedder is required (the vector is already available).
   */
  async semanticSearch(
    queryOrVector: string | number[],
    filter: FactFilter,
    scope: ScopeFilter,
    topK: number = DEFAULT_SEMANTIC_TOP_K,
  ): Promise<Array<{ fact: IFact; score: number }>> {
    assertNotDestroyed(this, 'semanticSearch');
    if (!this.store.semanticSearch) {
      throw new SemanticSearchUnavailableError('store does not support semantic search');
    }
    let vector: number[];
    if (typeof queryOrVector === 'string') {
      if (!this.embedder) {
        throw new SemanticSearchUnavailableError('no embedder configured');
      }
      vector = await this.embedder.embed(queryOrVector);
    } else {
      vector = queryOrVector;
    }
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

    // Single-flight: if another caller is already regenerating this entity's
    // profile at the same scope, share the in-flight promise. Without this,
    // two concurrent calls (e.g. an explicit `regenerateProfile` racing with
    // a threshold-driven one on the same hot entity) each fire a full LLM
    // call — wasted spend and doubled wall-clock for a single cacheable output.
    const inflightKey = regenKey(entityId, targetScope);
    const existing = this.regenInFlight.get(inflightKey);
    if (existing) return existing;

    const work = this.runRegenerateProfile(entityId, targetScope);
    this.regenInFlight.set(inflightKey, work);
    try {
      return await work;
    } finally {
      this.regenInFlight.delete(inflightKey);
    }
  }

  private async runRegenerateProfile(
    entityId: EntityId,
    targetScope: ScopeFields,
  ): Promise<IFact> {
    // Caller (regenerateProfile) has already asserted not destroyed and
    // confirmed profileGenerator is set.
    const profileGenerator = this.profileGenerator!;

    const readScope: ScopeFilter = {
      groupId: targetScope.groupId,
      userId: targetScope.ownerId,
    };

    const entity = await this.store.getEntity(entityId, readScope);
    if (!entity) throw new Error(`regenerateProfile: entity ${entityId} not found`);

    // Collect EVERY live profile at this exact target scope (not merely
    // visible — same groupId/ownerId), draining all pages. We need the full
    // set — not just the latest — to enforce the single-live-profile invariant
    // below.
    //
    // Why drain instead of `limit: 10`: a `profile` fact is the only thing this
    // method writes, and an in-memory single-flight (`regenInFlight`) collapses
    // duplicate regen WITHIN a process. But across processes/pods two regens
    // can read the same prior `P`, both write a new profile `supersedes: P`,
    // and `addFact` only archives `P` once — the OTHER new profile becomes an
    // orphan that the single-supersede logic never revisits (it's no longer
    // "the latest"), so it stays live forever. These orphans accumulate without
    // bound (one hot shared entity reached 390 live profiles for a single owner
    // in prod, all dragging a 1536-d embedding). See the collapse step after
    // the write below.
    const liveProfilesAtScope: IFact[] = [];
    let profileCursor: string | undefined;
    do {
      const page = await this.store.findFacts(
        { subjectId: entityId, predicate: 'profile', kind: 'document', archived: false },
        // `_id` is a total order with no ties — safe for offset pagination over
        // this read-only pass (we archive only AFTER collecting). See
        // FactOrderBy doc-comment.
        { limit: 200, orderBy: { field: '_id', direction: 'asc' }, cursor: profileCursor },
        readScope,
      );
      for (const f of page.items) {
        if (sameScope(f, targetScope)) liveProfilesAtScope.push(f);
      }
      profileCursor = page.nextCursor;
    } while (profileCursor);

    // The latest live profile at scope: incremental-input anchor + supersede
    // target (unchanged semantics from the previous `limit: 10` lookup, which
    // already saw the true latest within its first page).
    const priorProfile = liveProfilesAtScope.reduce<IFact | undefined>(
      (latest, f) => (!latest || f.createdAt > latest.createdAt ? f : latest),
      undefined,
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

    const { details, summaryForEmbedding } = await profileGenerator.generate({
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

    // Enforce the invariant "at most one live profile per (subjectId, ownerId,
    // groupId)": archive every OTHER live profile at this scope. `priorProfile`
    // was already archived by the `supersedes` above; the rest are orphaned
    // forks from prior cross-process races. This is self-healing — even if a
    // concurrent regen forks a new profile through, the next regen collapses
    // the set back to one. `newProfile` cannot be in `liveProfilesAtScope`
    // (that snapshot was taken before this write), so it is never archived; a
    // concurrently-written NEWER profile is likewise absent from the snapshot,
    // so the globally-newest profile always survives. Best-effort per fact — a
    // single failed archive must not abort the regen, whose survivor is already
    // correct.
    let collapsedForks = 0;
    for (const stale of liveProfilesAtScope) {
      if (stale.id === priorProfile?.id) continue; // already archived via supersedes
      try {
        await this.store.updateFact(stale.id, { archived: true }, readScope);
        this.emit({ type: 'fact.archive', factId: stale.id });
        collapsedForks += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[MemorySystem.regenerateProfile] orphan profile fork collapse failed',
          {
            factId: stale.id,
            entityId,
            scope: regenKey(entityId, targetScope),
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
    if (collapsedForks > 0) {
      // Surfacing >0 is a signal a cross-process race had previously forked the
      // profile — worth noticing, not an error (the data is now correct).
      // eslint-disable-next-line no-console
      console.warn(
        `[MemorySystem.regenerateProfile] collapsed ${collapsedForks} orphaned profile fork(s) ` +
          `for entity=${entityId} scope=${regenKey(entityId, targetScope)}`,
      );
    }

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
    // Skip the threshold/count work entirely when a regen is already running
    // for this key — `regenerateProfile` itself single-flights the LLM call,
    // but doing the prior-profile/count queries here is also pointless work
    // when the answer is "someone else has it".
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

      // `regenerateProfile` handles in-flight registration; if a race got
      // here first the call below returns the shared in-flight promise.
      await this.regenerateProfile(entityId, scope, 'threshold');
    } catch (err) {
      // Background regen failures must not impact the write path — but they
      // must never be silent. Surface via console.warn (same pattern as
      // reportWarning / onChange listener failures elsewhere in this file).
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
  // Documents — entities with type='document' carrying long-form content in
  // metadata.body. Thin wrappers around upsertEntity/addFact that enforce the
  // conventions documented in `documents/types.ts` and queue the
  // content-embedding refresh on body changes.
  // ==========================================================================

  /**
   * Create a new document. When `slug` is provided, the document carries
   * `{kind:'canonical', value:'doc:<slug>'}` so subsequent lookups via
   * `getDocument(slug)` resolve deterministically. When `attachTo` is set, an
   * idempotent `has_document` fact is written linking the parent to the new
   * document.
   *
   * Returns the created entity. Content-embedding refresh is queued
   * asynchronously — read `pendingEmbeddings()` / `flushEmbeddings()` to
   * observe.
   */
  async createDocument(input: CreateDocumentInput, scope: ScopeFilter): Promise<Document> {
    assertNotDestroyed(this, 'createDocument');
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('createDocument: title must be a non-empty string');
    }
    if (typeof input.body !== 'string') {
      throw new Error('createDocument: body must be a string');
    }
    // Slug-collision pre-flight. `upsertEntity` resolves matches by identifier
    // BEFORE looking at type, so calling it with a slug that's been squatted
    // by a non-document entity (a task, event, …) would apply our
    // `metadataMerge:'overwrite'` to that entity — writing document-shape
    // fields (body/byteSize/role/…) into a non-document record and bumping
    // its version — before we got a chance to reject. Bail here so the
    // squatter is left untouched. No-op when no slug is supplied (anonymous
    // documents can't collide).
    if (input.slug) {
      const slugValue = `${DOCUMENT_SLUG_PREFIX}${input.slug}`;
      const existing = await this.store.findEntitiesByIdentifier(
        DOCUMENT_SLUG_KIND,
        slugValue,
        scope,
      );
      const squatter = existing.find((e) => e.type !== DOCUMENT_TYPE && !e.archived);
      if (squatter) {
        throw new Error(
          `createDocument: identifier 'doc:${input.slug}' already exists ` +
            `on a non-document entity (id='${squatter.id}', type='${squatter.type}'). ` +
            `Pick a different slug or repair the existing entity.`,
        );
      }
    }
    const identifiers: Identifier[] = input.slug ? [documentSlugIdentifier(input.slug)] : [];
    const metadata = buildDocumentMetadata(undefined, input);
    // `metadataMerge:'overwrite'` makes createDocument idempotent on slug
    // collision: a second call with the same slug refreshes body/role/format/
    // summary instead of silently dropping the new content. Without this,
    // `upsertEntity` resolves to the existing entity and ignores `metadata`.
    const res = await this.upsertEntity(
      {
        type: DOCUMENT_TYPE,
        displayName: input.title,
        aliases: input.aliases,
        identifiers,
        metadata,
        ownerId: input.ownerId,
        groupId: input.groupId,
        permissions: input.permissions,
        metadataMerge: 'overwrite',
      },
      scope,
    );
    // Belt-and-suspenders: the pre-flight above should already have rejected
    // the squat case, but if `upsertEntity`'s resolution semantics ever drift
    // we'd rather fail closed than mis-cast the result.
    if (res.entity.type !== DOCUMENT_TYPE) {
      throw new Error(
        `createDocument: identifier 'doc:${input.slug ?? ''}' resolved to a ` +
          `non-document entity (id='${res.entity.id}', type='${res.entity.type}'). ` +
          `Pick a different slug or repair the existing entity.`,
      );
    }
    let doc = res.entity as Document;
    // `upsertEntity` merges identifiers/aliases/metadata on resolve but never
    // touches `displayName`. For createDocument's "true upsert" contract, if
    // the caller passed a different title from what's stored, write that too.
    if (!res.created && doc.displayName !== input.title) {
      assertCanAccess(doc, scope, 'write', 'entity');
      const norm = computeNormalizedFields({
        displayName: input.title,
        aliases: doc.aliases,
      });
      const next: IEntity = {
        ...doc,
        displayName: input.title,
        normalizedDisplayName: norm.normalizedDisplayName,
        normalizedAliases: norm.normalizedAliases,
        version: doc.version + 1,
        updatedAt: new Date(),
      };
      await this.store.updateEntity(next);
      // Title is part of the identity-embedding source — without this the
      // EntityResolver's semantic tier would keep matching the prior title.
      this.queueIdentityEmbedding(next, scope, doc);
      this.emit({ type: 'entity.upsert', entity: next, created: false });
      doc = next as Document;
    }
    await this.queueContentEmbedding(doc, scope);
    if (input.attachTo) {
      await this.attachDocument(input.attachTo, doc.id, scope);
    }
    return doc;
  }

  /**
   * Update a document — body, role, format, summary, or extra metadata. All
   * fields optional; only provided keys are touched (shallow overwrite over
   * `metadata`). Queues a content-embedding refresh if `body` changed
   * (gated by `metadataDeepEqual` short-circuit in `applyMetadataMerge`).
   *
   * `idOrSlug` accepts either a raw entity id or a bare slug (the `doc:`
   * prefix is added automatically when the value isn't recognized as an id).
   */
  async updateDocument(
    idOrSlug: string,
    patch: UpdateDocumentInput,
    scope: ScopeFilter,
  ): Promise<Document> {
    assertNotDestroyed(this, 'updateDocument');
    const existing = await this.resolveDocument(idOrSlug, scope);
    if (!existing) {
      throw new Error(`updateDocument: document '${idOrSlug}' not found or not visible`);
    }
    assertCanAccess(existing, scope, 'write', 'entity');

    const incomingMetadata = buildDocumentMetadata(existing.metadata, {
      // Title is on displayName, not metadata. Only body/role/format/summary/extras here.
      title: existing.displayName,
      body: patch.body ?? (existing.metadata?.body as string | undefined) ?? '',
      role: patch.role ?? (existing.metadata?.role as string | undefined),
      format: patch.format ?? (existing.metadata?.format as string | undefined),
      summary: patch.summary ?? (existing.metadata?.summary as string | undefined),
      metadata: patch.metadata,
    });

    const nextAliases = patch.aliases
      ? appendUniqueAliases(existing.aliases ?? [], patch.aliases)
      : existing.aliases;

    const nextDisplayName = patch.title ?? existing.displayName;
    const norm = computeNormalizedFields({
      displayName: nextDisplayName,
      aliases: nextAliases,
    });
    const next: IEntity = {
      ...existing,
      displayName: nextDisplayName,
      aliases: nextAliases,
      metadata: incomingMetadata,
      normalizedDisplayName: norm.normalizedDisplayName,
      normalizedAliases: norm.normalizedAliases,
      version: existing.version + 1,
      updatedAt: new Date(),
    };

    const bodyChanged = patch.body !== undefined && patch.body !== (existing.metadata?.body as string | undefined);
    const titleChanged = patch.title !== undefined && patch.title !== existing.displayName;
    const summaryChanged =
      patch.summary !== undefined && patch.summary !== (existing.metadata?.summary as string | undefined);
    if (!bodyChanged && !titleChanged && !summaryChanged && metadataDeepEqual(existing.metadata, incomingMetadata) && nextAliases === existing.aliases) {
      return existing as Document;
    }
    await this.store.updateEntity(next);
    this.emit({ type: 'entity.upsert', entity: next, created: false });
    if (bodyChanged || titleChanged || summaryChanged) {
      await this.queueContentEmbedding(next as Document, scope);
    }
    return next as Document;
  }

  /**
   * Fetch a document by id or slug. Returns the entity verbatim (including
   * `metadata.body`). Returns `null` when not found / not visible.
   */
  async getDocument(idOrSlug: string, scope: ScopeFilter): Promise<Document | null> {
    assertNotDestroyed(this, 'getDocument');
    const doc = await this.resolveDocument(idOrSlug, scope);
    return doc;
  }

  /**
   * Attach a document to a parent entity via the canonical `has_document`
   * predicate. Idempotent — a no-op when an identical non-archived fact
   * already exists in the caller's scope.
   */
  async attachDocument(parentId: EntityId, docIdOrSlug: string, scope: ScopeFilter): Promise<void> {
    assertNotDestroyed(this, 'attachDocument');
    const doc = await this.resolveDocument(docIdOrSlug, scope);
    if (!doc) {
      throw new Error(`attachDocument: document '${docIdOrSlug}' not found or not visible`);
    }
    if (parentId === doc.id) {
      throw new Error('attachDocument: parentId and document id must differ');
    }
    // Dedup — `addFact({dedup:true})` bumps `observedAt` on an existing match
    // rather than inserting a duplicate. Matches our idempotency contract.
    await this.addFact(
      {
        subjectId: parentId,
        predicate: HAS_DOCUMENT_PREDICATE,
        kind: 'atomic',
        objectId: doc.id,
        dedup: true,
      },
      scope,
    );
  }

  /**
   * Remove a `has_document` attachment between a parent entity and a document.
   * Archives EVERY matching non-archived fact in scope (idempotent), so
   * duplicate attachments — should they exist due to race conditions — are
   * cleaned up in one call.
   *
   * Returns `{archived, skippedDueToPermissions}` so callers can distinguish
   * "no matching facts" (both zero) from "had matches but couldn't write any"
   * (archived=0, skipped>0).
   */
  async detachDocument(
    parentId: EntityId,
    docIdOrSlug: string,
    scope: ScopeFilter,
  ): Promise<DetachDocumentResult> {
    assertNotDestroyed(this, 'detachDocument');
    const doc = await this.resolveDocument(docIdOrSlug, scope);
    if (!doc) {
      throw new Error(`detachDocument: document '${docIdOrSlug}' not found or not visible`);
    }
    let archived = 0;
    let skippedDueToPermissions = 0;
    let cursor: string | undefined;
    do {
      const page = await this.store.findFacts(
        { subjectId: parentId, predicate: HAS_DOCUMENT_PREDICATE, objectId: doc.id },
        { limit: 100, cursor },
        scope,
      );
      for (const f of page.items) {
        if (f.archived) continue;
        if (!canAccess(f, scope, 'write')) {
          skippedDueToPermissions++;
          continue;
        }
        await this.store.updateFact(f.id, { archived: true }, scope);
        archived++;
      }
      cursor = page.nextCursor;
    } while (cursor);
    return { archived, skippedDueToPermissions };
  }

  /**
   * List documents — optionally narrowed by `attachedTo`, `role`, `ownerId`.
   * By default the response strips `metadata.body` (listing pages can be
   * large); pass `includeBody: true` to keep it.
   */
  async listDocuments(filter: ListDocumentsFilter, scope: ScopeFilter): Promise<Document[]> {
    assertNotDestroyed(this, 'listDocuments');
    const limit = clampPositive(filter.limit, 20, 200);

    // attachedTo: pull `has_document` facts first, then load each document.
    if (filter.attachedTo) {
      const docIds = await this.findAttachedDocIds(filter.attachedTo, scope);
      if (docIds.length === 0) return [];
      const entities = await this.store.getEntities(docIds, scope);
      const docs = entities.filter((e): e is IEntity => !!e && e.type === DOCUMENT_TYPE && !e.archived) as Document[];
      const filtered = applyDocFilters(docs, filter);
      const ranked = filtered.slice(0, limit);
      return ranked.map((d) => projectDocument(d, !!filter.includeBody));
    }

    const metadataFilter: Record<string, unknown> = {};
    if (filter.role !== undefined) {
      metadataFilter.role = Array.isArray(filter.role) ? { $in: filter.role } : filter.role;
    }
    const page = await this.listEntities(
      {
        type: DOCUMENT_TYPE,
        metadataFilter: Object.keys(metadataFilter).length > 0 ? metadataFilter : undefined,
      },
      { limit, cursor: filter.cursor, orderBy: filter.orderBy },
      scope,
    );
    // `ownerId` is not part of EntityListFilter (the adapter contract narrows
    // by type + metadata only); post-filter here. Cheap since the page is
    // already bounded by `limit`.
    const ownerFiltered =
      filter.ownerId === undefined
        ? page.items
        : page.items.filter((e) => e.ownerId === filter.ownerId);
    return ownerFiltered
      .filter((e) => e.type === DOCUMENT_TYPE)
      .map((e) => projectDocument(e as Document, !!filter.includeBody));
  }

  /**
   * Search documents — `semantic` mode uses `contentEmbedding` (requires an
   * embedder); `keyword` mode runs a case-insensitive substring match over
   * `metadata.body` and `displayName` against a page of candidates. Both
   * modes honor `attachedTo` / `role` filters and clamp `limit` to [1, 50].
   *
   * Score semantics: semantic returns 0..1 cosine similarity from the
   * underlying `semanticSearchEntities`; keyword returns a coarse 0..1 hit
   * score (1.0 for displayName match, 0.5 for body-only).
   */
  async searchDocuments(input: SearchDocumentsInput, scope: ScopeFilter): Promise<DocumentSearchHit[]> {
    assertNotDestroyed(this, 'searchDocuments');
    if (typeof input.query !== 'string' || input.query.trim().length === 0) {
      throw new Error('searchDocuments: query must be a non-empty string');
    }
    const limit = clampPositive(input.limit, 10, 50);
    const mode = input.mode ?? 'semantic';

    // When `attachedTo` is set we resolve the bounded set of attached docs
    // FIRST and search directly within it. Doing this as a post-filter would
    // starve results — top-K semantic candidates / first-page keyword scan
    // may contain none of the attached docs even when real matches exist.
    // Resolving up front turns this into a tiny bounded search.
    let restrictTo: Document[] | null = null;
    if (input.attachedTo) {
      const docIds = await this.findAttachedDocIds(input.attachedTo, scope);
      if (docIds.length === 0) return [];
      const entities = await this.store.getEntities(docIds, scope);
      restrictTo = entities.filter(
        (e): e is IEntity => !!e && e.type === DOCUMENT_TYPE && !e.archived,
      ) as Document[];
      if (input.role !== undefined) {
        const roles = Array.isArray(input.role) ? new Set(input.role) : new Set([input.role]);
        restrictTo = restrictTo.filter((d) => {
          const r = d.metadata?.role;
          return typeof r === 'string' && roles.has(r);
        });
      }
      if (restrictTo.length === 0) return [];
    }

    const scored: Array<{ doc: Document; score: number }> = mode === 'semantic'
      ? await this.searchDocumentsSemantic(input.query, input.role, limit, scope, restrictTo)
      : await this.searchDocumentsKeyword(input.query, input.role, limit, scope, restrictTo);

    return scored.slice(0, limit).map(({ doc, score }) => ({
      doc: projectDocument(doc, true),
      score,
      snippet: buildSnippet(doc, input.query, mode),
      matchedVia: mode,
    }));
  }

  // ----- Document internals ---------------------------------------------------

  private async searchDocumentsSemantic(
    query: string,
    role: string | string[] | undefined,
    limit: number,
    scope: ScopeFilter,
    restrictTo: Document[] | null,
  ): Promise<Array<{ doc: Document; score: number }>> {
    if (!this.embedder) return [];
    const vector = await this.embedder.embed(query);

    // attachedTo path: score the restricted set directly. No vector index
    // hop, no top-K starvation — every attached doc with a contentEmbedding
    // is a candidate.
    if (restrictTo !== null) {
      const scored: Array<{ doc: Document; score: number }> = [];
      for (const d of restrictTo) {
        const vec = d.contentEmbedding;
        if (!vec || vec.length !== vector.length) continue;
        scored.push({ doc: d, score: cosineSimilarity(vector, vec) });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    }

    if (typeof this.store.semanticSearchEntities !== 'function') return [];
    // `EntitySemanticSearchFilter` only narrows by type today, so `role` is
    // applied as a JS post-filter. When it's set, over-fetch the candidate
    // pool 5× so the post-filter doesn't starve the result list when the top
    // matches happen to be of a different role. The proper fix (pushing
    // metadata filters into the vector pipeline) is an adapter contract
    // change tracked separately.
    const overFetch = role === undefined ? 1 : 5;
    const candidates = await this.store.semanticSearchEntities(
      vector,
      { type: DOCUMENT_TYPE },
      { topK: Math.max(limit * 2 * overFetch, 10), embeddingField: 'content' },
      scope,
    );
    let scored = candidates
      .filter((c) => c.entity.type === DOCUMENT_TYPE)
      .map((c) => ({ doc: c.entity as Document, score: c.score }));
    if (role !== undefined) {
      const roles = Array.isArray(role) ? new Set(role) : new Set([role]);
      scored = scored.filter((s) => {
        const r = s.doc.metadata?.role;
        return typeof r === 'string' && roles.has(r);
      });
    }
    return scored;
  }

  private async searchDocumentsKeyword(
    query: string,
    role: string | string[] | undefined,
    limit: number,
    scope: ScopeFilter,
    restrictTo: Document[] | null,
  ): Promise<Array<{ doc: Document; score: number }>> {
    const needle = query.toLowerCase();
    const scored: Array<{ doc: Document; score: number }> = [];

    const scanOne = (e: IEntity): void => {
      if (e.type !== DOCUMENT_TYPE) return;
      const body = e.metadata?.body;
      const bodyHit = typeof body === 'string' && body.toLowerCase().includes(needle);
      const nameHit = e.displayName.toLowerCase().includes(needle);
      if (!bodyHit && !nameHit) return;
      scored.push({ doc: e as Document, score: nameHit ? 1.0 : 0.5 });
    };

    // attachedTo path: scan only the bounded restricted set.
    if (restrictTo !== null) {
      for (const d of restrictTo) scanOne(d);
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    }

    // No attachedTo: paginate through ALL visible documents (with a hard
    // safety cap and a structured log on hitting it). The previous version
    // silently scanned only the first 1000 — for scopes with more documents
    // matches in older docs were dropped without any signal to the caller.
    const metadataFilter: Record<string, unknown> = {};
    if (role !== undefined) {
      metadataFilter.role = Array.isArray(role) ? { $in: role } : role;
    }
    const pageSize = 1000;
    const HARD_CAP = 10_000;
    let scanned = 0;
    let cursor: string | undefined;
    let truncated = false;
    do {
      const page = await this.listEntities(
        {
          type: DOCUMENT_TYPE,
          metadataFilter: Object.keys(metadataFilter).length > 0 ? metadataFilter : undefined,
        },
        { limit: pageSize, cursor },
        scope,
      );
      for (const e of page.items) {
        scanOne(e);
        scanned++;
      }
      cursor = page.nextCursor;
      if (cursor && scanned >= HARD_CAP) {
        truncated = true;
        break;
      }
    } while (cursor);

    if (truncated) {
      // Loud truncation: callers (and operators) need to know the scope
      // outgrew the in-memory keyword path so they can plan an index
      // migration. Pattern matches the rest of MemorySystem — direct
      // console.warn rather than a logger field that doesn't exist.
      console.warn(
        '[MemorySystem.searchDocumentsKeyword] keyword document scan hit hard cap — ' +
          `results may be incomplete; scanned=${scanned}, hardCap=${HARD_CAP}, ` +
          `scope.userId=${scope.userId ?? 'unset'}, scope.groupId=${scope.groupId ?? 'unset'}. ` +
          'Consider a Mongo $text index.',
      );
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  private async findAttachedDocIds(parentId: EntityId, scope: ScopeFilter): Promise<EntityId[]> {
    const ids: EntityId[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.store.findFacts(
        { subjectId: parentId, predicate: HAS_DOCUMENT_PREDICATE },
        { limit: 200, cursor },
        scope,
      );
      for (const f of page.items) {
        if (f.archived) continue;
        if (f.objectId) ids.push(f.objectId);
      }
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  /**
   * Resolve a document by id OR by bare slug (no `doc:` prefix expected from
   * the caller; the prefix is added when the input doesn't match a known
   * entity id). Returns `null` when not found.
   */
  private async resolveDocument(idOrSlug: string, scope: ScopeFilter): Promise<Document | null> {
    if (typeof idOrSlug !== 'string' || idOrSlug.trim().length === 0) return null;
    // Try as id first — cheapest path when caller already has the id.
    const byId = await this.store.getEntity(idOrSlug, scope);
    if (byId && byId.type === DOCUMENT_TYPE && !byId.archived) return byId as Document;
    // Then try as canonical slug — accept both bare (`q3-plan`) and prefixed
    // (`doc:q3-plan`) forms.
    const slugValue = idOrSlug.startsWith(DOCUMENT_SLUG_PREFIX)
      ? idOrSlug
      : `${DOCUMENT_SLUG_PREFIX}${idOrSlug}`;
    const matches = await this.store.findEntitiesByIdentifier(DOCUMENT_SLUG_KIND, slugValue, scope);
    const doc = matches.find((m) => m.type === DOCUMENT_TYPE && !m.archived);
    return (doc as Document | undefined) ?? null;
  }

  /**
   * Queue the content-embedding refresh for a document. Delegates to the
   * `'document'`-keyed `EntityContentComposer` (default ships the legacy
   * `title\n\nsummary|body[:limit]` shape — see `composers/defaults.ts`).
   *
   * Kept as a thin wrapper around `queueContentEmbeddingIfChanged` so the
   * document-write call sites stay readable, and so the diff-on-stored-text
   * optimization works identically to every other entity type.
   */
  private async queueContentEmbedding(doc: Document, scope: ScopeFilter): Promise<void> {
    await this.queueContentEmbeddingIfChanged(doc, scope);
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

  /**
   * Backfill `contentEmbedding` / `contentEmbeddingText` for entities whose
   * stored embedding doesn't match what the current composer would produce.
   *
   * Run-once migration helper. Use cases:
   *  - Upgrading from a release where content embedding was document-only —
   *    backfill makes every `task` / `event` / `person` / etc. searchable
   *    semantically without waiting for each entity's next mutation.
   *  - After overriding a composer in `MemorySystemConfig.entityContentComposers`
   *    so the new composer's output applies to historical data immediately.
   *  - After running `mergeEntities` / `archiveEntity` campaigns where
   *    cascading content refresh would be desirable.
   *
   * **Idempotent.** Skips entities whose `contentEmbeddingText` already
   * matches the composer output (no embed cost). Safe to re-run.
   *
   * **Resumable.** No transactional guarantees. Interrupting mid-run leaves a
   * partially-converged population; re-running converges the remainder.
   *
   * **Scoping.** Bounded by `scope` (same visibility rules as every other
   * read). Multi-tenant hosts iterate over scopes and call once per scope.
   *
   * **Concurrency.** Each enqueue goes through the standard `EmbeddingQueue`
   * with bounded concurrency (`config.embeddingQueue.concurrency`). Caller
   * should `await memorySystem.flushEmbeddings()` after the helper returns to
   * wait for all in-flight embeds.
   *
   * @returns `{ scanned, queued, skipped }`. `queued` is the count of entities
   *   whose composer output differed and were enqueued for re-embedding.
   *   `skipped` includes entities with no registered composer + entities
   *   whose composed text already matches the stored text.
   */
  async backfillContentEmbeddings(
    scope: ScopeFilter,
    opts?: {
      /** Narrow to specific entity types. Empty/omitted = all types. */
      types?: string[];
      /** Page size for the streaming scan. Default 500, max 1000. */
      batchSize?: number;
      /** Progress callback invoked after each page. */
      onProgress?: (scanned: number, queued: number) => void;
    },
  ): Promise<{ scanned: number; queued: number; skipped: number }> {
    assertNotDestroyed(this, 'backfillContentEmbeddings');
    if (!this.embedder) {
      throw new Error(
        'backfillContentEmbeddings: no embedder configured — nothing to backfill',
      );
    }
    const batchSize = Math.max(1, Math.min(opts?.batchSize ?? 500, 1000));
    const typeFilter = opts?.types && opts.types.length > 0 ? new Set(opts.types) : null;
    let scanned = 0;
    let queued = 0;
    let skipped = 0;
    let cursor: string | undefined;
    do {
      const page = await this.store.listEntities(
        {},
        {
          limit: batchSize,
          cursor,
          orderBy: { field: '_id', direction: 'asc' },
        },
        scope,
      );
      for (const entity of page.items) {
        if (typeFilter && !typeFilter.has(entity.type)) continue;
        scanned++;
        const composer = this.contentComposers.get(entity.type);
        if (!composer) {
          skipped++;
          continue;
        }
        let text: string;
        try {
          const ctx = new CachedComposeContext(this.store, scope);
          text = await composer.compose(entity, ctx);
        } catch (err) {
          logger.warn(
            {
              component: 'MemorySystem.backfillContentEmbeddings',
              entityId: entity.id,
              entityType: entity.type,
              error: err instanceof Error ? err.message : String(err),
            },
            'composer threw; skipping entity',
          );
          skipped++;
          continue;
        }
        if (text.length === 0) {
          skipped++;
          continue;
        }
        if (entity.contentEmbeddingText === text && entity.contentEmbedding) {
          skipped++;
          continue;
        }
        this.queue.enqueueContent(entity.id, text, scope);
        queued++;
      }
      opts?.onProgress?.(scanned, queued);
      cursor = page.nextCursor;
    } while (cursor);
    return { scanned, queued, skipped };
  }

  /**
   * Backfill `embedding` / `summaryForEmbedding` for facts. Sister method to
   * `backfillContentEmbeddings` — same idempotency, same scoping rules. Run
   * once when upgrading to a release that removes the 80-char threshold gate,
   * so short atomic facts (e.g. `(Sarah, works_at, Acme)`) become searchable
   * semantically without waiting for each fact's next mutation.
   *
   * @returns `{ scanned, queued, skipped }`. `skipped` includes facts with
   *   `isSemantic === false`, facts where the composer returned `''`, and
   *   facts whose stored `summaryForEmbedding` already matches the composer
   *   output (with a non-empty `embedding` present).
   */
  async backfillFactEmbeddings(
    scope: ScopeFilter,
    opts?: {
      /** Narrow to specific fact predicates. Empty/omitted = all predicates. */
      predicates?: string[];
      /** Narrow to fact kind. Empty/omitted = both atomic + document. */
      kind?: IFact['kind'];
      /** Page size for the streaming scan. Default 500, max 1000. */
      batchSize?: number;
      /** Progress callback invoked after each page. */
      onProgress?: (scanned: number, queued: number) => void;
    },
  ): Promise<{ scanned: number; queued: number; skipped: number }> {
    assertNotDestroyed(this, 'backfillFactEmbeddings');
    if (!this.embedder) {
      throw new Error(
        'backfillFactEmbeddings: no embedder configured — nothing to backfill',
      );
    }
    const batchSize = Math.max(1, Math.min(opts?.batchSize ?? 500, 1000));
    let scanned = 0;
    let queued = 0;
    let skipped = 0;
    let cursor: string | undefined;
    const filter: FactFilter = {};
    if (opts?.predicates && opts.predicates.length > 0) filter.predicates = opts.predicates;
    if (opts?.kind) filter.kind = opts.kind;
    do {
      const page = await this.store.findFacts(
        filter,
        { limit: batchSize, cursor },
        scope,
      );
      for (const fact of page.items) {
        scanned++;
        if (fact.isSemantic === false) {
          skipped++;
          continue;
        }
        let text: string;
        try {
          const ctx = new CachedComposeContext(this.store, scope);
          text = await this.factComposer.compose(fact, ctx);
        } catch (err) {
          logger.warn(
            {
              component: 'MemorySystem.backfillFactEmbeddings',
              factId: fact.id,
              predicate: fact.predicate,
              error: err instanceof Error ? err.message : String(err),
            },
            'fact composer threw; skipping fact',
          );
          skipped++;
          continue;
        }
        if (text.length === 0) {
          skipped++;
          continue;
        }
        if (
          (fact.embeddingText ?? '') === text &&
          fact.embedding &&
          fact.embedding.length > 0
        ) {
          skipped++;
          continue;
        }
        this.queue.enqueueFact(fact.id, text, scope);
        queued++;
      }
      opts?.onProgress?.(scanned, queued);
      cursor = page.nextCursor;
    } while (cursor);
    return { scanned, queued, skipped };
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

/**
 * Default `isSemantic` value when the caller didn't supply one. Every fact is
 * eligible for embedding by default — the composer decides whether there's
 * meaningful content to embed (returns `''` to skip). Pre-composer behavior
 * gated atomic-fact embedding on a hard-coded 80-char details threshold,
 * which caused the bulk of structurally-meaningful triples (e.g. "Sarah
 * works_at Acme") to never participate in semantic search.
 *
 * Callers retain explicit opt-out via `isSemantic: false` on the input.
 */
function computeIsSemantic(_input: Partial<IFact>): boolean {
  return true;
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

/**
 * 0.9.1 person-rule: detect single-token person displayNames with no
 * identifier. These never auto-dedupe by name — the atomic find-or-create
 * primitive is bypassed and a new row is created instead.
 *
 * Multi-token person names ("Pavel Khasanov") and any non-person type fall
 * through unchanged. Persons WITH an identifier (email, slack_id, …) hit
 * Tier 1 upstream and never reach this check; even if they did, the rule
 * here requires `identifiers.length === 0` so they'd still dedupe normally.
 */
function shouldBypassNameDedup(
  type: string,
  identifiers: Identifier[],
  displayName: string,
): boolean {
  if (type !== 'person') return false;
  if (identifiers.length > 0) return false;
  const normalized = normalizeSurface(displayName);
  const tokens = normalized.split(' ').filter((t) => t.length > 0);
  return tokens.length < 2;
}

function deriveFactScope(
  input: Partial<IFact>,
  subject: IEntity,
  scope: ScopeFilter,
): ScopeFields {
  // groupId still narrows from subject — facts cannot escape their subject's
  // tenant. Multi-tenant subjects are not supported; a fact straddling groups
  // would break group-bound visibility.
  const groupId = input.groupId ?? (subject.groupId ?? scope.groupId);

  // ownerId tracks the WRITER, not the subject. Hosts may promote certain
  // entity types (typically Person, Organization) to group-shared visibility
  // via VisibilityPolicy so multiple users in a tenant converge on a single
  // record for the same real-world referent. Facts written about that shared
  // subject are each writer's own observations and must be owned by the
  // writer, not by whoever happened to create the subject first. Defaulting
  // to subject.ownerId silently re-attributed user A's signal extractions to
  // user B (the subject's creator) and made A's facts invisible in A's own
  // memory while polluting B's.
  //
  // Precedence: explicit input.ownerId (admin delegation) > caller's userId
  // (the writer) > subject.ownerId (last-resort fallback for system writes
  // that lack scope.userId — e.g. cross-user maintenance jobs running under
  // withSystemContext). Real callers always have scope.userId.
  const ownerId = input.ownerId ?? scope.userId ?? subject.ownerId ?? undefined;

  return { groupId, ownerId };
}

function assertScopeInvariant(subject: IEntity, factScope: ScopeFields): void {
  if (subject.groupId && factScope.groupId !== subject.groupId) {
    throw new ScopeInvariantError(
      `fact groupId=${factScope.groupId ?? 'none'} must equal subject groupId=${subject.groupId}`,
    );
  }
  // ownerId equality with subject is NOT enforced. Group-shared subjects
  // (Person, Organization, …) admit facts owned by any member of the
  // subject's group; the writer's read access to subject was already enforced
  // by `store.getEntity(subjectId, scope)` upstream of this call. Cross-group
  // writes are still blocked by the groupId check above.
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
      // Kind-aware equality: case-insensitive only for email/domain/phone/url_host.
      const already = identifiers.some((i) =>
        identifierValuesEqual(i.kind, i.value, ident.kind, ident.value),
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

// =============================================================================
// Documents helpers — used by MemorySystem.create/update/list/searchDocuments.
// =============================================================================

/**
 * Build the canonical document metadata shape from the incoming input. Merges
 * caller-supplied `metadata` (extras) with the standard fields (body, role,
 * format, summary, byteSize). Standard fields win on collision — the bag of
 * extras can't shadow `body` etc.
 *
 * `prior` is the existing metadata before the merge; passed on update so
 * un-touched keys survive.
 */
function buildDocumentMetadata(
  prior: Record<string, unknown> | undefined,
  input: {
    title?: string;
    body: string;
    role?: string;
    format?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
): Record<string, unknown> {
  // Coerce any ISO date strings in caller-supplied extras BEFORE we overlay
  // standard keys — keeps the storage-boundary contract symmetric with the
  // rest of MemorySystem.
  const extras = coerceMetadataDates(input.metadata) ?? {};
  const byteSize = byteLength(input.body ?? '', 'utf8');
  const standard: Record<string, unknown> = {
    body: input.body,
    byteSize,
  };
  if (input.role !== undefined) standard.role = input.role;
  if (input.format !== undefined) standard.format = input.format;
  if (input.summary !== undefined) standard.summary = input.summary;
  // Order: prior < extras < standard. Standard keys are authoritative.
  return { ...(prior ?? {}), ...extras, ...standard };
}

/**
 * Append `incoming` aliases to `existing` (case-insensitive de-dupe). Returns
 * the original array reference when no new aliases were added — lets callers
 * detect "nothing changed" via referential equality.
 */
function appendUniqueAliases(existing: string[], incoming: string[]): string[] {
  const lower = new Set(existing.map((a) => a.toLowerCase()));
  const additions: string[] = [];
  for (const a of incoming) {
    if (!a || a.trim().length === 0) continue;
    const k = a.toLowerCase();
    if (lower.has(k)) continue;
    lower.add(k);
    additions.push(a);
  }
  if (additions.length === 0) return existing;
  return [...existing, ...additions];
}

/**
 * Apply `role` filter to an in-memory document array (used by `listDocuments`
 * when `attachedTo` triggered an id-set fetch instead of `listEntities`).
 */
function applyDocFilters(docs: Document[], filter: ListDocumentsFilter): Document[] {
  let out = docs;
  if (filter.role !== undefined) {
    const roles = Array.isArray(filter.role) ? new Set(filter.role) : new Set([filter.role]);
    out = out.filter((d) => {
      const r = d.metadata?.role;
      return typeof r === 'string' && roles.has(r);
    });
  }
  if (filter.ownerId !== undefined) {
    out = out.filter((d) => d.ownerId === filter.ownerId);
  }
  return out;
}

/**
 * Strip `metadata.body` from the document if the caller didn't ask for it.
 * Returns a NEW object (no mutation of the input). The body is the only
 * potentially-large field documented out of `listDocuments`; other metadata
 * keys survive untouched.
 */
function projectDocument(doc: Document, includeBody: boolean): Document {
  if (includeBody) return doc;
  if (!doc.metadata) return doc;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { body, ...rest } = doc.metadata as { body?: unknown } & Record<string, unknown>;
  return { ...doc, metadata: rest };
}

/**
 * Clamp `n` into `[1, max]` with `defaultValue` fallback for undefined.
 */
function clampPositive(n: number | undefined, defaultValue: number, max: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), max);
}

const SNIPPET_RADIUS = 100;
const SNIPPET_FALLBACK_LENGTH = 200;

/**
 * Build a ~200-char preview of a document. Keyword mode centers the snippet
 * around the first case-insensitive match of `query` (radius 100 chars).
 * Semantic mode returns the first 200 chars of `summary` (if present) or
 * `body`.
 */
function buildSnippet(doc: Document, query: string, mode: 'semantic' | 'keyword'): string {
  const body = (doc.metadata?.body as string | undefined) ?? '';
  const summary = doc.metadata?.summary as string | undefined;
  if (mode === 'semantic') {
    const source = summary && summary.length > 0 ? summary : body;
    return source.slice(0, SNIPPET_FALLBACK_LENGTH);
  }
  // Keyword: find first hit in body, then displayName, then summary.
  const needle = query.toLowerCase();
  const sources: string[] = [body];
  if (summary) sources.push(summary);
  for (const src of sources) {
    const idx = src.toLowerCase().indexOf(needle);
    if (idx < 0) continue;
    const start = Math.max(0, idx - SNIPPET_RADIUS);
    const end = Math.min(src.length, idx + needle.length + SNIPPET_RADIUS);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < src.length ? '…' : '';
    return `${prefix}${src.slice(start, end)}${suffix}`;
  }
  // Last resort — head of body, even if it doesn't contain a match.
  return body.slice(0, SNIPPET_FALLBACK_LENGTH);
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

/**
 * Cosine similarity between two equal-length unit-ish vectors. Same math as
 * the adapter-local helpers, duplicated here so `searchDocumentsSemantic`
 * can score a caller-supplied bounded candidate set without going through
 * the adapter's vector index (used by the `attachedTo` path).
 *
 * Caller must guarantee equal lengths — returns 0 on length mismatch as a
 * defensive fallback rather than throwing.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
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

  /**
   * Enqueue a fact's content embedding — writes both `embedding` and
   * `embeddingText` (the verbatim text fed to the embedder) on success so
   * the next call-site diff can cheaply skip re-embeds when the composed
   * text hasn't changed.
   *
   * Note: writes to `embeddingText`, NOT `summaryForEmbedding`. The latter
   * is caller-owned (caller's optional override of the composer); the queue
   * must never overwrite it or callers would lose their explicit
   * embedding-text choice on the first re-embed.
   */
  enqueueFact(factId: FactId, text: string, scope: ScopeFilter): void {
    if (this.stopped || !this.embedder) return;
    this.queue.push({
      text,
      scope,
      attempts: 0,
      factId,
      entityId: null,
      onComplete: async (embedding) => {
        await this.store.updateFact(
          factId,
          { embedding, embeddingText: text },
          scope,
        );
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

  /**
   * Enqueue an entity's content embedding — read/modify/write on
   * `IEntity.contentEmbedding` AND `IEntity.contentEmbeddingText`. The text
   * is stored alongside the vector so the next mutation's diff can skip the
   * embed when the composed text hasn't changed (see
   * `queueContentEmbeddingIfChanged`).
   *
   * Used by every entity mutation site for semantic search via
   * `semanticSearchEntities({embeddingField:'content'})`. Skips the storage
   * write when the resulting vector is already equal — avoids version churn
   * on no-op embeds (the rare case of two slightly different texts producing
   * an identical vector).
   */
  enqueueContent(entityId: EntityId, text: string, scope: ScopeFilter): void {
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
        // Skip the write when both vector and text are already correct. The
        // vector check guards against re-embed cost; the text check guards
        // against races where the text was updated by another writer but
        // somehow produces the same vector (vanishingly rare in practice).
        if (
          cur.contentEmbedding &&
          embeddingsEqual(cur.contentEmbedding, embedding) &&
          cur.contentEmbeddingText === text
        ) {
          return;
        }
        const next: IEntity = {
          ...cur,
          contentEmbedding: embedding,
          contentEmbeddingText: text,
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

/**
 * Truncation warning. Fires (once per call) when a flat-array list method
 * returns a result whose count equals the requested limit AND the underlying
 * page has more rows available (`nextCursor` set). Signals to the caller that
 * data was silently dropped; recommends the iterator alternative.
 *
 * Suppress with `ONERINGAI_SUPPRESS_CAP_WARNINGS=1` for callers that genuinely
 * want a capped result (e.g., prompt-token-budget builders).
 */
const capWarningSuppression = makeEnvFlag('ONERINGAI_SUPPRESS_CAP_WARNINGS');
/** Test-only: reset the cached env-var read. */
export function _resetCapWarningSuppression(): void {
  capWarningSuppression.reset();
}
function warnIfTruncated(
  method: string,
  itemCount: number,
  requestedLimit: number,
  nextCursor: string | undefined,
  iteratorHint: string,
): void {
  if (capWarningSuppression.isSet()) return;
  if (itemCount < requestedLimit) return;
  if (!nextCursor) return;
  console.warn(
    `[oneringai] MemorySystem.${method} returned ${itemCount} items (== limit) and more ` +
      `exist. Use memory.${iteratorHint}(scope) to consume the full result set, or pass an ` +
      `explicit higher limit if you want a known truncation. Suppress with ` +
      `ONERINGAI_SUPPRESS_CAP_WARNINGS=1.`,
  );
}

/**
 * Cross-source relevance ordering for related-tasks output. Matches the
 * push-down sort on `listOpenTasks` / `resolveRelatedTasks` per-role query
 * so the final dedup'd slice keeps overdue/soonest-due tasks first regardless
 * of which source contributed them.
 *
 * Sort: dueAt asc nulls-last, then updatedAt desc, then id asc tiebreak.
 */
function compareTaskByDueThenRecency(a: IEntity, b: IEntity): number {
  const da = toDateMaybe((a.metadata as Record<string, unknown> | undefined)?.dueAt);
  const db = toDateMaybe((b.metadata as Record<string, unknown> | undefined)?.dueAt);
  if (da && db) {
    const diff = da.getTime() - db.getTime();
    if (diff !== 0) return diff;
  } else if (da && !db) {
    return -1; // a has dueAt, b doesn't — a wins (nulls-last)
  } else if (!da && db) {
    return 1;
  }
  const ua = a.updatedAt ? a.updatedAt.getTime() : 0;
  const ub = b.updatedAt ? b.updatedAt.getTime() : 0;
  if (ua !== ub) return ub - ua; // desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Relevance ordering for related-events output. Sort: when desc (most-recent
 * past + upcoming first), nulls-last, then id asc tiebreak. Mirrors the
 * push-down sort on `resolveRelatedEvents` first-tier query.
 */
function compareEventByWhenDesc(
  a: { event: IEntity; when?: Date },
  b: { event: IEntity; when?: Date },
): number {
  if (a.when && b.when) {
    const diff = b.when.getTime() - a.when.getTime();
    if (diff !== 0) return diff;
  } else if (a.when && !b.when) {
    return -1;
  } else if (!a.when && b.when) {
    return 1;
  }
  return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
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

