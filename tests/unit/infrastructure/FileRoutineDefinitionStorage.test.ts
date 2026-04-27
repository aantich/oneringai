/**
 * Tests for FileRoutineDefinitionStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileRoutineDefinitionStorage } from '../../../src/infrastructure/storage/FileRoutineDefinitionStorage.js';
import type { RoutineDefinition } from '../../../src/domain/entities/Routine.js';

describe('FileRoutineDefinitionStorage', () => {
  let storage: FileRoutineDefinitionStorage;
  let testDir: string;

  function makeRoutine(id: string, overrides: Partial<RoutineDefinition> = {}): RoutineDefinition {
    const now = new Date().toISOString();
    return {
      id,
      name: `Routine ${id}`,
      description: `Test routine: ${id}`,
      tasks: [
        { name: 'task1', description: 'First task' },
      ],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(async () => {
    testDir = join(tmpdir(), `routine-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storage = new FileRoutineDefinitionStorage({ baseDirectory: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('save + load', () => {
    it('should save and load a routine definition', async () => {
      const def = makeRoutine('my-routine');
      await storage.save('test-user', def);

      const loaded = await storage.load('test-user', 'my-routine');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('my-routine');
      expect(loaded!.name).toBe('Routine my-routine');
      expect(loaded!.tasks).toHaveLength(1);
    });

    it('should overwrite existing routine on save', async () => {
      const def1 = makeRoutine('my-routine', { description: 'v1' });
      await storage.save('test-user', def1);

      const def2 = makeRoutine('my-routine', { description: 'v2' });
      await storage.save('test-user', def2);

      const loaded = await storage.load('test-user', 'my-routine');
      expect(loaded!.description).toBe('v2');
    });

    it('should return null for nonexistent routine', async () => {
      const loaded = await storage.load('test-user', 'nonexistent');
      expect(loaded).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing routine', async () => {
      await storage.save('test-user', makeRoutine('to-delete'));
      expect(await storage.exists('test-user', 'to-delete')).toBe(true);

      await storage.delete('test-user', 'to-delete');
      expect(await storage.exists('test-user', 'to-delete')).toBe(false);
    });

    it('should not throw when deleting nonexistent routine', async () => {
      await expect(storage.delete('test-user', 'nonexistent')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing routine', async () => {
      await storage.save('test-user', makeRoutine('exists-test'));
      expect(await storage.exists('test-user', 'exists-test')).toBe(true);
    });

    it('should return false for nonexistent routine', async () => {
      expect(await storage.exists('test-user', 'nope')).toBe(false);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await storage.save('test-user', makeRoutine('alpha', {
        name: 'Alpha Routine',
        description: 'First routine',
        tags: ['daily', 'dev'],
        author: 'alice',
      }));
      await storage.save('test-user', makeRoutine('beta', {
        name: 'Beta Routine',
        description: 'Second routine for web tasks',
        tags: ['weekly', 'web'],
        author: 'bob',
      }));
      await storage.save('test-user', makeRoutine('gamma', {
        name: 'Gamma Routine',
        description: 'Third routine',
        tags: ['daily', 'web'],
        author: 'alice',
      }));
    });

    it('should list all routines', async () => {
      const routines = await storage.list('test-user');
      expect(routines).toHaveLength(3);
    });

    it('should filter by tags', async () => {
      const routines = await storage.list('test-user', { tags: ['web'] });
      expect(routines).toHaveLength(2);
      const ids = routines.map(r => r.id);
      expect(ids).toContain('beta');
      expect(ids).toContain('gamma');
    });

    it('should filter by search text (name)', async () => {
      const routines = await storage.list('test-user', { search: 'Alpha' });
      expect(routines).toHaveLength(1);
      expect(routines[0].id).toBe('alpha');
    });

    it('should filter by search text (description)', async () => {
      const routines = await storage.list('test-user', { search: 'web tasks' });
      expect(routines).toHaveLength(1);
      expect(routines[0].id).toBe('beta');
    });

    it('should support pagination with limit', async () => {
      const routines = await storage.list('test-user', { limit: 2 });
      expect(routines).toHaveLength(2);
    });

    it('should support pagination with offset', async () => {
      const all = await storage.list('test-user');
      const offset = await storage.list('test-user', { offset: 1 });
      expect(offset).toHaveLength(all.length - 1);
    });

    it('should return empty array when no matches', async () => {
      const routines = await storage.list('test-user', { tags: ['nonexistent'] });
      expect(routines).toHaveLength(0);
    });

    it('should return slim RoutineSummary entries', async () => {
      const summaries = await storage.list('test-user');
      for (const s of summaries) {
        expect(s.id).toBeDefined();
        expect(s.name).toBeDefined();
        expect(s.description).toBeDefined();
        expect(s.taskCount).toBeGreaterThan(0);
        expect(s.updatedAt).toBeDefined();
        // Summary must NOT carry full-definition fields.
        expect((s as Record<string, unknown>).tasks).toBeUndefined();
        expect((s as Record<string, unknown>).createdAt).toBeUndefined();
        expect((s as Record<string, unknown>).preSteps).toBeUndefined();
        expect((s as Record<string, unknown>).postSteps).toBeUndefined();
        expect((s as Record<string, unknown>).instructions).toBeUndefined();
      }
    });
  });

  describe('index management', () => {
    it('should remove from index on delete', async () => {
      await storage.save('test-user', makeRoutine('a'));
      await storage.save('test-user', makeRoutine('b'));

      let list = await storage.list('test-user');
      expect(list).toHaveLength(2);

      await storage.delete('test-user', 'a');
      list = await storage.list('test-user');
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('b');
    });

    it('should update index on overwrite', async () => {
      await storage.save('test-user', makeRoutine('a', { description: 'old' }));
      await storage.save('test-user', makeRoutine('a', { description: 'new' }));

      const list = await storage.list('test-user');
      expect(list).toHaveLength(1);
      expect(list[0].description).toBe('new');
    });

    it('should rebuild index if missing', async () => {
      await storage.save('test-user', makeRoutine('r1'));
      await storage.save('test-user', makeRoutine('r2'));

      // Delete the index file
      const indexPath = join(testDir, 'test-user', 'routines', '_index.json');
      await fs.unlink(indexPath);

      // List should still work (rebuilds index)
      const list = await storage.list('test-user');
      expect(list).toHaveLength(2);
    });
  });

  describe('atomic writes', () => {
    it('should not leave .tmp files after successful save', async () => {
      await storage.save('test-user', makeRoutine('atomic-test'));

      const userDir = join(testDir, 'test-user', 'routines');
      const files = await fs.readdir(userDir);
      const tmpFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe('getPath', () => {
    it('should return the user-specific routines directory', () => {
      const path = storage.getPath('test-user');
      expect(path).toBe(join(testDir, 'test-user', 'routines'));
    });
  });

  describe('default userId', () => {
    it('should use default user when userId is undefined', async () => {
      await storage.save(undefined, makeRoutine('default-routine'));

      const loaded = await storage.load(undefined, 'default-routine');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('default-routine');

      const path = storage.getPath(undefined);
      expect(path).toContain('default');
    });
  });

  describe('multi-user isolation', () => {
    it('should isolate routines between users', async () => {
      await storage.save('alice', makeRoutine('alice-routine'));
      await storage.save('bob', makeRoutine('bob-routine'));

      // Alice should only see her routines
      const aliceRoutines = await storage.list('alice');
      expect(aliceRoutines).toHaveLength(1);
      expect(aliceRoutines[0].id).toBe('alice-routine');

      // Bob should only see his routines
      const bobRoutines = await storage.list('bob');
      expect(bobRoutines).toHaveLength(1);
      expect(bobRoutines[0].id).toBe('bob-routine');

      // Cross-user load returns null
      expect(await storage.load('alice', 'bob-routine')).toBeNull();
      expect(await storage.load('bob', 'alice-routine')).toBeNull();
    });

    it('should allow same routine id for different users', async () => {
      await storage.save('alice', makeRoutine('shared', { description: 'Alice version' }));
      await storage.save('bob', makeRoutine('shared', { description: 'Bob version' }));

      const aliceRoutine = await storage.load('alice', 'shared');
      const bobRoutine = await storage.load('bob', 'shared');

      expect(aliceRoutine!.description).toBe('Alice version');
      expect(bobRoutine!.description).toBe('Bob version');
    });

    it('should not affect other users when deleting', async () => {
      await storage.save('alice', makeRoutine('routine-a'));
      await storage.save('bob', makeRoutine('routine-a'));

      await storage.delete('alice', 'routine-a');

      expect(await storage.exists('alice', 'routine-a')).toBe(false);
      expect(await storage.exists('bob', 'routine-a')).toBe(true);
    });
  });
});
