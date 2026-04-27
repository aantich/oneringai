/**
 * EagernessProfile — tunable restraint posture for extraction / scoring stages.
 *
 * Host applications (e.g. an exec-facing Chief-of-Staff product) frequently
 * need to *suppress* LLM eagerness: stop surfacing every issue, stop inventing
 * detail when the source is thin, prefer silence over output. This profile
 * makes that posture configurable per call (and per stage within a call) so
 * the same library can serve both chatty and disciplined deployments.
 *
 * The profile is **descriptive, not executive** — it records preferences;
 * downstream prompt builders, parsers, and the optional `SkepticPass` consult
 * it. The library ships no opinionated defaults beyond `chatty` (the most
 * permissive preset) so existing callers keep their current behavior unless
 * they opt in.
 */

/** Named presets — convenience labels that pick a coherent set of knobs. */
export type EagernessPreset = 'chatty' | 'balanced' | 'strict' | 'minimal';

/** Three-state knob: feature off, advisory in prompt, schema-enforced. */
export type EagernessLevel = 'off' | 'soft' | 'strict';

/**
 * Skeptic-pass mode label. The library does NOT define a connector/model for
 * each mode — that's the host's choice (e.g. ICOS picks Haiku for `cheap`,
 * Sonnet at low temp for `strong`). Code that runs the pass takes the mode
 * label and looks up its concrete config out of band.
 */
export type SkepticPassMode = 'off' | 'cheap' | 'strong';

/** Stage identifier for per-stage overrides. */
export type EagernessStage = 'signalExtraction' | 'taskNarrative' | 'priorityScoring';

export interface EagernessProfile {
  /** Preset name, recorded for telemetry. Resolved values may differ if the
   *  host applied per-stage or per-knob overrides. */
  preset: EagernessPreset;

  /** Force every emitted task / signal / fact to carry a verbatim quote from
   *  source. `strict` rejects items missing the quote; `soft` keeps the field
   *  optional but prompts the model to prefer it. */
  requireEvidenceQuote: EagernessLevel;

  /** When non-empty output is produced, require a one-sentence justification
   *  (`whyActionable`). `false` keeps the prompt and parser silent on this. */
  requireJustification: boolean;

  /** Bind each emitted Task to a stated user priority (an "anchor"). Strict
   *  drops items whose binding doesn't match an active anchor; soft renders
   *  anchors in the prompt but doesn't enforce. */
  requirePriorityBinding: EagernessLevel;

  /** Run the skeptic pass after the primary call. Mode is a label; the host
   *  resolves it to a concrete connector/model. */
  skepticPass: SkepticPassMode;

  /** Number of recent dismissals to inject as negative examples. 0 disables. */
  negativeExamplesCount: number;

  /** Per-stage overrides applied on top of the top-level fields. */
  perStage?: Partial<Record<EagernessStage, Partial<EagernessProfile>>>;
}

/**
 * Canonical preset table. `chatty` is the no-restraint baseline (matches the
 * library's pre-EagernessProfile behavior). `strict` is the recommended ICOS
 * default. `minimal` is the strongest discipline — for pre-launch tuning or
 * very high-bar exec deployments.
 */
export const EAGERNESS_PRESETS: Record<EagernessPreset, EagernessProfile> = {
  chatty: {
    preset: 'chatty',
    requireEvidenceQuote: 'off',
    requireJustification: false,
    requirePriorityBinding: 'off',
    skepticPass: 'off',
    negativeExamplesCount: 0,
  },
  balanced: {
    preset: 'balanced',
    requireEvidenceQuote: 'soft',
    requireJustification: true,
    requirePriorityBinding: 'soft',
    skepticPass: 'cheap',
    negativeExamplesCount: 2,
  },
  strict: {
    preset: 'strict',
    requireEvidenceQuote: 'strict',
    requireJustification: true,
    requirePriorityBinding: 'strict',
    skepticPass: 'cheap',
    negativeExamplesCount: 3,
  },
  minimal: {
    preset: 'minimal',
    requireEvidenceQuote: 'strict',
    requireJustification: true,
    requirePriorityBinding: 'strict',
    skepticPass: 'strong',
    negativeExamplesCount: 5,
  },
};

/**
 * Look up a preset by name. Returns a fresh shallow copy so callers can mutate
 * without poisoning the canonical table.
 */
export function getEagernessPreset(preset: EagernessPreset): EagernessProfile {
  const p = EAGERNESS_PRESETS[preset];
  return { ...p, perStage: p.perStage ? { ...p.perStage } : undefined };
}

/**
 * Resolve the effective profile for a given stage.
 *
 * Resolution order: `profile.perStage[stage]` → `profile` (top-level) →
 * `getEagernessPreset(profile.preset)` (canonical preset).
 *
 * Returns a NEW object — never aliases the inputs. The returned profile's
 * `perStage` field is omitted (resolution is one-way; downstream code should
 * not re-resolve).
 */
export function resolveEagerness(
  profile: EagernessProfile,
  stage: EagernessStage,
): EagernessProfile {
  const presetBase = EAGERNESS_PRESETS[profile.preset];
  const stageOverride = profile.perStage?.[stage] ?? {};
  const merged: EagernessProfile = {
    preset: profile.preset,
    requireEvidenceQuote:
      stageOverride.requireEvidenceQuote ??
      profile.requireEvidenceQuote ??
      presetBase.requireEvidenceQuote,
    requireJustification:
      stageOverride.requireJustification ??
      profile.requireJustification ??
      presetBase.requireJustification,
    requirePriorityBinding:
      stageOverride.requirePriorityBinding ??
      profile.requirePriorityBinding ??
      presetBase.requirePriorityBinding,
    skepticPass:
      stageOverride.skepticPass ?? profile.skepticPass ?? presetBase.skepticPass,
    negativeExamplesCount:
      stageOverride.negativeExamplesCount ??
      profile.negativeExamplesCount ??
      presetBase.negativeExamplesCount,
  };
  return merged;
}

/**
 * Build a profile from a preset name with optional top-level overrides.
 * Convenience for hosts that want "preset X but with `requireJustification`
 * always on" without hand-rolling the merge.
 */
export function buildEagernessProfile(
  preset: EagernessPreset,
  overrides?: Partial<Omit<EagernessProfile, 'preset'>>,
): EagernessProfile {
  const base = getEagernessPreset(preset);
  return { ...base, ...overrides, preset };
}
