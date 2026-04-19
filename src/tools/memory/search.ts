/**
 * memory_search — semantic text search across visible facts. Uses
 * `memory.semanticSearch` which requires an embedder to be configured;
 * otherwise returns a clear error.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { FactFilter } from '../../memory/index.js';
import type { MemoryToolDeps } from './types.js';
import { resolveScope } from './types.js';

export interface SearchArgs {
  /** Natural-language query. Embedded and matched against fact embeddings. */
  query: string;
  /** Number of results. Default 10. */
  topK?: number;
  /** Optional fact filter — predicate, subjectId, observedAfter, etc. */
  filter?: {
    subjectId?: string;
    objectId?: string;
    predicate?: string;
    predicates?: string[];
    minConfidence?: number;
    observedAfter?: string;
    observedBefore?: string;
  };
  groupId?: string;
}

const DESCRIPTION = `Semantic text search across facts visible to you. Best when the user asks "find anything about X" and you don't know the entity or predicate upfront. Requires an embedder; will report "not available" otherwise.

Examples:
- {"query":"deployment incidents last quarter","topK":10}
- {"query":"Alice's preferences","filter":{"subjectId":"<alice-id>"}}
- {"query":"budget approvals","filter":{"predicate":"approved","observedAfter":"2025-01-01"}}

Returns ranked {fact, score} pairs; score is cosine similarity (0..1).`;

export function createSearchTool(deps: MemoryToolDeps): ToolFunction<SearchArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_search',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            topK: { type: 'number' },
            filter: { type: 'object' },
            groupId: { type: 'string' },
          },
          required: ['query'],
        },
      },
    },

    describeCall: (args) => args.query?.slice(0, 60) ?? 'search',

    execute: async (args, context) => {
      if (!args.query || typeof args.query !== 'string' || args.query.trim().length === 0) {
        return { error: 'query is required and must be a non-empty string' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);

      const filter: FactFilter = {};
      if (args.filter) {
        if (args.filter.subjectId) filter.subjectId = args.filter.subjectId;
        if (args.filter.objectId) filter.objectId = args.filter.objectId;
        if (args.filter.predicate) filter.predicate = args.filter.predicate;
        if (args.filter.predicates?.length) filter.predicates = args.filter.predicates;
        if (typeof args.filter.minConfidence === 'number') {
          filter.minConfidence = args.filter.minConfidence;
        }
        if (args.filter.observedAfter) {
          const d = new Date(args.filter.observedAfter);
          if (!isNaN(d.valueOf())) filter.observedAfter = d;
        }
        if (args.filter.observedBefore) {
          const d = new Date(args.filter.observedBefore);
          if (!isNaN(d.valueOf())) filter.observedBefore = d;
        }
      }

      try {
        const results = await deps.memory.semanticSearch(
          args.query,
          filter,
          scope,
          args.topK ?? 10,
        );
        return {
          query: args.query,
          results: results.map((r) => ({
            score: r.score,
            fact: {
              id: r.fact.id,
              subjectId: r.fact.subjectId,
              predicate: r.fact.predicate,
              kind: r.fact.kind,
              objectId: r.fact.objectId,
              value: r.fact.value,
              details: r.fact.details,
              confidence: r.fact.confidence,
              observedAt: r.fact.observedAt,
            },
          })),
        };
      } catch (err) {
        return { error: `memory_search unavailable: ${(err as Error).message}` };
      }
    },
  };
}
