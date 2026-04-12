/**
 * routine_update Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoutineUpdate } from '@/tools/routines/routineUpdate.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import type { IRoutineDefinitionStorage } from '@/domain/interfaces/IRoutineDefinitionStorage.js';

function makeMockStorage(routines: ReturnType<typeof createRoutineDefinition>[] = []): IRoutineDefinitionStorage {
  const store = new Map(routines.map(r => [r.id, r]));
  return {
    save: vi.fn(async (_userId, routine) => { store.set(routine.id, routine); }),
    load: vi.fn(async (_userId, id) => store.get(id) ?? null),
    list: vi.fn(async () => [...store.values()]),
    delete: vi.fn(),
    getPath: vi.fn(() => '/test/path'),
  };
}

describe('routine_update', () => {
  let storage: IRoutineDefinitionStorage;
  let routine: ReturnType<typeof createRoutineDefinition>;

  beforeEach(() => {
    routine = createRoutineDefinition({
      name: 'Original Routine',
      description: 'Original description',
      tasks: [
        { name: 'Task1', description: 'Do task 1' },
        { name: 'Task2', description: 'Do task 2', dependsOn: ['Task1'] },
      ],
      tags: ['original'],
    });
    storage = makeMockStorage([routine]);
  });

  it('should have correct tool definition', () => {
    const tool = createRoutineUpdate(storage);
    expect(tool.definition.function.name).toBe('routine_update');
  });

  it('should update description', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: { description: 'New description' },
    }) as any;

    expect(result.success).toBe(true);
    expect(result.updatedFields).toEqual(['description']);
    expect(result.routineName).toBe('Original Routine');

    // Verify saved
    const saved = await storage.load(undefined, routine.id);
    expect(saved!.description).toBe('New description');
  });

  it('should update preSteps', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: {
        preSteps: [
          { name: 'Load Data', toolName: 'store_get', args: { key: 'config' } },
        ],
      },
    }) as any;

    expect(result.success).toBe(true);
    expect(result.updatedFields).toContain('preSteps');

    const saved = await storage.load(undefined, routine.id);
    expect(saved!.preSteps).toHaveLength(1);
    expect(saved!.preSteps![0].toolName).toBe('store_get');
  });

  it('should update postSteps and postStepsTrigger together', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: {
        postSteps: [
          { name: 'Notify', toolName: 'send_email', args: { to: 'test@test.com' }, onError: 'continue' },
        ],
        postStepsTrigger: 'always',
      },
    }) as any;

    expect(result.success).toBe(true);
    expect(result.updatedFields).toContain('postSteps');
    expect(result.updatedFields).toContain('postStepsTrigger');

    const saved = await storage.load(undefined, routine.id);
    expect(saved!.postSteps).toHaveLength(1);
    expect(saved!.postStepsTrigger).toBe('always');
  });

  it('should update timeoutMs', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: { timeoutMs: 600000 },
    }) as any;

    expect(result.success).toBe(true);
    const saved = await storage.load(undefined, routine.id);
    expect(saved!.timeoutMs).toBe(600000);
  });

  it('should update multiple fields at once', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: {
        description: 'Updated',
        instructions: 'New instructions',
        tags: ['updated', 'v2'],
        metadata: { version: 2 },
      },
    }) as any;

    expect(result.success).toBe(true);
    expect(result.updatedFields).toEqual(
      expect.arrayContaining(['description', 'instructions', 'tags', 'metadata']),
    );
  });

  it('should update parameters', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: {
        parameters: [
          { name: 'email', description: 'Recipient email', required: true },
        ],
      },
    }) as any;

    expect(result.success).toBe(true);
    const saved = await storage.load(undefined, routine.id);
    expect(saved!.parameters).toHaveLength(1);
    expect(saved!.parameters![0].name).toBe('email');
  });

  it('should re-validate via createRoutineDefinition', async () => {
    const tool = createRoutineUpdate(storage);
    // This should still pass validation since we're not breaking deps
    const result = await tool.execute({
      routineId: routine.id,
      updates: { requiredTools: ['web_fetch'] },
    }) as any;

    expect(result.success).toBe(true);
  });

  it('should preserve routine id after update', async () => {
    const tool = createRoutineUpdate(storage);
    await tool.execute({
      routineId: routine.id,
      updates: { description: 'Updated' },
    });

    const saved = await storage.load(undefined, routine.id);
    expect(saved!.id).toBe(routine.id);
  });

  it('should error when routine not found', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: 'nonexistent',
      updates: { description: 'Updated' },
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should error when no valid update fields provided', async () => {
    const tool = createRoutineUpdate(storage);
    const result = await tool.execute({
      routineId: routine.id,
      updates: {},
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid update fields');
  });

  it('should have describeCall', () => {
    const tool = createRoutineUpdate(storage);
    const desc = tool.describeCall!({ routineId: 'r123', updates: {} });
    expect(desc).toContain('r123');
  });
});
