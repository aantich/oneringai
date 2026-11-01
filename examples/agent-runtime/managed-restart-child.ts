/** Child fixture: public exports only. Producer intentionally exits without cleanup. */
import { Connector, Vendor } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import { OpenAIManagedDriver } from 'oneringai/agent-runtime/openai-managed';
import { ClaudeManagedDriver } from 'oneringai/agent-runtime/claude-managed';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [role, vendor, root, origin] = process.argv.slice(2) as [string, string, string, string];
if (!['produce', 'recover'].includes(role) || !['openai', 'claude'].includes(vendor) || !root || !origin?.startsWith('http://127.0.0.1:')) throw new Error('Invalid offline child fixture arguments');
const context = { userId: 'offline-owner' };
Connector.create({ name: 'native-mock', vendor: vendor === 'openai' ? Vendor.OpenAI : Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'offline-placeholder' }, baseURL: vendor === 'openai' ? `${origin}/v1` : origin });
const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')), drivers: [vendor === 'openai' ? new OpenAIManagedDriver() : new ClaudeManagedDriver()], resolveTools: () => ({ fingerprint: 'restart-tool-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => {
  let count = 0; try { count = Number(await readFile(path.join(root, 'effects'), 'utf8')); } catch { /* Initial synthetic service state. */ }
  await writeFile(path.join(root, 'effects'), String(count + 1)); return { businessValue: 'original' };
} }] }) }) });
try {
  if (role === 'produce') {
    const session = await runtime.createAgent({ id: 'restart', instructions: 'Use probe once.', tools: ['probe'] }).openSession({ execution: { driver: vendor === 'openai' ? 'openai.agents.api' : 'anthropic.managed.api', connector: 'native-mock', model: vendor === 'openai' ? 'gpt-6-astra' : 'claude-sonnet-4-6' }, environment: vendor === 'openai' ? { type: 'none' } : { type: 'provider-managed' }, context, policy: { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } });
    const run = await session.run('task', { requestId: 'original' });
    let observed: unknown; void run.result.then(value => { observed = value; }, error => { observed = String(error); });
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await (await fetch(`${origin}/fixture-status`)).json() as { deliveries: number };
      if (status.deliveries === 1) { await writeFile(path.join(root, 'reference.json'), JSON.stringify({ reference: session.reference(), runId: run.id })); process.exit(0); }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Synthetic native action did not reach its waiting state: ${JSON.stringify(observed)}`);
  }
  const saved = JSON.parse(await readFile(path.join(root, 'reference.json'), 'utf8'));
  const session = await runtime.resumeSession(saved.reference, { context });
  const result = await (await session.getRun(saved.runId)).result;
  if (result.status !== 'completed' || result.outputText !== 'ACK' || await readFile(path.join(root, 'effects'), 'utf8') !== '1') throw new Error(JSON.stringify(result));
  await runtime.deleteSession(saved.reference, { context });
  console.log(JSON.stringify({ mocked: true, vendor, recovered: result.outputText, effects: 1 }));
} finally { await runtime.destroy(); }
