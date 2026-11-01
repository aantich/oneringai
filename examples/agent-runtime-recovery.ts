/** Actual producer/recovery processes, synthetic remote service, no provider calls. */
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from '@everworker/oneringai/agent-runtime';
import type { RuntimeSessionReference } from '@everworker/oneringai/agent-runtime';
import { readRemote, recoveryFixture } from './agent-runtime/recovery-fixture.js';

const [mode, directory, scenario] = process.argv.slice(2);
if (!mode) {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-restart-example-'));
  try {
    for (const kind of ['acknowledged', 'crashed-write']) {
      const scope = path.join(root, kind); await mkdir(scope);
      for (const phase of ['producer', 'recovery']) await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url), phase, scope, kind], { stdio: 'inherit' });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
      });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
} else {
  if (!directory || !['producer','recovery'].includes(mode)) throw new Error('Internal example mode requires a temporary directory');
  const fixture = recoveryFixture(directory, mode === 'producer' && scenario === 'crashed-write');
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [fixture.driver], resolveTools: fixture.resolveTools, sessionStorage: new FileRuntimeSessionStorage(path.join(directory, 'control')) }) });
  const context = { tenantId: 'offline', userId: 'owner' };
  try {
    if (mode === 'producer') {
      const session = await runtime.createAgent({ id: 'logical', instructions: 'Submit the synthetic job.', tools: ['submit_job'] }).openSession({ execution: { driver: fixture.driver.id, connector: 'synthetic', model: 'synthetic' }, context, policy: { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } });
      await writeFile(path.join(directory, 'reference.json'), JSON.stringify(session.reference()));
      const run = await session.run('original-input', { requestId: 'stable-input' });
      for await (const event of run.events()) if (event.type === 'tool.completed') break;
      await session.detach();
    } else {
      const reference = JSON.parse(await readFile(path.join(directory, 'reference.json'), 'utf8')) as RuntimeSessionReference;
      let foreignDenied = false;
      try { await runtime.resumeSession(reference, { context: { ...context, userId: 'foreign' } }); } catch { foreignDenied = true; }
      if (!foreignDenied) throw new Error('Foreign scope was admitted');
      const session = await runtime.resumeSession(reference, { context });
      const state = await session.inspectState(); if (!state.activeRunId) throw new Error('Original run identity was lost');
      const result = await (await session.getRun(state.activeRunId)).result;
      if (result.outputText !== 'ACK') throw new Error(JSON.stringify(result));
      const duplicate = await session.run('original-input', { requestId: 'stable-input' }); await duplicate.result;
      const remote = await readRemote(directory);
      if (remote.inputs !== 1 || remote.writes !== 1 || remote.acknowledgements !== 1) throw new Error(`Repeated work: ${JSON.stringify(remote)}`);
      console.log({ mocked: true, scenario, processes: 2, inputs: remote.inputs, externalWrites: remote.writes, foreignDenied, recovered: result.outputText });
      await runtime.deleteSession(reference, { context });
    }
  } finally { await runtime.destroy(); }
}
