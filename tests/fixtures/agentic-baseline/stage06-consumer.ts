/** Optional Stage 06 APIs compile against the built package alongside legacy consumers. */
import { Agent, ModelTask, ModelBudgetExceededError, HelperOutputError } from '@everworker/oneringai';
import type { HelperInputContext, ModelExecutionConfig, ModelTaskSnapshot } from '@everworker/oneringai';

export const profile: ModelExecutionConfig = { helpers: {
  extractor: { connector: 'approved-helper', model: 'gpt-4o-mini', maxOutputTokens: 256 },
} };

export function reportExternalFailure(task: ModelTask): void {
  task.recordExternal({ id: 'host-failure', connector: 'approved-external', model: 'gpt-4o-mini',
    purpose: 'external', usage: null, status: 'failed' });
}

export async function sharedModels(agent: Agent): Promise<ModelTaskSnapshot> {
  const task = new ModelTask({ limits: { maxCalls: 4, maxTokens: 2_000_000 } });
  try {
    await agent.invokeHelper('extractor', (context: HelperInputContext) => `Explicit packet for ${context.model}`, {
      modelTask: task, schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    });
    await agent.run('Use the result.', { modelTask: task });
    return task.snapshot();
  } catch (error) { if (error instanceof ModelBudgetExceededError || error instanceof HelperOutputError) throw error; throw error; }
  finally { task.destroy(); }
}
