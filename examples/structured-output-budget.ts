/** Offline Stage 01 repair demonstration; build first. No keys or network calls. */
import { Agent, Connector, ContentType, DEFAULT_FEATURES, MessageRole, Vendor } from '@everworker/oneringai';
import type { ITextProvider, LLMResponse, TextGenerateOptions, StreamEvent } from '@everworker/oneringai';

class ScriptedProvider implements ITextProvider {
  readonly name = 'offline-repair';
  readonly capabilities = { text: true, images: false, videos: false, audio: false };
  calls = 0;
  constructor(private readonly firstAnswer: string) {}
  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    const text = ++this.calls === 1 ? this.firstAnswer : '{"value":"Done"}';
    return { id: `offline-${this.calls}`, object: 'response', created_at: 1, model: options.model,
      status: 'completed', output_text: text, output: [{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
  }
  // eslint-disable-next-line require-yield -- This example exercises managed run and repair.
  async *streamGenerate(): AsyncIterableIterator<StreamEvent> { throw new Error('Streaming is outside this example'); }
  getModelCapabilities() { return { supportsTools: true, supportsVision: false, supportsJSON: true,
    supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 4096 }; }
  async listModels() { return ['offline-repair']; }
  async validateConfig() { return true; }
}

async function demonstrate(oversized: boolean) {
  const name = `offline-repair-${oversized}`;
  const provider = new ScriptedProvider(oversized ? 'not json '.repeat(500) : 'not json');
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', emptyResponseRetry: { enabled: false },
    context: { model: 'gpt-4o-mini', maxContextTokens: 900, responseReserve: 100,
      features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } } });
  try {
    const response = await agent.run('Return a value in JSON.', { responseFormat: { type: 'json_schema', name: 'value',
      strict: true, schema: { type: 'object', properties: { value: { type: 'string' } },
        required: ['value'], additionalProperties: false } } });
    if (oversized || provider.calls !== 2 || JSON.stringify(response.output_parsed) !== '{"value":"Done"}') throw new Error('Unexpected repair result');
    return { scenario: 'fitting repair', providerCalls: provider.calls, parsed: response.output_parsed,
      preparedRevision: agent.context.lastPreparation!.revision, estimatedManagedBudget: agent.context.lastPreparation!.budget,
      fixtureUsage: response.usage };
  } catch (error) {
    if (!oversized || (error as { code?: string }).code !== 'CONTEXT_OVERFLOW' || provider.calls !== 1) throw error;
    return { scenario: 'oversized repair rejected', providerCalls: provider.calls, errorCode: 'CONTEXT_OVERFLOW',
      preparedRevision: agent.context.lastPreparation!.revision };
  } finally { agent.destroy(); Connector.remove(name); }
}

// The auxiliary check preserves the main request revision; usage still includes fitting repairs.
// eslint-disable-next-line no-console
console.log(JSON.stringify([await demonstrate(false), await demonstrate(true)], null, 2));
