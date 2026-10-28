import { randomUUID } from 'node:crypto';
import type { Agent } from '../Agent.js';
import type { ModelTask } from '../model-execution/ModelTask.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { ParentOperation } from './executionBinding.js';
import { orchestratorInvocation, registerOrchestratorExecution } from './executionBinding.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';

interface Operation extends ParentOperation { users: number; children: number }
/** One selected parent's operation ownership; not a scheduler or a second model ledger. */
export class FactoryExecution {
  private readonly known = new WeakSet<object>();
  private readonly open = new Map<string, Operation>();
  private publicOperation?: Operation;
  private executionOperation?: Operation;
  private unregister?: () => void;
  private closed = false;
  private notifyIdle?: () => void;

  attach(agent: Agent, notifyIdle?: () => void): void {
    this.notifyIdle = notifyIdle;
    this.unregister = registerOrchestratorExecution(agent, agent.tools, {
      current: () => this.executionOperation ?? this.publicOperation,
      invocationParent: () => (this.executionOperation ?? this.publicOperation)?.id,
      allowAutoContinuation: () => !this.publicOperation,
      retainAsync: operation => this.retainChild(operation),
      acquire: (kind, task, signal, origin) => {
        this.assertOpen();
        if (!['run', 'stream', 'continuation', 'external'].includes(kind)) return () => {};
        if (kind === 'continuation' && this.publicOperation) throw new InvalidConfigError('Finish the current parent turn before delivering an earlier async operation');
        const operation = origin ? this.adopt(origin) : this.publicOperation ?? this.create(task);
        if (operation.modelTask && task && operation.modelTask !== task) throw new InvalidConfigError('Orchestrator continuation must retain its original model task');
        // A routed continuation can use an internally owned root ledger. It does
        // not turn an originally unbound operation into shared child authority.
        if (!origin) operation.modelTask ??= task;
        this.executionOperation = operation; operation.users++; this.open.set(operation.id, operation);
        const abort = () => operation.controller.abort(signal.reason);
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
        let finished = false;
        return () => {
          if (finished) return; finished = true; signal.removeEventListener('abort', abort);
          if (this.executionOperation === operation) this.executionOperation = undefined;
          operation.users--; this.retire(operation);
          this.signalIdle();
        };
      },
    });
  }
  beginPublic(task?: ModelTask): { operation: ParentOperation; release(): void } {
    this.assertOpen();
    if (this.publicOperation || this.executionOperation) throw new InvalidConfigError('Orchestrator already has an active operation');
    const operation = this.create(task); this.publicOperation = operation; operation.users++; this.open.set(operation.id, operation);
    let done = false;
    return { operation, release: () => { if (done) return; done = true; if (this.publicOperation === operation) this.publicOperation = undefined; operation.users--; this.retire(operation); this.signalIdle(); } };
  }
  currentOperation(): ParentOperation { this.assertOpen(); return this.executionOperation ?? this.publicOperation ?? this.create(); }
  forInvocation(context?: ToolContext): ParentOperation {
    this.assertOpen();
    const captured = orchestratorInvocation(context);
    return captured ? this.adopt(captured) : this.create();
  }
  retainChild(origin: ParentOperation): () => void {
    this.assertOpen(); const operation = this.adopt(origin); operation.children++; this.open.set(operation.id, operation);
    let released = false;
    return () => { if (released) return; released = true; operation.children--; this.retire(operation); };
  }
  cancelCurrent(reason: unknown = new DOMException('Parent operation cancelled', 'AbortError')): void {
    const operation = this.executionOperation ?? this.publicOperation;
    if (operation) operation.controller.abort(reason);
    else for (const active of this.open.values()) active.controller.abort(reason);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; for (const operation of this.open.values()) operation.controller.abort(new DOMException('Orchestrator destroyed', 'AbortError'));
    this.unregister?.(); this.unregister = undefined; this.open.clear();
    this.publicOperation = undefined; this.executionOperation = undefined; this.notifyIdle = undefined;
  }
  private create(modelTask?: ModelTask): Operation {
    const operation = { id: `orchestration_${randomUUID()}`, controller: new AbortController(), modelTask, users: 0, children: 0 };
    this.known.add(operation); return operation;
  }
  private adopt(operation: ParentOperation): Operation {
    if (!this.known.has(operation)) throw new InvalidConfigError('Child operation does not belong to this orchestrator');
    return operation as Operation;
  }
  private retire(operation: Operation): void { if (!operation.users && !operation.children) this.open.delete(operation.id); }
  private signalIdle(): void { if (!this.closed && !this.publicOperation && !this.executionOperation) this.notifyIdle?.(); }
  private assertOpen(): void { if (this.closed) throw new InvalidConfigError('Orchestrator is closed'); }
}
