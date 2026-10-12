/** Offline by default; --live uses a configured named provider connector. */
import 'dotenv/config';
import { Connector, Vendor } from '../src/index.js';
import { createFixture, FIXTURE_IDS } from './agentic-baseline/fixtures.js';
import { runBaseline } from './agentic-baseline/runner.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const split = args.includes('--held-out') ? 'held-out' : 'development';
const connector = 'agentic-baseline-example';
const model = process.env.BASELINE_MODEL ?? 'gpt-4o-mini';
const vendor = process.env.BASELINE_VENDOR ?? 'openai';
const vendors = {
  openai: { vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY },
  anthropic: { vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY },
  google: { vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY },
};
const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once('SIGINT', cancel);
try {
  if (live) {
    const selected = vendors[vendor as keyof typeof vendors];
    if (!selected?.key) throw new Error('Select a supported BASELINE_VENDOR with its credential in .env');
    if (vendor !== 'openai' && !process.env.BASELINE_MODEL) throw new Error('Set BASELINE_MODEL for the selected vendor');
    Connector.create({ name: connector, vendor: selected.vendor, auth: { type: 'api_key', apiKey: selected.key } });
  }
  const reports = [];
  for (const id of FIXTURE_IDS) {
    if (controller.signal.aborted) break;
    reports.push(await runBaseline(createFixture(id, split), {
      connector: live ? connector : undefined, model, signal: controller.signal,
    }));
  }
  console.log(JSON.stringify({ protocol: 'stage-00-v1', split, mode: live ? 'live' : 'offline', reports }, null, 2));
  if (controller.signal.aborted || reports.some(report => !report.passed)) process.exitCode = 1;
} catch (error) {
  // Avoid printing provider errors that may contain request headers or payloads.
  console.error(error instanceof Error && !live ? error.message : 'Baseline setup or execution failed; check configuration.');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', cancel);
  if (live) Connector.remove(connector);
}
