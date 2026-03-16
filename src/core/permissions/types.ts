/**
 * Tool Permission Types
 *
 * Defines permission scopes, risk levels, and approval state for tool execution control.
 *
 * Works with ALL agent types:
 * - Agent (basic)
 * - TaskAgent (task-based)
 * - UniversalAgent (mode-fluid)
 */

import type { ToolCall } from '../../domain/entities/Tool.js';

// ============================================================================
// Permission Scopes
// ============================================================================

/**
 * Permission scope defines when approval is required for a tool
 *
 * - `once` - Require approval for each tool call (most restrictive)
 * - `session` - Approve once, valid for entire session
 * - `always` - Auto-approve (allowlisted, no prompts)
 * - `never` - Always blocked (blocklisted, tool cannot execute)
 */
export type PermissionScope = 'once' | 'session' | 'always' | 'never';

/**
 * Risk level classification for tools
 *
 * Used to help users understand the potential impact of approving a tool.
 * Can be used by UI to show different approval dialogs.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ============================================================================
// Tool Permission Configuration
// ============================================================================

/**
 * Permission configuration for a tool
 *
 * Can be set on the tool definition or overridden at registration time.
 */
export interface ToolPermissionConfig {
  /**
   * When approval is required.
   * @default 'once'
   */
  scope?: PermissionScope;

  /**
   * Risk classification for the tool.
   * @default 'low'
   */
  riskLevel?: RiskLevel;

  /**
   * Custom message shown in approval UI.
   * Should explain what the tool does and any potential risks.
   */
  approvalMessage?: string;

  /**
   * Argument names that should be highlighted in approval UI.
   * E.g., ['path', 'url'] for file/network operations.
   */
  sensitiveArgs?: string[];

  /**
   * Optional expiration time for session approvals (milliseconds).
   * If set, session approvals expire after this duration.
   */
  sessionTTLMs?: number;
}

// ============================================================================
// Permission Check Context (passed to approval hooks)
// ============================================================================

/**
 * Context passed to approval callbacks/hooks
 */
export interface PermissionCheckContext {
  /** The tool call being checked */
  toolCall: ToolCall;

  /** Parsed arguments (for display/inspection) */
  parsedArgs: Record<string, unknown>;

  /** The tool's permission config */
  config: ToolPermissionConfig;

  /** Current execution context ID */
  executionId: string;

  /** Current iteration (if in agentic loop) */
  iteration: number;

  /** Agent type (for context-specific handling) */
  agentType: 'agent' | 'task-agent' | 'universal-agent';

  /** Optional task name (for TaskAgent/UniversalAgent) */
  taskName?: string;
}

// ============================================================================
// Approval State (Runtime)
// ============================================================================

/**
 * Entry in the approval cache representing an approved tool
 */
export interface ApprovalCacheEntry {
  /** Name of the approved tool */
  toolName: string;

  /** The scope that was approved */
  scope: PermissionScope;

  /** When the approval was granted */
  approvedAt: Date;

  /** Optional identifier of who approved (for audit) */
  approvedBy?: string;

  /** When this approval expires (for session/TTL approvals) */
  expiresAt?: Date;

  /** Arguments hash if approval was for specific arguments */
  argsHash?: string;
}

/**
 * Serialized approval state for session persistence
 */
export interface SerializedApprovalState {
  /** Version for future migrations */
  version: number;

  /** Map of tool name to approval entry */
  approvals: Record<string, SerializedApprovalEntry>;

  /** Tools that are always blocked (persisted blocklist) */
  blocklist: string[];

  /** Tools that are always allowed (persisted allowlist) */
  allowlist: string[];
}

/**
 * Serialized version of ApprovalCacheEntry (with ISO date strings)
 */
export interface SerializedApprovalEntry {
  toolName: string;
  scope: PermissionScope;
  approvedAt: string; // ISO date string
  approvedBy?: string;
  expiresAt?: string; // ISO date string
  argsHash?: string;
}

// ============================================================================
// Permission Check Results
// ============================================================================

/**
 * Result of checking if a tool needs approval
 */
export interface PermissionCheckResult {
  /** Whether the tool can execute without prompting */
  allowed: boolean;

  /** Whether approval is needed (user should be prompted) */
  needsApproval: boolean;

  /** Whether the tool is blocked (cannot execute at all) */
  blocked: boolean;

  /** Reason for the decision */
  reason: string;

  /** The tool's permission config (for UI display) */
  config?: ToolPermissionConfig;
}

/**
 * Result from approval UI/hook
 */
export interface ApprovalDecision {
  /** Whether the tool was approved */
  approved: boolean;

  /** Scope of the approval (may differ from requested) */
  scope?: PermissionScope;

  /** Reason for denial (if not approved) */
  reason?: string;

  /** Optional identifier of who approved */
  approvedBy?: string;

  /** Whether to remember this decision for future calls */
  remember?: boolean;

  /**
   * If set, creates a persistent user permission rule from this decision.
   * The approval UI can pre-populate this based on the tool call context.
   */
  createRule?: {
    /** Rule description (shown in settings UI) */
    description?: string;
    /** Argument conditions for the rule */
    conditions?: ArgumentCondition[];
    /** ISO expiry timestamp (null = never) */
    expiresAt?: string | null;
    /** If true, rule cannot be overridden by more specific rules */
    unconditional?: boolean;
  };
}

// ============================================================================
// Agent Configuration (works with ALL agent types)
// ============================================================================

/**
 * Permission configuration for any agent type.
 *
 * Used in:
 * - Agent.create({ permissions: {...} })
 * - TaskAgent.create({ permissions: {...} })
 * - UniversalAgent.create({ permissions: {...} })
 */
export interface AgentPermissionsConfig {
  /**
   * Default permission scope for tools without explicit config.
   * @default 'once'
   */
  defaultScope?: PermissionScope;

  /**
   * Default risk level for tools without explicit config.
   * @default 'low'
   */
  defaultRiskLevel?: RiskLevel;

  /**
   * Tools that are always allowed (never prompt).
   * Array of tool names.
   */
  allowlist?: string[];

  /**
   * Tools that are always blocked (cannot execute).
   * Array of tool names.
   */
  blocklist?: string[];

  /**
   * Per-tool permission overrides.
   * Keys are tool names, values are permission configs.
   */
  tools?: Record<string, ToolPermissionConfig>;

  /**
   * Callback invoked when a tool needs approval.
   * Receives full ApprovalRequestContext with tool info, risk level, args.
   * Return an ApprovalDecision to approve/deny.
   */
  onApprovalRequired?: (context: ApprovalRequestContext) => Promise<ApprovalDecision>;

  /**
   * Whether to inherit permission state from parent session.
   * Only applies when resuming from a session.
   * @default true
   */
  inheritFromSession?: boolean;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Events emitted by ToolPermissionManager
 */
export type PermissionManagerEvent =
  | 'tool:approved'
  | 'tool:denied'
  | 'tool:blocked'
  | 'tool:revoked'
  | 'allowlist:added'
  | 'allowlist:removed'
  | 'blocklist:added'
  | 'blocklist:removed'
  | 'session:cleared';

// ============================================================================
// Constants
// ============================================================================

/**
 * Current version of serialized approval state
 */
export const APPROVAL_STATE_VERSION = 1;

/**
 * Default permission config applied when no config is specified
 */
export const DEFAULT_PERMISSION_CONFIG: Required<Pick<ToolPermissionConfig, 'scope' | 'riskLevel'>> = {
  scope: 'once',
  riskLevel: 'low',
};

/**
 * Default allowlist - tools that never require user confirmation.
 *
 * These tools are safe to execute without user approval:
 * - Read-only operations (filesystem reads, searches)
 * - Internal state management (memory tools)
 * - Introspection tools (context stats)
 * - In-context memory tools
 * - Persistent instructions tools
 * - Meta-tools for agent coordination
 *
 * All other tools (write operations, shell commands, external requests)
 * require explicit user approval by default.
 */
export const DEFAULT_ALLOWLIST: readonly string[] = [
  // Filesystem read-only tools
  'read_file',
  'glob',
  'grep',
  'list_directory',

  // Unified store tools (CRUD for all IStoreHandler plugins)
  'store_get',
  'store_set',
  'store_delete',
  'store_list',
  'store_action',

  // Context introspection (unified tool)
  'context_stats',

  // TODO tools (user-specific data - safe)
  'todo_add',
  'todo_update',
  'todo_remove',

  // Tool catalog tools (browsing and loading — safe)
  'tool_catalog_search',
  'tool_catalog_load',
  'tool_catalog_unload',

  // Meta-tools (internal coordination)
  '_start_planning',
  '_modify_plan',
  '_report_progress',
  '_request_approval', // CRITICAL: Must be allowlisted to avoid circular dependency!
] as const;

/**
 * Type for default allowlisted tools
 */
export type DefaultAllowlistedTool = (typeof DEFAULT_ALLOWLIST)[number];

// ============================================================================
// Policy System Types (v2)
// ============================================================================

/**
 * Policy verdict for a tool execution check.
 *
 * - `allow` - Explicitly permit execution (but later policies can still deny)
 * - `deny` - Block execution immediately (short-circuits)
 * - `abstain` - No opinion, defer to other policies
 */
export type PolicyVerdict = 'allow' | 'deny' | 'abstain';

/**
 * Decision returned by a permission policy.
 */
export interface PolicyDecision {
  /** The verdict */
  verdict: PolicyVerdict;

  /** Human-readable reason for the decision */
  reason: string;

  /** Name of the policy that made this decision */
  policyName: string;

  /** Optional metadata for downstream processing */
  metadata?: {
    /** If true, this deny can be overridden by user approval */
    needsApproval?: boolean;
    /** Scoped cache key for argument-aware approval (e.g., "write_file:/workspace/**") */
    approvalKey?: string;
    /** How long this approval should be cached */
    approvalScope?: 'once' | 'session' | 'persistent';
    /** Additional policy-specific data */
    [key: string]: unknown;
  };
}

/**
 * Rich context passed to policies for evaluation.
 *
 * Contains tool identity, arguments, user identity, and tool registration metadata.
 */
export interface PolicyContext {
  /** Tool being invoked */
  toolName: string;

  /** Parsed arguments for the tool call */
  args: Record<string, unknown>;

  /** User identity (from ToolContext.userId) */
  userId?: string;

  /** User roles (from agent config userRoles) */
  roles?: string[];

  /** Agent ID */
  agentId?: string;

  /** Parent agent ID (for orchestrator workers) */
  parentAgentId?: string;

  /** Session ID */
  sessionId?: string;

  /** Execution iteration in agentic loop */
  iteration?: number;

  /** Execution ID for tracing */
  executionId?: string;

  // --- Tool registration metadata (from ToolManager registry) ---

  /** Source identifier (built-in, connector:xxx, mcp, custom) */
  toolSource?: string;

  /** Category grouping (filesystem, web, shell, etc.) */
  toolCategory?: string;

  /** Registration namespace */
  toolNamespace?: string;

  /** Registration tags */
  toolTags?: string[];

  /**
   * Merged permission config from tool definition + registration override.
   * This is the tool author's declaration of risk/scope, possibly overridden
   * by the application developer at registration time.
   */
  toolPermissionConfig?: ToolPermissionConfig;
}

/**
 * A composable permission policy that evaluates tool execution requests.
 *
 * Policies return:
 * - `allow` to explicitly permit (does NOT short-circuit — later policies can still deny)
 * - `deny` to block immediately (short-circuits the chain)
 * - `abstain` to defer to other policies
 *
 * Tool authors declare defaults via `ToolFunction.permission`. App developers
 * can override at registration time. Policies read the merged result from
 * `PolicyContext.toolPermissionConfig`.
 */
export interface IPermissionPolicy {
  /** Unique policy name */
  readonly name: string;

  /** Priority — lower runs first. Default: 100 */
  readonly priority?: number;

  /** Human-readable description for display/audit */
  readonly description?: string;

  /**
   * Evaluate the policy for a given tool call.
   * May be sync or async.
   */
  evaluate(context: PolicyContext): Promise<PolicyDecision> | PolicyDecision;
}

/**
 * Configuration for the PolicyChain evaluator.
 */
export interface PolicyChainConfig {
  /**
   * What happens when all policies abstain.
   * @default 'deny'
   */
  defaultVerdict?: 'allow' | 'deny';
}

/**
 * Rich result from PermissionPolicyManager.check()
 */
export interface PolicyCheckResult {
  /** Whether the tool is allowed to execute */
  allowed: boolean;

  /** Whether the tool is hard-blocked (no approval possible) */
  blocked: boolean;

  /** Human-readable reason */
  reason: string;

  /** Policy that made the deciding verdict */
  policyName?: string;

  /** Whether user approval was requested (and possibly granted) */
  approvalRequired?: boolean;

  /** Argument-scoped approval key */
  approvalKey?: string;

  /** Approval scope that was applied */
  approvalScope?: 'once' | 'session' | 'persistent';

  /** ID of audit entry written (if audit storage configured) */
  auditEntryId?: string;

  /** Additional metadata from the deciding policy */
  metadata?: Record<string, unknown>;
}

/**
 * Context passed to the onApprovalRequired callback.
 * Extends PolicyContext with the deny decision and UI-relevant info.
 */
export interface ApprovalRequestContext extends PolicyContext {
  /** The deny decision that triggered this approval request */
  decision: PolicyDecision;

  /** Tool's risk level (from tool permission config or default) */
  riskLevel: RiskLevel;

  /** Custom approval message (from tool permission config) */
  approvalMessage?: string;

  /** Argument names to highlight as sensitive in approval UI */
  sensitiveArgs?: string[];

  /** Policy-provided approval scope key */
  approvalKey?: string;

  /** Suggested approval scope */
  approvalScope?: 'once' | 'session' | 'persistent';
}

/**
 * Extended agent permissions config with policy support.
 */
export interface AgentPolicyConfig extends AgentPermissionsConfig {
  /**
   * Custom policies (evaluated after legacy-derived policies).
   * Policies from tool self-declarations and registration overrides
   * are handled automatically via SessionApprovalPolicy reading
   * PolicyContext.toolPermissionConfig.
   */
  policies?: IPermissionPolicy[];

  /** Policy chain configuration */
  policyChain?: PolicyChainConfig;

  /** Per-user permission rules storage */
  userRulesStorage?: import('../../domain/interfaces/IUserPermissionRulesStorage.js').IUserPermissionRulesStorage;
}

/**
 * Serialized policy state for session persistence.
 */
export interface SerializedPolicyState {
  /** Version for future migrations */
  version: number;

  /** Approval cache entries keyed by approval key */
  approvals: Record<string, SerializedApprovalEntry>;

  /** Blocklisted tool names */
  blocklist: string[];

  /** Allowlisted tool names */
  allowlist: string[];
}

/**
 * Policy state version for migration support.
 */
export const POLICY_STATE_VERSION = 1;

/**
 * Audit entry for permission decisions.
 */
export interface PermissionAuditEntry {
  /** Unique entry ID */
  id: string;

  /** ISO timestamp */
  timestamp: string;

  /** Tool that was checked */
  toolName: string;

  /** Policy evaluation result */
  decision: 'allow' | 'deny';

  /** Final execution outcome */
  finalOutcome: 'executed' | 'blocked' | 'approval_granted' | 'approval_denied';

  /** Human-readable reason */
  reason: string;

  /** Policy that made the deciding verdict */
  policyName?: string;

  /** User who triggered the check */
  userId?: string;

  /** Agent that triggered the check */
  agentId?: string;

  /** Redacted arguments (sensitive values replaced) */
  args?: Record<string, unknown>;

  /** Execution ID for correlation */
  executionId?: string;

  /** Whether approval was required */
  approvalRequired?: boolean;

  /** Approval key used */
  approvalKey?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Stored policy definition for persistence.
 */
export interface StoredPolicyDefinition {
  /** Policy name */
  name: string;

  /** Policy type identifier (maps to IPermissionPolicyFactory) */
  type: string;

  /** Policy-specific configuration */
  config: Record<string, unknown>;

  /** Whether the policy is active */
  enabled: boolean;

  /** Evaluation priority (lower = first) */
  priority?: number;

  /** ISO timestamp */
  createdAt: string;

  /** ISO timestamp */
  updatedAt: string;
}

/**
 * Factory for creating policy instances from stored definitions.
 */
export interface IPermissionPolicyFactory {
  /** Policy type identifier (matches StoredPolicyDefinition.type) */
  readonly type: string;

  /** Create a policy instance from a stored definition */
  create(definition: StoredPolicyDefinition): IPermissionPolicy;
}

// ============================================================================
// User Permission Rules (per-user, persistent, highest priority)
// ============================================================================

/**
 * Comparison operator for argument conditions.
 */
export type ConditionOperator =
  | 'starts_with'
  | 'not_starts_with'
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'matches'       // regex
  | 'not_matches';  // regex negation

/**
 * A condition that inspects a tool argument value.
 *
 * Multiple conditions on a rule use AND logic — all must match.
 *
 * Use `__toolCategory`, `__toolSource`, `__toolNamespace` as argName
 * to match against tool registration metadata instead of call arguments.
 */
export interface ArgumentCondition {
  /** Argument name to inspect (e.g., 'command', 'path', 'url') */
  argName: string;

  /** Comparison operator */
  operator: ConditionOperator;

  /** Value to compare against. For 'matches'/'not_matches', this is a regex string. */
  value: string;

  /** Case-insensitive comparison. @default true */
  ignoreCase?: boolean;
}

/**
 * A persistent, per-user permission rule.
 *
 * User rules have the HIGHEST priority — they override ALL built-in policies.
 * Resolution uses specificity (conditions > no conditions), not numeric priorities.
 */
export interface UserPermissionRule {
  /** Unique rule ID (UUID) */
  id: string;

  /** Tool name this rule applies to. '*' for all tools. */
  toolName: string;

  /** What to do when this rule matches */
  action: 'allow' | 'deny' | 'ask';

  /**
   * Argument conditions (optional).
   * ALL conditions must match (AND logic).
   * If empty/omitted, rule applies to ALL calls of this tool (blanket rule).
   */
  conditions?: ArgumentCondition[];

  /**
   * If true, this rule is absolute — more specific rules CANNOT override it.
   * "Allow bash unconditionally" means even a "bash + rm -rf → ask" rule is ignored.
   * @default false
   */
  unconditional?: boolean;

  /** Whether this rule is active */
  enabled: boolean;

  /** Human-readable description (shown in UI) */
  description?: string;

  /** How this rule was created */
  createdBy: 'user' | 'approval_dialog' | 'admin' | 'system';

  /** ISO timestamp */
  createdAt: string;

  /** ISO timestamp */
  updatedAt: string;

  /** Optional expiry (ISO timestamp). Null/undefined = never expires. */
  expiresAt?: string | null;
}

/**
 * Result from evaluating user rules against a tool call.
 */
export interface UserRuleEvalResult {
  /** What to do */
  action: 'allow' | 'deny' | 'ask';

  /** The rule that matched */
  rule: UserPermissionRule;

  /** Human-readable reason */
  reason: string;
}
