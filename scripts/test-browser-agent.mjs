// Tests the packaged browser condition. No source aliases or global shims.
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { startGateway } from '../examples/browser-node/gateway.ts';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const bundle = await build({ entryPoints: ['tests/fixtures/browser-qualification/agent-entry.ts'],
  bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022' });
if (!Object.keys(bundle.metafile.inputs).some(path => path.endsWith('dist/browser/index.js'))) throw new Error('Consumer did not resolve the packaged browser condition');
if (Object.keys(bundle.metafile.inputs).some(path => /dist\/index\.(js|cjs)$/.test(path))) throw new Error('Browser consumer resolved the Node root');
const code = bundle.outputFiles[0].contents;
const gateway = await startGateway({ assets: { '/bundle.js': { type: 'text/javascript', data: code } } });
let browser;
const hosts = [];
try {
 for (const [engine, launcher, options] of [['chromium', chromium, {}], ['firefox', firefox, {}], ['webkit', webkit, {}]]) {
  browser = await launcher.launch({ ...options, headless: true });
  const page = await browser.newPage(), errors = [], violations = [];
  page.on('pageerror', error => { errors.push(error.stack ?? String(error)); console.error('Browser error:', error.stack ?? String(error)); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.exposeFunction('reportCspViolation', value => violations.push(value));
  await page.addInitScript(() => globalThis.addEventListener('securitypolicyviolation', event => globalThis.reportCspViolation({ directive: event.effectiveDirective, blockedURI: event.blockedURI })));
  await page.goto(gateway.origin);
  await page.waitForFunction(() => typeof globalThis.runAgentScenario === 'function');
  const base = gateway.origin + '/gateway/' + engine;
  const normal = await page.evaluate(baseURL => globalThis.runAgentScenario(baseURL), base + '/page/v1');
  const retry = await page.evaluate(baseURL => globalThis.runAgentScenario(baseURL), base + '/retry/v1');
  const workerCall = data => page.evaluate(data => new Promise((resolve, reject) => {
    const worker = new Worker('/bundle.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker scenario timed out')); }, 30000);
    worker.onerror = error => { worker.terminate(); reject(new Error(error.message)); };
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.report); };
    worker.postMessage(data);
  }), data);
  const worker = await workerCall(base + '/worker/v1');
  const pageRegressions = await page.evaluate(baseURL => globalThis.runAgentRegressions(baseURL), base + '/regressions/page');
  const workerRegressions = await workerCall({ regressions: base + '/regressions/worker' });
  const largePage = await page.evaluate(() => globalThis.runLargeContextScenario(() => performance.memory?.usedJSHeapSize));
  const largeWorker = await workerCall('large-context');
  if (normal.modelCalls !== 4 || retry.modelCalls !== 5 || worker.modelCalls !== 4) throw new Error('Incorrect invocation/retry ownership: ' + JSON.stringify({ normal, retry, worker }));
  const authority = gateway.requests.filter(request => request.path.includes(`/${engine}/page/`) && !request.body.stream)[0]?.body;
  const trusted = [authority?.instructions ?? '', ...(authority?.input ?? []).filter(item => item.role === 'developer' || item.role === 'system').map(item => JSON.stringify(item))].join('\n');
  if (!trusted.includes('Use the application currency.') || trusted.includes('manual-note')) throw new Error('Plugin instruction/data authority changed');
  if (!JSON.stringify((authority?.input ?? []).filter(item => item.role === 'user')).includes('context_data')) throw new Error('Plugin contributor user data missing');
  const host = { engine, version: browser.version(), normal, retry, worker, pageRegressions, workerRegressions,
    largePage, largeWorker, errors, violations };
  hosts.push(host); console.log(JSON.stringify(host, null, 2));
  if (errors.length || violations.length) throw new Error(`${engine} page/CSP errors`);
  await browser.close(); browser = undefined;
 }
 const report = { bytes: code.byteLength, gzipBytes: gzipSync(code).byteLength, hosts, requests: gateway.requests.length, passed: true };
 if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
} finally { await browser?.close(); await gateway.close(); }
