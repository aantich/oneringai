/**
 * custom_tool_draft - Validates a draft custom tool structure
 *
 * The agent generates the tool content; this tool validates:
 * - Name format (/^[a-z][a-z0-9_]*$/)
 * - Input schema has type: 'object'
 * - Code is syntactically valid
 * - Description is not empty
 *
 * Uses descriptionFactory to dynamically show available connectors
 * so the agent knows what APIs it can use when writing tool code.
 */

import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { buildDraftDescription } from './sandboxDescription.js';

interface DraftArgs {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  code: string;
  tags?: string[];
  connectorName?: string;
}

interface DraftResult {
  success: boolean;
  errors?: string[];
  validated?: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    code: string;
    tags?: string[];
    connectorName?: string;
  };
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function createCustomToolDraft(): ToolFunction<DraftArgs, DraftResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'custom_tool_draft',
        description: 'Validate a draft custom tool definition. Checks name format, schema structure, and code syntax.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Tool name (lowercase, underscores, must start with letter). Example: "fetch_weather"',
            },
            description: {
              type: 'string',
              description: 'What the tool does',
            },
            inputSchema: {
              type: 'object',
              description: 'JSON Schema for the tool input (must have type: "object")',
            },
            outputSchema: {
              type: 'object',
              description: 'Optional JSON Schema for the tool output (documentation only)',
            },
            code: {
              type: 'string',
              description:
                'JavaScript code that reads `input` and sets `output`. ' +
                'Runs in the same sandbox as execute_javascript. See tool description for full API reference.',
            },
            tags: {
              type: 'array',
              description: 'Optional tags for categorization',
              items: { type: 'string' },
            },
            connectorName: {
              type: 'string',
              description: 'Optional connector name if the tool requires API access',
            },
          },
          required: ['name', 'description', 'inputSchema', 'code'],
        },
      },
    },

    descriptionFactory: (context?: ToolContext) => buildDraftDescription(context),

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (args: DraftArgs): Promise<DraftResult> => {
      const errors: string[] = [];

      // Validate name
      if (!args.name || typeof args.name !== 'string') {
        errors.push('name is required and must be a string');
      } else if (!NAME_PATTERN.test(args.name)) {
        errors.push(
          `name "${args.name}" is invalid. Must match /^[a-z][a-z0-9_]*$/ (lowercase, underscores, start with letter)`
        );
      }

      // Validate description
      if (!args.description || typeof args.description !== 'string' || args.description.trim().length === 0) {
        errors.push('description is required and must be a non-empty string');
      }

      // Validate inputSchema
      if (!args.inputSchema || typeof args.inputSchema !== 'object') {
        errors.push('inputSchema is required and must be an object');
      } else if (args.inputSchema.type !== 'object') {
        errors.push('inputSchema.type must be "object"');
      }

      // Validate code syntax
      if (!args.code || typeof args.code !== 'string' || args.code.trim().length === 0) {
        errors.push('code is required and must be a non-empty string');
      } else {
        try {
          // eslint-disable-next-line no-new
          new Function(args.code);
        } catch (e) {
          errors.push(`code has syntax error: ${(e as Error).message}`);
        }
      }

      if (errors.length > 0) {
        return { success: false, errors };
      }

      return {
        success: true,
        validated: {
          name: args.name,
          description: args.description,
          inputSchema: args.inputSchema,
          outputSchema: args.outputSchema,
          code: args.code,
          tags: args.tags,
          connectorName: args.connectorName,
        },
      };
    },

    describeCall: (args: DraftArgs) => args.name ?? 'unknown',
  };
}

/** Default custom_tool_draft instance */
export const customToolDraft = createCustomToolDraft();
