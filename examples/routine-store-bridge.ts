/** Offline: npm run build && npm run example:routine-stores
 * No credentials/network. Exercise actual store tools and nested map/fold prompts
 * with a deterministic model substitute. This is not a live model quality test. */
import { Agent, Connector, Vendor, createRoutineDefinition, executeRoutine } from 'oneringai';
import { ScriptedLoopProvider } from './agent-loop/scripted-provider.js';

const provider = new ScriptedLoopProvider([
  { calls: [{ id: 'save', name: 'store_set', args: {
    store: 'whiteboard', key: '__task_output_Produce', description: 'Numbers', value: [2, 3],
  } }] },
  { text: 'Numbers stored.' },
  { text: '4' }, { text: '6' },
  { text: '4' }, { text: '10' },
]);
const connector = Connector.create({ name: 'routine-stores-offline', vendor: Vendor.OpenAI,
  auth: { type: 'none' }, options: { provider } });
const agent = Agent.create({ connector: connector.name, model: 'gpt-4o-mini' });
try {
  const execution = await executeRoutine({ agent, definition: createRoutineDefinition({
    name: 'Store, map, fold', description: 'Double two numbers, then sum the outputs.',
    tasks: [
      { name: 'Produce', description: 'Produce [2, 3] for the downstream map.' },
      { name: 'Double', description: 'Double each number.', dependsOn: ['Produce'], controlFlow: {
        type: 'map', source: { task: 'Produce' }, resultKey: 'doubled',
        tasks: [{ name: 'Double item', description: 'Return twice {{map.item}}.' }],
      } },
      { name: 'Sum', description: 'Sum the doubled numbers.', dependsOn: ['Double'], controlFlow: {
        type: 'fold', source: 'doubled', initialValue: 0, resultKey: 'total',
        tasks: [{ name: 'Add item', description: 'Add {{map.item}} to {{fold.accumulator}}. Return the new total.' }],
      } },
    ],
  }) });
  if (execution.status !== 'completed' || execution.plan.tasks[2]?.result?.output !== '10') throw new Error('Store/map/fold bridge failed');
  if (provider.requests.length !== 6 || JSON.stringify(provider.requests).match(/context_set|memory_store|memory_retrieve/)) throw new Error('Unexpected model calls or stale tool instructions');
  console.log('Completed: stored [2,3], mapped to [4,6], folded to 10; six offline model calls.');
} finally { agent.destroy(); Connector.remove(connector.name); }
