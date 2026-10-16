/** Actual AMOS adapter, synthetic model, checkpoint and host inspection. No keys/network. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor } from '@everworker/oneringai';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import { DEFAULT_CONFIG } from '../src/config/types.js';
import type { IAmosApp } from '../src/config/types.js';
import type { AgentLoopPolicy } from '@everworker/oneringai';

const directory = await mkdtemp(join(tmpdir(), 'amos-loop-demo-'));
const config = structuredClone(DEFAULT_CONFIG);
config.session.autoSave = false;
config.loopPolicy = { maxRecoveryAttempts: 1 };
const provider = new ScriptedLoopProvider([{ text: 'Premature completion.' }, { text: 'Missing artifact; host input needed.' }, { text: 'Host verified the artifact.' }]);
Connector.create({ name: 'amos-loop-demo', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
let runner = new AgentRunner(config, [], directory);
const command = new ContextCommand();
class ArtifactPolicy implements AgentLoopPolicy {
  maxRecoveryAttempts = 1;
  #verified = false;
  verify() { this.#verified = true; }
  completion() { return { complete: this.#verified, reason: this.#verified ? 'Host independently verified synthetic artifact' : 'Required artifact missing' }; }
}
try {
  await runner.initialize('amos-loop-demo', 'gpt-4o-mini');
  runner.setLoopPolicy(new ArtifactPolicy());
  const first = await runner.run('Verify the artifact.');
  assert.equal(first.loop?.status, 'blocked');
  const inspected = await command.execute({ app: { getAgent: () => runner } as unknown as IAmosApp, args: ['loop'], rawInput: '/context loop' });
  console.log(inspected.message);
  const id = await runner.saveSession('Needs host input');
  runner.destroy();
  runner = new AgentRunner(config, [], directory);
  await runner.initialize('amos-loop-demo', 'gpt-4o-mini');
  assert.equal(config.session.activeSessionId, id);
  assert.equal(runner.getLoopDiagnostics(), undefined);
  // The host supplies fresh authority; a saved transcript is not a completion verdict.
  const verified = new ArtifactPolicy(); verified.verify(); runner.setLoopPolicy(verified);
  assert.equal((await runner.run('Continue after host verification.')).loop?.status, 'completed');
  console.log('Checkpoint has conversation data, not restored counters/checker authority. Host supplied a fresh completion check.');
} finally { runner.destroy(); Connector.remove('amos-loop-demo'); await rm(directory, { recursive: true, force: true }); }
