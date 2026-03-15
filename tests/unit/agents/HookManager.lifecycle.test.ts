/**
 * HookManager Lifecycle & Edge Case Tests
 *
 * Covers disabled hooks, error isolation, clear(), async errors,
 * hook removal, duplicate registration, and empty hook lists.
 * Complements the existing HookManager.test.ts (which covers registration,
 * execution order, merging, skip, parallel, timeout, and re-enabling).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { HookManager } from '@/capabilities/agents/HookManager.js';

describe('HookManager - Lifecycle & Edge Cases', () => {
  let emitter: EventEmitter;
  let hookManager: HookManager;

  const makeContext = (overrides: Record<string, unknown> = {}) => ({
    executionId: 'test-lifecycle',
    config: {} as any,
    timestamp: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    emitter = new EventEmitter();
    hookManager = new HookManager({}, emitter);
  });

  it('should not execute a disabled hook', async () => {
    const failingHook = vi.fn().mockImplementation(() => {
      throw new Error('fail');
    });

    hookManager.register('before:execution', failingHook);

    // Trigger 3 failures to auto-disable
    for (let i = 0; i < 3; i++) {
      await hookManager.executeHooks('before:execution', makeContext(), {});
    }

    expect(hookManager.getDisabledHooks().length).toBe(1);

    // Reset mock call count
    failingHook.mockClear();

    // Execute again — disabled hook should NOT be called
    await hookManager.executeHooks('before:execution', makeContext(), {});
    expect(failingHook).not.toHaveBeenCalled();
  });

  it('should not let one hook error affect other hooks in the same event', async () => {
    const results: string[] = [];

    hookManager.register('before:execution', () => {
      results.push('first');
      return {};
    });

    hookManager.register('before:execution', () => {
      throw new Error('second hook fails');
    });

    hookManager.register('before:execution', () => {
      results.push('third');
      return {};
    });

    await hookManager.executeHooks('before:execution', makeContext(), {});

    // First and third hooks should still run; second failed silently
    expect(results).toEqual(['first', 'third']);
  });

  it('should remove all hooks, error counts, and disabled hooks on clear()', () => {
    const failingHook = vi.fn().mockImplementation(() => {
      throw new Error('fail');
    });

    hookManager.register('before:execution', failingHook);
    hookManager.register('after:execution', vi.fn());
    hookManager.register('before:tool', vi.fn());

    expect(hookManager.getHookCount()).toBe(3);

    hookManager.clear();

    expect(hookManager.getHookCount()).toBe(0);
    expect(hookManager.hasHooks('before:execution')).toBe(false);
    expect(hookManager.hasHooks('after:execution')).toBe(false);
    expect(hookManager.hasHooks('before:tool')).toBe(false);
    expect(hookManager.getDisabledHooks()).toHaveLength(0);
  });

  it('should catch and isolate async errors without crashing', async () => {
    const errorSpy = vi.fn();
    emitter.on('hook:error', errorSpy);

    hookManager.register('before:execution', async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('Async error inside hook');
    });

    // Should not throw
    const result = await hookManager.executeHooks(
      'before:execution',
      makeContext(),
      { fallback: true },
    );

    // Default result returned
    expect(result).toEqual({ fallback: true });

    // Error was emitted
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0].error.message).toBe('Async error inside hook');
  });

  it('should free the hook function reference after unregister()', () => {
    const hook = vi.fn().mockReturnValue({});

    hookManager.register('before:execution', hook);
    expect(hookManager.getHookCount('before:execution')).toBe(1);

    const removed = hookManager.unregister('before:execution', hook);
    expect(removed).toBe(true);
    expect(hookManager.getHookCount('before:execution')).toBe(0);
    expect(hookManager.hasHooks('before:execution')).toBe(false);
  });

  it('should return false when unregistering a hook that was never registered', () => {
    const hook = vi.fn();
    const removed = hookManager.unregister('before:execution', hook);
    expect(removed).toBe(false);
  });

  it('should allow adding the same function reference twice', () => {
    const hook = vi.fn().mockReturnValue({});

    hookManager.register('before:execution', hook);
    hookManager.register('before:execution', hook);

    expect(hookManager.getHookCount('before:execution')).toBe(2);
  });

  it('should execute the same hook reference twice when registered twice', async () => {
    const hook = vi.fn().mockReturnValue({ val: 1 });

    hookManager.register('before:execution', hook);
    hookManager.register('before:execution', hook);

    await hookManager.executeHooks('before:execution', makeContext(), {});

    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('should return default result and not error with empty hook list', async () => {
    // No hooks registered at all
    const defaultResult = { status: 'ok', data: 42 };

    const result = await hookManager.executeHooks(
      'before:execution',
      makeContext(),
      defaultResult,
    );

    expect(result).toEqual(defaultResult);
  });

  it('should properly destroy and prevent further use patterns', () => {
    hookManager.register('before:execution', vi.fn());
    hookManager.register('after:execution', vi.fn());

    expect(hookManager.getHookCount()).toBe(2);

    hookManager.destroy();

    expect(hookManager.isDestroyed).toBe(true);
    expect(hookManager.getHookCount()).toBe(0);
    expect(hookManager.getDisabledHooks()).toHaveLength(0);
  });

  it('should only unregister the first matching reference when registered twice', () => {
    const hook = vi.fn().mockReturnValue({});

    hookManager.register('before:execution', hook);
    hookManager.register('before:execution', hook);

    expect(hookManager.getHookCount('before:execution')).toBe(2);

    // Unregister removes only the first occurrence (indexOf + splice)
    hookManager.unregister('before:execution', hook);
    expect(hookManager.getHookCount('before:execution')).toBe(1);

    hookManager.unregister('before:execution', hook);
    expect(hookManager.getHookCount('before:execution')).toBe(0);
  });
});
