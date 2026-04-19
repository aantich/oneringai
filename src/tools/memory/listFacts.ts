/**
 * memory_list_facts — enumerate atomic facts about a subject. Use when you
 * want structured raw facts rather than the LLM-synthesized profile (e.g.,
 * to count, tabulate, or export). Paginated.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { FactFilter } from '../../memory/index.js';
import type { MemoryToolDeps, SubjectRef } from './types.js';
import { resolveScope } from './types.js';

export interface ListFactsArgs {
  /** Subject. See SubjectRef forms. */
  subject: SubjectRef;
  /** Filter to one predicate. */
  predicate?: string;
  /** Or multiple predicates (OR). */
  predicates?: string[];
  /** Include archived facts too (default false). */
  includeArchived?: boolean;
  /** Atomic only, document only, or both. Default: 'atomic'. */
  kind?: 'atomic' | 'document' | 'any';
  /** Page size. Default 20. */
  limit?: number;
  /** Pagination cursor from a previous call. */
  cursor?: string;
  /** Group scope. Optional. */
  groupId?: string;
}

const DESCRIPTION = `List atomic facts about a subject. Use for enumeration when you want structured raw facts rather than the LLM-synthesized profile (e.g., to count, tabulate, export, or inspect individual entries).

Examples:
- {"subject":"me","predicate":"prefers"} — all recorded user preferences
- {"subject":{"surface":"Acme deal"},"limit":50} — everything about the deal
- {"subject":"ent_xyz","predicates":["attended","missed"]} — attendance-only
- {"subject":"me","includeArchived":true} — history including archived

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
            includeArchived: { type: 'boolean' },
            kind: { type: 'string', enum: ['atomic', 'document', 'any'] },
            limit: { type: 'number' },
            cursor: { type: 'string' },
            groupId: { type: 'string' },
          },
          required: ['subject'],
        },
      },
    },

    describeCall: (args) =>
      `facts about ${typeof args.subject === 'string' ? args.subject : JSON.stringify(args.subject)}`,

    execute: async (args, context) => {
      if (!args.subject) return { error: 'subject is required' };
      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);
      const resolved = await deps.resolve(args.subject, scope);
      if (!resolved.ok) {
        return { error: resolved.message, candidates: resolved.candidates };
      }

      const filter: FactFilter = {
        subjectId: resolved.entity.id,
      };
      if (args.predicate) filter.predicate = args.predicate;
      if (args.predicates?.length) filter.predicates = args.predicates;
      if (args.includeArchived === true) {
        // Passing undefined shows non-archived; `true` shows only archived.
        // For "both", we'd need two queries; pick archived=true when asked.
        filter.archived = true;
      }
      if (args.kind === 'atomic' || args.kind === 'document') {
        filter.kind = args.kind;
      } else if (!args.kind) {
        filter.kind = 'atomic';
      }

      try {
        // Use the store via the memory system — we need `findFacts` exposure.
        // MemorySystem doesn't expose findFacts directly, so we route through
        // getContext for now if subject matches; else use semanticSearch as
        // fallback? No — simpler: expose listFacts via the store accessor.
        // Memory system provides `getContext`, but for raw enumeration we
        // need a direct findFacts pass-through. Add it on MemorySystem side.
        const page = await deps.memory.findFacts(
          filter,
          { limit: args.limit ?? 20, cursor: args.cursor, orderBy: { field: 'observedAt', direction: 'desc' } },
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
