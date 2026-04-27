/**
 * routine_list - Lists routine definitions accessible to the caller.
 *
 * Returns slim RoutineSummary entries (no tasks, no instructions, no
 * pre/postSteps). Fetch the full definition with routine_get.
 *
 * Optional filters: tags (intersect ANY), search (case-insensitive
 * substring on name/description), limit, offset.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import type { RoutineSummary } from '../../domain/entities/Routine.js';
import { resolveRoutineDefinitionStorage } from './resolveStorage.js';

interface RoutineListArgs {
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

interface RoutineListResult {
  success: boolean;
  count: number;
  hasMore: boolean;
  routines: RoutineSummary[];
  error?: string;
}

export function createRoutineList(
  storage?: IRoutineDefinitionStorage,
): ToolFunction<RoutineListArgs, RoutineListResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'routine_list',
        description:
          'List routine definitions accessible to the caller. Returns slim summary entries (id, name, description, version, author, tags, task count, parameter names) — fetch the full structure with routine_get. Filter by tags, search by name/description substring, or paginate.',
        parameters: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Match routines tagged with ANY of these tags. Omit to ignore tag filtering.',
            },
            search: {
              type: 'string',
              description:
                'Case-insensitive substring match against routine name and description.',
            },
            limit: {
              type: 'number',
              description: 'Max entries to return (default: 50, max: 200).',
            },
            offset: {
              type: 'number',
              description: 'Number of entries to skip (for pagination, default: 0).',
            },
          },
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: RoutineListArgs, context?: ToolContext): Promise<RoutineListResult> => {
      try {
        const userId = context?.userId;
        const s = resolveRoutineDefinitionStorage(storage, context);

        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
        const offset = Math.max(args.offset ?? 0, 0);

        // Fetch limit + 1 to detect if more results exist beyond this page.
        const fetched = await s.list(userId, {
          tags: args.tags,
          search: args.search,
          limit: limit + 1,
          offset,
        });

        const hasMore = fetched.length > limit;
        const routines = hasMore ? fetched.slice(0, limit) : fetched;

        return {
          success: true,
          count: routines.length,
          hasMore,
          routines,
        };
      } catch (error) {
        return {
          success: false,
          count: 0,
          hasMore: false,
          routines: [],
          error: (error as Error).message,
        };
      }
    },

    describeCall: (args: RoutineListArgs) => {
      const parts: string[] = [];
      if (args.search) parts.push(`search="${args.search}"`);
      if (args.tags?.length) parts.push(`tags=[${args.tags.join(',')}]`);
      if (args.limit) parts.push(`limit=${args.limit}`);
      return parts.length > 0 ? parts.join(', ') : 'all routines';
    },
  };
}

/** Default routine_list instance (resolves storage from StorageRegistry at execution time) */
export const routineList = createRoutineList();
