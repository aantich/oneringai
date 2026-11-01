/** Explicit bounded file transfer. Actual SDKs with mock HTTP; no credentials or native CLI. */
import { Connector } from '@everworker/oneringai';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { offlineHarness } from './agent-runtime/harness-fixtures.js';

for (const driver of ['openai.agents.api', 'anthropic.managed.api'] as const) {
  const root = await mkdtemp(path.join(tmpdir(), 'onering-artifacts-')); const host = offlineHarness(driver, root);
  try {
    await writeFile(path.join(root, 'input.txt'), 'ACK');
    const session = await host.runtime.createAgent(host.definition).openSession(host.options);
    const result = await (await session.run('Generate the synthetic answer.')).result;
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    const artifact = result.artifacts.find(item => item.type === 'reference');
    if (artifact?.type !== 'reference') throw new Error('Expected a scoped native artifact');
    const saved = await session.downloadArtifact({ reference: artifact.reference, path: 'answer.txt' });
    if (await readFile(saved.path, 'utf8') !== 'ACK') throw new Error('Artifact differs');
    await session.uploadFile({ path: 'input.txt', mediaType: 'text/plain' });
    let foreignDenied = false;
    try { await session.downloadArtifact({ reference: artifact.reference.replace('native-session', 'foreign'), path: 'foreign.txt' }); } catch { foreignDenied = true; }
    if (!foreignDenied) throw new Error('Foreign artifact was accepted');
    console.log(JSON.stringify({ mocked: true, driver, bytes: saved.bytes, foreignDenied }));
    await host.runtime.deleteSession(session.reference(), { context: host.options.context });
  } finally { await host.runtime.destroy(); Connector.remove(host.options.execution.connector); await rm(root, { recursive: true, force: true }); }
}
