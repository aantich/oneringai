/**
 * Tests for ToolPermissionManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolPermissionManager } from '../../../../src/core/permissions/ToolPermissionManager.js';
import type {
  AgentPermissionsConfig,
  PermissionCheckContext,
  ApprovalDecision,
  SerializedApprovalState,
} from '../../../../src/core/permissions/types.js';
import { APPROVAL_STATE_VERSION } from '../../../../src/core/permissions/types.js';
import type { ToolCall } from '../../../../src/domain/entities/Tool.js';
import { ToolCallState } from '../../../../src/domain/entities/Tool.js';

describe('ToolPermissionManager', () => {
  let permissionManager: ToolPermissionManager;

  // Helper to create a mock ToolCall
  const createToolCall = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
    id: `call_${name}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
    blocking: true,
    state: ToolCallState.PENDING,
  });

  beforeEach(() => {
    permissionManager = new ToolPermissionManager();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      expect(permissionManager).toBeDefined();
      expect(permissionManager.getDefaults().scope).toBe('once');
      expect(permissionManager.getDefaults().riskLevel).toBe('low');
    });

    it('should create with custom config', () => {
      const config: AgentPermissionsConfig = {
        defaultScope: 'session',
        defaultRiskLevel: 'high',
        allowlist: ['safe_tool'],
        blocklist: ['dangerous_tool'],
        tools: {
          custom_tool: { scope: 'always', riskLevel: 'medium' },
        },
      };

      const manager = new ToolPermissionManager(config);
      expect(manager.getDefaults().scope).toBe('session');
      expect(manager.getDefaults().riskLevel).toBe('high');
      expect(manager.isAllowlisted('safe_tool')).toBe(true);
      expect(manager.isBlocklisted('dangerous_tool')).toBe(true);
      expect(manager.getToolConfig('custom_tool')?.scope).toBe('always');
    });
  });

  describe('checkPermission', () => {
    it('should allow blocklisted tools to be blocked', () => {
      permissionManager.blocklistAdd('blocked_tool');

      const result = permissionManager.checkPermission('blocked_tool');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('Tool is blocklisted');
    });

    it('should allow allowlisted tools', () => {
      permissionManager.allowlistAdd('safe_tool');

      const result = permissionManager.checkPermission('safe_tool');
      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('Tool is allowlisted');
    });

    it('should require approval for once scope', () => {
      permissionManager.setToolConfig('once_tool', { scope: 'once' });

      const result = permissionManager.checkPermission('once_tool');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('Per-call approval required');
    });

    it('should allow tools with always scope', () => {
      permissionManager.setToolConfig('always_tool', { scope: 'always' });

      const result = permissionManager.checkPermission('always_tool');
      expect(result.allowed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('Tool scope is "always"');
    });

    it('should block tools with never scope', () => {
      permissionManager.setToolConfig('never_tool', { scope: 'never' });

      const result = permissionManager.checkPermission('never_tool');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('Tool scope is "never"');
    });

    it('should require session approval for session scope', () => {
      permissionManager.setToolConfig('session_tool', { scope: 'session' });

      const result = permissionManager.checkPermission('session_tool');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('Session approval required');
    });

    it('should allow session-approved tools', () => {
      permissionManager.setToolConfig('session_tool', { scope: 'session' });
      permissionManager.approveForSession('session_tool');

      const result = permissionManager.checkPermission('session_tool');
      expect(result.allowed).toBe(true);
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('Tool approved for session');
    });
  });

  describe('needsApproval', () => {
    it('should return true for tools needing approval', () => {
      const toolCall = createToolCall('some_tool');
      expect(permissionManager.needsApproval(toolCall)).toBe(true);
    });

    it('should return false for allowlisted tools', () => {
      permissionManager.allowlistAdd('safe_tool');
      const toolCall = createToolCall('safe_tool');
      expect(permissionManager.needsApproval(toolCall)).toBe(false);
    });

    it('should return false for blocked tools (they cannot execute)', () => {
      permissionManager.blocklistAdd('blocked_tool');
      const toolCall = createToolCall('blocked_tool');
      expect(permissionManager.needsApproval(toolCall)).toBe(false);
    });
  });

  describe('isBlocked', () => {
    it('should return true for blocklisted tools', () => {
      permissionManager.blocklistAdd('blocked_tool');
      expect(permissionManager.isBlocked('blocked_tool')).toBe(true);
    });

    it('should return true for never scope tools', () => {
      permissionManager.setToolConfig('never_tool', { scope: 'never' });
      expect(permissionManager.isBlocked('never_tool')).toBe(true);
    });

    it('should return false for other tools', () => {
      expect(permissionManager.isBlocked('some_tool')).toBe(false);
    });
  });

  describe('isApproved', () => {
    it('should return true for allowlisted tools', () => {
      permissionManager.allowlistAdd('safe_tool');
      expect(permissionManager.isApproved('safe_tool')).toBe(true);
    });

    it('should return true for always scope tools', () => {
      permissionManager.setToolConfig('always_tool', { scope: 'always' });
      expect(permissionManager.isApproved('always_tool')).toBe(true);
    });

    it('should return true for session-approved tools with session scope', () => {
      permissionManager.setToolConfig('approved_tool', { scope: 'session' });
      permissionManager.approveForSession('approved_tool');
      expect(permissionManager.isApproved('approved_tool')).toBe(true);
    });

    it('should return false for unapproved tools', () => {
      expect(permissionManager.isApproved('some_tool')).toBe(false);
    });
  });

  describe('approve', () => {
    it('should approve a tool with session scope', () => {
      permissionManager.approve('some_tool', { scope: 'session' });
      expect(permissionManager.isApprovedForSession('some_tool')).toBe(true);
    });

    it('should emit tool:approved event', () => {
      const listener = vi.fn();
      permissionManager.on('tool:approved', listener);

      permissionManager.approve('some_tool', { scope: 'session', approvedBy: 'user1' });

      expect(listener).toHaveBeenCalledWith({
        toolName: 'some_tool',
        scope: 'session',
        approvedBy: 'user1',
      });
    });

    it('should record approval timestamp', () => {
      const beforeTime = new Date();
      permissionManager.approve('some_tool');
      const afterTime = new Date();

      const entry = permissionManager.getApprovalEntry('some_tool');
      expect(entry).toBeDefined();
      expect(entry!.approvedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(entry!.approvedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('approveForSession', () => {
    it('should approve tool for session', () => {
      permissionManager.approveForSession('session_tool');
      expect(permissionManager.isApprovedForSession('session_tool')).toBe(true);
    });

    it('should record approvedBy', () => {
      permissionManager.approveForSession('session_tool', 'admin');
      const entry = permissionManager.getApprovalEntry('session_tool');
      expect(entry?.approvedBy).toBe('admin');
    });
  });

  describe('revoke', () => {
    it('should revoke an approval', () => {
      permissionManager.approveForSession('some_tool');
      expect(permissionManager.isApprovedForSession('some_tool')).toBe(true);

      permissionManager.revoke('some_tool');
      expect(permissionManager.isApprovedForSession('some_tool')).toBe(false);
    });

    it('should emit tool:revoked event', () => {
      const listener = vi.fn();
      permissionManager.on('tool:revoked', listener);

      permissionManager.approveForSession('some_tool');
      permissionManager.revoke('some_tool');

      expect(listener).toHaveBeenCalledWith({ toolName: 'some_tool' });
    });

    it('should not emit event when revoking non-existent approval', () => {
      const listener = vi.fn();
      permissionManager.on('tool:revoked', listener);

      permissionManager.revoke('non_existent_tool');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('deny', () => {
    it('should emit tool:denied event', () => {
      const listener = vi.fn();
      permissionManager.on('tool:denied', listener);

      permissionManager.deny('some_tool', 'User denied');

      expect(listener).toHaveBeenCalledWith({
        toolName: 'some_tool',
        reason: 'User denied',
      });
    });
  });

  describe('isApprovedForSession', () => {
    it('should return true for session-approved tools', () => {
      permissionManager.approveForSession('session_tool');
      expect(permissionManager.isApprovedForSession('session_tool')).toBe(true);
    });

    it('should return false for unapproved tools', () => {
      expect(permissionManager.isApprovedForSession('unapproved_tool')).toBe(false);
    });

    it('should return false for expired approvals', () => {
      permissionManager.setToolConfig('expiring_tool', { sessionTTLMs: 1 }); // 1ms TTL
      permissionManager.approveForSession('expiring_tool');

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(permissionManager.isApprovedForSession('expiring_tool')).toBe(false);
          resolve();
        }, 10);
      });
    });
  });

  describe('allowlist management', () => {
    it('should add to allowlist', () => {
      permissionManager.allowlistAdd('safe_tool');
      expect(permissionManager.isAllowlisted('safe_tool')).toBe(true);
    });

    it('should remove from allowlist', () => {
      permissionManager.allowlistAdd('safe_tool');
      permissionManager.allowlistRemove('safe_tool');
      expect(permissionManager.isAllowlisted('safe_tool')).toBe(false);
    });

    it('should emit allowlist:added event', () => {
      const listener = vi.fn();
      permissionManager.on('allowlist:added', listener);

      permissionManager.allowlistAdd('safe_tool');

      expect(listener).toHaveBeenCalledWith({ toolName: 'safe_tool' });
    });

    it('should emit allowlist:removed event', () => {
      const listener = vi.fn();
      permissionManager.on('allowlist:removed', listener);

      permissionManager.allowlistAdd('safe_tool');
      permissionManager.allowlistRemove('safe_tool');

      expect(listener).toHaveBeenCalledWith({ toolName: 'safe_tool' });
    });

    it('should remove from blocklist when adding to allowlist', () => {
      permissionManager.blocklistAdd('tool');
      expect(permissionManager.isBlocklisted('tool')).toBe(true);

      permissionManager.allowlistAdd('tool');
      expect(permissionManager.isAllowlisted('tool')).toBe(true);
      expect(permissionManager.isBlocklisted('tool')).toBe(false);
    });

    it('should return all allowlisted tools', () => {
      permissionManager.allowlistAdd('tool1');
      permissionManager.allowlistAdd('tool2');

      const allowlist = permissionManager.getAllowlist();
      expect(allowlist).toContain('tool1');
      expect(allowlist).toContain('tool2');
      // Should include DEFAULT_ALLOWLIST (16 items) + 2 custom tools = 18
      expect(allowlist.length).toBeGreaterThanOrEqual(18);
    });
  });

  describe('blocklist management', () => {
    it('should add to blocklist', () => {
      permissionManager.blocklistAdd('dangerous_tool');
      expect(permissionManager.isBlocklisted('dangerous_tool')).toBe(true);
    });

    it('should remove from blocklist', () => {
      permissionManager.blocklistAdd('dangerous_tool');
      permissionManager.blocklistRemove('dangerous_tool');
      expect(permissionManager.isBlocklisted('dangerous_tool')).toBe(false);
    });

    it('should emit blocklist:added event', () => {
      const listener = vi.fn();
      permissionManager.on('blocklist:added', listener);

      permissionManager.blocklistAdd('dangerous_tool');

      expect(listener).toHaveBeenCalledWith({ toolName: 'dangerous_tool' });
    });

    it('should emit blocklist:removed event', () => {
      const listener = vi.fn();
      permissionManager.on('blocklist:removed', listener);

      permissionManager.blocklistAdd('dangerous_tool');
      permissionManager.blocklistRemove('dangerous_tool');

      expect(listener).toHaveBeenCalledWith({ toolName: 'dangerous_tool' });
    });

    it('should remove from allowlist when adding to blocklist', () => {
      permissionManager.allowlistAdd('tool');
      expect(permissionManager.isAllowlisted('tool')).toBe(true);

      permissionManager.blocklistAdd('tool');
      expect(permissionManager.isBlocklisted('tool')).toBe(true);
      expect(permissionManager.isAllowlisted('tool')).toBe(false);
    });

    it('should return all blocklisted tools', () => {
      permissionManager.blocklistAdd('tool1');
      permissionManager.blocklistAdd('tool2');

      const blocklist = permissionManager.getBlocklist();
      expect(blocklist).toContain('tool1');
      expect(blocklist).toContain('tool2');
      expect(blocklist).toHaveLength(2);
    });
  });

  describe('tool configuration', () => {
    it('should set tool config', () => {
      permissionManager.setToolConfig('custom_tool', {
        scope: 'session',
        riskLevel: 'high',
        approvalMessage: 'This is dangerous!',
      });

      const config = permissionManager.getToolConfig('custom_tool');
      expect(config?.scope).toBe('session');
      expect(config?.riskLevel).toBe('high');
      expect(config?.approvalMessage).toBe('This is dangerous!');
    });

    it('should return undefined for unconfigured tools', () => {
      expect(permissionManager.getToolConfig('unknown_tool')).toBeUndefined();
    });

    it('should get effective config with defaults', () => {
      const config = permissionManager.getEffectiveConfig('unknown_tool');
      expect(config.scope).toBe('once');
      expect(config.riskLevel).toBe('low');
    });

    it('should get effective config with tool overrides', () => {
      permissionManager.setToolConfig('custom_tool', { scope: 'session' });

      const config = permissionManager.getEffectiveConfig('custom_tool');
      expect(config.scope).toBe('session');
      expect(config.riskLevel).toBe('low'); // Default
    });
  });

  describe('requestApproval', () => {
    it('should call onApprovalRequired callback', async () => {
      const approvalCallback = vi.fn().mockResolvedValue({
        approved: true,
        scope: 'session',
        approvedBy: 'test-user',
      });

      const manager = new ToolPermissionManager({
        onApprovalRequired: approvalCallback,
      });

      const context: PermissionCheckContext = {
        toolCall: createToolCall('some_tool'),
        parsedArgs: {},
        config: {},
        executionId: 'exec_1',
        iteration: 0,
        agentType: 'agent',
      };

      const decision = await manager.requestApproval(context);

      expect(approvalCallback).toHaveBeenCalledWith(context);
      expect(decision.approved).toBe(true);
      expect(manager.isApprovedForSession('some_tool')).toBe(true);
    });

    it('should handle denial', async () => {
      const approvalCallback = vi.fn().mockResolvedValue({
        approved: false,
        reason: 'User rejected',
      });

      const manager = new ToolPermissionManager({
        onApprovalRequired: approvalCallback,
      });

      const context: PermissionCheckContext = {
        toolCall: createToolCall('some_tool'),
        parsedArgs: {},
        config: {},
        executionId: 'exec_1',
        iteration: 0,
        agentType: 'agent',
      };

      const decision = await manager.requestApproval(context);

      expect(decision.approved).toBe(false);
      expect(decision.reason).toBe('User rejected');
    });

    it('should auto-approve when no callback (backward compatibility)', async () => {
      // When no approval callback is configured, tools are auto-approved
      // for backward compatibility with existing code that doesn't use permissions
      const context: PermissionCheckContext = {
        toolCall: createToolCall('some_tool'),
        parsedArgs: {},
        config: {},
        executionId: 'exec_1',
        iteration: 0,
        agentType: 'agent',
      };

      const decision = await permissionManager.requestApproval(context);

      expect(decision.approved).toBe(true);
      expect(decision.reason).toContain('Auto-approved');
    });
  });

  describe('getApprovedTools', () => {
    it('should return all approved tools', () => {
      permissionManager.approveForSession('tool1');
      permissionManager.approveForSession('tool2');

      const approved = permissionManager.getApprovedTools();
      expect(approved).toContain('tool1');
      expect(approved).toContain('tool2');
      expect(approved).toHaveLength(2);
    });

    it('should not return expired approvals', () => {
      permissionManager.setToolConfig('expiring', { sessionTTLMs: 1 });
      permissionManager.approveForSession('expiring');
      permissionManager.approveForSession('non_expiring');

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const approved = permissionManager.getApprovedTools();
          expect(approved).not.toContain('expiring');
          expect(approved).toContain('non_expiring');
          resolve();
        }, 10);
      });
    });
  });

  describe('clearSession', () => {
    it('should clear all session approvals', () => {
      permissionManager.approveForSession('tool1');
      permissionManager.approveForSession('tool2');
      expect(permissionManager.getApprovedTools()).toHaveLength(2);

      permissionManager.clearSession();
      expect(permissionManager.getApprovedTools()).toHaveLength(0);
    });

    it('should emit session:cleared event', () => {
      const listener = vi.fn();
      permissionManager.on('session:cleared', listener);

      permissionManager.clearSession();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('getState / loadState', () => {
    it('should serialize state', () => {
      permissionManager.approveForSession('approved_tool');
      permissionManager.allowlistAdd('allowed_tool');
      permissionManager.blocklistAdd('blocked_tool');

      const state = permissionManager.getState();

      expect(state.version).toBe(APPROVAL_STATE_VERSION);
      expect(state.approvals['approved_tool']).toBeDefined();
      expect(state.allowlist).toContain('allowed_tool');
      expect(state.blocklist).toContain('blocked_tool');
    });

    it('should deserialize state', () => {
      const state: SerializedApprovalState = {
        version: APPROVAL_STATE_VERSION,
        approvals: {
          approved_tool: {
            toolName: 'approved_tool',
            scope: 'session',
            approvedAt: new Date().toISOString(),
          },
        },
        allowlist: ['allowed_tool'],
        blocklist: ['blocked_tool'],
      };

      const manager = new ToolPermissionManager();
      manager.loadState(state);

      expect(manager.isApprovedForSession('approved_tool')).toBe(true);
      expect(manager.isAllowlisted('allowed_tool')).toBe(true);
      expect(manager.isBlocklisted('blocked_tool')).toBe(true);
    });

    it('should skip expired approvals when loading', () => {
      const pastDate = new Date(Date.now() - 10000); // 10 seconds ago
      const state: SerializedApprovalState = {
        version: APPROVAL_STATE_VERSION,
        approvals: {
          expired_tool: {
            toolName: 'expired_tool',
            scope: 'session',
            approvedAt: pastDate.toISOString(),
            expiresAt: pastDate.toISOString(),
          },
        },
        allowlist: [],
        blocklist: [],
      };

      const manager = new ToolPermissionManager();
      manager.loadState(state);

      expect(manager.isApprovedForSession('expired_tool')).toBe(false);
    });

    it('should merge with constructor-provided lists', () => {
      const manager = new ToolPermissionManager({
        allowlist: ['constructor_allowed'],
        blocklist: ['constructor_blocked'],
      });

      const state: SerializedApprovalState = {
        version: APPROVAL_STATE_VERSION,
        approvals: {},
        allowlist: ['state_allowed'],
        blocklist: ['state_blocked'],
      };

      manager.loadState(state);

      expect(manager.isAllowlisted('constructor_allowed')).toBe(true);
      expect(manager.isAllowlisted('state_allowed')).toBe(true);
      expect(manager.isBlocklisted('constructor_blocked')).toBe(true);
      expect(manager.isBlocklisted('state_blocked')).toBe(true);
    });

    it('should warn on unknown version', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const state: SerializedApprovalState = {
        version: 999,
        approvals: {
          some_tool: {
            toolName: 'some_tool',
            scope: 'session',
            approvedAt: new Date().toISOString(),
          },
        },
        allowlist: [],
        blocklist: [],
      };

      permissionManager.loadState(state);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown state version')
      );
      expect(permissionManager.isApprovedForSession('some_tool')).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('default allowlist', () => {
    it('should include default allowlisted tools on construction', () => {
      const allowlist = permissionManager.getAllowlist();

      // Check filesystem read-only tools
      expect(allowlist).toContain('read_file');
      expect(allowlist).toContain('glob');
      expect(allowlist).toContain('grep');
      expect(allowlist).toContain('list_directory');

      // Check unified store tools
      expect(allowlist).toContain('store_get');
      expect(allowlist).toContain('store_set');
      expect(allowlist).toContain('store_delete');
      expect(allowlist).toContain('store_list');
      expect(allowlist).toContain('store_action');

      // Check context introspection tool (unified)
      expect(allowlist).toContain('context_stats');

      // Check meta-tools
      expect(allowlist).toContain('_start_planning');
      expect(allowlist).toContain('_modify_plan');
      expect(allowlist).toContain('_report_progress');
      expect(allowlist).toContain('_request_approval');
    });

    it('should allow default allowlisted tools without approval', () => {
      // Test a read-only filesystem tool
      const readResult = permissionManager.checkPermission('read_file');
      expect(readResult.allowed).toBe(true);
      expect(readResult.needsApproval).toBe(false);

      // Test a store tool
      const memoryResult = permissionManager.checkPermission('store_set');
      expect(memoryResult.allowed).toBe(true);
      expect(memoryResult.needsApproval).toBe(false);

      // Test a meta-tool (critical!)
      const metaResult = permissionManager.checkPermission('_request_approval');
      expect(metaResult.allowed).toBe(true);
      expect(metaResult.needsApproval).toBe(false);
    });

    it('should NOT auto-allow destructive tools', () => {
      // Test destructive filesystem tools
      const writeResult = permissionManager.checkPermission('write_file');
      expect(writeResult.needsApproval).toBe(true);

      const editResult = permissionManager.checkPermission('edit_file');
      expect(editResult.needsApproval).toBe(true);

      // Test shell execution
      const bashResult = permissionManager.checkPermission('bash');
      expect(bashResult.needsApproval).toBe(true);

      // Test external requests
      const webResult = permissionManager.checkPermission('web_fetch');
      expect(webResult.needsApproval).toBe(true);
    });

    it('should merge user allowlist with defaults', () => {
      const manager = new ToolPermissionManager({
        allowlist: ['custom_tool'],
      });

      const allowlist = manager.getAllowlist();

      // Should have both defaults and custom tools
      expect(allowlist).toContain('read_file'); // Default
      expect(allowlist).toContain('custom_tool'); // Custom
    });

    it('should allow blocklist to override default allowlist', () => {
      const manager = new ToolPermissionManager({
        blocklist: ['read_file'], // Block a default-allowlisted tool
      });

      const result = manager.checkPermission('read_file');
      expect(result.blocked).toBe(true);
      expect(result.allowed).toBe(false);
    });
  });

  describe('defaults', () => {
    it('should get defaults', () => {
      const defaults = permissionManager.getDefaults();
      expect(defaults.scope).toBe('once');
      expect(defaults.riskLevel).toBe('low');
    });

    it('should set defaults', () => {
      permissionManager.setDefaults({ scope: 'session', riskLevel: 'high' });

      const defaults = permissionManager.getDefaults();
      expect(defaults.scope).toBe('session');
      expect(defaults.riskLevel).toBe('high');
    });

    it('should partially update defaults', () => {
      permissionManager.setDefaults({ scope: 'always' });

      const defaults = permissionManager.getDefaults();
      expect(defaults.scope).toBe('always');
      expect(defaults.riskLevel).toBe('low'); // Unchanged
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      permissionManager.approveForSession('tool1');
      permissionManager.approveForSession('tool2');
      permissionManager.allowlistAdd('allowed1');
      permissionManager.blocklistAdd('blocked1');
      permissionManager.setToolConfig('configured', { scope: 'session' });

      const stats = permissionManager.getStats();

      expect(stats.approvedCount).toBe(2);
      // allowlistedCount includes DEFAULT_ALLOWLIST (16 items) + 'allowed1' = 17
      expect(stats.allowlistedCount).toBeGreaterThanOrEqual(17);
      expect(stats.blocklistedCount).toBe(1);
      expect(stats.configuredCount).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset all state including default allowlist', () => {
      permissionManager.approveForSession('tool1');
      permissionManager.allowlistAdd('allowed1');
      permissionManager.blocklistAdd('blocked1');
      permissionManager.setToolConfig('configured', { scope: 'session' });
      permissionManager.setDefaults({ scope: 'always', riskLevel: 'critical' });

      // Verify default allowlist exists before reset
      expect(permissionManager.getAllowlist().length).toBeGreaterThan(0);

      permissionManager.reset();

      // After reset, everything should be cleared (including default allowlist)
      expect(permissionManager.getApprovedTools()).toHaveLength(0);
      expect(permissionManager.getAllowlist()).toHaveLength(0);
      expect(permissionManager.getBlocklist()).toHaveLength(0);
      expect(permissionManager.getToolConfig('configured')).toBeUndefined();
      expect(permissionManager.getDefaults().scope).toBe('once');
      expect(permissionManager.getDefaults().riskLevel).toBe('low');
    });

    it('should require creating new instance to restore default allowlist', () => {
      permissionManager.reset();

      // After reset, default allowlist is cleared
      expect(permissionManager.isAllowlisted('read_file')).toBe(false);

      // Create new instance to get defaults back
      const newManager = new ToolPermissionManager();
      expect(newManager.isAllowlisted('read_file')).toBe(true);
    });
  });
});
