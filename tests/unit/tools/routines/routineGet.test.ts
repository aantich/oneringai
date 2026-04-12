/**
 * routine_get Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoutineGet } from '@/tools/routines/routineGet.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import type { IRoutineDefinitionStorage } from '@/domain/interfaces/IRoutineDefinitionStorage.js';

function makeMockStorage(routines: ReturnType<typeof createRoutineDefinition>[] = []): IRoutineDefinitionStorage {
  return {
    save: vi.fn(),
    load: vi.fn(async (_userId, id) => routines.find(r => r.id === id) ?? null),
    list: vi.fn(async (_userId, opts) => {
      if (opts?.search) {
        return routines.filter(r => r.name.toLowerCase().includes(opts.search!.toLowerCase())).slice(0, opts.limit ?? 10);
      }
      return routines.slice(0, opts?.limit ?? 10);
    }),
    delete: vi.fn(),
    getPath: vi.fn(() => '/test/path'),
  };
}

describe('routine_get', () => {
  let storage: IRoutineDefinitionStorage;
  let routine: ReturnType<typeof createRoutineDefinition>;

  beforeEach(() => {
    routine = createRoutineDefinition({
      name: 'Test Routine',
      description: 'A test routine with all fields',
      instructions: 'These are long instructions that previously would have been truncated to 500 chars but should now be returned in full. '.repeat(10),
      parameters: [
        { name: 'email', description: 'Recipient', required: true },
        { name: 'format', description: 'Output format', default: 'markdown' },
      ],
      tasks: [
        {
          name: 'Analyze',
          description: 'A very long task description that previously would have been truncated. '.repeat(20),
          expectedOutput: 'Expected output that is also very long and should not be truncated. '.repeat(20),
        },
        { name: 'Report', description: 'Generate report', dependsOn: ['Analyze'] },
      ],
      preSteps: [
        { name: 'Load Config', toolName: 'store_get', args: { key: '{{param.email}}' }, resultKey: 'config' },
      ],
      postSteps: [
        { name: 'Send Email', toolName: 'send_email', args: { to: '{{param.email}}' }, onError: 'continue' },
      ],
      postStepsTrigger: 'always',
      timeoutMs: 120000,
      tags: ['test'],
      metadata: { priority: 'high' },
    });
    storage = makeMockStorage([routine]);
  });

  it('should return full routine without truncation', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;

    expect(result.success).toBe(true);
    expect(result.routine.instructions).toBe(routine.instructions);
    expect(result.routine.instructions).not.toContain('[truncated]');
  });

  it('should return full task descriptions without truncation', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;

    const task = result.routine.tasks[0];
    expect(task.description).toBe(routine.tasks[0].description);
    expect(task.description).not.toContain('[truncated]');
    expect(task.expectedOutput).toBe(routine.tasks[0].expectedOutput);
  });

  it('should include preSteps in returned routine', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;

    expect(result.routine.preSteps).toHaveLength(1);
    expect(result.routine.preSteps[0].name).toBe('Load Config');
    expect(result.routine.preSteps[0].toolName).toBe('store_get');
    expect(result.routine.preSteps[0].args).toEqual({ key: '{{param.email}}' });
    expect(result.routine.preSteps[0].resultKey).toBe('config');
  });

  it('should include postSteps in returned routine', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;

    expect(result.routine.postSteps).toHaveLength(1);
    expect(result.routine.postSteps[0].name).toBe('Send Email');
    expect(result.routine.postSteps[0].onError).toBe('continue');
  });

  it('should include postStepsTrigger', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;
    expect(result.routine.postStepsTrigger).toBe('always');
  });

  it('should include timeoutMs', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;
    expect(result.routine.timeoutMs).toBe(120000);
  });

  it('should include metadata', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;
    expect(result.routine.metadata).toEqual({ priority: 'high' });
  });

  it('should return full task controlFlow and validation', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: routine.id }) as any;

    // Tasks should have full structure, not stripped
    expect(result.routine.tasks[1].dependsOn).toEqual(['Analyze']);
  });

  it('should find routine by name', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineName: 'Test' }) as any;
    expect(result.success).toBe(true);
    expect(result.routine.name).toBe('Test Routine');
  });

  it('should error when routine not found', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({ routineId: 'nonexistent' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should error when neither routineId nor routineName provided', async () => {
    const tool = createRoutineGet(storage);
    const result = await tool.execute({}) as any;
    expect(result.success).toBe(false);
  });

  it('should return routine without optional fields when not set', async () => {
    const minimal = createRoutineDefinition({
      name: 'Minimal',
      description: 'Minimal routine',
      tasks: [{ name: 'Task1', description: 'Do something' }],
    });
    const minStorage = makeMockStorage([minimal]);
    const tool = createRoutineGet(minStorage);
    const result = await tool.execute({ routineId: minimal.id }) as any;

    expect(result.success).toBe(true);
    expect(result.routine.preSteps).toBeUndefined();
    expect(result.routine.postSteps).toBeUndefined();
    expect(result.routine.postStepsTrigger).toBeUndefined();
    expect(result.routine.timeoutMs).toBeUndefined();
  });
});
