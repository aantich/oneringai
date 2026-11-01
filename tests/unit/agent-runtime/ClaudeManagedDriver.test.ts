import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from '@/agent-runtime/index.js';
import { ClaudeManagedDriver } from '@/agent-runtime/claude-managed.js';
import { claudeManagedFixture } from '../../../examples/agent-runtime/claude-managed-fixture.js';

const policy = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
afterEach(() => Connector.clear());
async function setup(fixtureOptions = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'claude-managed-test-')); const wire = claudeManagedFixture(fixtureOptions); let calls = 0;
  Connector.create({ name: 'managed-claude', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'offline-only' } });
  const createRuntime = () => new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new ClaudeManagedDriver({ createClient: wire.createClient, maxReconnects: 2, environmentIds: ['borrowed-environment'] })], sessionStorage: new FileRuntimeSessionStorage(directory), resolveTools: () => ({ fingerprint: 'host-probe-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => { calls++; return { success: false, businessValue: 'original' }; } }] }) }) });
  const runtime = createRuntime(); const agent = runtime.createAgent({ id: 'logical', instructions: 'Use probe.', tools: ['probe'] });
  const options = { execution: { driver: 'anthropic.managed.api', connector: 'managed-claude', model: 'claude-sonnet-4-6' }, context: { userId: 'owner' }, environment: { type: 'provider-managed' as const }, policy };
  return { runtime, agent, options, wire, createRuntime, calls: () => calls, cleanup: async () => { await runtime.destroy(); await rm(directory, { recursive: true, force: true }); } };
}
describe('Claude managed actual-SDK wire adapter', () => {
  it('creates owned resources, handles custom actions and paginates native event history', async () => {
    const f = await setup();
    try {
      await f.agent.inspect(f.options); expect(f.wire.requests).toHaveLength(0);
      const session = await f.agent.openSession(f.options); const run = await session.run('first', { requestId: 'first' }); const result = await run.result;
      expect(result.status).toBe('completed'); expect(result.outputText).toBe('ACK'); expect(result.usage?.inputTokens).toBe(5); expect(f.calls()).toBe(1);
      expect(f.wire.counts.eventPages).toBeGreaterThan(2);
      expect(f.wire.requests.find(r => r.path === '/v1/agents' && r.method === 'POST')?.body).toMatchObject({ multiagent: null, skills: [], mcp_servers: [], tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: false } }, { type: 'custom', name: 'probe' }] });
      expect(await session.run('first', { requestId: 'first' })).toBe(run);
      expect((await (await session.run('continue')).result).status).toBe('completed'); expect(f.calls()).toBe(2);
      await f.runtime.deleteSession(session.reference(), { context: f.options.context });
      expect(f.wire.counts).toMatchObject({ sessionDeletes: 1, agentArchives: 1, environmentDeletes: 1 });
    } finally { await f.cleanup(); }
  });
  it.each(['before','after'] as const)('recovers a lost custom-result response %s acceptance without repeating the action', async dropToolResult => {
    const f = await setup({ dropToolResult });
    try { const session = await f.agent.openSession(f.options); expect((await (await session.run('task')).result).outputText).toBe('ACK'); expect(f.calls()).toBe(1); expect(f.wire.counts.inputs).toBe(1); }
    finally { await f.cleanup(); }
  });
  it('keeps budget pause waiting until an explicit acknowledged interrupt', async () => {
    const f = await setup({ budgetPause: true });
    try {
      const session = await f.agent.openSession({ ...f.options, execution: { ...f.options.execution, driverConfig: { maxListCostUsdCents: '50' } } });
      const run = await session.run('task'); let finished = false; void run.result.then(() => { finished = true; }, () => undefined);
      await vi.waitFor(async () => expect((await session.inspectState()).waitReason).toBe('budget_reached'));
      expect(finished).toBe(false); expect(f.calls()).toBe(0); await expect(session.run('another')).rejects.toThrow('active');
      await run.cancel(); expect((await run.result).status).toBe('cancelled');
      expect(f.wire.requests.find(r => r.path === '/v1/sessions' && r.method === 'POST')?.body.budget).toEqual({ type: 'limit', max_list_cost: { currency: 'USD', amount: '50' } });
    } finally { await f.cleanup(); }
  });
  it('detaches/reobserves a running native session without new input or interrupt', async () => {
    const f = await setup({ pauseAfterTool: true }); let restored: AgentRuntime | undefined;
    try {
      const session = await f.agent.openSession(f.options); const original = await session.run('task');
      await vi.waitFor(() => expect(f.wire.counts.deliveries).toBe(1)); const reference = session.reference(); await session.detach(); await f.runtime.destroy();
      expect(f.wire.counts.interrupts).toBe(0); restored = f.createRuntime(); const recovered = await restored.resumeSession(reference, { context: f.options.context });
      f.wire.complete(); expect((await (await recovered.getRun(original.id)).result).outputText).toBe('ACK'); expect(f.calls()).toBe(1); expect(f.wire.counts.inputs).toBe(1);
      await restored.deleteSession(reference, { context: f.options.context });
    } finally { await restored?.destroy(); await f.cleanup(); }
  });
  it('retains missing usage as unknown and rejects unsupported overrides before dispatch', async () => {
    const f = await setup({ missingUsage: true });
    try {
      const session = await f.agent.openSession(f.options);
      await expect(session.run('x', { model: 'claude-opus-4-6' })).rejects.toThrow('run.model_override');
      await expect(session.run('x', { responseFormat: { type: 'json_schema', schema: { type: 'object' } } })).rejects.toThrow('run.structured_output');
      const result = await (await session.run('real')).result; expect(result.usage?.inputTokens).toBeUndefined(); expect(result.usage?.outputTokens).toBeUndefined();
      expect(f.wire.counts.inputs).toBe(1);
    } finally { await f.cleanup(); }
  });
  it('reconciles partial setup before cleanup without creating another environment', async () => {
    const f = await setup({ dropEnvironmentCreation: true });
    try {
      let reference: import('@/agent-runtime/types.js').RuntimeSessionReference | undefined;
      try { await f.agent.openSession(f.options); } catch (error) { reference = (error as import('@/agent-runtime/errors.js').AgentSessionRecoveryError).reference; }
      expect(reference).toBeDefined(); await f.runtime.deleteSession(reference!, { context: f.options.context });
      expect(f.wire.counts).toMatchObject({ agents: 1, environments: 1, sessions: 0, agentArchives: 1, environmentDeletes: 1 });
    } finally { await f.cleanup(); }
  });
  it('does not delete a borrowed environment', async () => {
    const f = await setup({ borrowedEnvironment: true });
    try {
      const session = await f.agent.openSession({ ...f.options, environment: { type: 'provider-managed', reference: 'borrowed-environment' } });
      await (await session.run('task')).result; await f.runtime.deleteSession(session.reference(), { context: f.options.context });
      expect(f.wire.counts).toMatchObject({ environments: 0, environmentDeletes: 0, sessionDeletes: 1, agentArchives: 1 });
    } finally { await f.cleanup(); }
  });

  it('refreshes connector credentials and ignores ambient authentication/workspace headers', async () => {
    const f = await setup(); const previous = process.env.ANTHROPIC_CUSTOM_HEADERS; const bearer = process.env.ANTHROPIC_AUTH_TOKEN;
    let key = 'connector-one';
    Connector.remove('managed-claude'); Connector.create({ name: 'managed-claude', vendor: Vendor.Anthropic, auth: { type: 'api_key_provider', getApiKey: async () => key } });
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'Authorization: Bearer ambient\nX-Api-Key: ambient\nanthropic-workspace-id: foreign\nCookie: ambient'; process.env.ANTHROPIC_AUTH_TOKEN = 'ambient-bearer';
    try {
      const session = await f.agent.openSession(f.options); key = 'connector-two'; await (await session.run('task')).result;
      expect(f.wire.authKeys).toContain('connector-one'); expect(f.wire.authKeys).toContain('connector-two'); expect(f.wire.authKeys).not.toContain('ambient');
      expect(f.wire.bearerHeaders.every(value => value === null)).toBe(true); expect(f.wire.workspaceHeaders.every(value => value === null)).toBe(true); expect(f.wire.cookies.every(value => value === null)).toBe(true);
    } finally { if (previous === undefined) delete process.env.ANTHROPIC_CUSTOM_HEADERS; else process.env.ANTHROPIC_CUSTOM_HEADERS = previous; if (bearer === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = bearer; await f.cleanup(); }
  });

});
