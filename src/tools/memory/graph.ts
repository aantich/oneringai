/**
 * memory_graph — N-hop traversal from a starting entity. Backend picks the
 * best implementation: Mongo uses native `$graphLookup` when enabled;
 * in-memory + other adapters fall back to iterative BFS via
 * `genericTraverse`. Plugin just calls `memory.traverse()`.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { TraversalOptions } from '../../memory/index.js';
import type { MemoryToolDeps, SubjectRef } from './types.js';
import { resolveScope } from './types.js';

export interface GraphArgs {
  /** Starting entity. See SubjectRef forms. */
  start: SubjectRef;
  /** 'out' = outgoing edges (subject→object), 'in' = incoming, 'both' = bidirectional. Default 'both'. */
  direction?: 'out' | 'in' | 'both';
  /** Hard hop limit (required). Keep small (1–3) to stay responsive. Default 2. */
  maxDepth?: number;
  /** Filter edges to these predicate names. Omit to include all. */
  predicates?: string[];
  /** Max total edges returned. Default 100. */
  limit?: number;
  /** Point-in-time traversal — only facts valid at this timestamp. */
  asOf?: string;
  /** Group scope. Optional. */
  groupId?: string;
}

const DESCRIPTION = `Walk the knowledge graph from a starting entity. Returns nodes + edges showing what it's connected to, via which predicates, up to maxDepth hops. Use when recall isn't enough — when you need the web of relationships between entities.

Backend automatically picks the best implementation (Mongo native $graphLookup when available, iterative BFS otherwise) — you don't need to think about it.

Examples:
- {"start":"me","direction":"out","maxDepth":2} — everyone/everything linked out from the user within 2 hops
- {"start":{"surface":"Q3 planning"},"predicates":["attended"],"maxDepth":1} — who attended that meeting
- {"start":{"identifier":{"kind":"jira_id","value":"PROJ-42"}},"direction":"both","maxDepth":3} — full neighborhood of a ticket
- {"start":"ent_abc","predicates":["works_at","reports_to"],"maxDepth":2} — work-graph only

Defaults: direction='both', maxDepth=2, limit=100. Reduce maxDepth if the response is too large.`;

export function createGraphTool(deps: MemoryToolDeps): ToolFunction<GraphArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_graph',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            start: { description: 'Starting entity — see SubjectRef forms.' },
            direction: { type: 'string', enum: ['out', 'in', 'both'] },
            maxDepth: { type: 'number' },
            predicates: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number' },
            asOf: { type: 'string' },
            groupId: { type: 'string' },
          },
          required: ['start'],
        },
      },
    },

    describeCall: (args) =>
      `graph from ${typeof args.start === 'string' ? args.start : JSON.stringify(args.start)}`,

    execute: async (args, context) => {
      if (!args.start) return { error: 'start is required' };
      const scope = resolveScope(context?.userId, deps.defaultUserId, args.groupId);
      const resolved = await deps.resolve(args.start, scope);
      if (!resolved.ok) {
        return { error: resolved.message, candidates: resolved.candidates };
      }

      const opts: TraversalOptions = {
        direction: args.direction ?? 'both',
        maxDepth: args.maxDepth ?? 2,
      };
      if (args.predicates?.length) opts.predicates = args.predicates;
      if (args.limit !== undefined) opts.limit = args.limit ?? 100;
      else opts.limit = 100;
      if (args.asOf) {
        const d = new Date(args.asOf);
        if (!isNaN(d.valueOf())) opts.asOf = d;
      }

      try {
        const neighborhood = await deps.memory.traverse(resolved.entity.id, opts, scope);
        return {
          start: { id: resolved.entity.id, displayName: resolved.entity.displayName },
          nodes: neighborhood.nodes.map((n) => ({
            id: n.entity.id,
            type: n.entity.type,
            displayName: n.entity.displayName,
            depth: n.depth,
          })),
          edges: neighborhood.edges.map((e) => ({
            from: e.from,
            to: e.to,
            predicate: e.fact.predicate,
            factId: e.fact.id,
            depth: e.depth,
          })),
        };
      } catch (err) {
        return { error: `memory_graph failed: ${(err as Error).message}` };
      }
    },
  };
}
