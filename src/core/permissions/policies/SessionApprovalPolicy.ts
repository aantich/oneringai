/**
 * SessionApprovalPolicy - Approval cache with argument-scoped keys.
 *
 * Reads tool self-declared permissions from `PolicyContext.toolPermissionConfig`
 * (set by tool author, possibly overridden at registration time).
 *
 * - scope 'always' → allow
 * - scope 'never' → deny (hard block)
 * - scope 'session' → check argument-scoped cache, deny with needsApproval if not cached
 * - scope 'once' (default) → always deny with needsApproval
 *
 * Approval keys are scoped by argument when upstream policies provide them
 * (e.g., "write_file:/workspace/foo.txt"), otherwise fallback to tool name.
 *
 * This policy runs late (priority 90) so argument-inspecting policies run first.
 */

import type {
  IPermissionPolicy,
  PolicyContext,
  PolicyDecision,
  PermissionScope,
  ApprovalCacheEntry,
  IPermissionPolicyFactory,
  StoredPolicyDefinition,
} from '../types.js';

export class SessionApprovalPolicy implements IPermissionPolicy {
  readonly name = 'builtin:session-approval';
  readonly priority = 90;
  readonly description = 'Session-level approval cache with argument-scoped keys';

  /** Approval cache: approvalKey → entry */
  private cache = new Map<string, ApprovalCacheEntry>();

  // Reserved for future use — the legacy config passes defaultScope but currently
  // we only evaluate tools that explicitly declare a scope via toolPermissionConfig.
  constructor(_defaultScope: PermissionScope = 'once') {
    // intentionally unused for now — tools without config abstain
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    const toolConfig = ctx.toolPermissionConfig;

    // If tool has no permission config at all, abstain and let chain default decide.
    // This preserves backward compatibility — tools without declarations are not blocked.
    if (!toolConfig?.scope) {
      return { verdict: 'abstain', reason: 'No tool permission config', policyName: this.name };
    }

    const scope = toolConfig.scope;

    // Tool self-declares as always safe
    if (scope === 'always') {
      return {
        verdict: 'allow',
        reason: `Tool '${ctx.toolName}' declares scope 'always'`,
        policyName: this.name,
      };
    }

    // Tool self-declares as never allowed
    if (scope === 'never') {
      return {
        verdict: 'deny',
        reason: `Tool '${ctx.toolName}' declares scope 'never'`,
        policyName: this.name,
        // No needsApproval — scope 'never' is absolute
      };
    }

    // Session scope: check cache
    if (scope === 'session') {
      // Check tool-level approval key
      if (this.isApproved(ctx.toolName)) {
        return {
          verdict: 'allow',
          reason: `Tool '${ctx.toolName}' approved for session (key: ${ctx.toolName})`,
          policyName: this.name,
        };
      }

      // Also check any argument-scoped keys that might be cached
      // (e.g., "write_file:/workspace/foo" from PathRestrictionPolicy)
      for (const key of this.cache.keys()) {
        if (key.startsWith(ctx.toolName + ':') && this.isApproved(key)) {
          return {
            verdict: 'allow',
            reason: `Tool '${ctx.toolName}' approved for session (key: ${key})`,
            policyName: this.name,
          };
        }
      }

      return {
        verdict: 'deny',
        reason: `Tool '${ctx.toolName}' requires session approval`,
        policyName: this.name,
        metadata: {
          needsApproval: true,
          approvalKey: ctx.toolName,
          approvalScope: 'session',
        },
      };
    }

    // Default: 'once' — always require approval
    return {
      verdict: 'deny',
      reason: `Tool '${ctx.toolName}' requires per-call approval`,
      policyName: this.name,
      metadata: {
        needsApproval: true,
        approvalKey: ctx.toolName,
        approvalScope: 'once',
      },
    };
  }

  // ===== Cache Management =====

  /**
   * Record an approval in the cache.
   */
  approve(approvalKey: string, options?: {
    scope?: PermissionScope;
    approvedBy?: string;
    ttlMs?: number;
  }): void {
    const scope = options?.scope ?? 'session';
    const expiresAt = options?.ttlMs
      ? new Date(Date.now() + options.ttlMs)
      : undefined;

    this.cache.set(approvalKey, {
      toolName: approvalKey, // using approvalKey as the identifier
      scope,
      approvedAt: new Date(),
      approvedBy: options?.approvedBy,
      expiresAt,
    });
  }

  /**
   * Check if an approval key is cached and valid.
   */
  isApproved(approvalKey: string): boolean {
    const entry = this.cache.get(approvalKey);
    if (!entry) return false;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.cache.delete(approvalKey);
      return false;
    }

    return true;
  }

  /**
   * Revoke an approval.
   */
  revoke(approvalKey: string): boolean {
    return this.cache.delete(approvalKey);
  }

  /**
   * Clear all session approvals.
   */
  clearSession(): void {
    this.cache.clear();
  }

  /**
   * Get all cached approval entries.
   */
  getApprovals(): Map<string, ApprovalCacheEntry> {
    // Clean expired first
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        this.cache.delete(key);
      }
    }
    return new Map(this.cache);
  }
}

export const SessionApprovalPolicyFactory: IPermissionPolicyFactory = {
  type: 'session-approval',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const scope = (def.config.defaultScope as PermissionScope) ?? 'once';
    const policy = new SessionApprovalPolicy(scope);
    return Object.assign(policy, { priority: def.priority ?? 90 });
  },
};
