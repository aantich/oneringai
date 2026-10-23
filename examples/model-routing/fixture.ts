import { Connector, ContentType, MessageRole, StreamEventType, Vendor } from '@everworker/oneringai';
import type { ITextProvider, TextGenerateOptions, LLMResponse } from '@everworker/oneringai';

/** Synthetic provider for orchestration demonstrations, with honest synthetic usage. */
export function offlineRoutingConnector(name = 'routing-example') {
  const requests: TextGenerateOptions[] = [];
  const generate = async (options: TextGenerateOptions): Promise<LLMResponse> => {
    requests.push(options);
    return { id: `offline-${requests.length}`, object: 'response', created_at: 1, status: 'completed', model: options.model,
      output_text: 'ACK', output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'ACK' }] }],
      usage: { input_tokens: 25, output_tokens: 1, total_tokens: 26 } };
  };
  const provider: ITextProvider = {
    name: 'routing-offline', capabilities: { text: true, images: false, videos: false, audio: false }, generate,
    async *streamGenerate(options) {
      const result = await generate(options);
      yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: result.id, item_id: 'text', output_index: 0, content_index: 0, sequence_number: 1, delta: 'ACK' };
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: result.id, status: 'completed', usage: result.usage, iterations: 1 };
    },
    getModelCapabilities: model => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: model === 'routing-fast' ? 16000 : 32000, maxInputTokens: model === 'routing-fast' ? 16000 : 32000, maxOutputTokens: 1024 }),
    validateConfig: async () => true, listModels: async () => [],
    compaction: {
      countInput: async options => Math.ceil(JSON.stringify({ input: typeof options.input === 'string' ? options.input
        : options.input.map(item => item.type === 'compaction' ? { type: 'opaque', syntheticTokens: 16 } : item), tools: options.tools }).length / 4),
      compact: async () => ({ protocol: 'offline-routing-v1', input: [{ type: 'compaction', id: 'native-example', encrypted_content: 'SYNTHETIC_OPAQUE_STATE' }],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } }),
    },
  };
  const connector = Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  return { connector, provider, requests, mainModel: 'routing-main', fastModel: 'routing-fast' };
}

/** Live examples deliberately use the same bounded model pairs as the contract pilot. */
export const liveRoutingModels = {
  openai: { vendor: Vendor.OpenAI, key: 'OPENAI_API_KEY', mainModel: 'gpt-4.1-mini', fastModel: 'gpt-4o-mini' },
  anthropic: { vendor: Vendor.Anthropic, key: 'ANTHROPIC_API_KEY', mainModel: 'claude-sonnet-4-6', fastModel: 'claude-haiku-4-5-20251001' },
  google: { vendor: Vendor.Google, key: 'GOOGLE_API_KEY', mainModel: 'gemini-2.5-flash', fastModel: 'gemini-2.5-flash-lite' },
} as const;
