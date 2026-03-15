/**
 * IPermissionPolicyStorage - Storage interface for permission policy definitions.
 *
 * Stores policy definitions per user. userId is optional (defaults to 'default').
 *
 * Implementations:
 * - FilePermissionPolicyStorage (reference, JSON)
 * - Custom: database, etc.
 */

import type { StoredPolicyDefinition } from '../../core/permissions/types.js';

export interface IPermissionPolicyStorage {
  /** Save policy definitions for a user. */
  save(userId: string | undefined, policies: StoredPolicyDefinition[]): Promise<void>;

  /** Load policy definitions for a user. Returns null if none exist. */
  load(userId: string | undefined): Promise<StoredPolicyDefinition[] | null>;

  /** Delete policy definitions for a user. */
  delete(userId: string | undefined): Promise<void>;

  /** Check if policy definitions exist for a user. */
  exists(userId: string | undefined): Promise<boolean>;
}
