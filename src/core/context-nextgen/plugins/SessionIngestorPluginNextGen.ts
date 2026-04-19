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

    // If a previous ingest is still in flight, don't pile up — skip this turn.
    // The next turn will include whatever hasn't been ingested yet (id-based
    // watermark means we won't lose messages even when we skip).
    if (this.ingestInFlight) return;

    // Slice by id. If lastIngestedMessageId is null → take all. If it's set
    // but not present in the current array (compacted away), take all too
    // (dedup protects us from re-inserting duplicates).
    const messagesSlice = sliceAfterId(snapshot.messages, this.lastIngestedMessageId);
    if (messagesSlice.length === 0) return;

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

/** Best-effort render of a conversation message to plain text. */
function renderMessage(m: unknown): string {
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
      if (typeof cc.text === 'string') parts.push(cc.text);
      else if (typeof cc.content === 'string') parts.push(cc.content);
      else if (cc.type === 'tool_call' && typeof cc.name === 'string') {
        parts.push(`[tool:${cc.name}]`);
      } else if (cc.type === 'tool_result' && typeof cc.tool_use_id === 'string') {
        parts.push(`[tool_result:${cc.tool_use_id}]`);
      }
    }
    return parts.length > 0 ? `${role}: ${parts.join(' ')}` : '';
  }
  return '';
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

  return `You are analyzing a recent agent-user conversation turn and extracting memory updates. Your output populates a knowledge graph partitioned across THREE buckets.

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

## Three buckets — ORGANIZE your output around these

**Bucket 1 — USER facts (subject: \`m_user\`).** Preferences, identity claims, personal circumstances the user stated or revealed.
- Examples: \`{subject:"m_user", predicate:"prefers", value:"concise responses"}\`, \`{subject:"m_user", predicate:"works_at", object:"m1"}\`.

**Bucket 2 — AGENT learnings (subject: \`m_agent\`).** Procedures / patterns / rules the agent DISCOVERED during this turn that would help on future turns. Use \`kind:"document"\` for multi-sentence procedures.
- Examples: \`{subject:"m_agent", predicate:"learned_pattern", details:"When calculating tax, ALWAYS confirm jurisdiction first because rates differ materially by state", kind:"document"}\`, \`{subject:"m_agent", predicate:"avoided_pitfall", details:"Don't suggest Meteor 2.x async patterns — this project is on 3.x"}\`.

**Bucket 3 — OTHER entities.** People, organizations, projects, events, tasks mentioned in the conversation that aren't the user or agent. Declare them as new mentions and write facts about them. Use \`contextIds\` to bind observations to parent entities (e.g. a concern raised during a project discussion should have the project in \`contextIds\`).

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

## General rules
- Skip greetings, acknowledgments, tool-call mechanics, transient task state.
- One observation = one fact. Don't duplicate facts within this extraction.
- Dedup against existing memory is automatic — you don't need to avoid re-extracting known facts. The system merges details when a duplicate is found.
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
Extract both explicit statements AND tentative inferences. Mark inferences with \`confidence: 0.3-0.7\` and explain the basis in \`details\`.
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
