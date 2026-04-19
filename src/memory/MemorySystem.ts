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
import { genericTraverse } from './GenericTraversal.js';
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
  RelatedTask,
  ResolveEntityOptions,
  ResolveEntityQuery,
  ScopeFields,
  ScopeFilter,
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
const DEFAULT_PROFILE_THRESHOLD = 10;
const DEFAULT_EMBED_CONCURRENCY = 4;
const DEFAULT_EMBED_RETRIES = 3;
const SEMANTIC_MIN_DETAILS_LENGTH = 80;

/** Non-terminal task states — surfaced in `relatedTasks` by default. */
const TASK_ACTIVE_STATES = ['pending', 'in_progress', 'blocked', 'deferred'];

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
  private readonly queue: EmbeddingQueue;
  private readonly resolver: EntityResolver;
  private readonly resolutionConfig: EntityResolutionConfig;
  private readonly predicates?: PredicateRegistry;
  private readonly predicateMode: 'permissive' | 'strict';
  private readonly predicateAutoSupersede: boolean;

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
    if (this.predicateMode === 'strict' && !this.predicates) {
      throw new Error(
        "MemorySystem: predicateMode='strict' requires a `predicates` registry",
      );
    }
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
    this.queue = new EmbeddingQueue(this.store, this.embedder, config.embeddingQueue);
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
        appendAliasesAndIdentifiers: async (id, aliases, identifiers, scope) => {
          return this.appendAliasesAndIdentifiers(id, aliases, identifiers, scope);
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
    },
    scope: ScopeFilter,
  ): Promise<UpsertEntityResult> {
    assertNotDestroyed(this, 'upsertEntity');
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

    if (merged.dirty) {
      const next: IEntity = {
        ...merged.entity,
        version: best.version + 1,
        updatedAt: new Date(),
      };
      await this.store.updateEntity(next);
      this.queueIdentityEmbedding(next, scope);
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

  private async createEntity(
    input: Partial<IEntity> & {
      identifiers: Identifier[];
      displayName: string;
      type: string;
    },
    scope: ScopeFilter,
  ): Promise<UpsertEntityResult> {
    const now = new Date();
    // Build the NewEntity input (no id, version, createdAt, updatedAt).
    const newEntity: NewEntity = {
      type: input.type,
      displayName: input.displayName,
      aliases: input.aliases ? [...input.aliases] : undefined,
      identifiers: input.identifiers.map((i) => ({ ...i, addedAt: i.addedAt ?? now })),
      groupId: input.groupId ?? scope.groupId,
      ownerId: input.ownerId ?? scope.userId,
      metadata: input.metadata,
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
  ): Promise<IEntity> {
    const current = await this.store.getEntity(id, scope);
    if (!current) throw new Error(`appendAliasesAndIdentifiers: entity ${id} not found`);

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

    if (!dirty) return current;

    const next: IEntity = {
      ...current,
      aliases: aliases.length > 0 ? aliases : current.aliases,
      identifiers,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    await this.store.updateEntity(next);
    this.queueIdentityEmbedding(next, scope);
    this.emit({ type: 'entity.upsert', entity: next, created: false });
    return next;
  }

  /** Queue an identity-embedding refresh if the feature is enabled + embedder present. */
  private queueIdentityEmbedding(entity: IEntity, scope: ScopeFilter): void {
    if (!this.embedder) return;
    if (this.resolutionConfig.enableIdentityEmbedding === false) return;
    const text = buildIdentityString({
      type: entity.type,
      displayName: entity.displayName,
      aliases: entity.aliases ?? [],
      identifiers: entity.identifiers,
    });
    this.queue.enqueueIdentity(entity.id, text, scope);
  }

  getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null> {
    assertNotDestroyed(this, 'getEntity');
    return this.store.getEntity(id, scope);
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
    if (!winner) throw new Error(`mergeEntities: winner ${winnerId} not found`);
    if (!loser) throw new Error(`mergeEntities: loser ${loserId} not found`);

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
    // Subjects
    let cursor: string | undefined;
    do {
      const page = await this.store.findFacts(
        { subjectId: fromId },
        { limit: 200, cursor },
        scope,
      );
      for (const f of page.items) {
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
        await this.store.updateFact(f.id, { objectId: toId }, scope);
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  async archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void> {
    assertNotDestroyed(this, 'archiveEntity');
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
    for (const filter of [{ subjectId: entityId }, { objectId: entityId }]) {
      let cursor: string | undefined;
      do {
        const page = await this.store.findFacts(filter, { limit: 200, cursor }, scope);
        for (const f of page.items) {
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

  /** Lookup a predicate definition (by canonical name or alias). Null when no registry or unknown. */
  getPredicateDefinition(nameOrAlias: string): PredicateDefinition | null {
    return this.predicates?.get(nameOrAlias) ?? null;
  }

  async addFact(
    input: Partial<IFact> & {
      subjectId: EntityId;
      predicate: string;
      kind: IFact['kind'];
    },
    scope: ScopeFilter,
  ): Promise<IFact> {
    assertNotDestroyed(this, 'addFact');

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
    assertScopeInvariant(subject, factScope);

    // Auto-supersede for singleValued predicates (e.g. current_title, has_due_date).
    // Only fires when: registry knows the predicate, it's marked singleValued,
    // auto-supersede is enabled, and the caller did not set `supersedes` already.
    //
    // Scope caveat: findFacts is scope-bounded. A prior fact in an outer scope
    // invisible to the caller will not be superseded — this is intentional for
    // isolation, but can produce multiple per-scope 'current' values.
    let supersedes = input.supersedes;
    if (!supersedes && this.predicateAutoSupersede && def?.singleValued) {
      const prior = await this.store.findFacts(
        { subjectId: input.subjectId, predicate, archived: false },
        { limit: 1, orderBy: { field: 'createdAt', direction: 'desc' } },
        scope,
      );
      if (prior.items.length > 0) supersedes = prior.items[0]!.id;
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
      confidence: input.confidence,
      sourceSignalId: input.sourceSignalId,
      derivedBy: input.derivedBy,
      importance: input.importance ?? def?.defaultImportance,
      contextIds: input.contextIds,
      supersedes,
      archived: input.archived,
      isAggregate: input.isAggregate ?? def?.isAggregate,
      observedAt: input.observedAt ?? now,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      metadata: input.metadata,
      groupId: factScope.groupId,
      ownerId: factScope.ownerId,
    };

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
    await this.store.updateFact(id, { archived: true }, scope);
    this.emit({ type: 'fact.archive', factId: id });
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
  private async resolveRelatedTasks(
    entityId: EntityId,
    opts: ContextOptions,
    scope: ScopeFilter,
  ): Promise<RelatedTask[]> {
    const limit = opts.relatedTasksLimit ?? 15;
    const acc = new Map<EntityId, RelatedTask>();

    for (const role of RELATIONAL_TASK_FIELDS) {
      if (acc.size >= limit) break;
      const page = await this.store.listEntities(
        {
          type: 'task',
          metadataFilter: {
            [role]: entityId,
            state: { $in: TASK_ACTIVE_STATES },
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
        if (!TASK_ACTIVE_STATES.includes(state as string)) continue;
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
      const startTime = md.startTime instanceof Date
        ? md.startTime
        : typeof md.startTime === 'string'
          ? new Date(md.startTime)
          : undefined;
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
        const startTime = md.startTime instanceof Date
          ? md.startTime
          : typeof md.startTime === 'string'
            ? new Date(md.startTime)
            : undefined;
        acc.set(ev.id, { event: ev, role: 'context_of', when: startTime });
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
    const next: IEntity = {
      ...current,
      metadata: { ...(current.metadata ?? {}), ...patch },
      version: current.version + 1,
      updatedAt: new Date(),
    };
    await this.store.updateEntity(next);
    this.emit({ type: 'entity.upsert', entity: next, created: false });
    return next;
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

    // Pull atomic facts visible at target scope for generator input.
    // Cap to a sensible window; callers wanting everything can replace the generator.
    const factsPage = await this.store.findFacts(
      { subjectId: entityId, kind: 'atomic' },
      { limit: 500, orderBy: { field: 'observedAt', direction: 'desc' } },
      readScope,
    );

    // Prior profile at this exact target scope (not merely visible — same groupId/ownerId).
    const priorPage = await this.store.findFacts(
      { subjectId: entityId, predicate: 'profile', kind: 'document' },
      { limit: 10, orderBy: { field: 'createdAt', direction: 'desc' } },
      readScope,
    );
    const priorProfile = priorPage.items.find(
      (f) => sameScope(f, targetScope) && !f.archived,
    );

    const { details, summaryForEmbedding } = await this.profileGenerator.generate(
      entity,
      factsPage.items,
      priorProfile,
      targetScope,
    );

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
    } catch {
      // Background regen failures must not impact the write path.
      this.regenInFlight.delete(key);
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
    } catch {
      // Listener failures must not impact the data path.
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

  constructor(store: IMemoryStore, embedder: IEmbedder | undefined, config?: EmbeddingQueueConfig) {
    this.store = store;
    this.embedder = embedder;
    this.concurrency = config?.concurrency ?? DEFAULT_EMBED_CONCURRENCY;
    this.maxRetries = config?.retries ?? DEFAULT_EMBED_RETRIES;
  }

  /** Enqueue a fact's embedding — writes to IFact.embedding via updateFact. */
  enqueue(factId: FactId, text: string, scope: ScopeFilter): void {
    if (this.stopped || !this.embedder) return;
    this.queue.push({
      text,
      scope,
      attempts: 0,
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
    } catch {
      if (item.attempts < this.maxRetries) {
        item.attempts++;
        this.queue.push(item);
      }
      // Final failure: drop silently. Callers can re-trigger embedding by writing a new fact.
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
