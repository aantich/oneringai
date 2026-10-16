/** Build first. Offline by default; --live makes billable OpenAI calls using .env. */
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Agent, Connector, ModelTask, Vendor, ContentType, MessageRole } from '@everworker/oneringai';
import type { ITextProvider, TextGenerateOptions, LLMResponse } from '@everworker/oneringai';

const marker = 'ALPHA_6';
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
function mockModel(window: number, helper: boolean): ITextProvider {
  let requests = 0;
  return {
    name: 'offline-fixture', capabilities: { text: true, images: false, videos: false, audio: false },
    validateConfig: async () => true, listModels: async () => [],
    getModelCapabilities: () => ({ supportsTools: false, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
      maxTokens: window, maxInputTokens: window, maxOutputTokens: 512 }),
    async generate(options: TextGenerateOptions): Promise<LLMResponse> {
      const observed = JSON.stringify(options.input).includes(marker);
      if (!observed) throw new Error('Fixture dependency missing: expected the source marker in this packet');
      // The first answer fits the native shape but fails local nonempty validation.
      // Its repair must still contain
      // the selected marker; the evidence assertion above also checks the repair.
      const text = helper ? ++requests === 1 ? '{"answer":""}' : JSON.stringify({ answer: marker }) : marker;
      return { id: 'offline-response', object: 'response', created_at: 1, model: options.model, status: 'completed',
        output_text: text, output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }],
        usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } };
    },
    async *streamGenerate() { throw new Error('Offline example uses non-streaming model calls'); },
  };
}

export async function demonstratePurposeModels(live = false): Promise<void> {
  const suffix = randomUUID();
  const names = { main: `example-purpose-main-${suffix}`, helper: `example-purpose-helper-${suffix}` };
  const owned: string[] = [];
  let task: ModelTask | undefined; let agent: Agent | undefined;
  try {
    if (live) {
      const { default: dotenv } = await import('dotenv'); dotenv.config({ quiet: true });
      if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in .env for --live');
      for (const name of Object.values(names)) {
        Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY } });
        owned.push(name);
      }
    } else {
      Connector.create({ name: names.main, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: mockModel(8192, false) } }); owned.push(names.main);
      Connector.create({ name: names.helper, vendor: Vendor.Anthropic, auth: { type: 'none' }, options: { provider: mockModel(1024, true) } }); owned.push(names.helper);
    }
    const mainModel = live ? 'gpt-4.1' : 'offline-main';
    const helperModel = live ? 'gpt-4o-mini' : 'offline-helper';
    task = new ModelTask({ limits: { maxCalls: 6, maxTokens: live ? 3_000_000 : 20_000, deadline: Date.now() + 60_000 } });
    agent = Agent.create({ connector: names.main, model: mainModel, thinking: { enabled: false },
      instructions: 'Return the exact source marker from the user, with no explanation.',
      context: { model: mainModel, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { maxOutputTokensPerCall: 256, ...(live ? {} : { customProviderAttempts: 'single' as const }), helpers: {
        extractor: { connector: names.helper, model: helperModel, maxOutputTokens: 256, instructions: 'Extract the exact source marker into answer.' },
        verifier: { connector: names.helper, model: helperModel, maxOutputTokens: 256, instructions: 'Check that the provided source and answer have the same marker, then return that exact marker in answer.' },
      } },
    });
    const extracted = await agent.invokeHelper<{ answer: string }>('extractor', context => {
      console.log(`Resolved helper: ${context.model}; input estimate allowance: ${context.maxInputTokens}`);
      return `Source marker=${marker}. Extract it exactly.`;
    }, { schema, validationSchema: { type: 'object', properties: { answer: { type: 'string', minLength: 1 } } }, modelTask: task });
    const main = await agent.run(`Return this extracted marker verbatim: ${extracted.value.answer}`, { modelTask: task });
    const verified = await agent.invokeHelper<{ answer: string }>('verifier',
      `Source marker=${marker}; proposed answer=${main.output_text}`, { schema, modelTask: task });
    if (extracted.value.answer !== marker || !main.output_text?.includes(marker) || verified.value.answer !== marker) throw new Error('Purpose pipeline did not preserve the source marker');
    for (const call of task.snapshot().invocations) console.log(`${call.purpose}/${call.phase}: ${call.model}, tokens=${call.usage?.total_tokens ?? 'unknown'}, model cost=${call.modelCostUSD ?? 'unknown'}${call.outputValidation ? `, validation=${call.outputValidation}` : ''}`);
    console.log(live ? 'Live plumbing check passed; no comparative quality/cost conclusion.' : 'Offline plumbing check passed; model answers and usage are synthetic.');
  } finally { agent?.destroy(); task?.destroy(); for (const name of owned) Connector.remove(name); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await demonstratePurposeModels(process.argv.includes('--live'));
