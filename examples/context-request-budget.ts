/** Offline Stage 01 correction examples. Run after npm run build; no credentials required. */
import {
  Agent, AgentContextNextGen, Connector, ContentType, MessageRole, ToolCallState, Vendor,
} from '@everworker/oneringai';
import type { ITextProvider, LLMResponse, StreamEvent, TextGenerateOptions } from '@everworker/oneringai';

class BudgetProvider implements ITextProvider {
  readonly name = 'offline-budget';
  readonly capabilities = { text: true, images: false, videos: false, audio: false };
  calls = 0;
  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    this.calls++;
    return { id: `budget-${this.calls}`, object: 'response', created_at: 1, model: options.model,
      status: 'completed', output_text: '{"value":"Done"}', output: [{ type: 'message', role: MessageRole.ASSISTANT,
        content: [{ type: ContentType.OUTPUT_TEXT, text: '{"value":"Done"}' }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
  }
  // eslint-disable-next-line require-yield -- The example exercises managed non-streaming requests.
  async *streamGenerate(): AsyncIterableIterator<StreamEvent> { throw new Error('Use run for this fixture'); }
  getModelCapabilities() { return { supportsTools: true, supportsVision: false, supportsJSON: true,
    supportsJSONSchema: true, maxTokens: 1000, maxInputTokens: 1000, maxOutputTokens: 100 }; }
  async listModels() { return ['offline-budget']; }
  async validateConfig() { return true; }
}

async function demonstratePreparation() {
  const provider = new BudgetProvider(); const connector = 'offline-budget';
  Connector.create({ name: connector, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector, model: 'offline-budget', emptyResponseRetry: { enabled: false },
    context: { model: 'offline-budget', responseReserve: 100, strategy: 'default',
      features: { workingMemory: false, inContextMemory: false } } });
  let compactions = 0; agent.context.on('context:compacted', () => { compactions++; });
  try {
    agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
      content: [{ type: ContentType.INPUT_TEXT, text: 'old observation '.repeat(110) }] }]);
    const response = await agent.run('Return JSON.', { responseFormat: { type: 'json_schema', name: 'value', strict: true,
      schema: { type: 'object', description: 'schema terms '.repeat(160), properties: { value: { type: 'string' } },
        required: ['value'], additionalProperties: false } } });
    const selected = agent.context.lastPreparation!;
    if (compactions !== 1 || provider.calls !== 1 || selected.budget.available < 0 || selected.budget.maxTokens !== 1000 ||
        JSON.stringify(response.output_parsed) !== '{"value":"Done"}') throw new Error('Preparation demonstration failed');
    return { scenario: 'known schema and provider capacity guide compaction', parsed: response.output_parsed,
      compactions, providerCalls: provider.calls, ownerWindow: agent.context.maxContextTokens, selectedBudget: selected.budget };
  } finally { agent.destroy(); Connector.remove(connector); }
}

async function demonstrateSpills() {
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 3000, responseReserve: 100,
    features: { workingMemory: true, inContextMemory: false } });
  try {
    for (const [id, marker] of [['first-12345678', 'FIRST_SOURCE'], ['second-12345678', 'SECOND_SOURCE']]) {
      context.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [
        { type: ContentType.TOOL_USE, id: id!, name: 'lookup', arguments: '{}' }] },
      { type: 'function_call_output', call_id: id!, output: marker + ' evidence '.repeat(1300) }]);
      await context.consolidate();
    }
    const keys = ['raw.tool_result.lookup.12345678', 'raw.tool_result.lookup.12345678.function.1'];
    const reads = await Promise.all(keys.map(key => context.tools.execute('store_get', { store: 'notes', key })));
    if (!JSON.stringify(reads[0]).includes('FIRST_SOURCE') || !JSON.stringify(reads[1]).includes('SECOND_SOURCE')) throw new Error('Spill demonstration failed');
    return { scenario: 'separate spills keep both sources', keys, firstRecovered: true, secondRecovered: true };
  } finally { context.destroy(); }
}

async function demonstrateError() {
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 1000, responseReserve: 100,
    features: { workingMemory: false, inContextMemory: false } });
  try {
    context.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.TOOL_USE, id: 'error-call', name: 'lookup', arguments: '{}' }] }]);
    context.addToolResults([{ tool_use_id: 'error-call', content: '', error: 'ERROR_DIAGNOSTIC '.repeat(1000), state: ToolCallState.FAILED }]);
    await context.prepare(); throw new Error('Oversized error should have been rejected');
  } catch (error) {
    if ((error as { code?: string }).code !== 'CONTEXT_OVERFLOW') throw error;
    return { scenario: 'protected error payload cannot fit', errorCode: 'CONTEXT_OVERFLOW', providerCalls: 0 };
  } finally { context.destroy(); }
}

// eslint-disable-next-line no-console
console.log(JSON.stringify([await demonstratePreparation(), await demonstrateSpills(), await demonstrateError()], null, 2));
