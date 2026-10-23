import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { ModelTask } from '@/core/model-execution/ModelTask.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';
import { fixture, answer } from './fixture.js';
const agents: Agent[] = [], tasks: ModelTask[] = [];
const make = (config: Parameters<typeof fixture>[0] = {}) => { const value = fixture(config); agents.push(value.agent); return value; };
const task = (limits = {}) => { const value = new ModelTask({ limits }); tasks.push(value); return value; };
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); tasks.splice(0).forEach(value => value.destroy()); Connector.clear(); });
const drain = async (agent: Agent, options?: Parameters<Agent['stream']>[1]) => { const events = []; for await (const event of agent.stream('request', options)) events.push(event); return events; };

describe('14A managed execution bindings', () => {
  it.each(['run', 'stream'] as const)('%s selects once, keeps public defaults and uses actual capacity/usage', async mode => {
    const f = make(); const shared = task(); const toolManager = f.agent.tools, context = f.agent.context;
    const result = mode === 'run' ? await f.agent.run('lookup', { routing: { taskType: 'lookup' }, modelTask: shared }) : await drain(f.agent, { routing: { taskType: 'lookup' }, modelTask: shared });
    expect(f.select).toHaveBeenCalledTimes(1); expect(f.primary.generate.mock.calls[0]![0].model).toBe('fast');
    expect(f.agent.model).toBe('main'); expect(f.agent.connector.name).toBe(f.name); expect(f.agent.context.model).toBe('main');
    expect(f.agent.context).toBe(context); expect(f.agent.tools).toBe(toolManager); expect(f.agent.context.tools).toBe(toolManager);
    expect(f.agent.context.lastPreparation).toMatchObject({ model: 'fast', budget: { maxTokens: 6000 } });
    expect(shared.snapshot().invocations[0]).toMatchObject({ connector: f.name, model: 'fast', purpose: 'main' });
    if (mode === 'run') expect(result).toMatchObject({ model: 'fast', routing: { selectedRoute: 'fast' } });
    else expect((result as Awaited<ReturnType<typeof drain>>).find(event => event.type === StreamEventType.RESPONSE_COMPLETE)).toMatchObject({ routing: { selectedRoute: 'fast' } });
  });
  it('runs explicit default/opt-out without selection or changing subsequent policy', async () => {
    const f = make();
    await f.agent.run('default', { routing: null }); await f.agent.run('explicit', { routing: { route: 'default' } });
    expect(f.select).not.toHaveBeenCalled(); expect(f.primary.generate.mock.calls.map(([request]) => request.model)).toEqual(['main', 'main']);
    await f.agent.run('auto'); expect(f.select).toHaveBeenCalledTimes(1); expect(f.primary.generate.mock.calls[2]![0].model).toBe('fast');
  });
  it('cross-provider routing requires deliberate transfer, with distinct accounting', async () => {
    const f = make(); const shared = task();
    const response = await f.agent.run('specialist', { routing: { route: 'specialist' }, modelTask: shared });
    expect(response).toMatchObject({ model: 'specialist', routing: { connector: f.other } });
    expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.secondary.generate).toHaveBeenCalledTimes(1);
    expect(shared.snapshot().invocations[0]).toMatchObject({ connector: f.other, model: 'specialist' });
  });
  it('rejects an unauthorized transfer before committing input or invoking provider', async () => {
    const f = make({ modelExecution: { routing: { routes: { denied: { model: 'x', connector: 'not-visible' } }, select: () => 'denied' } } });
    await expect(f.agent.run('private')).rejects.toThrow('ineligible');
    expect(f.agent.context.getConversation()).toEqual([]); expect(f.agent.context.getCurrentInput()).toEqual([]);
    expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.secondary.generate).not.toHaveBeenCalled();
  });
  it('does not hide unsupported tools behind fallback or mutate context first', async () => {
    const tool: ToolFunction = { definition: { type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } } }, execute: async () => 'result' };
    const f = make({ tools: [tool] }); f.primary.caps.mockReturnValue({ supportsTools: false, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 6000, maxInputTokens: 6000, maxOutputTokens: 128 });
    await expect(f.agent.run('private')).rejects.toThrow('function tools'); expect(f.agent.context.getCurrentInput()).toEqual([]); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('keeps every tool iteration on one admitted route', async () => {
    const execute = vi.fn(async () => 'FOUND');
    const tool: ToolFunction = { definition: { type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } } }, execute };
    const f = make({ tools: [tool] });
    f.primary.generate.mockImplementationOnce(async options => ({ ...answer(options), output_text: undefined,
      output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'call', name: 'lookup', arguments: '{}' }] }] }));
    await f.agent.run('lookup'); expect(execute).toHaveBeenCalledTimes(1); expect(f.select).toHaveBeenCalledTimes(1);
    expect(f.primary.generate.mock.calls.map(([options]) => options.model)).toEqual(['fast', 'fast']);
  });
  it('keeps JSON repair on the admitted binding and task', async () => {
    const f = make(); const shared = task();
    f.primary.generate.mockImplementationOnce(async options => answer(options, 'invalid')).mockImplementationOnce(async options => answer(options, '{"ok":true}'));
    const response = await f.agent.run('JSON', { responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }, modelTask: shared });
    expect(response.output_parsed).toEqual({ ok: true }); expect(f.select).toHaveBeenCalledTimes(1);
    expect(shared.snapshot().invocations.map(value => [value.model, value.phase])).toEqual([['fast', 'generation'], ['fast', 'repair']]);
  });
  it.each([true, false])('repairs using the actual source and host instructions, routing=%s', async routed => {
    const f = make(routed ? {} : { modelExecution: { routing: undefined } });
    f.agent.on('llm:request', event => { event.options.instructions = 'HOST_WIRE_CONTROL'; });
    f.primary.generate.mockImplementationOnce(async options => answer(options, '{"answer":'))
      .mockImplementationOnce(async options => {
        expect(JSON.stringify(options.input)).toContain('SOURCE_R14_41_MINUS_15');
        expect(options.instructions).toContain('HOST_WIRE_CONTROL');
        return answer(options, '{"answer":"26"}');
      });
    const result = await f.agent.run('SOURCE_R14_41_MINUS_15: compute 41 - 15.', { responseFormat: { type: 'json_schema', name: 'answer', schema: {
      type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
    expect(result.output_parsed).toEqual({ answer: '26' }); expect(f.primary.generate).toHaveBeenCalledTimes(2);
    expect(f.agent.context.lastPreparation?.revision).toBe(1);
  });
  it('pins only an admitted phase in the same explicit task and permits explicit escalation', async () => {
    const choose = vi.fn(() => 'fast'); const f = make({ modelExecution: { customProviderAttempts: 'single', routing: { routes: { fast: { model: 'fast' } }, select: choose, sticky: 'phase' } } });
    const shared = task();
    await f.agent.run('one', { modelTask: shared, routing: { phase: 'research' } });
    choose.mockReturnValue('default'); await f.agent.run('two', { modelTask: shared, routing: { phase: 'research' } });
    expect(f.agent.getRoutingDiagnostics()?.source).toBe('sticky'); expect(choose).toHaveBeenCalledTimes(1);
    await f.agent.run('three', { modelTask: shared, routing: { phase: 'research', route: 'default' } });
    await f.agent.run('four', { modelTask: shared, routing: { phase: 'research' } });
    expect(f.primary.generate.mock.calls.map(([value]) => value.model)).toEqual(['fast', 'fast', 'main', 'main']);
    await f.agent.run('five', { modelTask: shared, routing: { phase: 'decision' } }); expect(choose).toHaveBeenCalledTimes(2);
    await f.agent.run('six', { modelTask: task(), routing: { phase: 'decision' } }); expect(choose).toHaveBeenCalledTimes(3);
  });
  it('does not pin a failed budget admission', async () => {
    const select = vi.fn(() => 'fast'); const f = make({ modelExecution: { customProviderAttempts: 'single', routing: { routes: { fast: { model: 'fast' } }, select, sticky: 'phase' } } });
    const shared = task({ maxCalls: 0 });
    await expect(f.agent.run('one', { modelTask: shared, routing: { phase: 'p' } })).rejects.toThrow();
    await expect(f.agent.run('two', { modelTask: shared, routing: { phase: 'p' } })).rejects.toThrow();
    expect(select).toHaveBeenCalledTimes(2); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('does not perform cross-model failover after provider failure', async () => {
    const f = make(); f.primary.generate.mockRejectedValue(new Error('transport failure'));
    await expect(f.agent.run('one')).rejects.toThrow('transport failure'); expect(f.primary.generate).toHaveBeenCalledTimes(1); expect(f.secondary.generate).not.toHaveBeenCalled();
  });
  it('cancels pending selection without committing input and releases the lease', async () => {
    let selected!: () => void; const waiting = new Promise<void>(resolve => { selected = resolve; });
    const f = make({ modelExecution: { routing: { routes: {}, select: () => { selected(); return new Promise(() => {}); } } } });
    const promise = f.agent.run('private'); await waiting; f.agent.cancel('host stop');
    await expect(promise).rejects.toThrow(); expect(f.agent.context.getConversation()).toEqual([]); expect(f.agent.context.getCurrentInput()).toEqual([]);
    await f.agent.run('next', { routing: null }); expect(f.primary.generate).toHaveBeenCalledTimes(1);
  });
  it('destroys a pending selector without accepting its late decision or destroying an injected provider', async () => {
    let finish!: (route: string) => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const f = make({ modelExecution: { routing: { routes: {}, select: () => { started(); return new Promise(resolve => { finish = resolve; }); } } } });
    const pending = f.agent.run('private'); await ready; f.agent.destroy(); finish('default');
    await expect(pending).rejects.toThrow(); expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.primary.destroy).not.toHaveBeenCalled();
  });
  it('rejects overlapping execution while selector is pending', async () => {
    let release!: (route: string) => void; let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
    const f = make({ modelExecution: { routing: { routes: {}, select: () => { ready(); return new Promise(resolve => { release = resolve; }); } } } });
    const first = f.agent.run('one'); await started; await expect(f.agent.run('two')).rejects.toThrow('active run'); release('default'); await first;
  });
  it('rejects a hook that changes model after selection and records no dispatch', async () => {
    const f = make(); f.agent.on('llm:request', event => { event.options.model = 'main'; });
    await expect(f.agent.run('one')).rejects.toThrow('cannot switch'); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('keeps direct calls on the default model even with routing enabled', async () => {
    const f = make(); await f.agent.runDirect('one'); expect(f.select).not.toHaveBeenCalled(); expect(f.primary.generate.mock.calls[0]![0].model).toBe('main'); expect(f.agent.getRoutingDiagnostics()).toBeUndefined();
  });
  it('rejects explicit routing options on direct/external paths before calls or context changes', async () => {
    const f = make(); const options = { routing: { route: 'fast' } } as never;
    await expect(f.agent.runDirect('one', options)).rejects.toThrow('managed');
    await expect((async () => { for await (const _event of f.agent.streamDirect('two', options)) { /* drain */ } })()).rejects.toThrow('managed');
    await expect(f.agent.beginExternalExecution(options)).rejects.toThrow('managed');
    expect(f.primary.generate).not.toHaveBeenCalled(); expect(f.agent.context.getConversation()).toEqual([]);
  });
  it('uses selected capacity for concurrent reservations on an explicitly shared task', async () => {
    const first = make(), second = make(); const shared = task({ maxTokens: 10000 });
    let finish!: () => void, ready!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; });
    first.primary.generate.mockImplementationOnce(async options => { ready(); await new Promise<void>(resolve => { finish = resolve; }); return answer(options); });
    const active = first.agent.run('first', { modelTask: shared }); await entered;
    await expect(second.agent.run('second', { modelTask: shared })).rejects.toThrow('maxTokens'); expect(second.primary.generate).not.toHaveBeenCalled();
    finish(); await active; await second.agent.run('after settlement', { modelTask: shared });
    expect(shared.snapshot().invocations).toHaveLength(2); expect(shared.snapshot().totals.calls).toBe(2);
  });
  it('requires explicit vendor option replacement across vendors', async () => {
    const f = make({ vendorOptions: { reasoning_effort: 'high' } });
    await expect(f.agent.run('one', { routing: { route: 'specialist' } })).rejects.toThrow('vendorOptions');
    await f.agent.run('two', { routing: { route: 'specialist' }, vendorOptions: {} });
    expect(f.secondary.generate.mock.calls[0]![0].vendorOptions).toEqual({});
  });
  it('preserves tighter output and data-handling limits', async () => {
    const f = make({ dataHandling: { allowProviderTools: false }, modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 64,
      routing: { routes: { fast: { model: 'fast', maxOutputTokens: 100, dataHandling: { allowProviderTools: true } } }, select: () => 'fast' } } });
    await f.agent.run('one', { dataHandling: { allowProviderTools: true } });
    expect(f.primary.generate.mock.calls[0]![0]).toMatchObject({ max_output_tokens: 64, data_handling: { allowProviderTools: false } });
  });
  it('returns detached diagnostics and clears them on a new rejected selection', async () => {
    const f = make(); await f.agent.run('one'); const snapshot = f.agent.getRoutingDiagnostics()!;
    (snapshot as { model: string }).model = 'forged'; expect(f.agent.getRoutingDiagnostics()?.model).toBe('fast');
    await expect(f.agent.run('two', { routing: { route: 'missing' } })).rejects.toThrow('Unknown'); expect(f.agent.getRoutingDiagnostics()).toBeUndefined();
  });
  it.each(['reasoning', 'compaction'] as const)('does not transfer active %s state to another model', async type => {
    const f = make(); f.agent.context.addInputItems([{ type, id: 'opaque', encrypted_content: 'SECRET' } as never]);
    await expect(f.agent.run('one')).rejects.toThrow('ineligible'); expect(f.primary.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(f.agent.context.getConversation())).toContain('SECRET');
  });
});
