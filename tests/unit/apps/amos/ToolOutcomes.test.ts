import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { Agent, StreamEventType, ToolManager, createOutcomeTool } from '@everworker/oneringai';
import type { ToolExecutionOutcome } from '@everworker/oneringai';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { describeToolOutcome } from '../../../../apps/amos/src/agent/toolOutcomes.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
const base: ToolExecutionOutcome = { executionId: 'local-call', callId: 'call', runId: 'run', toolName: 'write', status: 'failed', startedAt: 1,
  durationMs: 10, executionStarted: true, completion: 'settled', cancellation: 'none', error: 'local failure' };
afterEach(() => vi.restoreAllMocks());
function fakeAgent() {
  return { tools: new EventEmitter(), run: vi.fn(), stream: vi.fn(), cancel: vi.fn(), destroy: vi.fn(), isRunning: () => false };
}
async function runnerFor(fake: ReturnType<typeof fakeAgent>) {
  vi.spyOn(Agent, 'create').mockReturnValue(fake as unknown as Agent);
  const config = structuredClone(DEFAULT_CONFIG); config.session.autoSave = false; config.session.activeSessionId = null;
  const runner = new AgentRunner(config, []); await runner.initialize('mock', 'mock-model'); return runner;
}
describe('AMOS truthful tool outcome rendering', () => {
  it('renders real reported failures while accepting the identical declined business payload', async () => {
    const manager = new ToolManager(); const raw = { success: false };
    const definition = { type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object', properties: {} } } };
    try {
      manager.register(createOutcomeTool({ definition, execute: async () => raw }));
      const decline = await manager.executeWithOutcome('lookup', {});
      manager.register(createOutcomeTool({ definition, execute: async (_args, invocation) => {
        invocation.reportFailure(new Error('Lookup unavailable')); return raw;
      } }));
      const failure = await manager.executeWithOutcome('lookup', {});
      expect(decline.result).toBe(failure.result);
      expect(describeToolOutcome(decline.outcome)).toBeNull();
      expect(describeToolOutcome(failure.outcome)).toBe('lookup: Lookup unavailable');
    } finally { manager.destroy(); }
  });
  it('renders semantic failure and suppresses notices for success', () => {
    expect(describeToolOutcome(base)).toBe('write: local failure'); expect(describeToolOutcome({ ...base, status: 'succeeded' })).toBeNull();
  });
  it('distinguishes prevention before tool start from unknown completion', () => {
    expect(describeToolOutcome({ ...base, status: 'denied', completion: 'not_started', executionStarted: false })).toContain('tool was not started');
    expect(describeToolOutcome({ ...base, status: 'timed_out', completion: 'unknown', cancellation: 'requested' })).toContain('operation may still finish');
  });
  it('does not equate acknowledged cancellation with undoing a remote effect', () => {
    expect(describeToolOutcome({ ...base, status: 'cancelled', cancellation: 'acknowledged' })).toContain('external effects may already have occurred');
  });
  it('maps normalized streaming failure and uncertain timeout using outcome metadata', async () => {
    const fake = fakeAgent(); fake.stream.mockImplementation(async function* () {
      for (const outcome of [base, { ...base, status: 'timed_out', completion: 'unknown', cancellation: 'requested' }]) {
        yield { type: StreamEventType.TOOL_EXECUTION_DONE, tool_name: 'write', result: { success: false }, execution_time_ms: 10, outcome };
      }
    });
    const runner = await runnerFor(fake); const events = []; for await (const event of runner.stream('test')) events.push(event);
    expect(events.map(e => e.type)).toEqual(['error', 'error']); expect(events[1]!.error?.message).toContain('Check external state before retrying'); expect(runner.isRunning()).toBe(false); runner.destroy();
  });
  it('collects non-streaming outcomes and removes its listener after success', async () => {
    const fake = fakeAgent(); fake.run.mockImplementation(async () => { fake.tools.emit('tool:outcome', base); return { output_text: 'done', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; });
    const runner = await runnerFor(fake); expect((await runner.run('test')).toolOutcomes).toEqual([base]); expect(fake.tools.listenerCount('tool:outcome')).toBe(0); runner.destroy();
  });
  it('maps selected page counts, position and independent coverage for both successful and unknown-position results', async () => {
    const fake = fakeAgent(); fake.stream.mockImplementation(async function* () {
      for (const failed of [false, true]) yield { type: StreamEventType.TOOL_EXECUTION_DONE, tool_name: 'drive_list_page', execution_time_ms: 1,
        result: { items: [{ id: 'one' }], returnedCount: 1, searchCoverage: 'incomplete', position: failed ? { state: 'unknown', reason: 'missing' } : { state: 'end' } },
        outcome: { ...base, toolName: 'drive_list_page', status: failed ? 'failed' : 'succeeded' } };
    });
    const runner = await runnerFor(fake); const events = []; for await (const event of runner.stream('test')) events.push(event);
    expect(events[0]?.notice).toContain('Returned 1 items; end of provider pagination; search coverage incomplete.');
    expect(events[1]?.error?.message).toContain('Returned 1 items; continuation unknown; search coverage incomplete.'); runner.destroy();
  });
  it('cleans its outcome listener on failure and stays running until cancellation settles', async () => {
    const fake = fakeAgent(); let reject!: (error: Error) => void;
    fake.run.mockImplementation(() => new Promise((_resolve, no) => { reject = no; }));
    const runner = await runnerFor(fake); const call = runner.run('test').catch(e => e); runner.cancel();
    expect(fake.cancel).toHaveBeenCalledTimes(1); expect(runner.isRunning()).toBe(true); reject(new Error('cancelled')); await call;
    expect(runner.isRunning()).toBe(false); expect(fake.tools.listenerCount('tool:outcome')).toBe(0); runner.destroy();
  });
});
