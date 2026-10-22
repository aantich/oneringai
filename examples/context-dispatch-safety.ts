/** Build first; npm run example:context-dispatch-safety. Offline; no keys or network. */
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, BasePluginNextGen, Connector, Vendor, ContentType, MessageRole, FileCorrelationStorage, StorageRegistry, SuspendSignal, type IContextStorage, type SerializedContextState, type WorkingMemoryPluginNextGen, type AgentConfig, type InputItem } from '@everworker/oneringai';
import { ScriptedLoopProvider, type ScriptedFrame } from './agent-loop/scripted-provider.js';

class Records extends BasePluginNextGen {
  readonly name = 'records';
  getInstructions() { return 'Treat selected records as source data.'; }
  async getContent() { return 'Legacy complete record view'; }
  getContents() { return null; }
}
const agents: Agent[] = [], connectors: string[] = [], directories: string[] = [];
function create(frames: ScriptedFrame[], extra: Partial<AgentConfig> = {}) {
  const name = `dispatch-safety-${agents.length}`, provider = new ScriptedLoopProvider(frames);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } }); connectors.push(name);
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini',
    context: { model: 'gpt-4o-mini', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } }, ...extra });
  agents.push(agent); return { agent, provider };
}
try {
  const edited = create([{ text: 'VALUE_B' }], { hooks: { 'before:llm': async hook => {
    const input = hook.options.input as InputItem[];
    input[input.length - 1] = { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'LOOKUP_B' }] };
    return {};
  } } });
  edited.agent.context.registerPlugin(new Records()); let contributions = 0;
  edited.agent.context.registerContextContributor('records', { getRevision: () => 'dataset-v1', contribute: packet => {
    contributions++; const b = JSON.stringify(packet.input).includes('LOOKUP_B'); return [{ id: b ? 'B' : 'A', text: b ? 'VALUE_B' : 'VALUE_A' }];
  } });
  await edited.agent.run('LOOKUP_A');
  assert.equal(contributions, 2); assert.equal(edited.provider.requests.length, 1);
  assert.ok(JSON.stringify(edited.provider.requests[0]!.input).includes('VALUE_B'));
  assert.ok(!JSON.stringify(edited.provider.requests[0]!.input).includes('VALUE_A'));

  const repair = create([{ text: 'The value of ok is true.' }]);
  repair.agent.once('iteration:complete', () => { repair.agent.context.systemPrompt = 'HOST_CORRECTION'; });
  await assert.rejects(repair.agent.run('Return ok true.', { responseFormat: { type: 'json_schema', name: 'answer',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } }),
  (error: unknown) => (error as { code?: string }).code === 'CONTEXT_ASSEMBLY_STALE');
  assert.equal(repair.provider.requests.length, 1);

  const wrap = create([{ calls: [{ id: 'read-1', name: 'read_receipt', args: {} }] }, { text: 'Receipt R42 remains completion-unknown.' }], {
    maxIterations: 1, tools: [{ definition: { type: 'function', function: { name: 'read_receipt', parameters: { type: 'object', properties: {} } } },
      output: { effect: 'read' }, execute: async () => ({ id: 'R42', status: 'completion-unknown' }) }],
  });
  await wrap.agent.run('Read receipt R42 once.');
  const accounting = wrap.agent.context.lastPreparation!.selection!.accounting;
  assert.equal(wrap.provider.requests.length, 2); assert.equal(accounting.providerInputTokens, 10); assert.equal(accounting.cachedInputTokens, null);
  // Formatting keeps its admitted frame, then ordinary algorithmic maintenance
  // can spill old read bodies. No new contribution or compaction pass is needed.
  const detail = 'final-detail '.repeat(600), finalJson = JSON.stringify({ ok: true, detail });
  const pressure = create([{ text: 'non-json '.repeat(800) }, { text: finalJson }], {
    context: { model: 'gpt-4o-mini', maxContextTokens: 8000, responseReserve: 2300,
      assembly: { layout: 'stable-prefix' }, features: { workingMemory: true, inContextMemory: false } },
  });
  pressure.agent.context.addInputItems([
    { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'old-read', name: 'read', arguments: '{}' }] },
    { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'old-read', content: 'DATA '.repeat(1200) }] },
  ]);
  const formatted = await pressure.agent.run('Return ok with detail.', { responseFormat: { type: 'json_schema', name: 'detail', schema: {
    type: 'object', properties: { ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['ok', 'detail'], additionalProperties: false,
  } } });
  assert.deepEqual(formatted.output_parsed, { ok: true, detail });
  assert.ok(!JSON.stringify(pressure.agent.context.getConversation()).includes('old-read'));
  const memory = pressure.agent.context.getPlugin<WorkingMemoryPluginNextGen>('working_memory')!;
  assert.equal((await memory.query({ tier: 'raw' })).entries.length, 1);

  // A process-local checkpoint simulation plus temporary correlation file. Actual
  // restart durability needs a persistent context backend, as described in the guide.
  const states = new Map<string, SerializedContextState>();
  const storage: IContextStorage = { getPath: () => 'memory://dispatch-example',
    save: async (id, state) => { states.set(id, JSON.parse(JSON.stringify(state))); },
    load: async id => { const state = states.get(id); return state ? { version: 1, sessionId: id, createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString(), metadata: {}, state } : null; },
    list: async () => [], delete: async id => { states.delete(id); }, exists: async id => states.has(id) };
  const directory = await mkdtemp(join(tmpdir(), 'context-dispatch-example-')); directories.push(directory);
  const correlations = new FileCorrelationStorage({ baseDirectory: directory }); StorageRegistry.configure({ correlations });
  let submissions = 0;
  const suspended = create([{ calls: [{ id: 'submit-once', name: 'submit', args: {} }] }, { text: '{"ok":true}' }, { text: '{"ok":true}' }], {
    context: { model: 'gpt-4o-mini', storage, assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } },
    tools: [{ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' },
      execute: async () => { submissions++; return SuspendSignal.create({ result: 'LOCAL_ACCEPTED_R42', correlationId: 'local-job' }); } }],
  });
  const response = await suspended.agent.run('Submit once and return ok.', { responseFormat: { type: 'json_schema', name: 'answer', schema: {
    type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false,
  } } });
  assert.equal(response.status, 'suspended'); assert.deepEqual(response.output_parsed, { ok: true }); assert.equal(submissions, 1);
  const ref = await correlations.resolve('local-job'); assert.equal(ref!.sessionId, response.suspension!.sessionId);
  assert.ok(JSON.stringify(states.get(ref!.sessionId)).includes('LOCAL_ACCEPTED_R42'));
  console.log(JSON.stringify({ hostEditedInput: { contributions, modelCalls: 1, selected: edited.agent.context.lastPreparation!.selection!.entries[0]!.id },
    supersededPromptRepairBlocked: true, wrapup: accounting, formattingBeforeSpill: { modelCalls: pressure.provider.requests.length, retainedSources: 1 }, structuredSuspension: { submissions, modelCalls: suspended.provider.requests.length, checkpointMatches: true }, syntheticProvider: true }, null, 2));
  console.log('Usage comes from the local scripted provider; it is not a real cache measurement.');
} finally { agents.forEach(agent => agent.destroy()); connectors.forEach(name => Connector.remove(name)); StorageRegistry.remove('correlations'); await Promise.all(directories.map(path => rm(path, { recursive: true, force: true }))); }
