import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ModelTask, StreamEventType, Vendor } from '../../../src/index.js';
import type { AgentLoopDiagnostics, AgentLoopPolicy } from '../../../src/index.js';

dotenv.config({ quiet: true });
const enabled = process.env.RUN_AGENT_LOOP_LIVE === '1';
const report: Array<Record<string, unknown>> = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => {
  if (!enabled || !process.env.AGENT_LOOP_REPORT_PATH) return;
  await mkdir(dirname(process.env.AGENT_LOOP_REPORT_PATH), { recursive: true });
  await writeFile(process.env.AGENT_LOOP_REPORT_PATH, JSON.stringify({ protocol: 'stage10-live-v1', recordedAt: new Date().toISOString(),
    scope: 'Functional run/stream recovery and completion refusal with real models and forced local read steps; no external writes, benchmark or general quality/cost claim.', report }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('Stage 10 live bounded managed policies', () => {
  for (const p of providers) for (const mode of ['run', 'stream'] as const) for (const scenario of ['recovery', 'blocked'] as const) {
    it(`${p.name} ${mode} ${scenario}`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled Stage 10 live gate`);
      const name = `stage10-${p.name}-${mode}-${scenario}`;
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      let calls = 0, reads = 0, ready = false, checks = 0;
      const task = new ModelTask({ limits: { maxCalls: 3 } });
      const agent = Agent.create({ connector: name, model: p.model, maxIterations: 4, thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        context: { model: p.model, features: { workingMemory: false, inContextMemory: false } },
        instructions: 'Follow the host-selected read steps. After a successful probe, report its ready status in one sentence under 30 words. If no probe is available, state in one sentence under 30 words that the artifact still needs verification.',
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        tools: scenario === 'recovery' ? [{
          definition: { type: 'function', function: { name: 'probe_recovery', description: 'Read the synthetic artifact status.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          output: { effect: 'read' }, execute: async () => { if (++reads === 1) throw Error('Synthetic transient read'); ready = true; return { artifactId: 'A42', ready: true }; },
        }] : [],
        hooks: { 'before:llm': async ctx => {
          calls++; ctx.options.max_output_tokens = 256;
          if (scenario === 'recovery' && calls <= 2) { ctx.options.tool_choice = { type: 'function', function: { name: 'probe_recovery' } }; ctx.options.parallel_tool_calls = false; }
          else { ctx.options.tools = undefined; ctx.options.tool_choice = undefined; }
          return {};
        } },
        loopPolicy: { maxRecoveryAttempts: scenario === 'blocked' ? 0 : 1, completion: ctx => {
          checks++; return { complete: ready && ctx.observations.some(o => o.toolName === 'probe_recovery' && o.outcome?.status === 'succeeded'), reason: ready ? 'Host artifact and receipt verified' : 'Artifact missing' };
        } },
      });
      try {
        let loop: AgentLoopDiagnostics | undefined;
        if (mode === 'run') loop = (await agent.run('Inspect the synthetic artifact.', { modelTask: task })).loop;
        else for await (const event of agent.stream('Inspect the synthetic artifact.', { modelTask: task })) if (event.type === StreamEventType.RESPONSE_COMPLETE) loop = event.loop;
        expect(checks).toBe(1);
        expect(reads).toBe(scenario === 'recovery' ? 2 : 0);
        expect(calls).toBe(scenario === 'recovery' ? 3 : 1);
        expect(loop?.reason).toBe(scenario === 'recovery' ? 'completed' : 'recovery_exhausted');
        expect(loop?.status).toBe(scenario === 'recovery' ? 'completed' : 'blocked');
        report.push({ provider: p.name, model: p.model, mode, scenario, passed: true, calls, reads, checks, loop, usage: task.snapshot() });
      } catch (error) {
        report.push({ provider: p.name, model: p.model, mode, scenario, passed: false, calls, reads, checks, loop: agent.getLoopDiagnostics(), errorType: error instanceof Error ? error.name : 'unknown' });
        throw Error(`Stage10 ${p.name}/${mode}/${scenario} failed; credentials omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
      } finally { task.destroy(); agent.destroy(); Connector.remove(name); }
    }, 120000);
  }
  for (const p of providers) for (const mode of ['run', 'stream'] as const) {
    it(`${p.name} ${mode} stopped read survives formatting and next managed input`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled Stage 10 live gate`);
      const name = `stage10-${p.name}-${mode}-stopped`;
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      let reads = 0, mainCalls = 0; const inputs: string[] = [];
      class Policy implements AgentLoopPolicy { #checks = 0; get checks() { return this.#checks; } completion() { this.#checks++; return { complete: false }; } }
      const policy = new Policy(); const task = new ModelTask({ limits: { maxCalls: 4 } });
      const agent = Agent.create({ connector: name, model: p.model, maxIterations: 1, loopPolicy: policy,
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 256 },
        context: { model: p.model, features: { workingMemory: false, inContextMemory: false } },
        instructions: 'Use the host-selected read tool when available. Otherwise give a brief status under 30 words. For requested JSON, return only an object with one string field named message.',
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        tools: [{ definition: { type: 'function', function: { name: 'read_stopped', description: 'Read a local synthetic receipt.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'read' }, execute: async () => { reads++; return { receipt: 'STOPPED_LIVE_A42' }; } }],
        hooks: { 'before:llm': async ctx => {
          mainCalls++; inputs.push(JSON.stringify(ctx.options.input));
          if (mainCalls === 1) { ctx.options.tool_choice = { type: 'function', function: { name: 'read_stopped' } }; ctx.options.parallel_tool_calls = false; }
          else { ctx.options.tools = undefined; ctx.options.tool_choice = undefined; }
          return {};
        } },
      });
      try {
        let loop: AgentLoopDiagnostics | undefined;
        if (mode === 'run') {
          const response = await agent.run('Read the synthetic receipt once.', { modelTask: task, responseFormat: { type: 'json_schema', name: 'status', schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } } });
          expect(response.output_parsed).toMatchObject({ message: expect.any(String) }); loop = response.loop;
        } else for await (const e of agent.stream('Read the synthetic receipt once.', { modelTask: task })) if (e.type === StreamEventType.RESPONSE_COMPLETE) loop = e.loop;
        expect(loop?.reason).toBe('iteration_limit'); expect(reads).toBe(1); expect(policy.checks).toBe(0);
        expect(agent.context.getCurrentInput()).toHaveLength(0);
        await agent.run('Inspect the earlier receipt without another tool.', { modelTask: task, loopPolicy: null });
        expect(inputs[1]).toContain('STOPPED_LIVE_A42'); expect(inputs[1]).toContain('read_stopped');
        expect(reads).toBe(1); expect(mainCalls).toBe(2);
        report.push({ provider: p.name, model: p.model, mode, scenario: 'stopped-history', passed: true, reads, mainCalls, loop, usage: task.snapshot() });
      } catch (error) {
        report.push({ provider: p.name, model: p.model, mode, scenario: 'stopped-history', passed: false, reads, mainCalls, errorType: error instanceof Error ? error.name : 'unknown' });
        throw Error(`Stage10 ${p.name}/${mode}/stopped-history failed; credentials omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
      } finally { task.destroy(); agent.destroy(); Connector.remove(name); }
    }, 120000);
  }
});
