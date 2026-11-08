import { AsyncLocalStorage } from 'node:async_hooks';
import type { InvocationState } from './invocationTypes.js';
const storage = new AsyncLocalStorage<InvocationState>();
export function withInvocation<T>(state: InvocationState, operation: () => T): T { return storage.run(state, operation); }
export function getInvocation(_signal?: AbortSignal): InvocationState | undefined { return storage.getStore(); }
export function ambientInvocation(): InvocationState | undefined { return storage.getStore(); }
export function explicitInvocation(_signal?: AbortSignal): InvocationState | undefined { return undefined; }
export function withoutInvocation<T>(operation: () => T): T { return storage.exit(operation); }
