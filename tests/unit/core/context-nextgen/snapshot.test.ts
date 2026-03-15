/**
 * Snapshot API Unit Tests
 *
 * Tests for getSnapshot() and getViewContext() on AgentContextNextGen.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { formatPluginDisplayName } from '@/core/context-nextgen/snapshot.js';
import type { IContextSnapshot, IViewContextData } from '@/core/context-nextgen/snapshot.js';

describe('AgentContextNextGen.getSnapshot()', () => {
  let ctx: AgentContextNextGen;

  afterEach(() => {
    ctx?.destroy();
  });

  it('should return a valid snapshot with default features', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      systemPrompt: 'You are a test assistant.',
    });

    const snapshot = await ctx.getSnapshot();

    expect(snapshot.available).toBe(true);
    expect(snapshot.model).toBe('gpt-4');
    expect(snapshot.systemPrompt).toBe('You are a test assistant.');
    expect(snapshot.messagesCount).toBe(0);
    expect(snapshot.toolCallsCount).toBe(0);
    expect(snapshot.strategy).toBeTruthy();
    expect(snapshot.budget).toBeDefined();
    expect(snapshot.budget.maxTokens).toBeGreaterThan(0);
    expect(snapshot.features).toBeDefined();
    expect(Array.isArray(snapshot.plugins)).toBe(true);
    expect(Array.isArray(snapshot.tools)).toBe(true);
  });

  it('should auto-discover plugins', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      features: {
        workingMemory: true,
        inContextMemory: true,
      },
    });

    const snapshot = await ctx.getSnapshot();
    const pluginNames = snapshot.plugins.map((p) => p.name);

    expect(pluginNames).toContain('working_memory');
    expect(pluginNames).toContain('in_context_memory');
  });

  it('should include plugin display names', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      features: { workingMemory: true },
    });

    const snapshot = await ctx.getSnapshot();
    const wmPlugin = snapshot.plugins.find((p) => p.name === 'working_memory');

    expect(wmPlugin).toBeDefined();
    expect(wmPlugin!.displayName).toBe('Working Memory');
    expect(wmPlugin!.enabled).toBe(true);
    expect(typeof wmPlugin!.tokenSize).toBe('number');
    expect(typeof wmPlugin!.instructionsTokenSize).toBe('number');
    expect(typeof wmPlugin!.compactable).toBe('boolean');
  });

  it('should track messages count', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      features: { workingMemory: false, inContextMemory: false },
    });

    ctx.addUserMessage('Hello');
    ctx.addAssistantResponse([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi!' }] },
    ]);

    const snapshot = await ctx.getSnapshot();
    // After addUserMessage + addAssistantResponse, there should be messages in conversation
    expect(snapshot.messagesCount).toBeGreaterThan(0);
  });

  it('should return unavailable snapshot when destroyed', async () => {
    ctx = AgentContextNextGen.create({ model: 'gpt-4' });
    ctx.destroy();

    const snapshot = await ctx.getSnapshot();
    expect(snapshot.available).toBe(false);
    expect(snapshot.plugins).toHaveLength(0);
    expect(snapshot.tools).toHaveLength(0);
  });

  it('should include tool data', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      features: { workingMemory: true },
    });

    const snapshot = await ctx.getSnapshot();
    // IStoreHandler plugins get 5 generic store_* tools registered
    expect(snapshot.tools.length).toBeGreaterThan(0);

    const storeTool = snapshot.tools.find((t) => t.name === 'store_set');
    expect(storeTool).toBeDefined();
    expect(storeTool!.enabled).toBe(true);
    expect(typeof storeTool!.description).toBe('string');
    expect(typeof storeTool!.callCount).toBe('number');
  });

  it('should be fully serializable (JSON round-trip)', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      systemPrompt: 'Test',
      features: { workingMemory: true, inContextMemory: true },
    });

    const snapshot = await ctx.getSnapshot();
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json) as IContextSnapshot;

    expect(parsed.available).toBe(true);
    expect(parsed.model).toBe('gpt-4');
    expect(parsed.plugins.length).toBe(snapshot.plugins.length);
    expect(parsed.tools.length).toBe(snapshot.tools.length);
  });
});

describe('AgentContextNextGen.getViewContext()', () => {
  let ctx: AgentContextNextGen;

  afterEach(() => {
    ctx?.destroy();
  });

  it('should return view context with components', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      systemPrompt: 'Be helpful.',
      features: { workingMemory: false, inContextMemory: false },
    });

    ctx.addUserMessage('Hello');

    const viewCtx = await ctx.getViewContext();

    expect(viewCtx.available).toBe(true);
    expect(viewCtx.components.length).toBeGreaterThan(0);
    expect(viewCtx.totalTokens).toBeGreaterThan(0);
    expect(typeof viewCtx.rawContext).toBe('string');
    expect(viewCtx.rawContext.length).toBeGreaterThan(0);
  });

  it('should include system message component', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      systemPrompt: 'Test system prompt content',
      features: { workingMemory: false, inContextMemory: false },
    });

    const viewCtx = await ctx.getViewContext();
    const systemComponent = viewCtx.components.find((c) => c.name === 'System Message');

    expect(systemComponent).toBeDefined();
    expect(systemComponent!.content).toContain('Test system prompt content');
  });

  it('should return unavailable when destroyed', async () => {
    ctx = AgentContextNextGen.create({ model: 'gpt-4' });
    ctx.destroy();

    const viewCtx = await ctx.getViewContext();
    expect(viewCtx.available).toBe(false);
    expect(viewCtx.components).toHaveLength(0);
  });

  it('should be serializable', async () => {
    ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      features: { workingMemory: false, inContextMemory: false },
    });
    ctx.addUserMessage('Test');

    const viewCtx = await ctx.getViewContext();
    const json = JSON.stringify(viewCtx);
    const parsed = JSON.parse(json) as IViewContextData;

    expect(parsed.available).toBe(true);
    expect(parsed.components.length).toBe(viewCtx.components.length);
  });
});

describe('formatPluginDisplayName()', () => {
  it('should convert snake_case to Title Case', () => {
    expect(formatPluginDisplayName('working_memory')).toBe('Working Memory');
    expect(formatPluginDisplayName('in_context_memory')).toBe('In Context Memory');
    expect(formatPluginDisplayName('persistent_instructions')).toBe('Persistent Instructions');
    expect(formatPluginDisplayName('user_info')).toBe('User Info');
  });

  it('should handle single words', () => {
    expect(formatPluginDisplayName('test')).toBe('Test');
  });
});
