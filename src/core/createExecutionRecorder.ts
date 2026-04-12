/**
 * Execution Recorder Factory
 *
 * Creates ready-to-use hooks + callbacks for `executeRoutine()` that
 * persist execution state to an IRoutineExecutionStorage backend.
 *
 * Replaces the manual hook wiring previously done in v25's
 * RoutineExecutionService._runInBackground().
 *
 * @example
 * ```typescript
 * const record = createRoutineExecutionRecord(definition, connector, model);
 * const execId = await storage.insert(userId, record);
 * const recorder = createExecutionRecorder({ storage, executionId: execId });
 *
 * executeRoutine({
 *   definition, agent, inputs,
 *   hooks: recorder.hooks,
 *   onTaskStarted: recorder.onTaskStarted,
 *   onTaskComplete: recorder.onTaskComplete,
 *   onTaskFailed: recorder.onTaskFailed,
 *   onTaskValidation: recorder.onTaskValidation,
 * })
 *   .then(exec => recorder.finalize(exec))
 *   .catch(err => recorder.finalize(null, err));
 * ```
 */

import type { HookConfig } from '../capabilities/agents/types/HookTypes.js';
import type { Task, TaskValidationResult } from '../domain/entities/Task.js';
import type { RoutineExecution, DeterministicStep } from '../domain/entities/Routine.js';
import type { RoutineExecutionStep } from '../domain/entities/RoutineExecutionRecord.js';
import type { IRoutineExecutionStorage } from '../domain/interfaces/IRoutineExecutionStorage.js';
import { logger } from '../infrastructure/observability/Logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionRecorderOptions {
  /** Storage backend for persisting execution state. */
  storage: IRoutineExecutionStorage;
  /** ID of the execution record (must already be inserted). */
  executionId: string;
  /** Optional prefix for log messages. */
  logPrefix?: string;
  /** Max length for truncated tool args/results in steps. Default: 500. */
  maxTruncateLength?: number;
}

export interface ExecutionRecorder {
  /** Hook config to pass to executeRoutine(). */
  hooks: HookConfig;
  /** Callback for onTaskStarted. */
  onTaskStarted: (task: Task, execution: RoutineExecution) => void;
  /** Callback for onTaskComplete. */
  onTaskComplete: (task: Task, execution: RoutineExecution) => void;
  /** Callback for onTaskFailed. */
  onTaskFailed: (task: Task, execution: RoutineExecution) => void;
  /** Callback for onTaskValidation. */
  onTaskValidation: (task: Task, result: TaskValidationResult, execution: RoutineExecution) => void;
  /** Callback for deterministic step start. */
  onStepStarted: (step: DeterministicStep, phase: 'pre' | 'post', index: number, execution: RoutineExecution) => void;
  /** Callback for deterministic step completion. */
  onStepComplete: (step: DeterministicStep, phase: 'pre' | 'post', index: number, result: unknown, execution: RoutineExecution) => void;
  /** Callback for deterministic step failure. */
  onStepFailed: (step: DeterministicStep, phase: 'pre' | 'post', index: number, error: Error, execution: RoutineExecution) => void;
  /** Call after executeRoutine() resolves/rejects to write final status. */
  finalize: (execution: RoutineExecution | null, error?: Error) => Promise<void>;
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(value: unknown, maxLen: number): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...(truncated)' : str;
}

function safeCall(fn: () => void | Promise<void>, prefix: string): void {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((err) => {
        logger.debug({ error: (err as Error).message }, `${prefix} async error`);
      });
    }
  } catch (err) {
    logger.debug({ error: (err as Error).message }, `${prefix} sync error`);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an ExecutionRecorder that wires hooks + callbacks to persist
 * execution state via the provided storage backend.
 */
export function createExecutionRecorder(options: ExecutionRecorderOptions): ExecutionRecorder {
  const { storage, executionId, logPrefix = '[Recorder]', maxTruncateLength = 500 } = options;
  const log = logger.child({ executionId });

  // Track current task name for hooks (hooks don't receive task context)
  let currentTaskName = '(unknown)';

  function pushStep(step: RoutineExecutionStep): void {
    safeCall(() => storage.pushStep(executionId, step), `${logPrefix} pushStep`);
  }

  function heartbeat(): void {
    safeCall(
      () => storage.update(executionId, { lastActivityAt: Date.now() }),
      `${logPrefix} heartbeat`,
    );
  }

  // ---- Hooks ----

  const hooks: HookConfig = {
    'before:llm': (ctx) => {
      pushStep({
        timestamp: Date.now(),
        taskName: currentTaskName,
        type: 'llm.start',
        data: { iteration: ctx.iteration },
      });
      return {};
    },

    'after:llm': (ctx) => {
      pushStep({
        timestamp: Date.now(),
        taskName: currentTaskName,
        type: 'llm.complete',
        data: {
          iteration: ctx.iteration,
          duration: ctx.duration,
          tokens: ctx.response?.usage,
        },
      });
      return {};
    },

    'before:tool': (ctx) => {
      pushStep({
        timestamp: Date.now(),
        taskName: currentTaskName,
        type: 'tool.start',
        data: {
          toolName: ctx.toolCall.function.name,
          args: truncate(ctx.toolCall.function.arguments, maxTruncateLength),
        },
      });
      return {};
    },

    'after:tool': (ctx) => {
      pushStep({
        timestamp: Date.now(),
        taskName: currentTaskName,
        type: 'tool.call',
        data: {
          toolName: ctx.toolCall.function.name,
          args: truncate(ctx.toolCall.function.arguments, maxTruncateLength),
          result: truncate(ctx.result?.content, maxTruncateLength),
          error: ctx.result?.error ? true : undefined,
        },
      });
      return {};
    },

    'after:execution': () => {
      pushStep({
        timestamp: Date.now(),
        taskName: currentTaskName,
        type: 'iteration.complete',
      });
    },

    'pause:check': () => {
      heartbeat();
      return { shouldPause: false };
    },
  };

  // ---- Task Callbacks ----

  const onTaskStarted = (task: Task, execution: RoutineExecution): void => {
    currentTaskName = task.name;
    const now = Date.now();

    safeCall(
      () => storage.updateTask(executionId, task.name, {
        status: 'in_progress',
        startedAt: now,
        attempts: task.attempts,
      }),
      `${logPrefix} onTaskStarted`,
    );

    pushStep({
      timestamp: now,
      taskName: task.name,
      type: 'task.started',
      data: { taskId: task.id },
    });

    // Track control flow start
    if (task.controlFlow) {
      pushStep({
        timestamp: now,
        taskName: task.name,
        type: 'control_flow.started',
        data: { flowType: task.controlFlow.type },
      });
    }

    // Update progress
    safeCall(
      () => storage.update(executionId, {
        progress: execution.progress,
        lastActivityAt: now,
      }),
      `${logPrefix} onTaskStarted progress`,
    );
  };

  const onTaskComplete = (task: Task, execution: RoutineExecution): void => {
    const now = Date.now();

    safeCall(
      () => storage.updateTask(executionId, task.name, {
        status: 'completed',
        completedAt: now,
        attempts: task.attempts,
        result: task.result ? {
          success: true,
          output: truncate(task.result.output, maxTruncateLength),
          validationScore: task.result.validationScore,
          validationExplanation: task.result.validationExplanation,
        } : undefined,
      }),
      `${logPrefix} onTaskComplete`,
    );

    pushStep({
      timestamp: now,
      taskName: task.name,
      type: 'task.completed',
      data: {
        taskId: task.id,
        validationScore: task.result?.validationScore,
      },
    });

    if (task.controlFlow) {
      pushStep({
        timestamp: now,
        taskName: task.name,
        type: 'control_flow.completed',
        data: { flowType: task.controlFlow.type },
      });
    }

    safeCall(
      () => storage.update(executionId, {
        progress: execution.progress,
        lastActivityAt: now,
      }),
      `${logPrefix} onTaskComplete progress`,
    );
  };

  const onTaskFailed = (task: Task, execution: RoutineExecution): void => {
    const now = Date.now();

    safeCall(
      () => storage.updateTask(executionId, task.name, {
        status: 'failed',
        completedAt: now,
        attempts: task.attempts,
        result: task.result ? {
          success: false,
          error: task.result.error,
          validationScore: task.result.validationScore,
          validationExplanation: task.result.validationExplanation,
        } : undefined,
      }),
      `${logPrefix} onTaskFailed`,
    );

    pushStep({
      timestamp: now,
      taskName: task.name,
      type: 'task.failed',
      data: {
        taskId: task.id,
        error: task.result?.error,
        attempts: task.attempts,
      },
    });

    safeCall(
      () => storage.update(executionId, {
        progress: execution.progress,
        lastActivityAt: now,
      }),
      `${logPrefix} onTaskFailed progress`,
    );
  };

  const onTaskValidation = (
    task: Task,
    result: TaskValidationResult,
    _execution: RoutineExecution,
  ): void => {
    pushStep({
      timestamp: Date.now(),
      taskName: task.name,
      type: 'task.validation',
      data: {
        taskId: task.id,
        isComplete: result.isComplete,
        completionScore: result.completionScore,
        explanation: result.explanation,
      },
    });
  };

  // ---- Deterministic Step Callbacks ----

  const onStepStarted = (
    step: DeterministicStep,
    phase: 'pre' | 'post',
    index: number,
    _execution: RoutineExecution,
  ): void => {
    pushStep({
      timestamp: Date.now(),
      taskName: `${phase}step:${step.name}`,
      type: `${phase}step.started`,
      data: { toolName: step.toolName, index },
    });
    heartbeat();
  };

  const onStepComplete = (
    step: DeterministicStep,
    phase: 'pre' | 'post',
    index: number,
    result: unknown,
    _execution: RoutineExecution,
  ): void => {
    pushStep({
      timestamp: Date.now(),
      taskName: `${phase}step:${step.name}`,
      type: `${phase}step.completed`,
      data: {
        toolName: step.toolName,
        index,
        result: truncate(result, maxTruncateLength),
      },
    });
  };

  const onStepFailed = (
    step: DeterministicStep,
    phase: 'pre' | 'post',
    index: number,
    error: Error,
    _execution: RoutineExecution,
  ): void => {
    pushStep({
      timestamp: Date.now(),
      taskName: `${phase}step:${step.name}`,
      type: `${phase}step.failed`,
      data: { toolName: step.toolName, index, error: error.message },
    });
  };

  // ---- Finalize ----

  const finalize = async (
    execution: RoutineExecution | null,
    error?: Error,
  ): Promise<void> => {
    const now = Date.now();

    try {
      if (error || !execution) {
        await storage.update(executionId, {
          status: 'failed',
          error: error?.message ?? 'Unknown error',
          completedAt: now,
          lastActivityAt: now,
        });

        if (error) {
          await storage.pushStep(executionId, {
            timestamp: now,
            taskName: currentTaskName,
            type: 'execution.error',
            data: { error: error.message },
          });
        }
      } else {
        await storage.update(executionId, {
          status: execution.status,
          progress: execution.progress,
          error: execution.error,
          completedAt: execution.completedAt ?? now,
          lastActivityAt: now,
        });
      }
    } catch (err) {
      log.error({ error: (err as Error).message }, `${logPrefix} finalize error`);
    }
  };

  return {
    hooks,
    onTaskStarted,
    onTaskComplete,
    onTaskFailed,
    onTaskValidation,
    onStepStarted,
    onStepComplete,
    onStepFailed,
    finalize,
  };
}
