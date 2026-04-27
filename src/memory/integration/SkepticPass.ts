/**
 * SkepticPass — optional second-LLM-pass that vetoes weak items.
 *
 * The library ships **no defaults** for connector / model / prompt — the
 * primary pass already produced an output, and the question of *which model*
 * should second-guess it is a deployment choice (cheap small model vs the
 * primary at low temperature). Hosts wire it.
 *
 * **Design constraint — every decision is logged.** A pass that silently
 * drops items defeats the whole point of restraint (we couldn't tune it,
 * couldn't explain to users). Therefore:
 *   - Every item produces a `skeptic_kept` or `skeptic_veto` event.
 *   - Parse failures emit `skeptic_parse_failure` and the pass falls open
 *     (everything kept) — failing closed would silently swallow legitimate
 *     items because the model misformatted JSON.
 *   - Model errors emit `skeptic_error` with the same fail-open semantics.
 * `result.events` carries the full log; `onDecision` streams it live.
 *
 * The skeptic is generic over item type — review takes a list of items the
 * caller has stringified into a label + summary, and gives back the kept/
 * dropped split. Item identity is by index.
 */

import { Agent } from '../../core/Agent.js';
import { parseJsonPermissive } from '../../utils/jsonRepair.js';
import {
  emitRestraintEvent,
  type RestraintEvent,
  type RestraintEventListener,
  type RestraintStage,
} from './RestraintEvent.js';

export interface SkepticPassConfig {
  /** Connector name — must already be registered. */
  connector: string;
  /** Model identifier passed to the connector. */
  model: string;
  /** Optional override for the system prompt. Receives the rendered review
   *  context and must instruct the LLM to return `{ keep: [...], drop: [{ index, reason }] }`. */
  promptTemplate?: (ctx: SkepticPromptContext) => string;
  /** Sampling temperature. Default 0.1 — low to keep veto deterministic. */
  temperature?: number;
  /** Default decision listener — fires for every event in every `review()` call. */
  onDecision?: RestraintEventListener;
  /** Cap on output tokens. Default undefined (model's own ceiling). */
  maxOutputTokens?: number;
}

export interface SkepticReviewItem {
  /** Stable id surfaced in the prompt and echoed back in events. */
  id: string;
  /** Compact summary the skeptic reasons over. Keep ≤ ~200 chars per item. */
  summary: string;
  /** Optional per-item meta surfaced in events; not shown to the LLM. */
  meta?: Record<string, unknown>;
}

export interface SkepticReviewContext {
  /** Stage label for emitted events. Defaults to caller stage. */
  stage?: RestraintStage;
  /** Optional preamble appended to the prompt — e.g. "review tasks against priorities X/Y/Z". */
  contextHint?: string;
  /** Per-call decision listener (in addition to the constructor-level one). */
  onDecision?: RestraintEventListener;
}

export interface SkepticReviewResult {
  /** Items the skeptic voted to keep. */
  kept: SkepticReviewItem[];
  /** Items the skeptic voted to drop, with reasons. */
  dropped: Array<{ item: SkepticReviewItem; reason: string }>;
  /** Full decision log: one event per item plus pass-level events on errors. */
  events: RestraintEvent[];
  /** Set when the LLM call itself failed and items were passed through. */
  failedOpen: boolean;
}

export interface SkepticPromptContext {
  items: SkepticReviewItem[];
  contextHint?: string;
}

/** Minimal Agent-shaped object used for testing — see static `withAgent`. */
interface AgentLike {
  runDirect: Agent['runDirect'];
  destroy: Agent['destroy'];
}

export class SkepticPass {
  private readonly agent: AgentLike;
  private readonly promptFn: (ctx: SkepticPromptContext) => string;
  private readonly temperature: number;
  private readonly defaultListener?: RestraintEventListener;
  private readonly maxOutputTokens: number | undefined;
  private readonly modelInfo: { connector: string; model: string };
  private _destroyed = false;

  constructor(config: SkepticPassConfig) {
    this.agent = Agent.create({
      connector: config.connector,
      model: config.model,
    });
    this.promptFn = config.promptTemplate ?? defaultSkepticPrompt;
    this.temperature = config.temperature ?? 0.1;
    this.defaultListener = config.onDecision;
    this.maxOutputTokens = config.maxOutputTokens;
    this.modelInfo = { connector: config.connector, model: config.model };
  }

  /** True after `destroy()` has been called. Matches the `IDisposable`
   *  pattern used by Agent / AgentContextNextGen / ToolManager. */
  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Construct from a pre-built agent-like object. Intended for testing — same
   * pattern as `ConnectorProfileGenerator.withAgent`.
   */
  static withAgent(args: {
    agent: AgentLike;
    connector?: string;
    model?: string;
    promptTemplate?: (ctx: SkepticPromptContext) => string;
    temperature?: number;
    onDecision?: RestraintEventListener;
    maxOutputTokens?: number;
  }): SkepticPass {
    const instance = Object.create(SkepticPass.prototype) as SkepticPass;
    const bag = instance as unknown as {
      agent: AgentLike;
      promptFn: (ctx: SkepticPromptContext) => string;
      temperature: number;
      defaultListener?: RestraintEventListener;
      maxOutputTokens: number | undefined;
      modelInfo: { connector: string; model: string };
      _destroyed: boolean;
    };
    bag.agent = args.agent;
    bag.promptFn = args.promptTemplate ?? defaultSkepticPrompt;
    bag.temperature = args.temperature ?? 0.1;
    bag.defaultListener = args.onDecision;
    bag.maxOutputTokens = args.maxOutputTokens;
    bag.modelInfo = {
      connector: args.connector ?? 'test',
      model: args.model ?? 'test',
    };
    bag._destroyed = false;
    return instance;
  }

  /**
   * Review a list of items and return the kept/dropped split. Always emits
   * one event per item (and pass-level events on parse / model errors). On
   * any failure the pass falls open (all items kept) and the failure is
   * logged — never silently swallowed.
   */
  async review(
    items: SkepticReviewItem[],
    ctx: SkepticReviewContext = {},
  ): Promise<SkepticReviewResult> {
    const events: RestraintEvent[] = [];
    const stage = ctx.stage ?? 'signalExtraction';
    const listener: RestraintEventListener | undefined =
      ctx.onDecision ?? this.defaultListener;

    if (items.length === 0) {
      return { kept: [], dropped: [], events, failedOpen: false };
    }

    const prompt = this.promptFn({ items, contextHint: ctx.contextHint });

    const startedAt = Date.now();
    let raw = '';
    try {
      const response = await this.agent.runDirect(prompt, {
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
        responseFormat: { type: 'json_object' },
      });
      raw = response.output_text ?? '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitRestraintEvent(events, listener, {
        kind: 'skeptic_error',
        stage,
        itemRef: 'pass',
        reasonCode: 'skeptic_error',
        reasonText: `Skeptic LLM call failed; falling open (all items kept). ${message}`,
        modelInfo: { ...this.modelInfo, latencyMs: Date.now() - startedAt },
      });
      // Fail open with per-item kept events so the log is honest.
      for (const item of items) {
        emitRestraintEvent(events, listener, {
          kind: 'skeptic_kept',
          stage,
          itemRef: item.id,
          reasonCode: 'skeptic_failed_open',
          reasonText: 'Kept because skeptic call failed.',
          modelInfo: this.modelInfo,
          meta: item.meta,
        });
      }
      return { kept: [...items], dropped: [], events, failedOpen: true };
    }

    const latencyMs = Date.now() - startedAt;
    const decision = parseSkepticOutput(raw, items.length);
    if (!decision.ok) {
      emitRestraintEvent(events, listener, {
        kind: 'skeptic_parse_failure',
        stage,
        itemRef: 'pass',
        reasonCode: 'skeptic_parse_failure',
        reasonText: `Skeptic output unparseable; falling open (all items kept). ${decision.reason}`,
        modelInfo: { ...this.modelInfo, latencyMs },
        meta: { rawExcerpt: raw.slice(0, 500) },
      });
      for (const item of items) {
        emitRestraintEvent(events, listener, {
          kind: 'skeptic_kept',
          stage,
          itemRef: item.id,
          reasonCode: 'skeptic_failed_open',
          reasonText: 'Kept because skeptic output was unparseable.',
          modelInfo: this.modelInfo,
          meta: item.meta,
        });
      }
      return { kept: [...items], dropped: [], events, failedOpen: true };
    }

    // Map index → drop-reason. Anything not listed is implicitly kept.
    const dropByIndex = new Map<number, string>();
    for (const d of decision.drops) {
      // Defensive: clamp + dedupe; library treats out-of-range indices as parse-noise.
      if (Number.isInteger(d.index) && d.index >= 0 && d.index < items.length) {
        if (!dropByIndex.has(d.index)) {
          dropByIndex.set(d.index, d.reason);
        }
      }
    }

    const kept: SkepticReviewItem[] = [];
    const dropped: Array<{ item: SkepticReviewItem; reason: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const dropReason = dropByIndex.get(i);
      if (dropReason !== undefined) {
        dropped.push({ item, reason: dropReason });
        emitRestraintEvent(events, listener, {
          kind: 'skeptic_veto',
          stage,
          itemRef: item.id,
          reasonCode: 'skeptic_veto',
          reasonText: dropReason,
          modelInfo: { ...this.modelInfo, latencyMs },
          meta: item.meta,
        });
      } else {
        kept.push(item);
        emitRestraintEvent(events, listener, {
          kind: 'skeptic_kept',
          stage,
          itemRef: item.id,
          reasonCode: 'skeptic_kept',
          reasonText: 'Skeptic kept item.',
          modelInfo: { ...this.modelInfo, latencyMs },
          meta: item.meta,
        });
      }
    }

    return { kept, dropped, events, failedOpen: false };
  }

  /** Idempotent. Calling twice is a no-op rather than a double-destroy of
   *  the underlying Agent. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.agent.destroy();
  }
}

// =============================================================================
// Default skeptic prompt + output parser
// =============================================================================

export function defaultSkepticPrompt(ctx: SkepticPromptContext): string {
  const lines: string[] = [];
  lines.push(
    "You are a strict reviewer of a junior assistant's recommendations. Most candidates should be REJECTED. Reject anything that is speculative, weakly supported, restates context without action, or is below the user's clear bar.",
  );
  lines.push('');
  if (ctx.contextHint) {
    lines.push('## Review context');
    // contextHint may carry user-provided priorities or upstream LLM output;
    // sanitize so a crafted hint can't open a fake `## Output` block and
    // pre-fill `{drop:[]}`.
    lines.push(sanitizePromptString(ctx.contextHint, 1000));
    lines.push('');
  }
  lines.push('## Candidates');
  for (let i = 0; i < ctx.items.length; i++) {
    const item = ctx.items[i]!;
    // item.summary often originates from extracted signals (emails, scraped
    // text) — same prompt-injection risk as contextHint. Cap aggressively
    // (the docstring promises ≤ 200 chars; we enforce it).
    lines.push(
      `${i}. [${sanitizePromptString(item.id, 80)}] ${sanitizePromptString(item.summary, 200)}`,
    );
  }
  lines.push('');
  lines.push('## Output');
  lines.push(
    'Return JSON with shape `{ "drop": [{ "index": <int>, "reason": "<short>" }, ...] }`. Anything not listed in `drop` is implicitly kept. If everything is fine, return `{ "drop": [] }`. Bias hard toward dropping.',
  );
  lines.push('Output ONLY the JSON.');
  return lines.join('\n');
}

/**
 * Defang a string before splicing into the skeptic prompt. Same role as the
 * helper in `defaultExtractionPrompt.ts` — not exported across files because
 * the rules are deliberately narrow to each prompt's structure.
 */
function sanitizePromptString(s: string, maxLen: number): string {
  const noBreaks = s.replace(/[\r\n]+/g, ' ');
  const noFences = noBreaks.replace(/`/g, "'");
  const noHeading = noFences.replace(/^[\s>#]+/, '').trimStart();
  const trimmed = noHeading.trim();
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen) + '…';
}

interface SkepticParseOk {
  ok: true;
  drops: Array<{ index: number; reason: string }>;
}
interface SkepticParseErr {
  ok: false;
  reason: string;
}

export function parseSkepticOutput(
  raw: string,
  _itemCount: number,
): SkepticParseOk | SkepticParseErr {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: 'empty output' };
  }
  let parsed: unknown;
  try {
    parsed = parseJsonPermissive(raw);
  } catch {
    return { ok: false, reason: 'JSON parse failed' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'output is not a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  const dropRaw = obj.drop;
  if (dropRaw === undefined) {
    // Permissive: accept the model returning just keeps.
    return { ok: true, drops: [] };
  }
  if (!Array.isArray(dropRaw)) {
    return { ok: false, reason: '`drop` is not an array' };
  }
  const drops: Array<{ index: number; reason: string }> = [];
  for (const d of dropRaw) {
    if (!d || typeof d !== 'object') continue;
    const drec = d as Record<string, unknown>;
    const idx = typeof drec.index === 'number' ? drec.index : Number(drec.index);
    const reason =
      typeof drec.reason === 'string' && drec.reason.trim().length > 0
        ? drec.reason.trim()
        : 'no reason given';
    if (Number.isFinite(idx)) {
      drops.push({ index: idx, reason });
    }
  }
  return { ok: true, drops };
}
