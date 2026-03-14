/**
 * BaseAgent Lifecycle / Destroy Tests
 *
 * Tests destroy behavior, auto-save cleanup, idempotency, and cleanup callbacks.
 * BaseAgent is abstract, so we test via Agent.create().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import type { IContextStorage } from '@/domain/interfaces/IContextStorage.js';

// Mock createProvider so no real LLM calls are made
const mockProvider = {
  name: 'openai',
  capabilities: { text: true, images: true, videos: false, audio: false },
  generate: vi.fn(),
  streamGenerate: vi.fn(),
  getModelCapabilities: vi.fn(() => ({
    supportsTools: true,
    supportsVision: true,
    supportsJSON: true,
    supportsJSONSchema: true,
    maxTokens: 128000,
    maxOutputTokens: 16384,
  })),
};

vi.mock('@/core/createProvider.js', () => ({
  createProvider: vi.fn(() => mockProvider),
}));

/** Minimal mock storage for session tests */
function createMockStorage(): IContextStorage {
  const sessions = new Map<string, unknown>();
  return {
    save: vi.fn(async (id: string, state: unknown) => {
      sessions.set(id, state);
    }),
    load: vi.fn(async (id: string) => {
      return sessions.get(id) ?? null;
    }),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async (id: string) => sessions.has(id)),
    list: vi.fn(async () => []),
  };
}

describe('BaseAgent lifecycle / destroy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();
    Connector.create({
      name: 'test-lifecycle',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Connector.clear();
  });

  // ---- Test 1 ----
  it('should set isDestroyed to true after destroy()', () => {
    const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });
    expect(agent.isDestroyed).toBe(false);

    agent.destroy();
    expect(agent.isDestroyed).toBe(true);
  });

  // ---- Test 2 ----
  it('should be idempotent — calling destroy() twice does not throw', () => {
    const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });

    agent.destroy();
    expect(agent.isDestroyed).toBe(true);

    // Second call should be a no-op, no error
    expect(() => agent.destroy()).not.toThrow();
    expect(agent.isDestroyed).toBe(true);
  });

  // ---- Test 3 ----
  it('should clear auto-save interval on destroy', () => {
    vi.useFakeTimers();
    try {
      const storage = createMockStorage();
      const agent = Agent.create({
        connector: 'test-lifecycle',
        model: 'gpt-4',
        session: { storage, autoSave: true, autoSaveIntervalMs: 5000 },
      });

      // An interval should be registered
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

      agent.destroy();

      // All timers cleared
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- Test 4 ----
  it('should not execute auto-save callback after destroy', async () => {
    vi.useFakeTimers();
    try {
      const storage = createMockStorage();
      const agent = Agent.create({
        connector: 'test-lifecycle',
        model: 'gpt-4',
        session: { storage, id: 'sess-1', autoSave: true, autoSaveIntervalMs: 1000 },
      });

      // Advance past one interval to let pending session load settle
      await vi.advanceTimersByTimeAsync(1500);
      (storage.save as ReturnType<typeof vi.fn>).mockClear();

      agent.destroy();

      // Advance past several auto-save intervals
      await vi.advanceTimersByTimeAsync(5000);

      // save should NOT have been called after destroy
      expect(storage.save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- Test 5 ----
  it('should have no pending timers after create → destroy', () => {
    vi.useFakeTimers();
    try {
      const timersBefore = vi.getTimerCount();
      const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });
      agent.destroy();
      expect(vi.getTimerCount()).toBe(timersBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- Test 6 ----
  it('should execute onCleanup callbacks during destroy', () => {
    const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });
    const cb = vi.fn();
    agent.onCleanup(cb);

    agent.destroy();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // ---- Test 7 ----
  it('should run all cleanup callbacks even if one throws', () => {
    const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });

    const cb1 = vi.fn();
    const cbThrowing = vi.fn(() => {
      throw new Error('cleanup boom');
    });
    const cb3 = vi.fn();

    agent.onCleanup(cb1);
    agent.onCleanup(cbThrowing);
    agent.onCleanup(cb3);

    // destroy should not throw even though one callback does
    expect(() => agent.destroy()).not.toThrow();

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cbThrowing).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
  });

  // ---- Test 8 ----
  it('should call removeAllListeners on destroy', () => {
    const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });

    // Attach a listener
    const listener = vi.fn();
    agent.on('test-event' as any, listener);
    expect(agent.listenerCount('test-event' as any)).toBe(1);

    agent.destroy();

    // All listeners should be removed
    expect(agent.listenerCount('test-event' as any)).toBe(0);
  });

  // ---- Test 9 ----
  it('should not crash when destroying during pending session load', () => {
    const storage = createMockStorage();
    // Make load return a promise that never resolves (simulating slow load)
    (storage.load as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    const agent = Agent.create({
      connector: 'test-lifecycle',
      model: 'gpt-4',
      session: { storage, id: 'pending-session' },
    });

    // Destroy while session load is still pending — should not throw
    expect(() => agent.destroy()).not.toThrow();
    expect(agent.isDestroyed).toBe(true);
  });

  // ---- Test 10 ----
  it('should guard auto-save when context is already destroyed', async () => {
    vi.useFakeTimers();
    try {
      const storage = createMockStorage();
      const agent = Agent.create({
        connector: 'test-lifecycle',
        model: 'gpt-4',
        session: { storage, id: 'guard-test', autoSave: true, autoSaveIntervalMs: 500 },
      });

      // Advance past one interval to let initial session load settle
      await vi.advanceTimersByTimeAsync(1000);
      (storage.save as ReturnType<typeof vi.fn>).mockClear();

      // Destroy the agent context directly (simulating external destruction)
      // Access protected _agentContext via cast
      const ctx = (agent as any)._agentContext;
      ctx.destroy();

      // The auto-save interval may still be active — advance timers
      await vi.advanceTimersByTimeAsync(2000);

      // save should not have been called because the guard checks context.isDestroyed
      expect(storage.save).not.toHaveBeenCalled();

      // Now destroy the agent itself (should not throw despite context already destroyed)
      expect(() => agent.destroy()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- Test 11 ----
  it('should clear _pendingSessionLoad reference on destroy', () => {
    const storage = createMockStorage();
    (storage.load as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => setTimeout(resolve, 10000))
    );

    const agent = Agent.create({
      connector: 'test-lifecycle',
      model: 'gpt-4',
      session: { storage, id: 'clear-ref' },
    });

    // Before destroy, pending load exists
    expect((agent as any)._pendingSessionLoad).not.toBeNull();

    agent.destroy();

    // After destroy, reference is cleared
    expect((agent as any)._pendingSessionLoad).toBeNull();
  });

  // ---- Test 12 ----
  it('should destroy owned AgentContext when agent is destroyed', () => {
    const agent = Agent.create({ connector: 'test-lifecycle', model: 'gpt-4' });
    const ctx = (agent as any)._agentContext;

    expect(ctx.isDestroyed).toBe(false);

    agent.destroy();

    // BaseAgent with _ownsContext=true should destroy the context
    expect(ctx.isDestroyed).toBe(true);
  });
});
