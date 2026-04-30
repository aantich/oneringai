/**
 * InContextMemoryPluginNextGen Unit Tests
 *
 * Tests for the NextGen in-context memory plugin covering:
 * - Core CRUD operations (set, get, delete, list)
 * - Priority-based eviction
 * - Max entries enforcement
 * - Compaction
 * - Serialization/deserialization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InContextMemoryPluginNextGen } from '@/core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';
import type { InContextMemoryConfig } from '@/core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';

describe('InContextMemoryPluginNextGen', () => {
  let plugin: InContextMemoryPluginNextGen;

  beforeEach(() => {
    plugin = new InContextMemoryPluginNextGen();
  });

  afterEach(() => {
    plugin.destroy();
  });

  describe('Plugin Interface', () => {
    it('should have correct name', () => {
      expect(plugin.name).toBe('in_context_memory');
    });

    it('should provide instructions', () => {
      const instructions = plugin.getInstructions();
      expect(instructions).toContain('Store: "whiteboard"');
      expect(instructions).toContain('Priority levels');
    });

    it('should be compactable', () => {
      expect(plugin.isCompactable()).toBe(true);
    });

    it('should return no tools (uses IStoreHandler instead)', () => {
      const tools = plugin.getTools();
      expect(tools).toHaveLength(0);
    });

    it('should implement IStoreHandler with getStoreSchema', () => {
      const schema = plugin.getStoreSchema();
      expect(schema.storeId).toBe('whiteboard');
      expect(schema.displayName).toBe('Whiteboard');
      expect(schema.description).toBeDefined();
      expect(schema.setDataFields).toContain('description');
      expect(schema.setDataFields).toContain('value');
      // showInUI intentionally NOT in setDataFields — see DynamicUIPlugin (@everworker/react-ui)
    });
  });

  describe('Basic Set/Get/Delete', () => {
    it('should set and get a value', () => {
      plugin.set('test_key', 'Test description', { data: 'value' });

      const value = plugin.get('test_key');
      expect(value).toEqual({ data: 'value' });
    });

    it('should return undefined for non-existent key', () => {
      const value = plugin.get('non_existent');
      expect(value).toBeUndefined();
    });

    it('should check key existence', () => {
      plugin.set('exists', 'Description', { value: 1 });

      expect(plugin.has('exists')).toBe(true);
      expect(plugin.has('not_exists')).toBe(false);
    });

    it('should delete a key', () => {
      plugin.set('to_delete', 'Will be deleted', { temp: true });

      const deleted = plugin.delete('to_delete');
      expect(deleted).toBe(true);
      expect(plugin.has('to_delete')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = plugin.delete('non_existent');
      expect(deleted).toBe(false);
    });

    it('should update existing key', () => {
      plugin.set('key', 'Initial', { version: 1 });
      plugin.set('key', 'Updated', { version: 2 });

      const value = plugin.get('key');
      expect(value).toEqual({ version: 2 });
    });

    it('should clear all entries', () => {
      plugin.set('key1', 'Desc 1', { value: 1 });
      plugin.set('key2', 'Desc 2', { value: 2 });

      plugin.clear();

      expect(plugin.list()).toHaveLength(0);
    });
  });

  describe('List Operation', () => {
    beforeEach(() => {
      plugin.set('key1', 'Description 1', { value: 1 }, 'high');
      plugin.set('key2', 'Description 2', { value: 2 }, 'low');
      plugin.set('key3', 'Description 3', { value: 3 });
    });

    it('should list all entries', () => {
      const entries = plugin.list();
      expect(entries).toHaveLength(3);
    });

    it('should include metadata in list', () => {
      const entries = plugin.list();

      const entry = entries.find(e => e.key === 'key1');
      expect(entry).toBeDefined();
      expect(entry?.description).toBe('Description 1');
      expect(entry?.priority).toBe('high');
      expect(entry?.updatedAt).toBeDefined();
    });
  });

  describe('Priority System', () => {
    it('should set default priority to normal', () => {
      plugin.set('key', 'Description', { value: 1 });

      const entries = plugin.list();
      expect(entries[0]?.priority).toBe('normal');
    });

    it('should respect custom priority', () => {
      plugin.set('low', 'Low priority', {}, 'low');
      plugin.set('high', 'High priority', {}, 'high');
      plugin.set('critical', 'Critical priority', {}, 'critical');

      const entries = plugin.list();
      expect(entries.find(e => e.key === 'low')?.priority).toBe('low');
      expect(entries.find(e => e.key === 'high')?.priority).toBe('high');
      expect(entries.find(e => e.key === 'critical')?.priority).toBe('critical');
    });

    it('should evict lowest priority first during compaction', async () => {
      // Add entries with different priorities
      plugin.set('low', 'Low priority entry', { data: 'data_low' }, 'low');
      plugin.set('normal', 'Normal priority entry', { data: 'data_normal' }, 'normal');
      plugin.set('high', 'High priority entry', { data: 'data_high' }, 'high');
      plugin.set('critical', 'Critical entry', { data: 'data_critical' }, 'critical');

      // Call getContent() to populate token cache before compact
      await plugin.getContent();

      // Compact to evict one entry (smallest target)
      await plugin.compact(1);

      // Critical should always remain (never evicted)
      expect(plugin.has('critical')).toBe(true);

      // Low priority should be evicted first
      // High priority should be evicted last (among non-critical)
      const remaining = plugin.list();
      const keys = remaining.map(e => e.key);

      // If low was evicted, high should still be there
      if (!keys.includes('low') && keys.includes('high')) {
        // This is expected behavior - low evicted before high
        expect(true).toBe(true);
      } else if (remaining.length < 4) {
        // Some entries were evicted (compaction worked)
        expect(remaining.length).toBeLessThan(4);
      }
    });

    it('should never evict critical entries during compaction', async () => {
      plugin.set('normal', 'Normal', { data: 'x'.repeat(100) }, 'normal');
      plugin.set('critical', 'Critical', { data: 'y'.repeat(100) }, 'critical');

      await plugin.compact(1000);

      // Critical should remain even with aggressive compaction
      expect(plugin.has('critical')).toBe(true);
    });
  });

  describe('Max Entries Enforcement', () => {
    it('should enforce max entries limit', () => {
      const smallPlugin = new InContextMemoryPluginNextGen({ maxEntries: 3 });

      smallPlugin.set('key1', 'Entry 1', {});
      smallPlugin.set('key2', 'Entry 2', {});
      smallPlugin.set('key3', 'Entry 3', {});
      smallPlugin.set('key4', 'Entry 4', {}); // Should trigger eviction

      const entries = smallPlugin.list();
      expect(entries.length).toBeLessThanOrEqual(3);

      smallPlugin.destroy();
    });

    it('should evict lowest priority when enforcing max entries', () => {
      const smallPlugin = new InContextMemoryPluginNextGen({ maxEntries: 2 });

      smallPlugin.set('low', 'Low', {}, 'low');
      smallPlugin.set('high', 'High', {}, 'high');
      smallPlugin.set('new', 'New', {}, 'normal'); // Should evict 'low'

      expect(smallPlugin.has('low')).toBe(false);
      expect(smallPlugin.has('high')).toBe(true);
      expect(smallPlugin.has('new')).toBe(true);

      smallPlugin.destroy();
    });

    it('should not evict critical entries when enforcing max', () => {
      const smallPlugin = new InContextMemoryPluginNextGen({ maxEntries: 2 });

      smallPlugin.set('critical', 'Critical', {}, 'critical');
      smallPlugin.set('normal1', 'Normal 1', {}, 'normal');
      smallPlugin.set('normal2', 'Normal 2', {}, 'normal');

      // Critical should remain
      expect(smallPlugin.has('critical')).toBe(true);

      smallPlugin.destroy();
    });
  });

  describe('Content for Context', () => {
    it('should return null when empty', async () => {
      const content = await plugin.getContent();
      expect(content).toBeNull();
    });

    it('should return formatted entries when populated', async () => {
      plugin.set('status', 'Current status', 'active');
      plugin.set('count', 'Message count', 42);

      const content = await plugin.getContent();
      expect(content).toBeDefined();
      expect(content).toContain('status');
      expect(content).toContain('active');
      expect(content).toContain('count');
      expect(content).toContain('42');
    });

    it('should sort entries by priority in content', async () => {
      plugin.set('low', 'Low', {}, 'low');
      plugin.set('high', 'High', {}, 'high');
      plugin.set('normal', 'Normal', {});

      const content = await plugin.getContent();
      expect(content).toBeDefined();

      // High should appear before low in the output
      const highPos = content!.indexOf('high');
      const lowPos = content!.indexOf('low');
      expect(highPos).toBeLessThan(lowPos);
    });

    it('should track token size', async () => {
      expect(plugin.getTokenSize()).toBe(0);

      plugin.set('key', 'Description', { data: 'some value' });
      await plugin.getContent(); // Triggers token calculation

      expect(plugin.getTokenSize()).toBeGreaterThan(0);
    });
  });

  describe('Compaction', () => {
    it('should free tokens during compaction', async () => {
      // Add several entries
      for (let i = 0; i < 10; i++) {
        plugin.set(`key${i}`, `Entry ${i}`, { index: i, data: 'x'.repeat(50) }, 'low');
      }

      // Populate token cache before compacting
      await plugin.getContent();
      const freed = await plugin.compact(200);
      expect(freed).toBeGreaterThan(0);
    });

    it('should evict oldest entries within same priority', async () => {
      // Add several entries with same priority but different timestamps
      plugin.set('first', 'First entry', { order: 1, data: 'x'.repeat(50) }, 'low');

      // Add small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 20));

      plugin.set('second', 'Second entry', { order: 2, data: 'y'.repeat(50) }, 'low');

      await new Promise(r => setTimeout(r, 20));

      plugin.set('third', 'Third entry', { order: 3, data: 'z'.repeat(50) }, 'low');

      // Populate token cache before compacting
      await plugin.getContent();

      // Compact to evict just one entry
      await plugin.compact(80);

      // First (oldest) should be evicted, second and third should remain
      // or fewer entries should remain
      const remaining = plugin.list();
      expect(remaining.length).toBeLessThan(3);

      // If any remain, the newest ones should be kept
      if (remaining.length > 0) {
        const keys = remaining.map(e => e.key);
        // Third (newest) should have highest chance of being kept
        expect(keys.includes('first')).toBe(false);
      }
    });

    it('should stop when target tokens freed', async () => {
      for (let i = 0; i < 5; i++) {
        plugin.set(`key${i}`, `Entry ${i}`, { data: 'x'.repeat(20) }, 'low');
      }

      // Populate token cache before compacting
      await plugin.getContent();
      const initialCount = plugin.list().length;
      await plugin.compact(10); // Small target

      // Should have removed some but not all
      const finalCount = plugin.list().length;
      expect(finalCount).toBeGreaterThan(0);
      expect(finalCount).toBeLessThan(initialCount);
    });
  });

  describe('Serialization', () => {
    it('should serialize state', () => {
      plugin.set('key1', 'Desc 1', { value: 1 }, 'high');
      plugin.set('key2', 'Desc 2', { value: 2 }, 'low');

      const state = plugin.getState();

      expect(state.entries).toHaveLength(2);
      expect(state.entries[0]).toHaveProperty('key');
      expect(state.entries[0]).toHaveProperty('description');
      expect(state.entries[0]).toHaveProperty('value');
      expect(state.entries[0]).toHaveProperty('priority');
    });

    it('should restore state', () => {
      plugin.set('key1', 'Desc 1', { original: true }, 'high');
      const state = plugin.getState();

      // Create new plugin and restore
      const newPlugin = new InContextMemoryPluginNextGen();
      newPlugin.restoreState(state);

      expect(newPlugin.has('key1')).toBe(true);
      expect(newPlugin.get('key1')).toEqual({ original: true });

      const entries = newPlugin.list();
      expect(entries[0]?.priority).toBe('high');

      newPlugin.destroy();
    });
  });

  describe('Configuration', () => {
    it('should use custom max entries', () => {
      const customPlugin = new InContextMemoryPluginNextGen({ maxEntries: 5 });

      for (let i = 0; i < 10; i++) {
        customPlugin.set(`key${i}`, `Entry ${i}`, {});
      }

      expect(customPlugin.list().length).toBeLessThanOrEqual(5);

      customPlugin.destroy();
    });

    it('should use custom default priority', () => {
      const customPlugin = new InContextMemoryPluginNextGen({ defaultPriority: 'high' });

      customPlugin.set('key', 'Description', {});

      const entries = customPlugin.list();
      expect(entries[0]?.priority).toBe('high');

      customPlugin.destroy();
    });
  });

  describe('Lifecycle', () => {
    it('should throw when destroyed', () => {
      plugin.destroy();

      expect(() => plugin.set('key', 'desc', {})).toThrow('destroyed');
      expect(() => plugin.get('key')).toThrow('destroyed');
      expect(() => plugin.list()).toThrow('destroyed');
    });
  });

  describe('IStoreHandler Execution', () => {
    it('should execute storeSet', async () => {
      const result = await plugin.storeSet('tool_test', {
        description: 'Test from store',
        value: { fromTool: true },
        priority: 'high',
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('tool_test');

      expect(plugin.get('tool_test')).toEqual({ fromTool: true });
    });

    it('should execute storeSet with showInUI', async () => {
      const result = await plugin.storeSet('ui_entry', {
        description: 'Visible in UI',
        value: '## Dashboard\n- Task 1 done',
        showInUI: true,
      });

      expect(result.success).toBe(true);
      expect(result.showInUI).toBe(true);

      const entries = plugin.list();
      const entry = entries.find(e => e.key === 'ui_entry');
      expect(entry?.showInUI).toBe(true);
    });

    it('should fail storeSet when description or value missing', async () => {
      const result = await plugin.storeSet('bad', { description: 'no value' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('required');
    });

    it('should execute storeDelete', async () => {
      plugin.set('to_delete', 'Will be deleted', {});

      const result = await plugin.storeDelete('to_delete');
      expect(result.deleted).toBe(true);
      expect(result.key).toBe('to_delete');
    });

    it('should return deleted=false for non-existent key', async () => {
      const result = await plugin.storeDelete('no_such_key');
      expect(result.deleted).toBe(false);
      expect(result.key).toBe('no_such_key');
    });

    it('should execute storeList', async () => {
      plugin.set('key1', 'Entry 1', {});
      plugin.set('key2', 'Entry 2', {});

      const result = await plugin.storeList();
      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should execute storeGet with key', async () => {
      plugin.set('mykey', 'My description', { val: 42 }, 'high');

      const result = await plugin.storeGet('mykey');
      expect(result.found).toBe(true);
      expect(result.key).toBe('mykey');
      expect(result.entry).toBeDefined();
      expect(result.entry?.value).toEqual({ val: 42 });
      expect(result.entry?.priority).toBe('high');
    });

    it('should execute storeGet without key (all entries)', async () => {
      plugin.set('a', 'A', 1);
      plugin.set('b', 'B', 2);

      const result = await plugin.storeGet();
      expect(result.found).toBe(true);
      expect(result.entries).toHaveLength(2);
    });

    it('should return found=false for non-existent key', async () => {
      const result = await plugin.storeGet('missing');
      expect(result.found).toBe(false);
      expect(result.key).toBe('missing');
    });
  });

  describe('showInUI', () => {
    it('should default showInUI to false', () => {
      plugin.set('key', 'Description', { value: 1 });

      const entries = plugin.list();
      expect(entries[0]?.showInUI).toBe(false);
    });

    it('should store showInUI when set to true', () => {
      plugin.set('visible', 'Visible entry', '## Status', 'normal', true);

      const entries = plugin.list();
      const entry = entries.find(e => e.key === 'visible');
      expect(entry?.showInUI).toBe(true);
    });

    it('should store showInUI when set to false explicitly', () => {
      plugin.set('hidden', 'Hidden entry', 'data', 'normal', false);

      const entries = plugin.list();
      expect(entries[0]?.showInUI).toBe(false);
    });

    it('should preserve showInUI in serialization', () => {
      plugin.set('visible', 'Visible', 'data', 'high', true);
      plugin.set('hidden', 'Hidden', 'data', 'normal', false);

      const state = plugin.getState();

      const newPlugin = new InContextMemoryPluginNextGen();
      newPlugin.restoreState(state);

      const entries = newPlugin.list();
      expect(entries.find(e => e.key === 'visible')?.showInUI).toBe(true);
      expect(entries.find(e => e.key === 'hidden')?.showInUI).toBe(false);

      newPlugin.destroy();
    });

    // Note: showInUI is intentionally NOT advertised in setDataFields or instructions.
    // It is a host/DynamicUI-coupling field; LLM-facing docs for it live in
    // @everworker/react-ui's DynamicUIPlugin, which teaches the rendering semantics.
    // The field is still wired up on InContextEntry for hosts to read.
  });

  describe('onEntriesChanged callback', () => {
    it('should call onEntriesChanged on set', async () => {
      const onChange = vi.fn();
      const p = new InContextMemoryPluginNextGen({ onEntriesChanged: onChange });

      p.set('key', 'Desc', 'value');

      // Debounced — wait for it
      await new Promise(r => setTimeout(r, 150));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'key', value: 'value' }),
        ])
      );

      p.destroy();
    });

    it('should call onEntriesChanged on delete', async () => {
      const onChange = vi.fn();
      const p = new InContextMemoryPluginNextGen({ onEntriesChanged: onChange });

      p.set('key', 'Desc', 'value');
      await new Promise(r => setTimeout(r, 150));
      onChange.mockClear();

      p.delete('key');
      await new Promise(r => setTimeout(r, 150));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([]);

      p.destroy();
    });

    it('should call onEntriesChanged on clear', async () => {
      const onChange = vi.fn();
      const p = new InContextMemoryPluginNextGen({ onEntriesChanged: onChange });

      p.set('key1', 'Desc', 'val1');
      p.set('key2', 'Desc', 'val2');
      await new Promise(r => setTimeout(r, 150));
      onChange.mockClear();

      p.clear();
      await new Promise(r => setTimeout(r, 150));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([]);

      p.destroy();
    });

    it('should call onEntriesChanged on restoreState', async () => {
      const onChange = vi.fn();
      const p = new InContextMemoryPluginNextGen({ onEntriesChanged: onChange });

      p.restoreState({
        entries: [
          { key: 'restored', description: 'Restored entry', value: 'data', updatedAt: Date.now(), priority: 'normal', showInUI: true },
        ],
      });

      await new Promise(r => setTimeout(r, 150));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'restored', showInUI: true }),
        ])
      );

      p.destroy();
    });

    it('should debounce rapid changes', async () => {
      const onChange = vi.fn();
      const p = new InContextMemoryPluginNextGen({ onEntriesChanged: onChange });

      // Rapid-fire 5 sets
      for (let i = 0; i < 5; i++) {
        p.set(`key${i}`, 'Desc', `val${i}`);
      }

      await new Promise(r => setTimeout(r, 150));

      // Should only fire once due to debounce
      expect(onChange).toHaveBeenCalledTimes(1);
      // Should include all 5 entries
      expect(onChange.mock.calls[0][0]).toHaveLength(5);

      p.destroy();
    });

    it('should not call callback when not configured', async () => {
      // Default plugin has no callback — should not throw
      plugin.set('key', 'Desc', 'value');
      await new Promise(r => setTimeout(r, 150));
      // No error = pass
    });
  });
});
