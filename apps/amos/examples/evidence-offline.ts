/** Real AMOS command and runner; synthetic model, local files, no network or credentials. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, ContentType, MessageRole, Vendor } from '@everworker/oneringai';
import type { ITextProvider } from '@everworker/oneringai';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import { DEFAULT_CONFIG } from '../src/config/types.js';
import type { IAmosApp } from '../src/config/types.js';
const directory = await mkdtemp(join(tmpdir(), 'amos-evidence-'));
const config = structuredClone(DEFAULT_CONFIG); config.session.autoSave = false; config.permissions.allowlist = ['large_search'];
config.evidence = { enabled: true, directory: join(directory, 'evidence'), ownerId: 'local-example', namespace: 'amos-demo' };
let count = 0;
const provider: ITextProvider = { name: 'offline-evidence', capabilities: { text: true, images: false, audio: false, videos: false },
  validateConfig: async () => true, listModels: async () => [],
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxOutputTokens: 1024 }),
  async generate(options) { const call = ++count === 1;
    return { id: 'offline', object: 'response', created_at: 1, model: options.model, status: 'completed', output_text: call ? '' : 'Evidence demo complete.',
      output: [{ type: 'message', role: MessageRole.ASSISTANT, content: call ? [{ type: ContentType.TOOL_USE, id: 'demo-call', name: 'large_search', arguments: '{}' }] : [{ type: ContentType.OUTPUT_TEXT, text: 'Evidence demo complete.' }] }],
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } }; },
  async *streamGenerate() { throw new Error('This example uses run()'); } };
Connector.create({ name: 'amos-evidence-demo', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
const runner = new AgentRunner(config, [{ definition: { type: 'function', function: { name: 'large_search', parameters: { type: 'object', properties: {} } } },
  execute: async () => ({ ids: ['AMOS_SOURCE_03'], text: 'synthetic source '.repeat(1000) }), output: { effect: 'read', summarize: () => 'Found AMOS_SOURCE_03' } }], join(directory, 'sessions'));
const app = { getAgent: () => runner } as unknown as IAmosApp; const command = new ContextCommand();
try {
  await runner.initialize('amos-evidence-demo', 'gpt-4o-mini');
  const response = await runner.run('Call large_search once.'); const reference = response.toolOutcomes?.[0]?.evidence?.reference; assert.ok(reference);
  for (const args of [['evidence'], ['evidence', reference.id]]) {
    const result = await command.execute({ app, args, rawInput: `/context ${args.join(' ')}` }); assert.equal(result.success, true); console.log(`/context ${args.join(' ')}\n${result.message}\n`);
  }
  console.log('AMOS metadata listing and explicit bounded preview passed. Synthetic usage; temporary files cleaned.');
} finally { runner.destroy(); Connector.remove('amos-evidence-demo'); await rm(directory, { recursive: true, force: true }); }
