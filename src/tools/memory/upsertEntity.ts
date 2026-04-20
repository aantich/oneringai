/**
 * memory_upsert_entity — create or merge an entity by identifiers.
 *
 * Write-side counterpart of `memory_find_entity`. Split out so the read and
 * write memory plugins own non-overlapping tool sets.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { Identifier } from '../../memory/index.js';
import type { MemoryToolDeps, Visibility } from './types.js';
import { resolveScope, toErrorMessage, visibilityToPermissions } from './types.js';
import { shapeEntity } from './findEntity.js';

export interface UpsertEntityArgs {
  /** Entity type (required). */
  type: string;
  /** Display name (required). */
  displayName: string;
  /** Identifiers to attach. Must be non-empty. Existing entities merge extras. */
  identifiers: Identifier[];
  /** Alias names (display hints, not identifiers). */
  aliases?: string[];
  /** Free-form metadata. */
  metadata?: Record<string, unknown>;
  /** Visibility. Default 'private'. */
  visibility?: Visibility;
}

const DESCRIPTION = `Create or merge an entity by identifier. If any supplied identifier matches an existing entity, the remaining identifiers are merged onto it (multi-ID enrichment).

Set {kind, value, exclusive:true} on canonical identifiers (email, phone) to mark them one-to-one — prevents the same identifier being attached to two entities.

Example — upsert a person with multiple IDs (email flagged exclusive):
{"type":"person","displayName":"Alice Smith","identifiers":[{"kind":"email","value":"alice@a.com","exclusive":true},{"kind":"slack_user_id","value":"U07ABC"}]}

Visibility: "private" (default, owner-only), "group" (group can read), "public".`;

export function createUpsertEntityTool(
  deps: MemoryToolDeps,
): ToolFunction<UpsertEntityArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_upsert_entity',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            displayName: { type: 'string' },
            identifiers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  value: { type: 'string' },
                  isPrimary: { type: 'boolean' },
                  verified: { type: 'boolean' },
                },
                required: ['kind', 'value'],
              },
            },
            aliases: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' },
            visibility: { type: 'string', enum: ['private', 'group', 'public'] },
          },
          required: ['type', 'displayName', 'identifiers'],
        },
      },
    },

    describeCall: (args) => `upsert ${args.type}: ${args.displayName}`,

    execute: async (args, context) => {
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      try {
        if (!args.type) return { error: 'upsert: type is required' };
        if (!args.displayName) return { error: 'upsert: displayName is required' };
        if (!args.identifiers?.length) {
          return { error: 'upsert: identifiers must be non-empty' };
        }

        const permissions = visibilityToPermissions(args.visibility ?? 'private');

        const result = await deps.memory.upsertEntity(
          {
            type: args.type,
            displayName: args.displayName,
            identifiers: args.identifiers,
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
      } catch (err) {
        return { error: `memory_upsert_entity failed: ${toErrorMessage(err)}` };
      }
    },
  };
}
