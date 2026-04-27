/**
 * RestraintEvent — one shared shape for every decision a restraint primitive
 * makes (kept, dropped, vetoed, parse-failed). Used by `RestrainedExtractionContract`
 * and `SkepticPass`.
 *
 * The library does NOT write logs anywhere — it emits events. Hosts wire the
 * `onDecision` callback to their own log store (ICOS writes them to
 * `jarvis_activity_log` so admin dashboards can render emitted-vs-vetoed
 * counters and operators can tune presets against real data).
 *
 * Standing rule: **no silent disappearance**. Every drop, every veto, every
 * parse failure on the restraint path produces a `RestraintEvent`. If you
 * find yourself dropping an item without emitting one — stop and add the
 * event.
 */

/**
 * Event kinds. Open-string `string` fallback exists so hosts and downstream
 * extensions can emit additional reasons without a library bump, but the
 * documented kinds carry stable semantics for dashboards.
 */
export type RestraintEventKind =
  /** SkepticPass kept this item. */
  | 'skeptic_kept'
  /** SkepticPass voted to drop this item. */
  | 'skeptic_veto'
  /** SkepticPass output couldn't be parsed — pass treated as no-op for safety. */
  | 'skeptic_parse_failure'
  /** SkepticPass connector/model errored. Items pass through. */
  | 'skeptic_error'
  /** Item dropped because evidenceQuote was missing under strict mode. */
  | 'evidence_missing'
  /** Item dropped because servesAnchorId didn't match an active anchor. */
  | 'priority_unbound'
  /** No active anchors available; under strict requirePriorityBinding everything was dropped. */
  | 'no_anchors'
  /** Output non-empty but `whyActionable` missing under requireJustification. */
  | 'justification_missing'
  /** Item kept by RestrainedExtractionContract (passed all refinements). */
  | 'kept'
  | (string & {});

/** Stage label — extraction, narrative, scoring, etc. Open-string for host stages. */
export type RestraintStage =
  | 'signalExtraction'
  | 'taskNarrative'
  | 'priorityScoring'
  | (string & {});

/**
 * Telemetry about the model call that produced or vetoed the item. Optional —
 * emitted only when the primitive actually called a connector.
 */
export interface RestraintModelInfo {
  connector: string;
  model: string;
  /** Wall-clock latency for the call in milliseconds. */
  latencyMs?: number;
}

export interface RestraintEvent {
  kind: RestraintEventKind;
  stage: RestraintStage;
  /** Reference to the item this event is about — fact index, mention label, task id, etc. */
  itemRef: string;
  /** Stable code for filtering / dashboards (e.g. `evidence_missing`). */
  reasonCode: string;
  /** Human-readable reason. Suitable for surfacing to operators. */
  reasonText: string;
  /** Set when the decision involved a model call. */
  modelInfo?: RestraintModelInfo;
  /** Free-form additional context — e.g. anchor ids tried, snippet of the bad quote. */
  meta?: Record<string, unknown>;
  /** Wall-clock at emission. Defaults to `new Date()` at construction time. */
  at?: Date;
}

/** Convenience callback type used by every restraint primitive. */
export type RestraintEventListener = (event: RestraintEvent) => void;

/**
 * Helper: emit one event to a listener while also pushing it onto an array
 * (so the caller's result can include the full `events: RestraintEvent[]`).
 *
 * Listener errors do NOT propagate — a logging failure must not break the
 * pipeline (otherwise we'd silently drop items because we couldn't log
 * dropping them, defeating the rule). But the failure IS logged via
 * `console.error` with the offending event attached, so a buggy listener
 * doesn't blackhole every decision invisibly. The "no silent error" rule
 * applies even to error-handling code.
 */
export function emitRestraintEvent(
  collector: RestraintEvent[],
  listener: RestraintEventListener | undefined,
  event: RestraintEvent,
): void {
  const stamped: RestraintEvent = { at: new Date(), ...event };
  collector.push(stamped);
  if (listener) {
    try {
      listener(stamped);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[RestraintEvent] listener threw — event still recorded', {
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        event: stamped,
      });
    }
  }
}
