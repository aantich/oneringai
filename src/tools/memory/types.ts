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
   * **Trusted** group id, set by the host app via plugin config. Tools
   * stamp this onto every `ScopeFilter` and NEVER accept a groupId from LLM
   * tool arguments — that would let a user claim arbitrary group membership
   * and read/write other groups' records. See the security review.
   */
  defaultGroupId?: string;
  /**
   * Entity ids bootstrapped by the plugin. Used by the resolver to look up
   * the `"me"` / `"this_agent"` tokens and by `memory_remember` to pick the
   * default visibility class.
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
 *
 * `userId` falls back to `defaultUserId` (plugin config), which in turn falls
 * back to undefined. `groupId` comes EXCLUSIVELY from `defaultGroupId` (plugin
 * config, trusted) — tools do NOT accept a groupId argument from the LLM. See
 * the security review for why: LLM-provided scope would let a user escalate
 * into arbitrary groups.
 */
export function resolveScope(
  contextUserId: string | undefined,
  defaultUserId: string | undefined,
  defaultGroupId?: string,
): ScopeFilter {
  return {
    userId: contextUserId ?? defaultUserId,
    groupId: defaultGroupId,
  };
}

/**
 * Clamp a caller-supplied numeric limit to a safe range. Tool args are
 * LLM-controllable; unbounded values can DoS the adapter (native $graphLookup
 * with `maxDepth: 1000`, semanticSearch with `topK: 100_000`, etc.).
 *
 * - Negative or `NaN` values fall back to `defaultVal`.
 * - Values above `max` are clamped to `max`.
 */
export function clamp(
  value: number | undefined,
  defaultVal: number,
  max: number,
): number {
  const v = typeof value === 'number' && !Number.isNaN(value) ? value : defaultVal;
  if (v < 0) return defaultVal;
  return Math.min(v, max);
}

/**
 * Clamp to the unit interval [0, 1]. Used for confidence/importance inputs
 * from the LLM — the memory layer stores values verbatim, so an unbounded
 * `importance: 1e9` would permanently dominate ranking until archived.
 *
 * Returns `undefined` for non-numeric / NaN inputs so callers can preserve
 * "not provided" semantics (memory layer falls back to defaults).
 */
export function clampUnit(v: number | undefined): number | undefined {
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

/**
 * Safely extract a message from an unknown thrown value. Adapters can throw
 * non-Error values (strings, plain objects) and `(err as Error).message` then
 * stringifies to `"undefined"`.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Re-export for convenience at the tool layer.
export type { EntityId, IEntity, IFact, MemorySystem, ScopeFilter };
