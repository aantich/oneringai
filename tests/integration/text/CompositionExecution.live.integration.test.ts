import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ModelTask, StreamEventType, Vendor } from '../../../src/index.js';
import { acquireComposition, hasCompositionOwner } from '../../../src/core/execution/composition.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_COMPOSITION_EXECUTION_LIVE === '1';
const reports: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => {
  const path = process.env.COMPOSITION_EXECUTION_REPORT_PATH;
  if (!enabled || !path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ protocol: 'consumer-c2-live-v1', scope: 'Private composition binding; two tool-free calls per case; no external actions', reports }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('C2 live explicit composition accounting', () => {
  for (const p of providers) for (const mode of ['run', 'stream'] as const) {
    it(`${p.name} ${mode}: managed and direct calls share the borrowed task`, async () => {
      if (!p.key) throw new Error(`Missing ${p.name} credentials`);
      const name = `c2-${p.name}-${mode}`;
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const shared = new ModelTask({ limits: { maxCalls: 2 } });
      const host = new AbortController();
      const agent = Agent.create({ connector: name, model: p.model, thinking: { enabled: false }, temperature: 0,
        instructions: 'Return C2_BOUND exactly. No explanation.', emptyResponseRetry: { enabled: false },
        context: { model: p.model, features: { workingMemory: false, inContextMemory: false } },
        modelExecution: { maxOutputTokensPerCall: 64 },
      });
      const lease = acquireComposition(agent, { modelTask: shared, signal: host.signal });
      try {
        let text = '';
        if (mode === 'run') text = (await lease.run('Return C2_BOUND.')).output_text ?? '';
        else for await (const event of lease.stream('Return C2_BOUND.')) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        const reflection = await lease.direct('Return C2_BOUND exactly.', { purpose: 'verifier', instructions: 'Return only the literal marker C2_BOUND. No explanation, formatting or extra text.', thinking: { enabled: false }, maxOutputTokens: 64 });
        expect(text).toContain('C2_BOUND'); expect(reflection.output_text).toContain('C2_BOUND');
        expect(shared.snapshot().totals.calls).toBe(2);
        expect(shared.snapshot().invocations.map(x => x.purpose)).toEqual(['main', 'verifier']);
        await expect(agent.runDirect('unrelated')).rejects.toThrow(/owned/);
        lease.release(); expect(hasCompositionOwner(agent)).toBe(false); expect(shared.signal.aborted).toBe(false);
        reports.push({ provider: p.name, model: p.model, mode, passed: true, snapshot: shared.snapshot() });
      } catch (error) {
        reports.push({ provider: p.name, model: p.model, mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown', diagnostic: error instanceof Error && error.name === 'AssertionError' ? error.message : undefined, snapshot: shared.snapshot() });
        throw new Error(`C2 ${p.name}/${mode} failed; credentials omitted`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
      } finally { lease.close(); agent.destroy(); shared.destroy(); Connector.remove(name); }
    }, 90_000);
  }
});
