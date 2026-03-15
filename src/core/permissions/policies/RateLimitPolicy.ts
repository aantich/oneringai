/**
 * RateLimitPolicy - Per-tool rate limiting.
 *
 * In-memory only for v1 — counters reset on process restart.
 * Uses a sliding window approach.
 *
 * NOT persisted. For distributed rate limiting, implement a custom
 * IPermissionPolicy with external state (Redis, etc.).
 */

import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export interface RateLimitConfig {
  /** Per-tool limits. Key is tool name, value is limit config. */
  limits: Record<string, { maxCalls: number; windowMs: number }>;

  /** Default limit for tools not explicitly configured. If omitted, unconfigured tools are not limited. */
  defaultLimit?: { maxCalls: number; windowMs: number };
}

interface CallRecord {
  timestamps: number[];
}

export class RateLimitPolicy implements IPermissionPolicy {
  readonly name = 'builtin:rate-limit';
  readonly priority = 20;
  readonly description = 'Per-tool rate limiting (in-memory, resets on process restart)';

  private readonly limits: Map<string, { maxCalls: number; windowMs: number }>;
  private readonly defaultLimit?: { maxCalls: number; windowMs: number };
  private readonly records = new Map<string, CallRecord>();

  constructor(config: RateLimitConfig) {
    this.limits = new Map(Object.entries(config.limits));
    this.defaultLimit = config.defaultLimit;
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    const limit = this.limits.get(ctx.toolName) ?? this.defaultLimit;
    if (!limit) {
      return { verdict: 'abstain', reason: '', policyName: this.name };
    }

    const now = Date.now();
    const windowStart = now - limit.windowMs;

    // Periodic cleanup of stale entries (tools not called in 2x their window)
    if (this.records.size > 100) {
      for (const [toolName, record] of this.records) {
        const toolLimit = this.limits.get(toolName) ?? this.defaultLimit;
        if (!toolLimit) continue;
        const staleThreshold = now - (toolLimit.windowMs * 2);
        const lastCall = record.timestamps[record.timestamps.length - 1];
        if (lastCall !== undefined && lastCall < staleThreshold) {
          this.records.delete(toolName);
        }
      }
    }

    // Get or create record
    let record = this.records.get(ctx.toolName);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(ctx.toolName, record);
    }

    // Trim timestamps outside window
    record.timestamps = record.timestamps.filter((t) => t > windowStart);

    // Check limit
    if (record.timestamps.length >= limit.maxCalls) {
      const oldestInWindow = record.timestamps[0]!;
      const retryAfterMs = oldestInWindow + limit.windowMs - now;

      return {
        verdict: 'deny',
        reason: `Rate limit exceeded for '${ctx.toolName}': ${limit.maxCalls} calls per ${limit.windowMs}ms (retry after ${Math.ceil(retryAfterMs)}ms)`,
        policyName: this.name,
        // Rate limit denials are hard blocks — no approval override
      };
    }

    // Record this call (it will execute)
    record.timestamps.push(now);

    return { verdict: 'abstain', reason: '', policyName: this.name };
  }

  /**
   * Reset counters for a specific tool or all tools.
   */
  reset(toolName?: string): void {
    if (toolName) {
      this.records.delete(toolName);
    } else {
      this.records.clear();
    }
  }
}

export const RateLimitPolicyFactory: IPermissionPolicyFactory = {
  type: 'rate-limit',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const config = def.config as unknown as RateLimitConfig;
    const policy = new RateLimitPolicy(config);
    return Object.assign(policy, { priority: def.priority ?? 20 });
  },
};
