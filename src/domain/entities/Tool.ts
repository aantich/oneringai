/**
 * Tool entities with blocking/non-blocking execution support
 */

// Import the canonical ToolContext from IToolContext.ts (single source of truth)
import type { ToolContext } from '../interfaces/IToolContext.js';

// Re-export for backward compatibility
export type { ToolContext };

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: JSONSchema;
    strict?: boolean; // Enforce schema strictly
  };
  blocking?: boolean; // Default: true (wait for result before continuing)
  timeout?: number; // Timeout in ms (default: 30000)
}

export interface BuiltInTool {
  type: 'web_search' | 'file_search' | 'computer_use' | 'code_interpreter';
  blocking?: boolean;
}

export type Tool = FunctionToolDefinition | BuiltInTool;

export enum ToolCallState {
  PENDING = 'pending', // Tool call identified, not yet executed
  EXECUTING = 'executing', // Currently executing
  COMPLETED = 'completed', // Successfully completed
  FAILED = 'failed', // Execution failed
  TIMEOUT = 'timeout', // Execution timed out
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
  blocking: boolean; // Copied from tool definition
  state: ToolCallState;
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

export interface ToolResult {
  tool_use_id: string;
  tool_name?: string; // Name of the tool that was executed (for eviction tracking)
  tool_args?: Record<string, unknown>; // Arguments passed to the tool (for description generation)
  content: any;
  error?: string;
  executionTime?: number; // ms
  state: ToolCallState;
}

/**
 * Tool execution context - tracks all tool calls in a generation
 */
export interface ToolExecutionContext {
  executionId: string; // Unique ID for this LLM generation
  toolCalls: Map<string, ToolCall>; // tool_use_id → ToolCall
  pendingNonBlocking: Set<string>; // IDs of pending non-blocking calls
  completedResults: Map<string, ToolResult>; // tool_use_id → ToolResult
}

/**
 * Configuration for async (non-blocking) tool behavior
 */
export interface AsyncToolConfig {
  /**
   * If true, the agent automatically re-enters the agentic loop
   * when async tool results arrive. If false, results are queued
   * and the caller must call `continueWithAsyncResults()` manually.
   * @default true
   */
  autoContinue?: boolean;

  /**
   * Window in ms to batch multiple async results before triggering
   * a continuation. If multiple async tools complete within this window,
   * their results are delivered together in a single user message.
   * @default 500
   */
  batchWindowMs?: number;

  /**
   * Timeout in ms for async tool execution. If a tool doesn't complete
   * within this window, it's treated as a timeout error.
   * @default 300000 (5 minutes)
   */
  asyncTimeout?: number;
}

/**
 * Status of a pending async tool execution
 */
export type PendingAsyncToolStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';

/**
 * Tracks a single async tool execution in flight
 */
export interface PendingAsyncTool {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  startTime: number;
  status: PendingAsyncToolStatus;
  result?: ToolResult;
  error?: Error;
}

// ToolContext is imported from IToolContext.ts and re-exported above
// This eliminates the duplicate definition and ensures type consistency

/**
 * Output handling hints for context management
 */
export interface ToolOutputHints {
  expectedSize?: 'small' | 'medium' | 'large' | 'variable';
  summarize?: (output: unknown) => string;
}

/**
 * Idempotency configuration for tool caching
 */
export interface ToolIdempotency {
  /**
   * @deprecated Use 'cacheable' instead. Will be removed in a future version.
   * If true, tool is naturally idempotent (e.g., read-only) and doesn't need caching.
   * If false, tool results should be cached based on arguments.
   */
  safe?: boolean;

  /**
   * If true, tool results can be cached based on arguments.
   * Use this for tools that return deterministic results for the same inputs.
   * Takes precedence over the deprecated 'safe' field.
   * @default false
   */
  cacheable?: boolean;

  keyFn?: (args: Record<string, unknown>) => string;
  ttlMs?: number;
}

/**
 * Permission configuration for a tool
 *
 * Controls when approval is required for tool execution.
 * Used by the ToolPermissionManager.
 */
export interface ToolPermissionConfig {
  /**
   * When approval is required.
   * - 'once' - Require approval for each call
   * - 'session' - Approve once per session
   * - 'always' - Auto-approve (no prompts)
   * - 'never' - Always blocked
   * @default 'once'
   */
  scope?: 'once' | 'session' | 'always' | 'never';

  /**
   * Risk level classification.
   * @default 'low'
   */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Custom message shown in approval UI.
   */
  approvalMessage?: string;

  /**
   * Argument names that should be highlighted as sensitive.
   */
  sensitiveArgs?: string[];

  /**
   * TTL for session approvals (milliseconds).
   */
  sessionTTLMs?: number;
}

/**
 * User-provided tool function
 */
export interface ToolFunction<TArgs = any, TResult = any> {
  definition: FunctionToolDefinition;
  execute: (args: TArgs, context?: ToolContext) => Promise<TResult>;

  // Extended fields for TaskAgent (optional, backward compatible)
  idempotency?: ToolIdempotency;
  output?: ToolOutputHints;

  // Permission configuration (optional, backward compatible)
  /** Permission settings for this tool. If not set, defaults are used. */
  permission?: ToolPermissionConfig;

  /**
   * Dynamic description generator for the tool.
   * If provided, this function is called when tool definitions are serialized for the LLM,
   * allowing the description to reflect current state (e.g., available connectors).
   *
   * The returned string replaces definition.function.description when sending to LLM.
   * The static description in definition.function.description serves as a fallback.
   *
   * @param context - Current ToolContext (includes userId, agentId, etc.)
   * @returns The current tool description
   *
   * @example
   * // Tool with dynamic connector list scoped to current user:
   * descriptionFactory: (context) => {
   *   const connectors = getConnectorsForUser(context?.userId);
   *   return `Execute API calls. Available connectors: ${connectors.map(c => c.name).join(', ')}`;
   * }
   */
  descriptionFactory?: (context?: ToolContext) => string;

  /**
   * Returns a human-readable description of a tool call.
   * Used for logging, UI display, and debugging.
   *
   * @param args - The arguments passed to the tool
   * @returns A concise description (e.g., "reading /path/to/file.ts")
   *
   * If not implemented, use `defaultDescribeCall()` as a fallback.
   *
   * @example
   * // For read_file tool:
   * describeCall: (args) => args.file_path
   *
   * @example
   * // For bash tool:
   * describeCall: (args) => args.command.length > 50
   *   ? args.command.slice(0, 47) + '...'
   *   : args.command
   */
  describeCall?: (args: TArgs) => string;
}

/**
 * Default implementation for describeCall.
 * Shows the first meaningful argument value.
 *
 * @param args - Tool arguments object
 * @param maxLength - Maximum length before truncation (default: 60)
 * @returns Human-readable description
 *
 * @example
 * defaultDescribeCall({ file_path: '/path/to/file.ts' })
 * // Returns: '/path/to/file.ts'
 *
 * @example
 * defaultDescribeCall({ query: 'search term', limit: 10 })
 * // Returns: 'search term'
 */
export function defaultDescribeCall(
  args: Record<string, unknown>,
  maxLength = 60
): string {
  if (!args || typeof args !== 'object') {
    return '';
  }

  // Priority order for common argument names
  const priorityKeys = [
    'file_path', 'path', 'command', 'query', 'pattern', 'url',
    'key', 'name', 'message', 'content', 'expression', 'prompt',
  ];

  // Try priority keys first
  for (const key of priorityKeys) {
    if (key in args && args[key] != null) {
      const value = args[key];
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      return str.length > maxLength ? str.slice(0, maxLength - 3) + '...' : str;
    }
  }

  // Fall back to first string argument
  for (const [, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 0) {
      return value.length > maxLength ? value.slice(0, maxLength - 3) + '...' : value;
    }
  }

  // Fall back to first argument of any type
  const firstEntry = Object.entries(args)[0];
  if (firstEntry) {
    const [key, value] = firstEntry;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > maxLength) {
      return `${key}=${str.slice(0, maxLength - key.length - 4)}...`;
    }
    return `${key}=${str}`;
  }

  return '';
}

/**
 * Get a human-readable description of a tool call.
 * Uses the tool's describeCall method if available, otherwise falls back to default.
 *
 * @param tool - The tool function
 * @param args - The arguments passed to the tool
 * @returns Human-readable description
 */
export function getToolCallDescription<TArgs>(
  tool: ToolFunction<TArgs>,
  args: TArgs
): string {
  if (tool.describeCall) {
    try {
      return tool.describeCall(args);
    } catch {
      // Fall through to default
    }
  }
  return defaultDescribeCall(args as Record<string, unknown>);
}
