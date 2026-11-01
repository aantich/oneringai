import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { AmosRuntimeController, type AmosRuntimeHost } from './AmosRuntimeController.js';
import type { RuntimeSessionReference } from 'oneringai/agent-runtime';

/** Explicit trusted executable bootstrap avoids another credential/tool configuration system. */
export async function runRuntimeCli(filename: string, dataDir: string, resume?: RuntimeSessionReference): Promise<void> {
  const bootstrap = await import(pathToFileURL(path.resolve(filename)).href) as { createAmosRuntimeHost?: (dataDir: string) => Promise<AmosRuntimeHost> | AmosRuntimeHost };
  if (typeof bootstrap.createAmosRuntimeHost !== 'function') throw new Error('Runtime host module must export createAmosRuntimeHost(dataDir)');
  const configured = await bootstrap.createAmosRuntimeHost(dataDir);
  const host = resume ? { ...configured, resume } : configured;
  const controller = new AmosRuntimeController(host, view => console.log(JSON.stringify(view)));
  let input: ReturnType<typeof createInterface> | undefined;
  let tail: Promise<void> = Promise.resolve();
  let inputEpoch = 0;
  let terminating = false;
  const requestStop = () => { void controller.input('/stop').catch(error => console.error(String(error))); };
  const stop = () => { inputEpoch++; requestStop(); };
  const terminate = () => { terminating = true; stop(); input?.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', terminate);
  try {
    try { await controller.open(); }
    catch (error) {
      if (!controller.snapshot().reference) throw error;
      console.error(JSON.stringify({ type: 'error', message: String(error), reference: controller.snapshot().reference }));
    }
    if (terminating) return;
    input = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    input.on('line', line => {
      const command = line.trim();
      if (command === '/stop') { stop(); return; }
      if (command === '/exit') { inputEpoch++; if (controller.snapshot().attached) requestStop(); }
      const epoch = inputEpoch;
      tail = tail.then(async () => {
        if ((!command.startsWith('/') || /^\/run(?:\s|$)/.test(command)) && epoch !== inputEpoch) { console.log(JSON.stringify({ type: 'diagnostic', message: 'Queued input cancelled before admission' })); return; }
        try { await controller.input(line); if (command === '/exit') input?.close(); }
        catch (error) { console.error(JSON.stringify({ type: 'error', message: String(error), reference: controller.snapshot().reference })); }
      });
    });
    await new Promise<void>(resolve => input!.once('close', resolve)); await tail;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', terminate); input?.close(); await controller.close(); }
}
