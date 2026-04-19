/**
 * memory_recall — retrieve profile + top-ranked facts + optional tiers for a
 * subject. This is the primary "what do I know about X?" tool.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ContextOptions } from '../../memory/index.js';
import type { MemoryToolDeps, SubjectRef } from './types.js';
import { clamp, resolveScope } from './types.js';

export interface RecallArgs {
  /** SubjectRef — "me", "this_agent", an entity id, {id}, {identifier}, or {surface}. */
  subject: SubjectRef;
  /**
   * Optional tiers to include beyond the default profile + topFacts.
   * Valid: 'documents' | 'semantic' | 'neighbors' | 'tasks' | 'events'.
   * 'tasks' and 'events' are on by default — pass minimal=true to suppress.
   */
  include?: Array<'documents' | 'semantic' | 'neighbors' | 'tasks' | 'events'>;
  /** Cap on top-ranked facts. Default 15, max 100. */
  topFactsLimit?: number;
  /** When true, skip the default related-tasks + related-events tiers (faster). */
  minimal?: boolean;
  /** For the 'semantic' tier: the search query used within the entity's facts. */
  semanticQuery?: string;
  /** For the 'neighbors' tier: how many hops to include. Default 1, max 5. */
  neighborDepth?: number;
}

const DESCRIPTION = `Retrieve what memory knows about an entity — LLM-synthesized profile, top-ranked facts, and optionally related tasks, events, semantic matches, or graph neighbors. Your primary way to pull context about any entity.

Subject can be: an entity id, "me" (current user), "this_agent" (this agent), {id}, {identifier:{kind,value}} (any of the entity's IDs — email, slack_id, github_login, etc.), or {surface:"free-form name"} for fuzzy resolution.

Examples:
- {"subject":"me"} → your user's profile + recent top facts
- {"subject":{"surface":"Acme deal"},"include":["neighbors"]} → deal profile + linked entities
- {"subject":{"identifier":{"kind":"github_login","value":"alice99"}}} → Alice's profile by GitHub handle
- {"subject":"this_agent","include":["documents"]} → agent profile + its stored docs
- {"subject":"ent_xyz","minimal":true} → fast profile-only lookup

On ambiguity ({surface} with no clear winner), returns a "candidates" array — pick one by id and retry.`;

export function createRecallTool(deps: MemoryToolDeps): ToolFunction<RecallArgs> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_recall',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            subject: { description: 'Entity reference — see description for forms.' },
            include: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['documents', 'semantic', 'neighbors', 'tasks', 'events'],
              },
            },
            topFactsLimit: { type: 'number' },
            minimal: { type: 'boolean' },
            semanticQuery: { type: 'string' },
            neighborDepth: { type: 'number' },
          },
          required: ['subject'],
        },
      },
    },

    describeCall: (args) =>
      typeof args.subject === 'string'
        ? args.subject
        : 'id' in args.subject
          ? args.subject.id
          : 'identifier' in args.subject
            ? `${args.subject.identifier.kind}=${args.subject.identifier.value}`
            : `surface='${args.subject.surface}'`,

    execute: async (args, context) => {
      if (args.subject === undefined || args.subject === null) {
        return { error: 'subject is required' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);
      const resolved = await deps.resolve(args.subject, scope);
      if (!resolved.ok) {
        return { error: resolved.message, candidates: resolved.candidates };
      }

      const opts: ContextOptions = {
        topFactsLimit: clamp(args.topFactsLimit, 15, 100),
        tiers: args.minimal ? 'minimal' : 'full',
      };
      // Filter caller-provided includes to the subset ContextOptions accepts.
      const allowedIncludes: Array<'documents' | 'semantic' | 'neighbors'> = [];
      if (args.include) {
        for (const t of args.include) {
          if (t === 'documents' || t === 'semantic' || t === 'neighbors') {
            allowedIncludes.push(t);
          }
          // 'tasks' and 'events' are default tiers; not included via include[].
        }
      }
      if (allowedIncludes.length > 0) opts.include = allowedIncludes;
      if (args.semanticQuery) opts.semanticQuery = args.semanticQuery;
      if (args.neighborDepth !== undefined) opts.neighborDepth = clamp(args.neighborDepth, 1, 5);

      try {
        const view = await deps.memory.getContext(resolved.entity.id, opts, scope);
        return {
          entity: {
            id: view.entity.id,
            type: view.entity.type,
            displayName: view.entity.displayName,
            aliases: view.entity.aliases,
            identifiers: view.entity.identifiers,
          },
          profile: view.profile
            ? { id: view.profile.id, details: view.profile.details, createdAt: view.profile.createdAt }
            : null,
          topFacts: view.topFacts.map(shapeFact),
          relatedTasks: view.relatedTasks?.map((t) => ({
            id: t.task.id,
            displayName: t.task.displayName,
            role: t.role,
            metadata: t.task.metadata,
          })),
          relatedEvents: view.relatedEvents?.map((e) => ({
            id: e.event.id,
            displayName: e.event.displayName,
            role: e.role,
            when: e.when,
            metadata: e.event.metadata,
          })),
          documents: view.documents?.map(shapeFact),
          semantic: view.semantic?.map((s) => ({ fact: shapeFact(s.fact), score: s.score })),
          neighbors: view.neighbors
            ? {
                nodes: view.neighbors.nodes.map((n) => ({
                  id: n.entity.id,
                  type: n.entity.type,
                  displayName: n.entity.displayName,
                  depth: n.depth,
                })),
                edges: view.neighbors.edges.map((e) => ({
                  from: e.from,
                  to: e.to,
                  predicate: e.fact.predicate,
                  factId: e.fact.id,
                  depth: e.depth,
                })),
              }
            : undefined,
        };
      } catch (err) {
        return { error: `memory_recall failed: ${(err as Error).message}` };
      }
    },
  };
}

function shapeFact(f: import('../../memory/index.js').IFact): Record<string, unknown> {
  return {
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
    createdAt: f.createdAt,
  };
}
