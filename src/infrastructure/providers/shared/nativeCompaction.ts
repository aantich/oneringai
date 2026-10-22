import { InvalidConfigError, ProviderCapabilityNotSupportedError } from '../../../domain/errors/AIErrors.js';
import { ContentType } from '../../../domain/entities/Content.js';
import { MessageRole } from '../../../domain/entities/Message.js';
import type { InputItem } from '../../../domain/entities/Message.js';
import type { TokenUsage } from '../../../domain/entities/Response.js';
import type { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';

export const ANTHROPIC_COMPACTION_BETA = 'compact-2026-09-04';

/** Strict standalone ownership. Never reinterpret raw automatic/server-owned state. */
export function assertNativeCompactionOptions(options: TextGenerateOptions, provider: string): void {
  if (options.previous_response_id || options.continuation_token || options.native_tools?.length || options.tools?.some(tool => tool.type !== 'function')) {
    throw new ProviderCapabilityNotSupportedError(provider, options.model, 'native compaction with server-owned state or hosted tools');
  }
  const raw = options.vendorOptions ?? {};
  if (['compaction', 'contextManagement', 'context_management', 'previous_response_id', 'conversation', 'truncation', 'input', 'messages', 'tools', 'mcp_servers']
    .some(key => raw[key] !== undefined)) throw new InvalidConfigError('Managed native compaction cannot combine raw context/tool ownership overrides');
  if (provider === 'anthropic' && typeof options.input !== 'string' && options.input.some(item => item.type === 'reasoning')) {
    throw new ProviderCapabilityNotSupportedError(provider, options.model, 'managed native replay of top-level reasoning');
  }
  if (typeof options.input !== 'string' && options.input.some(item => item.type === 'message' && item.content.some(block => {
    if (block.type !== ContentType.THINKING) return false;
    // The legacy converters intentionally omit thinking they cannot replay.
    // Native source replacement must reject it before relying on those views.
    if (provider === 'openai') return !block.providerItemId || typeof block.providerMetadata?.encrypted_content !== 'string'
      || !block.providerMetadata.encrypted_content || block.signature !== undefined;
    if (provider === 'anthropic') return typeof block.signature !== 'string' || !block.signature
      || block.providerItemId !== undefined || block.providerMetadata?.encrypted_content !== undefined;
    return false;
  }))) throw new ProviderCapabilityNotSupportedError(provider, options.model, 'managed native replay of nested thinking');
  if (typeof options.input !== 'string' && options.input.some(item => {
    if (item.type === 'compaction' || item.type === 'reasoning') return false;
    return item.type !== 'message' || item.content.some(block =>
      ![ContentType.INPUT_TEXT, ContentType.OUTPUT_TEXT, ContentType.TOOL_USE, ContentType.TOOL_RESULT, ContentType.THINKING].includes(block.type)
      || (block.type === ContentType.TOOL_RESULT && !!block.__images?.length));
  })) throw new ProviderCapabilityNotSupportedError(provider, options.model, 'managed native multimodal/hosted replay');
}

function counter(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }

/** Null is unknown; absent counters must never be manufactured as zero usage. */
export function nativeCompactionUsage(value: unknown, provider: 'openai' | 'anthropic'): TokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const modes = { ...(typeof raw.service_tier === 'string' ? { service_tier: raw.service_tier } : {}),
    ...(typeof raw.speed === 'string' ? { speed: raw.speed } : {}) };
  if (provider === 'anthropic') {
    if (!Array.isArray(raw.iterations) || !raw.iterations.length) return null;
    let input = 0, output = 0, cached = 0, written = 0, short = 0, long = 0;
    let hasWriteDetails = false;
    for (const iteration of raw.iterations as Array<Record<string, unknown>>) {
      if (iteration.type !== 'compaction' || !counter(iteration.input_tokens) || !counter(iteration.output_tokens)) return null;
      const read = iteration.cache_read_input_tokens, write = iteration.cache_creation_input_tokens;
      if (!counter(read) || !counter(write)) return null;
      input += iteration.input_tokens + read + write; output += iteration.output_tokens; cached += read; written += write;
      if (iteration.cache_creation && typeof iteration.cache_creation === 'object') {
        const details = iteration.cache_creation as Record<string, unknown>;
        if (!counter(details.ephemeral_5m_input_tokens) || !counter(details.ephemeral_1h_input_tokens)
          || details.ephemeral_5m_input_tokens + details.ephemeral_1h_input_tokens !== write) return null;
        hasWriteDetails = true; short += details.ephemeral_5m_input_tokens; long += details.ephemeral_1h_input_tokens;
      }
    }
    if (![input, output, input + output].every(counter)) return null;
    return { input_tokens: input, output_tokens: output, total_tokens: input + output, ...modes,
      ...(cached ? { cached_input_tokens: cached } : {}), ...(written ? { cache_creation_input_tokens: written } : {}),
      ...(hasWriteDetails && short + long === written ? { cache_creation_details: { short_ttl_input_tokens: short, extended_ttl_input_tokens: long } } : {}) };
  }
  if (!counter(raw.input_tokens) || !counter(raw.output_tokens) || !counter(raw.total_tokens)) return null;
  const cached = (raw.input_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens;
  const reasoning = (raw.output_tokens_details as { reasoning_tokens?: unknown } | undefined)?.reasoning_tokens;
  if ((cached !== undefined && (!counter(cached) || cached > raw.input_tokens))
    || (reasoning !== undefined && (!counter(reasoning) || reasoning > raw.output_tokens))) return null;
  return { input_tokens: raw.input_tokens, output_tokens: raw.output_tokens, total_tokens: Math.max(raw.total_tokens, raw.input_tokens + raw.output_tokens), ...modes,
    ...(cached !== undefined ? { cached_input_tokens: cached as number } : {}),
    ...(reasoning !== undefined ? { output_tokens_details: { reasoning_tokens: reasoning as number } } : {}) };
}

/** Preserve the complete text/native window; reject unknown representations rather than drop them. */
export function openAICompactedWindow(output: unknown): InputItem[] {
  if (!Array.isArray(output) || !output.length) throw new InvalidConfigError('OpenAI compaction returned no canonical window');
  let blocks = 0;
  const items = output.map((raw: Record<string, unknown>): InputItem => {
    if (raw.type === 'compaction' && typeof raw.id === 'string' && typeof raw.encrypted_content === 'string' && raw.encrypted_content) {
      if (Object.keys(raw).some(key => !['type', 'id', 'encrypted_content'].includes(key))) throw new InvalidConfigError('Unsupported native compaction fields');
      blocks++;
      return { type: 'compaction', id: raw.id, encrypted_content: raw.encrypted_content };
    }
    if (raw.type !== 'message' || !['user', 'assistant'].includes(raw.role as string) || !Array.isArray(raw.content)
      || Object.keys(raw).some(key => !['type', 'id', 'role', 'content', 'status', 'phase'].includes(key))) throw new InvalidConfigError('Unsupported canonical native item; original history retained');
    return { type: 'message', ...(typeof raw.id === 'string' ? { id: raw.id } : {}), role: raw.role as MessageRole,
      content: raw.content.map((block: Record<string, unknown>) => {
        if (!['input_text', 'output_text'].includes(block.type as string) || typeof block.text !== 'string'
          || Object.keys(block).some(key => !['type', 'text', 'annotations', 'logprobs'].includes(key))) throw new InvalidConfigError('Unsupported canonical native content');
        return { type: block.type as ContentType.INPUT_TEXT | ContentType.OUTPUT_TEXT, text: block.text,
          ...(Array.isArray(block.annotations) ? { annotations: structuredClone(block.annotations) } : {}) };
      }), providerMetadata: { nativeCompaction: { protocol: 'openai-responses-compact-v1', message: structuredClone(raw) } } };
  });
  if (blocks !== 1) throw new InvalidConfigError('Native compaction must return exactly one continuation block');
  return items;
}
