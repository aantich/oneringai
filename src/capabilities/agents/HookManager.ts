/**
 * Hook manager - handles hook registration and execution
 * Includes error isolation, timeouts, and optional parallel execution
 */

import { EventEmitter } from 'eventemitter3';
import {
  Hook,
  HookConfig,
  HookName,
  HookSignatures,
} from './types/HookTypes.js';

export class HookManager {
  private hooks: Map<HookName, Hook<any, any>[]> = new Map();
  private timeout: number;
  private parallel: boolean;
  // Per-hook error tracking: hookKey -> consecutive error count
  private hookErrorCounts: Map<string, number> = new Map();
  // Disabled hooks that exceeded error threshold
  private disabledHooks: Set<string> = new Set();
  private maxConsecutiveErrors: number = 3;
  private emitter: EventEmitter;

  constructor(
    config: HookConfig = {},
    emitter: EventEmitter,
    errorHandling?: { maxConsecutiveErrors?: number }
  ) {
    this.timeout = config.hookTimeout || 5000; // 5 second default
    this.parallel = config.parallelHooks || false;
    this.emitter = emitter;
    this.maxConsecutiveErrors = errorHandling?.maxConsecutiveErrors || 3;

    // Register hooks from config
    this.registerFromConfig(config);
  }

  /**
   * Register hooks from configuration
   */
  private registerFromConfig(config: HookConfig): void {
    const hookNames: HookName[] = [
      'before:execution',
      'after:execution',
      'before:llm',
      'after:llm',
      'before:tool',
      'after:tool',
      'approve:tool',
      'pause:check',
    ];

    for (const name of hookNames) {
      const hook = config[name];
      if (hook) {
        this.register(name, hook);
      }
    }
  }

  /**
   * Register a hook
   */
  register(name: HookName, hook: Hook<any, any>): void {
    // Validate hook is a function
    if (typeof hook !== 'function') {
      throw new Error(`Hook must be a function, got: ${typeof hook}`);
    }

    // Get or create hooks array
    if (!this.hooks.has(name)) {
      this.hooks.set(name, []);
    }

    const existing = this.hooks.get(name)!;

    // Limit number of hooks per name
    if (existing.length >= 10) {
      throw new Error(`Too many hooks for ${name} (max: 10)`);
    }

    existing.push(hook);
  }

  /**
   * Unregister a specific hook function by reference.
   * Returns true if the hook was found and removed.
   */
  unregister(name: HookName, hook: Hook<any, any>): boolean {
    const hooks = this.hooks.get(name);
    if (!hooks) return false;

    const index = hooks.indexOf(hook);
    if (index === -1) return false;

    hooks.splice(index, 1);
    return true;
  }

  /**
   * Execute hooks for a given name
   */
  async executeHooks<K extends HookName>(
    name: K,
    context: HookSignatures[K]['context'],
    defaultResult: HookSignatures[K]['result']
  ): Promise<HookSignatures[K]['result']> {
    const hooks = this.hooks.get(name);

    if (!hooks || hooks.length === 0) {
      return defaultResult;
    }

    // Parallel execution (for independent hooks)
    if (this.parallel && hooks.length > 1) {
      return this.executeHooksParallel(hooks, context, defaultResult);
    }

    // Sequential execution (default)
    return this.executeHooksSequential(hooks, context, defaultResult);
  }

  /**
   * Execute hooks sequentially
   */
  private async executeHooksSequential<T>(
    hooks: Hook<any, any>[],
    context: any,
    defaultResult: T
  ): Promise<T> {
    let result = defaultResult;

    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i]!;
      const hookKey = this.getHookKey(hook, i);
      const hookResult = await this.executeHookSafely(hook, context, hookKey);

      // Skip failed hooks (loose equality catches both null and undefined)
      if (hookResult == null) {
        continue;
      }

      // Merge hook result
      result = { ...result, ...hookResult };

      // Check for early exit
      if ((hookResult as any).skip === true) {
        break;
      }
    }

    return result;
  }

  /**
   * Execute hooks in parallel
   */
  private async executeHooksParallel<T>(
    hooks: Hook<any, any>[],
    context: any,
    defaultResult: T
  ): Promise<T> {
    // Execute all hooks concurrently with unique keys
    const results = await Promise.all(
      hooks.map((hook, i) => {
        const hookKey = this.getHookKey(hook, i);
        return this.executeHookSafely(hook, context, hookKey);
      })
    );

    // Filter out failures and merge results
    const validResults = results.filter((r) => r != null);

    return validResults.reduce(
      (acc, hookResult) => ({ ...acc, ...hookResult }),
      defaultResult
    );
  }

  /**
   * Generate unique key for a hook
   */
  private getHookKey(hook: Hook<any, any>, index: number): string {
    return `${hook.name || 'anonymous'}_${index}`;
  }

  /**
   * Execute single hook with error isolation and timeout (with per-hook error tracking)
   */
  private async executeHookSafely<T>(
    hook: Hook<any, any>,
    context: any,
    hookKey?: string
  ): Promise<T | null> {
    const key = hookKey || hook.name || 'anonymous';

    // Skip disabled hooks
    if (this.disabledHooks.has(key)) {
      return null;
    }

    const startTime = Date.now();

    try {
      // Execute with timeout
      const result = await Promise.race([
        hook(context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Hook timeout')), this.timeout)
        ),
      ]);

      // Reset error counter for this hook on success
      this.hookErrorCounts.delete(key);

      // Track timing
      const duration = Date.now() - startTime;
      if (context.context?.updateMetrics) {
        context.context.updateMetrics({
          hookDuration: (context.context.metrics.hookDuration || 0) + duration,
        });
      }

      return result as T;
    } catch (error) {
      // Increment error counter for this specific hook
      const errorCount = (this.hookErrorCounts.get(key) || 0) + 1;
      this.hookErrorCounts.set(key, errorCount);

      // Emit error event
      this.emitter.emit('hook:error', {
        executionId: context.executionId,
        hookName: hook.name || 'anonymous',
        error: error as Error,
        consecutiveErrors: errorCount,
        timestamp: new Date(),
      });

      // Check consecutive error threshold for this hook
      if (errorCount >= this.maxConsecutiveErrors) {
        // Disable this specific hook, not all hooks
        this.disabledHooks.add(key);
        console.warn(
          `Hook "${key}" disabled after ${errorCount} consecutive failures. Last error: ${(error as Error).message}`
        );
      } else {
        // Log warning but continue (degraded mode)
        console.warn(
          `Hook execution failed (${key}): ${(error as Error).message} (${errorCount}/${this.maxConsecutiveErrors} errors)`
        );
      }

      return null; // Hook failed, skip its result
    }
  }

  /**
   * Check if there are any hooks registered
   */
  hasHooks(name: HookName): boolean {
    const hooks = this.hooks.get(name);
    return !!hooks && hooks.length > 0;
  }

  /**
   * Get hook count
   */
  getHookCount(name?: HookName): number {
    if (name) {
      return this.hooks.get(name)?.length || 0;
    }
    // Total across all hooks
    return Array.from(this.hooks.values()).reduce((sum, arr) => sum + arr.length, 0);
  }

  /**
   * Clear all hooks and reset error tracking
   */
  clear(): void {
    this.hooks.clear();
    this.hookErrorCounts.clear();
    this.disabledHooks.clear();
  }

  /**
   * Destroy the hook manager and release all references
   */
  destroy(): void {
    this.hooks.clear();
    this.hookErrorCounts.clear();
    this.disabledHooks.clear();
  }

  /**
   * Re-enable a disabled hook
   */
  enableHook(hookKey: string): void {
    this.disabledHooks.delete(hookKey);
    this.hookErrorCounts.delete(hookKey);
  }

  /**
   * Get list of disabled hooks
   */
  getDisabledHooks(): string[] {
    return Array.from(this.disabledHooks);
  }
}
