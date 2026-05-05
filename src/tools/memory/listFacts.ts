/**
 * memory_list_facts — enumerate raw facts. Filters by subject entity, by
 * source signal, or both. Paginated.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { FactFilter } from '../../memory/index.js';
import type { MemoryToolDeps, SubjectRef } from './types.js';
import { clamp, resolveScope, toErrorMessage } from './types.js';

export interface ListFactsArgs {
  /**
   * Subject entity. Required UNLESS `sourceSignalId` is given. See SubjectRef
   * forms.
   */
  subject?: SubjectRef;
  /**
   * Return only facts that were extracted from this source signal (the opaque
   * id of an email / calendar event / transcript / etc. as known to the
   * embedding application). May be combined with `subject` to AND the two.
   */
  sourceSignalId?: string;
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

const DESCRIPTION = `List raw facts. Filters by subject entity, by source signal, or both. Use when you want structured raw rows rather than the LLM-synthesized profile (counting, tabulating, exporting, or pulling everything extracted from one specific source).

REQUIRED: at least one of \`subject\` or \`sourceSignalId\`.

Modes:
- subject only — every fact about an entity (a person, deal, project, etc.)
- sourceSignalId only — every fact extracted from one source (an email, a meeting, a transcript). The embedding application owns signal ids; resolve a meeting URL / message id to a signal id with the v25 \`signal_facts\` resolver, or pass the id directly if you already have it.
- both — facts about that subject extracted from that one source (rare; useful for audit trails)

Examples:
- {"subject":"me","predicate":"prefers"} — all recorded user preferences
- {"subject":{"surface":"Acme deal"},"limit":50} — everything about the deal
- {"sourceSignalId":"7eM3MWMZjmCxF3rbk"} — every fact extracted from one specific signal (atomic AND document; pass kind:"any" to include narrative-style memos/notes)
- {"sourceSignalId":"7eM3MWMZjmCxF3rbk","kind":"any","predicates":["committed_to","decided","meeting_notes"]} — decisions and notes from one meeting
- {"subject":"me","archivedOnly":true} — audit view of historical facts about user

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
            subject: { description: 'Subject entity — see SubjectRef forms. Optional if sourceSignalId is given.' },
            sourceSignalId: {
              type: 'string',
              description: 'Opaque source signal id. Returns only facts extracted from this signal.',
            },
            predicate: { type: 'string' },
            predicates: { type: 'array', items: { type: 'string' } },
            archivedOnly: { type: 'boolean' },
            kind: { type: 'string', enum: ['atomic', 'document', 'any'] },
            limit: { type: 'number' },
            cursor: { type: 'string' },
          },
          // No `required` — must validate one-of in execute().
        },
      },
    },

    describeCall: (args) => {
      if (args.subject && args.sourceSignalId) {
        const subj = typeof args.subject === 'string' ? args.subject : JSON.stringify(args.subject);
        return `facts about ${subj} from signal ${args.sourceSignalId}`;
      }
      if (args.sourceSignalId) return `facts from signal ${args.sourceSignalId}`;
      if (args.subject) {
        return `facts about ${typeof args.subject === 'string' ? args.subject : JSON.stringify(args.subject)}`;
      }
      return 'facts (missing arguments)';
    },

    execute: async (args, context) => {
      if (!args.subject && !args.sourceSignalId) {
        return { error: 'must provide subject, sourceSignalId, or both' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      const filter: FactFilter = {};
      let resolvedSubject: { id: string; displayName?: string } | undefined;

      if (args.subject) {
        const resolved = await deps.resolve(args.subject, scope);
        if (!resolved.ok) {
          return { error: resolved.message, candidates: resolved.candidates };
        }
        filter.subjectId = resolved.entity.id;
        resolvedSubject = { id: resolved.entity.id, displayName: resolved.entity.displayName };
      }

      if (args.sourceSignalId) filter.sourceSignalId = args.sourceSignalId;
      if (args.predicate) filter.predicate = args.predicate;
      if (args.predicates?.length) filter.predicates = args.predicates;
      if (args.archivedOnly === true) {
        filter.archived = true;
      }
      if (args.kind === 'atomic' || args.kind === 'document') {
        filter.kind = args.kind;
      } else if (args.kind === 'any') {
        // leave undefined to match both
      } else if (!args.kind) {
        // Default depends on mode: subject-only stays atomic (existing behavior);
        // source-only defaults to 'any' since transcripts/memos are document-kind
        // and that's exactly the surprising omission we want to avoid.
        filter.kind = args.sourceSignalId && !args.subject ? undefined : 'atomic';
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
          ...(resolvedSubject ? { subject: resolvedSubject } : {}),
          ...(args.sourceSignalId ? { sourceSignalId: args.sourceSignalId } : {}),
          facts: page.items.map((f) => ({
            id: f.id,
            subjectId: f.subjectId,
            predicate: f.predicate,
            kind: f.kind,
            objectId: f.objectId,
            value: f.value,
            details: f.details,
            confidence: f.confidence,
            importance: f.importance,
            observedAt: f.observedAt,
            sourceSignalId: f.sourceSignalId,
            archived: f.archived,
          })),
          nextCursor: page.nextCursor,
        };
      } catch (err) {
        return { error: `memory_list_facts failed: ${toErrorMessage(err)}` };
      }
    },
  };
}
