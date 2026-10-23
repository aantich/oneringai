import { Agent, ModelTask } from '@everworker/oneringai';
import type { ModelRoutingConfig, ModelRoutingRunOptions, ModelRoutingDiagnostics } from '@everworker/oneringai';
import type { ModelRouteConfig, ModelRoutingContext } from '@everworker/oneringai/types';
const fast: ModelRouteConfig = { connector: 'primary', model: 'gpt-4o-mini', maxOutputTokens: 256 };
export const routing: ModelRoutingConfig = { routes: { fast }, sticky: 'phase', select: (context: ModelRoutingContext) =>
  ({ route: context.hints.taskType === 'lookup' ? 'fast' : 'default', reason: 'explicit measured category' }) };
export async function routed(agent: Agent): Promise<ModelRoutingDiagnostics | undefined> {
  const task = new ModelTask({ limits: { maxCalls: 2 } });
  const options: ModelRoutingRunOptions = { phase: 'lookup', taskType: 'lookup' };
  try { await agent.run('lookup', { routing: options, modelTask: task }); await agent.run('default', { routing: null, modelTask: task }); return agent.getRoutingDiagnostics(); }
  finally { task.destroy(); }
}
