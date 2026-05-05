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
  /**
   * Metadata merge mode when re-upserting an existing entity. Default
   * `'fillMissing'` only writes keys that are absent. Pass `'overwrite'` to
   * force-replace existing keys (required for partial updates like status
   * transitions that must land on the entity even when the field already
   * has a value).
   */
  metadataMerge?: 'fillMissing' | 'overwrite';
  /** Visibility. Default 'private'. */
  visibility?: Visibility;
}

const DESCRIPTION = `Create or merge an entity by identifier. If any supplied identifier matches an existing entity, the remaining identifiers are merged onto it (multi-ID enrichment).

Set {kind, value, exclusive:true} on canonical identifiers (email, phone) to mark them one-to-one — prevents the same identifier being attached to two entities.

\`type\` is an open string, but these conventional types carry recognized metadata that retrieval, profile generation, and downstream prompts know about. Prefer them when applicable:

  • person — strong identifiers: email / slack_user_id / phone / github.
    {"type":"person","displayName":"Alice Smith","identifiers":[{"kind":"email","value":"alice@a.com","exclusive":true},{"kind":"slack_user_id","value":"U07ABC"}]}
  • organization — domain / legal_name / ticker.
    {"type":"organization","displayName":"Acme","identifiers":[{"kind":"domain","value":"acme.com","exclusive":true}]}
  • task — actionable item. metadata: state ('pending'|'in_progress'|'blocked'|'deferred'|'done'|'cancelled'), dueAt, priority, assigneeId, projectId.
    {"type":"task","displayName":"Send budget","identifiers":[{"kind":"canonical","value":"task:<userId>:send-budget-2026-04-30"}],"metadata":{"state":"pending","dueAt":"2026-04-30T09:00:00Z","priority":"high"}}
  • event — time-bound occurrence. metadata: startTime, endTime, location, attendeeIds.
    {"type":"event","displayName":"Meeting with Sarah","identifiers":[{"kind":"canonical","value":"event:<userId>:meeting-sarah-2026-04-21"}],"metadata":{"startTime":"2026-04-21T15:00:00+02:00","endTime":"2026-04-21T16:00:00+02:00"}}
  • project — metadata: status, stakeholderIds.
  • topic — free-form topical anchor (themes, recurring subjects).
  • priority — see dedicated section below.

Use the \`canonical\` identifier kind for entities that lack a natural external strong key (tasks, events, priorities). Format: \`<type>:<userId>:<slug>\`.

PRIORITIES — long-term goals the user is tracking ("my Q2 priority is the NA launch", "my yearly goal is to ship X"). First-class entities; they bind tasks, signals, and ranking across the system. All priorities are user-private — do not ask the user about sharing or visibility. Two-step write — both steps are REQUIRED:

  1. Upsert the priority entity:
     {"type":"priority","displayName":"Ship NA launch","identifiers":[{"kind":"canonical","value":"priority:<userId>:ship-na-launch-2026-q2"}],"metadata":{"jarvis":{"priority":{"horizon":"Q","weight":0.8,"deadline":"2026-06-30T00:00:00Z","status":"active"}}}}
  2. Emit a \`tracks_priority\` fact (subject = the user's Person entity, object = the priority entity from step 1). Without this link the priority does not surface in the user's profile or in any ranking pass.

Fields: \`horizon\` 'Q' (quarterly) or 'Y' (yearly); \`weight\` 0..1 drives ordering (heavier = more central, default 0.5); \`status\` starts 'active'.

To transition status to 'met' or 'dropped', emit a \`state_changed\` fact on the priority entity: subject = priority entity, predicate = 'state_changed', value = {from, to}. The host routes this to the priority's metadata. Do NOT re-upsert the priority entity to change its status — the metadata merge is shallow and would corrupt the priority's other fields.

When the user ties a priority to specific work ("this priority is about the NA Launch project"), also emit \`priority_affects\` (subject = priority entity, object = the affected project / person / topic) — future ranking uses these links to answer "is this signal/task relevant to a current priority?".

Visibility (who can read the record) is decided by the host — do not try to set it.`;

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
            metadataMerge: {
              type: 'string',
              enum: ['fillMissing', 'overwrite'],
              description:
                "Merge mode for `metadata` when an existing entity is matched. Default 'fillMissing' (only writes absent keys). Pass 'overwrite' for partial updates that must replace existing values — e.g. status transitions on priority/task entities.",
            },
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

        // Explicit visibility (programmatic callers) → map to permissions and
        // pass through. Absent → pass `permissions: undefined` so the host's
        // `MemorySystem.visibilityPolicy` decides. LLMs no longer see
        // `visibility` in the tool schema, so absent is the common case.
        const permissions =
          args.visibility !== undefined
            ? visibilityToPermissions(args.visibility)
            : undefined;

        const result = await deps.memory.upsertEntity(
          {
            type: args.type,
            displayName: args.displayName,
            identifiers: args.identifiers,
            aliases: args.aliases,
            metadata: args.metadata,
            metadataMerge: args.metadataMerge,
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
