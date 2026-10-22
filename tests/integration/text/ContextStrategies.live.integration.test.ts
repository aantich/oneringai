import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, Vendor, ModelTask, StructuredSummaryStrategy, InMemoryEvidenceStorage, ContentType, MessageRole } from '../../../src/index.js';
import { GoogleTextProvider } from '../../../src/infrastructure/providers/google/GoogleTextProvider.js';
import type { ConversationCompactionReport } from '../../../src/index.js';
import { comparisonTasks, comparisonOrder, compareContextStrategy } from '../../../examples/context-strategy-comparison.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_CONTEXT_STRATEGIES_LIVE === '1';
const report: Array<Record<string, unknown>> = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
afterAll(async () => {
  if (!enabled || !process.env.CONTEXT_STRATEGY_REPORT_PATH) return;
  await mkdir(dirname(process.env.CONTEXT_STRATEGY_REPORT_PATH), { recursive: true });
  await writeFile(process.env.CONTEXT_STRATEGY_REPORT_PATH, JSON.stringify({ protocol: 'stage-07-live-v1', recordedAt: new Date().toISOString(), seed: 707,
    settings: { sourceRecoveryFeedback: 'bounded scoped notes selectors on errors; unchanged exact-answer and budgets', mainTemperature: 0, helperTemperature: 0, main: 'gpt-4o', helper: 'gpt-4o-mini', repetitions: 2, heldOutTasks: 6, maxCallsPerTask: 6, mainOutputCap: 768, helperOutputCap: 1024, helperInputCap: 24000, googleProbeHelperThinkingBudget: 128, googleProbeHelperOutputCap: 4096 },
    scope: 'Functional held-out synthetic local-task pilot plus three-provider structured compaction. No statistical non-inferiority, general quality/cost reduction, or external write claim.', report }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('Stage 07 live structured compaction and held-out comparison', () => {
  for (const entry of comparisonOrder(comparisonTasks['held-out'], 2)) {
    it(`held-out ${entry.task.id}/${entry.strategy}/${entry.repetition}`, async () => {
      const result = await compareContextStrategy(entry.task, entry.strategy, true); report.push({ ...result, repetition: entry.repetition, kind: 'comparison' });
      expect(result.passed, JSON.stringify(result.predicate)).toBe(true); expect(result.repeatedActions).toBe(0);
      expect(result.usage.totals.calls).toBeGreaterThan(0); expect(result.returnedMainModels.length).toBeGreaterThan(0);
      if (entry.strategy !== 'algorithmic') expect(result.compaction?.applied).toBe(true);
      if (entry.strategy === 'structured-summary') { expect(result.compaction?.fallback).toBeUndefined(); expect(result.compaction?.helperModel).toBeTruthy(); expect(result.usage.invocations.some(i => i.purpose === 'compactor' && i.outputValidation === 'passed')).toBe(true); }
    }, 150000);
  }
  for (const p of providers) for (const injectRecordedEmpty of p.name === 'google' ? [false, true] : [false]) it(`${p.name} automatic helper produces a valid referenced summary before main${injectRecordedEmpty ? ' after recorded empty-output injection' : ''}`, async () => {
    if (!p.key) throw new Error(`Missing ${p.name} key for explicitly enabled live test`);
    const capturedResponses: Array<Record<string, unknown>> = [];
    const originalGoogleGenerate = GoogleTextProvider.prototype.generate;
    let injected = false;
    const capture = p.name === 'google' ? vi.spyOn(GoogleTextProvider.prototype, 'generate').mockImplementation(async function (this: GoogleTextProvider, options) {
      const response = await originalGoogleGenerate.call(this, options);
      const originalText = response.output_text;
      const injectHere = injectRecordedEmpty && !injected && typeof options.input === 'string';
      if (injectHere) {
        injected = true;
        // Reproduce the exact recorded failure after an actual provider call.
        // The bounded repair that follows must also use the actual provider.
        const text = '{"completedWork":[],"activeWork":[],"constraints":[],"decisions":[],"uncertainties":[],"artifacts":[],"actionReceipts":[]}';
        response.output_text = text;
        response.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }];
      }
      capturedResponses.push({ requestShape: typeof options.input === 'string' ? 'text-packet' : 'managed-items', requestedThinking: options.thinking, model: response.model, status: response.status, stopReason: response.stop_reason, text: response.output_text, ...(injectHere ? { faultInjected: 'recorded-empty-summary', actualProviderText: originalText } : {}), outputTypes: response.output.map(item => item.type), usage: response.usage });
      return response;
    }) : undefined;
    const name = `stage07-live-${p.name}`; Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'live', namespace: name } });
    const task = new ModelTask({ limits: { maxCalls: 6, deadline: Date.now() + 120000 } });
    let mainCalls = 0;
    let repeats = 0, reads = 0; let diagnostic: ConversationCompactionReport | undefined;
    const marker = `EXACT_STAGE07_${p.name.toUpperCase()}`;
    const raw = { marker, padding: 'Older synthetic observation details. '.repeat(1000) };
    const reference = await storage.put({ version: 1, recordedAt: Date.now(), source: { toolName: 'lookup', callId: 'lookup-original', executionId: 'original', arguments: {}, principal: {}, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: raw });
    const agent = Agent.create({ connector: name, model: p.model, userId: 'live', thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, maxIterations: 4,
      modelExecution: { maxOutputTokensPerCall: 512, helpers: { compactor: { connector: name, model: p.model,
        thinking: p.name === 'google' ? { enabled: true, budgetTokens: 128 } : { enabled: false },
        ...(p.name === 'google' ? { temperature: 0 } : {}), maxInputTokens: 20000, maxOutputTokens: p.name === 'google' ? 4096 : 1024 } } },
      instructions: 'Use the earlier lookup or its referenced source. Return only the JSON marker, account and status. Account/status are exact user constraints. Never repeat lookup or claim an accepted job has completed. Always call read_source using an exact evidence ID before answering; its returned marker is the data value, not the evidence ID.',
      tools: [{ definition: { type: 'function', function: { name: 'lookup', description: 'Historical action; must never be repeated.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { repeats++; throw new Error('Do not repeat'); }, output: { effect: 'read' } },
        { definition: { type: 'function', function: { name: 'read_source', description: 'Bounded exact marker lookup by scoped evidence ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } } }, execute: async ({ id }: { id: string }) => {
          reads++; const ref = await storage.getReference(id); if (!ref) throw new Error('Missing source'); const record = await storage.readRecord(ref);
          const find = (value: unknown): string | undefined => { if (!value || typeof value !== 'object') return undefined; const data = value as Record<string, unknown>; if (typeof data.marker === 'string') return data.marker; for (const child of Object.values(data)) { const found = find(child); if (found) return found; } return undefined; };
          const exact = find(record?.result); if (!exact) throw new Error('Source has no marker'); return { marker: exact };
        }, output: { effect: 'read' } }],
      ...(p.name === 'google' ? { vendorOptions: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } } : {}),
      hooks: { 'before:llm': async context => { if (++mainCalls === 1) context.options.tool_choice = { type: 'function', function: { name: 'read_source' } }; return {}; } },
      context: { model: p.model, maxContextTokens: 6000, responseReserve: 512, criticalCompactionThreshold: 0.8,
        compactionStrategy: new StructuredSummaryStrategy({ preserveRecentTurns: 0, preserveRecentMessages: 0, maxSourceTokens: 20000, maxSummaryTokens: p.name === 'google' ? 4096 : 1024, fallback: 'error' }),
        features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage } } },
    });
    agent.on('llm:request', () => { diagnostic ??= agent.context.lastPreparation?.compaction; });
    try {
      agent.context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Exact constraints: account=live-scope, status=completion-unknown. The job was accepted; do not repeat it.' }] },
        { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'lookup-original', name: 'lookup', arguments: '{}' }] },
        { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'lookup-original', content: raw, evidence: { version: 1, executionId: 'original', status: 'stored', reference } }] }]);
      const response = await agent.run('Return the marker and exact original account/status.', { modelTask: task,
        responseFormat: { type: 'json_schema', name: 'probe', strict: true, schema: { type: 'object', properties: { marker: { type: 'string' }, account: { type: 'string' }, status: { type: 'string' } }, required: ['marker', 'account', 'status'], additionalProperties: false } } });
      const value = response.output_parsed ?? JSON.parse(response.output_text!);
      report.push({ kind: 'provider-probe', provider: p.name, injectRecordedEmpty, capturedResponses, model: response.model, parsed: value, diagnostic, repeats, reads, usage: task.snapshot() });
      expect(value).toEqual({ marker, account: 'live-scope', status: 'completion-unknown' }); expect(repeats).toBe(0); expect(reads).toBeGreaterThan(0); expect(diagnostic?.applied).toBe(true); expect(diagnostic?.fallback).toBeUndefined(); expect(diagnostic?.helperModel).toBeTruthy();
      if (p.name === 'google') expect(capturedResponses[0]!.requestedThinking).toEqual({ enabled: true, budgetTokens: 128 });
      if (injectRecordedEmpty) {
        expect(injected).toBe(true);
        expect(task.snapshot().invocations.slice(0, 2).map(i => [i.purpose, i.phase, i.outputValidation])).toEqual([['compactor', 'generation', 'failed'], ['compactor', 'repair', 'passed']]);
      } else expect(task.snapshot().invocations[0]).toMatchObject({ purpose: 'compactor', status: 'succeeded', outputValidation: 'passed' });
    } catch (error) { report.push({ kind: 'provider-probe-failure', provider: p.name, injectRecordedEmpty, capturedResponses, diagnostic, repeats, reads, usage: task.snapshot(), error: error instanceof Error ? error.name : 'unknown' }); throw error; }
    finally { capture?.mockRestore(); agent.destroy(); task.destroy(); Connector.remove(name); }
  }, 150000);
});
