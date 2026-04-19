/**
 * memory_find_entity — look up, list, or upsert an entity by any of its
 * IDs, by surface name, or by type + metadata filter. An entity can have
 * MANY different identifiers (email, slack_id, github_login, internal_id…);
 * this is how you find the right one.
 *
 * Upsert auto-merges identifiers when you provide a new one on an existing
 * entity matched by another identifier.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { Identifier, MemorySystem, ScopeFilter } from '../../memory/index.js';
import type { MemoryToolDeps, Visibility } from './types.js';
import { resolveScope, visibilityToPermissions } from './types.js';

export interface FindEntityArgs {
  /**
   * Action: 'find' (default) returns one entity or candidates, 'list' returns
   * a paginated list for {type, metadataFilter}, 'upsert' creates-or-merges.
   */
  action?: 'find' | 'list' | 'upsert';
  /** How to look up — one of id | identifier | surface | type+metadataFilter. */
  by?: {
    id?: string;
    identifier?: { kind: string; value: string };
    surface?: string;
    type?: string;
    metadataFilter?: Record<string, unknown>;
  };
  /** For upsert: entity type (required for new entities). */
  type?: string;
  /** For upsert: display name (required for new entities). */
  displayName?: string;
  /** For upsert: identifiers to attach. Existing entities merge extras. */
  identifiers?: Identifier[];
  /** For upsert: alias names (display hints, not identifiers). */
  aliases?: string[];
  /** For upsert: free-form metadata. */
  metadata?: Record<string, unknown>;
  /** For upsert: visibility. See Visibility docstring. Default 'private'. */
  visibility?: Visibility;
  /** For list: page size. Default 20. */
  limit?: number;
  /** Group scope. Optional. */
  groupId?: string;
}

const DESCRIPTION = `Look up, list, or create an entity. An entity can have many different identifiers (email, slack_id, github_login, internal_id…); this tool is how you find the right one.

Actions:
- "find" (default): look up one entity by id, identifier, or surface. Surface lookups may return a candidates array on ambiguity.
- "list": enumerate entities by type + optional metadataFilter.
- "upsert": find-or-create; if any identifier matches an existing entity, adds the other identifiers to it (multi-ID enrichment).

Examples:
- find by email: {"by":{"identifier":{"kind":"email","value":"alice@a.com"}}}
- find same Alice by Slack: {"by":{"identifier":{"kind":"slack_user_id","value":"U07ABC"}}}
- find by surface: {"by":{"surface":"Alice from accounting"}}
- list active projects: {"action":"list","by":{"type":"project","metadataFilter":{"state":"active"}},"limit":20}
- upsert a person with multiple IDs (merges if any identifier already exists):
  {"action":"upsert","type":"person","displayName":"Alice Smith","identifiers":[{"kind":"email","value":"alice@a.com"},{"kind":"slack_user_id","value":"U07ABC"}]}

Visibility for upsert: "private" (default, owner-only), "group" (group can read), "public".`;

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
            action: { type: 'string', enum: ['find', 'list', 'upsert'] },
            by: { type: 'object' },
            type: { type: 'string' },
            displayName: { type: 'string' },
            identifiers: { type: 'array' },
            aliases: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' },
            visibility: { type: 'string', enum: ['private', 'group', 'public'] },
            limit: { type: 'number' },
            groupId: { type: 'string' },
          },
        },
      },
    },

    describeCall: (args) => `${args.action ?? 'find'} entity`,

    execute: async (args, context) => {
      const action = args.action ?? 'find';
      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);

      try {
        if (action === 'find') {
          return await doFind(deps.memory, deps.resolve, args, scope);
        }
        if (action === 'list') {
          return await doList(deps.memory, args, scope);
        }
        if (action === 'upsert') {
          return await doUpsert(deps.memory, args, scope);
        }
        return { error: `unknown action '${action}'` };
      } catch (err) {
        return { error: `memory_find_entity failed: ${(err as Error).message}` };
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
  const limit = args.limit ?? 20;
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

async function doUpsert(
  memory: MemorySystem,
  args: FindEntityArgs,
  scope: ScopeFilter,
): Promise<unknown> {
  if (!args.type) return { error: 'upsert: type is required' };
  if (!args.displayName) return { error: 'upsert: displayName is required' };
  if (!args.identifiers?.length && !args.by?.identifier) {
    return {
      error: 'upsert: provide at least one identifier (in "identifiers" or "by.identifier")',
    };
  }

  const identifiers: Identifier[] = args.identifiers?.length
    ? args.identifiers
    : [{ kind: args.by!.identifier!.kind, value: args.by!.identifier!.value }];

  const permissions = visibilityToPermissions(args.visibility ?? 'private');

  const result = await memory.upsertEntity(
    {
      type: args.type,
      displayName: args.displayName,
      identifiers,
      aliases: args.aliases,
      metadata: args.metadata,
      permissions,
    },
    scope,
  );

  return {
    entity: shapeEntity(result.entity),
    created: result.created,
    mergedIdentifiers: result.mergedIdentifiers,
    mergeCandidates: result.mergeCandidates,
  };
}

function shapeEntity(e: import('../../memory/index.js').IEntity): Record<string, unknown> {
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
