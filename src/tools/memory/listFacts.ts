/**
 * memory_list_facts — enumerate atomic facts about a subject. Use when you
 * want structured raw facts rather than the LLM-synthesized profile (e.g.,
 * to count, tabulate, or export). Paginated.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { FactFilter } from '../../memory/index.js';
import type { MemoryToolDeps, SubjectRef } from './types.js';
import { clamp, resolveScope } from './types.js';

export interface ListFactsArgs {
  /** Subject. See SubjectRef forms. */
  subject: SubjectRef;
  /** Filter to one predicate. */
  predicate?: string;
  /** Or multiple predicates (OR). */
  predicates?: string[];
  /**
   * When true, returns ONLY archived facts (history / audit view). Default
   * false returns only non-archived facts. For "both" you'd call twice and
   * merge — not supported in v1.
   */
  archivedOnly?: boolean;
  /** Atomic only, document only, or both. Default: 'atomic'. */
  kind?: 'atomic' | 'document' | 'any';
  /** Page size. Default 20, max 200. */
  limit?: number;
  /** Pagination cursor from a previous call. */
  cursor?: string;
}

const DESCRIPTION = `List facts about a subject. Use for enumeration when you want structured raw facts rather than the LLM-synthesized profile (e.g., to count, tabulate, export, or inspect individual entries).

Examples:
- {"subject":"me","predicate":"prefers"} — all recorded user preferences (live, non-archived)
- {"subject":{"surface":"Acme deal"},"limit":50} — everything about the deal
- {"subject":"ent_xyz","predicates":["attended","missed"]} — attendance-only
- {"subject":"me","archivedOnly":true} — audit view: only archived (historical) facts

Paginated: reuse "cursor" from the response to fetch the next page.`;

export function createListFactsTool(deps: MemoryToolDeps): ToolFunction<ListFactsArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_list_facts',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            subject: { description: 'Subject entity — see SubjectRef forms.' },
            predicate: { type: 'string' },
            predicates: { type: 'array', items: { type: 'string' } },
            archivedOnly: { type: 'boolean' },
            kind: { type: 'string', enum: ['atomic', 'document', 'any'] },
            limit: { type: 'number' },
            cursor: { type: 'string' },
          },
          required: ['subject'],
        },
      },
    },

    describeCall: (args) =>
      `facts about ${typeof args.subject === 'string' ? args.subject : JSON.stringify(args.subject)}`,

    execute: async (args, context) => {
      if (!args.subject) return { error: 'subject is required' };
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);
      const resolved = await deps.resolve(args.subject, scope);
      if (!resolved.ok) {
        return { error: resolved.message, candidates: resolved.candidates };
      }

      const filter: FactFilter = {
        subjectId: resolved.entity.id,
      };
      if (args.predicate) filter.predicate = args.predicate;
      if (args.predicates?.length) filter.predicates = args.predicates;
      if (args.archivedOnly === true) {
        // FactFilter.archived === true returns archived-only (audit view).
        // Default (archived undefined) returns only non-archived.
        filter.archived = true;
      }
      if (args.kind === 'atomic' || args.kind === 'document') {
        filter.kind = args.kind;
      } else if (!args.kind) {
        filter.kind = 'atomic';
      }

      try {
        const page = await deps.memory.findFacts(
          filter,
          {
            limit: clamp(args.limit, 20, 200),
            cursor: args.cursor,
            orderBy: { field: 'observedAt', direction: 'desc' },
          },
          scope,
        );
        return {
          subject: { id: resolved.entity.id, displayName: resolved.entity.displayName },
          facts: page.items.map((f) => ({
            id: f.id,
            predicate: f.predicate,
            kind: f.kind,
            objectId: f.objectId,
            value: f.value,
            details: f.details,
            confidence: f.confidence,
            importance: f.importance,
            observedAt: f.observedAt,
            archived: f.archived,
          })),
          nextCursor: page.nextCursor,
        };
      } catch (err) {
        return { error: `memory_list_facts failed: ${(err as Error).message}` };
      }
    },
  };
}
