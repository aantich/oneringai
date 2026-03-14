/**
 * PersistentInstructionsPluginNextGen Unit Tests
 *
 * Tests for the NextGen persistent instructions plugin covering:
 * - Core KVP operations (set, remove, get, list, clear)
 * - Key validation
 * - Maximum entries/length enforcement
 * - Lazy initialization
 * - Non-compactable behavior
 * - Serialization/deserialization (new + legacy)
 * - Content rendering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersistentInstructionsPluginNextGen } from '@/core/context-nextgen/plugins/PersistentInstructionsPluginNextGen.js';
import type { PersistentInstructionsConfig } from '@/core/context-nextgen/plugins/PersistentInstructionsPluginNextGen.js';
import type { IPersistentInstructionsStorage, InstructionEntry } from '@/domain/interfaces/IPersistentInstructionsStorage.js';

/**
 * Create a mock storage implementation for testing
 */
function createMockStorage(): IPersistentInstructionsStorage & { _entries: InstructionEntry[] | null } {
  return {
    _entries: null,
    async load(): Promise<InstructionEntry[] | null> {
      return this._entries;
    },
    async save(entries: InstructionEntry[]): Promise<void> {
      this._entries = entries;
    },
    async delete(): Promise<void> {
      this._entries = null;
    },
    async exists(): Promise<boolean> {
      return this._entries !== null;
    },
    getPath(): string {
      return '/mock/path/custom_instructions.json';
    },
  };
}

describe('PersistentInstructionsPluginNextGen', () => {
  let plugin: PersistentInstructionsPluginNextGen;
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    plugin = new PersistentInstructionsPluginNextGen({
      agentId: 'test-agent',
      storage: mockStorage,
    });
  });

  afterEach(() => {
    plugin.destroy();
  });

  describe('Plugin Interface', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('persistent_instructions');
    });

    it('should provide instructions', () => {
      const instructions = plugin.getInstructions();
      expect(instructions).toContain('Persistent Instructions');
      expect(instructions).toContain('store_set');
      expect(instructions).toContain('store_delete');
      expect(instructions).toContain('store: "instructions"');
    });

    it('should NOT be compactable', () => {
      expect(plugin.isCompactable()).toBe(false);
    });

    it('should return 0 tokens freed on compact', async () => {
      await plugin.set('style', 'Some content');
      const freed = await plugin.compact(1000);
      expect(freed).toBe(0);
    });

    it('should return no tools (store handler provides operations instead)', () => {
      const tools = plugin.getTools();
      expect(tools).toHaveLength(0);
    });

    it('should require agentId', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid config
        new PersistentInstructionsPluginNextGen({});
      }).toThrow('requires agentId');
    });
  });

  describe('Set Operation', () => {
    it('should add a new entry by key', async () => {
      const success = await plugin.set('style', 'Be formal and concise');
      expect(success).toBe(true);

      const entry = await plugin.get('style');
      expect(entry).not.toBeNull();
      expect((entry as InstructionEntry).content).toBe('Be formal and concise');
      expect((entry as InstructionEntry).id).toBe('style');
    });

    it('should update an existing entry', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('style', 'Be casual');

      const entry = await plugin.get('style') as InstructionEntry;
      expect(entry.content).toBe('Be casual');
    });

    it('should preserve createdAt on update', async () => {
      await plugin.set('style', 'Be formal');
      const original = await plugin.get('style') as InstructionEntry;

      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));
      await plugin.set('style', 'Be casual');

      const updated = await plugin.get('style') as InstructionEntry;
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);
    });

    it('should trim content', async () => {
      await plugin.set('style', '  Trimmed content  ');

      const entry = await plugin.get('style') as InstructionEntry;
      expect(entry.content).toBe('Trimmed content');
    });

    it('should reject empty content', async () => {
      const success = await plugin.set('style', '   ');
      expect(success).toBe(false);
    });

    it('should persist to storage', async () => {
      await plugin.set('style', 'Persisted content');

      expect(mockStorage._entries).not.toBeNull();
      expect(mockStorage._entries!.length).toBe(1);
      expect(mockStorage._entries![0].id).toBe('style');
      expect(mockStorage._entries![0].content).toBe('Persisted content');
    });

    it('should add multiple entries', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');

      const all = await plugin.get() as InstructionEntry[];
      expect(all).toHaveLength(2);
    });
  });

  describe('Key Validation', () => {
    it('should accept valid alphanumeric keys', async () => {
      expect(await plugin.set('style', 'content')).toBe(true);
      expect(await plugin.set('code_rules', 'content')).toBe(true);
      expect(await plugin.set('my-key', 'content')).toBe(true);
      expect(await plugin.set('KEY123', 'content')).toBe(true);
    });

    it('should reject empty key', async () => {
      expect(await plugin.set('', 'content')).toBe(false);
      expect(await plugin.set('   ', 'content')).toBe(false);
    });

    it('should reject keys with invalid characters', async () => {
      expect(await plugin.set('key with spaces', 'content')).toBe(false);
      expect(await plugin.set('key.dot', 'content')).toBe(false);
      expect(await plugin.set('key/slash', 'content')).toBe(false);
    });

    it('should reject keys exceeding max length', async () => {
      const longKey = 'a'.repeat(101);
      expect(await plugin.set(longKey, 'content')).toBe(false);
    });

    it('should accept key at exactly max length', async () => {
      const maxKey = 'a'.repeat(100);
      expect(await plugin.set(maxKey, 'content')).toBe(true);
    });
  });

  describe('Remove Operation', () => {
    it('should remove an existing entry', async () => {
      await plugin.set('style', 'Be formal');
      const success = await plugin.remove('style');
      expect(success).toBe(true);

      const entry = await plugin.get('style');
      expect(entry).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const success = await plugin.remove('nonexistent');
      expect(success).toBe(false);
    });

    it('should delete storage when last entry removed', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.remove('style');

      expect(mockStorage._entries).toBeNull();
    });

    it('should persist remaining entries when not last', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');
      await plugin.remove('style');

      expect(mockStorage._entries).not.toBeNull();
      expect(mockStorage._entries!.length).toBe(1);
      expect(mockStorage._entries![0].id).toBe('code');
    });
  });

  describe('Get Operation', () => {
    it('should return null for non-existent key', async () => {
      const entry = await plugin.get('nonexistent');
      expect(entry).toBeNull();
    });

    it('should return null when no entries (no key)', async () => {
      const entries = await plugin.get();
      expect(entries).toBeNull();
    });

    it('should return single entry by key', async () => {
      await plugin.set('style', 'Be formal');

      const entry = await plugin.get('style') as InstructionEntry;
      expect(entry.id).toBe('style');
      expect(entry.content).toBe('Be formal');
    });

    it('should return all entries sorted by createdAt when no key', async () => {
      await plugin.set('style', 'Be formal');
      await new Promise(r => setTimeout(r, 5));
      await plugin.set('code', 'Use TypeScript');

      const all = await plugin.get() as InstructionEntry[];
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe('style');
      expect(all[1].id).toBe('code');
    });
  });

  describe('List Operation', () => {
    it('should return empty array when no entries', async () => {
      const entries = await plugin.list();
      expect(entries).toEqual([]);
    });

    it('should return metadata for all entries', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');

      const entries = await plugin.list();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toHaveProperty('key');
      expect(entries[0]).toHaveProperty('contentLength');
      expect(entries[0]).toHaveProperty('createdAt');
      expect(entries[0]).toHaveProperty('updatedAt');
    });
  });

  describe('Clear Operation', () => {
    it('should clear all entries', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');
      await plugin.clear();

      const entries = await plugin.get();
      expect(entries).toBeNull();
    });

    it('should delete from storage', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.clear();

      expect(mockStorage._entries).toBeNull();
    });
  });

  describe('Limits', () => {
    it('should enforce maxEntries', async () => {
      const limitedPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: mockStorage,
        maxEntries: 3,
      });

      expect(await limitedPlugin.set('a', 'content')).toBe(true);
      expect(await limitedPlugin.set('b', 'content')).toBe(true);
      expect(await limitedPlugin.set('c', 'content')).toBe(true);
      expect(await limitedPlugin.set('d', 'content')).toBe(false); // Over limit

      // Update existing should still work
      expect(await limitedPlugin.set('a', 'updated')).toBe(true);

      limitedPlugin.destroy();
    });

    it('should enforce maxTotalLength', async () => {
      const limitedPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: mockStorage,
        maxTotalLength: 100,
      });

      expect(await limitedPlugin.set('a', 'x'.repeat(50))).toBe(true);
      expect(await limitedPlugin.set('b', 'x'.repeat(60))).toBe(false); // Would exceed 100

      limitedPlugin.destroy();
    });

    it('should account for existing entry length when updating', async () => {
      const limitedPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: mockStorage,
        maxTotalLength: 100,
      });

      expect(await limitedPlugin.set('a', 'x'.repeat(80))).toBe(true);
      // Replacing 80 chars with 90 chars should work (still under 100)
      expect(await limitedPlugin.set('a', 'x'.repeat(90))).toBe(true);

      limitedPlugin.destroy();
    });
  });

  describe('Lazy Initialization', () => {
    it('should initialize from storage on first access', async () => {
      const now = Date.now();
      mockStorage._entries = [
        { id: 'style', content: 'Preloaded', createdAt: now, updatedAt: now },
      ];

      const newPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: mockStorage,
      });

      expect(newPlugin.isInitialized).toBe(false);

      const entry = await newPlugin.get('style') as InstructionEntry;
      expect(entry.content).toBe('Preloaded');
      expect(newPlugin.isInitialized).toBe(true);

      newPlugin.destroy();
    });

    it('should handle storage errors gracefully', async () => {
      const errorStorage: IPersistentInstructionsStorage = {
        async load(): Promise<InstructionEntry[] | null> {
          throw new Error('Storage error');
        },
        async save(): Promise<void> {},
        async delete(): Promise<void> {},
        async exists(): Promise<boolean> {
          return false;
        },
        getPath(): string {
          return '/mock/path';
        },
      };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const errorPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: errorStorage,
      });

      const entries = await errorPlugin.get();
      expect(entries).toBeNull();

      consoleSpy.mockRestore();
      errorPlugin.destroy();
    });
  });

  describe('Content Rendering', () => {
    it('should return null when no entries', async () => {
      const content = await plugin.getContent();
      expect(content).toBeNull();
    });

    it('should render entries as markdown sections', async () => {
      await plugin.set('style', 'Be formal');
      await new Promise(r => setTimeout(r, 5));
      await plugin.set('code', 'Use TypeScript');

      const content = await plugin.getContent();
      expect(content).toContain('### style');
      expect(content).toContain('Be formal');
      expect(content).toContain('### code');
      expect(content).toContain('Use TypeScript');
    });

    it('should track token size', async () => {
      expect(plugin.getTokenSize()).toBe(0);

      await plugin.set('style', 'Some instructions content here');
      await plugin.getContent(); // Triggers token calculation

      expect(plugin.getTokenSize()).toBeGreaterThan(0);
    });
  });

  describe('getContents', () => {
    it('should return empty map when no entries', () => {
      const contents = plugin.getContents();
      expect(contents).toBeInstanceOf(Map);
      expect(contents.size).toBe(0);
    });

    it('should return map of entries', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');

      const contents = plugin.getContents();
      expect(contents.size).toBe(2);
      expect(contents.get('style')!.content).toBe('Be formal');
      expect(contents.get('code')!.content).toBe('Use TypeScript');
    });
  });

  describe('Serialization', () => {
    it('should serialize state with version 2', async () => {
      await plugin.set('style', 'Be formal');

      const state = plugin.getState();

      expect(state.version).toBe(2);
      expect(state.agentId).toBe('test-agent');
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].id).toBe('style');
      expect(state.entries[0].content).toBe('Be formal');
    });

    it('should serialize empty state', async () => {
      const state = plugin.getState();
      expect(state.entries).toEqual([]);
      expect(state.version).toBe(2);
    });

    it('should restore state from new format', async () => {
      const now = Date.now();
      const state = {
        entries: [
          { id: 'style', content: 'Restored', createdAt: now, updatedAt: now },
        ],
        agentId: 'test-agent',
        version: 2,
      };

      plugin.restoreState(state);

      const entry = await plugin.get('style') as InstructionEntry;
      expect(entry.content).toBe('Restored');
      expect(plugin.isInitialized).toBe(true);
    });

    it('should restore state from legacy format', async () => {
      const legacyState = {
        content: 'Legacy instructions content',
        agentId: 'test-agent',
      };

      plugin.restoreState(legacyState);

      const entry = await plugin.get('legacy_instructions') as InstructionEntry;
      expect(entry.content).toBe('Legacy instructions content');
      expect(plugin.isInitialized).toBe(true);
    });

    it('should restore null content from legacy format', async () => {
      const legacyState = {
        content: null,
        agentId: 'test-agent',
      };

      plugin.restoreState(legacyState);

      const entries = await plugin.get();
      expect(entries).toBeNull();
    });

    it('should handle invalid state gracefully', () => {
      plugin.restoreState(null);
      plugin.restoreState(undefined);
      plugin.restoreState('invalid');
      // Should not throw
    });
  });

  describe('Lifecycle', () => {
    it('should throw when destroyed', async () => {
      plugin.destroy();

      await expect(plugin.set('key', 'content')).rejects.toThrow('destroyed');
      await expect(plugin.get()).rejects.toThrow('destroyed');
      await expect(plugin.remove('key')).rejects.toThrow('destroyed');
      await expect(plugin.list()).rejects.toThrow('destroyed');
      await expect(plugin.clear()).rejects.toThrow('destroyed');
    });
  });

  describe('IStoreHandler Execution', () => {
    it('should execute storeSet', async () => {
      const result = await plugin.storeSet('style', { content: 'Be formal' });

      expect(result.success).toBe(true);
      expect(result.key).toBe('style');

      const entry = await plugin.get('style') as InstructionEntry;
      expect(entry.content).toBe('Be formal');
    });

    it('should reject empty content in storeSet', async () => {
      const result = await plugin.storeSet('style', { content: '' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('empty');
    });

    it('should reject non-string content in storeSet', async () => {
      const result = await plugin.storeSet('style', { content: 123 as unknown });
      expect(result.success).toBe(false);
      expect(result.message).toContain('string');
    });

    it('should reject invalid key in storeSet', async () => {
      const result = await plugin.storeSet('key with spaces', { content: 'value' });
      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('should report update vs add in storeSet', async () => {
      const addResult = await plugin.storeSet('style', { content: 'Be formal' });
      expect(addResult.message).toContain('added');

      const updateResult = await plugin.storeSet('style', { content: 'Be casual' });
      expect(updateResult.message).toContain('updated');
    });

    it('should execute storeDelete', async () => {
      await plugin.set('style', 'Be formal');

      const result = await plugin.storeDelete('style');
      expect(result.deleted).toBe(true);
      expect(result.key).toBe('style');

      const entry = await plugin.get('style');
      expect(entry).toBeNull();
    });

    it('should return deleted=false for non-existent key in storeDelete', async () => {
      const result = await plugin.storeDelete('nonexistent');
      expect(result.deleted).toBe(false);
      expect(result.key).toBe('nonexistent');
    });

    it('should execute storeList', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');

      const result = await plugin.storeList();

      expect(result.total).toBe(2);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].key).toBeDefined();
      expect(result.entries[0].contentLength).toBeDefined();
    });

    it('should handle empty storeList', async () => {
      const result = await plugin.storeList();
      expect(result.total).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it('should execute storeGet by key', async () => {
      await plugin.set('style', 'Be formal');

      const result = await plugin.storeGet('style');
      expect(result.found).toBe(true);
      expect(result.key).toBe('style');
      expect(result.entry).toBeDefined();
      expect(result.entry!.content).toBe('Be formal');
    });

    it('should return found=false for non-existent key in storeGet', async () => {
      const result = await plugin.storeGet('nonexistent');
      expect(result.found).toBe(false);
      expect(result.key).toBe('nonexistent');
    });

    it('should execute storeGet without key (all entries)', async () => {
      await plugin.set('style', 'Be formal');
      await plugin.set('code', 'Use TypeScript');

      const result = await plugin.storeGet();
      expect(result.found).toBe(true);
      expect(result.entries).toHaveLength(2);
    });

    it('should execute storeAction clear with confirmation', async () => {
      await plugin.set('style', 'Be formal');

      // Without confirmation
      const failResult = await plugin.storeAction('clear', { confirm: false });
      expect(failResult.success).toBe(false);
      expect(failResult.action).toBe('clear');
      expect(failResult.message).toContain('confirm');

      // With confirmation
      const successResult = await plugin.storeAction('clear', { confirm: true });
      expect(successResult.success).toBe(true);
      expect(successResult.action).toBe('clear');

      const entries = await plugin.get();
      expect(entries).toBeNull();
    });

    it('should reject unknown storeAction', async () => {
      const result = await plugin.storeAction('unknown_action');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown action');
    });
  });

  describe('Custom Configuration', () => {
    it('should use custom maxTotalLength', async () => {
      const customPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: mockStorage,
        maxTotalLength: 100,
      });

      const longContent = 'x'.repeat(150);
      const success = await customPlugin.set('key', longContent);
      expect(success).toBe(false);

      const shortContent = 'x'.repeat(50);
      const successShort = await customPlugin.set('key', shortContent);
      expect(successShort).toBe(true);

      customPlugin.destroy();
    });

    it('should use custom maxEntries', async () => {
      const customPlugin = new PersistentInstructionsPluginNextGen({
        agentId: 'test-agent',
        storage: mockStorage,
        maxEntries: 2,
      });

      expect(await customPlugin.set('a', 'content')).toBe(true);
      expect(await customPlugin.set('b', 'content')).toBe(true);
      expect(await customPlugin.set('c', 'content')).toBe(false);

      customPlugin.destroy();
    });
  });
});
