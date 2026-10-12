import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Connector, Vendor } from '../../../src/index.js';
import { createFixture, FIXTURE_IDS } from '../../../examples/agentic-baseline/fixtures.js';
import { runBaseline } from '../../../examples/agentic-baseline/runner.js';

dotenv.config({ quiet: true });
const enabled = process.env.RUN_AGENTIC_BASELINE_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: process.env.BASELINE_OPENAI_MODEL ?? 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: process.env.BASELINE_ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: process.env.BASELINE_GOOGLE_MODEL ?? 'gemini-2.5-flash' },
];
const reports: Array<Awaited<ReturnType<typeof runBaseline>>> = [];
const selected = process.env.BASELINE_LIVE_PROVIDERS?.split(',') ?? providers.map(provider => provider.name);
if (enabled && selected.some(name => !providers.some(provider => provider.name === name))) {
  throw new Error('BASELINE_LIVE_PROVIDERS must name openai, anthropic, or google');
}

afterAll(async () => {
  if (enabled && process.env.BASELINE_REPORT_PATH) {
    await mkdir(dirname(process.env.BASELINE_REPORT_PATH), { recursive: true });
    await writeFile(process.env.BASELINE_REPORT_PATH, JSON.stringify({
      protocol: 'stage-00-v1', recordedAt: new Date().toISOString(), selectedProviders: selected, sampleCountPerModelWorkloadSplit: 1,
      seed: null, temperature: null, thinking: { enabled: false },
      fixtureSettings: {
        maxIterations: 6, maxToolCalls: 6, maxOutputTokens: 512, maxExecutionTimeMs: 60_000,
        emptyResponseRetry: false, workingMemory: false, inContextMemory: false,
      },
      providerSettings: selected.includes('google') && providers.find(provider => provider.name === 'google')?.model === 'gemini-2.5-flash'
        ? { 'google/gemini-2.5-flash': { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } } : {},
      uncertainty: 'Pilot only; no comparative quality or cost conclusion.', reports,
    }, null, 2) + '\n');
  }
});

describe.skipIf(!enabled).sequential('Stage 00 live managed trajectories', () => {
  for (const provider of providers) {
    describe.skipIf(!selected.includes(provider.name))(provider.name, () => {
      it.each(FIXTURE_IDS)('%s completes with real LLM calls and local fixture tools', async id => {
        if (!provider.key) throw new Error(`Live baseline requires ${provider.name} credentials`);
        const name = `stage00-live-${provider.name}-${id}`;
        Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
        try {
          for (const split of ['development', 'held-out'] as const) {
            const report = await runBaseline(createFixture(id, split), { connector: name, model: provider.model });
            reports.push(report);
            expect(report.failure).toBeNull();
            expect(report.passed).toBe(true);
            expect(report.mode).toBe('live');
            expect(report.llmCalls).toBeGreaterThan(0);
            expect(report.usage.total.missingCalls).toBe(0);
            expect(report.usage.total.total).toBeGreaterThan(0);
            expect(report.correlationErrors).toBe(0);
            expect(report.repeatedToolCalls).toBe(0);
            expect(report.runs.map(run => run.outcome)).toEqual(id === 'external-workflow' ? ['cancelled', 'completed'] : ['completed']);
            expect(Connector.get(name).name).toBe(name); // Host-owned connector survives evaluation.
          }
        } finally { Connector.remove(name); }
      }, 120_000);
    });
  }
});
