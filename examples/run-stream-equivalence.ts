/** Offline semantic parity under equivalent blocking-tool inputs. Build library first. */
import assert from 'node:assert/strict';
import { Agent, Connector, Vendor, StreamEventType } from '@everworker/oneringai';
import type { AgentLoopDiagnostics } from '@everworker/oneringai';
import { ScriptedLoopProvider } from './agent-loop/scripted-provider.js';

async function execute(mode: 'run' | 'stream') {
  const trace: string[] = [];
  let attempts = 0;
  const name = `equivalence-${mode}`;
  const provider = new ScriptedLoopProvider([
    { calls: [{ id: 'first', name: 'probe', args: {} }] },
    { calls: [{ id: 'second', name: 'probe', args: {} }] },
    { text: 'Verified result: 42.' },
  ]);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', maxIterations: 5,
    context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } },
    tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, output: { effect: 'read' },
      execute: async () => { trace.push(`read:${++attempts}`); if (attempts === 1) throw Error('Transient read'); return { value: 42 }; } }],
    hooks: { 'before:tool': async () => { trace.push('before:tool'); return {}; } },
    loopPolicy: { completion: context => ({ complete: context.observations.some(o => o.outcome?.status === 'succeeded') }) },
  });
  try {
    let loop: AgentLoopDiagnostics | undefined;
    if (mode === 'run') loop = (await agent.run('Find the verified result.')).loop;
    else for await (const event of agent.stream('Find the verified result.')) {
      if (event.type === StreamEventType.RESPONSE_COMPLETE) loop = event.loop;
    }
    assert.equal(loop?.status, 'completed');
    return { trace, attempts, calls: provider.requests.length, reason: loop.reason, recoveryAttempts: loop.recoveryAttempts };
  } finally { agent.destroy(); Connector.remove(name); }
}
const blocking = await execute('run');
const streaming = await execute('stream');
assert.deepEqual(streaming, blocking);
console.log(JSON.stringify({ run: blocking, stream: streaming }, null, 2));
console.log('Equivalent tool/hook decisions and host completion. Streamed text is provisional; JSON repair remains run-only.');

// A policy may stop on a tool-producing turn. The next request must still see
// its exact call/receipt, including when run() formats a separate JSON answer.
for (const mode of ['run', 'stream'] as const) {
  const name = `stopped-${mode}`; let writes = 0;
  const provider = new ScriptedLoopProvider([
    { calls: [{ id: 'submission', name: 'submit_local', args: { job: 'A42' } }] },
    ...(mode === 'run' ? [{ text: '{"message":"Host verification needed"}' }] : []),
    { text: 'The earlier receipt is available for host verification.' },
  ]);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', maxIterations: 1, loopPolicy: {},
    context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } },
    tools: [{ definition: { type: 'function', function: { name: 'submit_local', parameters: { type: 'object', properties: { job: { type: 'string' } } } } },
      output: { effect: 'write' }, execute: async () => { writes++; return { receipt: 'LOCAL_RECEIPT_A42' }; } }],
  });
  try {
    if (mode === 'run') assert.equal((await agent.run('Submit once', { responseFormat: { type: 'json_object' } })).loop?.reason, 'iteration_limit');
    else for await (const e of agent.stream('Submit once')) if (e.type === StreamEventType.RESPONSE_COMPLETE) assert.equal(e.loop?.reason, 'iteration_limit');
    await agent.run('Inspect the earlier receipt', { loopPolicy: null });
    const request = JSON.stringify(provider.requests.at(-1)!.input);
    assert.ok(request.includes('LOCAL_RECEIPT_A42') && request.includes('submission')); assert.equal(writes, 1);
    console.log(`${mode}: stopped call and receipt survive the next turn; one synthetic local write.`);
  } finally { agent.destroy(); Connector.remove(name); }
}
