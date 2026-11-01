/** One AMOS view consumer across all five real adapters with synthetic transports. */
import { Connector } from '@everworker/oneringai';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AmosRuntimeController } from '../src/runtime/AmosRuntimeController.js';
import { harnessFixtureIds, offlineHarness } from '../../../examples/agent-runtime/harness-fixtures.js';

for (const driver of harnessFixtureIds) {
  const root = await mkdtemp(path.join(tmpdir(), 'amos-runtime-')); const host = offlineHarness(driver, root);
  const views: { type: string; data: unknown }[] = []; const controller = new AmosRuntimeController(host, view => views.push(view));
  try {
    await controller.open(); await controller.input('Use probe.'); await controller.wait();
    const result = views.find(view => view.type === 'result')?.data as { outputText?: string } | undefined;
    if (result?.outputText !== 'ACK' || host.calls() !== 1) throw new Error(JSON.stringify({ driver, result, calls: host.calls() }));
    let nativeCommandDenied = false; try { await controller.input('/context'); } catch { nativeCommandDenied = true; }
    if (!nativeCommandDenied) throw new Error('Native command was accepted in runtime mode');
    console.log(JSON.stringify({ mocked: true, driver, outputText: result.outputText, calls: host.calls(), nativeCommandDenied }));
  } finally { await controller.close(); Connector.remove(host.options.execution.connector); await rm(root, { recursive: true, force: true }); }
}
