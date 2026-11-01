import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { AmosRuntimeController, type AmosRuntimeHost } from './AmosRuntimeController.js';

/** Explicit trusted executable bootstrap avoids another credential/tool configuration system. */
export async function runRuntimeCli(filename: string, dataDir: string): Promise<void> {
  const bootstrap = await import(pathToFileURL(path.resolve(filename)).href) as { createAmosRuntimeHost?: (dataDir: string) => Promise<AmosRuntimeHost> | AmosRuntimeHost };
  if (typeof bootstrap.createAmosRuntimeHost !== 'function') throw new Error('Runtime host module must export createAmosRuntimeHost(dataDir)');
  const host = await bootstrap.createAmosRuntimeHost(dataDir);
  const controller = new AmosRuntimeController(host, view => console.log(JSON.stringify(view)));
  let input: ReturnType<typeof createInterface> | undefined;
  let tail: Promise<void> = Promise.resolve();
  let inputEpoch = 0;
  const requestStop = () => { void controller.input('/stop').catch(error => console.error(String(error))); };
  const stop = () => { inputEpoch++; requestStop(); };
  process.on('SIGINT', stop);
  try {
    await controller.open();
    input = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    input.on('line', line => {
      if (line === '/stop') { stop(); return; }
      if (line === '/exit') { inputEpoch++; if (controller.snapshot().attached) requestStop(); }
      const epoch = inputEpoch;
      tail = tail.then(async () => {
        if (!line.startsWith('/') && epoch !== inputEpoch) { console.log(JSON.stringify({ type: 'diagnostic', message: 'Queued input cancelled before admission' })); return; }
        try { await controller.input(line); if (line === '/exit') input?.close(); }
        catch (error) { console.error(JSON.stringify({ type: 'error', message: String(error), reference: controller.snapshot().reference })); }
      });
    });
    await new Promise<void>(resolve => input!.once('close', resolve)); await tail;
  } finally { process.off('SIGINT', stop); input?.close(); await controller.close(); }
}
