/**
 * Routine Execution Record — persisted record for tracking/history.
 *
 * Unlike RoutineExecution (runtime state with live Plan), this is a
 * storage-agnostic snapshot meant for persistence and querying.
 * Timestamps are `number` (epoch ms), no framework dependencies.
 */

import type { RoutineExecutionStatus, RoutineDefinition } from './Routine.js';

// ============================================================================
// Step Types
// ============================================================================

export type RoutineStepType =
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.validation'
  | 'tool.call'
  | 'tool.start'
  | 'llm.start'
  | 'llm.complete'
  | 'iteration.complete'
  | 'execution.error'
  | 'control_flow.started'
  | 'control_flow.completed'
  | 'prestep.started'
  | 'prestep.completed'
  | 'prestep.failed'
  | 'poststep.started'
  | 'poststep.completed'
  | 'poststep.failed';

export interface RoutineExecutionStep {
  timestamp: number;
  taskName: string;
  type: RoutineStepType;
  data?: Record<string, unknown>;
}

// ============================================================================
// Task Snapshot
// ============================================================================

export interface RoutineTaskResult {
  success: boolean;
  output?: string;
  error?: string;
  validationScore?: number;
  validationExplanation?: string;
}

export interface RoutineTaskSnapshot {
  taskId: string;
  name: string;
  description: string;
  status: 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  result?: RoutineTaskResult;
  startedAt?: number;
  completedAt?: number;
  controlFlowType?: 'map' | 'fold' | 'until';
}

// ============================================================================
// Execution Record
// ============================================================================

export interface RoutineExecutionRecord {
  executionId: string;
  routineId: string;
  routineName: string;
  status: RoutineExecutionStatus;
  progress: number;
  tasks: RoutineTaskSnapshot[];
  steps: RoutineExecutionStep[];
  taskCount: number;
  connectorName: string;
  model: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  lastActivityAt?: number;
  trigger?: {
    type: 'schedule' | 'event' | 'manual';
    source?: string;
    event?: string;
    payload?: unknown;
  };
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create initial task snapshots from a routine definition.
 */
export function createTaskSnapshots(definition: RoutineDefinition): RoutineTaskSnapshot[] {
  return definition.tasks.map((task) => ({
    taskId: task.id ?? task.name,
    name: task.name,
    description: task.description,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: task.maxAttempts ?? 3,
    controlFlowType: task.controlFlow?.type as RoutineTaskSnapshot['controlFlowType'],
  }));
}

/**
 * Create an initial RoutineExecutionRecord from a definition.
 * Status is set to 'running' with empty steps.
 */
export function createRoutineExecutionRecord(
  definition: RoutineDefinition,
  connectorName: string,
  model: string,
  trigger?: RoutineExecutionRecord['trigger'],
): RoutineExecutionRecord {
  const now = Date.now();
  const executionId = `rexec-${now}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    executionId,
    routineId: definition.id,
    routineName: definition.name,
    status: 'running',
    progress: 0,
    tasks: createTaskSnapshots(definition),
    steps: [],
    taskCount: definition.tasks.length,
    connectorName,
    model,
    startedAt: now,
    lastActivityAt: now,
    trigger: trigger ?? { type: 'manual' },
  };
}
