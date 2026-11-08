/**
 * AgentContextNextGen Persistence Integration Tests
 *
 * Tests session persistence functionality:
 * - Save and load conversation history
 * - Save and load plugin states
 * - Session existence checking
 * - Session deletion
 * - Auto-generated vs custom sessionId
 * - Metadata persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AgentContextNextGen } from '../../../src/core/context-nextgen/AgentContextNextGen.js';
import { createFileContextStorage } from '../../../src/infrastructure/storage/FileContextStorage.js';
import type { IContextStorage } from '../../../src/domain/interfaces/IContextStorage.js';
import {
  createContextWithFeatures,
  safeDestroy,
  FEATURE_PRESETS,
} from '../../helpers/contextTestHelpers.js';

describe('AgentContextNextGen Persistence (Mock)', () => {
  let ctx: AgentContextNextGen | null = null;
  let ctx2: AgentContextNextGen | null = null;
  let tempDir: string | null = null;
  let storage: IContextStorage | null = null;

  beforeEach(async () => {
    // Create temp directory for storage
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-persistence-test-'));
    // Create storage for testing
    storage = createFileContextStorage('test-persistence-agent', { baseDirectory: tempDir });
  });

  afterEach(async () => {
    safeDestroy(ctx);
    safeDestroy(ctx2);
    ctx = null;
    ctx2 = null;
    storage = null;

    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      tempDir = null;
    }
  });

  // ============================================================================
  // Basic Save and Load
  // ============================================================================

  describe('Basic Save and Load', () => {
    it('should save and load empty context', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('session-empty');

      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      const loaded = await ctx2.load('session-empty');

      expect(loaded).toBe(true);
      expect(ctx2.getConversation().length).toBe(0);
    });

    it('should save and load conversation history', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      // Add conversation
      ctx.addMessage('user', 'Hello');
      ctx.addMessage('assistant', 'Hi there!');
      ctx.addMessage('user', 'How are you?');
      ctx.addMessage('assistant', 'I am doing well.');

      await ctx.save('session-convo');

      // Create new context and load
      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      const loaded = await ctx2.load('session-convo');

      expect(loaded).toBe(true);
      expect(ctx2.getConversation().length).toBe(4);

      // Verify message content
      const conversation = ctx2.getConversation();
      expect((conversation[0] as any).content[0].text).toContain('Hello');
    });

    it('should save and load system prompt', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        systemPrompt: 'You are a helpful assistant.',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      ctx.addMessage('user', 'test');
      await ctx.save('session-prompt');

      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx2.load('session-prompt');

      expect(ctx2.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('should return false when loading non-existent session', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      const loaded = await ctx.load('non-existent-session');

      expect(loaded).toBe(false);
    });
  });

  // ============================================================================
  // Plugin State Persistence
  // ============================================================================

  describe('Plugin State Persistence', () => {
    // NOTE: Working memory persistence has a limitation - the sync getState() method
    // cannot retrieve async storage entries. This test verifies the current behavior.
    // For full working memory persistence, use Agent.saveSession() which handles this.
    it('should save and load conversation with working memory plugin enabled', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: true },
        storage: storage!,
      });

      // Add some conversation
      ctx.addMessage('user', 'Hello');
      ctx.addMessage('assistant', 'Hi there');

      await ctx.save('session-wm-enabled');

      // Create new context and load
      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: true },
        storage: storage!,
      });

      await ctx2.load('session-wm-enabled');

      // Verify conversation was restored
      expect(ctx2.getConversation().length).toBe(2);
      // Memory plugin should be available after load
      expect(ctx2.memory).not.toBeNull();
    });

    it('should save and load in-context memory state', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: true },
        storage: storage!,
      });

      const plugin = ctx.getPlugin<any>('in_context_memory')!;
      plugin.set('state', 'Current state', { step: 5, status: 'active' }, 'high');

      await ctx.save('session-incontext');

      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: true },
        storage: storage!,
      });

      await ctx2.load('session-incontext');

      const plugin2 = ctx2.getPlugin<any>('in_context_memory')!;
      expect(plugin2.get('state')).toEqual({ step: 5, status: 'active' });
    });

    it('should save and load with multiple plugins (in-context memory)', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: true },
        agentId: 'multi-plugin-agent',
        storage: storage!,
      });

      // Use in-context memory (has sync state serialization)
      const inCtx = ctx.getPlugin<any>('in_context_memory')!;
      inCtx.set('icm_key', 'ICM data', 'icm_value');
      inCtx.set('icm_key2', 'ICM data 2', { nested: true });

      await ctx.save('session-multi');

      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: true },
        agentId: 'multi-plugin-agent',
        storage: storage!,
      });

      await ctx2.load('session-multi');

      // Verify in-context memory was restored
      const icmValue = ctx2.getPlugin<any>('in_context_memory')!.get('icm_key');
      const icmValue2 = ctx2.getPlugin<any>('in_context_memory')!.get('icm_key2');

      expect(icmValue).toBe('icm_value');
      expect(icmValue2).toEqual({ nested: true });
    });
  });

  // ============================================================================
  // Session Management
  // ============================================================================

  describe('Session Management', () => {
    it('should check session existence', async () => {
      // Use unique session name to avoid collision
      const uniqueSessionId = `test-session-${Date.now()}`;

      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      // Before save
      const existsBefore = await ctx.sessionExists(uniqueSessionId);
      expect(existsBefore).toBe(false);

      // After save
      await ctx.save(uniqueSessionId);
      const existsAfter = await ctx.sessionExists(uniqueSessionId);
      expect(existsAfter).toBe(true);
    });

    it('should delete session', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('to-delete-session');
      expect(await ctx.sessionExists('to-delete-session')).toBe(true);

      await ctx.deleteSession('to-delete-session');
      expect(await ctx.sessionExists('to-delete-session')).toBe(false);
    });

    it('should delete current session when no ID provided', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('current-session');
      expect(ctx.sessionId).toBe('current-session');

      await ctx.deleteSession();
      expect(ctx.sessionId).toBeNull();
      expect(await ctx.sessionExists('current-session')).toBe(false);
    });

    it('should auto-generate session ID if not provided', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save();

      expect(ctx.sessionId).not.toBeNull();
      expect(ctx.sessionId!.length).toBeGreaterThan(0);
      expect(await ctx.sessionExists(ctx.sessionId!)).toBe(true);
    });

    it('should use provided session ID', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('my-custom-session-id');

      expect(ctx.sessionId).toBe('my-custom-session-id');
    });

    it('should update session ID after loading', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('original-session');

      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      expect(ctx2.sessionId).toBeNull();
      await ctx2.load('original-session');
      expect(ctx2.sessionId).toBe('original-session');
    });
  });

  // ============================================================================
  // Metadata Persistence
  // ============================================================================

  describe('Metadata Persistence', () => {
    it('should save with custom metadata', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('metadata-session', {
        title: 'My Session',
        tags: ['test', 'example'],
        customField: 123,
      });

      // Verify by loading raw data
      // Note: context.save() merges metadata into state.metadata, not storage.metadata
      const stored = await storage!.load('metadata-session');
      expect(stored).not.toBeNull();
      expect(stored?.state?.metadata?.title).toBe('My Session');
      expect(stored?.state?.metadata?.tags).toEqual(['test', 'example']);
      expect(stored?.state?.metadata?.customField).toBe(123);
    });

    it('should include automatic metadata', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        agentId: 'metadata-test-agent',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await ctx.save('auto-metadata-session');

      const stored = await storage!.load('auto-metadata-session');
      expect(stored?.state.metadata).toHaveProperty('savedAt');
      expect(stored?.state.metadata?.agentId).toBe('metadata-test-agent');
      expect(stored?.state.metadata?.model).toBe('gpt-4');
    });

    it('should merge metadata on save', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      // First save with some metadata
      await ctx.save('merge-metadata-session', { field1: 'value1' });

      // Update some state
      ctx.addMessage('user', 'New message');

      // Save again with additional metadata
      await ctx.save('merge-metadata-session', { field2: 'value2' });

      const stored = await storage!.load('merge-metadata-session');
      // Note: metadata is merged into state.metadata
      expect(stored?.state?.metadata?.field2).toBe('value2');
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw when saving without storage', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        // No storage
      });

      await expect(ctx.save('test')).rejects.toThrow(/storage/i);
    });

    it('should throw when loading without storage', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        // No storage
      });

      await expect(ctx.load('test')).rejects.toThrow(/storage/i);
    });

    it('should throw when deleting without session ID', async () => {
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        features: FEATURE_PRESETS.minimal,
        storage: storage!,
      });

      await expect(ctx.deleteSession()).rejects.toThrow(/session id/i);
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe('Full Workflow', () => {
    it('should support complete save/resume workflow with in-context memory', async () => {
      // Create context and have a conversation
      // Note: WorkingMemory state doesn't persist via context.save() due to async storage
      // Use InContextMemory for state that needs to persist
      ctx = AgentContextNextGen.create({
        model: 'gpt-4',
        systemPrompt: 'You are a helpful assistant.',
        features: { workingMemory: false, inContextMemory: true },
        storage: storage!,
        agentId: 'workflow-agent',
      });

      // Simulate conversation
      ctx.addMessage('user', 'My name is Alice');
      ctx.addMessage('assistant', 'Nice to meet you, Alice!');

      // Store state in in-context memory (this persists correctly)
      ctx.getPlugin<any>('in_context_memory')!.set('user_name', 'User name', 'Alice');
      ctx.getPlugin<any>('in_context_memory')!.set('greeting_done', 'Greeting completed', true);

      // Save session
      await ctx.save('workflow-session', { purpose: 'introduction' });

      // Simulate closing and reopening
      safeDestroy(ctx);
      ctx = null;

      // Create new context and resume
      ctx2 = AgentContextNextGen.create({
        model: 'gpt-4',
        features: { workingMemory: false, inContextMemory: true },
        storage: storage!,
        agentId: 'workflow-agent',
      });

      const loaded = await ctx2.load('workflow-session');
      expect(loaded).toBe(true);

      // Verify everything was restored
      expect(ctx2.systemPrompt).toBe('You are a helpful assistant.');
      expect(ctx2.getConversation().length).toBe(2);
      expect(ctx2.getPlugin<any>('in_context_memory')!.get('user_name')).toBe('Alice');
      expect(ctx2.getPlugin<any>('in_context_memory')!.get('greeting_done')).toBe(true);

      // Continue conversation
      ctx2.addMessage('user', 'What is my name?');

      // Prepare should include all restored state
      const { input, budget } = await ctx2.prepare();

      expect(input.length).toBeGreaterThan(3); // System + 2 history + current input
      expect(budget.totalUsed).toBeGreaterThan(0);
    });
  });
});
