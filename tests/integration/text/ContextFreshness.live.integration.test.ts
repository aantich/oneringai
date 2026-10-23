import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ContentType, MessageRole, StreamEventType, Vendor, DEFAULT_FEATURES } from '../../../src/index.js';
import type { TextGenerateOptions } from '../../../src/index.js';

dotenv.config({ quiet: true });
const enabled = process.env.RUN_CONTEXT_FRESHNESS_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
const reports: Array<Record<string, unknown>> = [];
afterAll(async () => {
  if (!enabled || !process.env.CONTEXT_FRESHNESS_REPORT_PATH) return;
  await mkdir(dirname(process.env.CONTEXT_FRESHNESS_REPORT_PATH), { recursive: true });
  await writeFile(process.env.CONTEXT_FRESHNESS_REPORT_PATH, JSON.stringify({ protocol: 'stage-01-corrections-v2',
    recordedAt: new Date().toISOString(), sampleCountPerProviderMode: 1,
    scope: 'Mixed-format and separate-spill evidence retrieval, schema-aware compaction, controlled malformed-answer repair, and Google replay state; real providers with local tools; no comparative quality/cost claim', reports }, null, 2) + '\n');
});

describe.skipIf(!enabled).sequential('Stage 01 live context freshness', () => {
  for (const provider of providers) {
    it(`${provider.name} compacts old history using the known structured schema`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credentials for explicit live validation`);
      const connector = `stage01-${provider.name}-schema-budget`;
      Connector.create({ name: connector, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      let compactions = 0; let calls = 0;
      const agent = Agent.create({ connector, model: provider.model, thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        instructions: 'Return JSON with value BUDGET_VERIFIED. Treat the schema description as metadata.',
        context: { model: provider.model, maxContextTokens: 1000, responseReserve: 100, strategy: 'default',
          features: { workingMemory: false, inContextMemory: false } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async () => ({ modified: { max_output_tokens: 128 } }) },
      });
      agent.context.on('context:compacted', () => { compactions++; }); agent.on('llm:request', () => { calls++; });
      try {
        agent.context.addInputItems([{ type: 'message', role: MessageRole.USER,
          content: [{ type: ContentType.INPUT_TEXT, text: 'old observation '.repeat(110) }] }]);
        const response = await agent.run('Return the verification JSON.', { responseFormat: { type: 'json_schema', name: 'verification', strict: true,
          schema: { type: 'object', description: 'schema terms '.repeat(160), properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });
        expect(response.output_parsed).toEqual({ value: 'BUDGET_VERIFIED' }); expect(compactions).toBe(1); expect(calls).toBe(1);
        expect(agent.context.lastPreparation!.budget.available).toBeGreaterThanOrEqual(0);
        reports.push({ scenario: 'schema-aware-compaction', provider: provider.name, model: provider.model, passed: true,
          compactions, observedModelCalls: calls, selectedBudget: agent.context.lastPreparation!.budget, usage: response.usage });
      } catch (error) {
        reports.push({ scenario: 'schema-aware-compaction', provider: provider.name, passed: false, errorType: error instanceof Error ? error.name : 'unknown' }); throw error;
      } finally { agent.destroy(); Connector.remove(connector); }
    }, 120_000);

    it(`${provider.name} retrieves both sources after separate spills with colliding keys`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credentials for explicit live validation`);
      const connector = `stage01-${provider.name}-spill-collision`;
      Connector.create({ name: connector, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const agent = Agent.create({ connector, model: provider.model, thinking: { enabled: false }, maxIterations: 5,
        emptyResponseRetry: { enabled: false }, instructions: 'Read both existing sources with store_get from notes. Return both markers verbatim.',
        context: { model: provider.model, maxContextTokens: 3200, responseReserve: 512, features: { workingMemory: true, inContextMemory: false } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async () => ({ modified: { max_output_tokens: 512 } }) },
      });
      let reads = 0; let calls = 0;
      const retrievals: Array<{ store?: string; key?: string }> = [];
      agent.on('llm:request', () => { calls++; });
      agent.on('tool:start', event => {
        if (event.toolCall.function.name !== 'store_get') return;
        reads++;
        try {
          const args = JSON.parse(event.toolCall.function.arguments);
          retrievals.push({ store: typeof args.store === 'string' ? args.store : undefined,
            key: typeof args.key === 'string' ? args.key : undefined });
        } catch { /* Invalid arguments are handled and reported by the tool pipeline. */ }
      });
      try {
        for (const [id, marker] of [['first-12345678', 'FIRST_SOURCE_VERIFIED'], ['second-12345678', 'SECOND_SOURCE_VERIFIED']]) {
          agent.context.addInputItems([
            { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'old observations '.repeat(650) }] },
            { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: id!, name: 'read_source', arguments: '{}' }] },
            { type: 'function_call_output', call_id: id!, output: JSON.stringify({ marker, records: 'source records '.repeat(100) }) },
          ]);
          await agent.context.consolidate();
        }
        const state = JSON.parse(JSON.stringify(agent.context.getState())); agent.context.restoreState(state);
        const response = await agent.run('Read both sources already stored in the notes index and return both verification markers.');
        expect(response.output_text).toContain('FIRST_SOURCE_VERIFIED'); expect(response.output_text).toContain('SECOND_SOURCE_VERIFIED');
        expect(reads).toBeGreaterThanOrEqual(2);
        expect(agent.context.lastPreparation!.budget.available).toBeGreaterThanOrEqual(0);
        reports.push({ scenario: 'separate-spill-collision-retrieval', provider: provider.name, model: provider.model, passed: true,
          memoryReads: reads, observedModelCalls: calls, retrievals,
          keys: ['raw.tool_result.read_source.12345678', 'raw.tool_result.read_source.12345678.function.1'],
          persistence: 'JSON context state round trip before real retrieval' });
      } catch (error) {
        reports.push({ scenario: 'separate-spill-collision-retrieval', provider: provider.name, passed: false,
          memoryReads: reads, observedModelCalls: calls, retrievals,
          errorType: error instanceof Error ? error.name : 'unknown' }); throw error;
      } finally { agent.destroy(); Connector.remove(connector); }
    }, 120_000);

    it.each(['run', 'stream'] as const)(`${provider.name} %s retrieves evidence from the rebuilt working-memory index`, async mode => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credentials for explicit live validation`);
      const connector = `stage01-${provider.name}-${mode}`;
      Connector.create({ name: connector, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      const marker = `SOURCE_VERIFIED_${provider.name.toUpperCase()}_${mode.toUpperCase()}`;
      const nativeMarker = `NATIVE_VERIFIED_${provider.name.toUpperCase()}_${mode.toUpperCase()}`;
      // This is an exact evidence-transport contract, so disable creative sampling.
      const agent = Agent.create({ connector, model: provider.model, temperature: 0, thinking: { enabled: false }, maxIterations: 5,
        emptyResponseRetry: { enabled: false },
        instructions: 'Use store_get to read both existing sources from the notes store. Return both markers verbatim. Do not repeat source reads.',
        context: { model: provider.model, maxContextTokens: 3200, responseReserve: 512, features: { ...DEFAULT_FEATURES, workingMemory: true, inContextMemory: false } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async context => {
          if (calls === 0) freshIndex = ['source01', 'source02'].every(id => JSON.stringify(context.options.input).includes(`tool_result.read_source.${id}`));
          // Streaming supports in-place hook edits; returned modifications are run-only.
          context.options.max_output_tokens = 512;
          return {};
        } },
      });
      let calls = 0; let memoryReads = 0; let compacted = 0;
      let firstRevision: number | undefined;
      let firstBudgetAvailable: number | undefined;
      let freshIndex = false;
      let output = '', finalStatus: string | undefined, stopReason: string | undefined;
      agent.on('llm:request', (event: { options?: TextGenerateOptions }) => {
        calls++;
        if (calls === 1) {
          const prepared = agent.context.lastPreparation!;
          firstRevision = prepared.revision; firstBudgetAvailable = prepared.budget.available;
          if (event.options) freshIndex = ['source01', 'source02'].every(id => JSON.stringify(event.options!.input).includes(`tool_result.read_source.${id}`));
        }
      });
      agent.context.on('context:compacted', () => { compacted++; });
      agent.on('tool:start', (event: { toolCall: { function: { name: string } } }) => {
        if (event.toolCall.function.name === 'store_get') memoryReads++;
      });
      try {
        agent.context.addInputItems([
          // Old history forces compaction; retrieved sources themselves fit together.
          { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'old observations '.repeat(650) }] },
          { type: 'message', role: MessageRole.ASSISTANT, content: [
            { type: ContentType.TOOL_USE, id: 'call-source01', name: 'read_source', arguments: '{"source":"fixture"}' },
            { type: ContentType.TOOL_USE, id: 'call-source02', name: 'read_source', arguments: '{"source":"native"}' },
          ] },
          { type: 'message', role: MessageRole.USER, content: [
            { type: ContentType.TOOL_RESULT, tool_use_id: 'call-source01', content: JSON.stringify({ marker, records: 'source records '.repeat(100) }) },
          ] },
          { type: 'function_call_output', call_id: 'call-source02', output: JSON.stringify({ marker: nativeMarker }) },
        ]);
        if (mode === 'run') output = (await agent.run('Read both sources already stored in working memory and return both verification markers.')).output_text ?? '';
        else for await (const event of agent.stream('Read both sources already stored in working memory and return both verification markers.')) {
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) output += event.delta;
          if (event.type === StreamEventType.RESPONSE_COMPLETE) { finalStatus = event.status; stopReason = event.stop_reason; }
        }
        if (mode === 'stream') expect(finalStatus).toBe('completed');
        expect(output).toContain(marker);
        expect(output).toContain(nativeMarker);
        expect(memoryReads).toBeGreaterThanOrEqual(2);
        expect(compacted).toBeGreaterThan(0);
        expect(freshIndex).toBe(true);
        expect(firstBudgetAvailable).toBeGreaterThanOrEqual(0);
        expect(agent.context.lastPreparation!.budget.available).toBeGreaterThanOrEqual(0);
        reports.push({ scenario: 'mixed-format-retrieval', provider: provider.name, model: provider.model, mode, passed: true, nativeEvidenceRecovered: true, calls, memoryReads,
          compacted, firstRevision, firstBudgetAvailable, lastRevision: agent.context.lastPreparation!.revision,
          finalEstimatedTokens: agent.context.lastPreparation!.budget.totalUsed, temperature: 0, outputCap: 512, finalStatus, stopReason });
      } catch (error) {
        // Save only a classification, never raw provider errors/credentials/prompt data.
        reports.push({ provider: provider.name, model: provider.model, mode, passed: false, calls, memoryReads,
          observedSyntheticOutput: output, finalStatus, stopReason, errorType: error instanceof Error ? error.name : 'unknown' });
        throw error;
      } finally { agent.destroy(); Connector.remove(connector); }
    }, 120_000);
    it(`${provider.name} repairs a controlled malformed answer through a real tool-free call`, async () => {
      if (!provider.key) throw new Error(`Missing ${provider.name} credentials for explicit live validation`);
      const connector = `stage01-${provider.name}-repair`;
      Connector.create({ name: connector, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
      let mainUsage = 0;
      const agent = Agent.create({ connector, model: provider.model, thinking: { enabled: false },
        emptyResponseRetry: { enabled: false }, instructions: 'Return the exact value REPAIR_VERIFIED as JSON.',
        context: { model: provider.model, maxContextTokens: 2000, responseReserve: 512,
          features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } },
        vendorOptions: provider.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
        hooks: { 'before:llm': async () => ({ modified: { max_output_tokens: 512 } }),
          'after:llm': async context => {
            mainUsage = context.response.usage?.total_tokens ?? 0;
            // Controlled corruption exercises repair; this is not a natural provider failure rate.
            context.response.output_text = 'The exact value is REPAIR_VERIFIED.';
            context.response.output = [{ type: 'message', role: MessageRole.ASSISTANT,
              content: [{ type: ContentType.OUTPUT_TEXT, text: context.response.output_text }] }];
            return {};
          } },
      });
      try {
        const response = await agent.run('Return the requested JSON.', { responseFormat: { type: 'json_schema', name: 'verification', strict: true,
          schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });
        expect(response.output_parsed).toEqual({ value: 'REPAIR_VERIFIED' });
        expect(response.structured_output_enforcement).toBe('repair');
        expect(response.usage!.total_tokens).toBeGreaterThan(mainUsage);
        expect(agent.context.lastPreparation!.revision).toBe(1);
        expect(JSON.stringify(agent.context.getConversation())).toContain('REPAIR_VERIFIED');
        reports.push({ scenario: 'controlled-structured-repair', provider: provider.name, model: provider.model, mode: 'run', passed: true,
          providerCalls: 2, mainUsageTokens: mainUsage, totalUsageTokens: response.usage!.total_tokens,
          lastRevision: agent.context.lastPreparation!.revision });
      } catch (error) {
        reports.push({ scenario: 'controlled-structured-repair', provider: provider.name, model: provider.model, passed: false,
          errorType: error instanceof Error ? error.name : 'unknown' }); throw error;
      } finally { agent.destroy(); Connector.remove(connector); }
    }, 120_000);
  }

  it('Google thinking tool calls retain replay signatures through serialized context', async () => {
    const provider = providers.find(item => item.name === 'google')!;
    if (!provider.key) throw new Error('Missing Google credentials for explicit live validation');
    const connector = 'stage01-google-signature';
    Connector.create({ name: connector, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
    let signaturesObserved = 0; let signatureEstimate = 0;
    const agent = Agent.create({ connector, model: provider.model, thinking: { enabled: true, budgetTokens: 256 },
      instructions: 'Call verify_signature exactly once, then return its verification marker verbatim.', maxIterations: 4,
      emptyResponseRetry: { enabled: false },
      tools: [{ definition: { type: 'function', function: { name: 'verify_signature', description: 'Read a verification marker',
        parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => ({ marker: 'SIGNATURE_REPLAY_VERIFIED' }) }],
      context: { model: provider.model, maxContextTokens: 8000, responseReserve: 1536,
        features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } },
      hooks: { 'before:llm': async context => {
        if (typeof context.options.input !== 'string') {
          const unsigned = structuredClone(context.options.input);
          for (const item of unsigned) if (item.type === 'message') for (const block of item.content) {
            if (block.type === ContentType.TOOL_USE && block.thoughtSignature) {
              signaturesObserved++; delete block.thoughtSignature;
            }
          }
          if (signaturesObserved) signatureEstimate = agent.context.validateRequestBudget(context.options, { recordPreparation: false }).totalUsed
            - agent.context.validateRequestBudget({ ...context.options, input: unsigned }, { recordPreparation: false }).totalUsed;
        }
        return { modified: { max_output_tokens: 1536 } };
      } },
    });
    try {
      const first = await agent.run('Read the verification marker.');
      expect(first.output_text).toContain('SIGNATURE_REPLAY_VERIFIED');
      expect(signaturesObserved).toBeGreaterThan(0); expect(signatureEstimate).toBeGreaterThan(0);
      const state = JSON.parse(JSON.stringify(agent.context.getState()));
      agent.context.restoreState(state);
      const replay = await agent.run('Repeat the already verified marker. Use the existing result.');
      expect(replay.output_text).toContain('SIGNATURE_REPLAY_VERIFIED');
      reports.push({ scenario: 'google-thinking-signature-replay', provider: provider.name, model: provider.model, passed: true,
        signaturesObserved, localSignatureEstimate: signatureEstimate, persistence: 'JSON context state round trip; no signature contents logged' });
    } catch (error) {
      reports.push({ scenario: 'google-thinking-signature-replay', provider: provider.name, model: provider.model, passed: false,
        signaturesObserved, errorType: error instanceof Error ? error.name : 'unknown' }); throw error;
    } finally { agent.destroy(); Connector.remove(connector); }
  }, 120_000);
});
