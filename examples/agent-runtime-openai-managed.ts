/** Real SDK, mocked HTTP by default. Live mode is explicitly gated and remains unrun. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connector, Vendor } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import type { RuntimeSessionReference } from 'oneringai/agent-runtime';
import { OpenAIManagedDriver } from 'oneringai/agent-runtime/openai-managed';
import { openAIManagedFixture } from './agent-runtime/openai-managed-fixture.js';

const live = process.argv.includes('--live');
if (live && process.env.ONERINGAI_ALLOW_LIVE !== '1') throw new Error('Billable live mode requires ONERINGAI_ALLOW_LIVE=1 plus an authorized OPENAI_API_KEY. Project live testing remains paused.');
const key = live ? process.env.OPENAI_API_KEY : 'offline-placeholder'; if (!key) throw new Error('OPENAI_API_KEY is required');
const directory = await mkdtemp(path.join(tmpdir(), 'openai-managed-example-'));
Connector.create({ name: 'openai-managed-example', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: key } });
const wire = openAIManagedFixture({ dropFirstToolResult: 'after' }); let calls = 0;
const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new OpenAIManagedDriver(live ? {} : { createClient: wire.createClient })], sessionStorage: new FileRuntimeSessionStorage(directory), resolveTools: () => ({ fingerprint: 'example-host-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', description: 'Return a demonstration value', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { calls++; return { success: false, businessValue: 'demonstration' }; } }] }) }) });
let reference: RuntimeSessionReference | undefined;
try {
  const agent = runtime.createAgent({ id: 'managed', instructions: 'Call probe once, then return ACK.', tools: ['probe'] });
  const options = { execution: { driver: 'openai.agents.api', connector: 'openai-managed-example', model: 'gpt-6-astra' }, context: { userId: 'example' }, environment: { type: 'none' as const }, policy: { filesystem: 'denied' as const, commands: 'denied' as const, sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const, approvals: 'deny' as const, limits: { wallTimeMs: 60000 } } };
  console.log(await agent.inspect(options)); const session = await agent.openSession(options); reference = session.reference();
  const run = await session.run('Call probe and return ACK.', { requestId: 'first' });
  for await (const event of run.events()) console.log(event.type);
  const result = await run.result; if (result.status !== 'completed') throw new Error(JSON.stringify(result));
  if (!live && (calls !== 1 || wire.counts.inputs !== 1)) throw new Error('Repeated native input/tool action');
  console.log({ mocked: !live, outputText: result.outputText, calls, ...(live ? {} : { transport: wire.counts }) });
  await runtime.deleteSession(reference, { context: options.context }); reference = undefined;
} finally {
  if (reference) console.error('Keep recovery reference and control directory:', reference, directory);
  await runtime.destroy(); Connector.clear(); if (!reference) await rm(directory, { recursive: true, force: true });
}
