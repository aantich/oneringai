import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, Connector, ModelTask, StreamEventType, Vendor, ContextCompactionStrategy, FileContextStorage, FileEvidenceStorage, ContentType, MessageRole, createProvider, SuspendSignal, StorageRegistry, FileCorrelationStorage } from '../../../src/index.js';
import type { ToolFunction, ITextProvider } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_MODEL_ROUTING_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: 'OPENAI_API_KEY', main: 'gpt-4.1-mini', fast: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: 'ANTHROPIC_API_KEY', main: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: 'GOOGLE_API_KEY', main: 'gemini-2.5-flash', fast: 'gemini-2.5-flash-lite' },
] as const;
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const format = { type: 'json_schema' as const, name: 'routing_answer', schema, strict: true };
const reports: Array<Record<string, unknown>> = [];
afterAll(async () => {
  const destination = process.env.MODEL_ROUTING_REPORT_PATH;
  if (!enabled || !destination) return;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify({ protocol: 'stage-14a-live-v1', recordedAt: new Date().toISOString(),
    criteria: { heldOutRecords: 6, allowedQualityLoss: 0, minimumTokenCostReductionVsMain: .05, automaticClassifierCalls: 0, temperature: 0, pilotOutputCap: 2048, fixedFastIsMeasurementOnly: true },
    boundary: 'Small fixed functional pilot. Models/fixtures/criteria fixed before first run; no general routing quality/cost claim. No private prompts or credentials.', reports }, null, 2) + '\n');
});
function connect(selected: typeof providers[number], name: string) {
  const key = process.env[selected.key]; if (!key) throw new Error(`Missing ${selected.key} for mandatory live routing validation`);
  return Connector.create({ name, vendor: selected.vendor, auth: { type: 'api_key', apiKey: key }, options: { maxRetries: 0 } });
}

// Fault injection follows real transport/usage, rather than replacing billable
// provider calls. The second call is the tool-free suspension wrap-up.
function corruptSuspensionWrapup(connector: Connector) {
  const backend = createProvider(connector);
  let calls = 0;
  const controlled: ITextProvider = { name: backend.name, capabilities: backend.capabilities,
    getModelCapabilities: model => backend.getModelCapabilities(model),
    getAdvancedCapabilities: model => backend.getAdvancedCapabilities!(model),
    async generate(options) {
      const response = await backend.generate(options);
      if (++calls === 2) {
        response.output_text = `CONTROLLED_INVALID_SUSPENSION_JSON: ${(response.output_text ?? '').replace(/[{}\[\]]/g, '')}`;
        response.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: response.output_text }] }];
      }
      return response;
    }, streamGenerate: options => backend.streamGenerate(options), validateConfig: () => backend.validateConfig(), listModels: () => backend.listModels() };
  connector.getOptions().provider = controlled;
  return { calls: () => calls, destroy: () => { if ('destroy' in backend && typeof backend.destroy === 'function') backend.destroy(); } };
}

describe.skipIf(!enabled).sequential('14A live route contracts and fixed held-out pilot', () => {
  for (const selected of providers) {
    it(`${selected.name} routes run/stream/default within one explicit task`, async () => {
      const name = `stage14-contract-${selected.name}`; connect(selected, name);
      const task = new ModelTask({ limits: { maxCalls: 6, deadline: Date.now() + 100_000 } });
      let choices = 0;
      const agent = Agent.create({ connector: name, model: selected.main, thinking: { enabled: false },
        instructions: 'Answer from the current request only. Preserve identifiers exactly. Do not use tools.',
        context: { model: selected.main, features: { workingMemory: false, inContextMemory: false } },
        modelExecution: { maxOutputTokensPerCall: 512, routing: { routes: { fast: { model: selected.fast } },
          select: () => { choices++; return 'fast'; } } } });
      try {
        const response = await agent.run('Return ROUTE14_EXACT in answer.', { responseFormat: format, modelTask: task });
        expect(response.output_parsed).toEqual({ answer: 'ROUTE14_EXACT' }); expect(response.routing?.model).toBe(selected.fast);
        let text = ''; let terminal = false;
        for await (const event of agent.stream('Return only STREAM14_EXACT, without JSON.', { modelTask: task })) {
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
          if (event.type === StreamEventType.RESPONSE_COMPLETE) { terminal = true; expect(event.routing?.model).toBe(selected.fast); }
        }
        expect(text).toContain('STREAM14_EXACT'); expect(terminal).toBe(true);
        const main = await agent.run('Return DEFAULT14_EXACT in answer.', { responseFormat: format, modelTask: task, routing: null });
        expect(main.output_parsed).toEqual({ answer: 'DEFAULT14_EXACT' }); expect(main.routing?.model).toBe(selected.main);
        expect(agent.model).toBe(selected.main); expect(agent.tools).toBe(agent.context.tools); expect(choices).toBe(2);
        expect(task.snapshot().totals.unknownUsageInvocations).toBe(0); expect(task.snapshot().totals.unknownCostInvocations).toBe(0);
        reports.push({ scenario: 'managed-contract', provider: selected.name, passed: true, snapshot: task.snapshot() });
      } finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120_000);

    it(`${selected.name} resumes structured suspension with original evidence, repair and host completion`, async () => {
      const name = `stage14-suspended-${selected.name}`; const transport = corruptSuspensionWrapup(connect(selected, name));
      const directory = await mkdtemp(join(tmpdir(), 'stage14-suspended-'));
      const storage = new FileContextStorage({ agentId: 'suspended-live', baseDirectory: directory });
      StorageRegistry.configure({ sessions: agentId => new FileContextStorage({ agentId, baseDirectory: directory }),
        correlations: new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }) });
      const task = new ModelTask({ limits: { maxCalls: 10, deadline: Date.now() + 120_000 } });
      let waits = 0, hooks = 0, checks = 0, resumed = false, corrupted = false;
      const agent = Agent.create({ connector: name, model: selected.main, thinking: { enabled: false }, temperature: 0,
        session: { storage, autoSave: false },
        instructions: 'For a wait request call wait_for_event once. While waiting use PENDING14 as answer. When an external event arrives, return its exact confirmed marker in answer without tools. Reply in JSON.',
        context: { model: selected.main, features: { workingMemory: false, inContextMemory: false } },
        tools: [{ definition: { type: 'function', function: { name: 'wait_for_event', description: 'Register a synthetic wait', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          execute: async () => { waits++; return SuspendSignal.create({ result: 'Wait registered; no event yet.', correlationId: `stage14:event:${selected.name}` }); } }],
        loopPolicy: { maxRecoveryAttempts: 0, completion: context => { checks++; return { complete: JSON.parse(context.outputText).answer === 'EVENT14_SCOPED' }; } },
        hooks: { 'before:llm': async hook => {
          if (++hooks === 1) { hook.options.tool_choice = { type: 'function', function: { name: 'wait_for_event' } }; hook.options.parallel_tool_calls = false; }
          else { hook.options.tools = undefined; hook.options.tool_choice = undefined; }
          return {};
        }, 'after:llm': async hook => { if (resumed && !corrupted) { hook.response.output_text = `CONTROLLED_INVALID_JSON: ${(hook.response.output_text ?? '').replace(/[{}\[\]]/g, '')}`; corrupted = true; } return {}; } },
        modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 2048, routing: { routes: { fast: { model: selected.fast } }, select: () => 'fast' } },
      });
      try {
        const suspended = await agent.run('Register a wait for an external event.', { responseFormat: format, modelTask: task });
        expect(suspended.status).toBe('suspended'); expect(suspended.output_parsed).toBeDefined(); expect(waits).toBe(1);
        expect(transport.calls()).toBeGreaterThanOrEqual(3);
        const checkpoint = await storage.load(suspended.suspension!.sessionId);
        expect(checkpoint?.state.conversation.some(item => item.type === 'message' && item.content.some(part => part.type === ContentType.OUTPUT_TEXT && part.text === suspended.output_text))).toBe(true);
        expect(checkpoint?.state.conversation.some(item => item.type === 'message' && item.content.some(part => part.type === ContentType.OUTPUT_TEXT && part.text.startsWith('CONTROLLED_INVALID_SUSPENSION_JSON:')))).toBe(false);
        checks = 0; resumed = true; const before = task.snapshot().totals.calls;
        const response = await agent.run('External event arrived. Its confirmed marker is EVENT14_SCOPED. Return the marker in answer.');
        expect(corrupted).toBe(true); expect(response.output_parsed).toEqual({ answer: 'EVENT14_SCOPED' });
        expect(checks).toBe(1); expect(waits).toBe(1); expect(response.loop?.completion?.complete).toBe(true);
        expect(response.routing?.model).toBe(selected.fast); expect(agent.getModelUsage()?.id).toBe(task.id);
        expect(task.snapshot().totals.calls).toBeGreaterThan(before); expect(task.snapshot().invocations.at(-1)?.phase).toBe('repair');
        expect(task.snapshot().totals.unknownUsageInvocations).toBe(0);
        expect(task.snapshot().invocations.every(invocation => invocation.model === selected.fast)).toBe(true);
        reports.push({ scenario: 'suspended-structured-repair', provider: selected.name, passed: true, waits, checks, corrupted, snapshot: task.snapshot() });
      } finally { agent.destroy(); task.destroy(); transport.destroy(); Connector.remove(name); StorageRegistry.reset(); await rm(directory, { recursive: true, force: true }); }
    }, 150_000);

    it(`${selected.name} preserves the registered wait and spent task after suspension formatting is denied`, async () => {
      const name = `stage14-suspend-budget-${selected.name}`, transport = corruptSuspensionWrapup(connect(selected, name));
      const directory = await mkdtemp(join(tmpdir(), 'stage14-suspend-budget-'));
      const storage = new FileContextStorage({ agentId: 'suspend-budget', baseDirectory: directory });
      const correlations = new FileCorrelationStorage({ baseDirectory: join(directory, 'correlations') }); StorageRegistry.configure({ correlations });
      const task = new ModelTask({ limits: { maxCalls: 2, deadline: Date.now() + 90_000 } });
      let waits = 0, hooks = 0, suspendedEvents = 0, selections = 0;
      const agent = Agent.create({ connector: name, model: selected.main, thinking: { enabled: false }, temperature: 0,
        session: { storage, autoSave: false }, context: { model: selected.main, features: { workingMemory: false, inContextMemory: false } },
        instructions: 'Call register_wait exactly once, then acknowledge waiting in JSON.',
        tools: [{ definition: { type: 'function', function: { name: 'register_wait', description: 'Register a synthetic wait', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          execute: async () => { waits++; return SuspendSignal.create({ result: 'WAIT14_ACTUALLY_REGISTERED', correlationId: `failed14:${selected.name}` }); } }],
        hooks: { 'before:llm': async hook => { if (++hooks === 1) { hook.options.tool_choice = { type: 'function', function: { name: 'register_wait' } }; hook.options.parallel_tool_calls = false; } return {}; } },
        modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 1024, routing: { routes: { fast: { model: selected.fast } }, select: () => { selections++; return 'fast'; } } } });
      agent.on('execution:suspended' as never, () => { suspendedEvents++; });
      try {
        await expect(agent.run('Register the wait.', { modelTask: task, responseFormat: format })).rejects.toThrow('maxCalls');
        const saved = await storage.load(agent.getSessionId()!);
        expect(JSON.stringify(saved?.state)).toContain('WAIT14_ACTUALLY_REGISTERED');
        expect((saved?.state.metadata as Record<string, unknown>)?.suspensionFinalization).toMatchObject({ status: 'failed', correlationId: `failed14:${selected.name}` });
        expect(await correlations.resolve(`failed14:${selected.name}`)).not.toBeNull();
        for (let retry = 0; retry < 2; retry++) await expect(agent.run('External event received.')).rejects.toThrow('maxCalls');
        expect(agent.getModelUsage()?.id).toBe(task.id); expect(transport.calls()).toBe(2); expect(waits).toBe(1); expect(selections).toBe(1); expect(suspendedEvents).toBe(0);
        reports.push({ scenario: 'failed-suspension-budget-recovery', provider: selected.name, passed: true, waits, selections, suspendedEvents, snapshot: task.snapshot() });
      } finally { agent.destroy(); task.destroy(); transport.destroy(); Connector.remove(name); StorageRegistry.reset(); await rm(directory, { recursive: true, force: true }); }
    }, 120_000);

    it(`${selected.name} keeps a real tool roundtrip and final JSON on the selected model`, async () => {
      const name = `stage14-tool-${selected.name}`; connect(selected, name);
      let toolCalls = 0, selections = 0, mainCalls = 0;
      const tool: ToolFunction = { definition: { type: 'function', function: { name: 'lookup_invoice_status', description: 'Read the actual invoice status.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
        output: { effect: 'read' }, execute: async () => { toolCalls++; return { invoice: 'I14', status: 'SHIPPED' }; } };
      const task = new ModelTask({ limits: { maxCalls: 5, deadline: Date.now() + 100_000 } });
      const agent = Agent.create({ connector: name, model: selected.main, thinking: { enabled: false }, tools: [tool],
        instructions: 'You must call lookup_invoice_status exactly once before answering. Set answer to its exact status. Do not call it again after receiving its result.',
        context: { model: selected.main, features: { workingMemory: false, inContextMemory: false } },
        // This is a route/tool transport contract, not a prompt-compliance benchmark.
        // Require the first read through the public hook, then disable further tools.
        hooks: { 'before:llm': async hook => {
          if (++mainCalls === 1) { hook.options.tool_choice = { type: 'function', function: { name: 'lookup_invoice_status' } }; hook.options.parallel_tool_calls = false; }
          else { hook.options.tools = undefined; hook.options.tool_choice = undefined; }
          return {};
        } },
        modelExecution: { maxOutputTokensPerCall: 1024, routing: { routes: { fast: { model: selected.fast } }, select: () => { selections++; return 'fast'; } } } });
      try {
        const statusFormat = { ...format, schema: { ...schema, properties: { answer: { type: 'string', enum: ['PENDING', 'SHIPPED', 'CANCELLED'] } } } };
        const response = await agent.run('Look up invoice I14 and return its actual status in answer.', { responseFormat: statusFormat, modelTask: task });
        expect(response.output_parsed).toEqual({ answer: 'SHIPPED' }); expect(toolCalls).toBe(1); expect(selections).toBe(1);
        expect(task.snapshot().invocations.every(invocation => invocation.model === selected.fast)).toBe(true);
        reports.push({ scenario: 'real-tool-roundtrip', provider: selected.name, passed: true, toolCalls, selections, mainCalls,
          firstReadRequiredByHost: true, snapshot: task.snapshot() });
      } finally { agent.destroy(); task.destroy(); Connector.remove(name); }
    }, 120_000);

    it(`${selected.name} meets the predeclared held-out quality and token-cost gates`, async () => {
      const records = JSON.parse(await readFile(new URL('../../fixtures/model-routing/held-out.json', import.meta.url), 'utf8')) as Array<{ id: string; taskType: string; prompt: string; expected: string }>;
      const name = `stage14-pilot-${selected.name}`; connect(selected, name);
      const groups = [];
      try {
        for (const mode of ['fixed-main', 'fixed-fast', 'routing'] as const) {
          const results = [];
          for (const record of records) {
            const started = performance.now();
            const model = mode === 'fixed-fast' ? selected.fast : selected.main;
            const task = new ModelTask({ limits: { maxCalls: 2, deadline: Date.now() + 60_000 } });
            const agent = Agent.create({ connector: name, model, thinking: { enabled: false }, temperature: 0,
              instructions: 'Return the requested exact observation or computed value as the string answer. No explanations or tools.',
              context: { model, features: { workingMemory: false, inContextMemory: false } },
              modelExecution: { maxOutputTokensPerCall: 2048, ...(mode === 'routing' ? { routing: { routes: { fast: { model: selected.fast } },
                select: ({ hints }: { hints: { taskType?: string } }) => hints.taskType === 'lookup' ? 'fast' : 'default' } } : {}) } });
            try {
              const answerPattern = record.taskType === 'lookup' ? '^[A-Z_]+$' : record.taskType === 'calculation' ? '^[0-9]+$' : '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
              const scalarFormat = { ...format, schema: { ...schema, properties: { answer: { type: 'string', pattern: answerPattern } } } };
              const response = await agent.run(record.prompt, { responseFormat: scalarFormat, modelTask: task, ...(mode === 'routing' ? { routing: { taskType: record.taskType } } : {}) });
              const passed = (response.output_parsed as { answer: string }).answer === record.expected;
              const snapshot = task.snapshot();
              expect(snapshot.totals.unknownUsageInvocations).toBe(0); expect(snapshot.totals.unknownCostInvocations).toBe(0);
              results.push({ id: record.id, passed, observedAnswer: (response.output_parsed as { answer: string }).answer, wallMs: performance.now() - started, decision: response.routing, snapshot });
            } finally { agent.destroy(); task.destroy(); }
          }
          groups.push({ mode, successes: results.filter(result => result.passed).length, total: records.length,
            totalWallMs: results.reduce((sum, result) => sum + result.wallMs, 0),
            knownModelCostUSD: results.reduce((sum, result) => sum + result.snapshot.totals.knownModelCostUSD, 0), results });
        }
        const main = groups.find(group => group.mode === 'fixed-main')!, routed = groups.find(group => group.mode === 'routing')!;
        const reduction = 1 - routed.knownModelCostUSD / main.knownModelCostUSD;
        reports.push({ scenario: 'held-out-pilot', provider: selected.name, passed: main.successes === records.length && routed.successes === records.length && reduction >= .05,
          qualityLoss: main.successes - routed.successes, tokenCostReductionVsMain: reduction, groups });
        expect(main.successes).toBe(records.length); expect(routed.successes).toBe(records.length);
        expect(reduction).toBeGreaterThanOrEqual(.05);
        // Fixed-fast is measured independently, without making it the default policy.
        expect(groups.find(group => group.mode === 'fixed-fast')!.total).toBe(records.length);
      } finally { Connector.remove(name); }
    }, 300_000);
    it(`${selected.name} retains original evidence during a controlled main JSON repair`, async () => {
      const name = `stage14-source-repair-${selected.name}`, connector = connect(selected, name), backend = createProvider(connector);
      let calls = 0;
      const controlled: ITextProvider = { name: backend.name, capabilities: backend.capabilities,
        getModelCapabilities: model => backend.getModelCapabilities(model), getAdvancedCapabilities: model => backend.getAdvancedCapabilities!(model),
        async generate(options) {
          calls++;
          expect(JSON.stringify(options.input)).toContain('SOURCE_R14_MAIN_REPAIR');
          const response = await backend.generate(options);
          // Controlled corruption after a real billable call; preserve its real usage.
          if (calls === 1) { response.output_text = '{"answer":'; response.output = [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: response.output_text }] }]; }
          return response;
        }, streamGenerate: options => backend.streamGenerate(options), validateConfig: () => backend.validateConfig(), listModels: () => backend.listModels() };
      connector.getOptions().provider = controlled;
      const task = new ModelTask({ limits: { maxCalls: 2, deadline: Date.now() + 90_000 } });
      const agent = Agent.create({ connector: name, model: selected.main, thinking: { enabled: false }, temperature: 0,
        instructions: 'Compute the requested remaining quantity and return it as an integer in answer.',
        context: { model: selected.main, features: { workingMemory: false, inContextMemory: false } },
        modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 1024, routing: { routes: { fast: { model: selected.fast } }, select: () => 'fast' } } });
      try {
        const response = await agent.run('SOURCE_R14_MAIN_REPAIR: 41 confirmed units, 15 reserved units. How many remain?', { responseFormat: { ...format, schema: { ...schema, properties: { answer: { type: 'integer' } } } }, modelTask: task });
        expect(response.output_parsed).toEqual({ answer: 26 }); expect(calls).toBe(2);
        expect(task.snapshot().invocations.map(value => value.phase)).toEqual(['generation', 'repair']);
        reports.push({ scenario: 'controlled-main-source-repair', provider: selected.name, passed: true, snapshot: task.snapshot() });
      } finally { agent.destroy(); task.destroy(); if ('destroy' in backend && typeof backend.destroy === 'function') backend.destroy(); Connector.remove(name); }
    }, 120_000);
  }
  it('moves only portable text between explicitly authorized real providers', async () => {
    const openai = connect(providers[0], 'stage14-cross-primary'), anthropic = connect(providers[1], 'stage14-cross-secondary');
    const task = new ModelTask({ limits: { maxCalls: 4, deadline: Date.now() + 90_000 } });
    const agent = Agent.create({ connector: openai.name, model: providers[0].fast, thinking: { enabled: false },
      context: { model: providers[0].fast, features: { workingMemory: false, inContextMemory: false } },
      modelExecution: { maxOutputTokensPerCall: 512, routing: { routes: { alternate: { connector: anthropic.name, model: providers[1].fast, allowContextTransfer: true } } } } });
    try {
      await agent.run('Remember the observed marker CROSS14_SCOPED and reply ACK.', { modelTask: task });
      const response = await agent.run('Return the exact observed marker in answer.', { modelTask: task, routing: { route: 'alternate' }, responseFormat: format });
      expect(response.output_parsed).toEqual({ answer: 'CROSS14_SCOPED' });
      expect(task.snapshot().invocations.map(value => value.connector)).toEqual([openai.name, anthropic.name]);
      reports.push({ scenario: 'portable-cross-provider', passed: true, snapshot: task.snapshot() });
    } finally { agent.destroy(); task.destroy(); Connector.remove(openai.name); Connector.remove(anthropic.name); }
  }, 120_000);
  for (const crossProvider of [false, true]) for (const selected of providers.slice(0, 2)) it(`${selected.name} compacts on an alternative route, saves and restores its exact native owner (Google default=${crossProvider})`, async () => {
    const name = `stage14-native-${selected.name}-${crossProvider}`; connect(selected, name);
    const defaultName = crossProvider ? `${name}-google` : name;
    const defaultModel = crossProvider ? providers[2].main : selected.fast;
    if (crossProvider) connect(providers[2], defaultName);
    const nativeModel = selected.name === 'openai' ? 'gpt-6-astra' : 'claude-sonnet-4-6';
    const directory = await mkdtemp(join(tmpdir(), 'stage14-native-'));
    const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 150_000 } });
    const makeConfig = () => ({ connector: defaultName, model: defaultModel, userId: 'stage14-owner', thinking: { enabled: false },
      instructions: 'Answer from the observed project facts. Do not use tools. Preserve exact identifiers.',
      session: { storage: new FileContextStorage({ agentId: 'stage14-native', baseDirectory: directory }), autoSave: false },
      context: { model: defaultModel, agentId: 'stage14-native', maxContextTokens: 12000, responseReserve: 512, criticalCompactionThreshold: .3,
        features: { evidence: true, workingMemory: false, inContextMemory: false },
        plugins: { evidence: { storage: new FileEvidenceStorage({ directory: join(directory, 'evidence'), scope: { ownerId: 'stage14-owner', namespace: 'routing' } }) } },
        compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) },
      hooks: { 'before:llm': () => ({ modified: { max_output_tokens: 512 } }) },
      modelExecution: { ...(selected.name === 'openai' ? {} : { maxOutputTokensPerCall: 8192 }), routing: { routes: { compacting: { model: nativeModel, ...(crossProvider ? { connector: name, allowContextTransfer: true } : {}) } }, select: () => 'compacting' } },
    });
    let agent = Agent.create(makeConfig());
    try {
      for (let i = 0; i < 8; i++) {
        agent.context.addUserMessage(`Confirmed project ROUTE14_NATIVE has a limit of 43. Historical exchange ${i}.`);
        agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Confirmed historical observation with reference ROUTE14_NATIVE. '.repeat(55) }] }]);
      }
      const response = await agent.run('What are the project reference and confirmed limit?', { modelTask: task });
      expect(response.output_text).toContain('ROUTE14_NATIVE'); expect(response.output_text).toContain('43');
      expect(agent.context.getState().nativeContinuation?.binding.model).toBe(nativeModel);
      expect(task.snapshot().invocations.find(value => value.purpose === 'compactor')?.model).toBe(nativeModel);
      await agent.saveSession(); const sessionId = agent.getSessionId()!; expect(sessionId).toBeTruthy(); agent.destroy(); agent = await Agent.resume(sessionId, makeConfig());
      expect(agent.context.getState().nativeContinuation?.binding.model).toBe(nativeModel);
      expect(agent.model).toBe(defaultModel);
      const before = task.snapshot().totals.calls;
      await expect(agent.run('Attempt incompatible default', { routing: null, modelTask: task })).rejects.toThrow('ineligible');
      expect(task.snapshot().totals.calls).toBe(before);
      const resumed = await agent.run('Repeat the project reference and confirmed limit.', { modelTask: task });
      expect(resumed.output_text).toContain('ROUTE14_NATIVE'); expect(resumed.output_text).toContain('43');
      expect(task.snapshot().invocations.every(value => value.model === nativeModel)).toBe(true);
      reports.push({ scenario: 'native-route-save-restore', provider: selected.name, passed: true, configuredDefault: defaultModel, crossProvider,
        selectedNativeModel: nativeModel, incompatibleSwitchBlocked: true, snapshot: task.snapshot() });
    } finally { agent.destroy(); task.destroy(); Connector.remove(name); if (crossProvider) Connector.remove(defaultName); await rm(directory, { recursive: true, force: true }); }
  }, 180_000);
});
