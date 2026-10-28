import { compositionInvocationParent } from './composition.js';
import { orchestratorInvocationParent } from '../orchestrator/executionBinding.js';

/** Explicit selected ownership only; callers retain their existing unselected fallback. */
export function selectedInvocationParent(subject: object): string | undefined {
  return compositionInvocationParent(subject) ?? orchestratorInvocationParent(subject);
}
