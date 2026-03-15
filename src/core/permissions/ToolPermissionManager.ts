/**
 * ToolPermissionManager - Core class for managing tool permissions
 *
 * Features:
 * - Approval caching (once, session, always, never scopes)
 * - Allowlist/blocklist management
 * - Session state persistence
 * - Event emission for audit trails
 *
 * Works with ALL agent types:
 * - Agent (basic)
 * - TaskAgent (task-based)
 * - UniversalAgent (mode-fluid)
 */

import { EventEmitter } from 'eventemitter3';
import type {
  PermissionScope,
  RiskLevel,
  ToolPermissionConfig,
  ApprovalCacheEntry,
  SerializedApprovalState,
  SerializedApprovalEntry,
  PermissionCheckResult,
  ApprovalDecision,
  AgentPermissionsConfig,
  PermissionCheckContext,
} from './types.js';
import {
  APPROVAL_STATE_VERSION,
  DEFAULT_PERMISSION_CONFIG,
  DEFAULT_ALLOWLIST,
} from './types.js';
import type { ToolCall } from '../../domain/entities/Tool.js';

// ============================================================================
// Event Types
// ============================================================================

export interface PermissionManagerEvents {
  'tool:approved': { toolName: string; scope: PermissionScope; approvedBy?: string };
  'tool:denied': { toolName: string; reason: string };
  'tool:blocked': { toolName: string; reason: string };
  'tool:revoked': { toolName: string };
  'allowlist:added': { toolName: string };
  'allowlist:removed': { toolName: string };
  'blocklist:added': { toolName: string };
  'blocklist:removed': { toolName: string };
  'session:cleared': {};
}

// ============================================================================
// ToolPermissionManager Class
// ============================================================================

export class ToolPermissionManager extends EventEmitter {
  // Approval cache (session-level)
  private approvalCache: Map<string, ApprovalCacheEntry> = new Map();

  // Allow/block lists
  private allowlist: Set<string> = new Set();
  private blocklist: Set<string> = new Set();

  // Per-tool configurations
  private toolConfigs: Map<string, ToolPermissionConfig> = new Map();

  // Defaults
  private defaultScope: PermissionScope;
  private defaultRiskLevel: RiskLevel;

  // Optional approval callback
  private onApprovalRequired?: (context: PermissionCheckContext) => Promise<ApprovalDecision>;

  constructor(config?: AgentPermissionsConfig) {
    super();

    this.defaultScope = config?.defaultScope ?? DEFAULT_PERMISSION_CONFIG.scope;
    this.defaultRiskLevel = config?.defaultRiskLevel ?? DEFAULT_PERMISSION_CONFIG.riskLevel;

    // Initialize allowlist with defaults first
    // This ensures safe tools (read-only, introspection, meta-tools) are always allowed
    for (const toolName of DEFAULT_ALLOWLIST) {
      this.allowlist.add(toolName);
    }

    // Add user-provided allowlist (merges with defaults)
    if (config?.allowlist) {
      for (const toolName of config.allowlist) {
        this.allowlist.add(toolName);
      }
    }

    // Initialize blocklist
    if (config?.blocklist) {
      for (const toolName of config.blocklist) {
        this.blocklist.add(toolName);
      }
    }

    // Initialize per-tool configs
    if (config?.tools) {
      for (const [toolName, toolConfig] of Object.entries(config.tools)) {
        this.toolConfigs.set(toolName, toolConfig);
      }
    }

    // Store approval callback
    this.onApprovalRequired = config?.onApprovalRequired;
  }

  // ==========================================================================
  // Core Permission Checking
  // ==========================================================================

  /**
   * Check if a tool needs approval before execution
   *
   * @param toolName - Name of the tool
   * @param _args - Optional arguments (for args-specific approval, reserved for future use)
   * @returns PermissionCheckResult with allowed/needsApproval/blocked status
   */
  checkPermission(toolName: string, _args?: Record<string, unknown>): PermissionCheckResult {
    const config = this.getEffectiveConfig(toolName);

    // Check blocklist first (highest priority)
    if (this.blocklist.has(toolName)) {
      return {
        allowed: false,
        needsApproval: false,
        blocked: true,
        reason: 'Tool is blocklisted',
        config,
      };
    }

    // Check allowlist (always allowed)
    if (this.allowlist.has(toolName)) {
      return {
        allowed: true,
        needsApproval: false,
        blocked: false,
        reason: 'Tool is allowlisted',
        config,
      };
    }

    // Check scope
    const scope = config.scope ?? this.defaultScope;

    switch (scope) {
      case 'always':
        return {
          allowed: true,
          needsApproval: false,
          blocked: false,
          reason: 'Tool scope is "always"',
          config,
        };

      case 'never':
        return {
          allowed: false,
          needsApproval: false,
          blocked: true,
          reason: 'Tool scope is "never"',
          config,
        };

      case 'session':
        // Check if already approved this session
        if (this.isApprovedForSession(toolName)) {
          return {
            allowed: true,
            needsApproval: false,
            blocked: false,
            reason: 'Tool approved for session',
            config,
          };
        }
        return {
          allowed: false,
          needsApproval: true,
          blocked: false,
          reason: 'Session approval required',
          config,
        };

      case 'once':
      default:
        // Always require approval
        return {
          allowed: false,
          needsApproval: true,
          blocked: false,
          reason: 'Per-call approval required',
          config,
        };
    }
  }

  /**
   * Check if a tool call needs approval (uses ToolCall object)
   */
  needsApproval(toolCall: ToolCall): boolean {
    const result = this.checkPermission(toolCall.function.name);
    return result.needsApproval;
  }

  /**
   * Check if a tool is blocked
   */
  isBlocked(toolName: string): boolean {
    return this.checkPermission(toolName).blocked;
  }

  /**
   * Check if a tool is approved (either allowlisted or session-approved)
   */
  isApproved(toolName: string): boolean {
    return this.checkPermission(toolName).allowed;
  }

  // ==========================================================================
  // Approval Management
  // ==========================================================================

  /**
   * Approve a tool (record approval)
   *
   * @param toolName - Name of the tool
   * @param decision - Approval decision with scope
   */
  approve(toolName: string, decision?: Partial<ApprovalDecision>): void {
    const scope = decision?.scope ?? 'session';
    const config = this.getEffectiveConfig(toolName);

    // Calculate expiration
    let expiresAt: Date | undefined;
    if (scope === 'session' && config.sessionTTLMs) {
      expiresAt = new Date(Date.now() + config.sessionTTLMs);
    }

    const entry: ApprovalCacheEntry = {
      toolName,
      scope,
      approvedAt: new Date(),
      approvedBy: decision?.approvedBy,
      expiresAt,
    };

    this.approvalCache.set(toolName, entry);

    this.emit('tool:approved', {
      toolName,
      scope,
      approvedBy: decision?.approvedBy,
    });
  }

  /**
   * Approve a tool for the entire session
   */
  approveForSession(toolName: string, approvedBy?: string): void {
    this.approve(toolName, { scope: 'session', approvedBy });
  }

  /**
   * Revoke a tool's approval
   */
  revoke(toolName: string): void {
    if (this.approvalCache.has(toolName)) {
      this.approvalCache.delete(toolName);
      this.emit('tool:revoked', { toolName });
    }
  }

  /**
   * Deny a tool execution (for audit trail)
   */
  deny(toolName: string, reason: string): void {
    this.emit('tool:denied', { toolName, reason });
  }

  /**
   * Check if a tool has been approved for the current session
   */
  isApprovedForSession(toolName: string): boolean {
    const entry = this.approvalCache.get(toolName);
    if (!entry) return false;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.approvalCache.delete(toolName);
      return false;
    }

    return entry.scope === 'session' || entry.scope === 'always';
  }

  // ==========================================================================
  // Allowlist / Blocklist Management
  // ==========================================================================

  /**
   * Add a tool to the allowlist (always allowed)
   */
  allowlistAdd(toolName: string): void {
    // Remove from blocklist if present
    this.blocklist.delete(toolName);

    this.allowlist.add(toolName);
    this.emit('allowlist:added', { toolName });
  }

  /**
   * Remove a tool from the allowlist
   */
  allowlistRemove(toolName: string): void {
    if (this.allowlist.delete(toolName)) {
      this.emit('allowlist:removed', { toolName });
    }
  }

  /**
   * Check if a tool is in the allowlist
   */
  isAllowlisted(toolName: string): boolean {
    return this.allowlist.has(toolName);
  }

  /**
   * Get all allowlisted tools
   */
  getAllowlist(): string[] {
    return Array.from(this.allowlist);
  }

  /**
   * Add a tool to the blocklist (always blocked)
   */
  blocklistAdd(toolName: string): void {
    // Remove from allowlist if present
    this.allowlist.delete(toolName);

    this.blocklist.add(toolName);
    this.emit('blocklist:added', { toolName });
  }

  /**
   * Remove a tool from the blocklist
   */
  blocklistRemove(toolName: string): void {
    if (this.blocklist.delete(toolName)) {
      this.emit('blocklist:removed', { toolName });
    }
  }

  /**
   * Check if a tool is in the blocklist
   */
  isBlocklisted(toolName: string): boolean {
    return this.blocklist.has(toolName);
  }

  /**
   * Get all blocklisted tools
   */
  getBlocklist(): string[] {
    return Array.from(this.blocklist);
  }

  // ==========================================================================
  // Tool Configuration
  // ==========================================================================

  /**
   * Set permission config for a specific tool
   */
  setToolConfig(toolName: string, config: ToolPermissionConfig): void {
    this.toolConfigs.set(toolName, config);
  }

  /**
   * Get permission config for a specific tool
   */
  getToolConfig(toolName: string): ToolPermissionConfig | undefined {
    return this.toolConfigs.get(toolName);
  }

  /**
   * Get effective config (tool-specific or defaults)
   */
  getEffectiveConfig(toolName: string): ToolPermissionConfig {
    const toolConfig = this.toolConfigs.get(toolName);
    return {
      scope: toolConfig?.scope ?? this.defaultScope,
      riskLevel: toolConfig?.riskLevel ?? this.defaultRiskLevel,
      approvalMessage: toolConfig?.approvalMessage,
      sensitiveArgs: toolConfig?.sensitiveArgs,
      sessionTTLMs: toolConfig?.sessionTTLMs,
    };
  }

  // ==========================================================================
  // Approval Request Handler
  // ==========================================================================

  /**
   * Request approval for a tool call
   *
   * If an onApprovalRequired callback is set, it will be called.
   * Otherwise, this auto-approves for backward compatibility.
   *
   * NOTE: If you want to require explicit approval, you MUST either:
   * 1. Set onApprovalRequired callback in AgentPermissionsConfig
   * 2. Register an 'approve:tool' hook in the Agent
   * 3. Add tools to the blocklist if they should never run
   *
   * This auto-approval behavior preserves backward compatibility with
   * existing code that doesn't use the permission system.
   */
  async requestApproval(context: PermissionCheckContext): Promise<ApprovalDecision> {
    if (this.onApprovalRequired) {
      const decision = await this.onApprovalRequired(context);

      // Record the decision
      if (decision.approved) {
        this.approve(context.toolCall.function.name, decision);
      } else {
        this.deny(context.toolCall.function.name, decision.reason ?? 'User denied');
      }

      return decision;
    }

    // No callback - auto-approve for backward compatibility
    // This preserves the pre-permission-system behavior where all tools
    // were automatically allowed to execute. Users who want to require
    // explicit approval must set onApprovalRequired or use approve:tool hooks.
    return {
      approved: true,
      reason: 'Auto-approved (no approval handler configured)',
    };
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get all tools that have session approvals
   */
  getApprovedTools(): string[] {
    const approved: string[] = [];

    for (const [toolName, entry] of this.approvalCache) {
      // Skip expired
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        continue;
      }
      approved.push(toolName);
    }

    return approved;
  }

  /**
   * Get the approval entry for a tool
   */
  getApprovalEntry(toolName: string): ApprovalCacheEntry | undefined {
    const entry = this.approvalCache.get(toolName);
    if (!entry) return undefined;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.approvalCache.delete(toolName);
      return undefined;
    }

    return entry;
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Clear all session approvals
   */
  clearSession(): void {
    this.approvalCache.clear();
    this.emit('session:cleared', {});
  }

  // ==========================================================================
  // Persistence (for Session integration)
  // ==========================================================================

  /**
   * Serialize approval state for persistence
   */
  getState(): SerializedApprovalState {
    const approvals: Record<string, SerializedApprovalEntry> = {};

    for (const [toolName, entry] of this.approvalCache) {
      // Skip expired entries
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        continue;
      }

      approvals[toolName] = {
        toolName: entry.toolName,
        scope: entry.scope,
        approvedAt: entry.approvedAt.toISOString(),
        approvedBy: entry.approvedBy,
        expiresAt: entry.expiresAt?.toISOString(),
        argsHash: entry.argsHash,
      };
    }

    return {
      version: APPROVAL_STATE_VERSION,
      approvals,
      blocklist: Array.from(this.blocklist),
      allowlist: Array.from(this.allowlist),
    };
  }

  /**
   * Load approval state from persistence
   */
  loadState(state: SerializedApprovalState): void {
    // Clear current state
    this.approvalCache.clear();

    // Validate version
    if (state.version !== APPROVAL_STATE_VERSION) {
      // Future: handle migrations
      console.warn(`ToolPermissionManager: Unknown state version ${state.version}, ignoring`);
      return;
    }

    // Restore approvals
    for (const [toolName, entry] of Object.entries(state.approvals)) {
      const approvedAt = new Date(entry.approvedAt);
      const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : undefined;

      // Skip expired entries
      if (expiresAt && expiresAt < new Date()) {
        continue;
      }

      this.approvalCache.set(toolName, {
        toolName: entry.toolName,
        scope: entry.scope,
        approvedAt,
        approvedBy: entry.approvedBy,
        expiresAt,
        argsHash: entry.argsHash,
      });
    }

    // Restore lists (merge with constructor-provided lists)
    for (const toolName of state.blocklist) {
      this.blocklist.add(toolName);
    }

    for (const toolName of state.allowlist) {
      // Remove from blocklist if present (allowlist takes precedence in loaded state)
      this.blocklist.delete(toolName);
      this.allowlist.add(toolName);
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get defaults
   */
  getDefaults(): { scope: PermissionScope; riskLevel: RiskLevel } {
    return {
      scope: this.defaultScope,
      riskLevel: this.defaultRiskLevel,
    };
  }

  /**
   * Set defaults
   */
  setDefaults(defaults: { scope?: PermissionScope; riskLevel?: RiskLevel }): void {
    if (defaults.scope) this.defaultScope = defaults.scope;
    if (defaults.riskLevel) this.defaultRiskLevel = defaults.riskLevel;
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    approvedCount: number;
    allowlistedCount: number;
    blocklistedCount: number;
    configuredCount: number;
  } {
    return {
      approvedCount: this.getApprovedTools().length,
      allowlistedCount: this.allowlist.size,
      blocklistedCount: this.blocklist.size,
      configuredCount: this.toolConfigs.size,
    };
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.approvalCache.clear();
    this.allowlist.clear();
    this.blocklist.clear();
    this.toolConfigs.clear();
    this.defaultScope = DEFAULT_PERMISSION_CONFIG.scope;
    this.defaultRiskLevel = DEFAULT_PERMISSION_CONFIG.riskLevel;
  }

  /**
   * Destroy the permission manager and release all resources
   */
  destroy(): void {
    this.approvalCache.clear();
    this.allowlist.clear();
    this.blocklist.clear();
    this.toolConfigs.clear();
    this.onApprovalRequired = undefined;
    this.removeAllListeners();
  }
}
