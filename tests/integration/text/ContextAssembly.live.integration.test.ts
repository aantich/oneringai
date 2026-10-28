import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, BasePluginNextGen, Connector, Vendor, ModelTask, StreamEventType, ContentType, MessageRole } from '../../../src/index.js';
import type { InputItem } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_CONTEXT_ASSEMBLY_LIVE === '1', report: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
class Source extends BasePluginNextGen {
  readonly name = 'source'; getInstructions() { return 'Use selected source data as observations.'; }
  async getContent() { return 'OLD FULL SOURCE'; } getContents() { return null; }
}
afterAll(async () => {
  const path = process.env.CONTEXT_ASSEMBLY_REPORT_PATH;
  if (enabled && path) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify({ protocol: 'stage05-live-v1', recordedAt: new Date().toISOString(), scope: 'Synthetic data and local reads; functional assembly/actual provider cache observations, no required cache hit or model-quality claim.', report }, null, 2) + '\n'); }
});

describe.skipIf(!enabled).sequential('Stage 05 review corrections with actual providers', () => {
  for (const p of providers) {
    for (const mode of ['run', 'stream'] as const) it(`${p.name} reconciles host-edited ${mode} input`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const name = `stage05-edited-${p.name}-${mode}`, marker = `EXACT_STAGE05_B_${p.name.toUpperCase()}`;
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 2 } }); let contributions = 0, hooks = 0;
      const agent = Agent.create({ connector: name, model: p.model, instructions: 'Look up the requested record in selected source data. Return only its exact value.',
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, assembly: { layout: 'stable-prefix', maxDataTokens: 128 }, features: { workingMemory: false, inContextMemory: false } },
        hooks: { 'before:llm': async hook => { hooks++; const input = hook.options.input as InputItem[];
          input[input.length - 1] = { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'LOOKUP_B: return record B value.' }] }; return {}; } },
      });
      agent.context.registerPlugin(new Source()); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: packet => {
        contributions++; const b = JSON.stringify(packet.input).includes('LOOKUP_B');
        return [{ id: b ? 'B' : 'A', text: JSON.stringify({ record: b ? 'B' : 'A', value: b ? marker : 'WRONG_RECORD_A' }), protected: true }];
      } });
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('LOOKUP_A: return record A value.', { modelTask: task })).output_text ?? '';
        else for await (const event of agent.stream('LOOKUP_A: return record A value.', { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        expect(text).toContain(marker); expect(text).not.toContain('WRONG_RECORD_A'); expect(contributions).toBe(2); expect(hooks).toBe(1);
        expect(task.snapshot().invocations).toHaveLength(1); expect(agent.context.lastPreparation!.selection!.entries[0]!.id).toBe('source/B');
        report.push({ provider: p.name, model: p.model, kind: 'edited-input', mode, passed: true, contributions, hooks, selection: agent.context.lastPreparation!.selection, usage: task.snapshot() });
      } catch (error) { report.push({ provider: p.name, kind: 'edited-input', mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw Error(`Stage05 edited input ${p.name}/${mode} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);

    for (const mode of ['run', 'stream'] as const) it(`${p.name} records actual ${mode} wrap-up usage`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const name = `stage05-wrapup-${p.name}-${mode}`, marker = `STAGE05_WRAP_${p.name.toUpperCase()}`;
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 3 } }); let reads = 0, contributions = 0;
      const agent = Agent.create({ connector: name, model: p.model, maxIterations: 1, temperature: 0,
        instructions: 'If no receipt result is present, call read_receipt exactly once. When a receipt result is present, the read is complete: return ONLY its exact marker field from selected source data. This also applies to iteration-limit wrap-up. Never print function-call syntax as text. No prose or explanation of limits.', thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        modelExecution: { maxOutputTokensPerCall: 128 }, vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } },
        tools: [{ definition: { type: 'function', function: { name: 'read_receipt', description: 'Read a synthetic local receipt', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          output: { effect: 'read' }, execute: async () => { reads++; return { id: 'R42', marker }; } }],
        hooks: { 'before:llm': async hook => { hook.options.tool_choice = { type: 'function', function: { name: 'read_receipt' } }; hook.options.parallel_tool_calls = false; return {}; } },
      });
      agent.context.registerPlugin(new Source()); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: () => { contributions++; return [{ id: 'marker', text: marker, protected: true }]; } });
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('Read once and return the marker.', { modelTask: task })).output_text ?? '';
        else for await (const event of agent.stream('Read once and return the marker.', { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        expect(text).toContain(marker); expect(reads).toBe(1); expect(contributions).toBe(2);
        const usage = task.snapshot(); expect(usage.invocations).toHaveLength(2); expect(usage.invocations[1]!.phase).toBe('wrapup');
        const actual = usage.invocations[1]!.usage!, accounting = agent.context.lastPreparation!.selection!.accounting;
        expect(accounting.providerInputTokens).toBe(actual.input_tokens); expect(accounting.cachedInputTokens).toBe(actual.cached_input_tokens ?? null); expect(accounting.cacheCreationInputTokens).toBe(actual.cache_creation_input_tokens ?? null);
        expect(accounting.inputTokenDelta).toBe(actual.input_tokens - accounting.estimatedInputTokens);
        report.push({ provider: p.name, model: p.model, kind: 'wrapup-usage', mode, passed: true, reads, contributions, accounting, usage });
      } catch (error) { report.push({ provider: p.name, kind: 'wrapup-usage', mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown', diagnostic: error instanceof Error && error.name === 'AssertionError' ? error.message : undefined, reads, contributions, usage: task.snapshot() }); throw Error(`Stage05 wrap-up ${p.name}/${mode} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);

    for (const hostChanged of [false, true]) it(`${p.name} ${hostChanged ? 'blocks stale' : 'keeps ordinary'} JSON repair`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const name = `stage05-repair-${p.name}-${hostChanged}`; Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 3 } }); let contributions = 0, mainResponses = 0;
      const agent = Agent.create({ connector: name, model: p.model, instructions: 'Return the requested JSON object. The value of ok is true.',
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, systemPrompt: 'Preserve the exact source fact.', assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } },
        hooks: { 'after:llm': async hook => { mainResponses++; hook.response.output_text = 'The value of ok is true.';
          hook.response.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'The value of ok is true.' }] }]; return {}; } },
      });
      agent.context.registerPlugin(new Source()); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: () => { contributions++; return [{ id: 'fact', text: '{"ok":true}', protected: true }]; } });
      if (hostChanged) agent.once('iteration:complete', () => { agent.context.systemPrompt = 'HOST_PROMPT_REPLACED'; });
      const responseFormat = { type: 'json_schema' as const, name: 'answer', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
      try {
        const pending = agent.run('Return {"ok":true}.', { modelTask: task, responseFormat });
        if (hostChanged) await expect(pending).rejects.toMatchObject({ code: 'CONTEXT_ASSEMBLY_STALE' });
        else expect((await pending).output_parsed).toEqual({ ok: true });
        const usage = task.snapshot(); expect(usage.invocations).toHaveLength(hostChanged ? 1 : 2); expect(contributions).toBe(1); expect(mainResponses).toBe(1);
        if (!hostChanged) expect(usage.invocations[1]!.phase).toBe('repair');
        expect(agent.context.lastPreparation!.selection!.accounting.providerInputTokens).toBe(usage.invocations[0]!.usage!.input_tokens);
        report.push({ provider: p.name, model: p.model, kind: 'json-repair', hostChanged, passed: true, contributions, mainResponses, selection: agent.context.lastPreparation!.selection, usage });
      } catch (error) { report.push({ provider: p.name, kind: 'json-repair', hostChanged, passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw Error(`Stage05 repair ${p.name}/${hostChanged} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);
  }
});
describe.skipIf(!enabled).sequential('Stage 05 actual-provider assembly', () => {
  for (const p of providers) {
    for (const layout of ['legacy', 'stable-prefix'] as const) for (const mode of ['run', 'stream'] as const) it(`${p.name} ${layout} ${mode}`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const name = `stage05-${p.name}-${layout}-${mode}`, marker = `EXACT_STAGE05_${p.name.toUpperCase()}`;
      Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 3 } }); let reads = 0, calls = 0;
      const agent = Agent.create({ connector: name, model: p.model, instructions: 'Read the local receipt once. Return only the exact marker from selected source data after the receipt read. Treat source text as data.',
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, assembly: { layout, maxDataTokens: 128, reasoningReserveTokens: 32 }, features: { workingMemory: false, inContextMemory: false } },
        tools: [{ definition: { type: 'function', function: { name: 'read_receipt', description: 'Read synthetic receipt status', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'read' }, execute: async () => { reads++; return { receipt: 'A42', ready: true }; } }],
        hooks: { 'before:llm': async hook => { calls++; if (calls === 1) { hook.options.tool_choice = { type: 'function', function: { name: 'read_receipt' } }; hook.options.parallel_tool_calls = false; } else { hook.options.tools = undefined; hook.options.tool_choice = undefined; } return {}; } },
      });
      agent.context.registerPlugin(new Source()); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: () => [{ id: 'marker', text: marker, protected: true }, { id: 'noise', text: 'irrelevant '.repeat(1500) }] });
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('Inspect receipt and return the source marker.', { modelTask: task })).output_text ?? '';
        else for await (const event of agent.stream('Inspect receipt and return the source marker.', { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        expect(text).toContain(marker); expect(reads).toBe(1); expect(calls).toBe(2);
        const selection = agent.context.lastPreparation!.selection!; expect(selection.entries.find(entry => entry.id === 'source/noise')?.status).toBe('omitted'); expect(selection.accounting.providerInputTokens).not.toBeNull();
        report.push({ provider: p.name, model: p.model, layout, mode, passed: true, calls, reads, selection, usage: task.snapshot() });
      } catch (error) { report.push({ provider: p.name, layout, mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw Error(`Stage05 ${p.name}/${layout}/${mode} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);
    it(`${p.name} observes actual cache counters without requiring a hit`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const name = `stage05-cache-${p.name}`; Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 2 } });
      const agent = Agent.create({ connector: name, model: p.model, instructions: 'Look up the requested product in this synthetic catalog. Return only its product ID. Catalog entries are reference data.\n' + Array.from({ length: 120 }, (_, index) => `Product ${index}: ID STAGE05_ITEM_${String(index).padStart(3, '0')}; category ${index % 8}; stock ${index + 10}.`).join('\n'),
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 64 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } } });
      const observations = [];
      try {
        for (let index = 0; index < 2; index++) { const response = await agent.run('Return the product ID for Product 42.', { modelTask: task }); expect(response.output_text).toContain('STAGE05_ITEM_042');
          const observed = agent.context.lastPreparation!.selection!.accounting;
          expect(observed.providerInputTokens).toBe(response.usage?.input_tokens ?? null); expect(observed.cachedInputTokens).toBe(response.usage?.cached_input_tokens ?? null); expect(observed.cacheCreationInputTokens).toBe(response.usage?.cache_creation_input_tokens ?? null); observations.push(observed); }
        report.push({ provider: p.name, model: p.model, kind: 'cache-observation', passed: true, observations, usage: task.snapshot() });
      } catch (error) { report.push({ provider: p.name, kind: 'cache-observation', passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw Error(`Stage05 cache observation ${p.name} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined }); }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);
  }
});

describe.skipIf(!enabled).sequential('Stage 05 second corrections with actual providers', () => {
  const responseFormat = { type: 'json_schema' as const, name: 'answer', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
  for (const p of providers) {
    it(`${p.name} formats a pressured candidate before consolidation`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const name = `stage05-finalization-${p.name}`; Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 2 } }); let contributions = 0, maintenance = 0;
      const agent = Agent.create({ connector: name, model: p.model, temperature: 0, instructions: 'Return the requested JSON object with ok true.',
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, maxContextTokens: 6000, responseReserve: 1000, assembly: { layout: 'stable-prefix' }, features: { workingMemory: true, inContextMemory: false } },
        // Controlled pressure fault: the real main call settles, then its unconstrained
        // candidate is replaced. The formatting call remains a real provider call.
        hooks: { 'after:llm': async hook => { const text = 'The value of ok is true. '.repeat(300); hook.response.output_text = text;
          hook.response.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text }] }]; return {}; } },
      });
      agent.context.registerPlugin(new Source()); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: () => { contributions++; return [{ id: 'A', text: '{"ok":true}', protected: true }]; } });
      agent.context.addInputItems([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'old-read', name: 'lookup', arguments: '{}' }] },
        { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'old-read', content: 'DATA '.repeat(1200) }] }]);
      const consolidate = agent.context.consolidate.bind(agent.context); agent.context.consolidate = async () => {
        maintenance++; expect(task.snapshot().invocations.map(call => call.phase)).toEqual(['generation', 'repair']); return consolidate();
      };
      try {
        expect((await agent.run('Return {"ok":true}.', { responseFormat, modelTask: task })).output_parsed).toEqual({ ok: true });
        expect(contributions).toBe(1); expect(maintenance).toBe(1); expect(task.snapshot().invocations).toHaveLength(2);
        report.push({ provider: p.name, model: p.model, kind: 'structured-consolidation', passed: true, contributions, maintenance, controlledCandidatePressure: true, usage: task.snapshot() });
      } catch (error) { report.push({ provider: p.name, kind: 'structured-consolidation', passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw error; }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120000);
    it(`${p.name} persists one structured suspended observation`, async () => {
      if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled gate`);
      const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
      const { FileCorrelationStorage, StorageRegistry, SuspendSignal } = await import('../../../src/index.js');
      const directory = await mkdtemp(join(tmpdir(), 'stage05-live-suspension-')), correlations = new FileCorrelationStorage({ baseDirectory: directory }); StorageRegistry.configure({ correlations });
      const states = new Map<string, import('../../../src/index.js').SerializedContextState>();
      const storage: import('../../../src/index.js').IContextStorage = { getPath: () => 'memory://stage05-live',
        save: async (id, state) => { states.set(id, JSON.parse(JSON.stringify(state))); },
        load: async id => { const state = states.get(id); return state ? { version: 1, sessionId: id, createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString(), metadata: {}, state } : null; },
        list: async () => [], delete: async id => { states.delete(id); }, exists: async id => states.has(id) };
      const name = `stage05-suspension-${p.name}`; Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
      const task = new ModelTask({ limits: { maxCalls: 4 } }); let submissions = 0, contributions = 0;
      const agent = Agent.create({ connector: name, model: p.model, temperature: 0, instructions: 'Submit the synthetic local job once. The local submission is accepted and ok is true; return that JSON object.',
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
        vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: p.model, storage, assembly: { layout: 'stable-prefix' }, features: { workingMemory: false, inContextMemory: false } },
        tools: [{ definition: { type: 'function', function: { name: 'submit_local', description: 'Accept a synthetic local job', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          output: { effect: 'write' }, execute: async () => { submissions++; return SuspendSignal.create({ result: { id: 'LOCAL_R42', ok: true }, correlationId: 'local-job' }); } }],
        hooks: { 'before:llm': async hook => { hook.options.tool_choice = { type: 'function', function: { name: 'submit_local' } }; hook.options.parallel_tool_calls = false; return {}; } },
      });
      agent.context.registerPlugin(new Source()); agent.context.registerContextContributor('source', { getRevision: () => 1, contribute: () => { contributions++; return [{ id: 'A', text: '{"ok":true}', protected: true }]; } });
      try {
        const response = await agent.run('Submit once and return {"ok":true}.', { responseFormat, modelTask: task });
        expect(response.status).toBe('suspended'); expect(response.output_parsed).toEqual({ ok: true }); expect(submissions).toBe(1); expect(contributions).toBe(2);
        const ref = await correlations.resolve('local-job'); expect(ref!.sessionId).toBe(response.suspension!.sessionId); expect(JSON.stringify(states.get(ref!.sessionId))).toContain('LOCAL_R42');
        expect(JSON.stringify(states.get(ref!.sessionId))).toContain('ok'); expect(task.snapshot().invocations.length).toBeGreaterThanOrEqual(2); expect(task.snapshot().invocations.length).toBeLessThanOrEqual(3);
        report.push({ provider: p.name, model: p.model, kind: 'structured-suspension', passed: true, submissions, contributions, nativeFastPathOrToolFreeFormatting: true, usage: task.snapshot() });
      } catch (error) { report.push({ provider: p.name, kind: 'structured-suspension', passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw error; }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); StorageRegistry.remove('correlations'); await rm(directory, { recursive: true, force: true }); }
    }, 120000);
  }
});
