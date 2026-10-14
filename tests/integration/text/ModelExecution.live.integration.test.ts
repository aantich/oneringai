import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ModelTask, Vendor, StreamEventType, MessageRole, ContentType, createProvider } from '../../../src/index.js';
import type { ITextProvider } from '../../../src/index.js';

dotenv.config({ quiet: true });
const enabled = process.env.RUN_MODEL_EXECUTION_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini', helperModel: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001', helperModel: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash', helperModel: 'gemini-2.5-flash-lite' },
];
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const reports: Array<Record<string, unknown>> = [];
afterAll(async () => {
  if (!enabled || !process.env.MODEL_EXECUTION_REPORT_PATH) return;
  await mkdir(dirname(process.env.MODEL_EXECUTION_REPORT_PATH), { recursive: true });
  await writeFile(process.env.MODEL_EXECUTION_REPORT_PATH, JSON.stringify({ protocol: 'stage-06-live-v1', recordedAt: new Date().toISOString(),
    scope: 'Real model-task/helper plumbing and usage; synthetic markers, no comparative quality/cost claim; no raw prompts or credentials', reports }, null, 2) + '\n');
});

describe.skipIf(!enabled).sequential('Stage 06 live model-task and helper execution', () => {
  for (const selected of providers) it(`${selected.name} repairs a controlled helper schema failure using retained source evidence`, async () => {
    if (!selected.key) throw new Error(`Missing ${selected.name} credentials for helper repair validation`);
    const name = `stage06-evidence-repair-${selected.name}`;
    const connector = Connector.create({ name, vendor: selected.vendor, auth: { type: 'api_key', apiKey: selected.key }, options: { maxRetries: 0 } });
    const backend = createProvider(connector); let calls = 0;
    const marker = `EVIDENCE_REPAIR_${selected.name.toUpperCase()}_672`;
    const controlled: ITextProvider = {
      name: backend.name, capabilities: backend.capabilities,
      getModelCapabilities: model => backend.getModelCapabilities(model),
      getAdvancedCapabilities: model => backend.getAdvancedCapabilities!(model),
      async generate(options) {
        calls++; expect(String(options.input)).toContain(marker);
        const response = await backend.generate(options);
        if (calls === 1) response.output_text = '{"answer":7}'; // Controlled local corruption; real usage stays intact.
        return response;
      },
      streamGenerate: options => backend.streamGenerate(options),
      validateConfig: () => backend.validateConfig(), listModels: () => backend.listModels(),
    };
    connector.getOptions().provider = controlled;
    const task = new ModelTask({ limits: { maxCalls: 2, deadline: Date.now() + 90_000 } });
    const agent = Agent.create({ connector: name, model: selected.helperModel, modelExecution: { customProviderAttempts: 'single', helpers: {
      extractor: { connector: name, model: selected.helperModel, thinking: { enabled: false }, maxOutputTokens: 512,
        instructions: 'Return the exact identifier from the original evidence in answer.' },
    } } });
    try {
      const result = await agent.invokeHelper<{ answer: string }>('extractor', `Original evidence identifier=${marker}. Preserve it exactly.`, { schema, modelTask: task });
      expect(result.value.answer).toBe(marker); expect(calls).toBe(2);
      expect(task.snapshot().invocations.map(i => [i.phase, i.outputValidation])).toEqual([['generation', 'failed'], ['repair', 'passed']]);
      expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
      reports.push({ scenario: 'controlled-helper-evidence-repair', provider: selected.name, passed: true, snapshot: task.snapshot(),
        boundary: 'Host-controlled injected wrapper delegates once per invocation to the named-connector SDK backend; first text is locally corrupted after its real call.' });
    } catch (error) { reports.push({ scenario: 'controlled-helper-evidence-repair', provider: selected.name, passed: false,
      errorType: error instanceof Error ? error.name : 'unknown', snapshot: task.snapshot() }); throw error; }
    finally { agent.destroy(); task.destroy(); if ('destroy' in backend && typeof backend.destroy === 'function') backend.destroy(); Connector.remove(name); }
  }, 120_000);

  it.each(['run', 'stream'] as const)('accounts for live Google thinking separately from visible output: %s', async mode => {
    const selected = providers[2]!; if (!selected.key) throw new Error('Google credentials required for thinking accounting');
    const name = `stage06-thinking-${mode}`;
    Connector.create({ name, vendor: Vendor.Google, auth: { type: 'api_key', apiKey: selected.key } });
    const task = new ModelTask({ limits: { maxCalls: 4, deadline: Date.now() + 90_000 } });
    const agent = Agent.create({ connector: name, model: selected.model, thinking: { enabled: true, budgetTokens: 1024 },
      instructions: 'Solve the supplied problem and return only the JSON object {"answer":"decimal integer"}.',
      vendorOptions: { api: 'generateContent' }, emptyResponseRetry: { enabled: false },
      context: { model: selected.model, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { maxOutputTokensPerCall: 4096, helpers: { extractor: { connector: name, model: selected.model,
        thinking: { enabled: true, budgetTokens: 1024 }, maxOutputTokens: 4096 } } },
    });
    const prompt = 'Solve carefully: find the smallest positive integer n such that n mod 3 = 2, n mod 5 = 3, and n mod 7 = 2. Return the decimal answer as a string in answer.';
    try {
      const helper = await agent.invokeHelper<{ answer: string }>('extractor', prompt + ' Put the decimal answer in the answer string.', { schema, modelTask: task });
      expect(helper.value.answer).toBe('23');
      let visibleOutput = 0; let thoughts = 0; let text = '';
      if (mode === 'run') {
        const response = await agent.run(prompt, { modelTask: task, responseFormat: { type: 'json_schema', name: 'thinking_answer', strict: true, schema } }); text = response.output_text ?? '';
        visibleOutput = response.usage.output_tokens; thoughts = response.usage.output_tokens_details?.reasoning_tokens ?? 0;
      } else for await (const event of agent.stream(prompt, { modelTask: task, responseFormat: { type: 'json_schema', name: 'thinking_answer', strict: true, schema } })) {
        if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        if (event.type === StreamEventType.RESPONSE_COMPLETE && event.usage) {
          visibleOutput = event.usage.output_tokens; thoughts = event.usage.output_tokens_details?.reasoning_tokens ?? 0;
        }
      }
      expect(JSON.parse(text)).toEqual({ answer: '23' }); expect(thoughts).toBeGreaterThan(0);
      const snapshot = task.snapshot();
      expect(snapshot.invocations[0]?.usage?.output_tokens).toBe(helper.response.usage.output_tokens + (helper.response.usage.output_tokens_details?.reasoning_tokens ?? 0));
      expect(snapshot.invocations[1]?.usage?.output_tokens).toBe(visibleOutput + thoughts);
      expect(snapshot.totals.unknownUsageInvocations).toBe(0); expect(snapshot.totals.unknownCostInvocations).toBe(0);
      reports.push({ scenario: 'google-separate-thinking-accounting', mode, passed: true, visibleOutput, thoughts, snapshot });
    } catch (error) { reports.push({ scenario: 'google-separate-thinking-accounting', mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown', snapshot: task.snapshot() }); throw error; }
    finally { agent.destroy(); task.destroy(); Connector.remove(name); }
  }, 120_000);

  it('accepts a live Anthropic fixed-budget extended-thinking helper', async () => {
    const selected = providers[1]!; if (!selected.key) throw new Error('Anthropic credentials required for extended thinking');
    const name = 'stage06-extended-thinking';
    Connector.create({ name, vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: selected.key } });
    const task = new ModelTask({ limits: { maxCalls: 2, deadline: Date.now() + 90_000 } });
    const agent = Agent.create({ connector: name, model: selected.model, modelExecution: { helpers: {
      extractor: { connector: name, model: selected.model, thinking: { enabled: true, budgetTokens: 2048 }, maxOutputTokens: 4096 },
    } } });
    try {
      const result = await agent.invokeHelper<{ answer: string }>('extractor', 'Return EXTENDED_THINKING_VERIFIED in answer.', { schema, modelTask: task });
      expect(result.value.answer).toBe('EXTENDED_THINKING_VERIFIED');
      expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
      reports.push({ scenario: 'anthropic-fixed-budget-helper', passed: true, snapshot: task.snapshot() });
    } catch (error) { reports.push({ scenario: 'anthropic-fixed-budget-helper', passed: false, errorType: error instanceof Error ? error.name : 'unknown', snapshot: task.snapshot() }); throw error; }
    finally { agent.destroy(); task.destroy(); Connector.remove(name); }
  }, 120_000);

  for (const provider of providers) {
    it.each(['run', 'stream'] as const)(`${provider.name} %s shares helper/main usage without tools or state transfer`, async mode => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credentials for explicitly requested live validation`);
      const name = `stage06-${provider.name}-${mode}`;
      Connector.create({ name, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const task = new ModelTask({ limits: { maxCalls: 6, maxTokens: 4_000_000, deadline: Date.now() + 90_000 } });
      const marker = `ROLE_VERIFIED_${provider.name.toUpperCase()}_${mode.toUpperCase()}`;
      const agent = Agent.create({ connector: name, model: provider.model, thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        instructions: 'Repeat the supplied source marker exactly, with no explanation.',
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        context: { model: provider.model, features: { workingMemory: false, inContextMemory: false } },
        modelExecution: { maxOutputTokensPerCall: 256, helpers: {
          extractor: { connector: name, model: provider.helperModel, maxOutputTokens: 512,
            thinking: { enabled: false }, instructions: 'Return the supplied exact marker in answer.' },
        } },
      });
      try {
        const before = JSON.stringify(agent.context.getConversation());
        const result = await agent.invokeHelper<{ answer: string }>('extractor', JSON.stringify({ marker }), { schema, modelTask: task });
        expect(result.value.answer).toBe(marker); expect(JSON.stringify(agent.context.getConversation())).toBe(before);
        let text = '';
        if (mode === 'run') text = (await agent.run(`Repeat this verified marker: ${result.value.answer}`, { modelTask: task })).output_text ?? '';
        else for await (const event of agent.stream(`Repeat this verified marker: ${result.value.answer}`, { modelTask: task })) {
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        }
        expect(text).toContain(marker);
        const snapshot = task.snapshot();
        expect(snapshot.invocations.map(i => i.purpose)).toEqual(['extractor', 'main']);
        expect(snapshot.totals.calls).toBeGreaterThanOrEqual(2);
        expect(snapshot.totals.unknownUsageInvocations).toBe(0); expect(snapshot.totals.totalTokens).toBeGreaterThan(0);
        expect(snapshot.attempts.every(a => a.boundary === 'transport')).toBe(true);
        expect(snapshot.totals.totalTokens).toBe(snapshot.invocations.reduce((n, i) => n + i.usage!.total_tokens, 0));
        expect(agent.model).toBe(provider.model); expect(agent.tools).toBe(agent.context.tools);
        reports.push({ provider: provider.name, model: provider.model, helperModel: provider.helperModel, mode, passed: true, snapshot });
      } catch (error) { reports.push({ provider: provider.name, mode, passed: false, errorType: error instanceof Error ? error.name : 'unknown', snapshot: task.snapshot() }); throw error; }
      finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120_000);
  }

  it('uses a separate Anthropic compactor for an explicit OpenAI context rollover', async () => {
    const openai = providers[0]!; const anthropic = providers[1]!;
    if (!openai.key || !anthropic.key) throw new Error('Cross-provider live check requires OpenAI and Anthropic credentials');
    Connector.create({ name: 'stage06-rollover-main', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: openai.key } });
    Connector.create({ name: 'stage06-rollover-helper', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: anthropic.key } });
    const task = new ModelTask({ limits: { maxCalls: 4, deadline: Date.now() + 90_000 } });
    const agent = Agent.create({ connector: 'stage06-rollover-main', model: openai.model,
      context: { model: openai.model, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { helpers: { compactor: { connector: 'stage06-rollover-helper', model: anthropic.model, allowContextTransfer: true,
        maxOutputTokens: 512, instructions: 'Summarize the source into summary. Preserve CONTEXT_ROLE_VERIFIED exactly.' } } },
    });
    try {
      agent.context.addInputItems([
        { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Remember CONTEXT_ROLE_VERIFIED as the exact source identifier.' }] },
        { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Recorded CONTEXT_ROLE_VERIFIED.' }] },
      ]);
      const result = await agent.rolloverContext({ preserveRecentTurns: 0, modelTask: task });
      expect(result.performed).toBe(true);
      expect(JSON.stringify(agent.context.getConversation())).toContain('CONTEXT_ROLE_VERIFIED');
      expect(task.snapshot().invocations.map(i => i.purpose)).toEqual(['compactor']);
      expect(task.snapshot().totals.unknownUsageInvocations).toBe(0); expect(agent.model).toBe(openai.model);
      reports.push({ scenario: 'cross-provider-explicit-rollover', passed: true, snapshot: task.snapshot() });
    } catch (error) { reports.push({ scenario: 'cross-provider-explicit-rollover', passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw error; }
    finally { agent.destroy(); task.destroy(); Connector.remove('stage06-rollover-main'); Connector.remove('stage06-rollover-helper'); }
  }, 120_000);

  it('counts a controlled real OpenAI structured repair once per dispatched invocation', async () => {
    const selected = providers[0]!; if (!selected.key) throw new Error('OpenAI credentials required for controlled repair');
    Connector.create({ name: 'stage06-repair', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: selected.key } });
    const task = new ModelTask({ limits: { maxCalls: 3, deadline: Date.now() + 90_000 } });
    const agent = Agent.create({ connector: 'stage06-repair', model: selected.model,
      instructions: 'Return REPAIR_ROLE_VERIFIED in answer.',
      context: { model: selected.model, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { maxOutputTokensPerCall: 256 },
      hooks: { 'after:llm': async context => { context.response.output_text = 'REPAIR_ROLE_VERIFIED'; return {}; } },
    });
    try {
      const response = await agent.run('Return the verification JSON.', { modelTask: task, responseFormat: { type: 'json_schema', name: 'repair', strict: true, schema } });
      expect(response.output_parsed).toEqual({ answer: 'REPAIR_ROLE_VERIFIED' });
      const snapshot = task.snapshot();
      expect(snapshot.invocations.map(i => i.phase)).toEqual(['generation', 'repair']);
      expect(snapshot.totals.totalTokens).toBe(response.usage.total_tokens);
      expect(snapshot.totals.unknownUsageInvocations).toBe(0);
      reports.push({ scenario: 'controlled-real-repair-accounting', passed: true, snapshot });
    } catch (error) { reports.push({ scenario: 'controlled-real-repair-accounting', passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw error; }
    finally { agent.destroy(); task.destroy(); Connector.remove('stage06-repair'); }
  }, 120_000);
});
