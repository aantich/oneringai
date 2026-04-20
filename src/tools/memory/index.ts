/**
 * Memory tools — high-signal LLM tools for the self-learning memory layer.
 *
 * These tools need a live `MemorySystem` instance, so unlike most built-in
 * tools they're not singletons. The read/write split lets a host app give
 * an agent retrieval-only access while a separate pipeline (e.g.
 * `SessionIngestorPluginNextGen`) handles writes.
 *
 * Read tools (5):
 *   memory_recall       — profile + top-ranked facts for a subject
 *   memory_graph        — N-hop traversal (native $graphLookup on Mongo)
 *   memory_search       — semantic text search
 *   memory_find_entity  — lookup/list by id, identifier, surface, or type
 *   memory_list_facts   — paginated raw fact enumeration
 *
 * Write tools (5):
 *   memory_remember       — write an atomic fact
 *   memory_link           — write a relational fact (entity ↔ entity)
 *   memory_forget         — archive a fact (rate-limited)
 *   memory_restore        — un-archive a fact (undo for memory_forget)
 *   memory_upsert_entity  — create or merge an entity by identifiers
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemorySystem } from '../../memory/index.js';
import { createSubjectResolver } from './resolveSubject.js';
import type { MemoryToolDeps, Visibility } from './types.js';
import { createRecallTool } from './recall.js';
import { createGraphTool } from './graph.js';
import { createSearchTool } from './search.js';
import { createFindEntityTool } from './findEntity.js';
import { createListFactsTool } from './listFacts.js';
import { createRememberTool } from './remember.js';
import { createLinkTool } from './link.js';
import { createForgetTool } from './forget.js';
import { createRestoreTool } from './restore.js';
import { createUpsertEntityTool } from './upsertEntity.js';

export type {
  MemoryToolDeps,
  SubjectRef,
  Visibility,
  ResolveResult,
  MemoryToolError,
} from './types.js';
export {
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  visibilityToPermissions,
  resolveScope,
  clamp,
  clampUnit,
  toErrorMessage,
} from './types.js';
export { createSubjectResolver } from './resolveSubject.js';
export { createRecallTool } from './recall.js';
export { createGraphTool } from './graph.js';
export { createSearchTool } from './search.js';
export { createFindEntityTool } from './findEntity.js';
export { createListFactsTool } from './listFacts.js';
export { createRememberTool } from './remember.js';
export { createLinkTool } from './link.js';
export { createForgetTool } from './forget.js';
export { createRestoreTool } from './restore.js';
export { createUpsertEntityTool } from './upsertEntity.js';

export interface CreateMemoryToolsArgs {
  memory: MemorySystem;
  agentId: string;
  defaultUserId?: string;
  /**
   * **Trusted** group id from the host app. Closed into tool deps so every
   * memory call uses this groupId. Tools do NOT accept a groupId arg from the
   * LLM — see the security review. Leave undefined for non-grouped deployments.
   */
  defaultGroupId?: string;
  defaultVisibility?: {
    forUser?: Visibility;
    forAgent?: Visibility;
    forOther?: Visibility;
  };
  getOwnSubjectIds?: () => { userEntityId?: string; agentEntityId?: string };
  autoResolveThreshold?: number;
  /**
   * Override the `memory_forget` rate limit. Default: 10 calls / 60s per user.
   * Use `{ maxCallsPerWindow: 0 }` to disable (not recommended for production).
   */
  forgetRateLimit?: { maxCallsPerWindow?: number; windowMs?: number };
}

function buildDeps(args: CreateMemoryToolsArgs): MemoryToolDeps {
  const getOwnSubjectIds = args.getOwnSubjectIds ?? (() => ({}));
  const resolve = createSubjectResolver({
    memory: args.memory,
    getOwnSubjectIds,
    autoResolveThreshold: args.autoResolveThreshold,
  });
  return {
    memory: args.memory,
    resolve,
    agentId: args.agentId,
    defaultUserId: args.defaultUserId,
    defaultGroupId: args.defaultGroupId,
    getOwnSubjectIds,
    defaultVisibility: {
      forUser: args.defaultVisibility?.forUser ?? 'private',
      forAgent: args.defaultVisibility?.forAgent ?? 'group',
      forOther: args.defaultVisibility?.forOther ?? 'private',
    },
    forgetRateLimit: args.forgetRateLimit,
  };
}

/** Read-only retrieval tools — no memory writes performed. */
export function createMemoryReadTools(args: CreateMemoryToolsArgs): ToolFunction[] {
  const deps = buildDeps(args);
  return [
    createRecallTool(deps),
    createGraphTool(deps),
    createSearchTool(deps),
    createFindEntityTool(deps),
    createListFactsTool(deps),
  ];
}

/** Write-side memory tools — mutate entities and facts. */
export function createMemoryWriteTools(args: CreateMemoryToolsArgs): ToolFunction[] {
  const deps = buildDeps(args);
  return [
    createRememberTool(deps),
    createLinkTool(deps),
    createForgetTool(deps),
    createRestoreTool(deps),
    createUpsertEntityTool(deps),
  ];
}

/**
 * All 10 memory tools (5 read + 5 write). Convenience factory — most callers
 * should prefer `createMemoryReadTools` / `createMemoryWriteTools` separately
 * so read agents don't carry the write-tool schema overhead.
 */
export function createMemoryTools(args: CreateMemoryToolsArgs): ToolFunction[] {
  return [...createMemoryReadTools(args), ...createMemoryWriteTools(args)];
}
