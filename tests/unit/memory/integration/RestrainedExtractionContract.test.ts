/**
 * RestrainedExtractionContract — refinement filtering with full decision logging.
 *
 * Standing rule (feedback_log_every_decision): every drop emits a RestraintEvent,
 * never silent. These tests prove that — both the kept and dropped events show up.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyRestrainedExtractionContract,
  type RestrainedExtractionInput,
} from '@/memory/integration/RestrainedExtractionContract.js';
import {
  buildEagernessProfile,
  EAGERNESS_PRESETS,
} from '@/memory/integration/EagernessProfile.js';
import type { Anchor } from '@/memory/integration/AnchorRegistry.js';
import type {
  ExtractionFactSpec,
  ExtractionMention,
} from '@/memory/integration/ExtractionResolver.js';
import type { RestraintEvent } from '@/memory/integration/RestraintEvent.js';

const ANCHORS: Anchor[] = [
  { id: 'pri-1', label: 'Q2 launch' },
  { id: 'pri-2', label: 'VPE hire' },
];

function f(spec: Partial<ExtractionFactSpec>): ExtractionFactSpec {
  return { subject: 'm1', predicate: 'mentioned', ...spec };
}

function taskMention(servesAnchorId?: string): ExtractionMention {
  return {
    surface: 'follow up',
    type: 'task',
    metadata: servesAnchorId ? { servesAnchorId } : {},
  };
}

describe('applyRestrainedExtractionContract — chatty (no-op)', () => {
  it('passes everything through under chatty preset', () => {
    const input: RestrainedExtractionInput = {
      mentions: { m1: taskMention() },
      facts: [f({}), f({ predicate: 'discussed_topic' })],
    };
    const r = applyRestrainedExtractionContract(input, {
      profile: EAGERNESS_PRESETS.chatty,
    });
    expect(r.facts).toHaveLength(2);
    expect(Object.keys(r.mentions)).toEqual(['m1']);
    expect(r.summary.factsDropped).toBe(0);
    expect(r.summary.suppressed).toBe(false);
  });
});

describe('applyRestrainedExtractionContract — requireJustification', () => {
  const profile = buildEagernessProfile('strict');

  it('suppresses entire output when whyActionable missing on non-empty extraction', () => {
    const r = applyRestrainedExtractionContract(
      {
        mentions: { m1: { surface: 'Alice', type: 'person' } },
        facts: [f({ evidenceQuote: '"quote"' })],
      },
      { profile, anchors: ANCHORS },
    );
    expect(r.summary.suppressed).toBe(true);
    expect(r.facts).toHaveLength(0);
    expect(Object.keys(r.mentions)).toHaveLength(0);
    expect(r.events.find((e) => e.kind === 'justification_missing')).toBeDefined();
  });

  it('passes through when whyActionable is provided', () => {
    const r = applyRestrainedExtractionContract(
      {
        mentions: { m1: { surface: 'Alice', type: 'person' } },
        facts: [f({ evidenceQuote: '"quote"' })],
        whyActionable: 'Alice committed to ship by EOQ.',
      },
      { profile, anchors: ANCHORS },
    );
    expect(r.summary.suppressed).toBe(false);
    expect(r.whyActionable).toBe('Alice committed to ship by EOQ.');
  });

  it('does NOT require whyActionable when output is empty', () => {
    const r = applyRestrainedExtractionContract(
      { mentions: {}, facts: [] },
      { profile, anchors: ANCHORS },
    );
    expect(r.summary.suppressed).toBe(false);
    expect(r.events.find((e) => e.kind === 'justification_missing')).toBeUndefined();
  });
});

describe('applyRestrainedExtractionContract — evidence quote', () => {
  const profile = buildEagernessProfile('strict', { requirePriorityBinding: 'off' });

  it('strict mode drops facts missing evidenceQuote and emits events', () => {
    const events: RestraintEvent[] = [];
    const r = applyRestrainedExtractionContract(
      {
        mentions: { m1: { surface: 'Alice', type: 'person' } },
        facts: [
          f({ predicate: 'a', evidenceQuote: '"alice said hi"' }),
          f({ predicate: 'b' }), // no quote
          f({ predicate: 'c', evidenceQuote: '   ' }), // whitespace only
        ],
        whyActionable: 'why',
      },
      { profile, onDecision: (e) => events.push(e) },
    );
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]!.predicate).toBe('a');
    expect(r.summary.factsDropped).toBe(2);
    const drops = events.filter((e) => e.kind === 'evidence_missing');
    expect(drops).toHaveLength(2);
    for (const d of drops) {
      expect(d.reasonCode).toBe('evidence_missing');
      expect(d.reasonText).toContain('no verbatim source quote');
    }
  });

  it('soft mode keeps everything but does not invent quotes', () => {
    const softProfile = buildEagernessProfile('balanced', {
      requirePriorityBinding: 'off',
    });
    const r = applyRestrainedExtractionContract(
      {
        mentions: {},
        facts: [f({ predicate: 'a' }), f({ predicate: 'b' })],
        whyActionable: 'why',
      },
      { profile: softProfile },
    );
    expect(r.facts).toHaveLength(2);
    expect(r.summary.factsDropped).toBe(0);
  });

  it('decision events are returned in result.events even when no listener supplied', () => {
    const r = applyRestrainedExtractionContract(
      {
        mentions: {},
        facts: [f({ predicate: 'a', evidenceQuote: 'q' }), f({ predicate: 'b' })],
        whyActionable: 'why',
      },
      { profile },
    );
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).toContain('kept');
    expect(kinds).toContain('evidence_missing');
  });
});

describe('applyRestrainedExtractionContract — priority binding', () => {
  it('strict drops task mentions without servesAnchorId', () => {
    const profile = buildEagernessProfile('strict', { requireEvidenceQuote: 'off' });
    const r = applyRestrainedExtractionContract(
      {
        mentions: {
          m1: { surface: 'Alice', type: 'person' },
          tA: taskMention('pri-1'),
          tB: taskMention(), // no servesAnchorId
          tC: taskMention('unknown-anchor'), // wrong id
        },
        facts: [],
        whyActionable: 'why',
      },
      { profile, anchors: ANCHORS },
    );
    expect(Object.keys(r.mentions).sort()).toEqual(['m1', 'tA']);
    const drops = r.events.filter((e) => e.kind === 'priority_unbound');
    expect(drops).toHaveLength(2);
    expect(drops.map((d) => d.itemRef).sort()).toEqual(['mention:tB', 'mention:tC']);
  });

  it('strict + zero anchors emits no_anchors per task and drops them all', () => {
    const profile = buildEagernessProfile('strict', { requireEvidenceQuote: 'off' });
    const r = applyRestrainedExtractionContract(
      {
        mentions: {
          tA: taskMention('pri-1'),
          tB: taskMention(),
          p1: { surface: 'Org', type: 'organization' },
        },
        facts: [],
        whyActionable: 'why',
      },
      { profile, anchors: [] },
    );
    expect(Object.keys(r.mentions)).toEqual(['p1']);
    const noAnchors = r.events.filter((e) => e.kind === 'no_anchors');
    expect(noAnchors).toHaveLength(2);
  });

  it('soft mode keeps unbound tasks but logs them as soft-kept', () => {
    const profile = buildEagernessProfile('balanced', { requireEvidenceQuote: 'off' });
    const r = applyRestrainedExtractionContract(
      {
        mentions: {
          tA: taskMention('pri-1'),
          tB: taskMention(),
        },
        facts: [],
        whyActionable: 'why',
      },
      { profile, anchors: ANCHORS },
    );
    expect(Object.keys(r.mentions).sort()).toEqual(['tA', 'tB']);
    const softKept = r.events.filter(
      (e) => e.kind === 'kept' && e.reasonCode === 'priority_unbound_soft',
    );
    expect(softKept).toHaveLength(1);
    expect(softKept[0]!.itemRef).toBe('mention:tB');
  });

  it('soft mode distinguishes stale-anchor (priority_stale_soft) from no-anchor', () => {
    const profile = buildEagernessProfile('balanced', { requireEvidenceQuote: 'off' });
    const r = applyRestrainedExtractionContract(
      {
        mentions: {
          tNoBind: taskMention(),
          tStale: taskMention('pri-decommissioned'),
        },
        facts: [],
        whyActionable: 'why',
      },
      { profile, anchors: ANCHORS },
    );
    // Both kept under soft, but with different reasonCodes so dashboards can
    // separate "LLM didn't bind" from "LLM bound to a stale anchor".
    expect(Object.keys(r.mentions).sort()).toEqual(['tNoBind', 'tStale']);
    const noBind = r.events.find(
      (e) => e.itemRef === 'mention:tNoBind' && e.reasonCode === 'priority_unbound_soft',
    );
    const stale = r.events.find(
      (e) => e.itemRef === 'mention:tStale' && e.reasonCode === 'priority_stale_soft',
    );
    expect(noBind).toBeDefined();
    expect(stale).toBeDefined();
    expect(stale!.meta?.servesAnchorIdProvided).toBe('pri-decommissioned');
    expect(stale!.reasonText).toContain('pri-decommissioned');
  });

  it('drops facts that reference dropped task labels', () => {
    const profile = buildEagernessProfile('strict', { requireEvidenceQuote: 'off' });
    const r = applyRestrainedExtractionContract(
      {
        mentions: {
          tBad: taskMention(), // dropped
          m1: { surface: 'Alice', type: 'person' },
        },
        facts: [
          // References dropped task as subject
          f({ subject: 'tBad', predicate: 'committed_to' }),
          // References dropped task in contextIds
          f({ subject: 'm1', predicate: 'discussed_topic', contextIds: ['tBad'] }),
          // Standalone, should survive
          f({ subject: 'm1', predicate: 'said_hi' }),
        ],
        whyActionable: 'why',
      },
      { profile, anchors: ANCHORS },
    );
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]!.predicate).toBe('said_hi');
    const orphanEvents = r.events.filter(
      (e) => e.reasonCode === 'orphaned_by_dropped_task',
    );
    expect(orphanEvents).toHaveLength(2);
  });
});

describe('applyRestrainedExtractionContract — listener semantics', () => {
  it('listener receives every event in the same order as result.events', () => {
    const profile = buildEagernessProfile('strict');
    const seen: RestraintEvent[] = [];
    const r = applyRestrainedExtractionContract(
      {
        mentions: { tA: taskMention('pri-1') },
        facts: [
          f({ subject: 'tA', predicate: 'a', evidenceQuote: 'q' }),
          f({ subject: 'tA', predicate: 'b' }), // no quote → drop
        ],
        whyActionable: 'why',
      },
      {
        profile,
        anchors: ANCHORS,
        onDecision: (e) => seen.push(e),
      },
    );
    expect(seen).toHaveLength(r.events.length);
    expect(seen.map((e) => e.kind)).toEqual(r.events.map((e) => e.kind));
  });

  it('listener errors do not propagate but are logged — pipeline keeps running', () => {
    const profile = buildEagernessProfile('strict');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        applyRestrainedExtractionContract(
          {
            mentions: { m1: { surface: 'Alice', type: 'person' } },
            facts: [f({ evidenceQuote: 'q' })],
            whyActionable: 'why',
          },
          {
            profile,
            anchors: ANCHORS,
            onDecision: () => {
              throw new Error('listener exploded');
            },
          },
        ),
      ).not.toThrow();
      // The "no silent error" rule applies even to listener failures —
      // every listener throw must surface on console.error so a buggy
      // listener doesn't blackhole every decision.
      expect(errSpy).toHaveBeenCalled();
      const firstCall = errSpy.mock.calls[0]!;
      expect(String(firstCall[0])).toContain('[RestraintEvent] listener threw');
    } finally {
      errSpy.mockRestore();
    }
  });
});
