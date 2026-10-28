import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/index.js';
import type { Agent, ToolExecutionOptions } from '@/index.js';
import { fixture } from '../core/routing/fixture.js';
import { acquireComposition } from '@/core/execution/composition.js';
import { registerRemoteAgentGuard, selectRemoteSourceAdmission } from '@/core/tool-execution/remoteObservation.js';
const agents: Agent[] = [], disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); agents.splice(0).forEach(agent => agent.destroy()); Connector.clear(); });
describe('selected remote execution ownership over existing Agent hooks', () => {
  it('signals one external call without cancelling its sibling and retains raw work until it actually settles', async () => {
    const f = fixture(); agents.push(f.agent); let release!: () => void, observedSignal: AbortSignal | undefined;
    const slow = vi.fn(async (_args, context) => { observedSignal = context?.signal; await new Promise<void>(resolve => { release = resolve; }); return 'late original result'; });
    f.agent.tools.register({ definition: { type: 'function', function: { name: 'slow' } }, execute: slow });
    f.agent.tools.register({ definition: { type: 'function', function: { name: 'fast' } }, execute: async () => 'sibling' });
    const lease = acquireComposition(f.agent); const controller = new AbortController();
    try {
      await lease.admit(() => f.agent.beginExternalExecution({ source: 'outcome-test' }));
      const pending = f.agent.executeExternalToolCall({ id: 'one', name: 'slow', arguments: {} }, { signal: controller.signal });
      await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1)); controller.abort(new Error('only first call'));
      expect((await pending).outcome).toMatchObject({ status: 'cancelled', completion: 'unknown' }); expect(observedSignal?.aborted).toBe(true);
      expect((await f.agent.executeExternalToolCall({ id: 'two', name: 'fast', arguments: {} })).content).toBe('sibling'); expect(lease.pending).toBeGreaterThan(0);
      release(); await vi.waitFor(() => expect(lease.pending).toBe(0)); await f.agent.completeExternalExecution();
    } finally { release?.(); lease.release(); }
  });
  it('pins source registration across actual before-tool hooks and rejects replacement before dispatch', async () => {
    const original = vi.fn(async () => 'original'), replacement = vi.fn(async () => 'replacement'); let first = true;
    const f = fixture({ hooks: { 'before:tool': async () => { if (first) { first = false; f.agent.tools.register({ definition: { type: 'function', function: { name: 'source' } }, execute: replacement }); } return {}; } } }); agents.push(f.agent);
    f.agent.tools.register({ definition: { type: 'function', function: { name: 'source' } }, execute: original });
    const options: ToolExecutionOptions = {}; selectRemoteSourceAdmission(options, tool => { if (tool.execute !== original) throw new Error('Changed source executable'); });
    await f.agent.beginExternalExecution(); const result = await f.agent.executeExternalToolCall({ id: 'request', name: 'source', arguments: {} }, options);
    expect(result.outcome).toMatchObject({ executionStarted: false, completion: 'not_started', status: 'failed' }); expect(original).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled(); await f.agent.completeExternalExecution();
  });
  it('checks unresolved selected context authority before managed model dispatch while preserving direct host inspection', async () => {
    const f = fixture(); agents.push(f.agent); const guard = () => new Error('Remote write remains uncertain'); disposers.push(registerRemoteAgentGuard(f.agent.context, guard));
    await expect(f.agent.run('must not answer')).rejects.toThrow(/uncertain/); await expect(f.agent.stream('must not answer').next()).rejects.toThrow(/uncertain/); expect(f.primary.generate).not.toHaveBeenCalled();
    expect((await f.agent.runDirect('host-only inspection')).output_text).toBe('ANSWER'); expect(f.primary.generate).toHaveBeenCalledTimes(1);
  });
});
