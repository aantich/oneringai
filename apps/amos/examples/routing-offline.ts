/** Real AMOS JSON configuration and commands, using an offline synthetic provider. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Connector, Vendor } from '@everworker/oneringai';
import { offlineRoutingConnector } from '../../../examples/model-routing/fixture.js';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { RoutingCommand } from '../src/commands/commands/RoutingCommand.js';
import { ConfigManager } from '../src/config/ConfigManager.js';
import type { IAmosApp } from '../src/config/types.js';

const directory = await mkdtemp(join(tmpdir(), 'amos-routing-'));
const manager = new ConfigManager(directory), config = await manager.load();
config.session.autoSave = false; config.modelExecution = { customProviderAttempts: 'single' };
manager.update({ activeConnector: 'amos-routing-example', activeModel: 'gpt-4.1-mini' });
const fixture = offlineRoutingConnector('amos-routing-example');
let runner = new AgentRunner(manager.get(), [], join(directory, 'sessions'));
const app = { getAgent: () => runner, getConfig: () => manager.get(),
  updateConfig: (value: Parameters<ConfigManager['update']>[0]) => manager.update(value), saveConfig: () => manager.save(),
  getConnectorManager: () => ({ get: (name: string) => name === fixture.connector.name ? { name, vendor: Vendor.OpenAI } : null, registerConnector: () => undefined }),
  createAgent: async () => {
    const next = new AgentRunner(manager.get(), [], join(directory, 'sessions'));
    await next.initialize(fixture.connector.name, 'gpt-4.1-mini'); runner.destroy(); runner = next; return next;
  },
} as unknown as IAmosApp;
async function command(args: string[]) {
  const result = await new RoutingCommand().execute({ app, args, rawInput: `/routing ${args.join(' ')}` });
  assert.equal(result.success, true, result.message); console.log(`/routing ${args.join(' ')}\n${result.message}`);
}
try {
  await runner.initialize(fixture.connector.name, 'gpt-4.1-mini');
  await command(['set', 'fast', fixture.connector.name, 'gpt-4o-mini']);
  await command(['rule', 'lookup', 'fast']); await command(['use', 'auto']); await command(['hints', 'lookup', 'gather']);
  assert.equal(fixture.requests.length, 0);
  const result = await runner.run('Acknowledge the lookup step.'); assert.equal(result.routing?.selectedRoute, 'fast');
  await command([]);
  await command(['use', 'default']);
  const events = []; for await (const event of runner.stream('Acknowledge the default stream.')) events.push(event);
  assert.equal(events.find(event => event.type === 'done')?.routing?.selectedRoute, 'default');
  const saved = await new ConfigManager(directory).load();
  assert.equal(saved.routingRules?.lookup, 'fast'); assert.equal(saved.modelExecution?.routing?.routes.fast?.model, 'gpt-4o-mini');
  await command(['off']); assert.equal((await runner.run('Acknowledge legacy operation.')).routing, undefined);
  console.log('AMOS named routes, JSON host rules, actual decisions, run/stream and opt-out pass. Synthetic usage only.');
} finally { runner.destroy(); Connector.remove(fixture.connector.name); await rm(directory, { recursive: true, force: true }); }
