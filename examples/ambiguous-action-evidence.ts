/** Offline ambiguous-write receipt. No network, credentials, or external effects. Build first. */
import assert from 'node:assert/strict';
import { InMemoryEvidenceStorage, ToolEvidenceMiddleware, ToolManager } from '@everworker/oneringai';
const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'example-user', namespace: 'ambiguous-action' } });
const tools = new ToolManager({ toolExecutionTimeout: 0 });
tools.setToolContext({ userId: 'example-user' });
tools.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage }));
let simulatedWrites = 0;
let started!: () => void;
const startedPromise = new Promise<void>(resolve => { started = resolve; });
tools.register({ definition: { type: 'function', function: { name: 'ambiguous_write', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  output: { effect: 'write' }, execute: async () => {
    simulatedWrites++; started();
    // The service applied the change but never returned an acknowledgement.
    return new Promise<never>(() => undefined);
  } });
const controller = new AbortController();
try {
  const pending = tools.execute('ambiguous_write', {}, { signal: controller.signal, callId: 'original-call', runId: 'original-run' }).catch(error => error);
  await startedPromise; controller.abort(); const error = await pending;
  assert.equal(error.outcome.completion, 'unknown'); assert.equal(simulatedWrites, 1);
  const receipt = await storage.readRecord(error.outcome.evidence.reference);
  assert.equal(receipt?.source.completion, 'unknown'); assert.equal(receipt?.source.effect, 'write');
  console.log('Receipt: cancelled / completion unknown / effect write / original-call.');
  console.log('The simulated service applied one write. The framework has no completion evidence and does not retry.');
  console.log('Storage: process-local; configure FileEvidenceStorage or a durable custom backend for restart recovery.');
} finally { tools.destroy(); }
