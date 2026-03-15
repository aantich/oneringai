/**
 * Comprehensive tests for the policy-based permission system.
 *
 * Covers: PolicyChain, all built-in policies, UserPermissionRulesEngine,
 * PermissionPolicyManager integration, and PermissionEnforcementPlugin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyChain } from '../../../../src/core/permissions/PolicyChain.js';
import { AllowlistPolicy } from '../../../../src/core/permissions/policies/AllowlistPolicy.js';
import { BlocklistPolicy } from '../../../../src/core/permissions/policies/BlocklistPolicy.js';
import { SessionApprovalPolicy } from '../../../../src/core/permissions/policies/SessionApprovalPolicy.js';
import { PathRestrictionPolicy } from '../../../../src/core/permissions/policies/PathRestrictionPolicy.js';
import { BashFilterPolicy } from '../../../../src/core/permissions/policies/BashFilterPolicy.js';
import { UrlAllowlistPolicy } from '../../../../src/core/permissions/policies/UrlAllowlistPolicy.js';
import { RolePolicy } from '../../../../src/core/permissions/policies/RolePolicy.js';
import { RateLimitPolicy } from '../../../../src/core/permissions/policies/RateLimitPolicy.js';
import { UserPermissionRulesEngine } from '../../../../src/core/permissions/UserPermissionRulesEngine.js';
import { PermissionPolicyManager } from '../../../../src/core/permissions/PermissionPolicyManager.js';
import { PermissionEnforcementPlugin } from '../../../../src/core/permissions/PermissionEnforcementPlugin.js';
import { ToolPermissionDeniedError } from '../../../../src/domain/errors/AIErrors.js';
import type {
  IPermissionPolicy,
  PolicyContext,
  PolicyDecision,
  UserPermissionRule,
  ApprovalDecision,
} from '../../../../src/core/permissions/types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal PolicyContext for testing. */
function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    toolName: 'test_tool',
    args: {},
    ...overrides,
  };
}

/** Create a mock policy with configurable behavior. */
function mockPolicy(
  name: string,
  verdict: 'allow' | 'deny' | 'abstain',
  options: { priority?: number; metadata?: PolicyDecision['metadata']; reason?: string } = {},
): IPermissionPolicy {
  return {
    name,
    priority: options.priority ?? 100,
    evaluate: vi.fn().mockReturnValue({
      verdict,
      reason: options.reason ?? `${name}: ${verdict}`,
      policyName: name,
      metadata: options.metadata,
    }),
  };
}

/** Create a user permission rule. */
function makeRule(overrides: Partial<UserPermissionRule> = {}): UserPermissionRule {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    toolName: overrides.toolName ?? 'test_tool',
    action: overrides.action ?? 'allow',
    enabled: overrides.enabled ?? true,
    createdBy: overrides.createdBy ?? 'user',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

// ============================================================================
// 1. PolicyChain
// ============================================================================

describe('PolicyChain', () => {
  let chain: PolicyChain;

  beforeEach(() => {
    chain = new PolicyChain();
  });

  describe('evaluation semantics', () => {
    it('deny short-circuits immediately — later policies do not run', async () => {
      const denyPolicy = mockPolicy('denier', 'deny', { priority: 10 });
      const allowPolicy = mockPolicy('allower', 'allow', { priority: 20 });

      chain.add(denyPolicy);
      chain.add(allowPolicy);

      const result = await chain.evaluate(ctx());

      expect(result.verdict).toBe('deny');
      expect(result.policyName).toBe('denier');
      expect(denyPolicy.evaluate).toHaveBeenCalledTimes(1);
      expect(allowPolicy.evaluate).not.toHaveBeenCalled();
    });

    it('allow does NOT short-circuit — later policies can still deny', async () => {
      const allowPolicy = mockPolicy('allower', 'allow', { priority: 10 });
      const denyPolicy = mockPolicy('denier', 'deny', { priority: 20 });

      chain.add(allowPolicy);
      chain.add(denyPolicy);

      const result = await chain.evaluate(ctx());

      expect(result.verdict).toBe('deny');
      expect(result.policyName).toBe('denier');
      expect(allowPolicy.evaluate).toHaveBeenCalledTimes(1);
      expect(denyPolicy.evaluate).toHaveBeenCalledTimes(1);
    });

    it('all abstain with default deny → deny', async () => {
      chain.add(mockPolicy('p1', 'abstain', { priority: 10 }));
      chain.add(mockPolicy('p2', 'abstain', { priority: 20 }));

      const result = await chain.evaluate(ctx());

      expect(result.verdict).toBe('deny');
      expect(result.policyName).toBe('chain:default');
    });

    it('all abstain with defaultVerdict=allow → allow', async () => {
      const allowChain = new PolicyChain({ defaultVerdict: 'allow' });
      allowChain.add(mockPolicy('p1', 'abstain', { priority: 10 }));

      const result = await allowChain.evaluate(ctx());

      expect(result.verdict).toBe('allow');
      expect(result.policyName).toBe('chain:default');
    });

    it('no deny + at least one allow → allow', async () => {
      chain.add(mockPolicy('allower', 'allow', { priority: 10 }));
      chain.add(mockPolicy('abstainer', 'abstain', { priority: 20 }));

      const result = await chain.evaluate(ctx());

      expect(result.verdict).toBe('allow');
      expect(result.policyName).toBe('allower');
    });

    it('empty chain → defaultVerdict', async () => {
      const result = await chain.evaluate(ctx());
      expect(result.verdict).toBe('deny');

      const allowChain = new PolicyChain({ defaultVerdict: 'allow' });
      const result2 = await allowChain.evaluate(ctx());
      expect(result2.verdict).toBe('allow');
    });
  });

  describe('policy management', () => {
    it('add/remove/has/list work correctly', () => {
      const p1 = mockPolicy('p1', 'allow');
      const p2 = mockPolicy('p2', 'deny');

      chain.add(p1);
      chain.add(p2);

      expect(chain.has('p1')).toBe(true);
      expect(chain.has('p2')).toBe(true);
      expect(chain.has('p3')).toBe(false);
      expect(chain.size).toBe(2);
      expect(chain.list()).toHaveLength(2);

      expect(chain.remove('p1')).toBe(true);
      expect(chain.has('p1')).toBe(false);
      expect(chain.size).toBe(1);

      expect(chain.remove('nonexistent')).toBe(false);
    });

    it('adding a policy with same name replaces the existing one', () => {
      chain.add(mockPolicy('p1', 'allow'));
      chain.add(mockPolicy('p1', 'deny'));

      expect(chain.size).toBe(1);
    });

    it('priority ordering: lower priority number runs first', async () => {
      const callOrder: string[] = [];

      const highPrio: IPermissionPolicy = {
        name: 'high',
        priority: 1,
        evaluate: vi.fn(() => {
          callOrder.push('high');
          return { verdict: 'abstain' as const, reason: '', policyName: 'high' };
        }),
      };

      const lowPrio: IPermissionPolicy = {
        name: 'low',
        priority: 200,
        evaluate: vi.fn(() => {
          callOrder.push('low');
          return { verdict: 'abstain' as const, reason: '', policyName: 'low' };
        }),
      };

      // Add in reverse order to ensure sorting works
      chain.add(lowPrio);
      chain.add(highPrio);

      await chain.evaluate(ctx());

      expect(callOrder).toEqual(['high', 'low']);
    });

    it('clear removes all policies', () => {
      chain.add(mockPolicy('p1', 'allow'));
      chain.add(mockPolicy('p2', 'deny'));
      chain.clear();

      expect(chain.size).toBe(0);
      expect(chain.list()).toHaveLength(0);
    });
  });
});

// ============================================================================
// 2. Built-in Policies
// ============================================================================

describe('AllowlistPolicy', () => {
  it('tool in allowlist → allow', () => {
    const policy = new AllowlistPolicy(['read_file', 'glob']);
    const result = policy.evaluate(ctx({ toolName: 'read_file' }));
    expect(result.verdict).toBe('allow');
  });

  it('tool not in allowlist → abstain', () => {
    const policy = new AllowlistPolicy(['read_file']);
    const result = policy.evaluate(ctx({ toolName: 'write_file' }));
    expect(result.verdict).toBe('abstain');
  });

  it('add/remove/has work at runtime', () => {
    const policy = new AllowlistPolicy([]);
    expect(policy.has('bash')).toBe(false);

    policy.add('bash');
    expect(policy.has('bash')).toBe(true);

    policy.remove('bash');
    expect(policy.has('bash')).toBe(false);
  });

  it('getAll returns all tools', () => {
    const policy = new AllowlistPolicy(['a', 'b', 'c']);
    expect(policy.getAll().sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('BlocklistPolicy', () => {
  it('tool in blocklist → deny (no needsApproval)', () => {
    const policy = new BlocklistPolicy(['dangerous_tool']);
    const result = policy.evaluate(ctx({ toolName: 'dangerous_tool' }));

    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBeUndefined();
  });

  it('tool not in blocklist → abstain', () => {
    const policy = new BlocklistPolicy(['dangerous_tool']);
    const result = policy.evaluate(ctx({ toolName: 'safe_tool' }));
    expect(result.verdict).toBe('abstain');
  });

  it('add/remove/has work at runtime', () => {
    const policy = new BlocklistPolicy([]);

    policy.add('bad');
    expect(policy.has('bad')).toBe(true);

    policy.remove('bad');
    expect(policy.has('bad')).toBe(false);
  });
});

describe('SessionApprovalPolicy', () => {
  let policy: SessionApprovalPolicy;

  beforeEach(() => {
    policy = new SessionApprovalPolicy();
  });

  it('scope always → allow', () => {
    const result = policy.evaluate(ctx({
      toolName: 'safe_tool',
      toolPermissionConfig: { scope: 'always' },
    }));
    expect(result.verdict).toBe('allow');
  });

  it('scope never → deny (hard block)', () => {
    const result = policy.evaluate(ctx({
      toolName: 'banned_tool',
      toolPermissionConfig: { scope: 'never' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBeUndefined();
  });

  it('scope session + not cached → deny with needsApproval', () => {
    const result = policy.evaluate(ctx({
      toolName: 'write_file',
      toolPermissionConfig: { scope: 'session' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBe(true);
    expect(result.metadata?.approvalScope).toBe('session');
  });

  it('scope session + cached → allow', () => {
    policy.approve('write_file');

    const result = policy.evaluate(ctx({
      toolName: 'write_file',
      toolPermissionConfig: { scope: 'session' },
    }));
    expect(result.verdict).toBe('allow');
  });

  it('no toolPermissionConfig → abstain', () => {
    const result = policy.evaluate(ctx({ toolName: 'random_tool' }));
    expect(result.verdict).toBe('abstain');
  });

  it('scope once → deny with needsApproval every time', () => {
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      toolPermissionConfig: { scope: 'once' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBe(true);
    expect(result.metadata?.approvalScope).toBe('once');
  });

  it('approve/revoke/clearSession work', () => {
    policy.approve('tool_a');
    expect(policy.isApproved('tool_a')).toBe(true);

    policy.revoke('tool_a');
    expect(policy.isApproved('tool_a')).toBe(false);

    policy.approve('tool_b');
    policy.approve('tool_c');
    policy.clearSession();
    expect(policy.isApproved('tool_b')).toBe(false);
    expect(policy.isApproved('tool_c')).toBe(false);
  });

  it('expired approval is cleaned up', () => {
    // Approve with a TTL that has already expired
    policy.approve('tool_x', { ttlMs: -1000 });
    expect(policy.isApproved('tool_x')).toBe(false);
  });
});

describe('PathRestrictionPolicy', () => {
  it('path within allowed roots → abstain', () => {
    const policy = new PathRestrictionPolicy({
      allowedPaths: ['/workspace'],
      resolveSymlinks: false,
    });
    const result = policy.evaluate(ctx({
      toolName: 'write_file',
      args: { path: '/workspace/src/file.ts' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('path outside allowed roots → deny with needsApproval', () => {
    const policy = new PathRestrictionPolicy({
      allowedPaths: ['/workspace'],
      resolveSymlinks: false,
    });
    const result = policy.evaluate(ctx({
      toolName: 'write_file',
      args: { path: '/etc/passwd' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBe(true);
  });

  it('relative path resolved against basePath', () => {
    const policy = new PathRestrictionPolicy({
      allowedPaths: ['/workspace'],
      basePath: '/workspace',
      resolveSymlinks: false,
    });
    const result = policy.evaluate(ctx({
      toolName: 'write_file',
      args: { path: 'src/file.ts' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('non-filesystem tool → abstain', () => {
    const policy = new PathRestrictionPolicy({
      allowedPaths: ['/workspace'],
      resolveSymlinks: false,
    });
    const result = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://example.com' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('path with .. resolved correctly', () => {
    const policy = new PathRestrictionPolicy({
      allowedPaths: ['/workspace'],
      resolveSymlinks: false,
    });
    // /workspace/src/../../etc/passwd resolves to /etc/passwd
    const result = policy.evaluate(ctx({
      toolName: 'write_file',
      args: { path: '/workspace/src/../../etc/passwd' },
    }));
    expect(result.verdict).toBe('deny');
  });

  it('path exactly equal to root → abstain', () => {
    const policy = new PathRestrictionPolicy({
      allowedPaths: ['/workspace'],
      resolveSymlinks: false,
    });
    const result = policy.evaluate(ctx({
      toolName: 'read_file',
      args: { path: '/workspace' },
    }));
    expect(result.verdict).toBe('abstain');
  });
});

describe('BashFilterPolicy', () => {
  it('command matching deny pattern → deny', () => {
    const policy = new BashFilterPolicy({
      denyPatterns: [/rm\s+-rf/],
    });
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      args: { command: 'rm -rf /' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBe(true);
  });

  it('command matching deny prefix → deny', () => {
    const policy = new BashFilterPolicy({
      denyCommands: ['sudo'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      args: { command: 'sudo apt install' },
    }));
    expect(result.verdict).toBe('deny');
  });

  it('command matching allow pattern → abstain', () => {
    const policy = new BashFilterPolicy({
      allowPatterns: [/^ls\b/],
    });
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      args: { command: 'ls -la' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('non-bash tool → abstain', () => {
    const policy = new BashFilterPolicy({
      denyPatterns: [/rm/],
    });
    const result = policy.evaluate(ctx({
      toolName: 'read_file',
      args: { command: 'rm -rf /' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('no matching patterns → abstain', () => {
    const policy = new BashFilterPolicy({
      denyPatterns: [/rm\s+-rf/],
      allowPatterns: [/^ls\b/],
    });
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      args: { command: 'echo hello' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('deny patterns checked before allow patterns', () => {
    const policy = new BashFilterPolicy({
      denyPatterns: [/dangerous/],
      allowPatterns: [/dangerous/],  // same pattern in both
    });
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      args: { command: 'dangerous command' },
    }));
    expect(result.verdict).toBe('deny');
  });
});

describe('UrlAllowlistPolicy', () => {
  it('URL with allowed domain → abstain', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['example.com'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://example.com/api/data' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('URL with disallowed domain → deny', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['example.com'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://malicious.com/attack' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.metadata?.needsApproval).toBe(true);
  });

  it('subdomain matching: example.com matches www.example.com', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['example.com'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://www.example.com/page' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('evil-example.com does NOT match example.com', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['example.com'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://evil-example.com/phishing' },
    }));
    expect(result.verdict).toBe('deny');
  });

  it('non-URL tool → abstain', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['example.com'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'read_file',
      args: { url: 'https://malicious.com' },
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('leading dot for suffix-only matching', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['.example.com'],
    });
    // .example.com should NOT match example.com itself
    const result1 = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://example.com/page' },
    }));
    expect(result1.verdict).toBe('deny');

    // .example.com SHOULD match sub.example.com
    const result2 = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'https://sub.example.com/page' },
    }));
    expect(result2.verdict).toBe('abstain');
  });

  it('disallowed protocol → deny', () => {
    const policy = new UrlAllowlistPolicy({
      allowedDomains: ['example.com'],
    });
    const result = policy.evaluate(ctx({
      toolName: 'web_fetch',
      args: { url: 'ftp://example.com/file' },
    }));
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('Protocol');
  });
});

describe('RolePolicy', () => {
  it('user role allows tool → allow', () => {
    const policy = new RolePolicy([
      { role: 'developer', allowTools: ['bash', 'write_file'] },
    ]);
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      roles: ['developer'],
    }));
    expect(result.verdict).toBe('allow');
  });

  it('user role denies tool → deny', () => {
    const policy = new RolePolicy([
      { role: 'viewer', denyTools: ['bash'] },
    ]);
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      roles: ['viewer'],
    }));
    expect(result.verdict).toBe('deny');
  });

  it('deny beats allow across roles', () => {
    const policy = new RolePolicy([
      { role: 'developer', allowTools: ['bash'] },
      { role: 'restricted', denyTools: ['bash'] },
    ]);
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      roles: ['developer', 'restricted'],
    }));
    expect(result.verdict).toBe('deny');
  });

  it('no matching roles → abstain', () => {
    const policy = new RolePolicy([
      { role: 'admin', allowTools: ['*'] },
    ]);
    const result = policy.evaluate(ctx({
      toolName: 'bash',
      roles: ['viewer'],
    }));
    expect(result.verdict).toBe('abstain');
  });

  it('no roles at all → abstain', () => {
    const policy = new RolePolicy([
      { role: 'admin', allowTools: ['*'] },
    ]);
    const result = policy.evaluate(ctx({ toolName: 'bash' }));
    expect(result.verdict).toBe('abstain');
  });

  it('wildcard * tools works for allow', () => {
    const policy = new RolePolicy([
      { role: 'admin', allowTools: ['*'] },
    ]);
    const result = policy.evaluate(ctx({
      toolName: 'any_tool_name',
      roles: ['admin'],
    }));
    expect(result.verdict).toBe('allow');
  });

  it('wildcard * tools works for deny', () => {
    const policy = new RolePolicy([
      { role: 'locked', denyTools: ['*'] },
    ]);
    const result = policy.evaluate(ctx({
      toolName: 'any_tool',
      roles: ['locked'],
    }));
    expect(result.verdict).toBe('deny');
  });
});

describe('RateLimitPolicy', () => {
  it('under limit → abstain', () => {
    const policy = new RateLimitPolicy({
      limits: { bash: { maxCalls: 3, windowMs: 60000 } },
    });
    const result = policy.evaluate(ctx({ toolName: 'bash' }));
    expect(result.verdict).toBe('abstain');
  });

  it('at limit → deny', () => {
    const policy = new RateLimitPolicy({
      limits: { bash: { maxCalls: 2, windowMs: 60000 } },
    });

    // First two calls: under limit
    policy.evaluate(ctx({ toolName: 'bash' }));
    policy.evaluate(ctx({ toolName: 'bash' }));

    // Third call: at limit
    const result = policy.evaluate(ctx({ toolName: 'bash' }));
    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('Rate limit exceeded');
  });

  it('reset clears counters', () => {
    const policy = new RateLimitPolicy({
      limits: { bash: { maxCalls: 1, windowMs: 60000 } },
    });

    policy.evaluate(ctx({ toolName: 'bash' }));
    expect(policy.evaluate(ctx({ toolName: 'bash' })).verdict).toBe('deny');

    policy.reset('bash');
    expect(policy.evaluate(ctx({ toolName: 'bash' })).verdict).toBe('abstain');
  });

  it('reset without argument clears all tools', () => {
    const policy = new RateLimitPolicy({
      limits: {
        bash: { maxCalls: 1, windowMs: 60000 },
        write_file: { maxCalls: 1, windowMs: 60000 },
      },
    });

    policy.evaluate(ctx({ toolName: 'bash' }));
    policy.evaluate(ctx({ toolName: 'write_file' }));

    policy.reset();

    expect(policy.evaluate(ctx({ toolName: 'bash' })).verdict).toBe('abstain');
    expect(policy.evaluate(ctx({ toolName: 'write_file' })).verdict).toBe('abstain');
  });

  it('unconfigured tool with no default → abstain', () => {
    const policy = new RateLimitPolicy({
      limits: { bash: { maxCalls: 1, windowMs: 60000 } },
    });
    const result = policy.evaluate(ctx({ toolName: 'read_file' }));
    expect(result.verdict).toBe('abstain');
  });

  it('unconfigured tool uses defaultLimit if present', () => {
    const policy = new RateLimitPolicy({
      limits: {},
      defaultLimit: { maxCalls: 1, windowMs: 60000 },
    });

    policy.evaluate(ctx({ toolName: 'any_tool' }));
    const result = policy.evaluate(ctx({ toolName: 'any_tool' }));
    expect(result.verdict).toBe('deny');
  });
});

// ============================================================================
// 3. UserPermissionRulesEngine
// ============================================================================

describe('UserPermissionRulesEngine', () => {
  let engine: UserPermissionRulesEngine;

  beforeEach(async () => {
    engine = new UserPermissionRulesEngine();
    // Mark as loaded so evaluate works without storage
    await engine.load();
  });

  describe('basic matching', () => {
    it('rule with no conditions matches all calls of that tool', async () => {
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'allow',
      }));

      const result = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'anything' } }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('allow');
    });

    it('rule with conditions only matches when ALL conditions match', async () => {
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'deny',
        conditions: [
          { argName: 'command', operator: 'contains', value: 'rm' },
          { argName: 'command', operator: 'contains', value: '-rf' },
        ],
      }));

      // Both conditions match
      const result1 = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'rm -rf /' } }));
      expect(result1).not.toBeNull();
      expect(result1!.action).toBe('deny');

      // Only one condition matches
      const result2 = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'rm file.txt' } }));
      // Should fall through (no blanket rule, no matching conditional)
      expect(result2).toBeNull();
    });

    it('unconditional rule is absolute — overrides more specific rules', async () => {
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'allow',
        unconditional: true,
      }));

      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'deny',
        conditions: [{ argName: 'command', operator: 'contains', value: 'rm -rf' }],
      }));

      // Even with rm -rf, the unconditional allow wins
      const result = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'rm -rf /' } }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('allow');
    });

    it('more specific rule (more conditions) wins over less specific', async () => {
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'allow',
        // Blanket rule (0 conditions)
      }));

      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'deny',
        conditions: [{ argName: 'command', operator: 'contains', value: 'rm' }],
      }));

      // The more specific (1 condition) deny rule wins
      const result = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'rm file.txt' } }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('deny');
    });

    it('tie: most recently updated wins', async () => {
      const older = makeRule({
        toolName: 'bash',
        action: 'allow',
        conditions: [{ argName: 'command', operator: 'contains', value: 'echo' }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      const newer = makeRule({
        toolName: 'bash',
        action: 'deny',
        conditions: [{ argName: 'command', operator: 'contains', value: 'echo' }],
        updatedAt: '2026-03-15T00:00:00.000Z',
      });

      await engine.addRule(older);
      await engine.addRule(newer);

      const result = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'echo hello' } }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('deny');
    });

    it('wildcard * toolName matches any tool', async () => {
      await engine.addRule(makeRule({
        toolName: '*',
        action: 'deny',
      }));

      const result = engine.evaluate(ctx({ toolName: 'any_random_tool' }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('deny');
    });

    it('expired rules do not match', async () => {
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'allow',
        expiresAt: '2020-01-01T00:00:00.000Z',  // already expired
      }));

      const result = engine.evaluate(ctx({ toolName: 'bash' }));
      expect(result).toBeNull();
    });

    it('disabled rules do not match', async () => {
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'allow',
        enabled: false,
      }));

      const result = engine.evaluate(ctx({ toolName: 'bash' }));
      expect(result).toBeNull();
    });
  });

  describe('CRUD operations', () => {
    it('addRule + getRule + getRules', async () => {
      const rule = makeRule({ toolName: 'bash', action: 'allow' });
      await engine.addRule(rule);

      expect(engine.getRule(rule.id)).not.toBeNull();
      expect(engine.getRule(rule.id)!.toolName).toBe('bash');
      expect(engine.getRules()).toHaveLength(1);
    });

    it('updateRule changes fields and updatedAt', async () => {
      const rule = makeRule({
        toolName: 'bash',
        action: 'allow',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      await engine.addRule(rule);

      const updated = await engine.updateRule(rule.id, { action: 'deny' });
      expect(updated).toBe(true);

      const fetched = engine.getRule(rule.id);
      expect(fetched!.action).toBe('deny');
      expect(fetched!.updatedAt).not.toBe('2025-01-01T00:00:00.000Z');
    });

    it('updateRule returns false for nonexistent rule', async () => {
      const result = await engine.updateRule('nonexistent', { action: 'deny' });
      expect(result).toBe(false);
    });

    it('removeRule', async () => {
      const rule = makeRule({ toolName: 'bash' });
      await engine.addRule(rule);
      expect(engine.getRules()).toHaveLength(1);

      const removed = await engine.removeRule(rule.id);
      expect(removed).toBe(true);
      expect(engine.getRules()).toHaveLength(0);
    });

    it('removeRule returns false for nonexistent rule', async () => {
      const result = await engine.removeRule('nonexistent');
      expect(result).toBe(false);
    });

    it('getRulesForTool includes wildcard rules', async () => {
      await engine.addRule(makeRule({ toolName: 'bash', action: 'allow' }));
      await engine.addRule(makeRule({ toolName: '*', action: 'deny' }));
      await engine.addRule(makeRule({ toolName: 'write_file', action: 'allow' }));

      const bashRules = engine.getRulesForTool('bash');
      expect(bashRules).toHaveLength(2); // 'bash' + '*'
    });
  });

  describe('condition operators', () => {
    const testCondition = async (
      operator: string,
      conditionValue: string,
      argValue: string,
      shouldMatch: boolean,
    ) => {
      engine = new UserPermissionRulesEngine();
      await engine.load();
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'deny',
        conditions: [{ argName: 'command', operator: operator as any, value: conditionValue }],
      }));

      const result = engine.evaluate(ctx({ toolName: 'bash', args: { command: argValue } }));
      if (shouldMatch) {
        expect(result).not.toBeNull();
        expect(result!.action).toBe('deny');
      } else {
        expect(result).toBeNull();
      }
    };

    it('starts_with', async () => {
      await testCondition('starts_with', 'sudo', 'sudo apt install', true);
      await testCondition('starts_with', 'sudo', 'echo sudo', false);
    });

    it('not_starts_with', async () => {
      await testCondition('not_starts_with', 'sudo', 'echo hello', true);
      await testCondition('not_starts_with', 'sudo', 'sudo rm', false);
    });

    it('contains', async () => {
      await testCondition('contains', 'rm', 'sudo rm -rf', true);
      await testCondition('contains', 'rm', 'echo hello', false);
    });

    it('not_contains', async () => {
      await testCondition('not_contains', 'rm', 'echo hello', true);
      await testCondition('not_contains', 'rm', 'rm file', false);
    });

    it('equals', async () => {
      await testCondition('equals', 'ls', 'ls', true);
      await testCondition('equals', 'ls', 'ls -la', false);
    });

    it('not_equals', async () => {
      await testCondition('not_equals', 'ls', 'ls -la', true);
      await testCondition('not_equals', 'ls', 'ls', false);
    });

    it('matches (regex)', async () => {
      await testCondition('matches', '^ls\\b', 'ls -la', true);
      await testCondition('matches', '^ls\\b', 'also', false);
    });

    it('not_matches (regex negation)', async () => {
      await testCondition('not_matches', '^ls\\b', 'echo hello', true);
      await testCondition('not_matches', '^ls\\b', 'ls -la', false);
    });

    it('case insensitive by default', async () => {
      await testCondition('contains', 'SUDO', 'sudo apt', true);
    });

    it('case sensitive when ignoreCase=false', async () => {
      engine = new UserPermissionRulesEngine();
      await engine.load();
      await engine.addRule(makeRule({
        toolName: 'bash',
        action: 'deny',
        conditions: [{
          argName: 'command',
          operator: 'contains',
          value: 'SUDO',
          ignoreCase: false,
        }],
      }));

      const result = engine.evaluate(ctx({ toolName: 'bash', args: { command: 'sudo apt' } }));
      expect(result).toBeNull(); // case mismatch, should not match
    });
  });

  describe('meta-args', () => {
    it('__toolCategory matches against context toolCategory', async () => {
      await engine.addRule(makeRule({
        toolName: '*',
        action: 'deny',
        conditions: [{ argName: '__toolCategory', operator: 'equals', value: 'shell' }],
      }));

      const result = engine.evaluate(ctx({
        toolName: 'bash',
        toolCategory: 'shell',
      }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('deny');
    });

    it('__toolSource matches against context toolSource', async () => {
      await engine.addRule(makeRule({
        toolName: '*',
        action: 'deny',
        conditions: [{ argName: '__toolSource', operator: 'equals', value: 'mcp' }],
      }));

      const result = engine.evaluate(ctx({
        toolName: 'some_mcp_tool',
        toolSource: 'mcp',
      }));
      expect(result).not.toBeNull();
      expect(result!.action).toBe('deny');
    });
  });

  describe('persistence', () => {
    it('load marks engine as loaded even without storage', async () => {
      const eng = new UserPermissionRulesEngine();
      expect(eng.isLoaded).toBe(false);
      await eng.load();
      expect(eng.isLoaded).toBe(true);
    });

    it('setStorage allows changing storage backend', async () => {
      const mockStorage = {
        load: vi.fn().mockResolvedValue([makeRule({ toolName: 'bash', action: 'deny' })]),
        save: vi.fn().mockResolvedValue(undefined),
      };

      const eng = new UserPermissionRulesEngine();
      eng.setStorage(mockStorage);
      await eng.load('user1');

      expect(mockStorage.load).toHaveBeenCalledWith('user1');
      expect(eng.getRules()).toHaveLength(1);
    });
  });
});

// ============================================================================
// 4. PermissionPolicyManager integration
// ============================================================================

describe('PermissionPolicyManager', () => {
  describe('user rules override chain', () => {
    it('user allow rule overrides chain deny (e.g., bash allowed despite BashFilterPolicy)', async () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({
        onApprovalRequired: async () => ({ approved: false }),
      });

      // Add a bash filter that denies rm
      manager.addPolicy(new BashFilterPolicy({
        denyPatterns: [/rm/],
      }));

      // Pre-load user rules engine with an allow rule
      await manager.userRules.load();
      await manager.userRules.addRule(makeRule({
        toolName: 'bash',
        action: 'allow',
      }));

      const result = await manager.check(ctx({
        toolName: 'bash',
        args: { command: 'rm -rf /' },
      }));

      expect(result.allowed).toBe(true);
    });

    it('user deny rule overrides chain allow (e.g., read_file denied despite AllowlistPolicy)', async () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({});

      await manager.userRules.load();
      await manager.userRules.addRule(makeRule({
        toolName: 'read_file',
        action: 'deny',
      }));

      const result = await manager.check(ctx({ toolName: 'read_file' }));

      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('user ask rule triggers approval flow', async () => {
      const approvalHandler = vi.fn().mockResolvedValue({ approved: true });
      const manager = PermissionPolicyManager.fromLegacyConfig({
        onApprovalRequired: approvalHandler,
      });

      await manager.userRules.load();
      await manager.userRules.addRule(makeRule({
        toolName: 'bash',
        action: 'ask',
      }));

      const result = await manager.check(ctx({ toolName: 'bash' }));

      expect(approvalHandler).toHaveBeenCalled();
      expect(result.allowed).toBe(true);
      expect(result.approvalRequired).toBe(true);
    });
  });

  describe('approval flow', () => {
    it('approval with createRule creates persistent user rule', async () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({
        onApprovalRequired: async () => ({
          approved: true,
          createRule: {
            description: 'Allow bash for workspace',
            conditions: [{ argName: 'command', operator: 'starts_with' as const, value: 'cd' }],
          },
        }),
      });

      await manager.userRules.load();

      // Force a deny that triggers approval via SessionApprovalPolicy
      const result = await manager.check(ctx({
        toolName: 'write_file',
        toolPermissionConfig: { scope: 'session' },
      }));

      expect(result.allowed).toBe(true);
      // A user rule should have been created
      const rules = manager.userRules.getRules();
      expect(rules.length).toBeGreaterThanOrEqual(1);
      const createdRule = rules.find(r => r.description === 'Allow bash for workspace');
      expect(createdRule).toBeDefined();
      expect(createdRule!.createdBy).toBe('approval_dialog');
    });

    it('no approval handler + needsApproval → deny (not auto-approve)', async () => {
      const manager = new PermissionPolicyManager({
        policies: [
          new SessionApprovalPolicy(),
        ],
      });

      await manager.userRules.load();

      const result = await manager.check(ctx({
        toolName: 'write_file',
        toolPermissionConfig: { scope: 'session' },
      }));

      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('no approval handler');
    });
  });

  describe('lazy-load on first check', () => {
    it('loads user rules on first check call', async () => {
      const mockStorage = {
        load: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new PermissionPolicyManager({
        policies: [new AllowlistPolicy(['read_file'])],
        chain: { defaultVerdict: 'allow' },
        userRulesStorage: mockStorage,
      });

      expect(manager.userRules.isLoaded).toBe(false);

      await manager.check(ctx({ toolName: 'read_file' }));

      expect(manager.userRules.isLoaded).toBe(true);
      expect(mockStorage.load).toHaveBeenCalled();
    });
  });

  describe('parent delegation', () => {
    it('parent deny is final — worker cannot override', async () => {
      // Parent blocks bash
      const parent = new PermissionPolicyManager({
        policies: [new BlocklistPolicy(['bash'])],
      });

      // Worker allows everything
      const worker = new PermissionPolicyManager({
        policies: [new AllowlistPolicy(['bash'])],
        chain: { defaultVerdict: 'allow' },
      });
      worker.setParentEvaluator(parent);

      await worker.userRules.load();

      const result = await worker.check(ctx({ toolName: 'bash' }));

      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Parent policy');
    });

    it('parent allow does not skip worker restrictions', async () => {
      // Parent allows bash
      const parent = new PermissionPolicyManager({
        policies: [new AllowlistPolicy(['bash'])],
        chain: { defaultVerdict: 'allow' },
      });

      // Worker blocks bash
      const worker = new PermissionPolicyManager({
        policies: [new BlocklistPolicy(['bash'])],
      });
      worker.setParentEvaluator(parent);

      await worker.userRules.load();

      const result = await worker.check(ctx({ toolName: 'bash' }));

      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
    });
  });

  describe('centralized redaction', () => {
    it('sensitive args redacted in audit entries', async () => {
      const auditEntries: any[] = [];
      const manager = PermissionPolicyManager.fromLegacyConfig({});

      manager.on('permission:audit', (entry: any) => {
        auditEntries.push(entry);
      });

      await manager.userRules.load();

      await manager.check(ctx({
        toolName: 'read_file',
        args: {
          path: '/some/file',
          token: 'secret-value-123',
          password: 'my-password',
          normalArg: 'visible',
        },
      }));

      expect(auditEntries.length).toBeGreaterThan(0);
      const entry = auditEntries[0];
      expect(entry.args.token).toBe('[REDACTED]');
      expect(entry.args.password).toBe('[REDACTED]');
      expect(entry.args.normalArg).toBe('visible');
    });

    it('tool-declared sensitiveArgs are also redacted', async () => {
      const auditEntries: any[] = [];
      const manager = PermissionPolicyManager.fromLegacyConfig({});

      manager.on('permission:audit', (entry: any) => {
        auditEntries.push(entry);
      });

      await manager.userRules.load();

      await manager.check(ctx({
        toolName: 'read_file',
        args: { path: '/some/file', customSecret: 'should-be-hidden' },
        toolPermissionConfig: {
          sensitiveArgs: ['customSecret'],
        },
      }));

      expect(auditEntries.length).toBeGreaterThan(0);
      expect(auditEntries[0].args.customSecret).toBe('[REDACTED]');
    });

    it('long values are truncated in audit', async () => {
      const auditEntries: any[] = [];
      const manager = PermissionPolicyManager.fromLegacyConfig({});

      manager.on('permission:audit', (entry: any) => {
        auditEntries.push(entry);
      });

      await manager.userRules.load();

      const longValue = 'x'.repeat(1000);
      await manager.check(ctx({
        toolName: 'read_file',
        args: { data: longValue },
      }));

      expect(auditEntries.length).toBeGreaterThan(0);
      expect(auditEntries[0].args.data).toContain('[truncated]');
      expect(auditEntries[0].args.data.length).toBeLessThan(600);
    });
  });

  describe('fromLegacyConfig', () => {
    it('creates manager with blocklist, allowlist, and session approval', () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({
        blocklist: ['dangerous'],
        allowlist: ['custom_safe'],
      });

      expect(manager.hasPolicy('builtin:blocklist')).toBe(true);
      expect(manager.hasPolicy('builtin:allowlist')).toBe(true);
      expect(manager.hasPolicy('builtin:session-approval')).toBe(true);
    });

    it('default allowlist is merged with user allowlist', async () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({
        allowlist: ['custom_tool'],
      });

      await manager.userRules.load();

      // read_file should be allowed (in DEFAULT_ALLOWLIST)
      const result1 = await manager.check(ctx({ toolName: 'read_file' }));
      expect(result1.allowed).toBe(true);

      // custom_tool should also be allowed
      const result2 = await manager.check(ctx({ toolName: 'custom_tool' }));
      expect(result2.allowed).toBe(true);
    });
  });

  describe('allowlist/blocklist shortcuts', () => {
    it('allowlistAdd and blocklistAdd work', async () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({});
      await manager.userRules.load();

      manager.blocklistAdd('my_tool');
      const result1 = await manager.check(ctx({ toolName: 'my_tool' }));
      expect(result1.allowed).toBe(false);

      // allowlistAdd should also remove from blocklist
      manager.allowlistAdd('my_tool');
      const result2 = await manager.check(ctx({ toolName: 'my_tool' }));
      expect(result2.allowed).toBe(true);
    });
  });

  describe('state persistence', () => {
    it('getState/loadState round-trips approvals', async () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({});
      await manager.userRules.load();

      manager.approve('write_file');
      const state = manager.getState();

      expect(state.approvals).toHaveProperty('write_file');

      // Create a new manager and load state
      const manager2 = PermissionPolicyManager.fromLegacyConfig({});
      manager2.loadState(state);

      expect(manager2.isApproved('write_file')).toBe(true);
    });
  });

  describe('IDisposable', () => {
    it('destroy cleans up', () => {
      const manager = PermissionPolicyManager.fromLegacyConfig({});
      expect(manager.isDestroyed).toBe(false);

      manager.destroy();
      expect(manager.isDestroyed).toBe(true);
    });
  });
});

// ============================================================================
// 5. PermissionEnforcementPlugin
// ============================================================================

describe('PermissionEnforcementPlugin', () => {
  it('allowed tool → returns undefined (continue)', async () => {
    const manager = PermissionPolicyManager.fromLegacyConfig({});
    await manager.userRules.load();

    const plugin = new PermissionEnforcementPlugin(
      manager,
      () => undefined,
      () => undefined,
    );

    const result = await plugin.beforeExecute({
      toolName: 'read_file',
      args: {},
      mutableArgs: {},
      metadata: new Map(),
      startTime: Date.now(),
      tool: {} as any,
      executionId: 'exec-1',
    });

    expect(result).toBeUndefined();
  });

  it('denied tool → throws ToolPermissionDeniedError', async () => {
    const manager = PermissionPolicyManager.fromLegacyConfig({
      blocklist: ['dangerous_tool'],
    });
    await manager.userRules.load();

    const plugin = new PermissionEnforcementPlugin(
      manager,
      () => undefined,
      () => undefined,
    );

    await expect(
      plugin.beforeExecute({
        toolName: 'dangerous_tool',
        args: {},
        mutableArgs: {},
        metadata: new Map(),
        startTime: Date.now(),
        tool: {} as any,
        executionId: 'exec-2',
      }),
    ).rejects.toThrow(ToolPermissionDeniedError);
  });

  it('PolicyContext populated from ToolContext and registration metadata', async () => {
    const checkSpy = vi.fn().mockResolvedValue({ allowed: true, blocked: false, reason: 'ok' });
    const fakeManager = { check: checkSpy, userRules: { isLoaded: true } } as any;

    // Workaround: PermissionPolicyManager.check is the method we need to spy on
    // Use a real manager but intercept
    const realManager = PermissionPolicyManager.fromLegacyConfig({});
    await realManager.userRules.load();
    vi.spyOn(realManager, 'check').mockResolvedValue({ allowed: true, blocked: false, reason: 'ok' });

    const toolContext = {
      userId: 'alice',
      agentId: 'agent-1',
      roles: ['developer'],
      sessionId: 'sess-1',
    };

    const registration = {
      source: 'built-in',
      category: 'filesystem',
      namespace: 'fs',
      tags: ['io'],
      permission: { scope: 'session' as const },
    };

    const plugin = new PermissionEnforcementPlugin(
      realManager,
      () => toolContext as any,
      (name: string) => name === 'read_file' ? registration : undefined,
    );

    await plugin.beforeExecute({
      toolName: 'read_file',
      args: { path: '/tmp/file' },
      mutableArgs: { path: '/tmp/file' },
      metadata: new Map(),
      startTime: Date.now(),
      tool: {} as any,
      executionId: 'exec-3',
    });

    expect(realManager.check).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'read_file',
        args: { path: '/tmp/file' },
        userId: 'alice',
        agentId: 'agent-1',
        roles: ['developer'],
        sessionId: 'sess-1',
        toolSource: 'built-in',
        toolCategory: 'filesystem',
        toolNamespace: 'fs',
        toolTags: ['io'],
        toolPermissionConfig: { scope: 'session' },
      }),
    );
  });

  it('plugin name and priority are correct', () => {
    const manager = PermissionPolicyManager.fromLegacyConfig({});
    const plugin = new PermissionEnforcementPlugin(
      manager,
      () => undefined,
      () => undefined,
    );

    expect(plugin.name).toBe('permission-enforcement');
    expect(plugin.priority).toBe(1);
  });
});
