/**
 * PolicyFactoryRegistry - Creates policy instances from stored definitions.
 *
 * All built-in policies register their factories here.
 * Custom policies register via `register()`.
 */

import type { IPermissionPolicy, IPermissionPolicyFactory, StoredPolicyDefinition } from './types.js';

// Import built-in factories
import { AllowlistPolicyFactory } from './policies/AllowlistPolicy.js';
import { BlocklistPolicyFactory } from './policies/BlocklistPolicy.js';
import { SessionApprovalPolicyFactory } from './policies/SessionApprovalPolicy.js';
import { PathRestrictionPolicyFactory } from './policies/PathRestrictionPolicy.js';
import { BashFilterPolicyFactory } from './policies/BashFilterPolicy.js';
import { UrlAllowlistPolicyFactory } from './policies/UrlAllowlistPolicy.js';
import { RolePolicyFactory } from './policies/RolePolicy.js';
import { RateLimitPolicyFactory } from './policies/RateLimitPolicy.js';

export class PolicyFactoryRegistry {
  private factories = new Map<string, IPermissionPolicyFactory>();

  constructor() {
    // Register built-in factories
    this.register(AllowlistPolicyFactory);
    this.register(BlocklistPolicyFactory);
    this.register(SessionApprovalPolicyFactory);
    this.register(PathRestrictionPolicyFactory);
    this.register(BashFilterPolicyFactory);
    this.register(UrlAllowlistPolicyFactory);
    this.register(RolePolicyFactory);
    this.register(RateLimitPolicyFactory);
  }

  /**
   * Register a policy factory.
   */
  register(factory: IPermissionPolicyFactory): void {
    this.factories.set(factory.type, factory);
  }

  /**
   * Create a policy from a stored definition.
   * Returns null if no factory is registered for the type.
   */
  create(definition: StoredPolicyDefinition): IPermissionPolicy | null {
    const factory = this.factories.get(definition.type);
    if (!factory) return null;
    return factory.create(definition);
  }

  /**
   * Check if a factory is registered for the given type.
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * Get all registered factory types.
   */
  types(): string[] {
    return Array.from(this.factories.keys());
  }
}
