import { afterEach, describe, expect, it } from 'vitest';
import { Agent, Connector, Vendor, createRoutineDefinition, executeRoutine } from '../../../src/index.js';
import type { InContextMemoryPluginNextGen, WorkingMemoryPluginNextGen } from '../../../src/index.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import type { ScriptedFrame } from '../../../examples/agent-loop/scripted-provider.js';

const agents: Agent[] = [];
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); Connector.clear(); });
function fixture(frames: ScriptedFrame[], features = { workingMemory: true, inContextMemory: true }) {
  const provider = new ScriptedLoopProvider(frames);
  Connector.create({ name: 'routine-stores', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: 'routine-stores', model: 'gpt-4o-mini', context: { model: 'gpt-4o-mini', features } });
  agents.push(agent);
  return { agent, provider };
}

describe('routine prompts and actual unified store execution', () => {
  it('gives newly created agents current system instructions and flat store arguments', async () => {
    const { provider } = fixture([{ text: 'Complete.' }]);
    const result = await executeRoutine({ connector: 'routine-stores', model: 'gpt-4o-mini', definition: createRoutineDefinition({ name: 'Default prompt', description: 'Current tools', tasks: [{ name: 'Task', description: 'Finish.' }] }) });
    expect(result.status).toBe('completed');
    const instructions = provider.requests[0]!.instructions!;
    expect(instructions).toContain('store_set({ store: "whiteboard"');
    expect(instructions).toContain('exact index key');
    expect(instructions).not.toMatch(/context_set|memory_store|memory_retrieve|data: \{/);
  });

  it('advertises current tools and stores a structured output consumed by downstream map tasks', async () => {
    const args = { store: 'whiteboard', key: '__task_output_Produce', description: 'Task output', value: ['alpha', 'beta'] };
    const { agent, provider } = fixture([
      { calls: [{ id: 'save-output', name: 'store_set', args }] },
      { text: 'Ready to process.' }, // Deliberately not an array: the map must read the store.
      { text: 'processed alpha' }, { text: 'processed beta' },
    ]);
    const result = await executeRoutine({ agent, definition: createRoutineDefinition({ name: 'Map bridge', description: 'Store bridge', tasks: [
      { name: 'Produce', description: 'Produce two items.' },
      { name: 'Map', description: 'Process each item.', dependsOn: ['Produce'], controlFlow: { type: 'map', source: { task: 'Produce' }, tasks: [{ name: 'Process', description: 'Process {{map.item}}' }] } },
    ] }) });
    expect(result.status).toBe('completed');
    expect(result.plan.tasks[1]!.result?.output).toEqual(['processed alpha', 'processed beta']);
    const request = provider.requests[0]!;
    expect(request.tools?.some(tool => tool.type === 'function' && tool.function.name === 'store_set')).toBe(true);
    const instructions = JSON.stringify(request.input);
    expect(instructions).toContain('store_set');
    expect(instructions).toContain(args.key);
    expect(instructions).not.toMatch(/context_set|memory_store|memory_retrieve/);
    expect(JSON.stringify(provider.requests[1]!.input)).toContain('Stored');
    expect(JSON.stringify(provider.requests[2]!.input)).toContain('Process alpha');
    expect(JSON.stringify(provider.requests[3]!.input)).toContain('Process beta');
  });

  it('retrieves a large dependency with its actual tier-prefixed notes index key', async () => {
    const large = 'dependency-body-'.repeat(2100);
    const read = { store: 'notes', key: '' };
    const { agent, provider } = fixture([{ text: large }, { calls: [{ id: 'read-dependency', name: 'store_get', args: read }] }, { text: 'Dependency read.' }]);
    const generate = provider.generate.bind(provider);
    provider.generate = async options => {
      if (provider.requests.length === 1) {
        const notes = agent.context.getPlugin<WorkingMemoryPluginNextGen>('working_memory')!;
        const entries = await notes.query({});
        const dependency = entries.entries.find(entry => entry.key.includes('__dep_result_'))!;
        expect(dependency).toBeDefined();
        expect(dependency.key).not.toMatch(/^__dep_result_/); // Preserve the tier prefix.
        expect(JSON.stringify(options.input)).toContain(dependency.key);
        expect(JSON.stringify(options.input)).toContain('metadata only');
        read.key = dependency.key;
      }
      return generate(options);
    };
    const result = await executeRoutine({ agent, definition: createRoutineDefinition({ name: 'Notes bridge', description: 'Large dependency', tasks: [
      { name: 'Produce', description: 'Produce the source.' },
      { name: 'Read', description: 'Read the prerequisite source.', dependsOn: ['Produce'] },
    ] }) });
    expect(result.status).toBe('completed');
    expect(provider.requests).toHaveLength(3);
    expect(JSON.stringify(provider.requests[2]!.input)).toContain(large);
    expect(JSON.stringify(provider.requests[1]!.input)).not.toMatch(/context_set|memory_store|memory_retrieve/);
  });

  it('uses current fold instructions and preserves task-output precedence over whiteboard writes', async () => {
    const { agent, provider } = fixture([
      { calls: [{ id: 'accumulator', name: 'store_set', args: { store: 'whiteboard', key: '__fold_accumulator', description: 'Fallback', value: 999 } }] },
      { text: '2' }, { text: '5' },
    ]);
    agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!.set('values', 'Values to fold', [2, 3]);
    const result = await executeRoutine({ agent, definition: createRoutineDefinition({ name: 'Fold bridge', description: 'Accumulator', tasks: [
      { name: 'Fold', description: 'Accumulate.', controlFlow: { type: 'fold', source: 'values', initialValue: 0, resultKey: 'total', tasks: [{ name: 'Add', description: 'Add {{map.item}} to {{fold.accumulator}}' }] } },
    ] }) });
    expect(result.status).toBe('completed');
    expect(result.plan.tasks[0]!.result?.output).toBe('5');
    const instructions = JSON.stringify(provider.requests[0]!.input);
    expect(instructions).toContain('store_set');
    expect(instructions).toContain('takes precedence');
    expect(instructions).not.toMatch(/context_set|memory_store|memory_retrieve/);
    expect(JSON.stringify(provider.requests[2]!.input)).toContain('Add 3 to 2');
  });

  it('resolves a spilled dependency for map and cleans only routine-owned tiered notes', async () => {
    const source = JSON.stringify(['large-source-'.repeat(1800)]);
    const { agent, provider } = fixture([{ text: source }, { text: 'Processed the source.' }]);
    const notes = agent.context.getPlugin<WorkingMemoryPluginNextGen>('working_memory')!;
    await notes.store('host-note', 'Unrelated host data', 'keep', { tier: 'findings' });
    const result = await executeRoutine({ agent, definition: createRoutineDefinition({ name: 'Spilled map', description: 'Large source', tasks: [
      { name: 'Produce', description: 'Produce a large array.' },
      { name: 'Map', description: 'Process the array.', dependsOn: ['Produce'], controlFlow: { type: 'map', source: { task: 'Produce' }, tasks: [{ name: 'Process', description: 'Process the current item.' }] } },
    ] }) });
    expect(result.status).toBe('completed');
    expect(result.plan.tasks[1]!.result?.output).toEqual(['Processed the source.']);
    expect(provider.requests).toHaveLength(2); // No extraction model call or lost-source retry.
    expect((await notes.query()).entries.map(entry => entry.key)).toEqual(['findings.host-note']);
  });
});
