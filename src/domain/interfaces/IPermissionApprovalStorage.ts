/**
 * IPermissionApprovalStorage - Storage interface for permission approval state.
 *
 * Persists the approval cache across sessions.
 * userId is optional (defaults to 'default').
 *
 * Implementations:
 * - FilePermissionApprovalStorage (reference, JSON)
 * - Custom: database, Redis, etc.
 */

import type { SerializedPolicyState } from '../../core/permissions/types.js';

export interface IPermissionApprovalStorage {
  /** Save approval state for a user. */
  save(userId: string | undefined, state: SerializedPolicyState): Promise<void>;

  /** Load approval state for a user. Returns null if none exist. */
  load(userId: string | undefined): Promise<SerializedPolicyState | null>;

  /** Delete approval state for a user. */
  delete(userId: string | undefined): Promise<void>;

  /** Check if approval state exists for a user. */
  exists(userId: string | undefined): Promise<boolean>;
}
