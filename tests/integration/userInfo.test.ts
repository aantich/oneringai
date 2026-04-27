/**
 * UserInfo Plugin Integration Tests
 *
 * Tests the full UserInfo plugin functionality including:
 * - Single-user scenarios
 * - Multi-user isolation
 * - StorageRegistry integration
 * - Cross-agent data sharing
 *
 * After v0.5.0, user-info CRUD is exposed via the unified store_* tools
 * (store: "user_info"). The plugin's own getTools() returns only the
 * standalone todo_* tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentContextNextGen } from '../../src/core/context-nextgen/AgentContextNextGen.js';
import { UserInfoPluginNextGen } from '../../src/core/context-nextgen/plugins/UserInfoPluginNextGen.js';
import { FileUserInfoStorage } from '../../src/infrastructure/storage/FileUserInfoStorage.js';
import { StorageRegistry } from '../../src/core/StorageRegistry.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_USER_ID_1 = 'test-user-1';
const TEST_USER_ID_2 = 'test-user-2';

// Helper to get storage path
function getUserInfoPath(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return join(homedir(), '.oneringai', 'users', sanitized, 'user_info.json');
}

// Helper to clean up test data
async function cleanupTestUser(userId: string): Promise<void> {
  try {
    await fs.unlink(getUserInfoPath(userId));
  } catch {
    // Ignore if doesn't exist
  }
}

describe('UserInfo Plugin Integration', () => {
  beforeEach(() => {
    StorageRegistry.reset();
  });

  afterEach(async () => {
    StorageRegistry.reset();
    await cleanupTestUser(TEST_USER_ID_1);
    await cleanupTestUser(TEST_USER_ID_2);
    await cleanupTestUser('default');
  });

  describe('Single User Flow', () => {
    it('should store and retrieve user information', async () => {
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const plugin = ctx.getPlugin<UserInfoPluginNextGen>('user_info');
      expect(plugin).toBeDefined();

      // Plugin's own tools: todo_* only
      const pluginTools = plugin!.getTools();
      expect(pluginTools.length).toBe(3);
      const pluginToolNames = pluginTools.map(t => t.definition.function.name);
      expect(pluginToolNames).toContain('todo_add');
      expect(pluginToolNames).toContain('todo_update');
      expect(pluginToolNames).toContain('todo_remove');

      // Unified store_* tools registered on the context
      const setTool = ctx.tools.get('store_set')!;
      const getTool = ctx.tools.get('store_get')!;
      const deleteTool = ctx.tools.get('store_delete')!;
      expect(setTool).toBeDefined();
      expect(getTool).toBeDefined();
      expect(deleteTool).toBeDefined();

      // Set user info
      const setResult = await setTool.execute(
        { store: 'user_info', key: 'theme', value: 'dark', description: 'User preferred theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect(setResult).toHaveProperty('success', true);

      // Get user info
      const getResult = await getTool.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect(getResult).toHaveProperty('found', true);
      expect((getResult as any).entry).toMatchObject({
        key: 'theme',
        value: 'dark',
        valueType: 'string',
        description: 'User preferred theme',
      });

      // Remove user info
      const removeResult = await deleteTool.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect(removeResult).toHaveProperty('deleted', true);

      // Verify removed
      const getResult2 = await getTool.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect(getResult2).toHaveProperty('found', false);

      ctx.destroy();
    });

    it('should handle multiple entries', async () => {
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const setTool = ctx.tools.get('store_set')!;
      const getTool = ctx.tools.get('store_get')!;

      // Set multiple entries
      await setTool.execute({ store: 'user_info', key: 'theme', value: 'dark' }, { userId: TEST_USER_ID_1 });
      await setTool.execute({ store: 'user_info', key: 'language', value: 'en' }, { userId: TEST_USER_ID_1 });
      await setTool.execute({ store: 'user_info', key: 'timezone', value: 'UTC' }, { userId: TEST_USER_ID_1 });

      // Get all entries (no key)
      const allResult = await getTool.execute({ store: 'user_info' }, { userId: TEST_USER_ID_1 });
      expect(allResult).toHaveProperty('found', true);
      expect((allResult as any).entries).toHaveLength(3);

      ctx.destroy();
    });

    it('should persist data across context instances', async () => {
      // First context - write data
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const setTool = ctx1.tools.get('store_set')!;
      await setTool.execute(
        { store: 'user_info', key: 'theme', value: 'dark' },
        { userId: TEST_USER_ID_1 }
      );
      ctx1.destroy();

      // Second context - read data
      const ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const getTool = ctx2.tools.get('store_get')!;
      const result = await getTool.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect((result as any).entry?.value).toBe('dark');

      ctx2.destroy();
    });
  });

  describe('Multi-User Isolation', () => {
    it('should isolate data between users', async () => {
      // Each user gets its own context — the plugin keeps a single in-memory
      // entry map and isolates only at the storage layer (file per user).
      // To verify per-user state, we read each user back through a fresh ctx.
      const ctxWrite1 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });
      await ctxWrite1.tools.get('store_set')!.execute(
        { store: 'user_info', key: 'theme', value: 'dark' },
        { userId: TEST_USER_ID_1 }
      );
      ctxWrite1.destroy();

      const ctxWrite2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_2,
      });
      await ctxWrite2.tools.get('store_set')!.execute(
        { store: 'user_info', key: 'theme', value: 'light' },
        { userId: TEST_USER_ID_2 }
      );
      ctxWrite2.destroy();

      // Read user 1 back from a fresh ctx — should still be 'dark'
      const ctxRead1 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });
      const result1 = await ctxRead1.tools.get('store_get')!.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect((result1 as any).entry?.value).toBe('dark');
      ctxRead1.destroy();

      // Read user 2 back from a fresh ctx — should be 'light'
      const ctxRead2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_2,
      });
      const result2 = await ctxRead2.tools.get('store_get')!.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_2 }
      );
      expect((result2 as any).entry?.value).toBe('light');
      ctxRead2.destroy();
    });
  });

  describe('StorageRegistry Integration', () => {
    it('should use custom storage from registry', async () => {
      let saveCalled = false;
      let loadCalled = false;

      class MockStorage extends FileUserInfoStorage {
        async save(userId: string, entries: any[]): Promise<void> {
          saveCalled = true;
          return super.save(userId, entries);
        }

        async load(userId: string): Promise<any> {
          loadCalled = true;
          return super.load(userId);
        }
      }

      StorageRegistry.configure({
        userInfo: () => new MockStorage(),
      });

      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const setTool = ctx.tools.get('store_set')!;
      await setTool.execute(
        { store: 'user_info', key: 'test', value: 'value' },
        { userId: TEST_USER_ID_1 }
      );

      expect(loadCalled).toBe(true);
      expect(saveCalled).toBe(true);

      ctx.destroy();
    });
  });

  describe('Cross-Agent Data Sharing', () => {
    it('should share user data across different agents', async () => {
      // Agent 1 writes data
      const ctx1 = AgentContextNextGen.create({
        model: 'gpt-4',
        agentId: 'agent-1',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const setTool = ctx1.tools.get('store_set')!;
      await setTool.execute(
        { store: 'user_info', key: 'theme', value: 'dark' },
        { userId: TEST_USER_ID_1 }
      );
      ctx1.destroy();

      // Agent 2 reads data (different agentId, same userId)
      const ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        agentId: 'agent-2',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const getTool = ctx2.tools.get('store_get')!;
      const result = await getTool.execute(
        { store: 'user_info', key: 'theme' },
        { userId: TEST_USER_ID_1 }
      );
      expect((result as any).entry?.value).toBe('dark');

      ctx2.destroy();
    });
  });

  describe('Default User Behavior', () => {
    it('should work without userId (defaults to "default" user)', async () => {
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
      });

      const setTool = ctx.tools.get('store_set')!;
      const getTool = ctx.tools.get('store_get')!;
      const actionTool = ctx.tools.get('store_action')!;

      // Call without userId — should work, using 'default' user
      const setResult = await setTool.execute({
        store: 'user_info',
        key: 'test_default',
        value: 'value',
      });
      expect(setResult).toHaveProperty('success', true);

      // Retrieve without userId — should find the entry
      const getResult = await getTool.execute({ store: 'user_info', key: 'test_default' });
      expect((getResult as any).entry?.value).toBe('value');

      // Clean up via store_action({ action: 'clear', confirm: true })
      await actionTool.execute({ store: 'user_info', action: 'clear', confirm: true });

      ctx.destroy();
    });

    it('should validate key format', async () => {
      const ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { userInfo: true },
        userId: TEST_USER_ID_1,
      });

      const setTool = ctx.tools.get('store_set')!;

      // Invalid key (has spaces)
      const result = await setTool.execute(
        { store: 'user_info', key: 'invalid key', value: 'value' },
        { userId: TEST_USER_ID_1 }
      );
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('message');

      ctx.destroy();
    });
  });
});
