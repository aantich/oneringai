// Public-package regression scenarios, executed unchanged in every browser realm.
import { Agent, AgentContextNextGen, Connector, InMemoryAdapter, InMemoryEvidenceStorage, MemorySystem,
  ModelTask, TaskStatePluginNextGen, PersistentInstructionsPluginNextGen, UserInfoPluginNextGen,
  InContextMemoryPluginNextGen, ToolManager, ToolEvidenceMiddleware, PermissionPolicyManager, ConnectorTools,
  StreamEventType, SuspendSignal, StorageRegistry, FrameworkLogger, AgentPackageOutcomeServer, exportAgentPackage, hydrateAgentPackageWithOutcomes, Vendor, getAllBuiltInTools } from 'oneringai';
import type { ConnectorPage, ToolExecutionOutcome, RemoteOutcomeTransport } from 'oneringai';
import { DemoMemorySessions } from '../../../examples/browser-node/memory-sessions.js';
import { ScriptedLoopProvider } from '../../../examples/agent-loop/scripted-provider.js';
import { offlineRoutingConnector } from '../../../examples/model-routing/fixture.js';
import { Vendor as SharedVendor, getVendorPresentation, VENDOR_PRESENTATIONS, assessModelParameters,
  getRealtimeModelCapabilities, getTranscriptionCapabilities } from 'oneringai/shared';
import { Vendor as TypesVendor, TASK_DEFAULTS, TTS_MODELS, IMAGE_MODELS } from 'oneringai/types';
import { createRoutineTool, registerRoutineToolCategory, ROUTINE_KEYS, createRoutineExecutionRecord, principalUser, InMemoryHistoryStorage, createGitHubReadFileTool } from 'oneringai';
import { ExecutionContext } from 'oneringai';
import { ExecutionContext as SubpathExecutionContext } from 'oneringai/agents';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(operation: () => unknown | Promise<unknown>, pattern: RegExp) {
  try { await operation(); } catch (error) { check(pattern.test(String(error)), `Unexpected error: ${String(error)}`); return; }
  throw new Error(`Expected rejection: ${pattern}`);
}

export async function runPluginRegressions() {
  check(getVendorPresentation(Vendor.OpenAI) && VENDOR_PRESENTATIONS && typeof assessModelParameters === 'function'
    && typeof getRealtimeModelCapabilities === 'function' && typeof getTranscriptionCapabilities === 'function', 'Shared metadata exports missing');
  check(TASK_DEFAULTS && TTS_MODELS && IMAGE_MODELS && ROUTINE_KEYS && typeof createRoutineTool === 'function'
    && typeof registerRoutineToolCategory === 'function' && typeof createRoutineExecutionRecord === 'function'
    && typeof principalUser === 'function' && new InMemoryHistoryStorage(), 'Portable supporting exports missing');
  check(Vendor === SharedVendor && Vendor === TypesVendor, 'Browser subpath singleton identity changed');
  check(ExecutionContext === SubpathExecutionContext, 'Browser agents subpath singleton identity changed');
  await rejects(() => new FrameworkLogger({ filePath: 'unsupported.log' }), /Node host/);
  for (const feature of ['persistentInstructions', 'userInfo']) await rejects(() => AgentContextNextGen.create({ model: 'gpt-4o-mini', agentId: 'missing-storage', features: { [feature]: true } }), /Browser storage/);
  const scope = { ownerId: 'browser-owner', namespace: 'all-plugins' }, storage = new DemoMemorySessions();
  const memory = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: () => ({ group: 'none', world: 'none' }) });
  const evidence = new InMemoryEvidenceStorage({ scope });
  let instructions: any = null, user: any = null;
  const config = { model: 'gpt-4o-mini', agentId: 'all-plugins', userId: scope.ownerId, storage,
    features: { workingMemory: true, inContextMemory: true, persistentInstructions: true, userInfo: true,
      toolCatalog: true, sharedWorkspace: true, memory: true, memoryWrite: true, evidence: true, taskState: true },
    plugins: { memory: { memory }, evidence: { scope, storage: evidence }, taskState: { scope, taskId: 'protected-task' },
      persistentInstructions: { storage: { load: async () => instructions, save: async (value: unknown) => { instructions = value; }, delete: async () => { instructions = null; }, exists: async () => instructions !== null, getPath: () => 'memory:instructions' } },
      userInfo: { storage: { load: async () => user, save: async (_id: string, value: unknown) => { user = value; }, delete: async () => { user = null; }, exists: async () => user !== null, getPath: () => 'memory:user' } },
    } };
  let context = AgentContextNextGen.create(config);
  try {
    check(context.getPlugins().length === 10, 'Built-in plugin missing');
    await context.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!.set('style', 'APP_STYLE');
    await context.getPlugin<UserInfoPluginNextGen>('user_info')!.storeSet('preference', { value: 'APP_PREFERENCE' });
    context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!.set('key', 'Important app state', 'APP_STATE');
    const task = context.getPlugin<TaskStatePluginNextGen>('task_state')!;
    task.updateHost({ notes: [{ id: 'limit', category: 'constraint', text: 'APP_PROTECTED', source: { label: 'Host' } }] }, 0);
    await rejects(() => task.updateHost({ notes: [] }, 0), /revision/i);
    context.addUserMessage('First turn');
    const prepared = await context.prepare();
    for (const marker of ['APP_STYLE', 'APP_PREFERENCE', 'APP_STATE', 'APP_PROTECTED']) check(JSON.stringify(prepared.input).includes(marker), `Missing ${marker}`);
    check(prepared.tools?.some(tool => 'function' in tool && tool.function.name === 'memory_remember'), 'Memory writes unavailable');
    check(getAllBuiltInTools().length === 9, 'Browser catalog inventory changed');
    await context.save('all-plugins'); context.destroy(); context = AgentContextNextGen.create(config);
    check(await context.load('all-plugins'), 'Plugin checkpoint missing');
    await context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Earlier work summarized' });
    check(JSON.stringify((await context.prepare()).input).includes('APP_PROTECTED'), 'Rollover lost host authority');
    const before = context.getState(), foreign = structuredClone(before);
    (foreign.pluginStates.task_state as any).scope.ownerId = 'other-owner';
    await rejects(() => context.restoreState(foreign), /scope/i);
    const after = context.getState();
    check(JSON.stringify(after.conversation) === JSON.stringify(before.conversation) && JSON.stringify(after.pluginStates) === JSON.stringify(before.pluginStates), 'Foreign checkpoint mutated live context');
    const manager = new ToolManager({ toolExecutionTimeout: 0 });
    let effects = 0;
    class FailingStorage extends InMemoryEvidenceStorage { override async put(): Promise<never> { throw new Error('backend unavailable'); } }
    try {
      manager.setToolContext({ userId: scope.ownerId });
      manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage: new FailingStorage({ scope }) }));
      manager.register({ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, execute: async () => { effects++; return { submitted: true }; }, output: { effect: 'write' } });
      const report = await manager.executeWithOutcome('submit', {});
      check(effects === 1 && report.outcome.status === 'succeeded' && report.evidence?.status === 'storage_failed', 'Evidence failure repeated or misreported an action');
      const permissions = new PermissionPolicyManager(); permissions.blocklistAdd('submit'); manager.setPermissionManager(permissions);
      const denied = await manager.executeWithOutcome('submit', {});
      check(denied.outcome.status === 'denied' && effects === 1, 'Denied action executed');
    } finally { manager.destroy(); }
    return { plugins: context.getPlugins().map(plugin => plugin.name), checkpoint: true, rollover: true, revisionAndScope: true, catalog: 9 };
  } finally { context.destroy(); }
}

export async function runSchemaRegressions(origin: string) {
  const name = 'schemas-' + crypto.randomUUID();
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, baseURL: origin + '/v1', options: { maxRetries: 0 } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini',
    modelExecution: { helpers: { extractor: { connector: name, model: 'gpt-4o-mini' } } } });
  const body = { type: 'object', properties: { currency: { $ref: '#/definitions/currency' } },
    definitions: { currency: { type: 'string', enum: ['USD'] } }, required: ['currency'] };
  const nested = { $id: 'child', ...body }, root = { $id: 'https://fixture.invalid/root' };
  const schemas = [{ $id: 'urn:example:currency', ...body },
    ...['allOf', 'anyOf', 'oneOf'].map(key => ({ ...root, [key]: [nested] })),
    { ...root, not: { not: nested } }, { ...root, definitions: { nested }, allOf: [{ $ref: 'child' }] },
    ...['#/', 'https://fixture.invalid/root#/', 'urn:example:currency#/'].map($id => ({ $id, ...body })),
    { ...root, contentSchema: { $id: 'nested/currency', type: 'string' }, type: 'object', properties: { currency: { $ref: 'nested/currency' } }, required: ['currency'] },
    ...[{}, true, { title: 'metadata only' }].map(then => ({ if: { $ref: '#/missing' }, then }))];
  const simple = { ...root, type: 'object', properties: { currency: { type: 'string' } }, required: ['currency'] };
  const task = new ModelTask();
  try {
    const githubName = name + '-github';
    const github = Connector.create({ name: githubName, serviceType: 'github', auth: { type: 'api_key', apiKey: 'offline' }, baseURL: origin + '/github' });
    try {
      const result = await createGitHubReadFileTool(github).execute({ repository: 'fixture/repo', path: 'bom.txt' });
      check(result.success && result.content?.includes('\uFEFFa'), 'GitHub UTF-8 decoding stripped the BOM');
    } finally { Connector.remove(githubName); }
    for (const schema of schemas) for (const validationOnly of [false, true]) {
      const result = await agent.invokeHelper<{ currency: string }>('extractor', 'Read USD', {
        schema: validationOnly ? simple : schema, validationSchema: schema, modelTask: task,
      });
      check(result.value.currency === 'USD', 'Helper lexical schema scope failed');
    }
    const nullable = { ...simple, properties: { currency: { type: ['string', 'null'] } } };
    for (const annotation of ['default', 'examples', 'const']) {
      const target = { type: 'object', properties: { currency: { type: 'string', nullable: true } }, required: ['currency'] };
      const schema = annotation === 'const'
        ? { definitions: { carrier: { const: target } }, $ref: '#/definitions/carrier/const' }
        : { [annotation]: annotation === 'examples' ? [target] : target, $ref: `#/${annotation}${annotation === 'examples' ? '/0' : ''}` };
      for (const validationOnly of [false, true]) {
        const result = await agent.invokeHelper<{ currency: null }>('extractor', 'NULL_CURRENCY_FIXTURE', {
          schema: validationOnly ? nullable : schema, validationSchema: schema, modelTask: task,
        });
        check(result.value.currency === null, 'Referenced annotation lost nullable semantics');
      }
    }
    const before = task.snapshot().totals.calls;
    for (const child of [{ $ref: '#/missing' }, { type: 'string', appKeyword: true }, { type: 'string', format: 'unknown-format' }]) {
      const invalid = { $ref: '#/default', default: { properties: { currency: child } } };
      for (const validationOnly of [false, true]) await rejects(() => agent.invokeHelper('extractor', 'Do not dispatch', {
        schema: validationOnly ? nullable : invalid, validationSchema: invalid, modelTask: task,
      }), /Invalid helper JSON schema/);
    }
    const invalidSchemas = [
      { ...simple, contentSchema: { $id: 'child', type: 'string' }, definitions: { other: { $id: 'child', type: 'number' } } },
      { ...simple, patternProperties: { '^currency$': { type: 'string' } } },
      { ...simple, items: { type: 'string' }, additionalItems: false },
    ];
    for (const invalid of invalidSchemas) for (const validationOnly of [false, true]) await rejects(() => agent.invokeHelper('extractor', 'Do not dispatch', {
      schema: validationOnly ? simple : invalid, validationSchema: invalid, modelTask: task,
    }), /Invalid helper JSON schema/);
    check(task.snapshot().totals.calls === before && before === schemas.length * 2 + 6, 'Invalid referenced schema dispatched or valid schema needed repair');
    return { primaryAndValidationSchemas: before, invalidBeforeDispatch: 12, urn: true, nestedScopes: true, githubBom: true, annotationReferences: true, beforeDispatch: true,
      normalizedIds: true, metadataIds: true, strictAdmission: true, inactiveBranches: true };
  } finally { agent.destroy(); task.destroy(); Connector.remove(name); }
}

export async function runTransportRegressions(origin: string) {
  const name = `transport-${crypto.randomUUID()}`;
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, baseURL: `${origin}/direct/v1`, options: { maxRetries: 0 } });
  const make = () => Agent.create({ connector: name, model: 'gpt-4o-mini', modelExecution: { maxOutputTokensPerCall: 32 } });
  const first = make(), second = make(), tasks: ModelTask[] = [];
  const task = (maxCalls = 4) => { const value = new ModelTask({ limits: { maxCalls } }); tasks.push(value); return value; };
  try {
    const left = task(), right = task();
    await Promise.all([first.runDirect('left', { modelTask: left }), second.runDirect('right', { modelTask: right })]);
    check(left.snapshot().totals.calls === 1 && right.snapshot().totals.calls === 1, 'Concurrent ownership mixed');
    const shared = task(1);
    const results = await Promise.allSettled([first.runDirect('admitted', { modelTask: shared }), second.runDirect('bounded', { modelTask: shared })]);
    check(results.filter(result => result.status === 'fulfilled').length === 1 && shared.snapshot().totals.calls === 1, 'Hard shared budget dispatched excess work');
    const early = task();
    for await (const _event of first.streamDirect('close early', { modelTask: early })) break;
    check(early.snapshot().totals.calls === 1, 'Early stream closure lost transport ownership');
    // A fresh call must not inherit the closed stream's invocation.
    await second.runDirect('after early close', { modelTask: right });
    check(early.snapshot().totals.calls === 1 && right.snapshot().totals.calls === 2, 'Closed stream leaked ownership');
    const unknownName = name + '-unknown', cancelName = name + '-cancel';
    Connector.create({ name: unknownName, vendor: Vendor.OpenAI, auth: { type: 'none' }, baseURL: `${origin}/unknown/v1`, options: { maxRetries: 0 } });
    Connector.create({ name: cancelName, vendor: Vendor.OpenAI, auth: { type: 'none' }, baseURL: `${origin}/cancel/v1`, options: { maxRetries: 0 } });
    const unknownAgent = Agent.create({ connector: unknownName, model: 'gpt-4o-mini' }), cancelledAgent = Agent.create({ connector: cancelName, model: 'gpt-4o-mini' });
    try {
      const unknown = task(); await unknownAgent.runDirect('unknown usage', { modelTask: unknown });
      check(unknown.snapshot().totals.unknownUsageInvocations === 1, 'Missing usage became known');
      const cancelled = task(), running = cancelledAgent.runDirect('cancel', { modelTask: cancelled });
      const timer = setTimeout(() => cancelled.cancel(), 80);
      try { await rejects(() => running, /abort|cancel/i); } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, 550));
      check(cancelled.snapshot().totals.calls === 1 && cancelled.snapshot().totals.unknownUsageInvocations === 1, 'Cancellation/late work altered ownership');
    } finally { unknownAgent.destroy(); cancelledAgent.destroy(); Connector.remove(unknownName); Connector.remove(cancelName); }
    return { concurrent: true, sharedBudget: true, earlyClosure: true, unknownUsage: true, cancellation: true };
  } finally { first.destroy(); second.destroy(); tasks.forEach(value => value.destroy()); Connector.remove(name); }
}

export async function runLoopRegressions(origin: string) {
  const name = `loop-${crypto.randomUUID()}`, fixture = offlineRoutingConnector(name);
  const routed = Agent.create({ connector: name, model: fixture.mainModel,
    modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 32,
      routing: { routes: { fast: { model: fixture.fastModel } }, select: () => 'fast' } } });
  try {
    check((await routed.run('Route this')).routing?.selectedRoute === 'fast', 'Managed routing failed');
    const external = await routed.beginExternalExecution({ source: 'browser-fixture' });
    check(external.length > 0, 'External execution missing'); routed.recordExternalUserInput('External input');
    const completed = await routed.completeExternalExecution({ outputText: 'External complete' });
    check(completed.output_text === 'External complete', 'External hooks failed');
  } finally { routed.destroy(); Connector.remove(name); }

  // An accepted action must survive early stream exit + unavailable evidence.
  const scope = { ownerId: 'recovery-owner', namespace: 'browser-recovery' }, sessions = new DemoMemorySessions();
  let effects = 0, available = false;
  class Outage extends InMemoryEvidenceStorage { override async put(record: Parameters<InMemoryEvidenceStorage['put']>[0]) { if (!available) throw new Error('offline outage'); return super.put(record); } }
  const storage = new Outage({ scope }), raw = { operationId: 'ONCE', detail: 'retained exact source '.repeat(1000) };
  const write = { definition: { type: 'function' as const, function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' as const }, execute: async () => { effects++; return raw; } };
  const provider = new ScriptedLoopProvider([{ calls: [{ id: 'accepted-action', name: 'submit', args: {} }] }]);
  const recoveryName = name + '-recovery'; Connector.create({ name: recoveryName, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: recoveryName, model: 'gpt-4o-mini', userId: scope.ownerId, tools: [write],
    context: { model: 'gpt-4o-mini', storage: sessions, features: { evidence: true }, plugins: { evidence: { storage } } } });
  try {
    let outcome: ToolExecutionOutcome | undefined;
    for await (const event of agent.stream('Submit once')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) { outcome = event.outcome; break; }
    check(outcome?.evidence?.status === 'storage_failed', 'Interrupted evidence not retained');
    await agent.context.save('interrupted');
    check(JSON.stringify((await sessions.load('interrupted'))?.state).includes(raw.detail), 'Checkpoint discarded raw action');
    agent.context.addAssistantResponse([]);
    await rejects(() => agent.context.rollover({ preserveRecentTurns: 0, summarize: async () => 'lossy' }), /unacknowledged/i);
    available = true;
    const receipt = await new ToolEvidenceMiddleware({ storage }).record(write, {}, { userId: scope.ownerId }, outcome, { value: raw });
    check(receipt.reference, 'Recovery acknowledgement missing');
    await agent.context.load('interrupted');
    check(await agent.context.acknowledgeToolEvidence('accepted-action', receipt.reference) === 1, 'Pending action acknowledgement failed');
    await agent.context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Accepted action retained in evidence' });
    check(effects === 1 && provider.requests.length === 1, 'Recovery replayed accepted action');
    check((await storage.readRecord(receipt.reference))?.result !== undefined, 'Exact recovered observation missing');
    await rejects(() => storage.readRecord({ ...receipt.reference!, sha256: '0'.repeat(64) }), /corrupt/i);
  } finally { agent.destroy(); Connector.remove(recoveryName); }

  // Actual runtime-derived collection schemas, registration side effects and
  // authenticated cursors under CSP. A fresh manager must reject an old cursor.
  const collectionName = 'slack-' + crypto.randomUUID().slice(0, 8);
  Connector.create({ name: collectionName, serviceType: 'slack', auth: { type: 'api_key', apiKey: 'offline' }, baseURL: origin + '/collections' });
  const tools = ConnectorTools.enhanced(collectionName, { profile: 'collections-v1', accountId: 'work' });
  const manager = new ToolManager(), replacement = new ToolManager();
  try {
    manager.registerConnectorTools(collectionName, tools, { accountId: 'work' });
    replacement.registerConnectorTools(collectionName, tools, { accountId: 'work' });
    const toolName = `${collectionName}_work_list_channels_page`;
    const first = await manager.execute(toolName, { pageSize: 1 }) as ConnectorPage<{ id: string }>;
    check(first.items[0]?.id === 'first' && first.position.state === 'more', 'Collection first page failed');
    const second = await manager.execute(toolName, { pageSize: 1, continuation: first.position.continuation }) as ConnectorPage<{ id: string }>;
    check(second.items[0]?.id === 'second' && second.position.state === 'end', 'Collection continuation failed');
    check((await replacement.executeWithOutcome(toolName, { pageSize: 1, continuation: first.position.continuation })).outcome.status === 'failed', 'Cursor escaped its manager');
  } finally { manager.destroy(); replacement.destroy(); Connector.remove(collectionName); }
  await runControlRegressions();
  return { routing: true, external: true, protectedRecovery: true, runtimeCollectionSchema: true, scopedCursor: true, controlsAndAsync: true, suspensionFailure: true, structuredRepair: true, remoteReconciliation: true };
}

async function runControlRegressions() {
  const name = 'controls-' + crypto.randomUUID().slice(0, 8);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const provider = new ScriptedLoopProvider([{ calls: [{ id: 'async-call', name: 'background', args: {} }] }, { text: 'Working' }, { text: 'NOT_JSON' }, { text: '{"ok":true}' }]);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector: name, model: 'gpt-4o-mini', asyncTools: { autoContinue: false }, tools: [{
    definition: { type: 'function', blocking: false, function: { name: 'background', parameters: { type: 'object', properties: {} } } },
    execute: async () => { await gate; return { done: true }; },
  }] });
  try {
    const response = await agent.run('Start background work');
    check(response.pendingAsyncTools?.length === 1 && agent.hasPendingAsyncTools(), 'Async call not tracked');
    agent.cancelAllAsyncTools(); release();
    await new Promise(resolve => setTimeout(resolve, 0));
    const repaired = await agent.run('Return JSON', { responseFormat: { type: 'json_schema', name: 'result', strict: true,
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } });
    check((repaired.output_parsed as { ok?: boolean })?.ok === true && provider.requests.length === 4, 'Bounded structured repair failed');
  } finally { release(); agent.destroy(); Connector.remove(name); }

  // Saving a suspension correlation can fail after the tool's actual action.
  let effects = 0;
  const suspendedProvider = new ScriptedLoopProvider([{ calls: [{ id: 'suspend', name: 'wait_event', args: {} }] }, { text: 'Waiting for event' }]);
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: suspendedProvider } });
  StorageRegistry.configure({ correlations: { save: async () => { throw new Error('correlation outage'); }, resolve: async () => null, delete: async () => {}, exists: async () => false, listBySession: async () => [], listByAgent: async () => [], pruneExpired: async () => 0, getPath: () => 'offline:failed' } });
  const suspended = Agent.create({ connector: name, model: 'gpt-4o-mini', session: { storage: new DemoMemorySessions(), autoSave: false }, tools: [{
    definition: { type: 'function', function: { name: 'wait_event', parameters: { type: 'object', properties: {} } } },
    execute: async () => { effects++; return SuspendSignal.create({ result: 'Accepted', correlationId: 'fixture-event' }); },
  }] });
  try {
    await rejects(() => suspended.run('Wait'), /correlation outage/);
    check(effects === 1, 'Suspension storage failure replayed the action');
  } finally { suspended.destroy(); StorageRegistry.reset(); Connector.remove(name); }

  // Existing authenticated remote-outcome transport: a disconnect after commit
  // is reconciled from its receipt, never by issuing the write again.
  Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ScriptedLoopProvider([]) } });
  let submissions = 0;
  const source = Agent.create({ connector: name, model: 'gpt-4o-mini', tools: [{ definition: { type: 'function', function: { name: 'submit' } }, output: { effect: 'write' }, execute: async () => ({ submission: ++submissions }) }] });
  const sourceStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'source', namespace: 'remote' } });
  const localStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'local', namespace: 'remote' } });
  const server = new AgentPackageOutcomeServer(source, exportAgentPackage(source), { storage: sourceStorage, maxInlineBytes: 0, authorize: (_access, host: { authenticated: boolean }) => host.authenticated });
  const host = { authenticated: true };
  const transport: RemoteOutcomeTransport = { negotiate: request => server.negotiate(request, host), execute: async request => { await server.execute(request, host); throw new Error('disconnect after commit'); }, getReceipt: request => server.getReceipt(request, host), cancel: request => server.cancel(request, host), readEvidence: request => server.readEvidence(request, host) };
  const remote = await hydrateAgentPackageWithOutcomes(server.package(), { connector: name, model: 'gpt-4o-mini', transport, permissions: { autoApproveAll: true }, contextFactory: () => ({ model: 'gpt-4o-mini', features: { evidence: true }, plugins: { evidence: { storage: localStorage } } }) });
  try {
    check((await remote.agent.tools.executeWithOutcome('submit', {}, { callId: 'original-write' })).outcome.status === 'failed', 'Disconnect lost ambiguity');
    await rejects(() => remote.agent.run('Retry'), /reconciliation/);
    const operation = remote.session.inspect()[0]!;
    const receipt = await remote.session.getReceipt(operation.operationId);
    check(!receipt.pendingSource && receipt.receipt?.serverOutcome?.status === 'succeeded' && submissions === 1, 'Remote recovery repeated the action');
  } finally { remote.session.close(); remote.agent.destroy(); await server.close(); source.destroy(); Connector.remove(name); }
}
