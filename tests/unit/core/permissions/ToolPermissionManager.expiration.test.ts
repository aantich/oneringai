/**
 * ToolPermissionManager - Expiration & Edge Case Tests
 *
 * Covers TTL-based expiration with fake timers, concurrent permission checks,
 * safe tool allowlisting, bulk operations, and state after reset/clear.
 * Complements the existing ToolPermissionManager.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolPermissionManager } from '../../../../src/core/permissions/ToolPermissionManager.js';
import type { ToolCall } from '../../../../src/domain/entities/Tool.js';
import { ToolCallState } from '../../../../src/domain/entities/Tool.js';

describe('ToolPermissionManager - Expiration & Edge Cases', () => {
  let manager: ToolPermissionManager;

  const createToolCall = (name: string): ToolCall => ({
    id: `call_${name}`,
    type: 'function',
    function: { name, arguments: '{}' },
    blocking: true,
    state: ToolCallState.PENDING,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ToolPermissionManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove expired approval on next permission check (fake timers)', () => {
    // Configure tool with 5-second TTL
    manager.setToolConfig('expiring_tool', { scope: 'session', sessionTTLMs: 5000 });
    manager.approveForSession('expiring_tool');

    // Should be approved immediately
    expect(manager.isApprovedForSession('expiring_tool')).toBe(true);
    expect(manager.checkPermission('expiring_tool').allowed).toBe(true);

    // Advance time past TTL
    vi.advanceTimersByTime(6000);

    // Approval should be expired, needs re-approval
    expect(manager.isApprovedForSession('expiring_tool')).toBe(false);
    const result = manager.checkPermission('expiring_tool');
    expect(result.allowed).toBe(false);
    expect(result.needsApproval).toBe(true);

    // getApprovalEntry should also return undefined for expired
    expect(manager.getApprovalEntry('expiring_tool')).toBeUndefined();
  });

  it('should not expire approval before TTL elapses', () => {
    manager.setToolConfig('short_ttl', { scope: 'session', sessionTTLMs: 10000 });
    manager.approveForSession('short_ttl');

    // Advance 9 seconds (just under TTL)
    vi.advanceTimersByTime(9000);

    expect(manager.isApprovedForSession('short_ttl')).toBe(true);
    expect(manager.getApprovalEntry('short_ttl')).toBeDefined();
  });

  it('should handle concurrent permission checks on the same tool consistently', () => {
    manager.setToolConfig('concurrent_tool', { scope: 'session' });
    manager.approveForSession('concurrent_tool');

    // Simulate multiple concurrent checks
    const results = Array.from({ length: 100 }, () =>
      manager.checkPermission('concurrent_tool'),
    );

    // All should be consistent
    for (const result of results) {
      expect(result.allowed).toBe(true);
      expect(result.needsApproval).toBe(false);
      expect(result.blocked).toBe(false);
    }
  });

  it('should always allow safe (default allowlisted) tools without approval', () => {
    const safeTools = [
      'read_file', 'glob', 'grep', 'list_directory',
      'memory_store', 'memory_retrieve', 'memory_delete', 'memory_query',
      'context_set', 'context_delete', 'context_list', 'context_stats',
      'instructions_set', 'instructions_remove', 'instructions_list', 'instructions_clear',
      '_start_planning', '_modify_plan', '_report_progress', '_request_approval',
    ];

    for (const toolName of safeTools) {
      const result = manager.checkPermission(toolName);
      expect(result.allowed).toBe(true);
      expect(result.needsApproval).toBe(false);
      expect(result.blocked).toBe(false);
    }
  });

  it('should bulk-approve multiple tools via individual approve calls', () => {
    const tools = ['tool_a', 'tool_b', 'tool_c', 'tool_d', 'tool_e'];

    for (const tool of tools) {
      manager.setToolConfig(tool, { scope: 'session' });
      manager.approveForSession(tool);
    }

    const approved = manager.getApprovedTools();
    for (const tool of tools) {
      expect(approved).toContain(tool);
    }
    expect(approved).toHaveLength(tools.length);
  });

  it('should bulk-deny via blocklist and verify all blocked', () => {
    const dangerousTools = ['rm_all', 'drop_db', 'format_disk'];

    for (const tool of dangerousTools) {
      manager.blocklistAdd(tool);
    }

    for (const tool of dangerousTools) {
      const result = manager.checkPermission(tool);
      expect(result.blocked).toBe(true);
      expect(result.allowed).toBe(false);
    }

    expect(manager.getBlocklist()).toHaveLength(dangerousTools.length);
  });

  it('should have clean state after clearSession()', () => {
    manager.approveForSession('tool1');
    manager.approveForSession('tool2');
    manager.approveForSession('tool3');

    expect(manager.getApprovedTools()).toHaveLength(3);

    manager.clearSession();

    expect(manager.getApprovedTools()).toHaveLength(0);
    expect(manager.getApprovalEntry('tool1')).toBeUndefined();
    expect(manager.getApprovalEntry('tool2')).toBeUndefined();

    // Allowlist and blocklist should be unaffected
    expect(manager.getAllowlist().length).toBeGreaterThan(0); // defaults still there
  });

  it('should have fully clean state after reset()', () => {
    manager.approveForSession('tool1');
    manager.allowlistAdd('custom_safe');
    manager.blocklistAdd('custom_blocked');
    manager.setToolConfig('special', { scope: 'always' });

    manager.reset();

    // Everything cleared, including default allowlist
    expect(manager.getApprovedTools()).toHaveLength(0);
    expect(manager.getAllowlist()).toHaveLength(0);
    expect(manager.getBlocklist()).toHaveLength(0);
    expect(manager.getToolConfig('special')).toBeUndefined();
    expect(manager.getDefaults().scope).toBe('once');
    expect(manager.getDefaults().riskLevel).toBe('low');

    // Default-allowlisted tools now require approval
    const result = manager.checkPermission('read_file');
    expect(result.needsApproval).toBe(true);
  });

  it('should exclude expired entries from getApprovedTools()', () => {
    manager.setToolConfig('expires_fast', { scope: 'session', sessionTTLMs: 2000 });
    manager.approveForSession('expires_fast');
    manager.approveForSession('no_expiry');

    expect(manager.getApprovedTools()).toHaveLength(2);

    vi.advanceTimersByTime(3000);

    const approved = manager.getApprovedTools();
    expect(approved).not.toContain('expires_fast');
    expect(approved).toContain('no_expiry');
    expect(approved).toHaveLength(1);
  });
});
