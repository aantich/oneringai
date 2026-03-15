/**
 * SharedWorkspacePluginNextGen Unit Tests
 *
 * Tests for the shared workspace plugin covering:
 * - Plugin basics (name, instructions, tools)
 * - Store schema
 * - CRUD operations (storeSet, storeGet, storeDelete, storeList)
 * - Store actions (log, history, archive, clear)
 * - Content rendering
 * - State serialization/restoration
 * - Compaction
 * - Max entries enforcement
 * - Direct API access
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SharedWorkspacePluginNextGen,
} from '@/core/context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type {
  SharedWorkspaceEntry,
} from '@/core/context-nextgen/plugins/SharedWorkspacePluginNextGen.js';

describe('SharedWorkspacePluginNextGen', () => {
  let plugin: SharedWorkspacePluginNextGen;

  beforeEach(() => {
    plugin = new SharedWorkspacePluginNextGen();
  });

  // --------------------------------------------------------------------------
  // Plugin basics
  // --------------------------------------------------------------------------

  describe('plugin basics', () => {
    it('should have name "shared_workspace"', () => {
      expect(plugin.name).toBe('shared_workspace');
    });

    it('should return instructions containing "workspace"', () => {
      const instructions = plugin.getInstructions();
      expect(instructions).toContain('workspace');
    });

    it('should return empty tools array', () => {
      expect(plugin.getTools()).toEqual([]);
    });

    it('should return 0 token size when empty', () => {
      expect(plugin.getTokenSize()).toBe(0);
    });

    it('should return non-zero instructions token size', () => {
      expect(plugin.getInstructionsTokenSize()).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // getStoreSchema
  // --------------------------------------------------------------------------

  describe('getStoreSchema', () => {
    it('should return storeId "workspace"', () => {
      const schema = plugin.getStoreSchema();
      expect(schema.storeId).toBe('workspace');
    });

    it('should have displayName and description', () => {
      const schema = plugin.getStoreSchema();
      expect(schema.displayName).toBe('Shared Workspace');
      expect(schema.description).toBeDefined();
    });

    it('should define log, history, archive, and clear actions', () => {
      const schema = plugin.getStoreSchema();
      expect(schema.actions).toBeDefined();
      expect(schema.actions!['log']).toBeDefined();
      expect(schema.actions!['history']).toBeDefined();
      expect(schema.actions!['archive']).toBeDefined();
      expect(schema.actions!['clear']).toBeDefined();
    });

    it('should mark clear as destructive', () => {
      const schema = plugin.getStoreSchema();
      expect(schema.actions!['clear'].destructive).toBe(true);
    });

    it('should not mark log/history/archive as destructive', () => {
      const schema = plugin.getStoreSchema();
      expect(schema.actions!['log'].destructive).toBeUndefined();
      expect(schema.actions!['history'].destructive).toBeUndefined();
      expect(schema.actions!['archive'].destructive).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // storeSet
  // --------------------------------------------------------------------------

  describe('storeSet', () => {
    it('should create entry with auto-version 1', async () => {
      const result = await plugin.storeSet('plan', { summary: 'The plan', author: 'agent-1' });
      expect(result.success).toBe(true);
      expect(result.key).toBe('plan');
      expect(result.version).toBe(1);
      expect(result.message).toContain('Created');
    });

    it('should increment version on update', async () => {
      await plugin.storeSet('plan', { summary: 'v1', author: 'agent-1' });
      const result = await plugin.storeSet('plan', { summary: 'v2', author: 'agent-2' });
      expect(result.version).toBe(2);
      expect(result.message).toContain('Updated');
    });

    it('should require summary', async () => {
      const result = await plugin.storeSet('plan', { author: 'agent-1' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('summary');
    });

    it('should store content and references', async () => {
      await plugin.storeSet('doc', {
        summary: 'A doc',
        content: 'Full text here',
        references: ['/path/to/file'],
        author: 'agent-1',
      });
      const entry = plugin.getEntry('doc');
      expect(entry).toBeDefined();
      expect(entry!.content).toBe('Full text here');
      expect(entry!.references).toEqual(['/path/to/file']);
    });

    it('should store tags', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', tags: ['design', 'v2'], author: 'a' });
      const entry = plugin.getEntry('plan');
      expect(entry!.tags).toEqual(['design', 'v2']);
    });

    it('should default status to "draft" on create', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      const entry = plugin.getEntry('plan');
      expect(entry!.status).toBe('draft');
    });

    it('should preserve status on update if not provided', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', status: 'approved', author: 'a' });
      await plugin.storeSet('plan', { summary: 'Plan v2', author: 'b' });
      const entry = plugin.getEntry('plan');
      expect(entry!.status).toBe('approved');
    });
  });

  // --------------------------------------------------------------------------
  // storeGet
  // --------------------------------------------------------------------------

  describe('storeGet', () => {
    it('should get entry by key', async () => {
      await plugin.storeSet('plan', { summary: 'The plan', author: 'a' });
      const result = await plugin.storeGet('plan');
      expect(result.found).toBe(true);
      expect(result.key).toBe('plan');
      expect(result.entry).toBeDefined();
      expect(result.entry!['summary']).toBe('The plan');
    });

    it('should return found:false for missing key', async () => {
      const result = await plugin.storeGet('nonexistent');
      expect(result.found).toBe(false);
      expect(result.key).toBe('nonexistent');
    });

    it('should return all entries when no key provided', async () => {
      await plugin.storeSet('a', { summary: 'A', author: 'x' });
      await plugin.storeSet('b', { summary: 'B', author: 'y' });
      const result = await plugin.storeGet();
      expect(result.found).toBe(true);
      expect(result.entries).toBeDefined();
      expect(result.entries).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // storeDelete
  // --------------------------------------------------------------------------

  describe('storeDelete', () => {
    it('should delete an existing entry', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      const result = await plugin.storeDelete('plan');
      expect(result.deleted).toBe(true);
      expect(result.key).toBe('plan');
      expect(plugin.getEntry('plan')).toBeUndefined();
    });

    it('should return deleted:false for missing key', async () => {
      const result = await plugin.storeDelete('nonexistent');
      expect(result.deleted).toBe(false);
      expect(result.key).toBe('nonexistent');
    });
  });

  // --------------------------------------------------------------------------
  // storeList
  // --------------------------------------------------------------------------

  describe('storeList', () => {
    beforeEach(async () => {
      await plugin.storeSet('plan', { summary: 'Plan', status: 'draft', author: 'alice', tags: ['design'] });
      await plugin.storeSet('review', { summary: 'Review', status: 'approved', author: 'bob', tags: ['code'] });
      await plugin.storeSet('spec', { summary: 'Spec', status: 'draft', author: 'alice', tags: ['design', 'code'] });
    });

    it('should return all entries without filter', async () => {
      const result = await plugin.storeList();
      expect(result.total).toBe(3);
      expect(result.entries).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const result = await plugin.storeList({ status: 'draft' });
      expect(result.total).toBe(2);
      const keys = result.entries.map(e => e['key']);
      expect(keys).toContain('plan');
      expect(keys).toContain('spec');
    });

    it('should filter by author', async () => {
      const result = await plugin.storeList({ author: 'bob' });
      expect(result.total).toBe(1);
      expect(result.entries[0]['key']).toBe('review');
    });

    it('should filter by tags', async () => {
      const result = await plugin.storeList({ tags: ['code'] });
      expect(result.total).toBe(2);
      const keys = result.entries.map(e => e['key']);
      expect(keys).toContain('review');
      expect(keys).toContain('spec');
    });

    it('should return entry metadata in list', async () => {
      const result = await plugin.storeList();
      const entry = result.entries.find(e => e['key'] === 'plan')!;
      expect(entry['summary']).toBe('Plan');
      expect(entry['status']).toBe('draft');
      expect(entry['author']).toBe('alice');
      expect(entry['version']).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // storeAction: log
  // --------------------------------------------------------------------------

  describe('storeAction log', () => {
    it('should append to log', async () => {
      const result = await plugin.storeAction('log', { message: 'Hello team', author: 'alice' });
      expect(result.success).toBe(true);
      expect(result.action).toBe('log');
      expect(plugin.getLog()).toHaveLength(1);
      expect(plugin.getLog()[0].message).toBe('Hello team');
    });

    it('should require message parameter', async () => {
      const result = await plugin.storeAction('log', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('message');
    });

    it('should require message when no params', async () => {
      const result = await plugin.storeAction('log');
      expect(result.success).toBe(false);
      expect(result.error).toContain('message');
    });

    it('should enforce maxLogEntries', () => {
      const small = new SharedWorkspacePluginNextGen({ maxLogEntries: 3 });
      for (let i = 0; i < 5; i++) {
        small.appendLog('agent', `msg-${i}`);
      }
      expect(small.getLog()).toHaveLength(3);
      expect(small.getLog()[0].message).toBe('msg-2');
    });
  });

  // --------------------------------------------------------------------------
  // storeAction: history
  // --------------------------------------------------------------------------

  describe('storeAction history', () => {
    it('should return recent log entries', async () => {
      await plugin.storeAction('log', { message: 'msg-1', author: 'a' });
      await plugin.storeAction('log', { message: 'msg-2', author: 'b' });
      await plugin.storeAction('log', { message: 'msg-3', author: 'c' });

      const result = await plugin.storeAction('history', { limit: 2 });
      expect(result.success).toBe(true);
      expect(result['entries']).toHaveLength(2);
      expect(result['total']).toBe(3);
    });

    it('should default limit to 20', async () => {
      for (let i = 0; i < 25; i++) {
        await plugin.storeAction('log', { message: `msg-${i}`, author: 'a' });
      }
      const result = await plugin.storeAction('history');
      expect(result['entries']).toHaveLength(20);
    });
  });

  // --------------------------------------------------------------------------
  // storeAction: archive
  // --------------------------------------------------------------------------

  describe('storeAction archive', () => {
    it('should set entry status to "archived"', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      const result = await plugin.storeAction('archive', { key: 'plan' });
      expect(result.success).toBe(true);
      expect(plugin.getEntry('plan')!.status).toBe('archived');
    });

    it('should require key parameter', async () => {
      const result = await plugin.storeAction('archive', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('key');
    });

    it('should return error for missing entry', async () => {
      const result = await plugin.storeAction('archive', { key: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // --------------------------------------------------------------------------
  // storeAction: clear
  // --------------------------------------------------------------------------

  describe('storeAction clear', () => {
    it('should clear all entries and log', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      await plugin.storeAction('log', { message: 'Hello', author: 'a' });

      const result = await plugin.storeAction('clear');
      expect(result.success).toBe(true);
      expect(plugin.getAllEntries()).toHaveLength(0);
      expect(plugin.getLog()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // storeAction: unknown action
  // --------------------------------------------------------------------------

  describe('storeAction unknown', () => {
    it('should return error for unknown action', async () => {
      const result = await plugin.storeAction('foobar');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
      expect(result.error).toContain('foobar');
    });
  });

  // --------------------------------------------------------------------------
  // getContent
  // --------------------------------------------------------------------------

  describe('getContent', () => {
    it('should return null when empty', async () => {
      const content = await plugin.getContent();
      expect(content).toBeNull();
    });

    it('should render entries as markdown', async () => {
      await plugin.storeSet('plan', { summary: 'The master plan', author: 'alice', status: 'draft' });
      const content = await plugin.getContent();
      expect(content).toContain('Shared Workspace');
      expect(content).toContain('plan');
      expect(content).toContain('The master plan');
      expect(content).toContain('alice');
    });

    it('should render log entries', async () => {
      await plugin.storeAction('log', { message: 'Started work', author: 'bob' });
      const content = await plugin.getContent();
      expect(content).toContain('Team Log');
      expect(content).toContain('bob');
      expect(content).toContain('Started work');
    });

    it('should update token size after getContent', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      expect(plugin.getTokenSize()).toBe(0); // not yet computed
      await plugin.getContent();
      expect(plugin.getTokenSize()).toBeGreaterThan(0);
    });

    it('should show content preview for entries with inline content', async () => {
      await plugin.storeSet('doc', { summary: 'Doc', content: 'Inline text here', author: 'a' });
      const rendered = await plugin.getContent();
      expect(rendered).toContain('Inline text here');
    });

    it('should show references', async () => {
      await plugin.storeSet('ref', { summary: 'Ref', references: ['/path/a', '/path/b'], author: 'a' });
      const rendered = await plugin.getContent();
      expect(rendered).toContain('/path/a');
      expect(rendered).toContain('/path/b');
    });
  });

  // --------------------------------------------------------------------------
  // getState / restoreState
  // --------------------------------------------------------------------------

  describe('getState / restoreState', () => {
    it('should serialize and restore entries', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'alice', tags: ['v1'] });
      await plugin.storeSet('spec', { summary: 'Spec', author: 'bob' });
      await plugin.storeAction('log', { message: 'Hello', author: 'alice' });

      const state = plugin.getState();

      const plugin2 = new SharedWorkspacePluginNextGen();
      plugin2.restoreState(state);

      expect(plugin2.getAllEntries()).toHaveLength(2);
      expect(plugin2.getEntry('plan')!.summary).toBe('Plan');
      expect(plugin2.getEntry('plan')!.tags).toEqual(['v1']);
      expect(plugin2.getLog()).toHaveLength(1);
      expect(plugin2.getLog()[0].message).toBe('Hello');
    });

    it('should handle null/undefined state gracefully', () => {
      const plugin2 = new SharedWorkspacePluginNextGen();
      plugin2.restoreState(null);
      expect(plugin2.getAllEntries()).toHaveLength(0);

      plugin2.restoreState(undefined);
      expect(plugin2.getAllEntries()).toHaveLength(0);
    });

    it('should handle state with missing fields', () => {
      const plugin2 = new SharedWorkspacePluginNextGen();
      plugin2.restoreState({ entries: [] });
      expect(plugin2.getAllEntries()).toHaveLength(0);
      expect(plugin2.getLog()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // compact
  // --------------------------------------------------------------------------

  describe('compact', () => {
    it('should remove archived entries first', async () => {
      await plugin.storeSet('active', { summary: 'Active', author: 'a' });
      await plugin.storeSet('old', { summary: 'Old', author: 'a' });
      await plugin.storeAction('archive', { key: 'old' });

      // Force getContent to compute token cache
      await plugin.getContent();

      const freed = await plugin.compact(1);
      expect(freed).toBeGreaterThan(0);
      // archived entry should be removed first
      expect(plugin.getEntry('old')).toBeUndefined();
      expect(plugin.getEntry('active')).toBeDefined();
    });

    it('should remove oldest entries after archived', async () => {
      // Create entries with different timestamps
      await plugin.storeSet('old', { summary: 'Old entry', author: 'a' });
      // Small delay to ensure different updatedAt
      await plugin.storeSet('new', { summary: 'New entry', author: 'a' });

      await plugin.getContent();

      // Ask to free a large number of tokens to force removal of both
      const freed = await plugin.compact(999999);
      expect(freed).toBeGreaterThan(0);
      expect(plugin.getAllEntries()).toHaveLength(0);
    });

    it('should return 0 when nothing to compact', async () => {
      const freed = await plugin.compact(100);
      expect(freed).toBe(0);
    });

    it('should report isCompactable correctly', async () => {
      expect(plugin.isCompactable()).toBe(false);
      await plugin.storeSet('x', { summary: 'X', author: 'a' });
      expect(plugin.isCompactable()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // enforceMaxEntries
  // --------------------------------------------------------------------------

  describe('enforceMaxEntries', () => {
    it('should respect config.maxEntries', async () => {
      const small = new SharedWorkspacePluginNextGen({ maxEntries: 3 });

      for (let i = 0; i < 5; i++) {
        await small.storeSet(`entry-${i}`, { summary: `Entry ${i}`, author: 'a' });
      }

      expect(small.getAllEntries()).toHaveLength(3);
    });

    it('should remove oldest entries when exceeding max', async () => {
      const small = new SharedWorkspacePluginNextGen({ maxEntries: 2 });

      await small.storeSet('first', { summary: 'First', author: 'a' });
      await small.storeSet('second', { summary: 'Second', author: 'a' });
      await small.storeSet('third', { summary: 'Third', author: 'a' });

      expect(small.getAllEntries()).toHaveLength(2);
      // oldest should be evicted
      expect(small.getEntry('first')).toBeUndefined();
      expect(small.getEntry('second')).toBeDefined();
      expect(small.getEntry('third')).toBeDefined();
    });

    it('should evict archived entries before active ones', async () => {
      const small = new SharedWorkspacePluginNextGen({ maxEntries: 2 });

      await small.storeSet('active', { summary: 'Active', author: 'a' });
      await small.storeSet('archived', { summary: 'Archived', author: 'a' });
      await small.storeAction('archive', { key: 'archived' });
      await small.storeSet('new', { summary: 'New', author: 'a' });

      expect(small.getAllEntries()).toHaveLength(2);
      expect(small.getEntry('archived')).toBeUndefined();
      expect(small.getEntry('active')).toBeDefined();
      expect(small.getEntry('new')).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Direct API
  // --------------------------------------------------------------------------

  describe('direct API', () => {
    it('getEntry returns entry by key', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      const entry = plugin.getEntry('plan');
      expect(entry).toBeDefined();
      expect(entry!.key).toBe('plan');
      expect(entry!.summary).toBe('Plan');
    });

    it('getEntry returns undefined for missing key', () => {
      expect(plugin.getEntry('missing')).toBeUndefined();
    });

    it('getAllEntries returns all entries', async () => {
      await plugin.storeSet('a', { summary: 'A', author: 'x' });
      await plugin.storeSet('b', { summary: 'B', author: 'y' });
      const all = plugin.getAllEntries();
      expect(all).toHaveLength(2);
    });

    it('getAllEntries returns empty array when empty', () => {
      expect(plugin.getAllEntries()).toEqual([]);
    });

    it('getLog returns log entries', () => {
      plugin.appendLog('alice', 'Hello');
      plugin.appendLog('bob', 'World');
      const log = plugin.getLog();
      expect(log).toHaveLength(2);
      expect(log[0].message).toBe('Hello');
      expect(log[1].message).toBe('World');
    });

    it('getLog returns empty array when empty', () => {
      expect(plugin.getLog()).toEqual([]);
    });

    it('appendLog adds entries', () => {
      plugin.appendLog('agent-1', 'Started task');
      expect(plugin.getLog()).toHaveLength(1);
      expect(plugin.getLog()[0].author).toBe('agent-1');
      expect(plugin.getLog()[0].message).toBe('Started task');
      expect(plugin.getLog()[0].timestamp).toBeGreaterThan(0);
    });

    it('appendLog enforces maxLogEntries', () => {
      const small = new SharedWorkspacePluginNextGen({ maxLogEntries: 2 });
      small.appendLog('a', 'msg-1');
      small.appendLog('a', 'msg-2');
      small.appendLog('a', 'msg-3');
      expect(small.getLog()).toHaveLength(2);
      expect(small.getLog()[0].message).toBe('msg-2');
    });
  });

  // --------------------------------------------------------------------------
  // destroy
  // --------------------------------------------------------------------------

  describe('destroy', () => {
    it('should clear entries and log', async () => {
      await plugin.storeSet('plan', { summary: 'Plan', author: 'a' });
      plugin.appendLog('a', 'Hello');

      plugin.destroy();

      expect(plugin.getAllEntries()).toHaveLength(0);
      expect(plugin.getLog()).toHaveLength(0);
    });

    it('should be idempotent', () => {
      plugin.destroy();
      plugin.destroy(); // should not throw
    });
  });
});
