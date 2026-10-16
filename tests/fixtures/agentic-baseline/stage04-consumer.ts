import { Agent, TaskStatePluginNextGen } from '@everworker/oneringai';
import type { TaskStatePluginConfig, TaskStateHostDelta, TaskStateSnapshot, TaskStateLifecycleView, TaskStateAction, TaskStateNoteInput, TaskStateSource, ToolExecutionOutcome } from '@everworker/oneringai';
export const config: TaskStatePluginConfig = { scope: { ownerId: 'host-user', namespace: 'work' }, taskId: 'task', lifecycle: { kind: 'task', id: 'existing-task' } };
export const note: TaskStateNoteInput = { id: 'budget', category: 'constraint', text: 'Spend at most 40', source: { label: 'User confirmed' } };
export const delta: TaskStateHostDelta = { notes: [note] };
export const source: TaskStateSource = { label: 'Host checked remote state' };
export function consumer() { return Agent.create({ connector: 'main', model: 'gpt-4o-mini', userId: 'host-user', context: { model: 'gpt-4o-mini', features: { taskState: true }, plugins: { taskState: config } } }); }
export function update(plugin: TaskStatePluginNextGen, outcome: ToolExecutionOutcome): TaskStateSnapshot {
  plugin.updateHost(delta, plugin.revision); plugin.recordAction(outcome, plugin.revision);
  const action: TaskStateAction | undefined = plugin.getState().actions[0]; if (action) plugin.confirmAction(action.outcome.executionId, 'waiting_external', source, plugin.revision);
  const view: TaskStateLifecycleView = { kind: 'task', id: 'existing-task', status: 'waiting_external' }; return plugin.syncLifecycle(view, plugin.revision);
}

export function atomicRecovery(plugin: TaskStatePluginNextGen, executionId: string): TaskStateSnapshot {
  return plugin.updateHost({ confirmActions: [{ executionId, status: 'completed', source }], prune: { executionIds: [executionId] } }, plugin.revision);
}
