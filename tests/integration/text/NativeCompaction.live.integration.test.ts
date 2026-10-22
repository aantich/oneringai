import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ITextProvider, InputItem, InContextMemoryPluginNextGen, EvidencePluginNextGen } from '../../../src/index.js';
import { Agent, BasePluginNextGen, Connector, ContextCompactionStrategy, ModelTask, Vendor } from '../../../src/index.js';
import { ContentType } from '../../../src/domain/entities/Content.js';
import { MessageRole } from '../../../src/domain/entities/Message.js';

dotenv.config({ quiet: true });
const enabled = process.env.RUN_NATIVE_COMPACTION_LIVE === '1';
const results: Array<Record<string, unknown>> = [];
afterAll(async () => {
  if (!enabled || !process.env.NATIVE_COMPACTION_REPORT_PATH) return;
  await mkdir(dirname(process.env.NATIVE_COMPACTION_REPORT_PATH), { recursive: true });
  await writeFile(process.env.NATIVE_COMPACTION_REPORT_PATH, JSON.stringify({ protocol: 'stage-16a-native-live-v1', recordedAt: new Date().toISOString(),
    scope: 'Bounded text/local-tools native protocol contracts and separate-process restart. No general quality, savings or release claim.', results }, null, 2) + '\n');
});
const providers = [
  { vendor: Vendor.OpenAI, key: 'OPENAI_API_KEY', model: process.env.NATIVE_OPENAI_MODEL ?? 'gpt-6-astra' },
  { vendor: Vendor.Anthropic, key: 'ANTHROPIC_API_KEY', model: process.env.NATIVE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6' },
];

class LiveSelectedData extends BasePluginNextGen {
  readonly name = 'live_selected_data';
  getInstructions() { return 'Current host data; answer directly without calling tools.'; }
  async getContent() { return 'CURRENT_SOURCE_16A'; }
  getContents() { return 'CURRENT_SOURCE_16A'; }
  getState() { return { revision: 1 }; }
  restoreState() { /* Host-owned stable live fixture. */ }
}

describe.skipIf(!enabled).sequential('Stage 16A native provider contracts', () => {
  for (const provider of providers) it(`${provider.vendor} compacts and continues through managed context`, async () => {
    const key = process.env[provider.key];
    if (!key) throw new Error(`Missing ${provider.key}`);
    const name = `native-live-${provider.vendor}`;
    const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 150000 } });
    Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: key } });
    const agent = Agent.create({ hooks: { 'before:llm': () => ({ modified: { max_output_tokens: 256 } }) }, connector: name, model: provider.model, thinking: { enabled: false },
      context: { model: provider.model, features: { workingMemory: false, inContextMemory: false, evidence: true },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 }, automatic: false }) } });
    try {
      for (let index = 0; index < 8; index++) {
        agent.context.addUserMessage(`Archive step ${index}. Project code is ORBIT_16A. The confirmed limit is 37. Summarize progress.`);
        agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: `Step ${index} completed. ORBIT_16A limit 37. ` + 'Routine historical progress details. '.repeat(200).trimEnd() }] }]);
      }
      const native = (agent as unknown as { _provider: ITextProvider })._provider.compaction!;
      const compactProbe = vi.spyOn(native, 'compact');
      const counter = vi.spyOn((agent as unknown as { _provider: ITextProvider })._provider.compaction!, 'countInput');
      const report = await agent.compactContext({ modelTask: task });
      const nativeResult = await compactProbe.mock.results[0]!.value;
      expect(report.history.status).toBe('compacted');
      expect(report.accounting).toBe('provider');
      expect(report.inputTokensAfter).toBeLessThan(report.inputTokensBefore!);
      const response = await agent.run('What are the project code and confirmed limit? Reply with both.', { modelTask: task });
      expect(response.output_text).toContain('ORBIT_16A');
      expect(response.output_text).toContain('37');
      const calls = agent.getModelUsage()!.invocations;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.find(call => call.purpose === 'compactor')!.usage!.total_tokens).toBeGreaterThan(0);
      expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
      results.push({ kind: 'compact-and-run', provider: provider.vendor, model: provider.model, report,
        countedFrames: await Promise.all(counter.mock.results.map(result => result.value)),
        canonicalShape: nativeResult.input.map((i: InputItem) => ({ type: i.type, role: i.type === 'message' ? i.role : undefined })),
        output: response.output_text, usage: task.snapshot() });
    } finally { agent.destroy(); task.destroy(); Connector.remove(name); vi.restoreAllMocks(); }
  }, 180_000);
  for (const provider of providers) it(`${provider.vendor} repeats compaction, restarts in a new process and streams without replay`, () => {
    if (!process.env[provider.key]) throw new Error(`Missing ${provider.key}`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('examples/native-context-recovery.ts'), `--live=${provider.vendor}`],
      { encoding: 'utf8', timeout: 175000 });
    results.push({ kind: 'repeated-native-restart-stream', provider: provider.vendor, exitCode: result.status,
      stdout: result.stdout, stderr: result.stderr });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('no action replay');
  }, 180_000);
  for (const provider of providers) it(`${provider.vendor} composes automatic native history with fresh selected data`, async () => {
    const key = process.env[provider.key]; if (!key) throw new Error(`Missing ${provider.key}`);
    const name = `native-selection-live-${provider.vendor}`;
    Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: key } });
    const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 150000 } });
    const agent = Agent.create({ connector: name, model: provider.model, thinking: { enabled: false },
      instructions: 'Answer directly from supplied context without using tools. Include requested identifiers exactly.',
      hooks: { 'before:llm': () => ({ modified: { max_output_tokens: 256 } }) },
      context: { model: provider.model, maxContextTokens: 22000, responseReserve: 300, criticalCompactionThreshold: .3,
        features: { workingMemory: false, inContextMemory: false, evidence: true }, assembly: { maxDataTokens: 200, timeoutMs: 1000 },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    agent.context.registerPlugin(new LiveSelectedData()); let collections = 0;
    agent.context.registerContextContributor('live_selected_data', { getRevision: () => 1, contribute: () => {
      collections++; return [{ id: 'fresh', text: 'Current host source identifier is CURRENT_SOURCE_16A.' }];
    } });
    const native = (agent as unknown as { _provider: ITextProvider })._provider.compaction!;
    const compact = vi.spyOn(native, 'compact');
    try {
      for (let index = 0; index < 8; index++) {
        agent.context.addUserMessage(`Progress ${index}: project ORBIT_16A, confirmed limit 37.`);
        agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: 'Routine historical progress details. '.repeat(200).trimEnd() }] }]);
      }
      const answer = await agent.run('Return the project code, confirmed limit and current host source identifier.', { modelTask: task });
      expect(answer.output_text).toContain('ORBIT_16A'); expect(answer.output_text).toContain('37'); expect(answer.output_text).toContain('CURRENT_SOURCE_16A');
      expect(compact).toHaveBeenCalledTimes(1); expect(collections).toBe(2); expect(agent.context.getState().nativeContinuation).toBeDefined();
      expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
      results.push({ kind: 'automatic-native-with-selection', provider: provider.vendor, collections, report: agent.context.lastPreparation?.compactionDetails,
        output: answer.output_text, usage: task.snapshot() });
    } finally { agent.destroy(); task.destroy(); Connector.remove(name); vi.restoreAllMocks(); }
  }, 180_000);
  for (const provider of providers) it(`${provider.vendor} preserves compaction-hook memory and recovers from a cancelled proof read`, async () => {
    const key = process.env[provider.key]; if (!key) throw new Error(`Missing ${provider.key}`);
    const name = `native-hook-live-${provider.vendor}`;
    Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: key } });
    const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 150000 } });
    const cancelledTask = new ModelTask({ limits: { maxCalls: 0, deadline: Date.now() + 150000 } });
    let hooks = 0;
    const agent = Agent.create({ connector: name, model: provider.model, thinking: { enabled: false },
      instructions: 'Answer directly from supplied context without using tools. Include the requested identifiers exactly.',
      hooks: { 'before:llm': () => ({ modified: { max_output_tokens: 256 } }) },
      lifecycleHooks: { beforeCompaction: async () => {
        hooks++; agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!
          .set('preserved', 'Preserved host note', 'HOOK_SOURCE_37', 'critical');
      } },
      context: { model: provider.model, maxContextTokens: 22000, responseReserve: 300, criticalCompactionThreshold: .3,
        features: { workingMemory: false, inContextMemory: true, evidence: true }, assembly: { maxDataTokens: 200, timeoutMs: 1000 },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) } });
    agent.context.registerPlugin(new LiveSelectedData()); let collections = 0;
    agent.context.registerContextContributor('live_selected_data', { getRevision: () => 1, contribute: () => {
      collections++; return [{ id: 'fresh', text: 'Current host source is CURRENT_SOURCE_16A.' }];
    } });
    let release: (() => void) | undefined;
    try {
      for (let index = 0; index < 8; index++) {
        agent.context.addUserMessage(`Progress ${index}: project ORBIT_16A, confirmed limit 37.`);
        agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: 'Routine historical progress details. '.repeat(200).trimEnd() }] }]);
      }
      const prompt = 'Return the project code, confirmed limit, preserved host note and current host source.';
      const answer = await agent.run(prompt, { modelTask: task });
      for (const exact of ['ORBIT_16A', '37', 'HOOK_SOURCE_37', 'CURRENT_SOURCE_16A']) expect(answer.output_text).toContain(exact);
      expect(hooks).toBe(1); expect(collections).toBe(3);
      const report = agent.context.lastPreparation?.compactionDetails; expect(report?.history.status).toBe('compacted');
      const storage = agent.context.getPlugin<EvidencePluginNextGen>('evidence')!.storage;
      let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<void>(resolve => { release = resolve; });
      vi.spyOn(storage, 'readRecord').mockImplementationOnce(async () => { entered(); await pending; return null; });
      const stopped = agent.run('Cancel this before any model call', { modelTask: cancelledTask }).then(() => undefined, error => error);
      await ready; agent.cancel('LIVE_PROOF_CANCEL');
      expect((await Promise.race([stopped, new Promise<undefined>(resolve => setTimeout(resolve, 1000))]))?.message).toBe('LIVE_PROOF_CANCEL');
      expect(cancelledTask.snapshot().totals.calls).toBe(0);
      // The real provider remains usable before the old backend read resolves.
      const recovered = await agent.run(prompt, { modelTask: task });
      for (const exact of ['ORBIT_16A', '37', 'HOOK_SOURCE_37', 'CURRENT_SOURCE_16A']) expect(recovered.output_text).toContain(exact);
      release!(); await stopped;
      expect(hooks).toBe(1); expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
      results.push({ kind: 'hook-memory-proof-cancellation-recovery', provider: provider.vendor, hooks, initialCollections: 3, report,
        output: answer.output_text, recoveredOutput: recovered.output_text, cancelledUsage: cancelledTask.snapshot(), usage: task.snapshot() });
    } finally { release?.(); agent.destroy(); task.destroy(); cancelledTask.destroy(); Connector.remove(name); vi.restoreAllMocks(); }
  }, 180_000);
  it('rejects oversized raw OpenAI instructions using the actual input-token endpoint without a model invocation', async () => {
    const selected = providers[0]!; const key = process.env[selected.key]; if (!key) throw new Error(`Missing ${selected.key}`);
    const name = 'native-raw-count-live'; Connector.create({ name, vendor: selected.vendor, auth: { type: 'api_key', apiKey: key } });
    const task = new ModelTask({ limits: { maxCalls: 1, deadline: Date.now() + 60000 } });
    const agent = Agent.create({ connector: name, model: selected.model,
      vendorOptions: { instructions: 'Actual provider counting must include these raw instructions. '.repeat(2000) },
      context: { model: selected.model, maxContextTokens: 2000, responseReserve: 200,
        features: { workingMemory: false, inContextMemory: false, evidence: true },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: 'native', automatic: false }) } });
    const native = (agent as unknown as { _provider: ITextProvider })._provider.compaction!;
    const count = vi.spyOn(native, 'countInput'), compact = vi.spyOn(native, 'compact');
    try {
      await expect(agent.run('Hello', { modelTask: task })).rejects.toThrow('cannot fit');
      expect(compact).not.toHaveBeenCalled(); expect(task.snapshot().totals.calls).toBe(0);
      const counts = await Promise.all(count.mock.results.map(result => result.value));
      expect(counts.length).toBeGreaterThan(0); expect(counts.every(tokens => tokens! > 1800)).toBe(true);
      results.push({ kind: 'oversized-raw-instructions', provider: selected.vendor, counts, modelCalls: task.snapshot().totals.calls, expectedFailure: 'CONTEXT_OVERFLOW' });
    } finally { agent.destroy(); task.destroy(); Connector.remove(name); vi.restoreAllMocks(); }
  }, 90_000);
});

describe.skipIf(!enabled).sequential('Stage 16A third-corrective native contracts', () => {
  for (const provider of providers) it(`${provider.vendor} preserves manual hook notes and continues with unchanged main thinking`, async () => {
    const key = process.env[provider.key]; if (!key) throw new Error(`Missing ${provider.key}`);
    const name = `native-manual-thinking-${provider.vendor}`;
    const fixed = provider.vendor === Vendor.Anthropic;
    const thinking = fixed ? { enabled: true, mode: 'enabled' as const, budgetTokens: 8192 } : { enabled: false };
    Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: key } });
    const task = new ModelTask({ limits: { maxCalls: 4, deadline: Date.now() + 150000 } });
    let hooks = 0;
    const agent = Agent.create({ connector: name, model: provider.model, thinking,
      instructions: 'Answer directly from supplied context without tools. Preserve exact identifiers.',
      hooks: { 'before:llm': () => ({ modified: { max_output_tokens: fixed ? 16384 : 256 } }) },
      lifecycleHooks: { beforeCompaction: async () => {
        hooks++; agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!
          .set('manual', 'Confirmed host note', 'MANUAL_HOOK_37', 'critical');
      } },
      context: { model: provider.model, features: { workingMemory: false, inContextMemory: true, evidence: true },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 }, automatic: false }) } });
    try {
      for (let index = 0; index < 8; index++) {
        agent.context.addUserMessage(`Progress ${index}: project ORBIT_16A, confirmed limit 37.`);
        agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
          content: [{ type: ContentType.OUTPUT_TEXT, text: 'Routine historical progress details. '.repeat(200).trimEnd() }] }]);
      }
      const report = await agent.compactContext({ target: 'history', modelTask: task });
      expect(report.history.status).toBe('compacted'); expect(report.trigger).toBe('manual'); expect(hooks).toBe(1);
      const response = await agent.run('Return the project code, confirmed limit and exact confirmed host note.', { modelTask: task });
      for (const marker of ['ORBIT_16A', '37', 'MANUAL_HOOK_37']) expect(response.output_text).toContain(marker);
      expect(hooks).toBe(1); expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
      expect(task.snapshot().invocations.map(call => call.purpose)).toEqual(['compactor', 'main']);
      results.push({ kind: 'manual-hook-fixed-thinking', provider: provider.vendor, model: provider.model, thinking, report,
        output: response.output_text, usage: task.snapshot() });
    } finally { agent.destroy(); task.destroy(); Connector.remove(name); }
  }, 180000);
});
