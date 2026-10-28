import { afterEach, describe, expect, it } from 'vitest';
import { Connector, ModelTask, ToolManager } from '@/index.js';
import type { Agent, ToolResult } from '@/index.js';
import { registerOrchestratorExecution, captureOrchestratorAsync, settleOrchestratorAsync, orchestratorContinuation, orchestratorInvocation, type ParentOperation } from '@/core/orchestrator/executionBinding.js';
import { acquireComposition } from '@/core/execution/composition.js';
import { fixture } from './routing/fixture.js';
import { FactoryExecution } from '@/core/orchestrator/factoryExecution.js';
import { beginOrchestratorExecution } from '@/core/orchestrator/executionBinding.js';
const agents: Agent[] = [], disposers: Array<() => void> = [];
const operation = (id: string): ParentOperation => ({ id, controller: new AbortController() });
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); agents.splice(0).forEach(agent => agent.destroy()); Connector.clear(); });
describe('private orchestrator operation binding', () => {
  it('does not promote an internally owned routed ledger into an originally independent operation', async () => {
    const f = fixture(); agents.push(f.agent); const coordinator = new FactoryExecution(); coordinator.attach(f.agent); disposers.push(() => coordinator.close());
    const frame = coordinator.beginPublic(); await f.agent.run('ordinary auto-created route task'); frame.release(); expect(frame.operation.modelTask).toBeUndefined();
    const internal = new ModelTask(); try { const release = beginOrchestratorExecution(f.agent, 'continuation', internal, new AbortController().signal, frame.operation); expect(frame.operation.modelTask).toBeUndefined(); release?.(); }
    finally { internal.destroy(); }
  });
  it('captures the original parent at tool admission before an asynchronous plugin yields', async () => {
    const manager = new ToolManager(), first = operation('first'), second = operation('second'); let current = first, release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    const unregister = registerOrchestratorExecution({}, manager, { current: () => current, acquire: () => () => {}, invocationParent: () => current.id }); manager.setToolContext({ userId: 'host' });
    manager.register({ definition: { type: 'function', function: { name: 'child' } }, execute: async (_args, context) => orchestratorInvocation(context)?.id });
    manager.executionPipeline.use({ name: 'barrier', beforeExecute: async () => { entered(); await barrier; } });
    try { const pending = manager.execute('child', {}); await ready; current = second; release(); expect(await pending).toBe('first'); expect(await manager.execute('child', {})).toBe('second'); }
    finally { unregister(); manager.destroy(); }
  });
  it('restores authentic async work to its original operation and rejects forged/mixed/foreign results', () => {
    const agent = {}, manager = {}, first = operation('first'), second = operation('second'); let current = first;
    const observer = { current: () => current, acquire: () => () => {}, invocationParent: () => current.id }; disposers.push(registerOrchestratorExecution(agent, manager, observer));
    const result = { tool_use_id: 'one', content: 'retained' } as ToolResult; captureOrchestratorAsync(agent, 'one'); settleOrchestratorAsync(agent, 'one', result); current = second;
    expect(orchestratorContinuation(agent, [result])).toBe(first); expect(() => orchestratorContinuation(agent, [structuredClone(result)])).toThrow(/authentic/);
    const next = { tool_use_id: 'two', content: 'second' } as ToolResult; captureOrchestratorAsync(agent, 'two'); settleOrchestratorAsync(agent, 'two', next); expect(() => orchestratorContinuation(agent, [result, next])).toThrow(/one original operation/);
    const other = {}; disposers.push(registerOrchestratorExecution(other, {}, { ...observer })); expect(() => orchestratorContinuation(other, [result])).toThrow(/authentic/); expect(orchestratorContinuation({}, [structuredClone(result)])).toBeUndefined();
  });
  it('rejects a pre-aborted selected operation before the actual provider can dispatch', async () => {
    const f = fixture(); agents.push(f.agent); const op = operation('aborted'); op.controller.abort(new Error('Host cancelled before admission'));
    disposers.push(registerOrchestratorExecution(f.agent, f.agent.tools, { current: () => op, acquire: () => () => {}, invocationParent: () => op.id }));
    await expect(f.agent.run('must not dispatch')).rejects.toThrow(/Host cancelled/); expect(f.primary.generate).not.toHaveBeenCalled();
  });
  it('correlates main/direct calls on the original shared task through a child lease without changing unselected defaults', async () => {
    const f = fixture({ modelExecution: { customProviderAttempts: 'single' } }); agents.push(f.agent); const task = new ModelTask(); const lease = acquireComposition(f.agent, { modelTask: task }); lease.setInvocationParent('child-operation');
    try {
      await lease.run('main'); await lease.direct('direct'); expect(task.snapshot().invocations.map(record => record.parentInvocationId)).toEqual(['child-operation', 'child-operation']);
      expect(() => lease.setInvocationParent('different-operation')).toThrow(/fixed before/);
    } finally { lease.release(); task.destroy(); }
  });
});
