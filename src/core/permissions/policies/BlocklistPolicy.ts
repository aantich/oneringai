/**
 * BlocklistPolicy - Block tools by name.
 *
 * Returns `deny` for tools in the blocklist, `abstain` for others.
 * Runs at high priority (5) to block before any other policy can allow.
 */

import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export class BlocklistPolicy implements IPermissionPolicy {
  readonly name = 'builtin:blocklist';
  readonly priority = 5;
  readonly description = 'Block tools by name (cannot be overridden by approval)';

  private readonly blocklist: Set<string>;

  constructor(blocklist: Iterable<string>) {
    this.blocklist = new Set(blocklist);
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    if (this.blocklist.has(ctx.toolName)) {
      return {
        verdict: 'deny',
        reason: `Tool '${ctx.toolName}' is blocklisted`,
        policyName: this.name,
        // No needsApproval — blocklist is absolute
      };
    }
    return { verdict: 'abstain', reason: '', policyName: this.name };
  }

  /** Add a tool to the blocklist at runtime */
  add(toolName: string): void {
    this.blocklist.add(toolName);
  }

  /** Remove a tool from the blocklist at runtime */
  remove(toolName: string): boolean {
    return this.blocklist.delete(toolName);
  }

  /** Check if a tool is in the blocklist */
  has(toolName: string): boolean {
    return this.blocklist.has(toolName);
  }

  /** Get all blocklisted tool names */
  getAll(): string[] {
    return Array.from(this.blocklist);
  }
}

export const BlocklistPolicyFactory: IPermissionPolicyFactory = {
  type: 'blocklist',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const tools = (def.config.tools as string[]) ?? [];
    const policy = new BlocklistPolicy(tools);
    return Object.assign(policy, { priority: def.priority ?? 5 });
  },
};
