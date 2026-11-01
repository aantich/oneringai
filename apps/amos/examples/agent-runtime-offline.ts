/** All public runtime operations through AMOS. Actual adapters, synthetic transports, no providers. */
import { Connector } from 'oneringai';
import type { AgentRunResult } from 'oneringai/agent-runtime';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AmosRuntimeController } from '../src/runtime/AmosRuntimeController.js';
import { harnessFixtureIds, offlineHarness } from '../../../examples/agent-runtime/harness-fixtures.js';

for (const driver of harnessFixtureIds) {
  const root = await mkdtemp(path.join(tmpdir(), 'amos-runtime-')); const host = offlineHarness(driver, root);
  const views: { type: string; data: unknown }[] = []; const controller = new AmosRuntimeController(host, view => views.push(view));
  try {
    await controller.open(); await controller.input('/help'); await controller.input('/inspect'); await controller.input('/reference');
    const firstInput = '/run {"input":"Use probe.","options":{"requestId":"first"}}';
    await controller.input(firstInput); await controller.wait();
    const first = views.filter(view => view.type === 'result').at(-1)?.data as AgentRunResult;
    if (first.outputText !== 'ACK' || host.calls() !== 1) throw new Error(JSON.stringify({ driver, first, calls: host.calls() }));
    await controller.input(firstInput); await controller.wait();
    await controller.input(`/result ${first.runId}`); await controller.input(`/observe ${JSON.stringify({ runId: first.runId, afterSequence: 0 })}`); await controller.wait();
    if (host.calls() !== 1) throw new Error('Request/result/activity replay repeated a tool action');
    let conflictDenied = false; try { await controller.input('/run {"input":"Changed input","options":{"requestId":"first"}}'); } catch { conflictDenied = true; }
    let transferred = false;
    if (driver.endsWith('.api')) {
      const artifact = first.artifacts.find(item => item.type === 'reference'); if (artifact?.type !== 'reference') throw new Error('Expected a native artifact');
      await writeFile(path.join(host.transferRoot, 'input.txt'), 'ACK');
      await controller.input('/upload {"path":"input.txt","mediaType":"text/plain"}');
      await controller.input(`/download ${JSON.stringify({ reference: artifact.reference, path: 'answer.txt' })}`);
      if (await readFile(path.join(host.transferRoot, 'answer.txt'), 'utf8') !== 'ACK') throw new Error('Downloaded artifact differs');
      transferred = true;
    }
    await controller.input('/run {"input":"Continue: use probe.","options":{"requestId":"second"}}'); await controller.wait();
    if (host.calls() !== 2) throw new Error('Continuation did not execute one action');
    let resumed = false;
    if (driver === 'oneringai.agent' || driver.endsWith('.api')) { await controller.input('/detach'); await controller.input('/resume'); resumed = true; }
    await controller.input('/status');
    let nativeCommandDenied = false; try { await controller.input('/context'); } catch { nativeCommandDenied = true; }
    if (!nativeCommandDenied || !conflictDenied) throw new Error('Expected native command/request conflict rejection');
    await controller.input('/delete'); if (controller.snapshot().reference !== null) throw new Error('Deleted reference survived');
    console.log(JSON.stringify({ mocked: true, driver, outputText: first.outputText, calls: host.calls(), conflictDenied, nativeCommandDenied, transferred, resumed, deleted: true }));
  } finally { await controller.close(); Connector.remove(host.options.execution.connector); await rm(root, { recursive: true, force: true }); }
}
