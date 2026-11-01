/** Default: real SDK with fake HTTP/SSE, including budget wait and interruption. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Connector, Vendor } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import type { RuntimeSessionReference } from 'oneringai/agent-runtime';
import { ClaudeManagedDriver } from 'oneringai/agent-runtime/claude-managed';
import { claudeManagedFixture } from './agent-runtime/claude-managed-fixture.js';

const live = process.argv.includes('--live');
if (live && process.env.ONERINGAI_ALLOW_LIVE !== '1') throw new Error('Billable live mode requires ONERINGAI_ALLOW_LIVE=1 and ANTHROPIC_API_KEY. Project live testing remains paused.');
const key = live ? process.env.ANTHROPIC_API_KEY : 'offline-placeholder'; if (!key) throw new Error('ANTHROPIC_API_KEY is required');
const definition = { id: 'managed-claude-example', instructions: 'Call probe once, then return ACK.', tools: ['probe'] };
for (const scenario of live ? ['tool'] : ['tool','budget']) {
  const directory = await mkdtemp(path.join(tmpdir(), 'claude-managed-example-'));
  Connector.create({ name: 'claude-managed-example', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: key } });
  const wire = claudeManagedFixture({ budgetPause: scenario === 'budget', dropToolResult: scenario === 'tool' ? 'before' : undefined }); let calls = 0;
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new ClaudeManagedDriver({ ...(live ? {} : { createClient: wire.createClient }), ...(process.env.ANTHROPIC_WORKSPACE_ID ? { workspaceId: process.env.ANTHROPIC_WORKSPACE_ID } : {}) })], sessionStorage: new FileRuntimeSessionStorage(directory), resolveTools: () => ({ fingerprint: 'example-host-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', description: 'Return a demonstration value', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { calls++; return { success: false, businessValue: 'demonstration' }; } }] }) }) });
  let reference: RuntimeSessionReference | undefined;
  try {
    const agent = runtime.createAgent(definition);
    const options = { execution: { driver: 'anthropic.managed.api', connector: 'claude-managed-example', model: 'claude-sonnet-4-6', ...(scenario === 'budget' ? { driverConfig: { maxListCostUsdCents: '50' } } : {}) }, context: { userId: 'example' }, environment: { type: 'provider-managed' as const }, policy: { filesystem: 'denied' as const, commands: 'denied' as const, sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const, approvals: 'deny' as const, limits: { wallTimeMs: 60000 } } };
    console.log(await agent.inspect(options)); const session = await agent.openSession(options); reference = session.reference();
    const run = await session.run('Call probe, then return ACK.', { requestId: 'first' });
    if (scenario === 'budget') {
      let waiting = false;
      for (let count = 0; count < 500; count++) { if ((await session.inspectState()).waitReason === 'budget_reached') { waiting = true; break; } await delay(10); }
      if (!waiting) throw new Error('Synthetic budget wait was not observed'); console.log({ mocked: true, waiting: 'budget_reached', terminal: false }); await run.cancel('Offline demonstration stop');
    }
    const result = await run.result;
    if (result.status !== (scenario === 'budget' ? 'cancelled' : 'completed')) throw new Error(JSON.stringify(result));
    if (!live && (wire.counts.inputs !== 1 || calls !== (scenario === 'budget' ? 0 : 1))) throw new Error('Repeated input/tool action');
    console.log({ mocked: !live, scenario, status: result.status, outputText: result.outputText, hostToolCalls: calls });
    await runtime.deleteSession(reference, { context: options.context }); reference = undefined;
  } finally { if (reference) console.error('Keep recovery reference and control directory:', reference, directory); await runtime.destroy(); Connector.clear(); if (!reference) await rm(directory, { recursive: true, force: true }); }
}
