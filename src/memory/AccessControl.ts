/**
 * AccessControl — three-principal permission model for entities and facts.
 *
 * Three principals per record:
 *   1. **Owner**   — caller whose userId equals `record.ownerId`. Always has full
 *                    access, unconditionally.
 *   2. **Group**   — caller whose groupId equals `record.groupId` (and is not the
 *                    owner). Access governed by `record.permissions.group`.
 *   3. **World**   — every other caller, OR everyone when `record.groupId` is
 *                    absent. Access governed by `record.permissions.world`.
 *
 * AccessLevel is a hierarchy: `'write'` implies `'read'`. This rules out the
 * nonsensical write-but-not-read combination and makes the API compact.
 *
 * INVARIANT: every record MUST carry an `ownerId`. Library call sites that
 * create records without one are rejected with `OwnerRequiredError`. This keeps
 * the owner shortcut well-defined and makes admin delegation explicit (a
 * caller creates a record "on behalf of" another user by setting `ownerId`
 * to that user's id).
 *
 * Defaults (when `permissions` is omitted):
 *   - `group` = `'read'` (meaningful only when `groupId` is set; silently
 *     ignored when the record is groupless).
 *   - `world` = `'read'`.
 *
 * Meaning: records are **public-read by default**, like UNIX `644`. Callers
 * who need privacy set `permissions.world = 'none'` (to scope to the group) or
 * `permissions.group = 'none'` + `permissions.world = 'none'` (fully private).
 *
 * No dependencies on storage adapters — this module is the sole source of truth
 * for access semantics and is called into by MemorySystem (write path) and
 * every adapter (read path filter translation).
 */

import type { ScopeFilter } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Access level granted to a non-owner principal. Hierarchy: `'write'` implies
 * `'read'`. The owner (record.ownerId === caller.userId) always has full
 * access regardless of these fields.
 */
export type AccessLevel = 'none' | 'read' | 'write';

/**
 * A specific permission being requested. `'write'` subsumes `'read'` — a
 * write-granted caller can always read too.
 */
export type Permission = 'read' | 'write';

/**
 * Permissions block attached to entities and facts. Both fields optional;
 * unset fields fall back to library defaults.
 */
export interface Permissions {
  /**
   * What members of `record.groupId` (other than the owner) can do. Meaningful
   * only when `record.groupId` is set. Default `'read'`.
   */
  group?: AccessLevel;
  /**
   * What everyone outside `record.groupId` can do — or everyone, when the
   * record has no `groupId`. Default `'read'`.
   */
  world?: AccessLevel;
}

/**
 * Minimal record shape for access control. Any persisted entity or fact
 * satisfies this (both extend ScopeFields and optionally carry permissions).
 */
export interface AccessControlled {
  id?: string;
  ownerId?: string;
  groupId?: string;
  permissions?: Permissions;
}

// ---------------------------------------------------------------------------
// VisibilityPolicy — host-supplied default permissions per write
// ---------------------------------------------------------------------------

/**
 * Context the policy sees when asked for defaults on a write. Fields are set
 * according to `kind`:
 *   - kind === 'entity' ⇒ `entityType` set, `predicate` / `factKind` absent.
 *   - kind === 'fact'   ⇒ `predicate` set (post-canonicalization), `factKind`
 *                          set, `entityType` absent.
 */
export interface VisibilityContext {
  kind: 'entity' | 'fact';
  entityType?: string;
  predicate?: string;
  factKind?: 'atomic' | 'document';
}

/**
 * Host-supplied function that returns default `Permissions` for a write when
 * the caller didn't specify `permissions` explicitly. Lets hosts encode
 * policies like "entities are group-readable, facts are owner-private by
 * default" without touching every call site.
 *
 * Rules:
 *   - Caller-supplied `permissions` on the write input always wins — this
 *     policy only fills the blanks.
 *   - Return `undefined` to fall through to the library defaults
 *     (`DEFAULT_GROUP_LEVEL` / `DEFAULT_WORLD_LEVEL` — both `'read'`).
 *   - The policy is invoked synchronously on every entity/fact create path
 *     inside `MemorySystem`; keep it cheap (pure lookup, no I/O).
 */
export type VisibilityPolicy = (ctx: VisibilityContext) => Permissions | undefined;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by MemorySystem when a caller attempts a mutation against a record
 * whose effective permissions deny write access. Reads that are denied return
 * empty results rather than throwing (storage filters them out).
 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly recordId: string,
    public readonly recordKind: 'entity' | 'fact',
    public readonly operation: Permission,
  ) {
    super(
      `Permission denied: caller cannot ${operation} ${recordKind} ${recordId}`,
    );
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Thrown when a record would be created without an `ownerId` AND the calling
 * scope carries no `userId` either. Every record must have an owner — either
 * set explicitly by the caller (admin delegation) or inherited from
 * `scope.userId`.
 */
export class OwnerRequiredError extends Error {
  constructor(public readonly recordKind: 'entity' | 'fact') {
    super(
      `Cannot create ${recordKind} without an ownerId — provide ownerId explicitly or call with a scope that has userId set`,
    );
    this.name = 'OwnerRequiredError';
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default access level granted to group members when not specified. */
export const DEFAULT_GROUP_LEVEL: AccessLevel = 'read';

/** Default access level granted to world when not specified. */
export const DEFAULT_WORLD_LEVEL: AccessLevel = 'read';

// ---------------------------------------------------------------------------
// Pure evaluators
// ---------------------------------------------------------------------------

/**
 * Resolve a record's effective group+world levels after applying library
 * defaults. The `group` level is `'none'` when the record has no `groupId`
 * (no group principal exists).
 */
export function effectivePermissions(
  record: AccessControlled,
): { group: AccessLevel; world: AccessLevel } {
  const group: AccessLevel = record.groupId
    ? record.permissions?.group ?? DEFAULT_GROUP_LEVEL
    : 'none';
  const world: AccessLevel = record.permissions?.world ?? DEFAULT_WORLD_LEVEL;
  return { group, world };
}

/**
 * Returns true iff `caller` has the requested permission on `record`.
 *
 * Evaluation order:
 *   1. Owner match   → true (full access, unconditionally).
 *   2. Group match   → `levelGrants(permissions.group, need)`.
 *   3. Otherwise     → `levelGrants(permissions.world, need)`.
 */
export function canAccess(
  record: AccessControlled,
  caller: ScopeFilter,
  need: Permission,
): boolean {
  // Owner: full access.
  if (record.ownerId && caller.userId && record.ownerId === caller.userId) {
    return true;
  }
  const { group, world } = effectivePermissions(record);
  const groupMatch = !!record.groupId && record.groupId === caller.groupId;
  return levelGrants(groupMatch ? group : world, need);
}

/**
 * Throw `PermissionDeniedError` if `caller` lacks `need` on `record`.
 */
export function assertCanAccess(
  record: AccessControlled,
  caller: ScopeFilter,
  need: Permission,
  recordKind: 'entity' | 'fact',
): void {
  if (!canAccess(record, caller, need)) {
    throw new PermissionDeniedError(record.id ?? '<unknown>', recordKind, need);
  }
}

/**
 * Given an access level and a requested permission, does the level grant the
 * permission? `'write'` implies `'read'`.
 */
export function levelGrants(level: AccessLevel, need: Permission): boolean {
  if (level === 'write') return true;
  if (level === 'read') return need === 'read';
  return false;
}
