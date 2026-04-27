/**
 * RestrainedExtractionContract — applies an `EagernessProfile` to the parsed
 * extraction output, dropping items that violate the configured discipline.
 *
 * What the contract enforces (depending on the profile):
 *   - **whyActionable**: when `requireJustification` is on and output is non-empty,
 *     missing `whyActionable` is a violation — output is suppressed (treated as empty)
 *     and a `justification_missing` event is emitted.
 *   - **evidenceQuote**: under `requireEvidenceQuote = 'strict'`, every fact must
 *     carry a verbatim quote. Facts missing it are dropped + logged as
 *     `evidence_missing`. Under `'soft'`, missing quotes pass through silently.
 *   - **priority binding**: under `requirePriorityBinding = 'strict'`, every task
 *     mention must carry a `metadata.servesAnchorId` matching an active anchor.
 *     Tasks without a valid binding are dropped + logged as `priority_unbound`.
 *     If no anchors are active at all, ALL task mentions are dropped + logged as
 *     `no_anchors`.
 *
 * **Every drop emits a `RestraintEvent`** — no silent disappearance. Events
 * are returned in the result and (if `onDecision` is provided) streamed live.
 *
 * The contract does NOT call any LLM — pure refinement. For LLM-based veto
 * see `SkepticPass`.
 */

import type {
  ExtractionFactSpec,
  ExtractionMention,
  ExtractionOutput,
} from './ExtractionResolver.js';
import type { EagernessProfile } from './EagernessProfile.js';
import type { Anchor } from './AnchorRegistry.js';
import {
  emitRestraintEvent,
  type RestraintEvent,
  type RestraintEventListener,
  type RestraintStage,
} from './RestraintEvent.js';

export interface RestrainedExtractionInput {
  /** Mention map keyed by local label, as produced by the parser. */
  mentions: Record<string, ExtractionMention>;
  /** Fact spec list, as produced by the parser. */
  facts: ExtractionFactSpec[];
  /** Top-level justification, as parsed (`undefined` if absent). */
  whyActionable?: string;
}

export interface RestrainedExtractionOptions {
  profile: EagernessProfile;
  /** Stage label for emitted events. Default `signalExtraction`. */
  stage?: RestraintStage;
  /** Active anchors to validate `servesAnchorId` against. Empty / undefined ⇒
   *  no active anchors (matters under strict priority binding). */
  anchors?: Anchor[];
  /** Live event listener — fires once per decision (kept and dropped). */
  onDecision?: RestraintEventListener;
}

export interface RestrainedExtractionResult extends ExtractionOutput {
  /** Justification preserved when present. */
  whyActionable?: string;
  /** The full decision log, including kept items. */
  events: RestraintEvent[];
  /** Counts derived from `events` for quick assertions. */
  summary: {
    factsKept: number;
    factsDropped: number;
    mentionsKept: number;
    mentionsDropped: number;
    /** Set when output was suppressed wholesale (e.g. `whyActionable` missing). */
    suppressed: boolean;
  };
}

/**
 * Apply restraint refinements to a parsed extraction output. Pure — no I/O.
 *
 * Returns a NEW `ExtractionOutput` plus the decision log. The input is not
 * mutated. Mentions that were referenced only by dropped facts ARE retained —
 * the LLM may have introduced them for entity resolution alone, and dropping
 * them here would lose entity merge candidates. Tasks dropped for priority
 * reasons ARE removed entirely (mention + any facts referencing them).
 */
export function applyRestrainedExtractionContract(
  input: RestrainedExtractionInput,
  opts: RestrainedExtractionOptions,
): RestrainedExtractionResult {
  const stage = opts.stage ?? 'signalExtraction';
  const profile = opts.profile;
  const events: RestraintEvent[] = [];

  const inputFacts = input.facts ?? [];
  const inputMentionsEntries = Object.entries(input.mentions ?? {});
  const isNonEmpty = inputFacts.length > 0 || inputMentionsEntries.length > 0;

  // --- Justification check ----------------------------------------------------
  if (profile.requireJustification && isNonEmpty) {
    const trimmed = (input.whyActionable ?? '').trim();
    if (trimmed.length === 0) {
      emitRestraintEvent(events, opts.onDecision, {
        kind: 'justification_missing',
        stage,
        itemRef: 'output',
        reasonCode: 'justification_missing',
        reasonText:
          'Output had mentions or facts but no `whyActionable` justification. Suppressed under requireJustification.',
        meta: { mentionCount: inputMentionsEntries.length, factCount: inputFacts.length },
      });
      return {
        mentions: {},
        facts: [],
        events,
        summary: {
          factsKept: 0,
          factsDropped: inputFacts.length,
          mentionsKept: 0,
          mentionsDropped: inputMentionsEntries.length,
          suppressed: true,
        },
      };
    }
  }

  // --- Priority binding on task mentions --------------------------------------
  const droppedTaskLabels = new Set<string>();
  const keptMentions: Record<string, ExtractionMention> = {};
  if (profile.requirePriorityBinding !== 'off') {
    const anchors = opts.anchors ?? [];
    const activeIds = new Set(anchors.map((a) => a.id));
    const isStrict = profile.requirePriorityBinding === 'strict';

    if (isStrict && anchors.length === 0) {
      // No active anchors — drop every task mention, with a single pass-level event.
      for (const [label, mention] of inputMentionsEntries) {
        if (mention.type === 'task') {
          droppedTaskLabels.add(label);
          emitRestraintEvent(events, opts.onDecision, {
            kind: 'no_anchors',
            stage,
            itemRef: `mention:${label}`,
            reasonCode: 'no_anchors',
            reasonText:
              'No active anchors for this user; task mention dropped under strict priority binding.',
            meta: { surface: mention.surface },
          });
        } else {
          keptMentions[label] = mention;
        }
      }
    } else {
      for (const [label, mention] of inputMentionsEntries) {
        if (mention.type !== 'task') {
          keptMentions[label] = mention;
          continue;
        }
        const md = (mention.metadata ?? {}) as Record<string, unknown>;
        const servesId = typeof md.servesAnchorId === 'string' ? md.servesAnchorId : undefined;
        if (servesId && activeIds.has(servesId)) {
          keptMentions[label] = mention;
          emitRestraintEvent(events, opts.onDecision, {
            kind: 'kept',
            stage,
            itemRef: `mention:${label}`,
            reasonCode: 'priority_bound',
            reasonText: `Task bound to anchor ${servesId}.`,
            meta: { servesAnchorId: servesId },
          });
        } else if (isStrict) {
          droppedTaskLabels.add(label);
          emitRestraintEvent(events, opts.onDecision, {
            kind: 'priority_unbound',
            stage,
            itemRef: `mention:${label}`,
            reasonCode: 'priority_unbound',
            reasonText: servesId
              ? `Task references unknown anchor "${servesId}"; not in active set.`
              : 'Task missing servesAnchorId under strict priority binding.',
            meta: {
              surface: mention.surface,
              servesAnchorIdProvided: servesId,
              activeAnchorIds: [...activeIds],
            },
          });
        } else {
          // Soft binding — keep the task even without (or with stale)
          // anchor binding. Distinguish the two cases in the event so
          // operators tuning presets can see how often the LLM is
          // producing servesAnchorIds that point to inactive priorities
          // (a different signal than "didn't try to bind at all").
          keptMentions[label] = mention;
          const isStale = servesId !== undefined;
          emitRestraintEvent(events, opts.onDecision, {
            kind: 'kept',
            stage,
            itemRef: `mention:${label}`,
            reasonCode: isStale ? 'priority_stale_soft' : 'priority_unbound_soft',
            reasonText: isStale
              ? `Task references unknown anchor "${servesId}" (not in active set); kept under soft binding.`
              : 'Task kept without anchor binding (soft mode).',
            meta: {
              surface: mention.surface,
              ...(isStale ? { servesAnchorIdProvided: servesId } : {}),
            },
          });
        }
      }
    }
  } else {
    for (const [label, mention] of inputMentionsEntries) {
      keptMentions[label] = mention;
    }
  }

  // --- Evidence quote on facts + drop facts referencing dropped task labels ----
  const keptFacts: ExtractionFactSpec[] = [];
  let factsDropped = 0;

  for (let i = 0; i < inputFacts.length; i++) {
    const spec = inputFacts[i]!;
    const itemRef = `fact:${i}`;

    // Drop facts whose subject/object/contextIds reference dropped task labels.
    if (droppedTaskLabels.size > 0) {
      const refs = [
        spec.subject,
        spec.object,
        ...(spec.contextIds ?? []),
      ].filter((x): x is string => typeof x === 'string');
      const orphanedBy = refs.find((r) => droppedTaskLabels.has(r));
      if (orphanedBy) {
        factsDropped++;
        emitRestraintEvent(events, opts.onDecision, {
          kind: 'priority_unbound',
          stage,
          itemRef,
          reasonCode: 'orphaned_by_dropped_task',
          reasonText: `Fact references dropped task mention "${orphanedBy}"; dropped to keep graph consistent.`,
          meta: { predicate: spec.predicate, orphanedBy },
        });
        continue;
      }
    }

    // Evidence-quote check.
    if (profile.requireEvidenceQuote === 'strict') {
      const q = (spec.evidenceQuote ?? '').trim();
      if (q.length === 0) {
        factsDropped++;
        emitRestraintEvent(events, opts.onDecision, {
          kind: 'evidence_missing',
          stage,
          itemRef,
          reasonCode: 'evidence_missing',
          reasonText:
            'Fact dropped under requireEvidenceQuote=strict — no verbatim source quote provided.',
          meta: { predicate: spec.predicate, subject: spec.subject },
        });
        continue;
      }
    }

    keptFacts.push(spec);
    emitRestraintEvent(events, opts.onDecision, {
      kind: 'kept',
      stage,
      itemRef,
      reasonCode: 'kept',
      reasonText: 'Fact passed all restraint refinements.',
      meta: { predicate: spec.predicate },
    });
  }

  return {
    mentions: keptMentions,
    facts: keptFacts,
    ...(input.whyActionable !== undefined ? { whyActionable: input.whyActionable } : {}),
    events,
    summary: {
      factsKept: keptFacts.length,
      factsDropped,
      mentionsKept: Object.keys(keptMentions).length,
      mentionsDropped: inputMentionsEntries.length - Object.keys(keptMentions).length,
      suppressed: false,
    },
  };
}
