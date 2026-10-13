/** Exercise the real AMOS command and runner with a synthetic, offline model. */
import { Agent, Connector, ContentType, MessageRole, Vendor } from '@everworker/oneringai';
import type { ITextProvider } from '@everworker/oneringai';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { HelpersCommand } from '../src/commands/commands/HelpersCommand.js';
import { DEFAULT_CONFIG } from '../src/config/types.js';
import type { AmosConfig, IAmosApp } from '../src/config/types.js';

const connector = `amos-offline-helper-${process.pid}`;
let helperAttempts = 0;
const provider: ITextProvider = {
  name: 'synthetic-amos-helper', capabilities: { text: true, images: false, videos: false, audio: false },
  validateConfig: async () => true, listModels: async () => [],
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true,
    maxTokens: 4096, maxInputTokens: 4096, maxOutputTokens: 512 }),
  async generate(options) {
    if (!JSON.stringify(options.input).includes('ALPHA_6')) throw new Error('Missing source evidence');
    // Deliberately fail the first schema check; the repair must retain ALPHA_6.
    const text = ++helperAttempts === 1 ? '{"answer":7}' : '{"answer":"ALPHA_6"}';
    return { id: 'synthetic-amos-response', object: 'response', created_at: 1, model: options.model, status: 'completed',
      output_text: text, output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }],
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } };
  },
  async *streamGenerate() { throw new Error('This demonstration uses explicit non-streaming helpers'); },
};
const config: AmosConfig = structuredClone(DEFAULT_CONFIG);
config.modelExecution = { customProviderAttempts: 'single' };
const runner = new AgentRunner(config, []);
const command = new HelpersCommand();
const app = {
  getConfig: () => config, getAgent: () => runner,
  updateConfig: (changes: Partial<AmosConfig>) => { Object.assign(config, changes); },
  saveConfig: async () => { /* Demonstration does not write user configuration. */ },
  createAgent: async () => { await runner.initialize(connector, 'gpt-4o-mini'); return runner; },
  getConnectorManager: () => ({ get: (name: string) => name === connector ? { name, vendor: Vendor.OpenAI } : null,
    registerConnector: () => undefined }),
} as unknown as IAmosApp;

Connector.create({ name: connector, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
try {
  await runner.initialize(connector, 'gpt-4o-mini');
  // Verify the fixture uses the same built public Agent surface as the application.
  if (typeof Agent.create !== 'function') throw new Error('Build the library first');
  for (const args of [[], ['set', 'extractor', connector, 'gpt-4o-mini'],
    ['run', 'extractor', 'Extract source identifier ALPHA_6 into answer.'], ['usage'], ['off']]) {
    const result = await command.execute({ app, args, rawInput: `/helpers ${args.join(' ')}` });
    if (!result.success) throw new Error(result.message);
    console.log(`/helpers ${args.join(' ')}\n${result.message}\n`);
    if (args[0] === 'run' && result.message !== 'ALPHA_6') throw new Error('Helper lost source identifier');
  }
  console.log('AMOS helper demonstration passed; answers and usage are synthetic. No credentials, network calls or configuration writes.');
} finally { runner.destroy(); Connector.remove(connector); }
