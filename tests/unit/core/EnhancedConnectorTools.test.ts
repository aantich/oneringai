import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, AgentContextNextGen, Connector, ConnectorTools, InMemoryEvidenceStorage, ToolManager, ContentType, MessageRole, ToolCallState } from '@/index.js';
import type { EnhancedConnectorAttempt, ToolFunction } from '@/index.js';
import { registerMicrosoftTools } from '@/tools/microsoft/register.js';
import { registerGoogleTools } from '@/tools/google/register.js';
import { registerSlackTools } from '@/tools/slack/register.js';
import { registerGitHubTools } from '@/tools/github/register.js';
import { fixture } from './routing/fixture.js';

const managers: ToolManager[] = [], agents: Agent[] = [], contexts: AgentContextNextGen[] = [];
const services = [
  { service: 'microsoft', baseURL: 'https://graph.microsoft.com/v1.0', count: 12, read: 'get_meeting', args: { eventId: 'event-1' } },
  { service: 'google-api', baseURL: 'https://www.googleapis.com', count: 12, read: 'get_meeting', args: { eventId: 'event-1' } },
  { service: 'slack', baseURL: 'https://slack.com/api', count: 11, read: 'get_channel_info', args: { channel: 'C1' } },
  { service: 'github', baseURL: 'https://api.github.com', count: 9, read: 'get_pr', args: { repository: 'owner/repo', pull_number: 1 } },
];
function make(service = services[2]!, options = {}) { return Connector.create({ name: 'service', serviceType: service.service, baseURL: service.baseURL, auth: { type: 'api_key', apiKey: 'synthetic-test-key' }, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }, ...options }); }
function manager(tools: ToolFunction[]) { const value = new ToolManager(); value.registerMany(tools); managers.push(value); return value; }
function enhanced(options = {}) { return ConnectorTools.enhanced('service', { profile: 'execution-v1', ...options }); }
async function settled<T>(work: Promise<T>): Promise<T | { outcome: import('@/index.js').ToolExecutionOutcome }> { try { return await work; } catch (error) { if (error && typeof error === 'object' && 'outcome' in error && error.outcome) return { outcome: error.outcome as import('@/index.js').ToolExecutionOutcome }; throw error; } }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); managers.splice(0).forEach(value => value.destroy()); agents.splice(0).forEach(value => value.destroy()); contexts.splice(0).forEach(value => value.destroy()); Connector.setRegistry(null); Connector.clear(); ConnectorTools.clearCache(); registerMicrosoftTools(); registerGoogleTools(); registerSlackTools(); registerGitHubTools(); vi.useRealTimers(); });

describe('fixed enhanced connector execution profile', () => {
  it.each(services)('$service has isolated exact inventory/schema and conservative generic effect', service => {
    make(service); const legacy = ConnectorTools.for('service'), before = JSON.stringify(legacy.map(tool => tool.definition)); const selected = enhanced();
    expect(selected).toHaveLength(service.count); expect(new Set(selected.map(tool => tool.definition.function.name)).size).toBe(service.count);
    for (const tool of selected) {
      expect(tool.definition.function.name).toMatch(/_exec$/); const old = legacy.find(old => old.definition.function.name + '_exec' === tool.definition.function.name)!;
      expect(tool.definition).not.toBe(old.definition); expect(tool.definition.function.parameters).toEqual(old.definition.function.parameters);
      expect(tool.output?.effect).toMatch(/^(read|write|unknown)$/); expect(tool.connectorName).toBe('service');
    }
    expect(selected.find(tool => tool.definition.function.name === 'service_api_exec')?.output?.effect).toBe('unknown');
    expect(JSON.stringify(legacy.map(tool => tool.definition))).toBe(before); expect(ConnectorTools.for('service').map(tool => tool.definition)).toEqual(legacy.map(tool => tool.definition));
  });
  it.each(['unknown', 'future-collections-v2', ''])('rejects unsupported profile %s before I/O', profile => {
    make(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); expect(() => enhanced({ profile })).toThrow(/profile/); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects custom overrides and unsupported services instead of silently substituting legacy tools', () => {
    make(); ConnectorTools.registerService('slack', () => []); expect(() => enhanced()).toThrow(/audited/);
    make(services[2], { name: 'other', serviceType: 'custom-service' }); expect(() => ConnectorTools.enhanced('other', { profile: 'execution-v1' })).toThrow(/audited/);
  });
  it('validates host deadlines/accounts and provider names before I/O', () => {
    make(); expect(() => enhanced({ timeoutMs: -1 })).toThrow(/timeoutMs/); expect(() => enhanced({ accountId: ' ' })).toThrow(/accountId/);
    expect(() => enhanced({ accountId: 'a'.repeat(60) })).toThrow(/constraints/);
  });
  it.each(services)('$service reports its actual error return through outcomes but preserves the old raw body', async service => {
    make(service); const fetch = vi.fn(async () => response(service.service === 'slack' ? { ok: false, error: 'not_allowed' } : service.service === 'github' ? { message: 'not_allowed' } : { error: { message: 'not_allowed' } }, service.service === 'slack' ? 200 : 403)); vi.stubGlobal('fetch', fetch);
    const legacy = manager(ConnectorTools.for('service')), selected = manager(enhanced());
    const old = await legacy.executeWithOutcome(`service_${service.read}`, service.args), next = await selected.executeWithOutcome(`service_${service.read}_exec`, service.args);
    expect(old.outcome.status).toBe('succeeded'); expect(next.outcome.status).toBe('failed'); expect(next.result).toEqual(old.result); expect(next.outcome.error).toContain('not_allowed');
  });
  it('reports explicit local owner validation without payload-shape guessing or dispatch', async () => {
    make(services[3]); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const selected = manager(enhanced()); const report = await selected.executeWithOutcome('service_get_pr_exec', { pull_number: 1 });
    expect(report.outcome.status).toBe('failed'); expect(report.result).toMatchObject({ success: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it('counts safe GET retries separately from one logical operation and isolates observers', async () => {
    make(services[3]); const attempts: EnhancedConnectorAttempt[] = [];
    const fetch = vi.fn().mockResolvedValueOnce(response({ message: 'try again' }, 503)).mockResolvedValueOnce(response({ number: 1, title: 'PR', labels: [], requested_reviewers: [], user: { login: 'u' }, head: { ref: 'h' }, base: { ref: 'b' }, state: 'open', html_url: 'https://example.test/pr/1' })); vi.stubGlobal('fetch', fetch);
    const selected = manager(enhanced({ onAttempt: (value: EnhancedConnectorAttempt) => { attempts.push(value); throw new Error('UI observer'); } }));
    const result = await selected.executeWithOutcome('service_get_pr_exec', { repository: 'owner/repo', pull_number: 1 });
    expect(result.outcome.status).toBe('succeeded'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(attempts.map(value => [value.attempt, value.state])).toEqual([[1, 'dispatched'], [1, 'received'], [2, 'dispatched'], [2, 'received']]);
    expect(new Set(attempts.map(value => value.requestId)).size).toBe(1); expect(new Set(attempts.map(value => value.invocationId)).size).toBe(1); expect(JSON.stringify(attempts)).not.toContain('Authorization');
  });
  it('does not retry an uncertain mutation or arbitrary generic GET', async () => {
    make(); const fetch = vi.fn(async () => response({ ok: false, error: 'unavailable' }, 503)); vi.stubGlobal('fetch', fetch);
    const selected = manager(enhanced());
    expect((await selected.executeWithOutcome('service_post_message_exec', { channel: 'C1', text: 'one write' })).outcome.status).toBe('failed'); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await selected.executeWithOutcome('service_api_exec', { method: 'GET', endpoint: '/anything' })).outcome.status).toBe('failed'); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('forwards cancellation before auth and leaves a concurrent auth waiter usable', async () => {
    const connector = make(); let token!: (value: string) => void; const waiting = new Promise<string>(resolve => { token = resolve; }); vi.spyOn(connector, 'getToken').mockReturnValue(waiting);
    const fetch = vi.fn(async () => response({ ok: true, channel: { id: 'C1', name: 'channel' } })); vi.stubGlobal('fetch', fetch);
    const selected = manager(enhanced()), controller = new AbortController();
    const first = settled(selected.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' }, { signal: controller.signal }));
    const second = selected.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' }); controller.abort(); token('synthetic-token');
    expect((await first).outcome.status).toBe('cancelled'); expect((await second).outcome.status).toBe('succeeded'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels a stalled response body under the whole invocation deadline', async () => {
    make(); let cancelled = false;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }))));
    const selected = manager(enhanced({ timeoutMs: 20 }));
    const timed = await settled(selected.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' })); expect(timed.outcome.status, timed.outcome.error).toBe('timed_out');
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
  it('stops a multi-request write between requests without replaying the first acceptance', async () => {
    make(services[0]); const controller = new AbortController();
    const fetch = vi.fn(async () => { controller.abort(); return response({ id: 'draft-accepted', body: { content: 'quoted' } }); }); vi.stubGlobal('fetch', fetch);
    const selected = manager(enhanced()); const result = await settled(selected.executeWithOutcome('service_send_email_exec', { to: ['x@example.test'], subject: 'synthetic', body: 'body', replyToMessageId: 'message-1' }, { signal: controller.signal }));
    expect(result.outcome.status).toBe('cancelled'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('checks current host registry authority on every invocation', async () => {
    const connector = make(); let allowed = true; const registry = { get: () => { if (!allowed) throw new Error('scope revoked'); return connector; } } as never;
    const selected = manager(enhanced({ registry })); allowed = false; const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await selected.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' })).outcome.status).toBe('failed'); expect(fetch).not.toHaveBeenCalled();
  });
  it('registers only selected definitions with connector/account metadata in a real Agent', () => {
    make(); const selected = enhanced({ accountId: 'work' }), f = fixture({ identities: [{ connector: 'service', accountId: 'work', toolFilter: selected.map(tool => tool.definition.function.name) }] }); agents.push(f.agent);
    f.agent.tools.registerConnectorTools('service', selected, { accountId: 'work' });
    expect(f.agent.tools.listEnabled().sort()).toEqual(selected.map(tool => tool.definition.function.name).sort());
    expect(f.agent.tools.getEnabledRegistrations().every(reg => reg.source === 'connector:service:work')).toBe(true); expect(f.agent.tools).toBe(f.agent.context.tools);
  });
  it('acknowledges a complete large read source before projecting and recovers it after rollover', async () => {
    make(services[3]); const content = 'SOURCE_EXACT_MARKER ' + 'long body '.repeat(2000); vi.stubGlobal('fetch', vi.fn(async () => response({ type: 'file', path: 'source.txt', size: content.length, encoding: 'base64', content: Buffer.from(content).toString('base64'), sha: 'source-sha' })));
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'profile' } });
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { evidence: true, inContextMemory: false, workingMemory: false }, plugins: { evidence: { storage, projectThresholdBytes: 1 } } }); contexts.push(context);
    context.tools.registerConnectorTools('service', enhanced()); context.addUserMessage('read source');
    context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'read-1', name: 'service_read_file_exec', arguments: '{}' }] }]);
    const report = await context.tools.executeWithOutcome('service_read_file_exec', { repository: 'owner/repo', path: 'source.txt' }, { callId: 'read-1' });
    expect(report.outcome.status).toBe('succeeded'); expect(report.result).toMatchObject({ content: '1\t' + content, truncated: false }); expect(report.evidence?.projection).toContain('source-sha'); expect(report.evidence?.projection).not.toContain(content);
    context.addToolResults([{ tool_use_id: 'read-1', content: report.result, evidence: report.evidence, state: ToolCallState.COMPLETED }]);
    context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Acknowledged source.' }] }]);
    await context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Read acknowledged; retrieve evidence for the source.' });
    expect((await storage.readRecord(report.evidence!.reference!))?.result).toEqual(report.result);
  });
});

describe('enhanced profile review regressions', () => {
  it('preserves a real accepted draft ID when the following write fails, without retry or legacy shape changes', async () => {
    make(services[0]); const fetch = vi.fn().mockResolvedValueOnce(response({ id: 'accepted-draft-42', body: { content: 'original quoted text' } }, 201)).mockResolvedValueOnce(response({ error: { message: 'PATCH unavailable' } }, 503)); vi.stubGlobal('fetch', fetch);
    const selected = manager(enhanced()); const report = await selected.executeWithOutcome('service_send_email_exec', { to: ['x@example.test'], subject: 'subject', body: 'body', replyToMessageId: 'original' });
    expect(report.outcome.status).toBe('failed'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(report.result).toMatchObject({ success: false, acceptedResources: [{ kind: 'reply_draft', id: 'accepted-draft-42', state: 'accepted' }] });
  });
  it('keeps legacy definition-only timeout semantics unchanged', async () => {
    const value = manager([{ definition: { type: 'function', function: { name: 'legacy' }, timeout: 1 }, execute: async () => { await new Promise(resolve => setTimeout(resolve, 8)); return 'settled'; } }]);
    expect((await value.executeWithOutcome('legacy', {})).outcome.status).toBe('succeeded');
  });
  it('honors the shorter selected per-call deadline and preserves timeout evidence', async () => {
    make(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }))));
    const value = manager(enhanced({ timeoutMs: 100 })); const result = await settled(value.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' }, { timeoutMs: 5 }));
    expect(result.outcome).toMatchObject({ status: 'timed_out', timeoutMs: 5 });
  });
  it('cancels retry backoff before the next transport dispatch', async () => {
    make(services[3], { retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 1000 } }); const controller = new AbortController();
    const fetch = vi.fn(async () => response({ message: 'retry later' }, 503)); vi.stubGlobal('fetch', fetch);
    const value = manager(enhanced()); const running = settled(value.executeWithOutcome('service_get_pr_exec', { repository: 'owner/repo', pull_number: 1 }, { signal: controller.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); controller.abort(); expect((await running).outcome.status).toBe('cancelled'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses the host account lock in authentication and transport diagnostics', async () => {
    const connector = make(); const token = vi.spyOn(connector, 'getToken').mockResolvedValue('synthetic'); const attempts: EnhancedConnectorAttempt[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: true, channel: { id: 'C1', name: 'channel' } })));
    const value = manager(enhanced({ accountId: 'work', onAttempt: (attempt: EnhancedConnectorAttempt) => attempts.push(attempt) })); value.setToolContext({ userId: 'host', accountId: 'hostile-other' });
    expect((await value.executeWithOutcome('service_work_get_channel_info_exec', { channel: 'C1', accountId: 'model-other' })).outcome.status).toBe('succeeded');
    expect(token).toHaveBeenCalledWith('host', 'work'); expect(attempts.every(value => value.accountId === 'work')).toBe(true);
  });
  it('does not change a failed projection into another source action', async () => {
    make(services[3]); const content = 'unchanged source '.repeat(1000); const fetch = vi.fn(async () => response({ type: 'file', path: 'source.txt', size: content.length, encoding: 'base64', content: Buffer.from(content).toString('base64'), sha: 'exact-sha' })); vi.stubGlobal('fetch', fetch);
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'projection' } });
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { evidence: true, inContextMemory: false, workingMemory: false }, plugins: { evidence: { storage, projectThresholdBytes: 1 } } }); contexts.push(context);
    const tools = enhanced(); tools.find(tool => tool.definition.function.name === 'service_read_file_exec')!.output!.summarize = () => { throw new Error('view failed'); }; context.tools.registerConnectorTools('service', tools);
    const report = await context.tools.executeWithOutcome('service_read_file_exec', { repository: 'owner/repo', path: 'source.txt' });
    expect(report.outcome.status).toBe('succeeded'); expect(report.evidence?.status).toBe('projection_failed'); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await storage.readRecord(report.evidence!.reference!))?.result).toEqual(report.result);
  });
});

it('preserves a legacy RequestInit proxy that rejects private symbol reflection', async () => {
  const connector = make(); vi.stubGlobal('fetch', vi.fn(async () => response({ ok: true })));
  const options = new Proxy({ method: 'GET', skipRetry: true }, { getOwnPropertyDescriptor(target, property) { if (typeof property === 'symbol') throw new Error('No symbol reflection'); return Reflect.getOwnPropertyDescriptor(target, property); } });
  expect((await connector.fetch('/probe', options)).ok).toBe(true);
});

it('keeps an existing Agent usable with a nonextensible shared context manager', async () => {
  const f = fixture(); agents.push(f.agent);
  const context = AgentContextNextGen.create({ model: 'main', features: { workingMemory: false, inContextMemory: false } }); contexts.push(context);
  const shared = Object.preventExtensions(context.tools);
  const agent = Agent.create({ connector: f.name, model: 'main', context }); agents.push(agent);
  expect(agent.tools).toBe(shared); expect((await agent.run('legacy request')).output_text).toBe('ANSWER');
});

it('contains async diagnostic observer rejection without replaying a request', async () => {
  make(); const fetch = vi.fn(async () => response({ ok: true, channel: { id: 'C1', name: 'channel' } })); vi.stubGlobal('fetch', fetch);
  const value = manager(enhanced({ onAttempt: async () => { throw new Error('Async UI observer'); } }));
  expect((await value.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' })).outcome.status).toBe('succeeded');
  await new Promise(resolve => setTimeout(resolve, 0)); expect(fetch).toHaveBeenCalledTimes(1);
});

it('rejects a model-selected credential destination on a different origin while preserving the old generic contract', async () => {
  make(); const fetch = vi.fn(async () => response({ ok: true })); vi.stubGlobal('fetch', fetch);
  const selected = manager(enhanced()); const denied = await selected.executeWithOutcome('service_api_exec', { method: 'GET', endpoint: 'https://untrusted.example.test/collect' });
  expect(denied.outcome.status).toBe('denied'); expect(fetch).not.toHaveBeenCalled();
  const legacy = manager(ConnectorTools.for('service')); expect((await legacy.executeWithOutcome('service_api', { method: 'GET', endpoint: 'https://untrusted.example.test/collect' })).outcome.status).toBe('succeeded'); expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps the existing Agent permission policy effective for selected tools', async () => {
  make(); const tools = enhanced(); const f = fixture({ identities: [{ connector: 'service', toolFilter: tools.map(tool => tool.definition.function.name) }] }); agents.push(f.agent); f.agent.tools.registerConnectorTools('service', tools);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const result = await f.agent.tools.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' });
  expect(result.outcome).toMatchObject({ status: 'denied', executionStarted: false }); expect(fetch).not.toHaveBeenCalled();
});

it('keeps the configured HTTP host authoritative on the selected generic endpoint', async () => {
  make(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const value = manager(enhanced());
  expect((await value.executeWithOutcome('service_api_exec', { method: 'GET', endpoint: '/safe-path', headers: { Host: 'untrusted.example.test' } })).outcome.status).toBe('denied'); expect(fetch).not.toHaveBeenCalled();
});

it('cancels pending redirect-body cleanup before another generic request and contains late cleanup rejection', async () => {
  vi.useFakeTimers(); make();
  let rejectCleanup!: (error: Error) => void;
  const cleanup = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectCleanup = reject; }));
  const redirect = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('intermediate')); }, cancel: cleanup }),
    { status: 307, headers: { Location: '/next' } });
  const fetch = vi.fn(async () => redirect); vi.stubGlobal('fetch', fetch);
  const value = manager(enhanced({ timeoutMs: 20 }));
  const pending = value.executeWithOutcome('service_api_exec', { method: 'POST', endpoint: '/redirect', body: { id: 'one' } }).catch(error => error);
  await vi.advanceTimersByTimeAsync(25);
  expect((await pending).outcome.status).toBe('timed_out'); expect(fetch).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1);
  rejectCleanup(new Error('late redirect cleanup')); await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('captures enhanced connector authority before a yielding pipeline hook (scoped=%s)', async scoped => {
  const first = make(); vi.spyOn(first, 'getToken').mockResolvedValue('first-admitted-token');
  const second = make(services[2], { name: 'replacement' }); vi.spyOn(second, 'getToken').mockResolvedValue('next-admission-token');
  let current = first;
  Connector.setRegistry({ get: () => current, list: () => ['service'], has: () => true } as never);
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const admission = new Promise<void>(resolve => { entered = resolve; });
  const value = manager(enhanced({ accountId: 'work' }));
  if (scoped) value.setToolContext({ connectorRegistry: { get: () => Connector.get('service'), list: () => ['service'], has: () => true } as never });
  let blocked = true;
  value.executionPipeline.use({ name: 'admission-barrier', beforeExecute: async () => { if (blocked) { entered(); await barrier; } } });
  const authorization: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => { authorization.push(new Headers(options.headers).get('Authorization')!); return response({ ok: true, channel: { id: 'C1', name: 'channel' } }); }));
  const running = value.executeWithOutcome('service_work_get_channel_info_exec', { channel: 'C1' });
  await admission; current = second; blocked = false; release();
  expect((await running).outcome.status).toBe('succeeded');
  expect((await value.executeWithOutcome('service_work_get_channel_info_exec', { channel: 'C1' })).outcome.status).toBe('succeeded');
  expect(authorization).toEqual(['Bearer first-admitted-token', 'Bearer next-admission-token']);
});

it.each(['connector', 'account'])('rejects enhanced %s name collisions atomically and retains the original source', async dimension => {
  const firstName = dimension === 'connector' ? 'a b' : 'service', nextName = dimension === 'connector' ? 'a_b' : 'service';
  const firstAccount = dimension === 'account' ? 'work!' : 'work', nextAccount = dimension === 'account' ? 'work?' : 'work';
  make(services[2], { name: firstName });
  const first = ConnectorTools.enhanced(firstName, { profile: 'execution-v1', accountId: firstAccount });
  const value = manager([]); value.registerConnectorTools(firstName, first, { accountId: firstAccount });
  if (firstName !== nextName) make(services[2], { name: nextName });
  const next = ConnectorTools.enhanced(nextName, { profile: 'execution-v1', accountId: nextAccount });
  expect(() => value.registerConnectorTools(nextName, next, { accountId: nextAccount })).toThrow(/collision/);
  expect(value.getEnabledRegistrations().map(reg => reg.tool)).toEqual(first);
  expect(value.getEnabledRegistrations().every(reg => reg.source === `connector:${firstName}:${firstAccount}`)).toBe(true);
  expect(() => value.register(next[0]!)).toThrow(/collision/);
});

it('requires enhanced registration metadata to match the selected account without changing legacy overwrite behavior', () => {
  make(); const tools = enhanced({ accountId: 'work' }), value = manager([]);
  expect(() => value.registerConnectorTools('service', tools)).toThrow(/connector\/account/); expect(value.listEnabled()).toHaveLength(0);
  expect(() => value.registerConnectorTools('other', tools, { accountId: 'work' })).toThrow(/connector\/account/); expect(value.listEnabled()).toHaveLength(0);
  value.registerConnectorTools('service', tools, { accountId: 'work' }); value.registerConnectorTools('service', enhanced({ accountId: 'work' }), { accountId: 'work' }); expect(value.listEnabled()).toHaveLength(tools.length);
  const old = ConnectorTools.for('service'); value.registerConnectorTools('service', old); value.registerConnectorTools('different', old); expect(value.getEnabledRegistrations().filter(reg => reg.source === 'connector:different')).toHaveLength(old.length);
});

it('preserves execution-v1 coexistence and execution on a sealed manager when collections are not selected', async () => {
  make(); const value = manager([]); value.registerConnectorTools('service', ConnectorTools.for('service')); value.registerConnectorTools('service', enhanced());
  expect(value.listEnabled()).toContain('service_get_channel_info'); expect(value.listEnabled()).toContain('service_get_channel_info_exec'); Object.preventExtensions(value);
  vi.stubGlobal('fetch', vi.fn(async () => response({ ok: true, channel: { id: 'C1', name: 'channel' } })));
  expect((await value.executeWithOutcome('service_get_channel_info_exec', { channel: 'C1' })).outcome.status).toBe('succeeded');
});
