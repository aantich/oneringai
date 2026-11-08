import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('.', import.meta.url));
const expected = JSON.parse(await readFile(process.argv[2], 'utf8'));
const result = await build({
  entryPoints: [root + 'browser-entry.mjs'], bundle: true, write: false,
  platform: 'browser', format: 'esm', target: 'es2022', metafile: true,
  plugins: [{ name: 'comparison-types-only', setup(builder) {
    builder.onResolve({ filter: /^util\/$/ }, () => ({ path: fileURLToPath(new URL('../../../src/infrastructure/runtime/comparisonTypes.browser.ts', import.meta.url)) }));
  } }],
});
const output = result.outputFiles[0].contents;
const policy = "default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'";
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', policy);
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(output); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>P0 compatibility proof</title><script type="module" src="/bundle.js"></script>'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [], violations = [];
  page.on('pageerror', error => errors.push(error.stack ?? String(error)));
  await page.exposeFunction('reportCspViolation', value => violations.push(value));
  await page.addInitScript(() => globalThis.addEventListener('securitypolicyviolation', event => {
    globalThis.reportCspViolation({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
  }));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof globalThis.runQualification === 'function');
  const pageResult = await page.evaluate(expected => globalThis.runQualification(expected), expected);
  const workerResult = await page.evaluate(expected => new Promise((resolve, reject) => {
    const worker = new Worker('/bundle.js', { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Worker proof timed out')); }, 30000);
    worker.onerror = error => { clearTimeout(timeout); worker.terminate(); reject(new Error(error.message)); };
    worker.onmessage = ({ data }) => { clearTimeout(timeout); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.report); };
    worker.postMessage(expected);
  }), expected);
  const report = { browser: browser.version(), oracleNode: expected.node, policy, bytes: output.byteLength,
    gzipBytes: gzipSync(output).byteLength, page: pageResult, worker: workerResult, errors, violations,
    inputs: Object.keys(result.metafile.inputs) };
  report.passed = pageResult.passed && workerResult.passed && !errors.length && !violations.length;
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, inputs: report.inputs.length }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
