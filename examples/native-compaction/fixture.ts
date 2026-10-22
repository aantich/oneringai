/** Deterministic protocol fixture. This provider does not call or emulate an LLM. */
import { ContentType, MessageRole, StreamEventType } from '@everworker/oneringai';
import type { ITextProvider, TextGenerateOptions } from '@everworker/oneringai';

export function createNativeFixture() {
  const calls = { main: 0, native: 0, counts: 0 };
  const usage = { input_tokens: 60, output_tokens: 20, total_tokens: 80 };
  const generate: ITextProvider['generate'] = async options => {
    calls.main++;
    return { id: 'fixture-answer', object: 'response', created_at: 1, model: options.model, status: 'completed',
      output_text: 'ORBIT_16A / limit 37', output: [{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: 'ORBIT_16A / limit 37' }] }], usage };
  };
  const provider: ITextProvider = {
    name: 'offline-native-fixture', capabilities: { text: true, images: false, videos: false, audio: false }, generate,
    async *streamGenerate(options) {
      const result = await generate(options);
      yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: result.id, item_id: 'text', output_index: 0, content_index: 0, sequence_number: 1, delta: result.output_text! };
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: result.id, status: 'completed', usage, iterations: 1 };
    },
    compaction: {
      async compact() { calls.native++; return { protocol: 'offline-native-fixture-v1', usage,
        input: [{ type: 'compaction', id: `fixture-${calls.native}`, encrypted_content: 'OPAQUE_FIXTURE_STATE' }] }; },
      async countInput(options: TextGenerateOptions) {
        calls.counts++;
        const input = typeof options.input === 'string' ? options.input : options.input.map(item => item.type === 'compaction' ? { nativeTokens: 50 } : item);
        return Math.ceil(JSON.stringify({ input, instructions: options.instructions, tools: options.tools, schema: options.response_format }).length / 4);
      },
    },
    getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 32000, maxInputTokens: 32000, maxOutputTokens: 2048 }),
    getAdvancedCapabilities: () => ({ nativeCompaction: { onDemand: 'supported', inputTokenCounting: 'provider' },
      promptCaching: { mode: 'unsupported', ttlModes: [], reportsCacheUsage: false }, batch: { supported: false, cancellable: false },
      structuredOutput: { jsonObject: 'native', jsonSchema: 'native', nativeWithTools: true }, nativeTools: [], nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: { promptCaching: 'none', batch: 'none', remoteMcp: 'none' } }),
    validateConfig: async () => true, listModels: async () => [],
  };
  return { provider, calls };
}
