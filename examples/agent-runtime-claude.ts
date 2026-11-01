import { Connector, Vendor } from '@everworker/oneringai';
import { AgentRuntime, LocalExecutionBackend } from '@everworker/oneringai/agent-runtime';
import { ClaudeAgentSdkDriver } from '@everworker/oneringai/agent-runtime/claude';
import { offlineClaudeSdk } from './agent-runtime/claude-fixture.js';

const live = process.argv.includes('--live');
if (live && process.env.ONERINGAI_ALLOW_LIVE !== '1') throw new Error('Billable live mode requires ONERINGAI_ALLOW_LIVE=1 and ANTHROPIC_API_KEY. Live testing remains paused by project policy.');
const key = live ? process.env.ANTHROPIC_API_KEY : 'offline-placeholder';
if (!key) throw new Error('ANTHROPIC_API_KEY is required');
Connector.create({ name: 'claude-example', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: key } });
const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new ClaudeAgentSdkDriver(live ? {} : { loadSdk: async () => offlineClaudeSdk })], resolveTools: () => ({ fingerprint: 'example-host-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', description: 'Return an offline demonstration value', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => ({ success: false, businessValue: 'demonstration' }) }] }) }) });
try {
  const agent = runtime.createAgent({ id: 'claude-example', instructions: 'Call probe and return ACK.', tools: ['probe'] });
  const options = { execution: { driver: 'anthropic.agent.sdk', connector: 'claude-example', model: 'claude-sonnet-4-6' }, context: { userId: 'example' }, policy: { filesystem: 'denied' as const, commands: 'denied' as const, sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const, approvals: 'deny' as const } };
  console.log(await agent.inspect(options));
  const session = await agent.openSession(options);
  for (const text of ['Call probe, return ACK.', 'Continue: call probe again, return ACK.']) {
    const run = await session.run(text); for await (const event of run.events()) console.log(event.type);
    const result = await run.result; if (result.status !== 'completed') throw new Error(JSON.stringify(result)); console.log({ mocked: !live, outputText: result.outputText });
  }
} finally { await runtime.destroy(); Connector.clear(); }
