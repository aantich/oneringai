/**
 * Content types based on OpenAI Responses API format
 */

export enum ContentType {
  INPUT_TEXT = 'input_text',
  INPUT_IMAGE_URL = 'input_image_url',
  INPUT_FILE = 'input_file',
  OUTPUT_TEXT = 'output_text',
  TOOL_USE = 'tool_use',
  TOOL_RESULT = 'tool_result',
  CUSTOM_TOOL_USE = 'custom_tool_use',
  CUSTOM_TOOL_RESULT = 'custom_tool_result',
  THINKING = 'thinking',
  PROVIDER_STATE = 'provider_state',
}

export interface BaseContent {
  type: ContentType;
  /** OpenAI GPT-5.6+ explicit prompt-cache breakpoint after this content block. */
  promptCacheBreakpoint?: boolean;
}

export interface InputTextContent extends BaseContent {
  type: ContentType.INPUT_TEXT;
  text: string;
}

export interface InputImageContent extends BaseContent {
  type: ContentType.INPUT_IMAGE_URL;
  image_url: {
    url: string; // HTTP URL or data URI
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface InputFileContent extends BaseContent {
  type: ContentType.INPUT_FILE;
  file_id: string;
}

export interface OutputTextContent extends BaseContent {
  type: ContentType.OUTPUT_TEXT;
  text: string;
  annotations?: any[];
}

export interface ToolUseContent extends BaseContent {
  type: ContentType.TOOL_USE;
  id: string;
  name: string;
  arguments: string; // JSON string
  /** Whether the provider marked this as an async protocol call. */
  async?: boolean;
  /** Google Gemini 3+ opaque thought signature for round-tripping function calls */
  thoughtSignature?: string;
}

export interface CustomToolUseContent extends BaseContent {
  type: ContentType.CUSTOM_TOOL_USE;
  id: string;
  name: string;
  input: string;
  /** Whether the provider marked this as an async protocol call. */
  async?: boolean;
}

export interface CustomToolResultContent extends BaseContent {
  type: ContentType.CUSTOM_TOOL_RESULT;
  tool_use_id: string;
  content: string | any;
  error?: string;
}

export interface ToolResultContent extends BaseContent {
  type: ContentType.TOOL_RESULT;
  tool_use_id: string;
  content: string | any;
  error?: string;
  /**
   * Images extracted from tool results via the __images convention.
   * Stored separately from `content` so they don't inflate text-based token counts.
   * Provider converters read this field to inject native multimodal image blocks.
   */
  __images?: Array<{ base64: string; mediaType: string }>;
}

export interface ThinkingContent extends BaseContent {
  type: ContentType.THINKING;
  thinking: string;
  /** Provider item identifier used when a stateless API requires reasoning replay. */
  providerItemId?: string;
  /** Opaque provider replay data; applications should not interpret its contents. */
  providerMetadata?: Record<string, unknown>;
  /** Anthropic's opaque signature for round-tripping thinking blocks */
  signature?: string;
  /** Whether this thinking block should be persisted in conversation history.
   *  Anthropic requires it (true), OpenAI/Google do not (false). */
  persistInHistory: boolean;
}

/**
 * Opaque provider-owned content that must be replayed verbatim. This is used
 * for protocol state such as Anthropic server-tool calls/results; applications
 * should persist it but must not interpret or manufacture it.
 */
export interface ProviderStateContent extends BaseContent {
  type: ContentType.PROVIDER_STATE;
  provider: string;
  data: Record<string, unknown>;
}

export type Content =
  | InputTextContent
  | InputImageContent
  | InputFileContent
  | OutputTextContent
  | ToolUseContent
  | ToolResultContent
  | CustomToolUseContent
  | CustomToolResultContent
  | ThinkingContent
  | ProviderStateContent;
