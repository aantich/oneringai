/** npm run build && npm run example:amos-presets; no keys/network; temporary files removed. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor, FileContextStorage, type EvidenceScope } from '@everworker/oneringai';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ConfigManager } from '../src/config/ConfigManager.js';
import { PresetCommand } from '../src/commands/commands/PresetCommand.js';
import type { AmosConfig, CommandContext } from '../src/config/types.js';
const directory = await mkdtemp(join(tmpdir(), 'amos-presets-'));
const manager = new ConfigManager(directory); const config = await manager.load(); config.session.autoSave = false;
config.evidence = { enabled: true, ownerId: 'local-host', namespace: 'example', directory: join(directory, 'evidence') };
config.taskState = { enabled: true, ownerId: 'local-host', namespace: 'example', taskId: 'example-task' };
Connector.create({ name: 'amos-presets-offline', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ScriptedLoopProvider([{ text: 'Research response.' }, { text: 'Workflow response.' }]) } });
let runner = new AgentRunner(config, [], join(directory, 'sessions'));
try {
  await runner.initialize('amos-presets-offline', 'gpt-4o-mini');
  const app = { getAgent: () => runner, getConfig: () => manager.get(), updateConfig: (partial: Partial<AmosConfig>) => manager.update(partial), saveConfig: () => manager.save() } as unknown as CommandContext['app'];
  for (const preset of ['research', 'workflow']) {
    const selected = await new PresetCommand().execute({ app, args: ['set', preset], rawInput: `/preset set ${preset}` });
    if (!selected.success) throw Error(selected.message); console.log(selected.message);
    const candidate = new AgentRunner(manager.get(), [], join(directory, 'sessions'));
    try { await candidate.initialize('amos-presets-offline', 'gpt-4o-mini'); }
    catch (error) { candidate.destroy(); throw error; }
    const previous = runner; runner = candidate; previous.destroy();
    console.log((await runner.run('Give a short status.')).text);
    const report = runner.inspectCapabilities(); console.log(JSON.stringify({ active: report.activePreset, strategy: report.capabilities.context.strategy, loop: report.capabilities.loop }));
    const id = await runner.saveSession('Preset demonstration'); await runner.saveSession();
    if ((await runner.listSessions()).find(session => session.id === id)?.title !== 'Preset demonstration') throw Error('Session title lost on unnamed save');
  }
  // A foreign checkpoint is refused without redirecting later saves.
  const activeId = runner.getSessionId()!;
  const sessions = new FileContextStorage({ agentId: 'amos', baseDirectory: join(directory, 'sessions') });
  const foreign = structuredClone((await sessions.load(activeId))!.state);
  (foreign.pluginStates.evidence as { scope: EvidenceScope }).scope.ownerId = 'foreign';
  await sessions.save('foreign', foreign); const before = JSON.stringify((await sessions.load('foreign'))!.state);
  let scopeRejected = false; try { await runner.loadSession('foreign'); } catch { scopeRejected = true; }
  if (!scopeRejected || runner.getSessionId() !== activeId) throw Error('Rejected load changed checkpoint target');
  await runner.saveSession();
  if (JSON.stringify((await sessions.load('foreign'))!.state) !== before) throw Error('Foreign checkpoint overwritten');
  console.log('Rejected foreign load preserved the active checkpoint and subsequent save target.');
  const invalid = new AgentRunner({ ...manager.get(), preset: 'unsupported' as AmosConfig['preset'] }, [], join(directory, 'sessions'));
  let rejected = false;
  try { await invalid.initialize('amos-presets-offline', 'gpt-4o-mini'); } catch { rejected = true; } finally { invalid.destroy(); }
  if (!rejected || !runner.isReady()) throw Error('Invalid candidate changed the live runner');
  console.log('Failed candidate preserved the active runner; unnamed saves retained the title.');
  console.log('Persisted selection:', (await new ConfigManager(directory).load()).preset);
} finally { runner.destroy(); Connector.remove('amos-presets-offline'); await rm(directory, { recursive: true, force: true }); }
