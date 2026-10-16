/** Offline: build the package, then npm run example:feedback-agent. No keys/network. */
import assert from 'node:assert/strict';
import { Agent, Connector, Vendor, ModelTask } from '@everworker/oneringai';
import { ScriptedLoopProvider } from './agent-loop/scripted-provider.js';

let reads = 0;
let artifact: { id: string; verified: boolean } | undefined;
const provider = new ScriptedLoopProvider([
  { text: 'The task is complete.' },
  { calls: [{ id: 'read-1', name: 'read_artifact', args: {} }] },
  { calls: [{ id: 'read-2', name: 'read_artifact', args: {} }] },
  { text: 'Artifact A42 is ready and verified.' },
]);
Connector.create({ name: 'feedback-demo', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
const agent = Agent.create({
  connector: 'feedback-demo', model: 'gpt-4o-mini', maxIterations: 6,
  modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 128 },
  context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } },
  tools: [{
    definition: { type: 'function', function: { name: 'read_artifact', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
    output: { effect: 'read' },
    execute: async () => {
      if (++reads === 1) throw new Error('Synthetic transient read failure');
      artifact = { id: 'A42', verified: true };
      return artifact;
    },
  }],
  loopPolicy: {
    maxRecoveryAttempts: 2,
    completion: context => ({
      complete: artifact?.verified === true && context.observations.some(o => o.toolName === 'read_artifact' && o.outcome?.status === 'succeeded'),
      feedback: 'Read the required artifact and verify it before finishing.',
    }),
  },
});
const task = new ModelTask({ limits: { maxCalls: 4 } });
try {
  const response = await agent.run('Verify artifact A42.', { modelTask: task });
  assert.equal(response.loop?.status, 'completed');
  assert.equal(response.loop.recoveryAttempts, 2);
  assert.equal(reads, 2);
  assert.equal(provider.requests.length, 4);
  console.log(response.output_text);
  console.log(JSON.stringify(response.loop, null, 2));
  console.log('Premature prose rejected; one failed read recovered; host evidence check passed. Four synthetic calls, no writes.');
} finally { task.destroy(); agent.destroy(); Connector.remove('feedback-demo'); }
