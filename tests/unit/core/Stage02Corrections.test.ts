import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { PermissionPolicyManager } from '@/core/permissions/PermissionPolicyManager.js';
import { ToolManager } from '@/core/ToolManager.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import { ToolCallState } from '@/domain/entities/Tool.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';
const provider = vi.hoisted(() => ({ name: 'fixture', capabilities: { text: true }, generate: vi.fn(), streamGenerate: vi.fn(),
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000 }) }));
vi.mock('@/core/createProvider.js', () => ({ createProvider: () => provider }));
const agents: Agent[] = [];
function textResponse() { return { id: 'done', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed', output_text: 'done',
  output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; }
function toolsResponse() { return { ...textResponse(), output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT,
  content: [{ type: ContentType.TOOL_USE, id: 'original', name: 'probe', arguments: '{}' }] }] }; }
function fixture(execute: ToolFunction['execute'], blocking = true, overrides: Record<string, unknown> = {}) {
  const agent = Agent.create({ connector: 'outcomes', model: 'gpt-4o-mini', tools: [{ definition: { type: 'function', blocking,
    function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute }], maxIterations: 3, emptyResponseRetry: { enabled: false },
    asyncTools: { autoContinue: false }, context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } }, ...overrides });
  agents.push(agent); return agent;
}
beforeEach(() => {
  provider.generate.mockReset(); provider.streamGenerate.mockReset(); Connector.create({ name: 'outcomes', vendor: Vendor.OpenAI, auth: { type: 'none' } });
  provider.generate.mockResolvedValueOnce(toolsResponse()).mockResolvedValue(textResponse());
  let streams = 0;
  provider.streamGenerate.mockImplementation(async function* () {
    if (streams++ === 0) {
      yield { type: StreamEventType.TOOL_CALL_START, response_id: 'call', item_id: 'tool-item', tool_call_id: 'original', tool_name: 'probe', sequence_number: 1 };
      yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DELTA, response_id: 'call', item_id: 'tool-item', tool_call_id: 'original', tool_name: 'probe', delta: '{}', sequence_number: 2 };
      yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'call', tool_call_id: 'original', tool_name: 'probe', arguments: '{}' };
    }
    else yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'done', item_id: 'message', output_index: 0, content_index: 0, delta: 'done', sequence_number: 1 };
    yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'done', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, iterations: 1 };
  });
});
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); Connector.clear(); Connector.setAccessPolicy(null); vi.useRealTimers(); vi.unstubAllGlobals(); });


// Regressions for independently reproduced Stage 02 review findings.
describe('Stage 02 review corrections', () => {
  it('discards a completed queued result after account rebinding', async () => {
    let release!: (value: string) => void;
    const agent = fixture(async () => new Promise<string>(r => { release = r; }), false);
    agent.tools.mergeToolContext({ userId: 'alice', accountId: 'work' });
    await agent.run('background');
    release('ALICE_PRIVATE_QUEUED_VALUE');
    await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    expect(JSON.stringify(agent.context.getState())).not.toContain('ALICE_PRIVATE_QUEUED_VALUE');
    agent.tools.mergeToolContext({ userId: 'bob', accountId: 'personal' });
    await agent.run('bob request');
    expect(JSON.stringify(provider.generate.mock.calls.at(-1))).not.toContain('ALICE_PRIVATE_QUEUED_VALUE');
  });
  it('keeps captured connector authority with the original user', async () => {
    Connector.create({ name: 'alice-private', auth: { type: 'api_key', apiKey: 'local-test' } });
    Connector.create({ name: 'bob-private', auth: { type: 'api_key', apiKey: 'local-test' } });
    Connector.setAccessPolicy({ canAccess: (connector, context) => connector.name === context.userId + '-private' });
    let ready!: () => void; const started = new Promise<void>(r => { ready = r; });
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const agent = fixture(async (_args, context) => {
      const before = context!.connectorRegistry!.has('bob-private'); ready(); await gate;
      return { capturedUser: context!.userId, bobBefore: before, bobAfter: context!.connectorRegistry!.has('bob-private'), aliceAfter: context!.connectorRegistry!.has('alice-private') };
    });
    agent.userId = 'alice';
    const call = agent.tools.execute('probe', {}); await started; agent.userId = 'bob'; release();
    const result = await call;
    expect(result).toEqual({ capturedUser: 'alice', bobBefore: false, bobAfter: false, aliceAfter: true });
    Connector.setAccessPolicy(null);
  });
  it('stream fail mode counts a settled failure before propagating it', async () => {
    const agent = fixture(async () => { throw new Error('tool failed'); }, true, { errorHandling: { toolFailureMode: 'fail' } });
    agent.tools.executionPipeline.remove('result-normalizer');
    let failure: unknown; try { for await (const _ of agent.stream('fail')) { /* consume */ } } catch (e) { failure = e; }
    expect(failure).toBeDefined();
    expect(agent.tools.getRegistration('probe')!.metadata.failureCount).toBe(1);
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolFailureCount: 1 });
  });
  it('counts failure before a consumer stops at the done event', async () => {
    const agent = fixture(async () => { throw new Error('tool failed'); });
    for await (const event of agent.stream('stop after done')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) break;
    expect(agent.tools.getRegistration('probe')!.metadata.failureCount).toBe(1);
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolFailureCount: 1 });
  });
  it('operation deadline settles safe retry while a tee cancellation remains pending', async () => {
    vi.useFakeTimers(); const host = new AbortController(); let finish!: () => void;
    const source = new Response(new ReadableStream<Uint8Array>({ start(controller) { finish = () => controller.close(); } }), { status: 503 });
    const clone = source.clone();
    const fetch = vi.fn().mockResolvedValueOnce(clone).mockResolvedValue(new Response('done'));
    vi.stubGlobal('fetch', fetch);
    const connector = Connector.create({ name: 'review-fetch', auth: { type: 'api_key', apiKey: 'local-test' }, baseURL: 'https://fixture.invalid', retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } });
    let settled = false;
    const call = connector.fetch('/retry', { retryPolicy: 'safe', timeoutScope: 'operation', timeout: 10, signal: host.signal }).then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(20); host.abort(); await vi.advanceTimersByTimeAsync(20);
    expect(fetch).toHaveBeenCalledTimes(1); expect(settled).toBe(true);
    finish(); await source.text(); await vi.advanceTimersByTimeAsync(0); await call;
    vi.unstubAllGlobals();
  });
  it('operation response clones retain URL/type/redirect metadata', async () => {
    const source = new Response('body', { status: 200 });
    for (const [key, value] of Object.entries({ url: 'https://fixture.invalid/redirected', type: 'basic', redirected: true })) Object.defineProperty(source, key, { value });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(source));
    const connector = Connector.create({ name: 'review-fetch', auth: { type: 'api_key', apiKey: 'local-test' }, baseURL: 'https://fixture.invalid' });
    const result = await connector.fetch('/body', { timeoutScope: 'operation', timeout: 100 }); const clone = result.clone();
    expect(result.url).toBe('https://fixture.invalid/redirected'); expect(result.redirected).toBe(true); expect(result.type).toBe('basic');
    expect(clone.url).toBe(result.url); expect(clone.redirected).toBe(true); expect(clone.type).toBe('basic');
    await Promise.all([result.text(), clone.text()]); vi.unstubAllGlobals();
  });
  it('in-place replacement leaves an admitted implementation unchanged', async () => {
    const manager = new ToolManager(); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const old = vi.fn(async () => 'old'); const replacement = vi.fn(async () => 'new');
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: old });
    manager.executionPipeline.use({ name: 'hold', beforeExecute: async () => gate });
    const call = manager.executeWithOutcome('probe', {});
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: replacement }); release();
    expect((await call).result).toBe('old'); expect(old).toHaveBeenCalledTimes(1); expect(replacement).not.toHaveBeenCalled();
    expect((await manager.executeWithOutcome('probe', {})).result).toBe('new');
    expect(manager.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 2, successCount: 2, failureCount: 0 }); manager.destroy();
  });
  it('native redirect metadata survives operation wrapper and chained clones', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: '/final' }); res.end(); }
      else res.end('body');
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    const baseURL = `http://127.0.0.1:${address.port}`;
    try {
      const original = await fetch(baseURL + '/redirect'); const originalClone = original.clone();
      expect(originalClone.url).toBe(baseURL + '/final'); expect(originalClone.redirected).toBe(true); expect(originalClone.type).toBe('basic');
      await Promise.all([original.text(), originalClone.text()]);
      const connector = Connector.create({ name: 'review-native', auth: { type: 'api_key', apiKey: 'local-test' }, baseURL });
      const wrapped = await connector.fetch('/redirect', { timeoutScope: 'operation', timeout: 1000 }); const clone = wrapped.clone();
      expect(wrapped.url).toBe(baseURL + '/final'); expect(wrapped.redirected).toBe(true); expect(wrapped.type).toBe('basic');
      const second = clone.clone();
      for (const copy of [clone, second]) { expect(copy.url).toBe(baseURL + '/final'); expect(copy.redirected).toBe(true); expect(copy.type).toBe('basic'); }
      expect(await second.text()).toBe('body');
      await Promise.all([wrapped.text(), clone.text()]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('keeps the approved action during in-place registration replacement', async () => {
    const manager = new ToolManager(); const policies = new PermissionPolicyManager();
    const check = vi.spyOn(policies, 'check').mockImplementation(async context => ({ allowed: context.toolSource === 'safe-read', blocked: context.toolSource !== 'safe-read', reason: 'Only read is allowed', policyName: 'review' }));
    manager.setPermissionManager(policies);
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let admitted!: () => void; const admission = new Promise<void>(r => { admitted = r; });
    manager.executionPipeline.use({ name: 'hold-after-permission', priority: 10, beforeExecute: async () => { admitted(); await gate; } });
    const read = vi.fn(async () => 'read'); const write = vi.fn(async () => 'write happened');
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: read }, { source: 'safe-read' });
    const call = manager.executeWithOutcome('probe', {}); await admission;
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: write }, { source: 'forbidden-write' }); release();
    expect((await call).result).toBe('read'); expect(write).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1); expect(check.mock.calls[0]![0].toolSource).toBe('safe-read');
    expect((await manager.executeWithOutcome('probe', {})).outcome.status).toBe('denied'); expect(write).not.toHaveBeenCalled(); manager.destroy();
  });
  it('contains async observer failure and delivers the original successful result once', async () => {
    let release!: (value: string) => void;
    const agent = fixture(async () => new Promise<string>(r => { release = r; }), false);
    agent.on('async:tool:complete', () => { throw new Error('UI disconnected'); });
    await agent.run('background'); release('EXTERNAL_EFFECT_SUCCEEDED');
    await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    expect(agent.tools.getRegistration('probe')!.metadata).toMatchObject({ usageCount: 1, successCount: 1, failureCount: 0 });
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 1, toolFailureCount: 0 });
    await agent.continueWithAsyncResults();
    expect(JSON.stringify(provider.generate.mock.calls.at(-1))).not.toContain('UI disconnected');
    expect(JSON.stringify(provider.generate.mock.calls.at(-1))).toContain('EXTERNAL_EFFECT_SUCCEEDED');
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
  });

});

describe('background delivery and streaming boundaries', () => {
  it.each(['user', 'account', 'accounts', 'identities', 'registry'] as const)('drops already settled results after %s scope changes during manual draining', async change => {
    let finish!: (v: string) => void;
    const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false);
    agent.tools.mergeToolContext({ userId: 'alice', accountId: 'work', connectorAccounts: { outcomes: 'work' }, identities: [{ connector: 'outcomes' }] });
    await agent.run('start'); finish('PRIVATE_SETTLED_BODY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    if (change === 'user') agent.userId = 'bob';
    if (change === 'account') agent.tools.mergeToolContext({ accountId: 'personal' });
    if (change === 'accounts') agent.tools.mergeToolContext({ connectorAccounts: { outcomes: 'personal' } });
    if (change === 'identities') agent.identities = [{ connector: 'other' }];
    if (change === 'registry') agent.tools.mergeToolContext({ connectorRegistry: Connector.asRegistry() });
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
    expect(JSON.stringify(provider.generate.mock.calls)).not.toContain('PRIVATE_SETTLED_BODY');
  });
  it.each(['async:tool:complete', 'async:continuation:start', 'async:results:injected'] as const)('suppresses delivery on reentrant rebinding from %s', async event => {
    let finish!: (v: string) => void; const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false);
    agent.userId = 'alice'; agent.on(event, () => { agent.userId = 'bob'; });
    await agent.run('start'); finish('REENTRANT_PRIVATE_BODY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    if (event === 'async:continuation:start') await expect(agent.continueWithAsyncResults()).rejects.toThrow('scope changed');
    else if (event === 'async:results:injected') await expect(agent.run('next')).rejects.toThrow('scope changed');
    else await agent.run('next');
    expect(JSON.stringify(provider.generate.mock.calls)).not.toContain('REENTRANT_PRIVATE_BODY');
    expect(JSON.stringify(agent.context.getState())).not.toContain('REENTRANT_PRIVATE_BODY');
  });
  it('delivers same-scope background results automatically after an active owner releases', async () => {
    let finish!: (v: string) => void; let release!: () => void;
    const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false, { asyncTools: { autoContinue: true, batchWindowMs: 1 } });
    const gate = new Promise<void>(r => { release = r; });
    provider.generate.mockReset().mockResolvedValueOnce(toolsResponse()).mockImplementationOnce(async () => { await gate; return textResponse(); }).mockResolvedValue(textResponse());
    const first = agent.run('start'); await vi.waitFor(() => expect(provider.generate).toHaveBeenCalledTimes(2));
    finish('AUTOMATIC_BODY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    expect(provider.generate).toHaveBeenCalledTimes(2); release(); await first;
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalledTimes(3));
    expect(JSON.stringify(provider.generate.mock.calls.at(-1))).toContain('AUTOMATIC_BODY');
    await vi.waitFor(() => expect(agent.isRunning()).toBe(false));
  });
  it.each(['cancel', 'destroy'] as const)('suppresses queued delivery on %s', async action => {
    let finish!: (v: string) => void; const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false);
    await agent.run('start'); finish('CANCELLED_PRIVATE_BODY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    if (action === 'cancel') { agent.cancelAllAsyncTools(); await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results'); }
    else { agent.destroy(); await expect(agent.continueWithAsyncResults()).rejects.toThrow(); }
    expect(JSON.stringify(provider.generate.mock.calls)).not.toContain('CANCELLED_PRIVATE_BODY');
  });
  it('honors cancellation reentrantly during continuation notification', async () => {
    let finish!: (v: string) => void; const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false);
    await agent.run('start'); finish('CANCEL_DURING_NOTIFY'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    agent.on('async:continuation:start', () => agent.cancelAllAsyncTools());
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('scope changed');
    expect(JSON.stringify(agent.context.getState())).not.toContain('CANCEL_DURING_NOTIFY');
  });
  it('retains explicit trusted host continuation input after rebinding', async () => {
    const agent = fixture(async () => 'unused'); provider.generate.mockReset().mockResolvedValue(textResponse()); agent.userId = 'bob';
    await agent.continueWithAsyncResults([{ tool_use_id: 'host-input', content: 'TRUSTED_HOST_BODY', state: ToolCallState.COMPLETED }]);
    expect(JSON.stringify(provider.generate.mock.calls.at(-1))).toContain('TRUSTED_HOST_BODY');
  });
  it.each(['error', 'timeout'] as const)('contains throwing async %s observers without double accounting', async kind => {
    let fail!: (e: Error) => void;
    const agent = fixture(async () => new Promise((_r, reject) => { fail = reject; }), false);
    agent.tools.executionPipeline.remove('result-normalizer');
    if (kind === 'timeout') { const definition = agent.tools.getToolDefinition('probe'); if (definition?.type === 'function') definition.timeout = 10; }
    agent.on(kind === 'error' ? 'async:tool:error' : 'async:tool:timeout', () => { throw new Error('observer failed'); });
    await agent.run('start'); if (kind === 'error') fail(new Error('original failure'));
    await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 0, toolFailureCount: kind === 'timeout' ? 0 : 1 });
    if (kind === 'timeout') { expect(agent.getMetrics()?.toolTimeoutCount).toBe(1); fail(new Error('late rejection')); }
    await agent.continueWithAsyncResults(); expect(JSON.stringify(provider.generate.mock.calls.at(-1))).not.toContain('observer failed');
    if (kind === 'error') expect(JSON.stringify(provider.generate.mock.calls.at(-1))).toContain('original failure');
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
  });
  it.each(['success', 'failure', 'timeout', 'invalid-json'] as const)('records %s before a stream returns early and leaves no partial protocol group', async kind => {
    const agent = fixture(async () => { if (kind === 'failure') throw new Error('failed'); if (kind === 'timeout') return new Promise(() => undefined); return 'ok'; });
    if (kind === 'timeout') agent.tools.toolExecutionTimeout = 10;
    const originalStream = provider.streamGenerate.getMockImplementation()!;
    provider.streamGenerate.mockImplementation(async function* (...args: unknown[]) {
      for await (const event of originalStream(...args)) {
        if (kind === 'invalid-json' && event.type === StreamEventType.TOOL_CALL_ARGUMENTS_DONE) yield { ...event, arguments: '{' };
        else yield event;
      }
    });
    for await (const event of agent.stream('early')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) break;
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: kind === 'success' ? 1 : 0, toolFailureCount: kind === 'success' || kind === 'timeout' ? 0 : 1 });
    if (kind === 'timeout') expect(agent.getMetrics()?.toolTimeoutCount).toBe(1);
    expect(JSON.stringify(agent.context.getState())).not.toContain('"tool_use"');
    expect(JSON.stringify(agent.context.getState())).not.toContain('"tool_result"');
    expect(agent.isRunning()).toBe(false);
  });
  it('counts only the processed call when a multi-call stream is partially consumed', async () => {
    const execute = vi.fn(async () => 'ok'); const agent = fixture(execute);
    provider.streamGenerate.mockImplementation(async function* () {
      for (const id of ['first', 'second']) {
        yield { type: StreamEventType.TOOL_CALL_START, response_id: 'call', item_id: id, tool_call_id: id, tool_name: 'probe', sequence_number: 1 };
        yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'call', tool_call_id: id, tool_name: 'probe', arguments: '{}' };
      }
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'call', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, iterations: 1 };
    });
    for await (const event of agent.stream('partial')) if (event.type === StreamEventType.TOOL_EXECUTION_DONE) break;
    expect(execute).toHaveBeenCalledTimes(1); expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 1, toolFailureCount: 0 });
    expect(JSON.stringify(agent.context.getState())).not.toContain('"tool_use"');
  });
});

describe('admission snapshots', () => {
  it('honors bindings added after construction but before admission, including ID lookup', async () => {
    const service = Connector.create({ name: 'late-service', auth: { type: 'none' } });
    const agent = fixture(async (_args, ctx) => ({ names: ctx!.connectorRegistry!.list(), byId: ctx!.connectorRegistry!.getById!(service.id).name, account: ctx!.connectorAccounts!['late-service'] }));
    agent.identities = [{ connector: 'outcomes' }]; agent.tools.mergeToolContext({ connectorAccounts: { 'late-service': 'bound-late' } });
    expect(await agent.tools.execute('probe', {})).toEqual({ names: ['outcomes', 'late-service'], byId: 'late-service', account: 'bound-late' });
  });
  it('retains original permission, definition and implementation during an approval wait', async () => {
    const manager = new ToolManager(); const policies = new PermissionPolicyManager(); manager.setPermissionManager(policies);
    let ready!: () => void; let release!: () => void;
    const admitted = new Promise<void>(r => { ready = r; }); const gate = new Promise<void>(r => { release = r; });
    const check = vi.spyOn(policies, 'check').mockImplementation(async ctx => { ready(); await gate; return { allowed: ctx.toolPermissionConfig?.riskLevel === 'low', blocked: ctx.toolPermissionConfig?.riskLevel !== 'low', reason: 'risk check' }; });
    const old = vi.fn(async ({ value }) => value); const replacement = vi.fn(async () => 'write');
    const definition = { type: 'function' as const, function: { name: 'probe', description: 'read', parameters: { type: 'object', properties: { value: { type: 'string' } } } } };
    manager.register({ definition, execute: old }, { permission: { riskLevel: 'low', sensitiveArgs: ['original'] }, source: 'read', tags: ['safe'] });
    const definitions: string[] = []; manager.executionPipeline.use({ name: 'inspect', priority: 10, beforeExecute: async ctx => { definitions.push(ctx.tool.definition.function.description!); } });
    const call = manager.executeWithOutcome('probe', { value: 'approved' }, { callId: 'original', runId: 'one' }); await admitted;
    definition.function.description = 'mutated'; manager.getRegistration('probe')!.permission!.sensitiveArgs!.push('changed');
    manager.register({ definition: { type: 'function', function: { name: 'probe', description: 'write' } }, execute: replacement }, { permission: { riskLevel: 'high' }, source: 'write', tags: ['unsafe'] }); release();
    const report = await call; expect(report.result).toBe('approved'); expect(report.outcome).toMatchObject({ callId: 'original', runId: 'one', status: 'succeeded' });
    expect(definitions).toEqual(['read']); expect(check.mock.calls[0]![0]).toMatchObject({ toolSource: 'read', toolTags: ['safe'], toolPermissionConfig: { riskLevel: 'low', sensitiveArgs: ['original'] } });
    expect(replacement).not.toHaveBeenCalled(); expect(old).toHaveBeenCalledTimes(1); manager.destroy();
  });
});

describe('queued registry and batch isolation', () => {
  it('discards a settled result when an ambient tenant changes behind the same registry object', async () => {
    const alice = Connector.create({ name: 'alice-private', auth: { type: 'none' } });
    const bob = Connector.create({ name: 'bob-private', auth: { type: 'none' } }); let visible = alice;
    const agent = fixture(async () => 'PRIVATE_AMBIENT_BODY', false);
    agent.tools.mergeToolContext({ connectorRegistry: {
      get: () => visible, has: name => visible.name === name, list: () => [visible.name], listAll: () => [visible], size: () => 1,
      getDescriptionsForTools: () => visible.name, getInfo: () => ({}),
    } });
    await agent.run('start'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
    visible = bob; await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results');
    expect(JSON.stringify(provider.generate.mock.calls)).not.toContain('PRIVATE_AMBIENT_BODY');
  });
  it.each(['same-scope', 'rebound'] as const)('handles batched background results with an active owner: %s', async scope => {
    const finishes: Array<(v: string) => void> = []; let ownerRelease!: () => void;
    const agent = fixture(async () => new Promise<string>(r => { finishes.push(r); }), false, { asyncTools: { autoContinue: true, batchWindowMs: 1 } }); agent.userId = 'alice';
    const response = toolsResponse(); response.output[0]!.content.push({ type: ContentType.TOOL_USE, id: 'second', name: 'probe', arguments: '{}' });
    const ownerGate = new Promise<void>(r => { ownerRelease = r; });
    provider.generate.mockReset().mockResolvedValueOnce(response).mockImplementationOnce(async () => { await ownerGate; return textResponse(); }).mockResolvedValue(textResponse());
    const run = agent.run('start'); await vi.waitFor(() => expect(finishes).toHaveLength(2));
    finishes[0]!('BATCH_PRIVATE_ONE'); await vi.waitFor(() => expect(agent.getPendingAsyncTools()).toHaveLength(1));
    if (scope === 'rebound') agent.userId = 'bob'; finishes[1]!('BATCH_PRIVATE_TWO');
    await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false)); ownerRelease(); await run;
    if (scope === 'same-scope') {
      await vi.waitFor(() => expect(provider.generate).toHaveBeenCalledTimes(3));
      expect(JSON.stringify(provider.generate.mock.calls.at(-1))).toContain('BATCH_PRIVATE_ONE');
      expect(JSON.stringify(provider.generate.mock.calls.at(-1))).toContain('BATCH_PRIVATE_TWO');
      await vi.waitFor(() => expect(agent.isRunning()).toBe(false));
    } else { await agent.run('bob request'); expect(JSON.stringify(provider.generate.mock.calls.at(-1))).not.toContain('BATCH_PRIVATE'); }
  });
});

// A settled result stays cancellable while continuation observers run.
it('honors specific-call cancellation reentrantly during queued continuation notification', async () => {
  let finish!: (v: string) => void; const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false);
  await agent.run('start'); finish('SPECIFIC_CANCEL_PRIVATE'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
  agent.on('async:continuation:start', () => agent.cancelAsyncTool('original'));
  await expect(agent.continueWithAsyncResults()).rejects.toThrow('scope changed');
  expect(JSON.stringify(agent.context.getState())).not.toContain('SPECIFIC_CANCEL_PRIVATE');
  expect(JSON.stringify(provider.generate.mock.calls)).not.toContain('SPECIFIC_CANCEL_PRIVATE');
});

it('preserves inserted-input visibility for existing async injection observers', async () => {
  let finish!: (v: string) => void; const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false);
  await agent.run('start'); finish('VISIBLE_TO_ORIGINAL_SCOPE'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
  const observed = vi.fn(() => { expect(JSON.stringify(agent.context.getCurrentInput())).toContain('VISIBLE_TO_ORIGINAL_SCOPE'); });
  agent.on('async:results:injected', observed); await agent.run('continue'); expect(observed).toHaveBeenCalledTimes(1);
});
it.each([false, true])('clears invalidated queued input after reentrant context listeners, including throw=%s', async throwing => {
  let finish!: (v: string) => void; const agent = fixture(async () => new Promise<string>(r => { finish = r; }), false); agent.userId = 'alice';
  await agent.run('start'); finish('CONTEXT_LISTENER_PRIVATE'); await vi.waitFor(() => expect(agent.hasPendingAsyncTools()).toBe(false));
  const observer = () => {
    if (JSON.stringify(agent.context.getCurrentInput()).includes('CONTEXT_LISTENER_PRIVATE')) agent.userId = 'bob';
    if (throwing) throw new Error('reentrant observer');
  };
  agent.context.on('message:added', observer);
  await expect(agent.continueWithAsyncResults()).rejects.toThrow(throwing ? 'reentrant observer' : 'scope changed');
  expect(JSON.stringify(agent.context.getCurrentInput())).not.toContain('CONTEXT_LISTENER_PRIVATE');
  expect(JSON.stringify(agent.context.getOriginalUserInput())).not.toContain('CONTEXT_LISTENER_PRIVATE');
  expect(agent.isRunning()).toBe(false); agent.context.off('message:added', observer);
  await agent.run('bob request'); expect(JSON.stringify(provider.generate.mock.calls.at(-1))).not.toContain('CONTEXT_LISTENER_PRIVATE');
});
