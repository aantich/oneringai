/** Offline C3: one submission, host reconciliation, post-step artifact, no replay. Build first. */
import { Agent, Connector, createRoutineDefinition, createRoutineRunner, ModelTask } from '@everworker/oneringai';
import { offlineRoutingConnector } from './model-routing/fixture.js';
const { connector, mainModel } = offlineRoutingConnector('verified-routine-example');
let submissions = 0, providerComplete = false, artifact = false;
const agent = Agent.create({ connector, model: mainModel,
  context: { model: mainModel, features: { workingMemory: false, inContextMemory: false } },
  modelExecution: { customProviderAttempts: 'single' },
  tools: [
    { definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } },
      output: { effect: 'write' }, execute: async () => ({ id: `submission-${++submissions}`, status: 'accepted' }) },
    { definition: { type: 'function', function: { name: 'artifact', parameters: { type: 'object', properties: {} } } },
      output: { effect: 'write' }, execute: async () => { artifact = true; return { id: 'artifact-1' }; } },
  ],
});
const modelTask = new ModelTask({ limits: { maxCalls: 2 } });
const runner = createRoutineRunner({ verify: observation => {
  if (observation.phase === 'task') return providerComplete ? { kind: 'verified' } : { kind: 'waiting', reason: 'Host must check remote completion' };
  return artifact ? { kind: 'verified' } : { kind: 'blocked', reason: 'Artifact missing' };
} });
try {
  const definition = createRoutineDefinition({ name: 'Verified delivery', description: 'Synthetic provider state',
    preSteps: [{ name: 'submit', toolName: 'submit', args: {} }],
    tasks: [{ name: 'observe', description: 'Report the synthetic submission. Do not call tools.' }],
    postSteps: [{ name: 'artifact', toolName: 'artifact', args: {} }],
  });
  const first = await runner.run({ definition, agent, execution: { modelTask } });
  if (first.state !== 'waiting' || submissions !== 1 || artifact) throw new Error('Incorrect waiting boundary');
  console.log('Waiting:', first.operationId, first.reason);
  providerComplete = true; // Trusted host/provider check, never model text or receipt inference.
  const final = await runner.resume(first.continuation, { authorize: () => true });
  if (final.state !== 'completed' || submissions !== 1 || !artifact || modelTask.snapshot().totals.calls !== 1) throw new Error('Replayed work or missing artifact');
  console.log('Completed: one submission, one model call, post-step artifact verified.');
} finally { runner.close(); agent.destroy(); modelTask.destroy(); Connector.remove(connector.name); }
