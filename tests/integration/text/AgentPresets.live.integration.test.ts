import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, Vendor, createAgentPreset, InMemoryEvidenceStorage, ModelTask, StreamEventType } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_AGENT_PRESETS_LIVE === '1';
const report: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => {
  if (!enabled || !process.env.AGENT_PRESETS_REPORT_PATH) return;
  await mkdir(dirname(process.env.AGENT_PRESETS_REPORT_PATH), { recursive: true });
  await writeFile(process.env.AGENT_PRESETS_REPORT_PATH, JSON.stringify({ protocol: 'stage12-live-v1', recordedAt: new Date().toISOString(), scope: 'Functional public-preset managed run/stream with forced local reads and acknowledged evidence. No external writes or general quality/cost claims.', report }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('Stage 12 real-provider preset smoke', () => {
  for (const p of providers) for (const preset of ['research', 'workflow'] as const) for (const mode of ['run', 'stream'] as const) {
    it(`${p.name} ${preset} ${mode}`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled live gate`);
      const name = `stage12-${p.name}-${preset}-${mode}`; const scope = { ownerId: 'stage12-host', namespace: name };
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const storage = new InMemoryEvidenceStorage({ scope }); const task = new ModelTask({ limits: { maxCalls: 4 } });
      let calls = 0, reads = 0, checks = 0;
      const agent = Agent.create(createAgentPreset(preset, { connector: name, model: p.model, userId: scope.ownerId,
        instructions: 'Use the host-selected local receipt read. Then state its artifact ID and ready status in one sentence under 30 words.',
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 256 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { features: { workingMemory: false, inContextMemory: false }, plugins: { evidence: { scope, storage }, taskState: { scope, taskId: 'T42' } } },
        ...(preset === 'workflow' ? { loopPolicy: { completion: () => { checks++; return { complete: reads === 1, reason: 'Host verified local A42 receipt.' }; } } } : {}),
        tools: [{ definition: { type: 'function', function: { name: 'read_artifact', description: 'Read synthetic artifact A42 status', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'read' }, execute: async () => { reads++; return { artifactId: 'A42', ready: true }; } }],
        hooks: { 'before:llm': async context => { calls++; if (calls === 1) { context.options.tool_choice = { type: 'function', function: { name: 'read_artifact' } }; context.options.parallel_tool_calls = false; } else { context.options.tools = undefined; context.options.tool_choice = undefined; } return {}; } },
      }));
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('Inspect A42.', { modelTask: task })).output_text ?? '';
        else for await (const event of agent.stream('Inspect A42.', { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        expect(text).toMatch(/A42/); expect(reads).toBe(1); expect(calls).toBe(2); expect(checks).toBe(preset === 'workflow' ? 1 : 0);
        expect(agent.getLoopDiagnostics()?.reason).toBe(preset === 'workflow' ? 'completed' : 'answer_returned');
        const entries = (await storage.list()).entries; expect(entries).toHaveLength(1);
        expect((await storage.readRecord(entries[0]!.reference))?.result).toEqual({ artifactId: 'A42', ready: true });
        report.push({ provider: p.name, model: p.model, preset, mode, passed: true, calls, reads, checks, loop: agent.getLoopDiagnostics(), usage: task.snapshot(), capabilities: agent.inspectCapabilities() });
      } catch (error) {
        report.push({ provider: p.name, model: p.model, preset, mode, passed: false, calls, reads, checks, errorType: error instanceof Error ? error.name : 'unknown' });
        throw Error(`Stage12 ${p.name}/${preset}/${mode} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
      } finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);
  }
});
