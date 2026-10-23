/** Offline suspended JSON recovery. Build first; no credentials or network. */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, Connector, ContentType, FileContextStorage, FileCorrelationStorage, MessageRole, ModelTask, StorageRegistry, SuspendSignal } from '@everworker/oneringai';
import { offlineRoutingConnector } from './model-routing/fixture.js';

const directory = await mkdtemp(join(tmpdir(), 'routing-suspension-example-'));
const fixture = offlineRoutingConnector('routing-suspension-example');
StorageRegistry.configure({ correlations: new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }) });
const failedFinalization = process.argv.includes('--failed-finalization');
const task = new ModelTask({ limits: { maxCalls: failedFinalization ? 2 : 5 } });
const storage = new FileContextStorage({ agentId: 'suspension-example', baseDirectory: directory });
let calls = 0, waits = 0, checks = 0;
const generate = fixture.provider.generate.bind(fixture.provider);
fixture.provider.generate = async options => {
  const response = await generate(options);
  if (++calls === 1) return { ...response, output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT,
    content: [{ type: ContentType.TOOL_USE, id: 'wait-1', name: 'wait_event', arguments: '{}' }] }] };
  // Real providers can also return malformed text; run() retains bounded repair.
  const text = calls === (failedFinalization ? 2 : 3) ? 'NOT_JSON' : JSON.stringify({ answer: calls === 2 ? 'pending' : 'EVENT_CONFIRMED' });
  return { ...response, output_text: text, output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }] };
};
const agent = Agent.create({ connector: fixture.connector.name, model: fixture.mainModel,
  session: { storage, autoSave: false },
  context: { model: fixture.mainModel, features: { workingMemory: false, inContextMemory: false } },
  tools: [{ definition: { type: 'function', function: { name: 'wait_event', description: 'Register a synthetic wait', parameters: { type: 'object', properties: {} } } },
    execute: async () => { waits++; return SuspendSignal.create({ result: 'Waiting', correlationId: 'example:event' }); } }],
  loopPolicy: { maxRecoveryAttempts: 0, completion: candidate => { checks++; return { complete: JSON.parse(candidate.outputText).answer === 'EVENT_CONFIRMED' }; } },
  modelExecution: { customProviderAttempts: 'single', routing: { routes: { fast: { model: fixture.fastModel } }, select: () => 'fast' } },
});
try {
  if (failedFinalization) {
    const runOptions = { modelTask: task, responseFormat: { type: 'json_schema' as const, name: 'answer', strict: true,
      schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } };
    let denied = 0, published = 0;
    agent.on('execution:suspended' as never, () => { published++; });
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await agent.run(attempt === 0 ? 'Register the wait' : 'Event received', attempt === 0 ? runOptions : undefined); }
      catch (error) { if (error instanceof Error && error.message.includes('maxCalls')) denied++; else throw error; }
    }
    const saved = await storage.load(agent.getSessionId()!);
    const receipt = (saved?.state.metadata as Record<string, unknown>)?.suspensionFinalization;
    if (denied !== 3 || published !== 0 || waits !== 1 || calls !== 2 || !receipt || agent.getModelUsage()?.id !== task.id) throw new Error('Failed suspension lost its observation or budget');
    // Explicit host abandonment permits genuinely new work. It never undoes or
    // repeats the wait; archive/repair its actual receipt before destroying state.
    agent.cancel('Host explicitly abandons this pending execution');
    console.log(JSON.stringify({ denied, published, waits, calls, receipt,
      boundary: 'The failed formatting receipt is recoverable, not a successful suspended answer. Task authority remains process-local.' }, null, 2));
  } else {
  const suspended = await agent.run('Wait for confirmation', { modelTask: task, responseFormat: { type: 'json_schema', name: 'answer', strict: true,
    schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
  if (suspended.status !== 'suspended') throw new Error('Expected suspension');
  checks = 0;
  // The original format, route and ModelTask survive ordinary event resumption.
  const response = await agent.run('Confirmed event: EVENT_CONFIRMED');
  if ((response.output_parsed as { answer: string }).answer !== 'EVENT_CONFIRMED' || !response.loop?.completion?.complete
    || waits !== 1 || checks !== 1 || task.snapshot().totals.calls !== 4) throw new Error('Suspended recovery failed');
  console.log(JSON.stringify({ status: response.status, parsed: response.output_parsed, route: response.routing?.selectedRoute,
    waits, checks, calls: task.snapshot().totals.calls, lastPhase: task.snapshot().invocations.at(-1)?.phase,
    boundary: 'Synthetic transport. Local JSON parsing and a host predicate are separate checks; no external action is repeated.' }, null, 2));
  }
} finally {
  agent.destroy(); task.destroy(); Connector.remove(fixture.connector.name); StorageRegistry.reset();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
