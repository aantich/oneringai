/**
 * AgentContextNextGen Plugins Integration Tests (Mock LLM)
 *
 * Tests plugin integration with AgentContextNextGen:
 * - WorkingMemoryPluginNextGen
 * - InContextMemoryPluginNextGen
 * - PersistentInstructionsPluginNextGen
 *
 * After v0.5.0, plugin-specific tools (memory_*, context_*, instructions_*)
 * are replaced by 5 unified store_* tools routed by the `store` parameter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AgentContextNextGen } from '../../../src/core/context-nextgen/AgentContextNextGen.js';
import type { WorkingMemoryPluginNextGen } from '../../../src/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';
import type { InContextMemoryPluginNextGen } from '../../../src/core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';
import type { PersistentInstructionsPluginNextGen } from '../../../src/core/context-nextgen/plugins/PersistentInstructionsPluginNextGen.js';
import {
  createContextWithFeatures,
  safeDestroy,
  FEATURE_PRESETS,
} from '../../helpers/contextTestHelpers.js';

const PERSIST_AGENT_ID = 'test-agent-instructions';

async function clearPersistentInstructionsForAgent(agentId: string): Promise<void> {
  const dir = path.join(os.homedir(), '.oneringai', 'agents', agentId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

describe('AgentContextNextGen Plugins Integration (Mock)', () => {
  let ctx: AgentContextNextGen | null = null;
  let tempDir: string | null = null;

  beforeEach(async () => {
    // Create temp directory for tests that need it
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-test-'));
    process.env.ONERINGAI_DATA_DIR = tempDir;

    // PersistentInstructions storage uses ~/.oneringai/agents/<agentId>/ — purge between tests
    await clearPersistentInstructionsForAgent(PERSIST_AGENT_ID);
  });

  afterEach(async () => {
    safeDestroy(ctx);
    ctx = null;

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      tempDir = null;
    }
    delete process.env.ONERINGAI_DATA_DIR;

    await clearPersistentInstructionsForAgent(PERSIST_AGENT_ID);
  });

  // ============================================================================
  // WorkingMemoryPluginNextGen
  // ============================================================================

  describe('WorkingMemoryPluginNextGen', () => {
    beforeEach(() => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.memoryOnly);
    });

    it('should have memory plugin accessible via ctx.memory', () => {
      expect(ctx!.memory).not.toBeNull();
      expect(ctx!.memory?.name).toBe('working_memory');
    });

    it('should store and retrieve data', async () => {
      const memory = ctx!.memory!;

      await memory.store('user.name', 'User name', 'Alice');
      const value = await memory.retrieve('user.name');

      expect(value).toBe('Alice');
    });

    it('should store data with tiers', async () => {
      const memory = ctx!.memory!;

      // Store in different tiers
      await memory.store('topic', 'Raw data', { raw: true }, { tier: 'raw' });
      await memory.store('topic', 'Summary', { summary: true }, { tier: 'summary' });
      await memory.store('topic', 'Finding', { finding: true }, { tier: 'findings' });

      // Query by tier
      const rawQuery = await memory.query({ tier: 'raw' });
      const summaryQuery = await memory.query({ tier: 'summary' });
      const findingsQuery = await memory.query({ tier: 'findings' });

      expect(rawQuery.entries.length).toBe(1);
      expect(summaryQuery.entries.length).toBe(1);
      expect(findingsQuery.entries.length).toBe(1);
    });

    it('should delete entries', async () => {
      const memory = ctx!.memory!;

      await memory.store('key1', 'Test', 'value1');
      await memory.store('key2', 'Test', 'value2');

      const deleted = await memory.delete('key1');
      expect(deleted).toBe(true);

      const value = await memory.retrieve('key1');
      expect(value).toBeUndefined();
    });

    it('should provide memory index in context', async () => {
      const memory = ctx!.memory!;

      await memory.store('key1', 'Description 1', 'value1');
      await memory.store('key2', 'Description 2', 'value2');

      const content = await memory.getContent();

      expect(content).not.toBeNull();
      expect(content).toContain('key1');
      expect(content).toContain('Description 1');
      expect(content).toContain('key2');
      expect(content).toContain('Description 2');
    });

    it('should expose unified store tools for working memory', async () => {
      const toolNames = ctx!.tools.getEnabled().map(t => t.definition.function.name);

      expect(toolNames).toContain('store_set');
      expect(toolNames).toContain('store_get');
      expect(toolNames).toContain('store_delete');
      expect(toolNames).toContain('store_list');
      expect(toolNames).toContain('store_action');
    });

    it('should execute store_set tool against the memory store', async () => {
      const setTool = ctx!.tools.get('store_set')!;
      const result = await setTool.execute({
        store: 'notes',
        key: 'test_key',
        description: 'Test description',
        value: { data: 'test' },
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('key', 'test_key');

      // Verify stored
      const retrieved = await ctx!.memory!.retrieve('test_key');
      expect(retrieved).toEqual({ data: 'test' });
    });

    it('should execute store_get tool against the memory store', async () => {
      await ctx!.memory!.store('my_key', 'My data', { foo: 'bar' });

      const getTool = ctx!.tools.get('store_get')!;
      const result = await getTool.execute({ store: 'notes', key: 'my_key' });

      expect(result).toHaveProperty('found', true);
      expect((result as any).value ?? (result as any).entry?.value).toEqual({ foo: 'bar' });
    });

    it('should cleanup raw tier entries', async () => {
      const memory = ctx!.memory!;

      await memory.store('item1', 'Raw item', 'value1', { tier: 'raw' });
      await memory.store('item2', 'Raw item', 'value2', { tier: 'raw' });
      await memory.store('item3', 'Summary', 'value3', { tier: 'summary' });

      const result = await memory.cleanupRaw();

      expect(result.deleted).toBe(2);

      // Raw items should be gone
      const rawQuery = await memory.query({ tier: 'raw' });
      expect(rawQuery.entries.length).toBe(0);

      // Summary should remain
      const summaryQuery = await memory.query({ tier: 'summary' });
      expect(summaryQuery.entries.length).toBe(1);
    });

    it('should include working-memory instructions in system message', async () => {
      ctx!.addUserMessage('test');
      const { input } = await ctx!.prepare();

      const systemMsg = input[0] as any;
      const text = systemMsg.content[0].text;

      expect(text).toContain('Working Memory');
      // Unified store tools are referenced in the overview
      expect(text).toContain('store_set');
      expect(text).toContain('store_get');
    });
  });

  // ============================================================================
  // InContextMemoryPluginNextGen
  // ============================================================================

  describe('InContextMemoryPluginNextGen', () => {
    beforeEach(() => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.inContextOnly);
    });

    it('should get plugin via getPlugin', () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory');
      expect(plugin).not.toBeNull();
      expect(plugin?.name).toBe('in_context_memory');
    });

    it('should store values directly in context', async () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;

      plugin.set('state', 'Current state', { step: 1, status: 'running' });

      const content = await plugin.getContent();

      expect(content).not.toBeNull();
      expect(content).toContain('state');
      expect(content).toContain('Current state');
      expect(content).toContain('step');
      expect(content).toContain('running');
    });

    it('should get and has methods work', () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;

      plugin.set('key1', 'Test', 'value1');

      expect(plugin.has('key1')).toBe(true);
      expect(plugin.has('nonexistent')).toBe(false);
      expect(plugin.get('key1')).toBe('value1');
      expect(plugin.get('nonexistent')).toBeUndefined();
    });

    it('should delete entries', () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;

      plugin.set('key1', 'Test', 'value1');
      expect(plugin.delete('key1')).toBe(true);
      expect(plugin.has('key1')).toBe(false);
      expect(plugin.delete('key1')).toBe(false);
    });

    it('should list entries', () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;

      plugin.set('key1', 'Desc 1', 'value1', 'high');
      plugin.set('key2', 'Desc 2', 'value2', 'low');

      const list = plugin.list();

      expect(list.length).toBe(2);
      expect(list.find(e => e.key === 'key1')?.priority).toBe('high');
      expect(list.find(e => e.key === 'key2')?.priority).toBe('low');
    });

    it('should clear all entries', () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;

      plugin.set('key1', 'Test', 'value1');
      plugin.set('key2', 'Test', 'value2');

      plugin.clear();

      expect(plugin.list().length).toBe(0);
    });

    it('should expose unified store tools for context store', () => {
      const toolNames = ctx!.tools.getEnabled().map(t => t.definition.function.name);

      expect(toolNames).toContain('store_set');
      expect(toolNames).toContain('store_delete');
      expect(toolNames).toContain('store_list');
    });

    it('should execute store_set tool against the context store', async () => {
      const setTool = ctx!.tools.get('store_set')!;
      const result = await setTool.execute({
        store: 'whiteboard',
        key: 'my_state',
        description: 'Application state',
        value: { mode: 'active' },
        priority: 'high',
      });

      expect(result).toHaveProperty('success', true);

      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      expect(plugin.get('my_state')).toEqual({ mode: 'active' });
    });

    it('should execute store_delete tool against the context store', async () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      plugin.set('to_delete', 'Will be deleted', 'value');

      const deleteTool = ctx!.tools.get('store_delete')!;
      const result = await deleteTool.execute({ store: 'whiteboard', key: 'to_delete' });

      expect(result).toHaveProperty('deleted', true);
      expect(plugin.has('to_delete')).toBe(false);
    });

    it('should execute store_list tool against the context store', async () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      plugin.set('key1', 'Desc 1', 'value1');
      plugin.set('key2', 'Desc 2', 'value2');

      const listTool = ctx!.tools.get('store_list')!;
      const result = await listTool.execute({ store: 'whiteboard' });

      expect(result).toHaveProperty('entries');
      expect((result as any).entries.length).toBe(2);
    });

    it('should include values in prepared context', async () => {
      const plugin = ctx!.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      plugin.set('live_data', 'Live data entry', { count: 42 });

      ctx!.addUserMessage('test');
      const { input } = await ctx!.prepare();

      const systemMsg = input[0] as any;
      const text = systemMsg.content[0].text;

      expect(text).toContain('live_data');
      expect(text).toContain('42');
    });
  });

  // ============================================================================
  // PersistentInstructionsPluginNextGen
  // ============================================================================

  describe('PersistentInstructionsPluginNextGen', () => {
    beforeEach(() => {
      ctx = createContextWithFeatures(
        { workingMemory: false, inContextMemory: false, persistentInstructions: true },
        { agentId: PERSIST_AGENT_ID }
      );
    });

    it('should auto-generate agentId if not provided for persistent instructions', () => {
      const testCtx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: false, persistentInstructions: true },
      });

      expect(testCtx.agentId).toBeTruthy();
      expect(testCtx.hasPlugin('persistent_instructions')).toBe(true);

      safeDestroy(testCtx);
    });

    it('should get plugin via getPlugin', () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions');
      expect(plugin).not.toBeNull();
      expect(plugin?.name).toBe('persistent_instructions');
    });

    it('should set and get instructions by key', async () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;

      await plugin.set('style', 'Always be helpful and concise.');
      const entry = await plugin.get('style');

      expect(entry).not.toBeNull();
      expect((entry as any).content).toBe('Always be helpful and concise.');
    });

    it('should manage multiple instruction entries', async () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;

      await plugin.set('rule1', 'Be helpful.');
      await plugin.set('rule2', 'Be concise.');

      const entries = await plugin.get();

      expect(Array.isArray(entries)).toBe(true);
      expect((entries as any[]).length).toBe(2);
    });

    it('should clear instructions', async () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;

      await plugin.set('style', 'Some instructions');
      await plugin.clear();

      const instructions = await plugin.get();

      expect(instructions).toBeNull();
    });

    it('should expose unified store tools for the instructions store', () => {
      const toolNames = ctx!.tools.getEnabled().map(t => t.definition.function.name);

      expect(toolNames).toContain('store_set');
      expect(toolNames).toContain('store_delete');
      expect(toolNames).toContain('store_list');
      expect(toolNames).toContain('store_action');
    });

    it('should execute store_set tool against the instructions store', async () => {
      const setTool = ctx!.tools.get('store_set')!;
      await setTool.execute({
        store: 'instructions',
        key: 'style',
        content: 'New instructions from tool',
      });

      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;
      const entry = await plugin.get('style');

      expect((entry as any).content).toBe('New instructions from tool');
    });

    it('should execute store_delete tool against the instructions store', async () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;
      await plugin.set('style', 'Initial instructions.');

      const deleteTool = ctx!.tools.get('store_delete')!;
      await deleteTool.execute({ store: 'instructions', key: 'style' });

      const entry = await plugin.get('style');
      expect(entry).toBeNull();
    });

    it('should execute store_list tool against the instructions store', async () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;
      await plugin.set('style', 'Test instructions');

      const listTool = ctx!.tools.get('store_list')!;
      const result = await listTool.execute({ store: 'instructions' });

      expect(result).toHaveProperty('entries');
      const entries = (result as any).entries;
      expect(entries.length).toBe(1);
      expect(entries[0].key).toBe('style');
    });

    it('should include instructions in prepared context', async () => {
      const plugin = ctx!.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;
      await plugin.set('language', 'Always respond in French.');

      ctx!.addUserMessage('Hello');
      const { input } = await ctx!.prepare();

      const systemMsg = input[0] as any;
      const text = systemMsg.content[0].text;

      expect(text).toContain('Always respond in French.');
    });
  });

  // ============================================================================
  // Plugin Interactions
  // ============================================================================

  describe('Plugin Interactions', () => {
    it('should work with all plugins enabled', async () => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.full, { agentId: 'full-test-agent' });

      // Use working memory
      await ctx.memory!.store('key', 'desc', 'value');

      // Use in-context memory
      const inCtx = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
      inCtx.set('state', 'State', { active: true });

      // Use persistent instructions
      const pi = ctx.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;
      await pi.set('Be creative.');

      // Prepare context
      ctx.addUserMessage('test');
      const { input, budget } = await ctx.prepare();

      const systemMsg = input[0] as any;
      const text = systemMsg.content[0].text;

      expect(text).toContain('Be creative');
      expect(text).toContain('state');
      expect(text).toContain('key');

      expect(budget.breakdown.persistentInstructions).toBeGreaterThan(0);
      expect(budget.breakdown.pluginContents['in_context_memory']).toBeGreaterThan(0);
      expect(budget.breakdown.pluginContents['working_memory']).toBeGreaterThan(0);
    });

    it('should include plugin instructions for enabled plugins', async () => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.full, { agentId: 'instructions-test' });

      ctx.addUserMessage('test');
      const { input, budget } = await ctx.prepare();

      const systemMsg = input[0] as any;
      const text = systemMsg.content[0].text;

      // Section headers come from formatPluginName('working_memory') etc.
      expect(text).toContain('Working Memory');
      expect(text).toContain('In Context Memory');

      expect(budget.breakdown.pluginInstructions).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Plugin State Serialization
  // ============================================================================

  describe('Plugin State Serialization', () => {
    it('should serialize and restore working memory state', async () => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.memoryOnly);

      await ctx.memory!.store('key1', 'Desc 1', 'value1');
      await ctx.memory!.store('key2', 'Desc 2', { nested: 'data' });

      const state = ctx.memory!.getState();

      const ctx2 = createContextWithFeatures(FEATURE_PRESETS.memoryOnly);
      ctx2.memory!.restoreState(state);

      const value1 = await ctx2.memory!.retrieve('key1');
      const value2 = await ctx2.memory!.retrieve('key2');

      expect(value1).toBe('value1');
      expect(value2).toEqual({ nested: 'data' });

      safeDestroy(ctx2);
    });

    it('should serialize in-context memory state', () => {
      ctx = createContextWithFeatures(FEATURE_PRESETS.inContextOnly);
      const plugin = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;

      plugin.set('key1', 'Desc 1', 'value1', 'high');
      plugin.set('key2', 'Desc 2', 'value2', 'low');

      const state = plugin.getState() as any;

      expect(state.entries).toHaveLength(2);
      expect(state.entries.find((e: any) => e.key === 'key1')).toBeDefined();
    });
  });
});
