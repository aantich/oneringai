/**
 * SessionIngestorPluginNextGen — post-run learning pipeline.
 *
 * Observes the accumulated conversation before every `prepare()` (which may
 * compact + evict messages), extracts structured facts via a dedicated LLM
 * connector, dedupes against existing memory, and merges details on matches
 * via a second LLM call. Fire-and-forget: the plugin kicks off async work
 * from `onBeforePrepare` and returns immediately; the next turn sees whatever
 * has been persisted by then.
 *
 * This is a SIDE-EFFECT plugin:
 *   - `getContent()` returns null (nothing injected into system message).
 *   - `getTools()` returns [] (no LLM-callable tools).
 *   - `getInstructions()` returns null (no prompt contribution).
 *
 * Required config: `memory`, `agentId`, `userId`, `connectorName`, `model`.
 * No defaults on the connector/model — the host must explicitly wire its own
 * extraction backend (usually a cheaper model like Haiku).
 *
 * Watermark (per session, persisted via getState/restoreState): tracks the
 * last ingested message index. On each onBeforePrepare we extract only the
 * delta since the watermark, then advance it.
 */

import type { Agent } from '../../Agent.js';
import type {
  IContextPluginNextGen,
  PluginPrepareSnapshot,
} from '../types.js';
import type { ToolFunction } from '../../../domain/entities/Tool.js';
import type {
  EntityId,
  IFact,
  MemorySystem,
  ScopeFilter,
} from '../../../memory/index.js';
import type {
  ExtractionFactSpec,
  ExtractionOutput,
} from '../../../memory/integration/ExtractionResolver.js';
import { parseExtractionWithStatus } from '../../../memory/integration/parseExtraction.js';
import { clampUnit } from '../../../tools/memory/types.js';
import { logger } from '../../../infrastructure/observability/Logger.js';

// ===========================================================================
// Config
// ===========================================================================

export type SessionIngestorDiligence = 'minimal' | 'normal' | 'thorough';

export interface SessionIngestorPluginConfig {
  /** Live memory system. REQUIRED. */
  memory: MemorySystem;
  /** Agent id. REQUIRED. */
  agentId: string;
  /** Current user id. REQUIRED (owner invariant). */
  userId: string;
  /** Optional trusted group id from host auth. Stamped on written facts. */
  groupId?: string;

  /**
   * Connector name used for BOTH the extraction call and the details-merge
   * call. REQUIRED — no default. The host typically wires a cheaper model
   * (Haiku / gpt-5-mini) here rather than reusing the main agent's connector.
   */
  connectorName: string;
  /** Model id on the connector. REQUIRED — no default. */
  model: string;

  /**
   * Extraction thoroughness. Default 'normal'.
   *   - 'minimal'  — only facts the user stated EXPLICITLY. No inference.
   *   - 'normal'   — standard guidelines (skip greetings, tool plumbing).
   *   - 'thorough' — capture tentative inferences too (with confidence < 0.7).
   */
  diligence?: SessionIngestorDiligence;

  /** Sampling temp for the extractor/merger agent. Default 0.2. */
  temperature?: number;
  /** Max output tokens per LLM call. Default 2000. */
  maxOutputTokens?: number;

  /**
   * Maximum characters of transcript sent to the extractor per run. Older
   * messages are truncated from the head when over budget. Default 20_000.
   */
  maxTranscriptChars?: number;

  /**
   * Minimum number of conversation messages (flat count, not user/assistant
   * pairs) that must have accumulated since the last successful ingest for a
   * natural \`onBeforePrepare\` trigger to fire. Below this threshold the hook
   * short-circuits and defers to the next turn.
   *
   * Default: 6 (≈ 3 user/assistant pairs). Set to 1 for per-turn ingest.
   *
   * For guaranteed final ingest at session end, call \`await plugin.flush()\`
   * before \`plugin.destroy()\` — \`flush\` ignores this threshold.
   */
  minBatchMessages?: number;
}

// ===========================================================================
// Special entity bootstrap — identifier-keyed, idempotent with the memory plugin
// ===========================================================================

const USER_IDENTIFIER_KIND = 'system_user_id';
const AGENT_IDENTIFIER_KIND = 'system_agent_id';

// ===========================================================================
// Plugin
// ===========================================================================

export class SessionIngestorPluginNextGen implements IContextPluginNextGen {
  readonly name = 'session_ingestor';

  private readonly memory: MemorySystem;
  private readonly agentId: string;
  private readonly userId: string;
  private readonly groupId: string | undefined;
  private readonly connectorName: string;
  private readonly model: string;
  private readonly diligence: SessionIngestorDiligence;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly maxTranscriptChars: number;
  private readonly minBatchMessages: number;

  private userEntityId: EntityId | undefined;
  private agentEntityId: EntityId | undefined;
  private bootstrapInFlight: Promise<void> | null = null;
  /** Set to true if bootstrap returned a foreign-owned entity — we disable
   *  the plugin for the rest of the session to prevent ghost-writes. */
  private bootstrapFailed = false;

  /** Stable watermark — id of the last message we've successfully ingested.
   *  Index-based watermarks break on compaction (AgentContextNextGen mutates
   *  _conversation via filter → indices shift), so we track a message id
   *  instead and scan forward for it on each turn. */
  private lastIngestedMessageId: string | null = null;
  private ingestInFlight: Promise<void> | null = null;
  private destroyed = false;
  /**
   * Most recent `onBeforePrepare` snapshot, kept so `flush()` can run ingest
   * on the current conversation without the caller supplying one. Updated on
   * every hook invocation (including the "below threshold, skip" path).
   */
  private lastSnapshot: PluginPrepareSnapshot | null = null;

  // Lazy-init LLM agent (built once on first use, disposed on destroy).
  private llmAgent: Agent | null = null;

  constructor(config: SessionIngestorPluginConfig) {
    if (!config.memory) throw new Error('SessionIngestorPluginNextGen requires config.memory');
    if (!config.agentId) throw new Error('SessionIngestorPluginNextGen requires config.agentId');
    if (!config.userId) throw new Error('SessionIngestorPluginNextGen requires config.userId');
    if (!config.connectorName) throw new Error('SessionIngestorPluginNextGen requires config.connectorName');
    if (!config.model) throw new Error('SessionIngestorPluginNextGen requires config.model');

    this.memory = config.memory;
    this.agentId = config.agentId;
    this.userId = config.userId;
    this.groupId = config.groupId;
    this.connectorName = config.connectorName;
    this.model = config.model;
    this.diligence = config.diligence ?? 'normal';
    this.temperature = config.temperature ?? 0.2;
    this.maxOutputTokens = config.maxOutputTokens ?? 2000;
    this.maxTranscriptChars = config.maxTranscriptChars ?? 20_000;
    // Clamp to at least 1 — below 1 makes no sense and breaks threshold checks.
    this.minBatchMessages = Math.max(1, config.minBatchMessages ?? 6);
  }

  // ---------------------------------------------------------------------------
  // IContextPluginNextGen — side-effect plugin, nothing injected
  // ---------------------------------------------------------------------------

  getInstructions(): string | null {
    return null;
  }

  async getContent(): Promise<string | null> {
    return null;
  }

  getContents(): unknown {
    return {
      lastIngestedMessageId: this.lastIngestedMessageId,
      bootstrapFailed: this.bootstrapFailed,
    };
  }

  getTokenSize(): number {
    return 0;
  }

  getInstructionsTokenSize(): number {
    return 0;
  }

  isCompactable(): boolean {
    return false;
  }

  async compact(_targetTokensToFree: number): Promise<number> {
    return 0;
  }

  getTools(): ToolFunction[] {
    return [];
  }

  destroy(): void {
    this.destroyed = true;
    this.llmAgent?.destroy();
    this.llmAgent = null;
  }

  getState(): unknown {
    return {
      version: 2,
      agentId: this.agentId,
      userId: this.userId,
      lastIngestedMessageId: this.lastIngestedMessageId,
    };
  }

  restoreState(state: unknown): void {
    if (!state || typeof state !== 'object') return;
    const s = state as Record<string, unknown>;
    // Reset if userId mismatches (host rebound plugin to a different user).
    if (typeof s.userId === 'string' && s.userId !== this.userId) {
      this.lastIngestedMessageId = null;
      return;
    }
    // v2 — id-based watermark.
    if (s.version === 2) {
      if (typeof s.lastIngestedMessageId === 'string') {
        this.lastIngestedMessageId = s.lastIngestedMessageId;
      } else {
        this.lastIngestedMessageId = null;
      }
      return;
    }
    // v1 — legacy index-based; can't safely translate. Reset and re-ingest.
    if (s.version === 1) {
      this.lastIngestedMessageId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // The hook — fires at the top of AgentContextNextGen.prepare()
  // ---------------------------------------------------------------------------

  onBeforePrepare(snapshot: PluginPrepareSnapshot): void {
    if (this.destroyed) return;
    if (this.bootstrapFailed) return; // Plugin disabled — can't write safely.

    // Remember the snapshot even if we skip firing — `flush()` uses this as
    // the source for a forced ingest on graceful shutdown.
    this.lastSnapshot = snapshot;

    // If a previous ingest is still in flight, don't pile up — skip this turn.
    // The next turn will include whatever hasn't been ingested yet (id-based
    // watermark means we won't lose messages even when we skip).
    if (this.ingestInFlight) return;

    // Slice by id. If lastIngestedMessageId is null → take all. If it's set
    // but not present in the current array (compacted away), take all too
    // (dedup protects us from re-inserting duplicates).
    const messagesSlice = sliceAfterId(snapshot.messages, this.lastIngestedMessageId);
    if (messagesSlice.length === 0) return;

    // Batching gate — skip unless we've accumulated enough messages to amortize
    // the LLM call. `flush()` bypasses this gate for guaranteed final ingest.
    if (messagesSlice.length < this.minBatchMessages) return;

    this.ingestInFlight = this.ingest(messagesSlice)
      .catch((err) => {
        logger.warn(
          {
            component: 'SessionIngestorPluginNextGen',
            agentId: this.agentId,
            userId: this.userId,
            error: err instanceof Error ? err.message : String(err),
          },
          'session ingest failed — will retry next turn',
        );
      })
      .finally(() => {
        this.ingestInFlight = null;
      });
  }

  // ---------------------------------------------------------------------------
  // Public accessor — for tests
  // ---------------------------------------------------------------------------

  /** Await the current in-flight ingestion, if any. Used by tests to deterministically wait. */
  async waitForIngest(): Promise<void> {
    if (this.ingestInFlight) await this.ingestInFlight;
  }

  /**
   * Force-ingest any pending messages and await completion — the graceful-
   * shutdown escape hatch. Bypasses `minBatchMessages`; uses the most recent
   * `onBeforePrepare` snapshot as the source (so callers should ensure
   * `AgentContextNextGen.prepare()` has fired at least once after the last
   * message was added — typically that happens naturally during the last
   * agent turn).
   *
   * Contract: hosts should call `await plugin.flush()` before disposing of
   * the plugin (on DDP disconnect, `/back`, SIGINT, etc.) to guarantee the
   * final batch is persisted. `destroy()` does NOT await — it only flips the
   * destroyed flag and releases the LLM agent.
   *
   * Safe to call multiple times; on a destroyed plugin, this awaits any
   * in-flight ingest but does not start a new one.
   *
   * Optional `snapshot` override: callers that have already built a fresh
   * `PluginPrepareSnapshot` (e.g. via another plugin's hook) can pass it in
   * directly and skip the stored-snapshot path.
   */
  async flush(snapshot?: PluginPrepareSnapshot): Promise<void> {
    // Always await any existing in-flight ingest first — both for correctness
    // (don't overlap) and so a caller that just kicked an ingest via a prior
    // `prepare()` call gets its results before we add more.
    if (this.ingestInFlight) {
      try {
        await this.ingestInFlight;
      } catch {
        // Swallow — errors are already logged in the promise chain. We still
        // attempt the forced flush on top of a prior failure.
      }
    }

    if (this.destroyed) return;
    if (this.bootstrapFailed) return;

    const source = snapshot ?? this.lastSnapshot;
    if (!source) return; // No prepare has fired yet; nothing to flush.

    const messagesSlice = sliceAfterId(source.messages, this.lastIngestedMessageId);
    if (messagesSlice.length === 0) return;

    // Unlike `onBeforePrepare`, we run even below `minBatchMessages` — that's
    // the whole point of `flush()`.
    const promise = this.ingest(messagesSlice).catch((err) => {
      logger.warn(
        {
          component: 'SessionIngestorPluginNextGen',
          agentId: this.agentId,
          userId: this.userId,
          error: err instanceof Error ? err.message : String(err),
        },
        'flush() ingest failed',
      );
    });
    this.ingestInFlight = promise.finally(() => {
      this.ingestInFlight = null;
    });
    await this.ingestInFlight;
  }

  /** Id of the last message we've ingested. `null` before any ingest. */
  getLastIngestedMessageId(): string | null {
    return this.lastIngestedMessageId;
  }

  /** Whether bootstrap encountered a foreign-owned entity and disabled the plugin. */
  isDisabled(): boolean {
    return this.bootstrapFailed || this.destroyed;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async ensureLlmAgent(): Promise<Agent> {
    if (this.llmAgent) return this.llmAgent;
    // Dynamic import to break the Agent ↔ plugins barrel cycle. Agent extends
    // BaseAgent which gets re-entered during module init if we import at the
    // top level.
    const { Agent: AgentCtor } = await import('../../Agent.js');
    this.llmAgent = AgentCtor.create({
      connector: this.connectorName,
      model: this.model,
    });
    return this.llmAgent;
  }

  private async ensureBootstrapped(): Promise<void> {
    if (this.bootstrapInFlight) return this.bootstrapInFlight;
    if (this.userEntityId && this.agentEntityId) return;
    this.bootstrapInFlight = this.doBootstrap();
    try {
      await this.bootstrapInFlight;
    } finally {
      this.bootstrapInFlight = null;
    }
  }

  private async doBootstrap(): Promise<void> {
    const scope = this.scope();
    if (!this.agentEntityId) {
      const r = await this.memory.upsertEntity(
        {
          type: 'agent',
          displayName: `agent:${this.agentId}`,
          identifiers: [{ kind: AGENT_IDENTIFIER_KIND, value: this.agentId }],
        },
        scope,
      );
      // H-2: if the identifier matched a group-readable foreign-owned entity,
      // bootstrapping onto it would route every subsequent fact under that
      // foreign owner (ghost-write). Disable the plugin rather than corrupt
      // someone else's memory.
      if (r.entity.ownerId !== this.userId) {
        logger.error(
          {
            component: 'SessionIngestorPluginNextGen',
            agentId: this.agentId,
            userId: this.userId,
            foreignOwnerId: r.entity.ownerId,
          },
          'bootstrap returned an agent entity not owned by the current user — disabling session ingestor for this session',
        );
        this.bootstrapFailed = true;
        return;
      }
      this.agentEntityId = r.entity.id;
    }
    if (!this.userEntityId) {
      const r = await this.memory.upsertEntity(
        {
          type: 'person',
          displayName: `user:${this.userId}`,
          identifiers: [{ kind: USER_IDENTIFIER_KIND, value: this.userId }],
        },
        scope,
      );
      if (r.entity.ownerId !== this.userId) {
        logger.error(
          {
            component: 'SessionIngestorPluginNextGen',
            agentId: this.agentId,
            userId: this.userId,
            foreignOwnerId: r.entity.ownerId,
          },
          'bootstrap returned a user entity not owned by the current user — disabling session ingestor for this session',
        );
        this.bootstrapFailed = true;
        return;
      }
      this.userEntityId = r.entity.id;
    }
  }

  private scope(): ScopeFilter {
    return { userId: this.userId, groupId: this.groupId };
  }

  /** The main async ingest task, fired (not awaited) from onBeforePrepare. */
  private async ingest(messagesSlice: ReadonlyArray<unknown>): Promise<void> {
    if (this.destroyed) return;
    await this.ensureBootstrapped();
    if (this.destroyed || this.bootstrapFailed) return;
    if (!this.userEntityId || !this.agentEntityId) return;

    // H-3: budget-aware transcript. Advance the watermark only to the last
    // message that actually fit in `maxTranscriptChars`. Anything older than
    // that remains "not yet ingested" for a future turn.
    const { text, lastFitMessageId } = this.buildTranscript(messagesSlice);
    if (text.trim().length === 0) {
      // Nothing renderable — still advance to the end so we don't loop on
      // empty content.
      const lastId = findLastMessageIdWithId(messagesSlice);
      if (lastId !== null) this.lastIngestedMessageId = lastId;
      return;
    }

    if (this.destroyed) return;
    const output = await this.extract(text);
    if (this.destroyed) return;
    if (output.facts.length === 0 && Object.keys(output.mentions).length === 0) {
      if (lastFitMessageId !== null) this.lastIngestedMessageId = lastFitMessageId;
      return;
    }

    const scope = this.scope();
    const sourceSignalId = `session:${this.agentId}:${this.userId}:${Date.now()}`;

    // Pass 1: resolve mentions → entity ids. Pre-bind m_user + m_agent.
    // H-2 mention guard: skip mentions whose upsert returns a foreign-owned
    // entity. Any facts referencing that label will be silently dropped by
    // `writeOrQueueFact` (missing-label early return). This prevents ghost-
    // writes while letting the rest of the extraction proceed.
    const labelToId = new Map<string, EntityId>();
    labelToId.set('m_user', this.userEntityId);
    labelToId.set('m_agent', this.agentEntityId);
    for (const [label, mention] of Object.entries(output.mentions)) {
      if (this.destroyed) return;
      if (labelToId.has(label)) continue;
      try {
        const r = await this.memory.upsertEntity(
          {
            type: mention.type,
            displayName: mention.surface,
            identifiers: mention.identifiers ?? [],
            aliases: mention.aliases,
          },
          scope,
        );
        if (r.entity.ownerId !== this.userId) {
          logger.warn(
            {
              component: 'SessionIngestorPluginNextGen',
              label,
              entityId: r.entity.id,
              foreignOwnerId: r.entity.ownerId,
            },
            'mention resolved to a foreign-owned entity — dropping (facts referencing this mention will be skipped)',
          );
          continue;
        }
        labelToId.set(label, r.entity.id);
      } catch (err) {
        logger.warn(
          { component: 'SessionIngestorPluginNextGen', label, error: String(err) },
          'mention upsert failed — skipping',
        );
      }
    }

    // Pass 2: translate + dedup + write facts. Collect dup pairs for merge.
    if (this.destroyed) return;
    const dupPairs: Array<{ existing: IFact; newDetails: string }> = [];
    for (const spec of output.facts) {
      if (this.destroyed) return;
      try {
        await this.writeOrQueueFact(spec, labelToId, sourceSignalId, scope, dupPairs);
      } catch (err) {
        logger.warn(
          { component: 'SessionIngestorPluginNextGen', predicate: spec.predicate, error: String(err) },
          'fact write failed — skipping',
        );
      }
    }

    // Pass 3: per-dup LLM merge. On connector failure, leave old details alone
    // (option (a) — lossy but safe; next turn can re-extract and retry).
    for (const pair of dupPairs) {
      if (this.destroyed) return;
      try {
        const merged = await this.mergeDetails(pair.existing.details ?? '', pair.newDetails);
        if (merged && merged !== pair.existing.details) {
          await this.memory.updateFactDetails(pair.existing.id, merged, scope);
        }
      } catch (err) {
        logger.warn(
          { component: 'SessionIngestorPluginNextGen', factId: pair.existing.id, error: String(err) },
          'details merge failed — keeping existing details',
        );
      }
    }

    // Advance watermark ONLY to the last message that fit in the transcript —
    // messages past the budget remain unseen and will be ingested next turn.
    if (lastFitMessageId !== null) this.lastIngestedMessageId = lastFitMessageId;
  }

  private async writeOrQueueFact(
    spec: ExtractionFactSpec,
    labelToId: Map<string, EntityId>,
    sourceSignalId: string,
    scope: ScopeFilter,
    dupPairs: Array<{ existing: IFact; newDetails: string }>,
  ): Promise<void> {
    // C2: no silent drops. If the extractor references a label the resolver
    // couldn't map (typo, hallucination, foreign-owned mention dropped
    // upstream), emit a structured warn so the gap is observable. Each drop
    // is one fact of potential knowledge lost per turn — silence makes
    // regressions invisible.
    const subjectId = labelToId.get(spec.subject);
    if (!subjectId) {
      logger.warn(
        {
          component: 'SessionIngestorPluginNextGen',
          agentId: this.agentId,
          userId: this.userId,
          sourceSignalId,
          missingLabel: spec.subject,
          role: 'subject',
          predicate: spec.predicate,
          knownLabels: Array.from(labelToId.keys()),
        },
        'fact dropped — subject label not in resolved mentions',
      );
      return;
    }
    let objectId: EntityId | undefined;
    if (spec.object) {
      const oid = labelToId.get(spec.object);
      if (!oid) {
        logger.warn(
          {
            component: 'SessionIngestorPluginNextGen',
            agentId: this.agentId,
            userId: this.userId,
            sourceSignalId,
            missingLabel: spec.object,
            role: 'object',
            predicate: spec.predicate,
            knownLabels: Array.from(labelToId.keys()),
          },
          'fact dropped — object label not in resolved mentions',
        );
        return;
      }
      objectId = oid;
    }
    const contextIds: EntityId[] = [];
    const droppedContext: string[] = [];
    if (spec.contextIds) {
      for (const cid of spec.contextIds) {
        const resolved = labelToId.get(cid);
        if (resolved) contextIds.push(resolved);
        else droppedContext.push(cid);
      }
    }
    if (droppedContext.length > 0) {
      // Partial context is still useful — fact is written with the labels that
      // did resolve, but we log the dropped ones so they're recoverable.
      logger.warn(
        {
          component: 'SessionIngestorPluginNextGen',
          agentId: this.agentId,
          userId: this.userId,
          sourceSignalId,
          missingLabels: droppedContext,
          role: 'contextIds',
          predicate: spec.predicate,
          knownLabels: Array.from(labelToId.keys()),
        },
        'contextIds partially dropped — some labels not in resolved mentions',
      );
    }

    const kind =
      spec.kind === 'atomic' || spec.kind === 'document' ? spec.kind : 'atomic';

    const existing = await this.memory.findDuplicateFact(
      { subjectId, predicate: spec.predicate, kind, value: spec.value, objectId },
      scope,
    );
    if (existing) {
      // Bump observedAt on dup (keeps ranking fresh).
      await this.memory.addFact(
        {
          subjectId,
          predicate: spec.predicate,
          kind,
          value: spec.value,
          objectId,
          details: spec.details,
          dedup: true,
          observedAt: toDate(spec.observedAt) ?? new Date(),
        },
        scope,
      );
      // Queue for LLM-merged details when the new spec has a non-empty details.
      if (spec.details && spec.details.trim().length > 0) {
        dupPairs.push({ existing, newDetails: spec.details });
      }
      return;
    }

    await this.memory.addFact(
      {
        subjectId,
        predicate: spec.predicate,
        kind,
        value: spec.value,
        objectId,
        details: spec.details,
        summaryForEmbedding: spec.summaryForEmbedding,
        // C4: defence-in-depth — clamp at every external write boundary.
        // MemorySystem.addFact clamps internally too, but relying on a single
        // chokepoint is fragile (a new write path that bypasses core would
        // break ranking silently).
        confidence: clampUnit(spec.confidence),
        importance: clampUnit(spec.importance),
        contextIds: contextIds.length > 0 ? contextIds : undefined,
        observedAt: toDate(spec.observedAt),
        validFrom: toDate(spec.validFrom),
        validUntil: toDate(spec.validUntil),
        sourceSignalId,
      },
      scope,
    );
  }

  private async extract(transcript: string): Promise<ExtractionOutput> {
    const prompt = buildSessionExtractionPrompt({
      transcript,
      agentId: this.agentId,
      userId: this.userId,
      diligence: this.diligence,
      referenceDate: new Date(),
    });
    const agent = await this.ensureLlmAgent();
    const response = await agent.runDirect(prompt, {
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
      responseFormat: { type: 'json_object' },
    });
    const parsed = parseExtractionWithStatus(response.output_text ?? '');
    if (parsed.status !== 'ok') {
      // No silent errors. A transient LLM hiccup mustn't drop a whole turn
      // of knowledge without a trace — log enough to retry/diagnose.
      logger.warn(
        {
          component: 'SessionIngestorPluginNextGen',
          agentId: this.agentId,
          userId: this.userId,
          status: parsed.status,
          reason: parsed.reason,
          rawExcerpt: parsed.rawExcerpt,
        },
        'session extraction parse failed',
      );
    }
    return { mentions: parsed.mentions, facts: parsed.facts };
  }

  private async mergeDetails(oldDetails: string, newDetails: string): Promise<string> {
    const prompt = buildMergePrompt(oldDetails, newDetails);
    const agent = await this.ensureLlmAgent();
    const response = await agent.runDirect(prompt, {
      temperature: this.temperature,
      maxOutputTokens: Math.min(this.maxOutputTokens, 800),
    });
    return (response.output_text ?? '').trim();
  }

  /**
   * Build transcript text that fits within `maxTranscriptChars`. Walks from
   * OLDEST forward, accumulating while under budget, then returns the id of
   * the LAST included message as `lastFitMessageId`. The caller advances the
   * watermark to that id, so any messages past the budget remain unseen and
   * will be ingested on the next turn — no data loss.
   *
   * Edge case: if the first message alone exceeds the budget, we include it
   * anyway to guarantee forward progress (one fat message shouldn't stall the
   * ingestor forever).
   */
  private buildTranscript(
    messages: ReadonlyArray<unknown>,
  ): { text: string; lastFitMessageId: string | null } {
    if (messages.length === 0) return { text: '', lastFitMessageId: null };

    const lines: string[] = [];
    let accum = 0;
    let lastFitMessageId: string | null = null;
    let truncated = false;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const line = renderMessage(m);
      const lineLen = line.length + 1; // +1 for newline
      if (accum + lineLen > this.maxTranscriptChars && lines.length > 0) {
        truncated = true;
        break;
      }
      accum += lineLen;
      if (line.length > 0) lines.push(line);
      const id = getMessageId(m);
      if (id) lastFitMessageId = id;
    }

    const text =
      lines.join('\n') +
      (truncated ? '\n[transcript truncated — newer messages deferred to next turn]' : '');

    return { text, lastFitMessageId };
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function toDate(v: string | Date | undefined): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Extract `id` from a conversation item shape-safely. */
function getMessageId(m: unknown): string | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const id = (m as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Slice `messages` to items that appear AFTER the one with id=`afterId`.
 *   - `afterId === null` → return the full array (first ingest / reset).
 *   - `afterId` not found in the array → return the full array. The prior
 *     watermark target was compacted away; we can't locate it, so we treat
 *     the current array as everything-that's-new. Dedup protects us from
 *     re-inserting facts we already wrote.
 */
function sliceAfterId(
  messages: ReadonlyArray<unknown>,
  afterId: string | null,
): ReadonlyArray<unknown> {
  if (!afterId) return messages;
  for (let i = 0; i < messages.length; i++) {
    if (getMessageId(messages[i]) === afterId) {
      return messages.slice(i + 1);
    }
  }
  return messages;
}

/** Walk backward to find the newest message-with-id. */
function findLastMessageIdWithId(messages: ReadonlyArray<unknown>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = getMessageId(messages[i]);
    if (id) return id;
  }
  return null;
}

/** Max chars of serialized tool-call args rendered into the transcript. */
const TOOL_CALL_ARGS_MAX_CHARS = 500;
/** Max chars of serialized tool-result payload rendered into the transcript. */
const TOOL_RESULT_MAX_CHARS = 240;

/**
 * Best-effort render of a conversation message to plain text. Exported for
 * unit tests — the transcript-rendering shape directly affects extraction
 * quality (the extractor must be able to see tool-call arguments and results
 * to avoid re-extracting facts the agent already wrote).
 */
export function renderMessage(m: unknown): string {
  if (!m || typeof m !== 'object') return '';
  const msg = m as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role : 'unknown';
  const content = msg.content;
  if (typeof content === 'string') return `${role}: ${content}`;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      // Type-tagged parts win over the generic text/content fallback so a
      // tool_result with `content: 'boom'` renders as `[tool_result error ...]`,
      // not as plain text "boom".
      if (cc.type === 'tool_call' && typeof cc.name === 'string') {
        parts.push(renderToolCall(cc));
      } else if (cc.type === 'tool_result' && typeof cc.tool_use_id === 'string') {
        parts.push(renderToolResult(cc));
      } else if (typeof cc.text === 'string') {
        parts.push(cc.text);
      } else if (typeof cc.content === 'string') {
        parts.push(cc.content);
      }
    }
    return parts.length > 0 ? `${role}: ${parts.join(' ')}` : '';
  }
  return '';
}

/**
 * Render a tool call with truncated JSON args so the extractor can see what
 * has already been captured — critical for dedup against the background
 * extraction pipeline. Args are truncated at `TOOL_CALL_ARGS_MAX_CHARS` to
 * cap the token footprint; the extraction prompt instructs the LLM to treat
 * facts inside the arg block as already-written and NOT to re-extract them.
 */
function renderToolCall(cc: Record<string, unknown>): string {
  const name = String(cc.name ?? 'unknown');
  const args = cc.arguments ?? cc.input ?? cc.args;
  const serialized = serializeForTranscript(args, TOOL_CALL_ARGS_MAX_CHARS);
  if (!serialized) return `[tool_call ${name}]`;
  return `[tool_call ${name} ${serialized}]`;
}

/**
 * Render a tool result so the extractor can spot failures (and know the fact
 * was NOT captured, so the extractor should still consider it). Success
 * payloads are truncated; errors are surfaced explicitly.
 */
function renderToolResult(cc: Record<string, unknown>): string {
  // Heuristic: look for `is_error`/`error`/`isError` to distinguish failures.
  const isError =
    cc.is_error === true ||
    cc.isError === true ||
    (typeof cc.error === 'string' && cc.error.length > 0) ||
    (cc.result &&
      typeof cc.result === 'object' &&
      (cc.result as Record<string, unknown>).error !== undefined);

  const payload = cc.result ?? cc.content ?? cc.output;
  const serialized = serializeForTranscript(payload, TOOL_RESULT_MAX_CHARS);
  const tag = isError ? 'error' : 'ok';
  if (!serialized) return `[tool_result ${tag}]`;
  return `[tool_result ${tag} ${serialized}]`;
}

/**
 * JSON-serialize a value with length cap. Returns empty string if the value
 * is absent or unserializable. Truncation appends a single-character ellipsis
 * so the LLM can see the boundary.
 */
function serializeForTranscript(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) return '';
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + '…';
}

// ===========================================================================
// Session extraction prompt (three-bucket partition + diligence + validity)
// ===========================================================================

interface SessionExtractionPromptContext {
  transcript: string;
  agentId: string;
  userId: string;
  diligence: SessionIngestorDiligence;
  referenceDate: Date;
  /** Random nonce used in delimiters to prevent prompt-injection collisions. */
  nonce?: string;
}

export function buildSessionExtractionPrompt(ctx: SessionExtractionPromptContext): string {
  const diligenceSection = renderDiligenceDirectives(ctx.diligence);
  const refDate = ctx.referenceDate.toISOString().slice(0, 10);
  const nonce = ctx.nonce ?? makeNonce();
  const openTag = `conversation_${nonce}`;
  const closeTag = `/conversation_${nonce}`;

  return `You are analyzing a recent agent-user conversation turn and extracting memory updates. Your output populates a knowledge graph.

Reference date: ${refDate}

<${openTag}>
${ctx.transcript}
<${closeTag}>

## Pre-resolved labels (locked — reference directly in \`facts\`, DO NOT redeclare in \`mentions\`)
- \`m_user\` — the user (id=${ctx.userId})
- \`m_agent\` — the agent (id=${ctx.agentId})

When introducing NEW entities (other people, orgs, projects, events, tasks, topics), use labels \`m1\`, \`m2\`, etc.

## Output format
Return JSON with exactly two top-level keys:

{
  "mentions": {
    "<local_label>": {
      "surface": "<verbatim text>",
      "type": "<person|organization|project|task|event|topic|cluster>",
      "identifiers": [{ "kind": "<email|domain|slack_id|github|...>", "value": "..." }],
      "aliases": ["<alternate form>"]
    }
  },
  "facts": [
    {
      "subject": "<local_label>",
      "predicate": "<snake_case>",
      "object": "<local_label>",             // for relational; EITHER object OR value, never both
      "value": "<any JSON>",                   // for attribute
      "details": "<free-text narrative>",
      "confidence": 0.0-1.0,
      "importance": 0.0-1.0,                   // 0.5 default; 1.0 = identity; 0.1 = trivia
      "contextIds": ["<local_label>"],
      "kind": "atomic",                        // MUST be "atomic" or "document"
      "validUntil": "YYYY-MM-DDTHH:MM:SSZ"     // optional ISO-8601; see Validity period below
    }
  ]
}

## What to extract

**USER facts (subject: \`m_user\`).** Preferences, identity claims, roles, relationships, commitments the user stated or revealed.
- Good examples: \`{subject:"m_user", predicate:"prefers", value:"concise responses"}\`, \`{subject:"m_user", predicate:"works_at", object:"m1"}\`, \`{subject:"m_user", predicate:"full_name", value:"Anton Antich"}\`.

**OTHER entities.** People, organizations, projects, events, tasks mentioned in the conversation that aren't the user or agent. Declare them as new mentions and write facts about THEIR attributes / relationships. Use \`contextIds\` to bind observations to parent entities (a concern raised during a project discussion should have the project in \`contextIds\`).

**DO NOT extract facts with subject \`m_agent\`.** Agent behavior and personality are NOT a concern of this ambient extractor. User-owned behavior rules are captured exclusively when the user explicitly instructs the agent ("be terse", "reply in Russian") — the agent itself writes those via its own \`memory_set_agent_rule\` tool. Global agent instructions are admin-controlled. Any fact you would have put on \`m_agent\` is noise here — skip it.

## Fact kinds
Every fact sets \`kind\` to exactly ONE of:
- **"atomic"** — short/structured: attributes, relations, brief observations. DEFAULT.
- **"document"** — long-form prose: procedures, patterns, narratives. Use for multi-sentence \`details\`.

## Validity period
Set \`validUntil\` when the fact has a natural expiration. Omit for timeless facts. Calibration:
- Ephemeral (today only): \`validUntil\` = end of today.
- Task / event bound: \`validUntil\` = due date / event end.
- Role / preference / identity: omit \`validUntil\`.
When in doubt, OMIT \`validUntil\` — too-early expiry silently hides facts from queries.

${diligenceSection}

## Anti-patterns — DO NOT emit these

A fact is noise (and MUST be skipped) if it describes the conversation itself, restates mention metadata, or is too generic to distinguish anyone. The rules below matter more than any example list — apply the SHAPE rule first.

**Shape rule (most important):** if a predicate describes the *utterance event* itself — the fact that something was said, asked, mentioned, brought up, acknowledged, or discussed — it is transcript, not knowledge. Drop it. You are extracting what the user REVEALED about the world, not what they said in this turn.

Concrete illustrations of the shape rule (non-exhaustive — do not treat as a blocklist, apply the principle to ANY similar predicate):
- \`mentioned_by\`, \`mentioned_in\`, \`was_mentioned_in_conversation\`, \`referenced_in\`, \`appeared_in\`, \`discussed_in\`, \`talked_about\`, \`brought_up\`, \`raised_in\`, \`came_up_in\`, \`observed_in\`.
- \`asked_about\`, \`asked_for\`, \`inquired_about\`, \`questioned\`, \`wondered_about\`.
- \`said\`, \`told\`, \`stated\`, \`expressed\`, \`communicated\`, \`informed\`.
- \`acknowledged\`, \`greeted\`, \`thanked\`, \`confirmed\`, \`responded\`.

**Other noise categories:**

- **No tautologies with mention metadata.** The mention's \`type\` IS the entity's type — DO NOT write \`entity_type\`, \`is_a\`, \`category\`, \`kind\`, \`classification\` facts that repeat it. If Everworker is declared as \`type:"organization"\`, writing \`{subject:"m1", predicate:"entity_type", value:"organization"}\` is forbidden.
- **No generic attributes that hold for anyone.** \`is_person\`, \`has_name\`, \`has_identifier\`, \`exists\`, \`is_real\` — too universal to matter. If the same fact would hold for every user and every entity, skip it.
- **No boolean provenance facts.** \`was_discussed: true\`, \`is_mentioned: true\`, \`is_known: true\` — drop. Provenance is \`sourceSignalId\`, not a predicate.

**Self-check before emitting ANY fact** — answer both:
1. "Would a stranger reading only this fact, with no access to the transcript, learn something specific about this subject (the user, an entity in the world) that's not already in the mention?" If no, drop.
2. "Is this predicate describing what happened in the conversation, or what's true in the world?" If it's about the conversation, drop.

## Agent-written writes — do NOT re-extract them

The agent has write tools available for explicit user requests. When the user explicitly asks the agent to create a task, event, entity, or fact ("remind me to X", "create a task", "remember that X"), the agent writes it directly through its tools. These writes appear in the transcript as:

\`[tool_call memory_* <json-args>]\` — the JSON args have ALREADY been persisted.
\`[tool_result ok <json>]\` — the write succeeded.
\`[tool_result error <message>]\` — the write FAILED (in that case, the fact is NOT in memory).

**Rule:** when the transcript contains a \`[tool_call memory_*]\` block paired with a \`[tool_result ok ...]\`, the facts encoded inside the args are already captured. DO NOT re-extract ANY fact that restates, paraphrases, or decomposes what's in those arguments — even if the user's message in the same turn also stated it verbatim.

Concretely, a \`memory_upsert_entity\` with \`type:'task'\`, \`displayName:'Call the doctor'\`, \`metadata.dueAt:'2026-04-30'\` ALREADY captures:
- the task's existence (do not write \`has_task\`, \`assigned_to\`)
- the due date (do not write \`due_date\`, \`deadline\`, \`dueOn\`)
- the assignee-by-owner (do not write \`assigned_to\`)
- the task name (do not write \`task_name\`, \`title\`)
All of those would be duplicate facts.

If a tool_result says \`error\`, the write FAILED — in that case the fact is still extraction-eligible (the ambient layer becomes the safety net).

For \`memory_remember\` / \`memory_link\` calls: any fact with the same subject + predicate (or a near-synonym predicate) as the call's args is already captured — skip it.

Your job is the AMBIENT layer: facts the user revealed that the agent did NOT capture via its write tools in this turn.

## Do NOT synthesize action requests into facts

Imperative user requests like "remind me to X", "schedule Y", "track Z", "add to my to-do", "create a task for A" are agent-action requests, NOT ambient facts. They are the user telling the agent to DO something.

- If the agent handled the request via a \`memory_*\` tool call in the transcript, the existing re-extract rule already covers it (skip — already persisted).
- If the agent did NOT handle it (asked a clarifying question, forgot, refused, or the request is still mid-multi-turn clarification like "9am" answering "what time?"), you still MUST skip these. Do not synthesize \`has_task\`, \`has_reminder\`, \`assigned_to\`, \`due_date\`, \`needs_to\`, or task/event entities on the user's behalf. The agent's job is to fulfill action requests; yours is to capture world-facts the user revealed.

A user saying "remind me to call the doctor on April 30" reveals nothing about the user except that they want a reminder — which is an action request, not a persistent fact about them. Skip it entirely.

Exception: the user stating a future commitment as a fact (not a request) IS extractable — e.g. "I have a doctor appointment on April 30" CAN become an event entity, because the user is asserting a calendar fact, not asking the agent to act.

## General rules

- Skip greetings, acknowledgments, tool-call mechanics, transient task state.
- One observation = one fact. Don't duplicate facts within this extraction.
- Dedup against existing memory is automatic — you don't need to avoid re-extracting known facts. The system merges details when a duplicate is found.
- Prefer \`predicate: full_name\` / \`preferred_name\` / \`display_name\` for names; prefer \`works_at\` / \`works_on\` / \`member_of\` for affiliations; prefer \`prefers\` / \`dislikes\` / \`believes\` for opinions.
- When uncertain, SKIP. A noisy memory is worse than a sparse one — missing facts are re-extracted on the next mention; wrong facts pollute retrieval forever.
- Output ONLY the JSON. No surrounding prose, no code fences.`;
}

function renderDiligenceDirectives(d: SessionIngestorDiligence): string {
  switch (d) {
    case 'minimal':
      return `## Diligence: MINIMAL
Extract ONLY facts the user stated EXPLICITLY — no inference, no tentative observations.
Skip: preferences you inferred from tone, patterns you "noticed", implicit conclusions.
Keep: direct statements ("I work at X", "I prefer Y"), explicit corrections, explicit commitments.`;
    case 'thorough':
      return `## Diligence: THOROUGH
Extract explicit statements AND tentative inferences. Mark inferences with \`confidence: 0.3-0.7\` and explain the basis in \`details\`.
Capture: small preferences, repeated phrasings, inferred constraints, patterns that emerged across the turn.
Still skip: greetings, pleasantries, transient task state.`;
    case 'normal':
    default:
      return `## Diligence: NORMAL
Extract explicit facts plus confident inferences. Skip greetings, transient state, and tool mechanics. Set \`confidence\` conservatively for inferences (0.5-0.8).`;
  }
}

function buildMergePrompt(oldDetails: string, newDetails: string): string {
  const nonce = makeNonce();
  const existTag = `existing_${nonce}`;
  const newTag = `observation_${nonce}`;
  return `You are merging two observations of the same fact into a single coherent narrative. The storage layer dedupes facts by subject+predicate+value, so the fact itself is the same — only the narrative context differs.

<${existTag}>
${oldDetails}
</${existTag}>

<${newTag}>
${newDetails}
</${newTag}>

Return ONE merged narrative that:
- Preserves all non-redundant information from both.
- Removes direct repetition.
- Reads naturally — don't concatenate with separators.
- Stays concise (target: length of longer input + at most 20%).

Output ONLY the merged narrative text. No preamble, no code fences, no explanation.`;
}

/** Short random token — good enough to make delimiters unlikely to collide
 *  with LLM-extracted text. Not a security boundary. */
function makeNonce(): string {
  return Math.random().toString(36).slice(2, 10);
}
