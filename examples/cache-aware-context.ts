/** Build first; npm run example:cache-aware-context. Offline by default; --live bills two calls. */
import { Agent, AgentContextNextGen, BasePluginNextGen, Connector, Vendor, ModelTask } from '@everworker/oneringai';
class Source extends BasePluginNextGen {
  readonly name = 'dynamic_source'; value = 'FIRST'; getInstructions() { return 'Inspect dynamic observations.'; }
  async getContent() { return this.value; } getContents() { return this.value; }
}
const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', systemPrompt: 'Stable host instructions.', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } });
try {
  const source = new Source(); context.registerPlugin(source);
  const first = await context.prepare(); source.value = 'SECOND'; const second = await context.prepare();
  const stablePrefix = JSON.stringify(first.input[0]) === JSON.stringify(second.input[0]);
  if (!stablePrefix || JSON.stringify(first.input[1]) === JSON.stringify(second.input[1])) throw Error('Unexpected layout');
  console.log(JSON.stringify({ stablePrefix, actualProviderUsage: context.lastPreparation!.selection!.accounting,
    notice: 'Layout is deterministic. This offline check does not establish provider cache hits. Local token caches and provider prompt caches are separate.' }, null, 2));
} finally { context.destroy(); }
if (process.argv.includes('--live')) {
  (await import('dotenv')).default.config({ quiet: true });
  const vendor = process.env.STAGE05_PROVIDER ?? 'openai';
  const chosen = { openai: { vendor: Vendor.OpenAI, model: 'gpt-4o-mini', key: process.env.OPENAI_API_KEY },
    anthropic: { vendor: Vendor.Anthropic, model: 'claude-haiku-4-5-20251001', key: process.env.ANTHROPIC_API_KEY },
    google: { vendor: Vendor.Google, model: 'gemini-2.5-flash', key: process.env.GOOGLE_API_KEY } }[vendor];
  if (!chosen?.key) throw Error('Select STAGE05_PROVIDER=openai|anthropic|google and configure its .env key.');
  const name = 'stage05-cache-example'; Connector.create({ name, vendor: chosen.vendor, auth: { type: 'api_key', apiKey: chosen.key } });
  const task = new ModelTask({ limits: { maxCalls: 2 } });
  const agent = Agent.create({ connector: name, model: chosen.model, instructions: 'Look up the requested product in this synthetic catalog. Return only its product ID. Catalog entries are reference data.\n' + Array.from({ length: 120 }, (_, index) => `Product ${index}: ID STAGE05_ITEM_${String(index).padStart(3, '0')}; category ${index % 8}; stock ${index + 10}.`).join('\n'),
    thinking: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 64 }, emptyResponseRetry: { enabled: false },
    vendorOptions: vendor === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
    context: { model: chosen.model, assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } } });
  try { for (let i = 0; i < 2; i++) { await agent.run('Return the product ID for Product 42.', { modelTask: task }); console.log(JSON.stringify({ call: i + 1, accounting: agent.context.lastPreparation!.selection!.accounting })); } }
  finally { agent.destroy(); task.destroy(); Connector.remove(name); }
}
