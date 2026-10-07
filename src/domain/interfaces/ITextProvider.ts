/**
 * Text generation provider interface
 */

import { IProvider } from './IProvider.js';
import { LLMResponse } from '../entities/Response.js';
import { InputItem } from '../entities/Message.js';
import { Tool } from '../entities/Tool.js';
import { StreamEvent } from '../entities/StreamEvent.js';
import type {
  AdvancedTextCapabilities,
  IAsyncTextBatchProvider,
  NativeToolRequest,
  PromptCachePolicy,
  DataHandlingPolicy,
} from './IAdvancedInference.js';
import type { IConnectorRegistry } from './IConnectorRegistry.js';

/** Cross-vendor reasoning-depth controls. Individual models may support a subset. */
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface ThinkingConfig {
  enabled: boolean;
  /** Provider thinking mode. `between_tools` and `disabled` are currently Anthropic-specific. */
  mode?: 'adaptive' | 'enabled' | 'between_tools' | 'disabled';
  /** Fixed reasoning-token budget for models that still expose budget-based thinking. */
  budgetTokens?: number;
  /** Model-selected reasoning depth for OpenAI, Anthropic, and Gemini models. */
  effort?: ReasoningEffort;
}

export interface TextGenerateOptions {
  model: string;
  input: string | InputItem[];
  instructions?: string;
  tools?: Tool[];
  tool_choice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_output_tokens?: number;
  response_format?: {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: any;
  };
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  /** Opaque provider token used to resume an incomplete long decode. */
  continuation_token?: string;
  metadata?: Record<string, string>;
  /**
   * Provider-neutral prompt-cache policy. Unsupported strict requests fail
   * before execution. `mode: 'off'` suppresses library-requested cache controls
   * but cannot disable provider-implicit caching.
   */
  prompt_cache?: PromptCachePolicy;
  /** Provider-hosted tools. These are not executed by ToolManager. */
  native_tools?: NativeToolRequest[];
  /** Host policy for retention-sensitive provider features. */
  data_handling?: DataHandlingPolicy;
  /** @internal Identity context for resolving named connector credentials. */
  credential_context?: { userId?: string; connectorRegistry?: IConnectorRegistry };
  /** Vendor-agnostic thinking/reasoning configuration */
  thinking?: ThinkingConfig;
  /** Vendor-specific options (e.g., Google's thinkingLevel, OpenAI's reasoning_effort) */
  vendorOptions?: Record<string, any>;

  /** Skip pre-flight context limit check. Default: false (check is ON) */
  skipContextLimitCheck?: boolean;
}

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJSON: boolean;
  supportsJSONSchema: boolean;
  maxTokens: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface ITextProvider extends IProvider {
  /**
   * Generate text response
   */
  generate(options: TextGenerateOptions): Promise<LLMResponse>;

  /**
   * Stream text response with real-time events
   * Returns an async iterator of streaming events
   */
  streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent>;

  /**
   * Get model capabilities
   */
  getModelCapabilities(model: string): ModelCapabilities;

  /** Executable advanced capabilities for a concrete model/provider pair. */
  getAdvancedCapabilities?(model: string): AdvancedTextCapabilities;

  /** Optional asynchronous batch surface. Present only when implemented by the provider. */
  readonly batch?: IAsyncTextBatchProvider<TextGenerateOptions, LLMResponse>;

  /**
   * List available models from the provider's API
   */
  listModels(): Promise<string[]>;
}
