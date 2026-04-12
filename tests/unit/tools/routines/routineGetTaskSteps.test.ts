/**
 * routine_get_task_steps Tool Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createRoutineGetTaskSteps } from '@/tools/routines/routineGetTaskSteps.js';
import type { IRoutineExecutionStorage } from '@/domain/interfaces/IRoutineExecutionStorage.js';
import type { RoutineExecutionRecord, RoutineExecutionStep } from '@/domain/entities/RoutineExecutionRecord.js';

function makeSteps(): RoutineExecutionStep[] {
  return [
    // Pre steps
    { timestamp: 1000, taskName: 'Load Config', type: 'prestep.started', data: { toolName: 'store_get', index: 0 } },
    { timestamp: 1100, taskName: 'Load Config', type: 'prestep.completed', data: { result: 'config loaded' } },
    { timestamp: 1200, taskName: 'Fetch Data', type: 'prestep.started', data: { toolName: 'web_fetch', index: 1 } },
    { timestamp: 1300, taskName: 'Fetch Data', type: 'prestep.failed', data: { error: 'Network timeout' } },
    // Task steps
    { timestamp: 2000, taskName: 'Analyze', type: 'task.started', data: {} },
    { timestamp: 2100, taskName: 'Analyze', type: 'llm.start', data: { iteration: 1 } },
    { timestamp: 2500, taskName: 'Analyze', type: 'tool.call', data: { toolName: 'web_fetch', args: {} } },
    { timestamp: 3000, taskName: 'Analyze', type: 'llm.complete', data: { tokens: 500 } },
    { timestamp: 3100, taskName: 'Analyze', type: 'task.completed', data: {} },
    { timestamp: 4000, taskName: 'Report', type: 'task.started', data: {} },
    { timestamp: 4500, taskName: 'Report', type: 'task.completed', data: {} },
    // Post steps
    { timestamp: 5000, taskName: 'Send Email', type: 'poststep.started', data: { toolName: 'send_email', index: 0 } },
    { timestamp: 5100, taskName: 'Send Email', type: 'poststep.completed', data: { result: 'sent' } },
  ];
}

function makeRecord(): RoutineExecutionRecord {
  return {
    executionId: 'exec-1',
    routineId: 'routine-1',
    routineName: 'Test',
    status: 'completed',
    progress: 100,
    tasks: [],
    steps: makeSteps(),
    taskCount: 2,
    connectorName: 'test',
    model: 'gpt-4',
    startedAt: 1000,
    completedAt: 5100,
    lastActivityAt: 5100,
  };
}

function makeMockStorage(record: RoutineExecutionRecord): IRoutineExecutionStorage {
  return {
    insert: vi.fn(),
    update: vi.fn(),
    pushStep: vi.fn(),
    updateTask: vi.fn(),
    load: vi.fn(async () => record),
    list: vi.fn(async () => [record]),
    hasRunning: vi.fn(async () => false),
  };
}

describe('routine_get_task_steps', () => {
  describe('phase=task (default)', () => {
    it('should filter by taskName and exclude pre/post steps', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', taskName: 'Analyze' }) as any;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('task');
      expect(result.filteredStepCount).toBe(5); // started, llm.start, tool.call, llm.complete, completed
      expect(result.steps.every((s: any) => s.taskName === 'Analyze')).toBe(true);
      expect(result.steps.every((s: any) => !s.type.startsWith('prestep') && !s.type.startsWith('poststep'))).toBe(true);
    });

    it('should require taskName when phase is task', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1' }) as any;

      expect(result.success).toBe(false);
      expect(result.error).toContain('taskName is required');
    });
  });

  describe('phase=pre', () => {
    it('should return all prestep steps', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', phase: 'pre' }) as any;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('pre');
      expect(result.filteredStepCount).toBe(4);
      expect(result.steps.every((s: any) => s.type.startsWith('prestep'))).toBe(true);
    });

    it('should filter pre steps by taskName when provided', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', phase: 'pre', taskName: 'Load Config' }) as any;

      expect(result.filteredStepCount).toBe(2);
      expect(result.steps.every((s: any) => s.taskName === 'Load Config')).toBe(true);
    });
  });

  describe('phase=post', () => {
    it('should return all poststep steps', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', phase: 'post' }) as any;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('post');
      expect(result.filteredStepCount).toBe(2);
      expect(result.steps.every((s: any) => s.type.startsWith('poststep'))).toBe(true);
    });
  });

  describe('phase=all', () => {
    it('should return all steps', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', phase: 'all' }) as any;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('all');
      expect(result.filteredStepCount).toBe(13); // all steps
    });

    it('should filter by taskName when provided', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', phase: 'all', taskName: 'Analyze' }) as any;

      expect(result.filteredStepCount).toBe(5);
      expect(result.steps.every((s: any) => s.taskName === 'Analyze')).toBe(true);
    });
  });

  describe('stepTypes filter', () => {
    it('should further filter by stepTypes', async () => {
      const storage = makeMockStorage(makeRecord());
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({
        executionId: 'exec-1',
        phase: 'pre',
        stepTypes: ['prestep.failed'],
      }) as any;

      expect(result.filteredStepCount).toBe(1);
      expect(result.steps[0].type).toBe('prestep.failed');
      expect(result.steps[0].data.error).toBe('Network timeout');
    });
  });

  describe('full step data', () => {
    it('should return step data without truncation', async () => {
      const longData = 'x'.repeat(5000);
      const record = makeRecord();
      record.steps[0].data = { result: longData };
      const storage = makeMockStorage(record);
      const tool = createRoutineGetTaskSteps(storage);
      const result = await tool.execute({ executionId: 'exec-1', phase: 'pre', taskName: 'Load Config' }) as any;

      expect(result.steps[0].data.result).toBe(longData);
      expect(result.steps[0].data.result).not.toContain('[truncated]');
    });
  });

  it('should error when execution not found', async () => {
    const storage: IRoutineExecutionStorage = {
      insert: vi.fn(),
      update: vi.fn(),
      pushStep: vi.fn(),
      updateTask: vi.fn(),
      load: vi.fn(async () => null),
      list: vi.fn(async () => []),
      hasRunning: vi.fn(async () => false),
    };
    const tool = createRoutineGetTaskSteps(storage);
    const result = await tool.execute({ executionId: 'nonexistent', taskName: 'Task' }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should include taskName in step output', async () => {
    const storage = makeMockStorage(makeRecord());
    const tool = createRoutineGetTaskSteps(storage);
    const result = await tool.execute({ executionId: 'exec-1', phase: 'all' }) as any;

    // Each step should have taskName
    expect(result.steps[0].taskName).toBe('Load Config');
  });

  it('should have updated describeCall', () => {
    const storage = makeMockStorage(makeRecord());
    const tool = createRoutineGetTaskSteps(storage);

    expect(tool.describeCall!({ executionId: 'e', phase: 'pre' })).toContain('pre');
    expect(tool.describeCall!({ executionId: 'e', taskName: 'Task1' })).toContain('Task1');
    expect(tool.describeCall!({ executionId: 'e', phase: 'all', taskName: 'X' })).toContain('all');
  });
});
