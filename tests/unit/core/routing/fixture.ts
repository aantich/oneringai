import { vi } from 'vitest';
import { Agent, type AgentConfig } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { ITextProvider, TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { AgentResponse } from '@/domain/entities/Response.js';

export function answer(options: TextGenerateOptions, text = 'ANSWER'): AgentResponse {
  return { id: 'answer', object: 'response', created_at: 1, model: options.model, status: 'completed', output_text: text,
    output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }],
    usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } };
}
export function makeProvider() {
  const generate = vi.fn(async (options: TextGenerateOptions) => answer(options));
  const caps = vi.fn((model: string) => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
    maxTokens: model === 'fast' ? 6000 : 16000, maxInputTokens: model === 'fast' ? 6000 : 16000, maxOutputTokens: 128 }));
  const destroy = vi.fn();
  const provider = { name: 'routing-fixture', capabilities: { text: true, images: false, videos: false, audio: false }, generate,
    streamGenerate: vi.fn(async function* (options: TextGenerateOptions) {
      const result = await generate(options);
      yield { type: StreamEventType.OUTPUT_TEXT_DELTA as const, response_id: result.id, item_id: 'text', output_index: 0, content_index: 0, sequence_number: 1, delta: result.output_text ?? '' };
      yield { type: StreamEventType.RESPONSE_COMPLETE as const, response_id: result.id, status: 'completed' as const, usage: result.usage, iterations: 1 };
    }), getModelCapabilities: caps, validateConfig: async () => true, listModels: async () => [], destroy } satisfies ITextProvider & { destroy(): void };
  return { provider, generate, caps, destroy };
}
let number = 0;
export function fixture(config: Partial<AgentConfig> = {}, configure?: (primary: ReturnType<typeof makeProvider>, secondary: ReturnType<typeof makeProvider>) => void) {
  const primary = makeProvider(), secondary = makeProvider();
  configure?.(primary, secondary);
  const name = `routing-primary-${number++}`, other = `routing-secondary-${number++}`;
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: primary.provider } });
  Connector.create({ name: other, vendor: Vendor.Anthropic, auth: { type: 'none' }, options: { provider: secondary.provider } });
  const select = vi.fn(() => 'fast');
  const agent = Agent.create({ connector: name, model: 'main', ...config,
    context: { model: 'main', responseReserve: 128, ...config.context,
      features: { workingMemory: false, inContextMemory: false, ...(config.context && 'features' in config.context ? config.context.features : {}) } },
    modelExecution: { customProviderAttempts: 'single', routing: { routes: {
      fast: { model: 'fast' }, specialist: { connector: other, model: 'specialist', allowContextTransfer: true },
    }, select }, ...config.modelExecution },
  });
  return { agent, primary, secondary, select, name, other };
}
