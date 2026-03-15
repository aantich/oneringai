/**
 * custom_tool_delete - Deletes a custom tool from storage
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { ICustomToolStorage } from '../../domain/interfaces/ICustomToolStorage.js';
import { resolveCustomToolStorage } from './resolveStorage.js';

interface DeleteArgs {
  name: string;
}

interface DeleteResult {
  success: boolean;
  name: string;
  error?: string;
}

export function createCustomToolDelete(storage?: ICustomToolStorage): ToolFunction<DeleteArgs, DeleteResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'custom_tool_delete',
        description: 'Delete a custom tool from persistent storage.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the tool to delete',
            },
          },
          required: ['name'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const, sensitiveArgs: ['name'] },

    execute: async (args: DeleteArgs, context?: ToolContext): Promise<DeleteResult> => {
      try {
        const userId = context?.userId;
        const s = resolveCustomToolStorage(storage, context);
        const exists = await s.exists(userId, args.name);
        if (!exists) {
          return { success: false, name: args.name, error: `Custom tool '${args.name}' not found` };
        }

        await s.delete(userId, args.name);
        return { success: true, name: args.name };
      } catch (error) {
        return { success: false, name: args.name, error: (error as Error).message };
      }
    },

    describeCall: (args: DeleteArgs) => args.name,
  };
}

/** Default custom_tool_delete instance (resolves storage from StorageRegistry at execution time) */
export const customToolDelete = createCustomToolDelete();
