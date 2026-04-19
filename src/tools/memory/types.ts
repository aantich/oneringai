/**
 * Shared types for memory tools.
 *
 * These tools are created via a factory (`createMemoryTools`) because they
 * need a live `MemorySystem` instance — they are not auto-registered singletons.
 * Typically the `MemoryPluginNextGen` wires them automatically; library users
 * can also call the factory directly and register the returned tools on any
 * agent that should talk to memory.
 */

import type {
  EntityId,
  IEntity,
  IFact,
  MemorySystem,
  Permissions,
  ScopeFilter,
} from '../../memory/index.js';

// ===========================================================================
// Subject reference — the flexible "which entity" shape used by every tool
// ===========================================================================

/**
 * A flexible reference to an entity. The memory system supports many
 * identifiers per entity; this type is the union of every reasonable way the
 * LLM might name one.
 *
 * - `string`: either a raw entity id (`"ent_abc123"`), or one of the special
 *   tokens `"me"` → current user, `"this_agent"` → the agent's own entity.
 * - `{id}`: explicit entity id.
 * - `{identifier: {kind, value}}`: any of the entity's stored identifiers
 *   (email, slack_id, github_login, internal_id, ...). Exact match.
 * - `{surface}`: free-form text the LLM uses to refer to the entity
 *   ("Alice from accounting"). Uses the fuzzy resolver; may return multiple
 *   candidates when ambiguous.
 */
export type SubjectRef =
  | string
  | { id: string }
  | { identifier: { kind: string; value: string } }
  | { surface: string };

/**
 * Special string tokens recognised by the resolver.
 */
export const SUBJECT_TOKEN_ME = 'me';
export const SUBJECT_TOKEN_THIS_AGENT = 'this_agent';

// ===========================================================================
// Visibility mapping — maps the LLM-friendly word to a Permissions block
// ===========================================================================

/**
 * LLM-friendly visibility label. Maps to a `Permissions` block at write time.
 * - `"private"` → owner-only (world:none, group:none).
 * - `"group"`   → group-readable, hidden from world (group:read, world:none).
 *                 If the record has no `groupId`, "group" degrades to
 *                 private at read time (group principal doesn't exist).
 * - `"public"`  → library defaults (group:read, world:read). Undefined
 *                 permissions.
 */
export type Visibility = 'private' | 'group' | 'public';

export function visibilityToPermissions(
  vis: Visibility | undefined,
): Permissions | undefined {
  switch (vis) {
    case 'private':
      return { group: 'none', world: 'none' };
    case 'group':
      return { group: 'read', world: 'none' };
    case 'public':
      return undefined; // library defaults
    default:
      return undefined;
  }
}

// ===========================================================================
// Dependency container + tool results
// ===========================================================================

/**
 * Dependencies every memory tool receives. Created once per plugin / agent
 * and closed over by the tool factories.
 */
export interface MemoryToolDeps {
  memory: MemorySystem;
  /** Resolve a SubjectRef to an entity using the caller's scope. */
  resolve: (subject: SubjectRef, scope: ScopeFilter) => Promise<ResolveResult>;
  /** Current agent id (used for "this_agent" resolution and logging). */
  agentId: string;
  /**
   * Explicit user id from plugin config — overrides `ToolContext.userId` only
   * if the context doesn't carry one. If both are unset, scope.userId stays
   * undefined and the tool handles it as "no user scope".
   */
  defaultUserId?: string;
  /**
   * Called after any write-through tool that targets the user or agent
   * subject. The plugin listens to this to invalidate its rendered-content
   * cache so the next `getContent()` call re-fetches.
   */
  onWriteToOwnSubjects?: () => void;
  /**
   * Entity ids bootstrapped by the plugin. Used to detect when a write
   * touches the user or agent subject, to fire `onWriteToOwnSubjects`.
   */
  getOwnSubjectIds: () => { userEntityId?: string; agentEntityId?: string };
  /**
   * Default visibility per subject class. Tools that take a `visibility`
   * argument fall back to this when the LLM omits it.
   */
  defaultVisibility: {
    forUser: Visibility;
    forAgent: Visibility;
    forOther: Visibility;
  };
}

/** Result of resolving a `SubjectRef` to zero, one, or many candidates. */
export type ResolveResult =
  | { ok: true; entity: IEntity }
  | {
      ok: false;
      reason: 'not_found' | 'ambiguous' | 'no_user_scope';
      candidates?: Array<{ id: EntityId; displayName: string; score?: number }>;
      message: string;
    };

/**
 * Shared error shape returned by tools when a subject can't be resolved.
 * Structured so the LLM can recover (by picking from candidates) instead of
 * giving up.
 */
export interface MemoryToolError {
  error: string;
  candidates?: Array<{ id: EntityId; displayName: string; score?: number }>;
}

/**
 * Helper to build a scope from the tool context + plugin defaults.
 * `userId` falls back to `defaultUserId`; `groupId` is not yet plumbed
 * through `ToolContext` — callers that need group-scoped access should
 * pass `groupId` as a tool argument explicitly.
 */
export function resolveScope(
  contextUserId: string | undefined,
  defaultUserId: string | undefined,
  groupId?: string,
): ScopeFilter {
  return {
    userId: contextUserId ?? defaultUserId,
    groupId,
  };
}

// Re-export for convenience at the tool layer.
export type { EntityId, IEntity, IFact, MemorySystem, ScopeFilter };
