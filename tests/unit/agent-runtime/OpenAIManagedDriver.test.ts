import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage, InMemoryRuntimeSessionStorage } from '@/agent-runtime/index.js';
import { OpenAIManagedDriver } from '@/agent-runtime/openai-managed.js';
import { openAIManagedFixture } from '../../../examples/agent-runtime/openai-managed-fixture.js';

const policy = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
afterEach(() => Connector.clear());
async function setup(fixtureOptions = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openai-managed-test-'));
  Connector.create({ name: 'managed', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-only' } });
  const wire = openAIManagedFixture(fixtureOptions); let tools = 0;
  const createRuntime = () => new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new OpenAIManagedDriver({ createClient: wire.createClient, maxReconnects: 2 })], sessionStorage: new FileRuntimeSessionStorage(directory), resolveTools: () => ({ fingerprint: 'probe-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => { tools++; return { success: false, businessValue: 'original' }; } }] }) }) });
  const runtime = createRuntime();
  const agent = runtime.createAgent({ id: 'logical', instructions: 'test', tools: ['probe'] });
  const options = { execution: { driver: 'openai.agents.api', connector: 'managed', model: 'gpt-6-astra' }, context: { userId: 'owner' }, policy };
  return { runtime, createRuntime, agent, options, wire, tools: () => tools, cleanup: async () => { await runtime.destroy(); await rm(directory, { recursive: true, force: true }); } };
}
describe('OpenAI managed native wire adapter', () => {
  it('defers native creation until input, handles required actions and paginates final items', async () => {
    const f = await setup();
    try {
      await f.agent.inspect(f.options); const session = await f.agent.openSession(f.options); expect(f.wire.requests).toHaveLength(0);
      const run = await session.run('task', { requestId: 'first' }); const result = await run.result;
      expect(result.status).toBe('completed'); expect(result.outputText).toBe('ACK'); expect(result.usage?.inputTokens).toBe(5);
      expect(f.tools()).toBe(1); expect(f.wire.counts.inputs).toBe(1); expect(f.wire.counts.itemPages).toBeGreaterThanOrEqual(2);
      expect(await session.run('task', { requestId: 'first' })).toBe(run); expect(f.tools()).toBe(1);
      const creation = f.wire.requests.find(r => r.method === 'POST' && r.path === '/agents/sessions')!.body;
      expect(creation).toMatchObject({ environment: { type: 'none' }, agent: { multi_agent: { enabled: false }, tools: [{ type: 'function', name: 'probe' }] }, input: 'task', stream: true });
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
