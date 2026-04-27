/**
 * EagernessProfile — preset table, builder, per-stage resolution.
 */

import { describe, it, expect } from 'vitest';
import {
  EAGERNESS_PRESETS,
  buildEagernessProfile,
  getEagernessPreset,
  resolveEagerness,
  type EagernessProfile,
} from '@/memory/integration/EagernessProfile.js';

describe('EAGERNESS_PRESETS', () => {
  it('exposes all four named presets', () => {
    expect(Object.keys(EAGERNESS_PRESETS).sort()).toEqual([
      'balanced',
      'chatty',
      'minimal',
      'strict',
    ]);
  });

  it('chatty is the no-restraint baseline', () => {
    const p = EAGERNESS_PRESETS.chatty;
    expect(p.requireEvidenceQuote).toBe('off');
    expect(p.requireJustification).toBe(false);
    expect(p.requirePriorityBinding).toBe('off');
    expect(p.skepticPass).toBe('off');
    expect(p.negativeExamplesCount).toBe(0);
  });

  it('strict turns everything on (cheap skeptic, evidence + binding strict)', () => {
    const p = EAGERNESS_PRESETS.strict;
    expect(p.requireEvidenceQuote).toBe('strict');
    expect(p.requireJustification).toBe(true);
    expect(p.requirePriorityBinding).toBe('strict');
    expect(p.skepticPass).toBe('cheap');
    expect(p.negativeExamplesCount).toBeGreaterThan(0);
  });

  it('minimal is the strongest discipline (strong skeptic)', () => {
    const p = EAGERNESS_PRESETS.minimal;
    expect(p.skepticPass).toBe('strong');
    expect(p.requireEvidenceQuote).toBe('strict');
    expect(p.requirePriorityBinding).toBe('strict');
  });
});

describe('getEagernessPreset', () => {
  it('returns a deep-enough copy that mutations do not leak', () => {
    const a = getEagernessPreset('strict');
    a.requireEvidenceQuote = 'off';
    const b = getEagernessPreset('strict');
    expect(b.requireEvidenceQuote).toBe('strict');
  });
});

describe('buildEagernessProfile', () => {
  it('starts from a preset and applies overrides', () => {
    const p = buildEagernessProfile('balanced', { skepticPass: 'strong' });
    expect(p.preset).toBe('balanced');
    expect(p.skepticPass).toBe('strong');
    expect(p.requireEvidenceQuote).toBe('soft'); // unchanged
  });

  it('preset name is non-overridable', () => {
    const p = buildEagernessProfile('chatty', {
      // @ts-expect-error preset is omitted from the overrides type
      preset: 'strict',
    });
    expect(p.preset).toBe('chatty');
  });
});

describe('resolveEagerness', () => {
  const base = buildEagernessProfile('balanced');

  it('returns top-level fields when no perStage override', () => {
    const r = resolveEagerness(base, 'signalExtraction');
    expect(r.requireEvidenceQuote).toBe(base.requireEvidenceQuote);
    expect(r.skepticPass).toBe(base.skepticPass);
    expect(r.preset).toBe('balanced');
  });

  it('per-stage override wins for the stage that has one', () => {
    const profile: EagernessProfile = {
      ...base,
      perStage: {
        taskNarrative: { skepticPass: 'strong', requireEvidenceQuote: 'strict' },
      },
    };
    const sig = resolveEagerness(profile, 'signalExtraction');
    const narr = resolveEagerness(profile, 'taskNarrative');
    expect(sig.skepticPass).toBe(base.skepticPass);
    expect(narr.skepticPass).toBe('strong');
    expect(narr.requireEvidenceQuote).toBe('strict');
  });

  it('per-stage override does not bleed into other stages', () => {
    const profile: EagernessProfile = {
      ...base,
      perStage: { priorityScoring: { negativeExamplesCount: 5 } },
    };
    const r = resolveEagerness(profile, 'signalExtraction');
    expect(r.negativeExamplesCount).toBe(base.negativeExamplesCount);
  });

  it('returns a NEW object — does not alias inputs', () => {
    const r = resolveEagerness(base, 'signalExtraction');
    expect(r).not.toBe(base);
    r.skepticPass = 'strong';
    expect(base.skepticPass).not.toBe('strong');
  });

  it('falls back to canonical preset when top-level field is missing', () => {
    // Construct a profile missing one field (simulating partial host config)
    const partial = { ...base } as EagernessProfile;
    // @ts-expect-error simulating bad input
    delete partial.skepticPass;
    const r = resolveEagerness(partial, 'signalExtraction');
    // balanced preset has skepticPass='cheap'
    expect(r.skepticPass).toBe('cheap');
  });
});
