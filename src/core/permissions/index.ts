/**
 * Permission System Exports
 */

// Core types
export * from './types.js';

// Legacy permission manager (deprecated — use PermissionPolicyManager)
export { ToolPermissionManager } from './ToolPermissionManager.js';

// New policy-based system
export { PolicyChain } from './PolicyChain.js';
export { PermissionPolicyManager } from './PermissionPolicyManager.js';
export type { PermissionPolicyManagerConfig, PolicyManagerEvents } from './PermissionPolicyManager.js';
export { PermissionEnforcementPlugin } from './PermissionEnforcementPlugin.js';
export type { ToolRegistrationInfo } from './PermissionEnforcementPlugin.js';
export { UserPermissionRulesEngine } from './UserPermissionRulesEngine.js';

// Built-in policies
export {
  AllowlistPolicy,
  BlocklistPolicy,
  SessionApprovalPolicy,
  PathRestrictionPolicy,
  BashFilterPolicy,
  UrlAllowlistPolicy,
  RolePolicy,
  RateLimitPolicy,
} from './policies/index.js';

export type {
  PathRestrictionConfig,
  BashFilterConfig,
  UrlAllowlistConfig,
  RoleRule,
  RateLimitConfig,
} from './policies/index.js';
