import { createRoutineRunner } from '@everworker/oneringai';
import type { Agent, RoutineDefinition, ExecutionBinding, RoutineContinuation, RoutineRunResult } from '@everworker/oneringai';
export async function verified(agent: Agent, definition: RoutineDefinition, execution: ExecutionBinding): Promise<RoutineRunResult> {
  const runner = createRoutineRunner({ verify: observation => observation.phase === 'task'
    ? { kind: 'verified' } : { kind: 'waiting', reason: 'Host check' } });
  try {
    const result = await runner.run({ agent, definition, execution });
    if ('continuation' in result) return await runner.resume(result.continuation, { authorize: () => true, execution });
    return result;
  } finally { runner.close(); }
}
// @ts-expect-error A JSON-shaped object cannot manufacture continuation authority.
const serialized: RoutineContinuation = {};
void serialized;
// @ts-expect-error Required host verification cannot be omitted.
createRoutineRunner({});
