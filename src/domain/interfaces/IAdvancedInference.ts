/**
 * Provider-neutral contracts for advanced text-inference capabilities.
 *
 * These types deliberately contain no host persistence or product semantics.
 */

export type PromptCachePolicy =
  | {
      /**
       * Do not request or configure provider caching through OneRingAI.
       * This cannot disable caching that a provider applies implicitly to all
       * eligible requests; consult getAdvancedCapabilities().promptCaching.
       */
      mode: 'off';
    }
  | {
      mode: 'auto';
      ttl?: 'short' | 'extended';
      key?: string;
      /**
       * OpenAI GPT-5.6+ cache-breakpoint selection. `implicit` keeps the
       * provider-selected breakpoint; `explicit` only uses content blocks
       * marked with `promptCacheBreakpoint`.
       */
      breakpointMode?: 'implicit' | 'explicit';
      strict?: boolean;
    };

export type PromptCachingMode = 'unsupported' | 'implicit' | 'request_controlled' | 'explicit_resource';

export type NativeToolCapability =
  | 'web_search'
  | 'x_search'
  | 'web_fetch'
  | 'code_execution'
  | 'file_search'
  | 'remote_mcp'
  | 'computer_use'
  | 'hosted_shell'
  | 'apply_patch'
  | 'tool_search'
  | 'image_generation';

export interface RemoteMcpDescriptor {
  name: string;
  url: string;
  /** Named OneRingAI Connector used as the single source of authentication. */
  authorization?: { connector: string; accountId?: string };
  allowedTools?: string[];
  /**
   * Provider-side approval policy. `always` requires an adapter with a
   * host-managed approval continuation; `never` disables provider approval.
   * Omitted uses the adapter's executable default (OpenAI normalizes to `never`).
   */
  requireApproval?: 'always' | 'never';
}

export interface DataHandlingPolicy {
  /**
   * Permit OneRingAI to request/configure provider-managed prompt cache state.
   * This is not a guarantee that an implicitly-caching provider stores nothing
   * when the option is false or omitted.
   */
  allowProviderCaching?: boolean;
  /** Permit provider-retained asynchronous batch inputs/results. */
  allowBatchRetention?: boolean;
  /** Permit tools executed and retained within the selected LLM provider. */
  allowProviderTools?: boolean;
  /** Permit data to be sent to a configured third-party remote MCP server. */
  allowThirdPartyTools?: boolean;
}

export interface FileSearchOptions extends Record<string, unknown> {
  /** Provider vector stores to search. Required by the normalized file-search contract. */
  vectorStoreIds: string[];
}

export type NativeToolRequest =
  | { capability: 'web_search'; options?: Record<string, unknown> }
  | { capability: 'x_search'; options?: Record<string, unknown> }
  | { capability: 'web_fetch'; options?: Record<string, unknown> }
  | { capability: 'code_execution'; options?: Record<string, unknown> }
  | { capability: 'file_search'; options: FileSearchOptions }
  | { capability: 'remote_mcp'; server: RemoteMcpDescriptor; options?: Record<string, unknown> }
  | { capability: 'computer_use'; options?: Record<string, unknown> }
  | { capability: 'hosted_shell'; options?: Record<string, unknown> }
  | { capability: 'apply_patch'; options?: Record<string, unknown> }
  | { capability: 'tool_search'; options?: Record<string, unknown> }
  | { capability: 'image_generation'; options?: Record<string, unknown> };

export interface AdvancedTextCapabilities {
  /** Whether normalized reasoning must be replayed in stateless conversation history. */
  reasoningHistory?: 'discard' | 'always' | 'when_tools_configured';
  promptCaching: {
    mode: PromptCachingMode;
    ttlModes: Array<'short' | 'extended'>;
    reportsCacheUsage: boolean;
    /** Supports explicit per-content cache breakpoints. */
    explicitBreakpoints?: boolean;
  };
  batch: {
    supported: boolean;
    cancellable: boolean;
    maxRequests?: number;
    completionWindow?: string;
  };
  structuredOutput: {
    jsonObject: 'native' | 'prompt';
    jsonSchema: 'native' | 'prompt';
    nativeWithTools: boolean;
  };
  nativeTools: NativeToolCapability[];
  nativeToolOptions: {
    /** Whether the adapter can surface and resume a host-managed MCP approval. */
    remoteMcpApproval: boolean;
  };
  /** Responses-protocol extensions exposed through this provider/library integration. */
  responsesExtensions?: {
    asyncToolCalling: boolean;
    midTurnSteering: boolean;
    configurationUpdates: boolean;
    misalignmentMonitoring: boolean;
  };
  dataHandling: {
    promptCaching: 'none' | 'provider_managed';
    batch: 'none' | 'provider_retained';
    remoteMcp: 'none' | 'third_party';
  };
}

export type BatchProcessingState =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface BatchTextRequest<TOptions = unknown> {
  /** Stable host correlation key. Must be unique within one submission. */
  customId: string;
  options: TOptions;
}

export interface BatchSubmitOptions {
  metadata?: Record<string, string>;
  completionWindow?: string;
  dataHandling?: DataHandlingPolicy;
}

export interface BatchHandle {
  id: string;
  provider: string;
  state: BatchProcessingState;
  createdAt?: Date;
  expiresAt?: Date;
  requestCounts?: {
    total: number;
    processing?: number;
    succeeded?: number;
    failed?: number;
    cancelled?: number;
    expired?: number;
  };
  rawStatus?: string;
  metadata?: Record<string, string>;
}

export interface BatchTextResult<TResponse = unknown> {
  customId: string;
  response?: TResponse;
  error?: {
    code?: string;
    message: string;
    statusCode?: number;
    /** Provider-native item error for diagnostics/recovery. */
    details?: unknown;
  };
  providerRequestId?: string;
}

export interface IAsyncTextBatchProvider<TOptions = unknown, TResponse = unknown> {
  submitBatch(
    requests: Array<BatchTextRequest<TOptions>>,
    options?: BatchSubmitOptions,
  ): Promise<BatchHandle>;
  getBatch(id: string): Promise<BatchHandle>;
  cancelBatch(id: string): Promise<BatchHandle>;
  getBatchResults(id: string): AsyncIterable<BatchTextResult<TResponse>>;
}
