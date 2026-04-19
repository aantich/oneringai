/**
 * Predicate library — types.
 *
 * A `PredicateDefinition` describes one predicate in the vocabulary: its
 * canonical name, description, category, and optional write-time behavior
 * (defaultImportance, auto-supersession for single-valued predicates,
 * aggregate semantics) plus ranking weight and LLM-prompt metadata.
 *
 * The registry is *optional*. When no registry is configured on MemorySystem,
 * predicates remain free-form strings — nothing in the memory layer breaks.
 */

export interface PredicateDefinition {
  /** Canonical snake_case name — the id. */
  name: string;

  /** One-line description shown in the LLM prompt + docs. */
  description: string;

  /** Grouping used for prompt chunking (e.g. 'identity', 'task', 'communication'). */
  category: string;

  /**
   * What shape of payload this predicate expects. Informational — memory
   * layer does not enforce it (permissive by design).
   */
  payloadKind?: 'relational' | 'attribute' | 'narrative';

  /** Typing hint surfaced in the LLM prompt. Not enforced at write time. */
  subjectTypes?: string[];
  objectTypes?: string[];

  /** Reverse predicate (e.g. 'reports_to' ↔ 'manages'). Informational only. */
  inverse?: string;

  /**
   * Other surface forms that canonicalize to this predicate. Lowercased at
   * register time; lookup is case-insensitive.
   */
  aliases?: string[];

  /** 0..1. Applied to IFact.importance when the writer omits it. */
  defaultImportance?: number;

  /**
   * Multiplier in Ranking.scoreFact. Folded into RankingConfig.predicateWeights
   * by PredicateRegistry.toRankingWeights. User-supplied weights always win.
   */
  rankingWeight?: number;

  /**
   * Aggregate predicates (counters, sums) — update in place, never supersede.
   * Mutually exclusive with singleValued.
   */
  isAggregate?: boolean;

  /**
   * Single-valued predicates (e.g. current_title). Writing a new fact
   * auto-supersedes the prior visible one for (subject, predicate). Can be
   * disabled globally via MemorySystemConfig.predicateAutoSupersede:false.
   * Mutually exclusive with isAggregate.
   */
  singleValued?: boolean;

  /** Shown to the LLM in the prompt to disambiguate. Keep ≤ 2 per predicate. */
  examples?: string[];
}
