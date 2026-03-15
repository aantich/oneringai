/**
 * RolePolicy - Role-based access control for tools.
 *
 * Semantics:
 * - User can have multiple roles
 * - Rules are matched against user's roles
 * - Deny rules take precedence over allow rules (across ALL matched rules)
 * - No role match → abstain
 *
 * v1: Tool-level only (no argument conditions).
 */

import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export interface RoleRule {
  /** Role this rule applies to */
  role: string;

  /** Tools this role is allowed to use */
  allowTools?: string[];

  /** Tools this role is denied from using (takes precedence over allow) */
  denyTools?: string[];
}

export class RolePolicy implements IPermissionPolicy {
  readonly name = 'builtin:role';
  readonly priority = 30;
  readonly description = 'Role-based access control (deny beats allow, no match = abstain)';

  private readonly rules: RoleRule[];

  constructor(rules: RoleRule[]) {
    this.rules = rules;
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    const userRoles = ctx.roles;
    if (!userRoles || userRoles.length === 0) {
      return { verdict: 'abstain', reason: 'No user roles', policyName: this.name };
    }

    let hasExplicitDeny = false;
    let hasExplicitAllow = false;

    // Check all rules for all user roles
    for (const rule of this.rules) {
      if (!userRoles.includes(rule.role)) continue;

      // Check deny first (deny beats allow)
      if (rule.denyTools) {
        if (rule.denyTools.includes('*') || rule.denyTools.includes(ctx.toolName)) {
          hasExplicitDeny = true;
        }
      }

      // Check allow
      if (rule.allowTools) {
        if (rule.allowTools.includes('*') || rule.allowTools.includes(ctx.toolName)) {
          hasExplicitAllow = true;
        }
      }
    }

    // Deny beats allow
    if (hasExplicitDeny) {
      return {
        verdict: 'deny',
        reason: `Tool '${ctx.toolName}' denied by role policy`,
        policyName: this.name,
        // Role-based denials are hard blocks — no approval override
      };
    }

    if (hasExplicitAllow) {
      return {
        verdict: 'allow',
        reason: `Tool '${ctx.toolName}' allowed by role policy`,
        policyName: this.name,
      };
    }

    // No matching rules for user's roles
    return { verdict: 'abstain', reason: 'No matching role rules', policyName: this.name };
  }
}

export const RolePolicyFactory: IPermissionPolicyFactory = {
  type: 'role',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const rules = (def.config.rules as RoleRule[]) ?? [];
    const policy = new RolePolicy(rules);
    return Object.assign(policy, { priority: def.priority ?? 30 });
  },
};
