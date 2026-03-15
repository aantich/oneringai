/**
 * BashFilterPolicy - Best-effort command filtering for bash tool.
 *
 * IMPORTANT: This is a guardrail, NOT a sandbox. Shell command obfuscation
 * can bypass string-based filtering. For strong isolation, combine with:
 * - Blocklisting bash by default and requiring explicit approval
 * - Path restrictions
 * - Container/sandbox execution
 *
 * Checks deny patterns first (any match → deny), then allow patterns
 * (any match → abstain to let other policies decide). If neither match,
 * returns deny with needsApproval.
 */

import { createHash } from 'crypto';
import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export interface BashFilterConfig {
  /** Regex patterns for denied commands (checked first) */
  denyPatterns?: (string | RegExp)[];

  /** Specific command prefixes to deny */
  denyCommands?: string[];

  /** Regex patterns for allowed commands (if matched, abstain to allow other policies to decide) */
  allowPatterns?: (string | RegExp)[];

  /** Specific command prefixes to allow */
  allowCommands?: string[];

  /** Argument name containing the command. @default 'command' */
  commandArg?: string;
}

export class BashFilterPolicy implements IPermissionPolicy {
  readonly name = 'builtin:bash-filter';
  readonly priority = 50;
  readonly description = 'Best-effort command filtering for bash tool (guardrail, not sandbox)';

  private readonly denyRegexes: RegExp[];
  private readonly denyPrefixes: string[];
  private readonly allowRegexes: RegExp[];
  private readonly allowPrefixes: string[];
  private readonly commandArg: string;

  constructor(config: BashFilterConfig = {}) {
    this.denyRegexes = (config.denyPatterns ?? []).map((p) =>
      typeof p === 'string' ? new RegExp(p) : p,
    );
    this.denyPrefixes = (config.denyCommands ?? []).map((c) => c.toLowerCase().trim());
    this.allowRegexes = (config.allowPatterns ?? []).map((p) =>
      typeof p === 'string' ? new RegExp(p) : p,
    );
    this.allowPrefixes = (config.allowCommands ?? []).map((c) => c.toLowerCase().trim());
    this.commandArg = config.commandArg ?? 'command';
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    // Only apply to bash tool
    if (ctx.toolName !== 'bash') {
      return { verdict: 'abstain', reason: '', policyName: this.name };
    }

    const command = ctx.args[this.commandArg];
    if (typeof command !== 'string') {
      return { verdict: 'abstain', reason: '', policyName: this.name };
    }

    const trimmed = command.trim();
    const lower = trimmed.toLowerCase();

    // 1. Check deny patterns first
    for (const regex of this.denyRegexes) {
      if (regex.test(trimmed)) {
        return {
          verdict: 'deny',
          reason: `Command matches denied pattern: ${regex.source}`,
          policyName: this.name,
          metadata: {
            needsApproval: true,
            approvalKey: `bash:${this.hashCommand(trimmed)}`,
            approvalScope: 'once',
          },
        };
      }
    }

    for (const prefix of this.denyPrefixes) {
      if (lower.startsWith(prefix)) {
        return {
          verdict: 'deny',
          reason: `Command starts with denied prefix: '${prefix}'`,
          policyName: this.name,
          metadata: {
            needsApproval: true,
            approvalKey: `bash:${this.hashCommand(trimmed)}`,
            approvalScope: 'once',
          },
        };
      }
    }

    // 2. Check allow patterns
    for (const regex of this.allowRegexes) {
      if (regex.test(trimmed)) {
        return { verdict: 'abstain', reason: '', policyName: this.name };
      }
    }

    for (const prefix of this.allowPrefixes) {
      if (lower.startsWith(prefix)) {
        return { verdict: 'abstain', reason: '', policyName: this.name };
      }
    }

    // 3. Neither matched — abstain and let other policies decide
    return { verdict: 'abstain', reason: '', policyName: this.name };
  }

  /**
   * Hash command for collision-resistant approval keys.
   * Uses SHA-256 truncated to 16 hex chars for near-zero collision probability.
   */
  private hashCommand(command: string): string {
    const normalized = command.replace(/\s+/g, ' ').trim();
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }
}

export const BashFilterPolicyFactory: IPermissionPolicyFactory = {
  type: 'bash-filter',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const config = def.config as unknown as BashFilterConfig;
    const policy = new BashFilterPolicy(config);
    return Object.assign(policy, { priority: def.priority ?? 50 });
  },
};
