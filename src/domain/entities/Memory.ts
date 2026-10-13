/**
 * Memory entities for WorkingMemory
 *
 * This module provides a GENERIC memory system that works across all agent types:
 * - Basic Agent: Simple session/persistent scoping with static priority
 * - TaskAgent: Task-aware scoping with dynamic priority based on task states
 * - UniversalAgent: Mode-aware, switches strategy based on current mode
 *
 * The key abstraction is PriorityCalculator - a pluggable strategy that
 * determines entry priority for eviction decisions.
 */

// ============================================================================
// SCOPE TYPES (Generic + Task-Aware)
// ============================================================================

/**
 * Simple scope for basic agents - just a lifecycle label
 */
export type SimpleScope = 'session' | 'persistent';

/**
 * Task-aware scope for TaskAgent/UniversalAgent
 */
export type TaskAwareScope =
  | { type: 'task'; taskIds: string[] }   // Needed for specific task(s)
  | { type: 'plan' }                       // Needed throughout plan execution
  | { type: 'persistent' };                // Keep even after plan completes

/**
 * Union type - memory system accepts both
 */
export type MemoryScope = SimpleScope | TaskAwareScope;

/**
 * Type guard: is this a task-aware scope?
 */
export function isTaskAwareScope(scope: MemoryScope): scope is TaskAwareScope {
  return typeof scope === 'object' && scope !== null && 'type' in scope;
}

/**
 * Type guard: is this a simple scope?
 */
export function isSimpleScope(scope: MemoryScope): scope is SimpleScope {
  return scope === 'session' || scope === 'persistent';
}

/**
 * Compare two scopes for equality
 * Handles both simple scopes (string comparison) and task-aware scopes (deep comparison)
 */
export function scopeEquals(a: MemoryScope, b: MemoryScope): boolean {
  // Simple scope comparison
  if (isSimpleScope(a) && isSimpleScope(b)) {
    return a === b;
  }

  // Task-aware scope comparison
  if (isTaskAwareScope(a) && isTaskAwareScope(b)) {
    if (a.type !== b.type) return false;

    // For task scope, compare taskIds arrays
    if (a.type === 'task' && b.type === 'task') {
      if (a.taskIds.length !== b.taskIds.length) return false;
      const sortedA = [...a.taskIds].sort();
      const sortedB = [...b.taskIds].sort();
      return sortedA.every((id, i) => id === sortedB[i]);
    }

    // For plan/persistent scope, type match is enough
    return true;
  }

  // Mixed types are never equal
  return false;
}

/**
 * Check if a scope matches a filter scope
 * More flexible than scopeEquals - supports partial matching for task scopes
 */
export function scopeMatches(entryScope: MemoryScope, filterScope: MemoryScope): boolean {
  // Exact match first
  if (scopeEquals(entryScope, filterScope)) return true;

  // Simple scopes must match exactly
  if (isSimpleScope(filterScope)) return false;

  // For task-aware filter, check if entry scope matches the type
  if (isTaskAwareScope(entryScope) && isTaskAwareScope(filterScope)) {
    return entryScope.type === filterScope.type;
  }

  return false;
}

// ============================================================================
// PRIORITY SYSTEM
// ============================================================================

/**
 * Priority determines eviction order (lower priority evicted first)
 *
 * - critical: Never evicted (pinned, or actively in use)
 * - high: Important data, evicted only when necessary
 * - normal: Default priority
 * - low: Candidate for eviction (stale data, completed task data)
 */
export type MemoryPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Priority values for comparison (higher = more important, less likely to evict)
 */
export const MEMORY_PRIORITY_VALUES: Record<MemoryPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// ============================================================================
// MEMORY TIER SYSTEM (Hierarchical Memory)
// ============================================================================

/**
 * Memory tier for hierarchical data management
 *
 * The tier system provides a structured approach to managing research/analysis data:
 * - raw: Original data, low priority, first to be evicted
 * - summary: Processed summaries, normal priority
 * - findings: Final conclusions/insights, high priority, kept longest
 *
 * Workflow: raw → summary → findings (data gets more refined, priority increases)
 */
export type MemoryTier = 'raw' | 'summary' | 'findings';

/**
 * Default priorities for each tier
 */
export const TIER_PRIORITIES: Record<MemoryTier, MemoryPriority> = {
  raw: 'low',
  summary: 'normal',
  findings: 'high',
};

/**
 * Key prefixes for tiered data (used by helper methods)
 */
export const TIER_KEY_PREFIXES: Record<MemoryTier, string> = {
  raw: 'raw.',
  summary: 'summary.',
  findings: 'findings.',
};

/**
 * Hierarchy metadata for tracking data relationships
 */
export interface HierarchyMetadata {
  /** Memory tier (raw, summary, or findings) */
  tier: MemoryTier;
  /** Keys this entry was derived from (e.g., findings derived from summaries) */
  derivedFrom?: string[];
  /** Keys derived from this entry (e.g., summaries derived from raw data) */
  derivedTo?: string[];
}

/**
 * Check if a key has a tier prefix
 */
export function getTierFromKey(key: string): MemoryTier | undefined {
  if (key.startsWith(TIER_KEY_PREFIXES.raw)) return 'raw';
  if (key.startsWith(TIER_KEY_PREFIXES.summary)) return 'summary';
  if (key.startsWith(TIER_KEY_PREFIXES.findings)) return 'findings';
  return undefined;
}

/**
 * Strip tier prefix from key
 */
export function stripTierPrefix(key: string): string {
  const tier = getTierFromKey(key);
  if (!tier) return key;
  return key.substring(TIER_KEY_PREFIXES[tier].length);
}

/**
 * Add tier prefix to key (if not already present)
 */
export function addTierPrefix(key: string, tier: MemoryTier): string {
  const existingTier = getTierFromKey(key);
  if (existingTier) {
    // Already has a tier prefix - replace it
    const baseKey = stripTierPrefix(key);
    return TIER_KEY_PREFIXES[tier] + baseKey;
  }
  return TIER_KEY_PREFIXES[tier] + key;
}

// ============================================================================
// PRIORITY CALCULATOR (Strategy Pattern)
// ============================================================================

/**
 * Context passed to priority calculator - varies by agent type
 */
export interface PriorityContext {
  /** For TaskAgent: map of taskId → current status */
  taskStates?: Map<string, TaskStatusForMemory>;
  /** For UniversalAgent: current mode */
  mode?: 'interactive' | 'planning' | 'executing';
  /** Custom context for extensions */
  [key: string]: unknown;
}

/**
 * Task status values for priority calculation
 */
export type TaskStatusForMemory = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';

/**
 * Terminal statuses - task will not progress further
 */
export const TERMINAL_MEMORY_STATUSES: TaskStatusForMemory[] = ['completed', 'failed', 'skipped', 'cancelled'];

/**
 * Check if a task status is terminal (task will not progress further)
 */
export function isTerminalMemoryStatus(status: TaskStatusForMemory): boolean {
  return TERMINAL_MEMORY_STATUSES.includes(status);
}

/**
 * Priority calculator function type.
 * Given an entry and optional context, returns the effective priority.
 */
export type PriorityCalculator = (
  entry: MemoryEntry,
  context?: PriorityContext
) => MemoryPriority;

/**
 * Default: Static priority calculator
 * Returns the priority stored in the entry (or 'normal' if not set)
 */
export const staticPriorityCalculator: PriorityCalculator = (entry) => {
  if (entry.pinned) return 'critical';
  return entry.basePriority;
};

/**
 * Task-aware priority calculator
 * Computes priority dynamically based on task states
 */
export const taskAwarePriorityCalculator: PriorityCalculator = (entry, context) => {
  // Pinned entries are always critical
  if (entry.pinned) return 'critical';

  const scope = entry.scope;

  // Simple scope: use static priority
  if (isSimpleScope(scope)) {
    if (scope === 'persistent') return 'high';
    return entry.basePriority; // 'session' uses base priority
  }

  // Task-aware scope: compute from task states
  const taskStates = context?.taskStates;
  if (!taskStates) {
    // No task context provided, fall back to base priority
    return entry.basePriority;
  }

  // Persistent scope = high priority
  if (scope.type === 'persistent') return 'high';

  // Plan scope = normal priority
  if (scope.type === 'plan') return 'normal';

  // Task scope = depends on task states
  const taskIds = scope.taskIds;
  if (taskIds.length === 0) {
    // Empty taskIds array means no tasks need this data - treat as low priority
    // This is a valid but unusual case, typically a mistake
    return 'low';
  }

  let hasActiveTask = false;
  let hasPendingTask = false;
  let allTerminal = true;

  for (const taskId of taskIds) {
    const status = taskStates.get(taskId);
    if (!status) continue;

    if (status === 'in_progress') {
      hasActiveTask = true;
      allTerminal = false;
    } else if (status === 'pending') {
      hasPendingTask = true;
      allTerminal = false;
    }
  }

  if (hasActiveTask) return 'critical';
  if (hasPendingTask) return 'high';
  if (allTerminal) return 'low';

  return 'normal';
};

// ============================================================================
// STALE ENTRY DETECTION
// ============================================================================

/**
 * Reason why an entry became stale
 */
export type StaleReason =
  | 'task_completed'      // All dependent tasks completed
  | 'task_failed'         // Dependent task failed
  | 'unused'              // Not accessed for a long time
  | 'scope_cleared';      // Scope (e.g., session) was cleared

/**
 * Information about a stale entry for LLM notification
 */
export interface StaleEntryInfo {
  key: string;
  description: string;
  reason: StaleReason;
  previousPriority: MemoryPriority;
  newPriority: MemoryPriority;
  taskIds?: string[];     // Which tasks completed (if task_completed)
}

/**
 * Detect entries that became stale after task completion
 */
export function detectStaleEntries(
  entries: MemoryEntry[],
  completedTaskId: string,
  taskStates: Map<string, TaskStatusForMemory>
): StaleEntryInfo[] {
  const stale: StaleEntryInfo[] = [];

  for (const entry of entries) {
    if (entry.pinned) continue; // Pinned entries never stale

    const scope = entry.scope;
    if (!isTaskAwareScope(scope) || scope.type !== 'task') continue;

    // Check if this entry was scoped to the completed task
    if (!scope.taskIds.includes(completedTaskId)) continue;

    // Check if ALL tasks for this entry are now terminal
    const allTerminal = scope.taskIds.every((taskId) => {
      const status = taskStates.get(taskId);
      return status ? isTerminalMemoryStatus(status) : false;
    });

    if (allTerminal) {
      stale.push({
        key: entry.key,
        description: entry.description,
        reason: 'task_completed',
        previousPriority: entry.basePriority,
        newPriority: 'low',
        taskIds: scope.taskIds,
      });
    }
  }

  return stale;
}

/**
 * Single memory entry stored in working memory
 */
export interface MemoryEntry {
  key: string;                    // Namespaced key: "user.profile"
  description: string;            // Short description for index (max descriptionMaxLength, default 500)
  value: unknown;                 // The actual data
  sizeBytes: number;              // Computed size for tracking
  scope: MemoryScope;             // Lifecycle scope (simple or task-aware)
  basePriority: MemoryPriority;   // Base priority (actual priority may be computed dynamically)
  pinned: boolean;                // If true, never evicted
  createdAt: number;              // Unix timestamp
  lastAccessedAt: number;
  accessCount: number;
}

/**
 * Index entry (lightweight, always in context)
 */
export interface MemoryIndexEntry {
  key: string;
  description: string;
  size: string;                   // Human readable: "4.2KB"
  scope: MemoryScope;
  effectivePriority: MemoryPriority;  // Computed priority for display
  pinned: boolean;
}

/**
 * Full memory index with metadata
 */
export interface MemoryIndex {
  entries: MemoryIndexEntry[];
  totalSizeBytes: number;
  totalSizeHuman: string;         // "42KB"
  limitBytes: number;
  limitHuman: string;             // "1MB"
  utilizationPercent: number;
  /** Total entry count (before any truncation for display) */
  totalEntryCount: number;
  /** Number of entries omitted from display due to maxIndexEntries limit */
  omittedCount: number;
}

/**
 * Configuration for working memory
 */
export interface WorkingMemoryConfig {
  /** Max memory size in bytes. If not set, calculated from model context */
  maxSizeBytes?: number;

  /** Max number of entries in the memory index. Excess entries are auto-evicted via LRU. Default: 30 */
  maxIndexEntries?: number;

  /** Max description length */
  descriptionMaxLength: number;

  /** Percentage at which to warn agent */
  softLimitPercent: number;

  /** Percentage of model context to allocate to memory */
  contextAllocationPercent: number;
}

/**
 * Input for creating a memory entry
 */
export interface MemoryEntryInput {
  key: string;
  description: string;
  value: unknown;
  /** Scope - defaults to 'session' for basic agents */
  scope?: MemoryScope;
  /** Base priority - may be overridden by dynamic calculation */
  priority?: MemoryPriority;
  /** If true, entry is never evicted */
  pinned?: boolean;
}

/**
 * Shorthand for task-scoped entry
 */
export interface TaskScopedEntryInput extends Omit<MemoryEntryInput, 'scope'> {
  /** Task IDs that need this data */
  neededForTasks: string[];
}

/**
 * Create a task-scoped memory entry input
 */
export function forTasks(
  key: string,
  description: string,
  value: unknown,
  taskIds: string[],
  options?: { priority?: MemoryPriority; pinned?: boolean }
): MemoryEntryInput {
  return {
    key,
    description,
    value,
    scope: { type: 'task', taskIds },
    priority: options?.priority,
    pinned: options?.pinned,
  };
}

/**
 * Create a plan-scoped memory entry input
 */
export function forPlan(
  key: string,
  description: string,
  value: unknown,
  options?: { priority?: MemoryPriority; pinned?: boolean }
): MemoryEntryInput {
  return {
    key,
    description,
    value,
    scope: { type: 'plan' },
    priority: options?.priority,
    pinned: options?.pinned,
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_MEMORY_CONFIG: WorkingMemoryConfig = {
  maxSizeBytes: 25 * 1024 * 1024, // 25MB default
  maxIndexEntries: 30, // Limit index entries to prevent context bloat
  descriptionMaxLength: 500,
  softLimitPercent: 80,
  contextAllocationPercent: 20,
};

/**
 * Validate memory key format
 * Valid: "simple", "user.profile", "order.items.123"
 * Invalid: "", ".invalid", "invalid.", "with spaces"
 */
export function validateMemoryKey(key: string): void {
  if (!key || key.length === 0) {
    throw new Error('Memory key cannot be empty');
  }

  // Check for invalid patterns
  if (key.startsWith('.') || key.endsWith('.') || key.includes('..')) {
    throw new Error('Invalid memory key format: keys cannot start/end with dots or contain consecutive dots');
  }

  // Check for invalid characters (only alphanumeric, dots, dashes, underscores)
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error('Invalid memory key format: only alphanumeric, dots, dashes, and underscores allowed');
  }
}

/**
 * Calculate the size of a value in bytes (JSON serialization)
 * Uses Buffer.byteLength for accurate UTF-8 byte count
 */
export function calculateEntrySize(value: unknown): number {
  if (value === undefined) {
    return 0;
  }

  const serialized = JSON.stringify(value);
  // Use Buffer.byteLength for accurate UTF-8 byte count
  // This handles multi-byte characters correctly (e.g., '中文'.length = 2, but byte length = 6)
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(serialized, 'utf8');
  }
  // Fallback for environments without Buffer (browser)
  return new Blob([serialized]).size;
}

/**
 * Create a memory entry with defaults and validation
 */
export function createMemoryEntry(
  input: MemoryEntryInput,
  config: WorkingMemoryConfig = DEFAULT_MEMORY_CONFIG
): MemoryEntry {
  // Validate key
  validateMemoryKey(input.key);

  // Validate description length
  if (input.description.length > config.descriptionMaxLength) {
    throw new Error(`Description exceeds maximum length of ${config.descriptionMaxLength} characters`);
  }

  // Validate task-aware scope
  if (input.scope && isTaskAwareScope(input.scope) && input.scope.type === 'task') {
    if (input.scope.taskIds.length === 0) {
      // This is valid but unusual - typically indicates a mistake
      // We allow it but the entry will have low priority
      console.warn(`Memory entry "${input.key}" has empty taskIds array - will have low priority`);
    }
  }

  const now = Date.now();
  const sizeBytes = calculateEntrySize(input.value);

  // If pinned, automatically set priority to critical
  const pinned = input.pinned ?? false;
  const priority = pinned ? 'critical' : (input.priority ?? 'normal');

  return {
    key: input.key,
    description: input.description,
    value: input.value,
    sizeBytes,
    scope: input.scope ?? 'session',
    basePriority: priority,
    pinned,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
  };
}

/**
 * Format bytes to human-readable string
 */
export function formatSizeHuman(bytes: number): string {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;

  const kb = bytes / 1024;
  if (bytes < 1024 * 1024) {
    // Show 1 decimal place, but remove .0
    return `${kb.toFixed(1).replace(/\.0$/, '')}KB`;
  }

  const mb = bytes / (1024 * 1024);
  if (bytes < 1024 * 1024 * 1024) {
    return `${mb.toFixed(1).replace(/\.0$/, '')}MB`;
  }

  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1).replace(/\.0$/, '')}GB`;
}

/**
 * Format scope for display
 */
function formatScope(scope: MemoryScope): string {
  if (isSimpleScope(scope)) {
    return scope;
  }
  // Task-aware scope
  if (scope.type === 'task') {
    return `task:${scope.taskIds.join(',')}`;
  }
  return scope.type;
}

/**
 * Format entry flags for display
 */
function formatEntryFlags(entry: MemoryIndexEntry): string {
  const flags: string[] = [];

  if (entry.pinned) {
    flags.push('pinned');
  } else if (entry.effectivePriority !== 'normal') {
    flags.push(entry.effectivePriority);
  }

  flags.push(formatScope(entry.scope));

  return flags.join(', ');
}

/**
 * Format memory index for context injection
 * @param storeId Unified store ID when used by store_* tools. Omit to retain
 * legacy WorkingMemory tool guidance.
 */
export function formatMemoryIndex(index: MemoryIndex, storeId?: string): string {
  const lines: string[] = [];
  const store = storeId === undefined ? undefined : JSON.stringify(storeId);

  // Format utilization percent without unnecessary decimals
  const utilPercent = Number.isInteger(index.utilizationPercent)
    ? index.utilizationPercent.toString()
    : index.utilizationPercent.toFixed(1).replace(/\.0$/, '');

  lines.push(`## Working Memory (${index.totalSizeHuman} / ${index.limitHuman} - ${utilPercent}%)`);
  lines.push('');

  if (index.entries.length === 0) {
    lines.push('Memory is empty.');
  } else {
    // Group by priority first, then scope
    const pinned = index.entries.filter((e) => e.pinned);
    const critical = index.entries.filter((e) => !e.pinned && e.effectivePriority === 'critical');
    const high = index.entries.filter((e) => !e.pinned && e.effectivePriority === 'high');
    const normal = index.entries.filter((e) => !e.pinned && e.effectivePriority === 'normal');
    const low = index.entries.filter((e) => !e.pinned && e.effectivePriority === 'low');

    if (pinned.length > 0) {
      lines.push('**Pinned (never evicted):**');
      for (const entry of pinned) {
        lines.push(`- \`${entry.key}\` (${entry.size}): ${entry.description} [${formatEntryFlags(entry)}]`);
      }
      lines.push('');
    }

    if (critical.length > 0) {
      lines.push('**Critical priority:**');
      for (const entry of critical) {
        lines.push(`- \`${entry.key}\` (${entry.size}): ${entry.description} [${formatEntryFlags(entry)}]`);
      }
      lines.push('');
    }

    if (high.length > 0) {
      lines.push('**High priority:**');
      for (const entry of high) {
        lines.push(`- \`${entry.key}\` (${entry.size}): ${entry.description} [${formatEntryFlags(entry)}]`);
      }
      lines.push('');
    }

    if (normal.length > 0) {
      lines.push('**Normal priority:**');
      for (const entry of normal) {
        lines.push(`- \`${entry.key}\` (${entry.size}): ${entry.description} [${formatEntryFlags(entry)}]`);
      }
      lines.push('');
    }

    if (low.length > 0) {
      lines.push('**Low priority (evicted first):**');
      for (const entry of low) {
        lines.push(`- \`${entry.key}\` (${entry.size}): ${entry.description} [${formatEntryFlags(entry)}]`);
      }
      lines.push('');
    }

    // Add warning if utilization is high
    if (index.utilizationPercent > 80) {
      lines.push('Warning: Memory utilization is high. Consider deleting unused entries.');
      lines.push('');
    }

    // Show omitted entries notice
    if (index.omittedCount > 0) {
      const listCall = store === undefined ? 'memory_query()' : `store_list({ store: ${store} })`;
      lines.push(`*${index.omittedCount} additional low-priority entries not shown. Use \`${listCall}\` to see all.*`);
      lines.push('');
    }
  }

  if (store === undefined) {
    lines.push('Use `memory_retrieve("key")` to load full content.');
    lines.push('Use `memory_persist("key")` to keep data after task completion.');
  } else {
    lines.push(`Index metadata only. Use \`store_get({ store: ${store}, key: "<exact index key>" })\` for each entry's full content.`);
  }

  return lines.join('\n');
}
