/** Build root first; npm run example:amos-context-selection. Temporary files removed; no keys/network. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry, Connector, Vendor, type Agent, type InContextMemoryPluginNextGen } from '@everworker/oneringai';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ConfigManager } from '../src/config/ConfigManager.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import type { CommandContext, IAmosApp } from '../src/config/types.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
const directory = await mkdtemp(join(tmpdir(), 'amos-context-selection-'));
const config = await new ConfigManager(directory).load(); config.session.autoSave = false;
config.contextAssembly = { layout: 'stable-prefix', maxDataTokens: 128, selectWhiteboard: true };
config.maxIterations = 1;
const name = 'stage05-amos-example'; Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ScriptedLoopProvider([
  { calls: [{ id: 'read-1', name: 'read_receipt', args: {} }] }, { text: 'A42 remains completion-unknown.' },
]) } });
let agent!: Agent; AgentRegistry.once('agent:registered', ({ agent: current }) => { agent = current as Agent; });
let reads = 0;
const runner = new AgentRunner(config, [{ definition: { type: 'function', function: { name: 'read_receipt', parameters: { type: 'object', properties: {} } } },
  output: { effect: 'read' }, execute: async () => { reads++; return { id: 'A42', status: 'completion-unknown' }; } }], join(directory, 'sessions'));
try {
  await runner.initialize(name, 'gpt-4o-mini'); const memory = agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
  memory.set('receipt', 'Known receipt', { id: 'A42', status: 'completion-unknown' }, 'critical'); memory.set('background', 'Source retained', 'background '.repeat(1000), 'low');
  await runner.run('Describe the receipt.');
  const result = await new ContextCommand().execute({ app: { getAgent: () => runner } as unknown as IAmosApp, args: ['breakdown'], rawInput: '/context breakdown' } as CommandContext);
  if (!result.success || !result.message?.includes('omitted (budget)') || memory.getContents().size !== 2 || reads !== 1
    || (await runner.getContextBreakdown())?.selection?.accounting.providerInputTokens !== 10) throw Error('AMOS selection/wrap-up demonstration failed');
  console.log(result.message); console.log('Synthetic provider usage above is fixture data, not a real provider cache measurement.');
} finally { runner.destroy(); Connector.remove(name); await rm(directory, { recursive: true, force: true }); }
