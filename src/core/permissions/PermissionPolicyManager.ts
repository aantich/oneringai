/**
 * PermissionPolicyManager - Top-level manager for the policy-based permission system.
 *
 * Evaluation order:
 * 1. USER RULES PRE-CHECK (highest priority, FINAL when matched)
 * 2. Parent delegation pre-check (orchestrator workers)
 * 3. Normal policy chain (built-in policies, tool self-declarations)
 *
 * Also provides:
 * - Approval flow (onApprovalRequired callback, can create persistent user rules)
 * - Argument-scoped approval cache (via SessionApprovalPolicy, in-memory only)
 * - Centralized audit via events (subscribe to 'permission:audit')
 * - Backward compatibility with legacy ToolPermissionManager
 */

import { EventEmitter } from 'eventemitter3';
import { PolicyChain } from './PolicyChain.js';
import { UserPermissionRulesEngine } from './UserPermissionRulesEngine.js';
import { AllowlistPolicy } from './policies/AllowlistPolicy.js';
import { BlocklistPolicy } from './policies/BlocklistPolicy.js';
import { SessionApprovalPolicy } from './policies/SessionApprovalPolicy.js';
import type {
  IPermissionPolicy,
  PolicyContext,
  PolicyDecision,
  PolicyCheckResult,
  PolicyChainConfig,
  ApprovalRequestContext,
  ApprovalDecision,
  PermissionAuditEntry,
  PermissionScope,
  AgentPermissionsConfig,
  AgentPolicyConfig,
  SerializedPolicyState,
  SerializedApprovalEntry,
} from './types.js';
import { DEFAULT_ALLOWLIST, DEFAULT_PERMISSION_CONFIG, POLICY_STATE_VERSION } from './types.js';
import type { UserPermissionRule } from './types.js';
import type { IUserPermissionRulesStorage } from '../../domain/interfaces/IUserPermissionRulesStorage.js';

// ============================================================================
// Events
// ============================================================================

export interface PolicyManagerEvents {
  'permission:allow': PermissionAuditEntry;
  'permission:deny': PermissionAuditEntry;
  'permission:approval_granted': PermissionAuditEntry;
  'permission:approval_denied': PermissionAuditEntry;
  'permission:audit': PermissionAuditEntry;
  'policy:added': { name: string };
  'policy:removed': { name: string };
  'session:cleared': {};
}

// ============================================================================
// Config
// ============================================================================

export interface PermissionPolicyManagerConfig {
  /** Policies to register at construction */
  policies?: IPermissionPolicy[];

  /** Policy chain configuration */
  chain?: PolicyChainConfig;

  /** Callback invoked when a tool needs user approval */
  onApprovalRequired?: (context: ApprovalRequestContext) => Promise<ApprovalDecision>;

  /** Per-user permission rules storage (optional) */
  userRulesStorage?: IUserPermissionRulesStorage;
}

// ============================================================================
// Sensitive key detection for audit redaction
// ============================================================================

const SENSITIVE_KEYS = new Set([
  'token', 'password', 'secret', 'authorization', 'apikey', 'api_key',
  'credential', 'private_key', 'access_token', 'refresh_token',
  'client_secret', 'passphrase', 'key',
]);

const MAX_ARG_VALUE_LENGTH = 500;

// ============================================================================
// PermissionPolicyManager
// ============================================================================

export class PermissionPolicyManager extends EventEmitter {
  private chain: PolicyChain;
  private _isDestroyed = false;

  // Delegation
  private parentEvaluator?: PermissionPolicyManager;

  // Approval callback
  private onApprovalRequired?: (context: ApprovalRequestContext) => Promise<ApprovalDecision>;

  // User permission rules engine (highest priority, pre-check)
  private _userRulesEngine: UserPermissionRulesEngine;

  // References to built-in policies for direct manipulation
  private _allowlistPolicy?: AllowlistPolicy;
  private _blocklistPolicy?: BlocklistPolicy;
  private _sessionApprovalPolicy?: SessionApprovalPolicy;

  constructor(config: PermissionPolicyManagerConfig = {}) {
    super();

    this.chain = new PolicyChain(config.chain);
    this._userRulesEngine = new UserPermissionRulesEngine(config.userRulesStorage);
    this.onApprovalRequired = config.onApprovalRequired;

    // Register provided policies
    if (config.policies) {
      for (const policy of config.policies) {
        this.chain.add(policy);
        this.trackBuiltinPolicy(policy);
      }
    }
  }

  // ==========================================================================
  // Policy Management
  // ==========================================================================

  addPolicy(policy: IPermissionPolicy): void {
    this.chain.add(policy);
    this.trackBuiltinPolicy(policy);
    this.emit('policy:added', { name: policy.name });
  }

  removePolicy(name: string): boolean {
    const removed = this.chain.remove(name);
    if (removed) {
      this.emit('policy:removed', { name });
    }
    return removed;
  }

  hasPolicy(name: string): boolean {
    return this.chain.has(name);
  }

  listPolicies(): IPermissionPolicy[] {
    return this.chain.list();
  }

  // ==========================================================================
  // Delegation (Orchestrator Parent→Worker)
  // ==========================================================================

  /**
   * Set a read-only parent evaluator for orchestrator delegation.
   *
   * - Parent deny is FINAL — worker cannot override
   * - Parent allow does NOT skip worker restrictions
   * - Parent approval callback is NOT invoked during delegation check
   */
  setParentEvaluator(parent: PermissionPolicyManager): void {
    // Cycle detection: walk the parent chain to ensure no cycles
    let current: PermissionPolicyManager | undefined = parent;
    let depth = 0;
    while (current) {
      if (current === this) {
        throw new Error('Circular parent evaluator chain detected');
      }
      if (++depth > 10) {
        throw new Error('Parent evaluator chain too deep (max 10)');
      }
      current = current.parentEvaluator;
    }
    this.parentEvaluator = parent;
  }

  /**
   * Get the parent evaluator (if set).
   */
  getParentEvaluator(): PermissionPolicyManager | undefined {
    return this.parentEvaluator;
  }

  // ==========================================================================
  // Core Permission Check
  // ==========================================================================

  /**
   * Check if a tool call is permitted.
   *
   * Evaluation order:
   * 1. USER RULES PRE-CHECK (highest priority, FINAL when matched)
   * 2. Parent delegation pre-check (orchestrator workers)
   * 3. Normal policy chain (built-in policies)
   * 4. Approval flow (if deny + needsApproval)
   * 5. Approval→rule creation (if user wants to remember)
   */
  async check(context: PolicyContext): Promise<PolicyCheckResult> {
    // Lazy-load user rules on first check
    if (!this._userRulesEngine.isLoaded) {
      await this._userRulesEngine.load(context.userId);
    }

    // ===== 1. USER RULES PRE-CHECK (supreme authority) =====
    const userResult = this._userRulesEngine.evaluate(context);
    if (userResult) {
      if (userResult.action === 'allow') {
        const policyDecision: PolicyDecision = {
          verdict: 'allow', reason: userResult.reason, policyName: `user-rule:${userResult.rule.id}`,
        };
        await this.audit(context, 'allow', 'executed', policyDecision);
        return { allowed: true, blocked: false, reason: userResult.reason, policyName: policyDecision.policyName };
      }
      if (userResult.action === 'deny') {
        const policyDecision: PolicyDecision = {
          verdict: 'deny', reason: userResult.reason, policyName: `user-rule:${userResult.rule.id}`,
        };
        await this.audit(context, 'deny', 'blocked', policyDecision);
        return { allowed: false, blocked: true, reason: userResult.reason, policyName: policyDecision.policyName };
      }
      if (userResult.action === 'ask') {
        // User rule says "ask" — go directly to approval flow with this context
        return this.handleApprovalFlow(context, {
          verdict: 'deny',
          reason: userResult.reason,
          policyName: `user-rule:${userResult.rule.id}`,
          metadata: { needsApproval: true, approvalKey: context.toolName, approvalScope: 'once' },
        });
      }
    }

    // ===== 2. PARENT DELEGATION PRE-CHECK =====
    if (this.parentEvaluator) {
      const parentResult = await this.parentEvaluator.evaluateChainOnly(context);
      if (parentResult.verdict === 'deny') {
        const result: PolicyCheckResult = {
          allowed: false,
          blocked: true,
          reason: `Parent policy: ${parentResult.reason}`,
          policyName: parentResult.policyName,
        };
        await this.audit(context, 'deny', 'blocked', parentResult);
        return result;
      }
    }

    // ===== 3. NORMAL POLICY CHAIN =====
    const decision = await this.chain.evaluate(context);

    // 3. Handle decision
    if (decision.verdict === 'allow') {
      const result: PolicyCheckResult = {
        allowed: true,
        blocked: false,
        reason: decision.reason,
        policyName: decision.policyName,
      };
      await this.audit(context, 'allow', 'executed', decision);
      return result;
    }

    // Deny — check if approval is possible
    const needsApproval = decision.metadata?.needsApproval === true;

    if (!needsApproval) {
      // Hard deny — no approval possible
      const result: PolicyCheckResult = {
        allowed: false,
        blocked: true,
        reason: decision.reason,
        policyName: decision.policyName,
      };
      await this.audit(context, 'deny', 'blocked', decision);
      return result;
    }

    // 4. Approval flow (shared with user rules 'ask' action)
    return this.handleApprovalFlow(context, decision);
  }

  /**
   * Handle the approval flow — called when a deny decision has needsApproval.
   * Also handles approval→rule creation when user wants to remember their decision.
   */
  private async handleApprovalFlow(
    context: PolicyContext,
    decision: PolicyDecision,
  ): Promise<PolicyCheckResult> {
    const approvalKey = (decision.metadata?.approvalKey as string) ?? context.toolName;
    const approvalScope = (decision.metadata?.approvalScope as 'once' | 'session' | 'persistent') ?? 'once';

    if (!this.onApprovalRequired) {
      // No approval handler — DENY (never auto-approve)
      const result: PolicyCheckResult = {
        allowed: false,
        blocked: true,
        reason: 'Approval required but no approval handler configured',
        policyName: decision.policyName,
        approvalRequired: true,
        approvalKey,
        approvalScope,
      };
      await this.audit(context, 'deny', 'blocked', decision);
      return result;
    }

    // Build approval request context
    const toolConfig = context.toolPermissionConfig;
    const approvalContext: ApprovalRequestContext = {
      ...context,
      decision,
      riskLevel: toolConfig?.riskLevel ?? DEFAULT_PERMISSION_CONFIG.riskLevel,
      approvalMessage: toolConfig?.approvalMessage,
      sensitiveArgs: toolConfig?.sensitiveArgs,
      approvalKey,
      approvalScope,
    };

    try {
      const approvalDecision = await this.onApprovalRequired(approvalContext);

      if (approvalDecision.approved) {
        // Cache approval in session
        const effectiveScope = approvalDecision.scope ?? approvalScope;
        this.approve(approvalKey, {
          scope: effectiveScope as PermissionScope,
          approvedBy: approvalDecision.approvedBy,
          ttlMs: toolConfig?.sessionTTLMs,
        });

        // Create persistent user rule if requested
        if (approvalDecision.createRule || (approvalDecision.remember && effectiveScope === 'always')) {
          await this.createRuleFromApproval(context, approvalDecision, 'allow');
        }

        const result: PolicyCheckResult = {
          allowed: true,
          blocked: false,
          reason: 'Approved by user',
          policyName: decision.policyName,
          approvalRequired: true,
          approvalKey,
          approvalScope,
        };
        await this.audit(context, 'deny', 'approval_granted', decision);
        return result;
      }

      // Approval denied — optionally create a persistent deny rule
      if (approvalDecision.createRule || (approvalDecision.remember && approvalDecision.scope === 'never')) {
        await this.createRuleFromApproval(context, approvalDecision, 'deny');
      }

      const result: PolicyCheckResult = {
        allowed: false,
        blocked: true,
        reason: approvalDecision.reason ?? 'User denied approval',
        policyName: decision.policyName,
        approvalRequired: true,
        approvalKey,
        approvalScope,
      };
      await this.audit(context, 'deny', 'approval_denied', decision);
      return result;
    } catch (error) {
      // Approval handler error — default to deny
      const result: PolicyCheckResult = {
        allowed: false,
        blocked: true,
        reason: `Approval handler error: ${(error as Error).message}`,
        policyName: decision.policyName,
        approvalRequired: true,
      };
      await this.audit(context, 'deny', 'blocked', decision);
      return result;
    }
  }

  /**
   * Create a persistent user permission rule from an approval decision.
   */
  private async createRuleFromApproval(
    context: PolicyContext,
    decision: ApprovalDecision,
    action: 'allow' | 'deny',
  ): Promise<void> {
    const now = new Date().toISOString();
    const rule: UserPermissionRule = {
      id: crypto.randomUUID(),
      toolName: context.toolName,
      action,
      conditions: decision.createRule?.conditions,
      unconditional: decision.createRule?.unconditional,
      enabled: true,
      description: decision.createRule?.description ?? `${action === 'allow' ? 'Approved' : 'Denied'} via dialog`,
      createdBy: 'approval_dialog',
      createdAt: now,
      updatedAt: now,
      expiresAt: decision.createRule?.expiresAt,
    };

    await this._userRulesEngine.addRule(rule, context.userId);
  }

  /**
   * Evaluate chain only (no approval flow, no audit).
   * Used by parent evaluator during delegation.
   */
  private async evaluateChainOnly(context: PolicyContext): Promise<PolicyDecision> {
    return this.chain.evaluate(context);
  }

  // ==========================================================================
  // Approval Cache
  // ==========================================================================

  /**
   * Record an approval in the session cache.
   */
  approve(approvalKey: string, options?: {
    scope?: PermissionScope;
    approvedBy?: string;
    ttlMs?: number;
  }): void {
    if (this._sessionApprovalPolicy) {
      this._sessionApprovalPolicy.approve(approvalKey, {
        scope: options?.scope ?? 'session',
        approvedBy: options?.approvedBy,
        ttlMs: options?.ttlMs,
      });
    }
  }

  /**
   * Revoke an approval from the session cache.
   */
  revoke(approvalKey: string): void {
    this._sessionApprovalPolicy?.revoke(approvalKey);
  }

  /**
   * Check if an approval key is cached.
   */
  isApproved(approvalKey: string): boolean {
    return this._sessionApprovalPolicy?.isApproved(approvalKey) ?? false;
  }

  /**
   * Clear all session approvals.
   */
  clearSession(): void {
    this._sessionApprovalPolicy?.clearSession();
    this.emit('session:cleared', {});
  }

  // ==========================================================================
  // Allowlist / Blocklist Shortcuts
  // ==========================================================================

  allowlistAdd(toolName: string): void {
    this._allowlistPolicy?.add(toolName);
    // Also remove from blocklist
    this._blocklistPolicy?.remove(toolName);
  }

  allowlistRemove(toolName: string): void {
    this._allowlistPolicy?.remove(toolName);
  }

  blocklistAdd(toolName: string): void {
    this._blocklistPolicy?.add(toolName);
    // Also remove from allowlist
    this._allowlistPolicy?.remove(toolName);
  }

  blocklistRemove(toolName: string): void {
    this._blocklistPolicy?.remove(toolName);
  }

  // ==========================================================================
  // Audit
  // ==========================================================================

  /**
   * Centralized audit with redaction.
   */
  private async audit(
    context: PolicyContext,
    decision: 'allow' | 'deny',
    finalOutcome: 'executed' | 'blocked' | 'approval_granted' | 'approval_denied',
    policyDecision: PolicyDecision,
  ): Promise<void> {
    const entry: PermissionAuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      toolName: context.toolName,
      decision,
      finalOutcome,
      reason: policyDecision.reason,
      policyName: policyDecision.policyName,
      userId: context.userId,
      agentId: context.agentId,
      args: this.redactArgs(context),
      executionId: context.executionId,
      approvalRequired: policyDecision.metadata?.needsApproval === true,
      approvalKey: policyDecision.metadata?.approvalKey as string | undefined,
      metadata: policyDecision.metadata,
    };

    // Emit events
    const eventName = finalOutcome === 'executed' ? 'permission:allow'
      : finalOutcome === 'approval_granted' ? 'permission:approval_granted'
      : finalOutcome === 'approval_denied' ? 'permission:approval_denied'
      : 'permission:deny';

    this.emit(eventName, entry);
    this.emit('permission:audit', entry);
  }

  /**
   * Centralized argument redaction.
   *
   * Sources:
   * 1. Tool permission config sensitiveArgs
   * 2. Built-in sensitive key names (token, password, secret, etc.)
   * 3. Truncation for large values
   */
  private redactArgs(context: PolicyContext): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    const sensitiveFromConfig = new Set(context.toolPermissionConfig?.sensitiveArgs ?? []);

    for (const [key, value] of Object.entries(context.args)) {
      const keyLower = key.toLowerCase();

      if (sensitiveFromConfig.has(key) || SENSITIVE_KEYS.has(keyLower)) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > MAX_ARG_VALUE_LENGTH) {
        redacted[key] = value.slice(0, MAX_ARG_VALUE_LENGTH) + '...[truncated]';
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Serialize approval state for session persistence.
   */
  getState(): SerializedPolicyState {
    const approvals: Record<string, SerializedApprovalEntry> = {};

    if (this._sessionApprovalPolicy) {
      for (const [key, entry] of this._sessionApprovalPolicy.getApprovals()) {
        approvals[key] = {
          toolName: entry.toolName,
          scope: entry.scope,
          approvedAt: entry.approvedAt.toISOString(),
          approvedBy: entry.approvedBy,
          expiresAt: entry.expiresAt?.toISOString(),
          argsHash: entry.argsHash,
        };
      }
    }

    return {
      version: POLICY_STATE_VERSION,
      approvals,
      blocklist: this._blocklistPolicy?.getAll() ?? [],
      allowlist: this._allowlistPolicy?.getAll() ?? [],
    };
  }

  /**
   * Load approval state from persistence.
   */
  loadState(state: SerializedPolicyState): void {
    if (state.version !== POLICY_STATE_VERSION) {
      return; // skip incompatible versions
    }

    // Restore approvals
    if (this._sessionApprovalPolicy) {
      for (const [key, entry] of Object.entries(state.approvals)) {
        const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : undefined;
        if (expiresAt && expiresAt < new Date()) continue; // skip expired

        this._sessionApprovalPolicy.approve(key, {
          scope: entry.scope,
          approvedBy: entry.approvedBy,
        });
      }
    }

    // Restore lists
    if (this._blocklistPolicy) {
      for (const name of state.blocklist) {
        this._blocklistPolicy.add(name);
      }
    }
    if (this._allowlistPolicy) {
      for (const name of state.allowlist) {
        this._allowlistPolicy.add(name);
      }
    }
  }

  // ==========================================================================
  // Backward Compatibility: Create from Legacy Config
  // ==========================================================================

  /**
   * Create a PermissionPolicyManager from legacy AgentPermissionsConfig.
   *
   * Translates:
   * - blocklist → BlocklistPolicy
   * - allowlist → AllowlistPolicy (merged with DEFAULT_ALLOWLIST)
   * - defaultScope → SessionApprovalPolicy
   * - onApprovalRequired → passed through
   */
  static fromLegacyConfig(config: AgentPermissionsConfig): PermissionPolicyManager {
    const policies: IPermissionPolicy[] = [];

    // Blocklist policy
    const blocklistPolicy = new BlocklistPolicy(config.blocklist ?? []);
    policies.push(blocklistPolicy);

    // Allowlist policy (merge with defaults)
    const allowSet = new Set([...DEFAULT_ALLOWLIST, ...(config.allowlist ?? [])]);
    const allowlistPolicy = new AllowlistPolicy(allowSet);
    policies.push(allowlistPolicy);

    // Session approval policy (uses tool self-declarations + default scope)
    const sessionApprovalPolicy = new SessionApprovalPolicy(
      config.defaultScope ?? DEFAULT_PERMISSION_CONFIG.scope,
    );
    policies.push(sessionApprovalPolicy);

    // Backward compatibility: if no approval handler is configured,
    // default chain verdict is 'allow' to preserve the pre-policy-system
    // behavior where all tools auto-execute. The new strict 'deny' default
    // applies only when policies are explicitly configured via AgentPolicyConfig.
    const chainConfig: PolicyChainConfig = {
      defaultVerdict: config.onApprovalRequired ? 'deny' : 'allow',
    };

    return new PermissionPolicyManager({
      policies,
      chain: chainConfig,
      onApprovalRequired: config.onApprovalRequired,
    });
  }

  /**
   * Create from the new AgentPolicyConfig (extends legacy config).
   */
  static fromConfig(config: AgentPolicyConfig): PermissionPolicyManager {
    // Start with legacy translation
    const manager = PermissionPolicyManager.fromLegacyConfig(config);

    // Add explicit policies
    if (config.policies) {
      for (const policy of config.policies) {
        manager.addPolicy(policy);
      }
    }

    // Apply per-tool configs (override tool self-declarations at check time)
    // These are applied via the SessionApprovalPolicy reading toolPermissionConfig

    // Set user rules storage
    if (config.userRulesStorage) {
      manager._userRulesEngine.setStorage(config.userRulesStorage);
    }

    return manager;
  }

  // ==========================================================================
  // User Rules Engine Access
  // ==========================================================================

  /**
   * Access the user permission rules engine for CRUD operations.
   * Rules are per-user, persistent, and have the highest evaluation priority.
   */
  get userRules(): UserPermissionRulesEngine {
    return this._userRulesEngine;
  }

  // ==========================================================================
  // IDisposable
  // ==========================================================================

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    this.chain.clear();
    this._userRulesEngine.destroy();
    this.parentEvaluator = undefined;
    this.onApprovalRequired = undefined;
    this.removeAllListeners();
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Track references to built-in policies for direct manipulation.
   */
  private trackBuiltinPolicy(policy: IPermissionPolicy): void {
    if (policy instanceof AllowlistPolicy) {
      this._allowlistPolicy = policy;
    } else if (policy instanceof BlocklistPolicy) {
      this._blocklistPolicy = policy;
    } else if (policy instanceof SessionApprovalPolicy) {
      this._sessionApprovalPolicy = policy;
    }
  }
}
