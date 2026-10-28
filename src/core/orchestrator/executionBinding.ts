import type { ModelTask } from '../model-execution/ModelTask.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { ToolResult } from '../../domain/entities/Tool.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';

/** Private operation identity. Owned by one selected orchestrator, never serialized. */
export interface ParentOperation {
  readonly id: string;
  readonly controller: AbortController;
  modelTask?: ModelTask;
}
export interface OrchestratorExecutionObserver {
  current(): ParentOperation | undefined;
  acquire(kind: string, explicitTask: ModelTask | undefined, signal: AbortSignal, origin?: ParentOperation): () => void;
  invocationParent(): string | undefined;
  allowAutoContinuation?(): boolean;
  retainAsync?(operation: ParentOperation): () => void;
}
const agents = new WeakMap<object, OrchestratorExecutionObserver>();
const managers = new WeakMap<object, OrchestratorExecutionObserver>();
interface AsyncOrigin { observer: OrchestratorExecutionObserver; operation: ParentOperation; release?: () => void }
const pending = new WeakMap<object, Map<string, AsyncOrigin>>();
const results = new WeakMap<object, AsyncOrigin>();
const INVOCATION = Symbol.for('@everworker/oneringai/orchestrator-invocation/v1');
const flushers = new WeakMap<object, () => void>();
export function registerOrchestratorAsyncFlusher(agent: object, flush: () => void): void { flushers.set(agent, flush); }
export function requestOrchestratorAsyncContinuation(agent: object): void { flushers.get(agent)?.(); }

export function registerOrchestratorExecution(agent: object, manager: object, observer: OrchestratorExecutionObserver): () => void {
  agents.set(agent, observer); managers.set(manager, observer);
  return () => { agents.delete(agent); managers.delete(manager); pending.delete(agent); };
}
export function beginOrchestratorExecution(agent: object, kind: string, explicitTask: ModelTask | undefined, signal: AbortSignal, origin?: ParentOperation): (() => void) | undefined {
  return agents.get(agent)?.acquire(kind, explicitTask, signal, origin);
}
export function orchestratorInvocationParent(agent: object): string | undefined { return agents.get(agent)?.invocationParent(); }
export function isFactoryOrchestrator(agent: object): boolean { return agents.has(agent); }
export function allowOrchestratorAutoContinuation(agent: object): boolean { return agents.get(agent)?.allowAutoContinuation?.() !== false; }
export function orchestratorOperationSignal(agent: object): AbortSignal | undefined { return agents.get(agent)?.current()?.controller.signal; }
export function captureOrchestratorInvocation(manager: object, context: ToolContext): void {
  const operation = managers.get(manager)?.current();
  if (operation) Object.defineProperty(context, INVOCATION, { value: operation, enumerable: true });
}
export function orchestratorInvocation(context: ToolContext | undefined): ParentOperation | undefined {
  return context ? Object.getOwnPropertyDescriptor(context, INVOCATION)?.value as ParentOperation | undefined : undefined;
}
export function captureOrchestratorAsync(agent: object, callId: string): void {
  const observer = agents.get(agent), operation = observer?.current();
  if (!observer || !operation) return;
  let entries = pending.get(agent); if (!entries) { entries = new Map(); pending.set(agent, entries); }
  if (entries.has(callId)) throw new InvalidConfigError('Duplicate selected async invocation');
  entries.set(callId, { observer, operation, release: observer.retainAsync?.(operation) });
}
export function settleOrchestratorAsync(agent: object, callId: string, result: ToolResult): void {
  const entries = pending.get(agent), origin = entries?.get(callId); if (!origin) return;
  entries!.delete(callId); results.set(result, origin);
}
export function forgetOrchestratorAsync(agent: object, callId?: string): void {
  const entries = pending.get(agent);
  if (callId) { entries?.get(callId)?.release?.(); entries?.delete(callId); }
  else { entries?.forEach(origin => origin.release?.()); pending.delete(agent); }
}
export function consumeOrchestratorAsync(batch: ToolResult[]): void {
  for (const result of batch) { const origin = results.get(result); origin?.release?.(); if (origin) origin.release = undefined; }
}
export function orchestratorContinuation(agent: object, batch: ToolResult[]): ParentOperation | undefined {
  const observer = agents.get(agent); if (!observer || !batch.length) return undefined;
  let operation: ParentOperation | undefined;
  for (const result of batch) {
    const origin = results.get(result);
    if (!origin || origin.observer !== observer || operation && origin.operation !== operation) throw new InvalidConfigError('Selected orchestrator continuation requires authentic results from one original operation');
    operation = origin.operation;
  }
  return operation;
}
