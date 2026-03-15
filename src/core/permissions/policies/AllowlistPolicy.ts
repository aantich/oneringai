/**
 * AllowlistPolicy - Allow tools by name.
 *
 * Returns `allow` for tools in the allowlist, `abstain` for others.
 * Note: allow does NOT short-circuit — later policies (e.g., BashFilterPolicy)
 * can still deny based on arguments.
 */

import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export class AllowlistPolicy implements IPermissionPolicy {
  readonly name = 'builtin:allowlist';
  readonly priority = 10;
  readonly description = 'Allow tools by name (safe tools that never need approval)';

  private readonly allowlist: Set<string>;

  constructor(allowlist: Iterable<string>) {
    this.allowlist = new Set(allowlist);
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    if (this.allowlist.has(ctx.toolName)) {
      return {
        verdict: 'allow',
        reason: `Tool '${ctx.toolName}' is allowlisted`,
        policyName: this.name,
      };
    }
    return { verdict: 'abstain', reason: '', policyName: this.name };
  }

  /** Add a tool to the allowlist at runtime */
  add(toolName: string): void {
    this.allowlist.add(toolName);
  }

  /** Remove a tool from the allowlist at runtime */
  remove(toolName: string): boolean {
    return this.allowlist.delete(toolName);
  }

  /** Check if a tool is in the allowlist */
  has(toolName: string): boolean {
    return this.allowlist.has(toolName);
  }

  /** Get all allowlisted tool names */
  getAll(): string[] {
    return Array.from(this.allowlist);
  }
}

export const AllowlistPolicyFactory: IPermissionPolicyFactory = {
  type: 'allowlist',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const tools = (def.config.tools as string[]) ?? [];
    const policy = new AllowlistPolicy(tools);
    return Object.assign(policy, { priority: def.priority ?? 10 });
  },
};
