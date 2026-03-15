/**
 * IPermissionAuditStorage - Storage interface for permission audit trail.
 *
 * Implementations:
 * - FilePermissionAuditStorage (reference, append-only JSONL)
 * - Custom: database, cloud logging, etc.
 */

import type { PermissionAuditEntry } from '../../core/permissions/types.js';

export interface AuditQueryOptions {
  toolName?: string;
  userId?: string;
  agentId?: string;
  decision?: 'allow' | 'deny';
  finalOutcome?: string;
  since?: string; // ISO date
  limit?: number;
  offset?: number;
}

export interface IPermissionAuditStorage {
  /** Append an audit entry. */
  append(entry: PermissionAuditEntry): Promise<void>;

  /** Query audit entries with optional filtering. */
  query(options?: AuditQueryOptions): Promise<PermissionAuditEntry[]>;

  /** Clear entries older than the given date. */
  clear(before?: string): Promise<void>;

  /** Count entries matching the given criteria. */
  count(options?: AuditQueryOptions): Promise<number>;
}
