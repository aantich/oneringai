import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, Vendor, StreamEventType, createOutcomeTool } from '../../../src/index.js';
import type { ToolExecutionOutcome, ToolResult } from '../../../src/index.js';

dotenv.config({ quiet: true });
const enabled = process.env.RUN_OUTCOME_TOOLS_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
const reports: Array<Record<string, unknown>> = [];
afterAll(async () => {
  if (!enabled || !process.env.OUTCOME_TOOLS_REPORT_PATH) return;
  await mkdir(dirname(process.env.OUTCOME_TOOLS_REPORT_PATH), { recursive: true });
  await writeFile(process.env.OUTCOME_TOOLS_REPORT_PATH, JSON.stringify({ protocol: 'consumer-c1-live-v1',
    scope: 'Real LLM run/stream with synthetic local tools; no external actions or quality/cost claim', reports }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('C1 live invocation-owned outcomes', () => {
  for (const provider of providers) for (const mode of ['run', 'stream'] as const) {
    it(`${provider.name} ${mode}: reported operational failure and valid business decline`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credential for explicitly enabled live test`);
      const name = `c1-${provider.name}-${mode}`;
      Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const raw = Object.freeze({ success: false, marker: 'C1_RAW_RESULT' });
      let modelCalls = 0, executions = 0;
      const admissions: Array<{ id: string; name: string; iteration: number }> = [];
      const definition = (toolName: string) => ({ type: 'function' as const, function: { name: toolName,
        parameters: { type: 'object', properties: {}, additionalProperties: false } } });
      const outcomes: ToolExecutionOutcome[] = []; const completed: ToolResult[] = [];
      const agent = Agent.create({ connector: name, model: provider.model, thinking: { enabled: false }, maxIterations: 4,
        temperature: 0,
        emptyResponseRetry: { enabled: false },
        instructions: 'For each response, call the one currently selected tool exactly once. Never emit two tool calls in a response and never retry a tool. When no tool is available, return C1_RAW_RESULT verbatim from the previous results.',
        tools: [createOutcomeTool({ definition: definition('declined_probe'), execute: async () => { executions++; return raw; } }),
          createOutcomeTool({ definition: definition('reported_probe'), execute: async (_args, invocation) => {
            executions++; invocation.reportFailure(new Error('C1_LOCAL_OPERATIONAL_FAILURE')); return raw;
          } })],
        context: { model: provider.model, features: { workingMemory: false, inContextMemory: false } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async context => {
          const target = ['declined_probe', 'reported_probe'][modelCalls++];
          context.options.max_output_tokens = 256; context.options.parallel_tool_calls = false;
          if (target) {
            context.options.tools = context.options.tools?.filter(tool => tool.type === 'function' && tool.function.name === target);
            context.options.tool_choice = { type: 'function', function: { name: target } };
          }
          else { context.options.tools = undefined; context.options.tool_choice = undefined; }
          return {};
        } },
      });
      agent.tools.on('tool:outcome', outcome => outcomes.push(outcome));
      agent.on('tool:complete', event => completed.push(event.result));
      agent.on('tool:start', event => admissions.push({ id: event.toolCall.id, name: event.toolCall.function.name, iteration: event.iteration }));
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('Call the one selected tool exactly once for this response.')).output_text ?? '';
        else for await (const event of agent.stream('Call the one selected tool exactly once for this response.')) {
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        }
        expect(text).toContain('C1_RAW_RESULT'); expect(modelCalls).toBe(3); expect(executions).toBe(2);
        expect(outcomes.map(outcome => outcome.status)).toEqual(['succeeded', 'failed']);
        expect(outcomes[1]?.error).toBe('C1_LOCAL_OPERATIONAL_FAILURE');
        expect(completed).toHaveLength(2); expect(completed[0]?.content).toBe(raw); expect(completed[1]?.content).toBe(raw);
        expect(agent.getMetrics()).toMatchObject({ toolCallCount: 2, toolSuccessCount: 1, toolFailureCount: 1 });
        reports.push({ provider: provider.name, model: provider.model, mode, passed: true, modelCalls, executions,
          identicalRawResults: true, admissions, statuses: outcomes.map(outcome => outcome.status) });
      } catch (error) {
        reports.push({ provider: provider.name, model: provider.model, mode, passed: false, modelCalls, executions,
          errorType: error instanceof Error ? error.name : 'unknown', admissions, statuses: outcomes.map(outcome => outcome.status) });
        throw new Error(`C1 ${provider.name} ${mode} failed; credentials omitted`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
      } finally { agent.destroy(); Connector.remove(name); }
    }, 120_000);
  }
});
