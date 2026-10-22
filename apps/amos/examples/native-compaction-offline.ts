/** Real AMOS policy/configuration/command/session path with a deterministic protocol fixture. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Connector, Vendor } from '@everworker/oneringai';
import { createNativeFixture } from '../../../examples/native-compaction/fixture.js';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import { ConfigManager } from '../src/config/ConfigManager.js';
import type { IAmosApp } from '../src/config/types.js';

const directory = await mkdtemp(join(tmpdir(), 'amos-native-'));
const manager = new ConfigManager(directory), config = await manager.load();
config.session.autoSave = false; config.defaults.maxOutputTokens = 256;
config.contextStrategy = 'context-compaction'; config.contextCompaction = { plugins: 'auto', history: 'native', automatic: false };
config.evidence = { enabled: true, directory: join(directory, 'evidence'), ownerId: 'owner', namespace: 'native-demo' };
config.modelExecution = { customProviderAttempts: 'single' };
const fixture = createNativeFixture();
Connector.create({ name: 'amos-native', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: fixture.provider } });
let runner = new AgentRunner(config, [], join(directory, 'sessions'));
const app = { getAgent: () => runner, getConfig: () => manager.get(), updateConfig: (value: Parameters<ConfigManager['update']>[0]) => manager.update(value), saveConfig: () => manager.save() } as unknown as IAmosApp;
async function command(args: string[]) {
  const result = await new ContextCommand().execute({ app, args, rawInput: '/context ' + args.join(' ') });
  assert.equal(result.success, true, result.message); console.log(`/context ${args.join(' ')}\n${result.message}`);
}
try {
  await runner.initialize('amos-native', 'gpt-6-astra');
  await command(['policy', 'auto', 'native', 'manual']);
  const savedConfig = await new ConfigManager(directory).load(); assert.deepEqual(savedConfig.contextCompaction, config.contextCompaction);
  // With no older completed turns, history is explicitly protected/empty.
  await command(['compact', 'history']); assert.equal(fixture.calls.native, 0);
  for (let i = 0; i < 5; i++) await runner.run(`Completed step ${i}. ` + 'Historical source details. '.repeat(160));
  await command(['compact', 'history']); assert.equal(fixture.calls.native, 1);
  await command(['strategy']);
  const sessionId = await runner.saveSession(); runner.destroy();
  manager.update({ session: { ...config.session, activeSessionId: sessionId } }); await manager.save();
  runner = new AgentRunner(await new ConfigManager(directory).load(), [], join(directory, 'sessions'));
  await runner.initialize('amos-native', 'gpt-6-astra');
  assert.equal(runner.getContextCompaction().composition?.activeNative, true);
  const calls = fixture.calls.native; await runner.run('Continue after restart'); assert.equal(fixture.calls.native, calls);
  console.log('AMOS native policy, protected result, explicit reduction and saved-session resume pass. Offline protocol data only.');
} finally { runner.destroy(); Connector.remove('amos-native'); await rm(directory, { recursive: true, force: true }); }
