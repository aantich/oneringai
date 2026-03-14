/**
 * StoreToolsManager Unit Tests
 *
 * Tests for the unified CRUD tools manager covering:
 * - Handler registration and lookup
 * - Schema and ID retrieval
 * - Tool creation (5 tools)
 * - Tool routing to correct handlers
 * - Error handling for unknown stores
 * - Destructive action confirmation
 * - Handler missing storeAction support
 * - descriptionFactory dynamic descriptions
 * - destroy cleanup
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StoreToolsManager } from '@/core/context-nextgen/store-tools.js';
import type { IStoreHandler, StoreEntrySchema, StoreGetResult, StoreSetResult, StoreDeleteResult, StoreListResult, StoreActionResult } from '@/core/context-nextgen/types.js';

// ============================================================================
// Mock Handlers
// ============================================================================

function createMockHandler(storeId: string, opts?: {
  hasActions?: boolean;
  destructiveActions?: string[];
  supportsStoreAction?: boolean;
}): IStoreHandler {
  const { hasActions = false, destructiveActions = [], supportsStoreAction = true } = opts ?? {};

  const actions: Record<string, { description: string; destructive?: boolean }> = {};
  if (hasActions) {
    actions['cleanup'] = { description: 'Cleanup old entries' };
    for (const a of destructiveActions) {
      actions[a] = { description: `Action ${a}`, destructive: true };
    }
  }

  const handler: IStoreHandler = {
    getStoreSchema(): StoreEntrySchema {
      return {
        storeId,
        displayName: `${storeId} Store`,
        description: `Mock ${storeId} store`,
        usageHint: `Use for: ${storeId} things`,
        setDataFields: 'value (required): The value',
        actions: hasActions ? actions : undefined,
      };
    },

    async storeGet(key?: string): Promise<StoreGetResult> {
      if (key) {
        return { found: true, key, entry: { key, value: `${storeId}-value-${key}` } };
      }
      return { found: true, entries: [{ key: 'all', store: storeId }] };
    },

    async storeSet(key: string, data: Record<string, unknown>): Promise<StoreSetResult> {
      return { success: true, key, message: `Set ${key} in ${storeId}`, data };
    },

    async storeDelete(key: string): Promise<StoreDeleteResult> {
      return { deleted: true, key };
    },

    async storeList(filter?: Record<string, unknown>): Promise<StoreListResult> {
      return { entries: [{ key: 'item1', store: storeId, filter }], total: 1 };
    },
  };

  if (supportsStoreAction) {
    handler.storeAction = async (action: string, params?: Record<string, unknown>): Promise<StoreActionResult> => {
      return { success: true, action, store: storeId, params };
    };
  }

  return handler;
}

// ============================================================================
// Tests
// ============================================================================

describe('StoreToolsManager', () => {
  let manager: StoreToolsManager;

  beforeEach(() => {
    manager = new StoreToolsManager();
  });

  // --------------------------------------------------------------------------
  // registerHandler
  // --------------------------------------------------------------------------

  describe('registerHandler', () => {
    it('should register a handler', () => {
      const handler = createMockHandler('notes');
      manager.registerHandler(handler);
      expect(manager.getHandler('notes')).toBe(handler);
    });

    it('should throw on duplicate storeId', () => {
      manager.registerHandler(createMockHandler('notes'));
      expect(() => manager.registerHandler(createMockHandler('notes')))
        .toThrow("Store handler with storeId 'notes' is already registered");
    });

    it('should allow different storeIds', () => {
      manager.registerHandler(createMockHandler('notes'));
      manager.registerHandler(createMockHandler('memory'));
      expect(manager.getStoreIds()).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getHandler
  // --------------------------------------------------------------------------

  describe('getHandler', () => {
    it('should return the correct handler by storeId', () => {
      const notesHandler = createMockHandler('notes');
      const memoryHandler = createMockHandler('memory');
      manager.registerHandler(notesHandler);
      manager.registerHandler(memoryHandler);

      expect(manager.getHandler('notes')).toBe(notesHandler);
      expect(manager.getHandler('memory')).toBe(memoryHandler);
    });

    it('should return undefined for unknown storeId', () => {
      expect(manager.getHandler('nonexistent')).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getSchemas
  // --------------------------------------------------------------------------

  describe('getSchemas', () => {
    it('should return empty array when no handlers', () => {
      expect(manager.getSchemas()).toEqual([]);
    });

    it('should return all registered schemas', () => {
      manager.registerHandler(createMockHandler('notes'));
      manager.registerHandler(createMockHandler('memory'));

      const schemas = manager.getSchemas();
      expect(schemas).toHaveLength(2);
      expect(schemas.map(s => s.storeId)).toContain('notes');
      expect(schemas.map(s => s.storeId)).toContain('memory');
    });
  });

  // --------------------------------------------------------------------------
  // getStoreIds
  // --------------------------------------------------------------------------

  describe('getStoreIds', () => {
    it('should return empty array when no handlers', () => {
      expect(manager.getStoreIds()).toEqual([]);
    });

    it('should return all registered IDs', () => {
      manager.registerHandler(createMockHandler('alpha'));
      manager.registerHandler(createMockHandler('beta'));

      const ids = manager.getStoreIds();
      expect(ids).toContain('alpha');
      expect(ids).toContain('beta');
      expect(ids).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getTools
  // --------------------------------------------------------------------------

  describe('getTools', () => {
    it('should return exactly 5 tools', () => {
      const tools = manager.getTools();
      expect(tools).toHaveLength(5);
    });

    it('should have the correct tool names', () => {
      const tools = manager.getTools();
      const names = tools.map(t => t.definition.function.name);
      expect(names).toContain('store_get');
      expect(names).toContain('store_set');
      expect(names).toContain('store_delete');
      expect(names).toContain('store_list');
      expect(names).toContain('store_action');
    });

    it('should have descriptionFactory on every tool', () => {
      const tools = manager.getTools();
      for (const tool of tools) {
        expect(tool.descriptionFactory).toBeDefined();
        expect(typeof tool.descriptionFactory).toBe('function');
      }
    });

    it('should have execute on every tool', () => {
      const tools = manager.getTools();
      for (const tool of tools) {
        expect(typeof tool.execute).toBe('function');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Tool routing
  // --------------------------------------------------------------------------

  describe('tool routing', () => {
    let tools: ReturnType<StoreToolsManager['getTools']>;

    beforeEach(() => {
      manager.registerHandler(createMockHandler('notes'));
      manager.registerHandler(createMockHandler('memory'));
      tools = manager.getTools();
    });

    function findTool(name: string) {
      return tools.find(t => t.definition.function.name === name)!;
    }

    it('store_get routes to correct handler by key', async () => {
      const tool = findTool('store_get');
      const result = await tool.execute({ store: 'notes', key: 'myKey' }) as StoreGetResult;
      expect(result.found).toBe(true);
      expect(result.key).toBe('myKey');
      expect(result.entry).toEqual({ key: 'myKey', value: 'notes-value-myKey' });
    });

    it('store_get routes to correct handler without key', async () => {
      const tool = findTool('store_get');
      const result = await tool.execute({ store: 'memory' }) as StoreGetResult;
      expect(result.found).toBe(true);
      expect(result.entries).toBeDefined();
      expect(result.entries![0]).toHaveProperty('store', 'memory');
    });

    it('store_set routes to correct handler', async () => {
      const tool = findTool('store_set');
      const result = await tool.execute({ store: 'notes', key: 'k1', data: { value: 'hello' } }) as StoreSetResult;
      expect(result.success).toBe(true);
      expect(result.key).toBe('k1');
    });

    it('store_set supports flat args (without data wrapper)', async () => {
      const tool = findTool('store_set');
      // LLMs often pass value/description/priority as top-level args instead of nesting in data
      const result = await tool.execute({
        store: 'notes', key: 'k2', value: { foo: 1 }, description: 'Test', priority: 'high',
      }) as StoreSetResult & { data: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(result.key).toBe('k2');
      expect(result.data).toEqual({ value: { foo: 1 }, description: 'Test', priority: 'high' });
    });

    it('store_delete routes to correct handler', async () => {
      const tool = findTool('store_delete');
      const result = await tool.execute({ store: 'notes', key: 'k1' }) as StoreDeleteResult;
      expect(result.deleted).toBe(true);
      expect(result.key).toBe('k1');
    });

    it('store_list routes to correct handler', async () => {
      const tool = findTool('store_list');
      const result = await tool.execute({ store: 'memory', filter: { status: 'active' } }) as StoreListResult;
      expect(result.total).toBe(1);
      expect(result.entries[0]).toHaveProperty('store', 'memory');
    });

    it('store_action routes to correct handler', async () => {
      const tool = findTool('store_action');
      const result = await tool.execute({ store: 'notes', action: 'cleanup', params: { limit: 5 } }) as StoreActionResult;
      expect(result.success).toBe(true);
      expect(result.action).toBe('cleanup');
    });

    it('should throw for unknown store on store_get', async () => {
      const tool = findTool('store_get');
      await expect(tool.execute({ store: 'unknown' }))
        .rejects.toThrow('Unknown store "unknown"');
    });

    it('should throw for unknown store on store_set', async () => {
      const tool = findTool('store_set');
      await expect(tool.execute({ store: 'unknown', key: 'k', data: {} }))
        .rejects.toThrow('Unknown store "unknown"');
    });

    it('should throw for unknown store on store_delete', async () => {
      const tool = findTool('store_delete');
      await expect(tool.execute({ store: 'unknown', key: 'k' }))
        .rejects.toThrow('Unknown store "unknown"');
    });

    it('should throw for unknown store on store_list', async () => {
      const tool = findTool('store_list');
      await expect(tool.execute({ store: 'unknown' }))
        .rejects.toThrow('Unknown store "unknown"');
    });

    it('should throw for unknown store on store_action', async () => {
      const tool = findTool('store_action');
      await expect(tool.execute({ store: 'unknown', action: 'x' }))
        .rejects.toThrow('Unknown store "unknown"');
    });

    it('error message lists available stores', async () => {
      const tool = findTool('store_get');
      await expect(tool.execute({ store: 'bad' }))
        .rejects.toThrow(/Available stores:.*notes.*memory/);
    });
  });

  // --------------------------------------------------------------------------
  // store_action: destructive action without confirm
  // --------------------------------------------------------------------------

  describe('store_action destructive confirmation', () => {
    it('should return error when destructive action called without confirm', async () => {
      manager.registerHandler(createMockHandler('data', {
        hasActions: true,
        destructiveActions: ['wipe'],
      }));
      const tools = manager.getTools();
      const actionTool = tools.find(t => t.definition.function.name === 'store_action')!;

      const result = await actionTool.execute({ store: 'data', action: 'wipe', params: {} }) as StoreActionResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain('destructive');
      expect(result.error).toContain('confirm: true');
    });

    it('should allow destructive action with confirm: true', async () => {
      manager.registerHandler(createMockHandler('data', {
        hasActions: true,
        destructiveActions: ['wipe'],
      }));
      const tools = manager.getTools();
      const actionTool = tools.find(t => t.definition.function.name === 'store_action')!;

      const result = await actionTool.execute({ store: 'data', action: 'wipe', params: { confirm: true } }) as StoreActionResult;
      expect(result.success).toBe(true);
    });

    it('should allow non-destructive action without confirm', async () => {
      manager.registerHandler(createMockHandler('data', {
        hasActions: true,
        destructiveActions: ['wipe'],
      }));
      const tools = manager.getTools();
      const actionTool = tools.find(t => t.definition.function.name === 'store_action')!;

      const result = await actionTool.execute({ store: 'data', action: 'cleanup' }) as StoreActionResult;
      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // store_action: handler does not implement storeAction
  // --------------------------------------------------------------------------

  describe('store_action without handler support', () => {
    it('should return error if handler has no storeAction', async () => {
      manager.registerHandler(createMockHandler('basic', {
        supportsStoreAction: false,
      }));
      const tools = manager.getTools();
      const actionTool = tools.find(t => t.definition.function.name === 'store_action')!;

      const result = await actionTool.execute({ store: 'basic', action: 'doSomething' }) as StoreActionResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support actions');
    });
  });

  // --------------------------------------------------------------------------
  // descriptionFactory
  // --------------------------------------------------------------------------

  describe('descriptionFactory', () => {
    it('should include all registered store names', () => {
      manager.registerHandler(createMockHandler('notes'));
      manager.registerHandler(createMockHandler('memory'));

      const tools = manager.getTools();
      for (const tool of tools) {
        const desc = tool.descriptionFactory!();
        expect(desc).toContain('notes');
        expect(desc).toContain('memory');
      }
    });

    it('should reflect dynamically added stores', () => {
      const tools = manager.getTools();

      // Initially no stores
      const descBefore = tools[0].descriptionFactory!();
      expect(descBefore).toContain('No stores available');

      // Register a handler after tools were created
      manager.registerHandler(createMockHandler('late'));

      const descAfter = tools[0].descriptionFactory!();
      expect(descAfter).toContain('late');
    });

    it('store_set description includes setDataFields', () => {
      manager.registerHandler(createMockHandler('notes'));
      const tools = manager.getTools();
      const setTool = tools.find(t => t.definition.function.name === 'store_set')!;
      const desc = setTool.descriptionFactory!();
      expect(desc).toContain('Fields (pass as top-level params):');
      expect(desc).toContain('value (required)');
    });

    it('store_action description includes action info', () => {
      manager.registerHandler(createMockHandler('data', {
        hasActions: true,
        destructiveActions: ['wipe'],
      }));
      const tools = manager.getTools();
      const actionTool = tools.find(t => t.definition.function.name === 'store_action')!;
      const desc = actionTool.descriptionFactory!();
      expect(desc).toContain('Actions:');
      expect(desc).toContain('cleanup');
      expect(desc).toContain('wipe');
      expect(desc).toContain('destructive');
    });
  });

  // --------------------------------------------------------------------------
  // destroy
  // --------------------------------------------------------------------------

  describe('destroy', () => {
    it('should clear all handlers', () => {
      manager.registerHandler(createMockHandler('notes'));
      manager.registerHandler(createMockHandler('memory'));
      expect(manager.getStoreIds()).toHaveLength(2);

      manager.destroy();

      expect(manager.getStoreIds()).toHaveLength(0);
      expect(manager.getHandler('notes')).toBeUndefined();
      expect(manager.getHandler('memory')).toBeUndefined();
      expect(manager.getSchemas()).toEqual([]);
    });
  });
});
