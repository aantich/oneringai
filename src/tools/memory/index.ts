/**
 * Memory tools — high-signal LLM tools for the self-learning memory layer.
 *
 * These tools need a live `MemorySystem` instance, so unlike most built-in
 * tools they're not singletons. Create them via `createMemoryTools({...})`
 * — typically the `MemoryPluginNextGen` does this for you.
 *
 * Tools:
 *   memory_recall       — profile + top-ranked facts for a subject
 *   memory_graph        — N-hop traversal (native $graphLookup on Mongo)
 *   memory_search       — semantic text search
 *   memory_find_entity  — lookup/list/upsert by id, identifier, surface, or type
 *   memory_list_facts   — paginated raw fact enumeration
 *   memory_remember     — write an atomic fact
 *   memory_link         — write a relational fact (entity ↔ entity)
 *   memory_forget       — archive a fact (optionally supersede with replacement)
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
}

/**
 * Factory: build all 8 memory tools wired to a shared resolver + deps.
 *
 * When called by `MemoryPluginNextGen` the `getOwnSubjectIds` callback hooks
 * the plugin's bootstrapped entity ids. Standalone callers can leave it
 * unset — `"me"` / `"this_agent"` tokens will then report "not available".
 */
export function createMemoryTools(args: CreateMemoryToolsArgs): ToolFunction[] {
  const getOwnSubjectIds = args.getOwnSubjectIds ?? (() => ({}));
  const resolve = createSubjectResolver({
    memory: args.memory,
    getOwnSubjectIds,
    autoResolveThreshold: args.autoResolveThreshold,
  });

  const deps: MemoryToolDeps = {
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
  };

  return [
    createRecallTool(deps),
    createGraphTool(deps),
    createSearchTool(deps),
    createFindEntityTool(deps),
    createListFactsTool(deps),
    createRememberTool(deps),
    createLinkTool(deps),
    createForgetTool(deps),
  ];
}
