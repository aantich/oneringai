/**
 * custom_tool_list - Lists saved custom tools from storage
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { ICustomToolStorage } from '../../domain/interfaces/ICustomToolStorage.js';
import type { CustomToolSummary } from '../../domain/entities/CustomToolDefinition.js';
import { resolveCustomToolStorage } from './resolveStorage.js';

interface ListArgs {
  search?: string;
  tags?: string[];
  category?: string;
  limit?: number;
  offset?: number;
}

interface ListResult {
  tools: CustomToolSummary[];
  total: number;
}

export function createCustomToolList(storage?: ICustomToolStorage): ToolFunction<ListArgs, ListResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'custom_tool_list',
        description:
          'List saved custom tools from persistent storage. Supports filtering by search text, tags, and category.',
        parameters: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'Search text (case-insensitive substring match on name + description)',
            },
            tags: {
              type: 'array',
              description: 'Filter by tags (any match)',
              items: { type: 'string' },
            },
            category: {
              type: 'string',
              description: 'Filter by category',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results',
            },
            offset: {
              type: 'number',
              description: 'Offset for pagination',
            },
          },
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: ListArgs, context?: ToolContext): Promise<ListResult> => {
      const userId = context?.userId;
      const s = resolveCustomToolStorage(storage, context);
      const tools = await s.list(userId, {
        search: args.search,
        tags: args.tags,
        category: args.category,
        limit: args.limit,
        offset: args.offset,
      });

      return { tools, total: tools.length };
    },

    describeCall: (args: ListArgs) => args.search ?? 'all tools',
  };
}

/** Default custom_tool_list instance (resolves storage from StorageRegistry at execution time) */
export const customToolList = createCustomToolList();
