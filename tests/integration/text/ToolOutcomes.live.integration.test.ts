import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, Vendor, StreamEventType } from '../../../src/index.js';
import type { ToolExecutionOutcome, ToolFunction } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_TOOL_OUTCOMES_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
const reports: Array<Record<string, unknown>> = [];
afterAll(async () => {
  if (!enabled || !process.env.TOOL_OUTCOMES_REPORT_PATH) return;
  await mkdir(dirname(process.env.TOOL_OUTCOMES_REPORT_PATH), { recursive: true });
  await writeFile(process.env.TOOL_OUTCOMES_REPORT_PATH, JSON.stringify({ protocol: 'stage-02', recordedAt: new Date().toISOString(),
    scope: 'One functional sample per provider/mode; real LLMs with local tools, no external side effects or quality/cost comparison', reports }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('Stage 02 live tool outcomes', () => {
  for (const provider of providers) for (const mode of ['run', 'stream'] as const) {
    it(`${provider.name} ${mode} distinguishes domain data from normalized execution failure`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credential for explicitly requested live test`);
      const name = `stage02-${provider.name}-${mode}`; Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const tools: ToolFunction[] = [
        { definition: { type: 'function', function: { name: 'domain_probe', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => ({ success: false, marker: 'DOMAIN_VALID' }) },
        { definition: { type: 'function', function: { name: 'failure_probe', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { throw new Error('LOCAL_FAILURE_VERIFIED'); } },
      ];
      let calls = 0; const outcomes: ToolExecutionOutcome[] = [];
      const choices: string[] = [];
      const agent = Agent.create({ connector: name, model: provider.model, tools, maxIterations: 4, thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        instructions: 'After both probes, report both marker strings verbatim. domain_probe returns business data; failure_probe fails locally. Do not retry either probe.',
        context: { model: provider.model, features: { workingMemory: false, inContextMemory: false } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async context => {
          const target = ['domain_probe', 'failure_probe'][calls++];
          // In-place options are supported by both managed modes; streaming
          // intentionally retains its legacy hook return-value semantics.
          context.options.max_output_tokens = 256;
          context.options.tool_choice = target ? { type: 'function', function: { name: target } } : 'auto';
          context.options.parallel_tool_calls = false;
          choices.push(target ?? 'auto');
          return {};
        } },
      });
      agent.tools.on('tool:outcome', o => outcomes.push(o));
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('Run the probes and report both markers.')).output_text ?? '';
        else for await (const event of agent.stream('Run the probes and report both markers.')) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        expect(text).toContain('DOMAIN_VALID'); expect(text).toContain('LOCAL_FAILURE_VERIFIED');
        expect(outcomes.map(o => o.status)).toEqual(['succeeded', 'failed']); expect(calls).toBeGreaterThanOrEqual(2); expect(calls).toBeLessThanOrEqual(3);
        expect(outcomes.map(o => ({ tool: o.toolName, status: o.status }))).toEqual([
          { tool: 'domain_probe', status: 'succeeded' }, { tool: 'failure_probe', status: 'failed' },
        ]);
        expect(agent.getMetrics()).toMatchObject({ toolCallCount: 2, toolSuccessCount: 1, toolFailureCount: 1 });
        reports.push({ provider: provider.name, model: provider.model, mode, passed: true, observedModelCalls: calls, choices, outcomes: outcomes.map(o => ({ tool: o.toolName, status: o.status, completion: o.completion })),
          metrics: { toolCalls: agent.getMetrics()?.toolCallCount, successful: agent.getMetrics()?.toolSuccessCount, failed: agent.getMetrics()?.toolFailureCount } });
      } catch (error) {
        reports.push({ provider: provider.name, model: provider.model, mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown',
          observedModelCalls: calls, choices, outcomes: outcomes.map(o => ({ tool: o.toolName, status: o.status, completion: o.completion })),
          metrics: { toolCalls: agent.getMetrics()?.toolCallCount, successful: agent.getMetrics()?.toolSuccessCount, failed: agent.getMetrics()?.toolFailureCount } }); throw error;
      } finally { agent.destroy(); Connector.remove(name); }
    }, 120_000);
  }
});
