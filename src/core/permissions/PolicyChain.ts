/**
 * PolicyChain - Evaluates a sorted list of permission policies.
 *
 * Evaluation semantics:
 * - Policies run in priority order (lower priority number = runs first)
 * - **Deny short-circuits immediately** — no further policies are evaluated
 * - **Allow is remembered but does NOT short-circuit** — later policies can still deny
 * - If no deny and at least one allow → allow
 * - If all policies abstain → defaultVerdict (default: 'deny')
 *
 * This ensures that argument-level restrictions (e.g., BashFilterPolicy denying
 * `rm -rf /`) always run even if AllowlistPolicy already allowed `bash`.
 */

import type { IPermissionPolicy, PolicyChainConfig, PolicyContext, PolicyDecision } from './types.js';

const DEFAULT_PRIORITY = 100;

export class PolicyChain {
  private policies: IPermissionPolicy[] = [];
  private sortedPolicies: IPermissionPolicy[] = [];
  private config: Required<PolicyChainConfig>;

  constructor(config: PolicyChainConfig = {}) {
    this.config = {
      defaultVerdict: config.defaultVerdict ?? 'deny',
    };
  }

  /**
   * Add a policy to the chain. Replaces any existing policy with the same name.
   */
  add(policy: IPermissionPolicy): void {
    this.remove(policy.name);
    this.policies.push(policy);
    this.rebuildSorted();
  }

  /**
   * Remove a policy by name.
   */
  remove(name: string): boolean {
    const idx = this.policies.findIndex((p) => p.name === name);
    if (idx === -1) return false;
    this.policies.splice(idx, 1);
    this.rebuildSorted();
    return true;
  }

  /**
   * Check if a policy with the given name exists.
   */
  has(name: string): boolean {
    return this.policies.some((p) => p.name === name);
  }

  /**
   * List all policies, sorted by priority.
   */
  list(): IPermissionPolicy[] {
    return [...this.sortedPolicies];
  }

  /**
   * Get policy count.
   */
  get size(): number {
    return this.policies.length;
  }

  /**
   * Evaluate all policies against the given context.
   *
   * - Deny short-circuits immediately
   * - Allow is remembered, evaluation continues
   * - All abstain → defaultVerdict
   */
  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    let firstAllow: PolicyDecision | undefined;

    for (const policy of this.sortedPolicies) {
      const decision = await policy.evaluate(context);

      if (decision.verdict === 'deny') {
        return decision; // immediate stop
      }

      if (decision.verdict === 'allow' && !firstAllow) {
        firstAllow = decision; // remember, but keep evaluating
      }
    }

    if (firstAllow) {
      return firstAllow;
    }

    return {
      verdict: this.config.defaultVerdict === 'allow' ? 'allow' : 'deny',
      reason: this.config.defaultVerdict === 'allow'
        ? 'No policy denied execution (default: allow)'
        : 'No policy allowed execution (default: deny)',
      policyName: 'chain:default',
    };
  }

  /**
   * Clear all policies.
   */
  clear(): void {
    this.policies = [];
    this.sortedPolicies = [];
  }

  private rebuildSorted(): void {
    this.sortedPolicies = [...this.policies].sort(
      (a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY),
    );
  }
}
