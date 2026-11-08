import type { InvocationState } from './invocationTypes.js';
const bindings = new WeakMap<AbortSignal, { state: InvocationState; owners: number }>();
export function withInvocation<T>(state: InvocationState, operation: () => T): T {
  const entry = bindings.get(state.signal) ?? { state, owners: 0 };
  if (entry.state !== state) throw new Error('Conflicting private model invocation binding');
  entry.owners++; bindings.set(state.signal, entry);
  const release = (): void => { if (--entry.owners === 0) bindings.delete(state.signal); };
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === 'function') return Promise.resolve(result).finally(release) as T;
    release(); return result;
  } catch (error) { release(); throw error; }
}
export function getInvocation(signal?: AbortSignal): InvocationState | undefined { return signal ? bindings.get(signal)?.state : undefined; }
export function ambientInvocation(): InvocationState | undefined { return undefined; }
export const explicitInvocation = getInvocation;
export function withoutInvocation<T>(operation: () => T): T { return operation(); }
