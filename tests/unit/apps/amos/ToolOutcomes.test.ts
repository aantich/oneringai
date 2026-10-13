import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { Agent, StreamEventType } from '@everworker/oneringai';
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
  it('cleans its outcome listener on failure and stays running until cancellation settles', async () => {
    const fake = fakeAgent(); let reject!: (error: Error) => void;
    fake.run.mockImplementation(() => new Promise((_resolve, no) => { reject = no; }));
    const runner = await runnerFor(fake); const call = runner.run('test').catch(e => e); runner.cancel();
    expect(fake.cancel).toHaveBeenCalledTimes(1); expect(runner.isRunning()).toBe(true); reject(new Error('cancelled')); await call;
    expect(runner.isRunning()).toBe(false); expect(fake.tools.listenerCount('tool:outcome')).toBe(0); runner.destroy();
  });
});
