/**
 * IUserPermissionRulesStorage - Storage interface for per-user permission rules.
 *
 * userId is optional — defaults to 'default' in implementations.
 * Same Clean Architecture pattern as IUserInfoStorage, ICustomToolStorage, etc.
 *
 * Implementations:
 * - FileUserPermissionRulesStorage (reference, JSON)
 * - Custom: database, Redis, etc.
 */

import type { UserPermissionRule } from '../../core/permissions/types.js';

export interface IUserPermissionRulesStorage {
  /** Load all rules for a user. Returns null if no rules exist. */
  load(userId: string | undefined): Promise<UserPermissionRule[] | null>;

  /** Save all rules for a user (full replacement). */
  save(userId: string | undefined, rules: UserPermissionRule[]): Promise<void>;

  /** Delete all rules for a user. */
  delete(userId: string | undefined): Promise<void>;

  /** Check if rules exist for a user. */
  exists(userId: string | undefined): Promise<boolean>;

  /** Get storage path (for debugging/display). */
  getPath(userId: string | undefined): string;
}
