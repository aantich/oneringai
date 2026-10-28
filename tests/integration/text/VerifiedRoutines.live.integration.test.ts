import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ModelTask, Vendor } from '../../../src/index.js';
import { createRoutineRunner, createRoutineDefinition } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_VERIFIED_ROUTINES_LIVE === '1';
const reports: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => {
  const path = process.env.VERIFIED_ROUTINES_REPORT_PATH;
  if (!enabled || !path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ protocol: 'consumer-c3-live-v1', scope: 'Verified routine; one live model call per provider, synthetic local actions only', reports }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('C3 live verified routine cursor', () => {
  for (const p of providers) it(`${p.name}: one submission, host reconciliation and final artifact`, async () => {
    if (!p.key) throw new Error(`Missing ${p.name} credentials`);
    const name = `c3-${p.name}`;
    Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
    const shared = new ModelTask({ limits: { maxCalls: 1 } });
    let submitted = 0, confirmed = false, artifact = false;
    const agent = Agent.create({ connector: name, model: p.model, thinking: { enabled: false }, temperature: 0,
      instructions: 'Return C3_READY exactly. No tools.', emptyResponseRetry: { enabled: false },
      context: { model: p.model, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { maxOutputTokensPerCall: 64 },
      tools: [
        { definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: async () => ({ id: `synthetic-${++submitted}`, status: 'accepted' }) },
        { definition: { type: 'function', function: { name: 'artifact', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: async () => { artifact = true; return { id: 'synthetic-artifact' }; } },
      ],
    });
    // Deterministic actions use the same manager; prevent live models from calling them again.
    agent.on('beforeLLM', request => { request.tools = []; });
    const runner = createRoutineRunner({ verify: observation => observation.phase === 'task'
      ? confirmed ? { kind: 'verified' } : { kind: 'waiting', reason: 'Synthetic host confirmation pending' }
      : artifact ? { kind: 'verified' } : { kind: 'blocked', reason: 'Artifact missing' } });
    try {
      const definition = createRoutineDefinition({ name: 'C3 live', description: 'Synthetic only',
        preSteps: [{ name: 'submit', toolName: 'submit', args: {} }], tasks: [{ name: 'observe', description: 'Return C3_READY exactly.' }],
        postSteps: [{ name: 'artifact', toolName: 'artifact', args: {} }],
      });
      const first = await runner.run({ definition, agent, execution: { modelTask: shared } });
      expect(first.state).toBe('waiting'); expect(submitted).toBe(1); expect(artifact).toBe(false);
      if (!('continuation' in first)) throw new Error('Missing continuation');
      expect(first.observations[0]?.response?.output_text).toContain('C3_READY');
      confirmed = true;
      const last = await runner.resume(first.continuation, { authorize: () => true });
      expect(last.state).toBe('completed'); expect(submitted).toBe(1); expect(artifact).toBe(true); expect(shared.snapshot().totals.calls).toBe(1);
      reports.push({ provider: p.name, model: p.model, passed: true, submitted, artifact, snapshot: shared.snapshot() });
    } catch (error) {
      reports.push({ provider: p.name, model: p.model, passed: false, errorType: error instanceof Error ? error.name : 'unknown', snapshot: shared.snapshot() });
      throw new Error(`C3 ${p.name} failed; credentials omitted`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
    } finally { runner.close(); agent.destroy(); shared.destroy(); Connector.remove(name); }
  }, 90_000);
});
