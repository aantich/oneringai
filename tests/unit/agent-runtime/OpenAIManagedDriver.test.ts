import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import type { AgentSession as NativeSession } from 'openai/resources/beta/agents/agents';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage, InMemoryRuntimeSessionStorage } from '@/agent-runtime/index.js';
import { OpenAIManagedDriver } from '@/agent-runtime/openai-managed.js';
import { openAIManagedFixture } from '../../../examples/agent-runtime/openai-managed-fixture.js';

const policy = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
afterEach(() => Connector.clear());
async function setup(fixtureOptions = {}, transformSession?: (session: NativeSession) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openai-managed-test-'));
  Connector.create({ name: 'managed', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-only' } });
  const wire = openAIManagedFixture(fixtureOptions); let tools = 0;
  const createClient = (options: ConstructorParameters<typeof OpenAI>[0]) => new OpenAI({ ...options, fetch: async (input, init) => {
    const response = await wire.fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (transformSession && (init?.method ?? 'GET') === 'GET' && url.pathname.endsWith('/agents/sessions/native-session')) {
      const session = await response.json() as NativeSession; transformSession(session);
      return new Response(JSON.stringify(session), { headers: { 'Content-Type': 'application/json' } });
    }
    return response;
  } });
  const createRuntime = () => new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new OpenAIManagedDriver({ createClient, maxReconnects: 2 })], sessionStorage: new FileRuntimeSessionStorage(directory), resolveTools: () => ({ fingerprint: 'probe-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => { tools++; return { success: false, businessValue: 'original' }; } }] }) }) });
  const runtime = createRuntime();
  const agent = runtime.createAgent({ id: 'logical', instructions: 'test', tools: ['probe'] });
  const options = { execution: { driver: 'openai.agents.api', connector: 'managed', model: 'gpt-6-astra' }, context: { userId: 'owner' }, policy };
  return { runtime, createRuntime, agent, options, wire, tools: () => tools, cleanup: async () => { await runtime.destroy(); await rm(directory, { recursive: true, force: true }); } };
}
describe('OpenAI managed native wire adapter', () => {
  const changes: { name: string; mutate: (session: NativeSession) => void }[] = [
    { name: 'vault', mutate: session => { session.vault_ids = ['unselected']; } },
    { name: 'desktop', mutate: session => { if (session.environment.type === 'openai_hosted') session.environment.desktop = { enabled: true }; } },
    { name: 'network', mutate: session => { if (session.environment.type === 'openai_hosted') session.environment.network.access = 'enabled'; } },
    { name: 'schema', mutate: session => { const tool = session.agent.tools[0]; if (tool?.type === 'function') tool.parameters = { type: 'object', properties: { changed: { type: 'string' } } }; } },
    { name: 'description', mutate: session => { const tool = session.agent.tools[0]; if (tool?.type === 'function') tool.description = 'changed instructions'; } },
    { name: 'deferred tool', mutate: session => { const tool = session.agent.tools[0]; if (tool?.type === 'function') tool.defer_loading = true; } },
  ];
  for (const phase of ['continuation', 'restore'] as const) it.each(changes)(`rejects $name access/configuration drift before ${phase} can dispatch`, async ({ mutate }) => {
    let changed = false;
    const f = await setup({}, session => { if (changed) mutate(session); });
    try {
      const session = await f.agent.openSession({ ...f.options, environment: { type: 'provider-managed' }, policy: { ...policy, filesystem: 'workspace-write', commands: 'sandboxed' } });
      expect((await (await session.run('first')).result).status).toBe('completed');
      const reference = session.reference(); if (phase === 'restore') await session.detach(); changed = true;
      await expect(phase === 'restore' ? f.runtime.resumeSession(reference, { context: f.options.context }) : session.run('must not dispatch')).rejects.toThrow(/changed|expanded|unselected/);
      expect(f.tools()).toBe(1); expect(f.wire.counts.inputs).toBe(1); expect(f.wire.counts.cancels).toBe(0);
      changed = false;
      const repaired = phase === 'restore' ? await f.runtime.resumeSession(reference, { context: f.options.context }) : session;
      expect((await (await repaired.run('after host repair')).result).status).toBe('completed');
      expect(f.tools()).toBe(2); expect(f.wire.counts.inputs).toBe(2);
    } finally { changed = false; await f.cleanup(); }
  });
  it.each(['omitted', 'disabled'] as const)('accepts %s desktop defaults and reordered schema keys without changing tool authority', async desktop => {
    const f = await setup({}, session => {
      if (session.environment.type === 'openai_hosted') {
        if (desktop === 'omitted') delete session.environment.desktop;
        else session.environment.desktop = { enabled: false };
      }
      const tool = session.agent.tools[0]; if (tool?.type === 'function') tool.parameters = { properties: {}, type: 'object' };
    });
    try {
      const session = await f.agent.openSession({ ...f.options, environment: { type: 'provider-managed' }, policy: { ...policy, filesystem: 'workspace-write', commands: 'sandboxed' } });
      expect((await (await session.run('first')).result).status).toBe('completed');
      const reference = session.reference(); await session.detach();
      const restored = await f.runtime.resumeSession(reference, { context: f.options.context });
      expect((await (await restored.run('second')).result).status).toBe('completed'); expect(f.tools()).toBe(2);
    } finally { await f.cleanup(); }
  });
  it('defers native creation until input, handles required actions and paginates final items', async () => {
    const f = await setup();
    try {
      await f.agent.inspect(f.options); const session = await f.agent.openSession(f.options); expect(f.wire.requests).toHaveLength(0);
      const run = await session.run('task', { requestId: 'first' }); const result = await run.result;
      expect(result.status).toBe('completed'); expect(result.outputText).toBe('ACK'); expect(result.usage?.inputTokens).toBe(5);
      expect(f.tools()).toBe(1); expect(f.wire.counts.inputs).toBe(1); expect(f.wire.counts.itemPages).toBeGreaterThanOrEqual(2);
      expect(await session.run('task', { requestId: 'first' })).toBe(run); expect(f.tools()).toBe(1);
      const creation = f.wire.requests.find(r => r.method === 'POST' && r.path === '/agents/sessions')!.body;
      expect(creation).toMatchObject({ environment: { type: 'none' }, agent: { multi_agent: { enabled: false }, tools: [{ type: 'function', name: 'probe' }] }, vault_ids: [], input: 'task', stream: true });
      expect((await (await session.run('continue')).result).status).toBe('completed'); expect(f.tools()).toBe(2);
      await f.runtime.deleteSession(session.reference(), { context: f.options.context }); expect(f.wire.counts.deletes).toBe(1);
    } finally { await f.cleanup(); }
  });
  it.each(['before','after'] as const)('reconciles a lost tool-result response %s acceptance without repeating the tool', async dropFirstToolResult => {
    const f = await setup({ dropFirstToolResult });
    try {
      const session = await f.agent.openSession(f.options); const result = await (await session.run('task')).result;
      expect(result.status).toBe('completed'); expect(result.outputText).toBe('ACK'); expect(f.tools()).toBe(1); expect(f.wire.counts.inputs).toBe(1); expect(f.wire.counts.streams).toBeGreaterThan(1);
    } finally { await f.cleanup(); }
  });
  it('requires durable storage and verified endpoint controls before native mutation', async () => {
    const f = await setup();
    const memoryRuntime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new OpenAIManagedDriver({ createClient: f.wire.createClient })], sessionStorage: new InMemoryRuntimeSessionStorage() }) });
    try {
      await expect(memoryRuntime.createAgent({ id: 'a', instructions: '' }).openSession(f.options)).rejects.toThrow('durable');
      await expect(f.agent.inspect({ ...f.options, execution: { ...f.options.execution, reasoning: { effort: 'ultra' } } })).rejects.toThrow('reasoning');
      await expect(f.agent.inspect({ ...f.options, policy: { ...policy, commands: 'sandboxed' } })).rejects.toThrow('No-environment');
      expect(f.wire.requests).toHaveLength(0);
    } finally { await memoryRuntime.destroy(); await f.cleanup(); }
  });
  it('keeps an idle/closed stream nonterminal and exposes recovery without run.finished', async () => {
    const f = await setup({ idleWithoutTerminal: true });
    try {
      const session = await f.agent.openSession(f.options); const run = await session.run('task');
      const events = []; for await (const event of run.events()) events.push(event);
      await expect(run.result).rejects.toThrow('not proven terminal');
      expect(events.some(event => event.type === 'run.finished')).toBe(false); expect(f.tools()).toBe(0);
    } finally { await f.cleanup(); }
  });
  it('does not associate uncertain continuation input with an older completed turn', async () => {
    const f = await setup({ dropContinuationInput: true });
    try {
      const session = await f.agent.openSession({ ...f.options, policy: { ...policy, limits: { wallTimeMs: 500 } } });
      expect((await (await session.run('first')).result).status).toBe('completed');
      const run = await session.run('uncertain continuation'); await expect(run.result).rejects.toThrow('not proven terminal');
      expect(f.wire.counts.inputs).toBe(1); expect(f.tools()).toBe(1);
    } finally { await f.cleanup(); }
  });

  it('detaches an active remote turn and resumes its observer without cancellation or new input', async () => {
    const f = await setup({ pauseCompletion: true }); let resumed: AgentRuntime | undefined;
    try {
      const session = await f.agent.openSession(f.options); const original = await session.run('task', { requestId: 'stable' });
      await vi.waitFor(() => expect(f.wire.counts.toolDeliveries).toBe(1));
      const reference = session.reference(); await session.detach(); await f.runtime.destroy();
      expect(f.wire.counts.cancels).toBe(0);
      resumed = f.createRuntime(); const recovered = await resumed.resumeSession(reference, { context: f.options.context });
      f.wire.complete(); const run = await recovered.getRun(original.id); expect((await run.result).outputText).toBe('ACK');
      expect(f.tools()).toBe(1); expect(f.wire.counts.inputs).toBe(1); expect(f.wire.counts.creations).toBe(1);
      await resumed.deleteSession(reference, { context: f.options.context });
    } finally { await resumed?.destroy(); await f.cleanup(); }
  });

});
