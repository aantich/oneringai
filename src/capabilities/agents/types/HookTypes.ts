/**
 * Hook types for agent execution
 * Hooks can modify execution flow synchronously or asynchronously
 */

import { AgentResponse } from '../../../domain/entities/Response.js';
import { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { ToolCall, ToolResult } from '../../../domain/entities/Tool.js';
import { ExecutionContext } from '../ExecutionContext.js';
import { ExecutionConfig } from './EventTypes.js';

/**
 * Base hook function type
 */
export type Hook<TContext, TResult = any> = (
  context: TContext
) => TResult | Promise<TResult>;

/**
 * Hook that can modify data
 */
export type ModifyingHook<TContext, TModification> = Hook<TContext, TModification>;

// ==================== Hook Contexts ====================

export interface BeforeExecutionContext {
  executionId: string;
  config: ExecutionConfig;
  timestamp: Date;
}

export interface AfterExecutionContext {
  executionId: string;
  response: AgentResponse;
  context: ExecutionContext;
  /** Original user input that started this execution.
   *  Use this instead of context.getCurrentInput() which may have been
   *  overwritten with tool results during multi-iteration execution. */
  input: ReadonlyArray<import('../../../domain/entities/Message.js').InputItem>;
  timestamp: Date;
  duration: number;
}

export interface BeforeLLMContext {
  executionId: string;
  iteration: number;
  options: TextGenerateOptions;
  context: ExecutionContext;
  timestamp: Date;
}

export interface AfterLLMContext {
  executionId: string;
  iteration: number;
  response: AgentResponse;
  context: ExecutionContext;
  timestamp: Date;
  duration: number;
}

export interface BeforeToolContext {
  executionId: string;
  iteration: number;
  toolCall: ToolCall;
  context: ExecutionContext;
  timestamp: Date;
}

export interface AfterToolContext {
  executionId: string;
  iteration: number;
  toolCall: ToolCall;
  result: ToolResult;
  context: ExecutionContext;
  timestamp: Date;
}

export interface ApproveToolContext {
  executionId: string;
  iteration: number;
  toolCall: ToolCall;
  context: ExecutionContext;
  timestamp: Date;
}

export interface PauseCheckContext {
  executionId: string;
  iteration: number;
  context: ExecutionContext;
  timestamp: Date;
}

// ==================== Hook Result Types ====================

export interface LLMModification {
  modified?: Partial<TextGenerateOptions>;
  skip?: boolean;
  reason?: string;
}

export interface ToolModification {
  modified?: Partial<ToolCall>;
  skip?: boolean;
  mockResult?: any;
  reason?: string;
}

export interface ToolResultModification {
  modified?: Partial<ToolResult>;
  retry?: boolean;
  reason?: string;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  modifiedArgs?: any;
}

export interface PauseDecision {
  shouldPause: boolean;
  reason?: string;
}

// ==================== Hook Configuration ====================

export interface HookConfig {
  // Lifecycle hooks
  'before:execution'?: Hook<BeforeExecutionContext, void>;
  'after:execution'?: Hook<AfterExecutionContext, void>;

  // LLM hooks
  'before:llm'?: ModifyingHook<BeforeLLMContext, LLMModification>;
  'after:llm'?: ModifyingHook<AfterLLMContext, {}>;

  // Tool hooks
  'before:tool'?: ModifyingHook<BeforeToolContext, ToolModification>;
  'after:tool'?: ModifyingHook<AfterToolContext, ToolResultModification>;
  'approve:tool'?: Hook<ApproveToolContext, ApprovalResult>;

  // Pause hooks
  'pause:check'?: Hook<PauseCheckContext, PauseDecision>;

  // Global hook settings
  hookTimeout?: number; // Timeout per hook in ms (default: 5000)
  parallelHooks?: boolean; // Execute hooks in parallel (default: false)
}

export type HookName = keyof Omit<HookConfig, 'hookTimeout' | 'parallelHooks'>;

/**
 * Map of hook names to their context and result types
 */
export interface HookSignatures {
  'before:execution': { context: BeforeExecutionContext; result: void };
  'after:execution': { context: AfterExecutionContext; result: void };
  'before:llm': { context: BeforeLLMContext; result: LLMModification };
  'after:llm': { context: AfterLLMContext; result: {} };
  'before:tool': { context: BeforeToolContext; result: ToolModification };
  'after:tool': { context: AfterToolContext; result: ToolResultModification };
  'approve:tool': { context: ApproveToolContext; result: ApprovalResult };
  'pause:check': { context: PauseCheckContext; result: PauseDecision };
}
