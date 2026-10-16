/**
 * Offline: npm run build && npm run example:agentic-presets
 * No credentials/network. Expected: plain/research/workflow answers, resolved
 * capabilities and explicit unavailable-feature errors. All agents are destroyed.
 * For real providers see the separately opt-in test:presets:live command.
 */
import { Agent, AgentContextNextGen, AgentRegistry, BasePluginNextGen, Connector, FileContextStorage, Vendor, createAgentPreset, InMemoryEvidenceStorage, TaskStatePluginNextGen } from '@everworker/oneringai';
import type { AgentPresetName, ToolFunction } from '@everworker/oneringai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptedLoopProvider } from './agent-loop/scripted-provider.js';

for (const preset of [null, 'research', 'workflow'] as const) {
  const name = `preset-${preset ?? 'plain'}`;
  // Stable getter-backed host scope is supported as well as ordinary records.
  class Scope { get ownerId() { return 'example-user'; } get namespace() { return name; } }
  const scope = new Scope();
  let ready = false;
  const tool: ToolFunction = { definition: { type: 'function', function: { name: 'read_artifact', description: 'Read local artifact status', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'read' }, execute: async () => { ready = true; return { artifact: 'A42', ready }; } };
  const provider = new ScriptedLoopProvider(preset ? [{ calls: [{ id: 'read-1', name: 'read_artifact', args: {} }] }, { text: 'Artifact A42 is ready.' }] : [{ text: 'Plain Agent is unchanged.' }]);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const config = { connector: name, model: 'gpt-4o-mini', userId: scope.ownerId, tools: preset ? [tool] : [], instructions: 'Use exact evidence; never treat prose as confirmation.',
    ...(preset ? { context: { plugins: { evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'example-task' } } } } : {}),
    ...(preset === 'workflow' ? { maxIterations: 4, loopPolicy: { completion: () => ({ complete: ready, reason: 'Host checked local artifact.' }) } } : {}),
  };
  const agent = Agent.create(preset ? createAgentPreset(preset, config) : { connector: name, model: config.model, tools: [], instructions: config.instructions });
  try {
    const task = agent.context.getPlugin<TaskStatePluginNextGen>('task_state');
    task?.updateHost({ notes: [{ id: 'objective', category: 'objective', text: 'Verify artifact A42.', source: { label: 'host' } }] }, 0);
    const report = agent.inspectCapabilities();
    console.log(JSON.stringify({ preset: preset ?? 'plain', strategy: report.context.strategy, loop: report.loop, helpers: report.helpers, evidence: report.context.evidenceDurability }));
    const response = await agent.run('Inspect artifact A42.');
    console.log(response.output_text, response.loop?.reason ?? 'legacy completion');
    if (provider.requests.length !== (preset ? 2 : 1)) throw Error('Unexpected model calls');
  } finally { agent.destroy(); Connector.remove(name); }
}
try { createAgentPreset('coding' as AgentPresetName, { connector: 'unresolved', model: 'gpt-4o-mini' }); }
catch (error) { console.log('Unavailable preset:', (error as Error).message); }
try { createAgentPreset('research', { connector: 'unresolved', model: 'gpt-4o-mini', context: { features: { evidence: false } } }); }
catch (error) { console.log('Dependency conflict:', (error as Error).message); }

// Shared-context resume is one host handoff. A rejected notification restores the
// original authority and checkpoint. Plugins retain the existing JSON contract.
class JsonExtension extends BasePluginNextGen {
  readonly name = 'json_extension'; value = 'SAVED';
  getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
  override getState() { const value = this.value; return { toJSON() { return { value }; } }; }
  override restoreState(state: unknown) { this.value = (state as { value: string }).value; }
}
const directory = await mkdtemp(join(tmpdir(), 'oneringai-preset-handoff-'));
const storage = new FileContextStorage({ agentId: 'host', baseDirectory: directory });
const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage, journalFilter: [], features: { workingMemory: false, inContextMemory: false } });
const extension = new JsonExtension(); context.registerPlugin(extension);
const connector = 'preset-handoff';
Connector.create({ name: connector, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ScriptedLoopProvider([]) } });
let writes = 0;
const owner = Agent.create({ connector, model: 'gpt-4o-mini', context, instructions: 'Host A', permissions: { blocklist: ['write_probe'] }, tools: [
  { definition: { type: 'function', function: { name: 'write_probe', parameters: { type: 'object', properties: {} } } }, execute: async () => { writes++; } },
] });
try {
  await owner.saveSession('A'); await storage.save('B', JSON.parse(JSON.stringify(context.getState())));
  extension.value = 'LATER'; const policy = owner.policyManager; const rejected = Error('Host rejected candidate notification');
  AgentRegistry.once('agent:registered', ({ agent }) => agent.on('session:loaded', () => { throw rejected; }));
  try { await Agent.resume('B', { connector, model: 'gpt-4o-mini', context, instructions: 'Candidate B', session: { storage } }); throw Error('Expected rejection'); }
  catch (error) { if (error !== rejected) throw error; }
  if (context.sessionId !== 'A' || context.systemPrompt !== 'Host A' || context.tools.getPermissionManager() !== policy || policy.isDestroyed || extension.value !== 'LATER') throw Error('Rejected handoff changed host state');
  if ((await owner.tools.executeWithOutcome('write_probe', {})).outcome.status !== 'denied' || writes !== 0) throw Error('Original authority lost');
  await context.load('A');
  if (String(extension.value) !== 'SAVED') throw Error('JSON plugin did not restore');
  console.log('Rejected resume preserved host authority and checkpoint A; JSON conversion hooks restored successfully.');
} finally { owner.destroy(); context.destroy(); Connector.remove(connector); await rm(directory, { recursive: true, force: true }); }
