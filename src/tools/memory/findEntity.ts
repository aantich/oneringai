/**
 * memory_find_entity — read-only lookup / listing of entities by id,
 * identifier, surface name, or type + metadata filter. Split from the
 * historical mixed-read/write tool; upsert now lives in `upsertEntity.ts`
 * so read and write plugins can own non-overlapping tool sets.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemorySystem, ScopeFilter } from '../../memory/index.js';
import type { MemoryToolDeps } from './types.js';
import { clamp, resolveScope, toErrorMessage } from './types.js';

export interface FindEntityArgs {
  /** 'find' returns one entity or candidates; 'list' returns a paginated list. */
  action?: 'find' | 'list';
  /** How to look up — one of id | identifier | surface | type+metadataFilter. */
  by?: {
    id?: string;
    identifier?: { kind: string; value: string };
    surface?: string;
    type?: string;
    metadataFilter?: Record<string, unknown>;
  };
  /** For list: page size. Default 20, max 200. */
  limit?: number;
}

const DESCRIPTION = `Look up or list entities. An entity can have many identifiers (email, slack_id, github_login, internal_id…); this tool finds the right one.

Actions:
- "find" (default): look up ONE entity. Use by.id OR by.identifier OR by.surface.
- "list": enumerate entities by by.type + optional by.metadataFilter.

Read-only — to create or merge entities use memory_upsert_entity (available only when the write plugin is enabled).

Examples:
- find by email: {"by":{"identifier":{"kind":"email","value":"alice@a.com"}}}
- find by surface: {"by":{"surface":"Alice from accounting"}}
- list active projects: {"action":"list","by":{"type":"project","metadataFilter":{"state":"active"}},"limit":20}`;

export function createFindEntityTool(
  deps: MemoryToolDeps,
): ToolFunction<FindEntityArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_find_entity',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['find', 'list'] },
            by: { type: 'object' },
            limit: { type: 'number' },
          },
        },
      },
    },

    describeCall: (args) => `${args.action ?? 'find'} entity`,

    execute: async (args, context) => {
      const action = args.action ?? 'find';
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      try {
        if (action === 'find') {
          return await doFind(deps.memory, deps.resolve, args, scope);
        }
        if (action === 'list') {
          return await doList(deps.memory, args, scope);
        }
        return { error: `unknown action '${action}' (read-only tool supports 'find' and 'list')` };
      } catch (err) {
        return { error: `memory_find_entity failed: ${toErrorMessage(err)}` };
      }
    },
  };
}

async function doFind(
  memory: MemorySystem,
  resolve: MemoryToolDeps['resolve'],
  args: FindEntityArgs,
  scope: ScopeFilter,
): Promise<unknown> {
  const by = args.by;
  if (!by) return { error: 'find: "by" is required (id, identifier, or surface)' };

  if (by.id) {
    const e = await memory.getEntity(by.id, scope);
    if (!e) return { error: `entity '${by.id}' not found or not visible` };
    return { entity: shapeEntity(e) };
  }
  if (by.identifier) {
    const res = await resolve({ identifier: by.identifier }, scope);
    if (res.ok) return { entity: shapeEntity(res.entity) };
    return { error: res.message, candidates: res.candidates };
  }
  if (by.surface) {
    const res = await resolve({ surface: by.surface }, scope);
    if (res.ok) return { entity: shapeEntity(res.entity) };
    return { error: res.message, candidates: res.candidates };
  }
  return { error: 'find: specify by.id, by.identifier, or by.surface' };
}

async function doList(
  memory: MemorySystem,
  args: FindEntityArgs,
  scope: ScopeFilter,
): Promise<unknown> {
  const by = args.by ?? {};
  const limit = clamp(args.limit, 20, 200);
  const page = await memory.listEntities(
    {
      type: by.type,
      metadataFilter: by.metadataFilter,
    },
    { limit },
    scope,
  );
  return {
    entities: page.items.map(shapeEntity),
    nextCursor: page.nextCursor,
  };
}

export function shapeEntity(e: import('../../memory/index.js').IEntity): Record<string, unknown> {
  return {
    id: e.id,
    type: e.type,
    displayName: e.displayName,
    aliases: e.aliases,
    identifiers: e.identifiers,
    metadata: e.metadata,
    ownerId: e.ownerId,
    groupId: e.groupId,
    permissions: e.permissions,
    archived: e.archived,
  };
}
