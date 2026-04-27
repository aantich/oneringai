/**
 * AnchorRegistry — pluggable interface for binding extracted items to
 * stated anchors (e.g. a user's priorities, a project's OKRs, a team's
 * focus areas).
 *
 * The library ships the *interface only*. Hosts provide the implementation —
 * for ICOS the impl walks the memory graph from the user entity outward via
 * `tracks_priority` facts and returns the active priority entities.
 *
 * Used by `defaultExtractionPrompt` (when `EagernessProfile.requirePriorityBinding`
 * is on, the prompt renders the active anchors and asks the LLM to bind each
 * extracted task to one) and by `RestrainedExtractionContract` (for strict-mode
 * binding validation).
 */

/**
 * One anchor as surfaced to the LLM. `id` is opaque to the library (often an
 * entity id in the host's memory graph). `label` is human-readable text the
 * LLM sees and reasons about. `kind` and `metadata` are advisory.
 */
export interface Anchor {
  /** Stable id the LLM echoes back as `servesAnchorId`. Opaque string. */
  id: string;
  /** Short human-readable label. Surfaces in the prompt. */
  label: string;
  /** Optional category — e.g. `priority`, `okr`, `focus_area`. */
  kind?: string;
  /** Optional details for prompt rendering — e.g. `{ horizon: 'quarter' }`. */
  metadata?: Record<string, unknown>;
}

/**
 * Pluggable lookup. Implementations decide where anchors come from
 * (memory graph traversal, settings collection, external service) and
 * how "active" is defined (current quarter, current week, etc.).
 *
 * `getAnchorsForUser` is invoked at most once per extraction call; small
 * latencies are fine, but implementations should NOT hit a cold cache from
 * inside a tight loop — cache at the application layer if needed.
 */
export interface AnchorRegistry {
  /**
   * Return active anchors for the user. Empty array means "no active
   * anchors" — under `strict` priority binding, callers should treat this as
   * a hard signal that nothing should be emitted.
   */
  getAnchorsForUser(userId: string): Promise<Anchor[]>;

  /**
   * Validate a host-emitted binding. Returns `true` if `anchorId` is one of
   * this user's currently active anchors. Implementations may apply
   * additional rules (recency, scope, etc.).
   */
  validateBinding(userId: string, anchorId: string): Promise<boolean>;
}

/**
 * Static-data convenience — wraps a fixed `Anchor[]` as an AnchorRegistry.
 * Useful for tests, demos, and scripts where the active set is hand-rolled.
 *
 * `getAnchorsForUser` returns the same list regardless of `userId` — this is
 * intentional for testing. Real impls should branch on `userId`.
 */
export class StaticAnchorRegistry implements AnchorRegistry {
  constructor(private readonly anchors: readonly Anchor[]) {}

  async getAnchorsForUser(_userId: string): Promise<Anchor[]> {
    return [...this.anchors];
  }

  async validateBinding(_userId: string, anchorId: string): Promise<boolean> {
    return this.anchors.some((a) => a.id === anchorId);
  }
}
