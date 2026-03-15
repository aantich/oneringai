/**
 * custom_tool_load - Loads a full custom tool definition from storage
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { ICustomToolStorage } from '../../domain/interfaces/ICustomToolStorage.js';
import type { CustomToolDefinition } from '../../domain/entities/CustomToolDefinition.js';
import { resolveCustomToolStorage } from './resolveStorage.js';

interface LoadArgs {
  name: string;
}

interface LoadResult {
  success: boolean;
  tool?: CustomToolDefinition;
  error?: string;
}

export function createCustomToolLoad(storage?: ICustomToolStorage): ToolFunction<LoadArgs, LoadResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'custom_tool_load',
        description:
          'Load a full custom tool definition from storage (including code). ' +
          'Use this to inspect, modify, or hydrate a saved tool.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the tool to load',
            },
          },
          required: ['name'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: LoadArgs, context?: ToolContext): Promise<LoadResult> => {
      const userId = context?.userId;
      const s = resolveCustomToolStorage(storage, context);
      const tool = await s.load(userId, args.name);
      if (!tool) {
        return { success: false, error: `Custom tool '${args.name}' not found` };
      }
      return { success: true, tool };
    },

    describeCall: (args: LoadArgs) => args.name,
  };
}

/** Default custom_tool_load instance (resolves storage from StorageRegistry at execution time) */
export const customToolLoad = createCustomToolLoad();
