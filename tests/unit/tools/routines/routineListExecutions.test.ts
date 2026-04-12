/**
 * routine_list_executions Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoutineListExecutions } from '@/tools/routines/routineListExecutions.js';
import type { IRoutineExecutionStorage } from '@/domain/interfaces/IRoutineExecutionStorage.js';
import type { RoutineExecutionRecord } from '@/domain/entities/RoutineExecutionRecord.js';

function makeRecord(overrides?: Partial<RoutineExecutionRecord>): RoutineExecutionRecord {
  return {
    executionId: 'exec-1',
    routineId: 'routine-1',
    routineName: 'Test Routine',
    status: 'completed',
    progress: 100,
    tasks: [
      {
        taskId: 't1',
        name: 'Analyze',
        description: 'Analyze data',
        status: 'completed',
        attempts: 1,
        maxAttempts: 3,
        result: { success: true, output: 'Analysis done' },
      },
    ],
    steps: [],
    taskCount: 1,
    connectorName: 'test-openai',
    model: 'gpt-4',
    startedAt: Date.now() - 60000,
    completedAt: Date.now(),
    lastActivityAt: Date.now(),
    ...overrides,
  };
}

function makeMockStorage(records: RoutineExecutionRecord[] = []): IRoutineExecutionStorage {
  return {
    insert: vi.fn(),
    update: vi.fn(),
    pushStep: vi.fn(),
    updateTask: vi.fn(),
    load: vi.fn(async (id) => records.find(r => r.executionId === id) ?? null),
    list: vi.fn(async () => records),
    hasRunning: vi.fn(async () => false),
  };
}

describe('routine_list_executions', () => {
  it('should include preStepsSummary when pre steps exist', async () => {
    const record = makeRecord({
      steps: [
        { timestamp: 1, taskName: 'Load Config', type: 'prestep.started', data: { toolName: 'store_get' } },
        { timestamp: 2, taskName: 'Load Config', type: 'prestep.completed', data: {} },
        { timestamp: 3, taskName: 'Fetch API', type: 'prestep.started', data: { toolName: 'web_fetch' } },
        { timestamp: 4, taskName: 'Fetch API', type: 'prestep.failed', data: { error: 'Timeout' } },
      ],
    });
    const storage = makeMockStorage([record]);
    const tool = createRoutineListExecutions(storage);
    const result = await tool.execute({ routineId: 'routine-1' }) as any;

    expect(result.success).toBe(true);
    const exec = result.executions[0];
    expect(exec.preStepsSummary).toBeDefined();
    expect(exec.preStepsSummary.total).toBe(2);
    expect(exec.preStepsSummary.completed).toBe(1);
    expect(exec.preStepsSummary.failed).toBe(1);
    expect(exec.preStepsSummary.errors).toEqual(['Timeout']);
  });

  it('should include postStepsSummary when post steps exist', async () => {
    const record = makeRecord({
      steps: [
        { timestamp: 1, taskName: 'Send Email', type: 'poststep.started', data: {} },
        { timestamp: 2, taskName: 'Send Email', type: 'poststep.completed', data: {} },
        { timestamp: 3, taskName: 'Save Report', type: 'poststep.started', data: {} },
        { timestamp: 4, taskName: 'Save Report', type: 'poststep.completed', data: {} },
      ],
    });
    const storage = makeMockStorage([record]);
    const tool = createRoutineListExecutions(storage);
    const result = await tool.execute({ routineId: 'routine-1' }) as any;

    const exec = result.executions[0];
    expect(exec.postStepsSummary).toBeDefined();
    expect(exec.postStepsSummary.total).toBe(2);
    expect(exec.postStepsSummary.completed).toBe(2);
    expect(exec.postStepsSummary.failed).toBe(0);
    expect(exec.postStepsSummary.errors).toBeUndefined();
  });

  it('should omit step summaries when no pre/post steps exist', async () => {
    const record = makeRecord({
      steps: [
        { timestamp: 1, taskName: 'Analyze', type: 'task.started', data: {} },
        { timestamp: 2, taskName: 'Analyze', type: 'task.completed', data: {} },
      ],
    });
    const storage = makeMockStorage([record]);
    const tool = createRoutineListExecutions(storage);
    const result = await tool.execute({ routineId: 'routine-1' }) as any;

    const exec = result.executions[0];
    expect(exec.preStepsSummary).toBeUndefined();
    expect(exec.postStepsSummary).toBeUndefined();
  });

  it('should return full task result without truncation', async () => {
    const longOutput = 'A'.repeat(2000);
    const record = makeRecord({
      tasks: [{
        taskId: 't1',
        name: 'Task',
        description: 'desc',
        status: 'completed',
        attempts: 1,
        maxAttempts: 3,
        result: { success: true, output: longOutput },
      }],
    });
    const storage = makeMockStorage([record]);
    const tool = createRoutineListExecutions(storage);
    const result = await tool.execute({ routineId: 'routine-1' }) as any;

    expect(result.executions[0].tasks[0].result.output).toBe(longOutput);
  });

  it('should return full error without truncation', async () => {
    const longError = 'Error: '.repeat(200);
    const record = makeRecord({ error: longError });
    const storage = makeMockStorage([record]);
    const tool = createRoutineListExecutions(storage);
    const result = await tool.execute({ routineId: 'routine-1' }) as any;

    expect(result.executions[0].error).toBe(longError);
  });
});
