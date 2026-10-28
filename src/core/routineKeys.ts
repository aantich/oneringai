/** Shared routine memory keys; keep values and the legacy re-export unchanged. */
export const ROUTINE_KEYS = {
  /** Plan overview with task statuses (ICM) */
  PLAN: '__routine_plan',
  /** Dependency results location guide (ICM) */
  DEPS: '__routine_deps',
  /** Prefix for per-dependency result keys (ICM/WM) */
  DEP_RESULT_PREFIX: '__dep_result_',
  /** Current map/fold item (ICM) */
  MAP_ITEM: '__map_item',
  /** Current map/fold index, 0-based (ICM) */
  MAP_INDEX: '__map_index',
  /** Total items in map/fold (ICM) */
  MAP_TOTAL: '__map_total',
  /** Running fold accumulator (ICM) */
  FOLD_ACCUMULATOR: '__fold_accumulator',
  /** Prefix for large dep results stored in WM findings tier */
  WM_DEP_FINDINGS_PREFIX: 'findings/__dep_result_',
  /** Prefix for auto-stored task outputs (set by output contracts) */
  TASK_OUTPUT_PREFIX: '__task_output_',
  /** Prefix for pre-step results stored in ICM/WM */
  PRE_STEP_PREFIX: '__prestep_',
  /** Prefix for post-step results stored in ICM/WM */
  POST_STEP_PREFIX: '__poststep_',
} as const;
