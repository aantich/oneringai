import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';
import type { ToolExecutionOutcome } from '@/core/tool-execution/outcomes.js';
const provider = vi.hoisted(() => ({ name: 'fixture', capabilities: { text: true }, generate: vi.fn(), streamGenerate: vi.fn(),
  getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000 }) }));
vi.mock('@/core/createProvider.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/createProvider.js')>(), createProvider: () => provider }));
const agents: Agent[] = [];
function textResponse() { return { id: 'done', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed', output_text: 'done',
  output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; }
function toolsResponse() { return { ...textResponse(), output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT,
  content: [{ type: ContentType.TOOL_USE, id: 'original', name: 'probe', arguments: '{}' }] }] }; }
function fixture(execute: ToolFunction['execute'], blocking = true) {
  const agent = Agent.create({ connector: 'outcomes', model: 'gpt-4o-mini', tools: [{ definition: { type: 'function', blocking,
    function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute }], maxIterations: 3, emptyResponseRetry: { enabled: false },
    asyncTools: { autoContinue: false }, context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } } });
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
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); Connector.clear(); vi.useRealTimers(); });

describe('Agent semantic results and cancellation', () => {
  it('preserves async deadlines for a legacy execute override that ignores new options', async () => {
    const agent = fixture(async () => 'unused', false);
    const definition = agent.tools.getToolDefinition('probe'); if (definition?.type === 'function') definition.timeout = 20;
    vi.spyOn(agent.tools, 'execute').mockImplementation(async () => new Promise(() => undefined));
    const timeout = vi.fn(); agent.on('async:tool:timeout', timeout); await agent.run('legacy background');
    await vi.waitFor(() => expect(timeout).toHaveBeenCalledTimes(1)); expect(timeout.mock.calls[0]![0].timeout).toBe(20);
    expect(agent.getMetrics()?.toolTimeoutCount).toBe(1);
  });
  it('retains legacy ToolManager.execute overrides as an extension point', async () => {
    const actual = vi.fn(async () => 'should be overridden'); const agent = fixture(actual);
    const override = vi.spyOn(agent.tools, 'execute').mockResolvedValue({ success: false, legacy: true });
    await agent.run('legacy override'); expect(override).toHaveBeenCalledTimes(1); expect(actual).not.toHaveBeenCalled();
    expect(agent.getMetrics()).toMatchObject({ toolSuccessCount: 1, toolFailureCount: 0 });
    expect(JSON.stringify(agent.context.getState())).toContain('legacy');
  });
  it.each(['run', 'stream'] as const)('%s counts a normalized exception as failure and preserves its raw result in history', async mode => {
    const agent = fixture(async () => { throw new Error('fixture failure'); }); const completions = vi.fn(); agent.on('tool:complete', completions);
    const events = [];
    if (mode === 'run') await agent.run('probe'); else for await (const event of agent.stream('probe')) events.push(event);
    expect(completions.mock.calls[0]![0].result).toMatchObject({ state: 'failed', content: { success: false, error: 'fixture failure' }, outcome: { status: 'failed', callId: 'original' } });
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 0, toolFailureCount: 1 });
    expect(JSON.stringify(agent.context.getState())).toContain('fixture failure');
    if (mode === 'stream') expect(events.find(e => e.type === StreamEventType.TOOL_EXECUTION_DONE)).toMatchObject({ error: 'fixture failure', outcome: { status: 'failed' } });
  });
  it.each(['run', 'stream'] as const)('%s treats an application success:false payload as normal data', async mode => {
    const agent = fixture(async () => ({ success: false, result: 'business data' }));
    if (mode === 'run') await agent.run('probe'); else for await (const _event of agent.stream('probe')) { /* consume */ }
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 1, toolFailureCount: 0 });
  });
  it.each(['run', 'stream'] as const)('%s cancellation settles promptly and a late result cannot enter the next run', async mode => {
    let release!: (value: string) => void; let started!: () => void; const ready = new Promise<void>(r => { started = r; });
    const agent = fixture(async () => { started(); return new Promise<string>(r => { release = r; }); }); const late: ToolExecutionOutcome[] = [];
    agent.tools.on('tool:late-complete', o => late.push(o));
    const run = mode === 'run' ? agent.run('first') : (async () => { for await (const _event of agent.stream('first')) { /* consume */ } })();
    const completion = run.catch(e => e); await ready; agent.cancel(); await completion; expect(agent.isRunning()).toBe(false);
    provider.generate.mockReset().mockResolvedValue(textResponse()); await agent.run('next'); release('PRIVATE_LATE_VALUE');
    await vi.waitFor(() => expect(late).toHaveLength(1)); expect(late[0]!.callId).toBe('original');
    expect(JSON.stringify(agent.context.getState())).not.toContain('PRIVATE_LATE_VALUE'); expect(agent.getMetrics()?.toolCallCount).toBe(0);
  });
  it('does not count an async acceptance placeholder as completed work, then counts its final failure once', async () => {
    let reject!: (e: Error) => void; const agent = fixture(async () => new Promise((_resolve, no) => { reject = no; }), false);
    const completed = vi.fn(); agent.on('async:tool:complete', completed); await agent.run('background');
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 0, toolFailureCount: 0 });
    reject(new Error('background failed')); await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(completed.mock.calls[0]![0].result).toMatchObject({ state: 'failed', outcome: { status: 'failed' } });
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 0, toolFailureCount: 1 });
  });
  it('drops background delivery when the trusted account has changed', async () => {
    let release!: (value: string) => void; const agent = fixture(async () => new Promise<string>(r => { release = r; }), false);
    agent.tools.mergeToolContext({ userId: 'alice', accountId: 'work' }); const completed = vi.fn(); agent.on('async:tool:complete', completed);
    await agent.run('background'); agent.tools.mergeToolContext({ userId: 'bob', accountId: 'personal' }); release('ALICE_PRIVATE_VALUE');
    await vi.waitFor(() => expect(agent.getPendingAsyncTools()).toHaveLength(0)); expect(completed).not.toHaveBeenCalled();
    await expect(agent.continueWithAsyncResults()).rejects.toThrow('No async results'); expect(JSON.stringify(agent.context.getState())).not.toContain('ALICE_PRIVATE_VALUE');
  });
  it('cancelAsyncTool signals the original call and suppresses delivery of a noncooperative result', async () => {
    let release!: (value: string) => void; let signal: AbortSignal | undefined;
    const agent = fixture(async (_args, context) => { signal = context?.signal; return new Promise<string>(r => { release = r; }); }, false);
    const completed = vi.fn(); agent.on('async:tool:complete', completed); await agent.run('background'); agent.cancelAsyncTool('original');
    expect(signal?.aborted).toBe(true); release('late'); await Promise.resolve(); await Promise.resolve(); expect(completed).not.toHaveBeenCalled(); expect(agent.getPendingAsyncTools()).toHaveLength(0);
  });
  it('async timeout keeps the earlier manager safety net and counts final timeout once', async () => {
    const agent = fixture(async () => new Promise(() => undefined), false); agent.tools.toolExecutionTimeout = 20;
    const timeout = vi.fn(); agent.on('async:tool:timeout', timeout); await agent.run('background');
    await vi.waitFor(() => expect(timeout).toHaveBeenCalledTimes(1));
    expect(timeout.mock.calls[0]![0].timeout).toBe(20);
    expect(agent.tools.getRegistration('probe')?.metadata).toMatchObject({ usageCount: 1, failureCount: 1 });
    expect(agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 0, toolTimeoutCount: 1 });
    expect(agent.getPendingAsyncTools()).toHaveLength(0);
  });
});
