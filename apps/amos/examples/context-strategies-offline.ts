/** Actual AMOS runner/command with synthetic model responses and temporary local files. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Connector, Vendor, ContentType, MessageRole } from '@everworker/oneringai';
import type { ITextProvider } from '@everworker/oneringai';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import { ConfigManager } from '../src/config/ConfigManager.js';
import type { IAmosApp } from '../src/config/types.js';
const directory = await mkdtemp(join(tmpdir(), 'amos-stage07-'));
const configManager = new ConfigManager(directory);
const config = await configManager.load(); config.session.autoSave = false; config.permissions.allowlist = ['lookup'];
config.evidence = { enabled: true, directory: join(directory, 'evidence'), ownerId: 'local', namespace: 'stage07' };
config.modelExecution = { customProviderAttempts: 'single', helpers: { compactor: { connector: 'amos-stage07', model: 'gpt-4o', maxOutputTokens: 1024 } } };
let calls = 0, actions = 0, window = 128000;
const provider: ITextProvider = { name: 'amos-stage07-offline', capabilities: { text: true, images: false, videos: false, audio: false },
  getModelCapabilities: model => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: model === 'gpt-4o' ? 128000 : window, maxOutputTokens: 2048 }),
  validateConfig: async () => true, listModels: async () => [],
  generate: async options => { const first = ++calls === 1; const text = 'Recorded progress. '.repeat(30);
    return { id: 'offline', object: 'response', created_at: 1, model: options.model, status: 'completed', output_text: first ? '' : text,
      output: [{ type: 'message', role: MessageRole.ASSISTANT, content: first ? [{ type: ContentType.TOOL_USE, id: 'original', name: 'lookup', arguments: '{}' }] : [{ type: ContentType.OUTPUT_TEXT, text }] }], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } }; },
  async *streamGenerate() { throw new Error('This walkthrough uses run().'); } };
Connector.create({ name: 'amos-stage07', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
const runner = new AgentRunner(config, [{ definition: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { actions++; return { id: 'AMOS_SOURCE_07', detail: 'Older lookup data. '.repeat(900) }; }, output: { effect: 'read' } }], join(directory, 'sessions'));
const command = new ContextCommand();
let failNextSave = false;
const app = { getAgent: () => runner, getConfig: () => configManager.get(), updateConfig: (value: Partial<typeof config>) => configManager.update(value), saveConfig: async () => { if (failNextSave) { failNextSave = false; throw new Error('Synthetic settings failure'); } await configManager.save(); } } as unknown as IAmosApp;
async function runCommand(args: string[]): Promise<void> {
  const result = await command.execute({ app, args, rawInput: '/context ' + args.join(' ') }); assert.equal(result.success, true); console.log(`/context ${args.join(' ')}\n${result.message}\n`);
}
try {
  await runner.initialize('amos-stage07', 'gpt-4o-mini');
  await runner.run('Read the source once.'); for (let i = 0; i < 3; i++) await runner.run(`Progress ${i}; retain the source.`);
  const beforeFailedSelection = calls; failNextSave = true;
  const rejected = await command.execute({ app, args: ['strategy', 'observation-masking'], rawInput: '/context strategy observation-masking' });
  assert.equal(rejected.success, false); assert.equal(runner.getContextCompaction().strategy, 'algorithmic');
  assert.equal(Object.hasOwn(configManager.get(), 'contextStrategy'), false); assert.equal(calls, beforeFailedSelection);
  configManager.update({ ui: { ...configManager.get().ui, showTiming: false } }); await configManager.save();
  assert.equal(Object.hasOwn(await new ConfigManager(directory).load(), 'contextStrategy'), false);
  console.log('Failed settings save restored the absent default; an unrelated save/reload kept it absent, with no model call.');
  await runCommand(['strategy', 'observation-masking']); window = 12000;
  await runner.run('Continue with retained source references.');
  const diagnostic = runner.getContextCompaction(); assert.equal(diagnostic.last?.applied, true); assert.equal(diagnostic.last.helperInvoked, false); assert.equal(actions, 1);
  await runCommand(['strategy']);
  const before = calls; await runCommand(['strategy', 'structured-summary']); assert.equal(calls, before);
  console.log('Selection itself made no helper call. A later summary trigger can make one helper call plus one repair, within its task budget.');
  await runCommand(['strategy', 'algorithmic']);
  console.log('Actual AMOS masking, inspection and persisted strategy selection passed; one original read action. Usage is scripted, not a cost/quality measurement. Temporary files cleaned.');
} finally { runner.destroy(); Connector.remove('amos-stage07'); await rm(directory, { recursive: true, force: true }); }
