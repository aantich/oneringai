/**
 * JSON Manipulation Tool
 *
 * Allows AI agents to manipulate JSON objects using dot notation paths.
 * Supports delete, add, and replace operations at any depth.
 */

import { ToolFunction } from '../../domain/entities/Tool.js';
import { setValueAtPath, deleteAtPath, pathExists } from './pathUtils.js';

interface JsonManipulateArgs {
  operation: 'delete' | 'add' | 'replace';
  path: string;
  value?: any;
  object: any;
}

interface JsonManipulateResult {
  success: boolean;
  result: any | null;
  message?: string;
  error?: string;
}

export const jsonManipulator: ToolFunction<JsonManipulateArgs, JsonManipulateResult> = {
  definition: {
    type: 'function',
    function: {
      name: 'json_manipulate',
      description: `Manipulate JSON objects by deleting, adding, or replacing fields at any depth.

IMPORTANT - PATH FORMAT (DOT NOTATION):
Use dots to separate nested field names. Examples:
• Top-level field: "name"
• Nested field: "user.email"
• Array element: "users.0.name" (where 0 is the array index)
• Deep nesting: "settings.theme.colors.primary"
• For root operations: use empty string ""

OPERATIONS:

1. DELETE - Remove a field from the object
   • Removes the specified field and its value
   • Returns error if path doesn't exist
   • Example: operation="delete", path="user.address.city"
   • Result: The city field is removed from user.address

2. ADD - Add a new field to the object
   • Creates intermediate objects/arrays if they don't exist
   • If field already exists, it will be overwritten
   • Example: operation="add", path="user.phone", value="+1234567890"
   • Result: Creates user.phone field with the phone number

3. REPLACE - Replace the value of an EXISTING field
   • Only works if the field already exists (use ADD for new fields)
   • Returns error if path doesn't exist
   • Example: operation="replace", path="user.name", value="Jane Doe"
   • Result: Changes the existing user.name value

ARRAY OPERATIONS:
• Access array elements by index: "users.0.name" (first user's name)
• Add to array: "users.2" appends if index >= array length
• Delete from array: "users.1" removes element and shifts remaining items

COMPLETE EXAMPLES:

Example 1 - Delete a field:
  Input: { operation: "delete", path: "user.email", object: {user: {name: "John", email: "j@ex.com"}} }
  Output: {user: {name: "John"}}

Example 2 - Add nested field (auto-creates intermediate objects):
  Input: { operation: "add", path: "user.address.city", value: "Paris", object: {user: {name: "John"}} }
  Output: {user: {name: "John", address: {city: "Paris"}}}

Example 3 - Replace value:
  Input: { operation: "replace", path: "settings.theme", value: "dark", object: {settings: {theme: "light"}} }
  Output: {settings: {theme: "dark"}}

Example 4 - Array manipulation:
  Input: { operation: "replace", path: "users.0.active", value: false, object: {users: [{name: "Bob", active: true}]} }
  Output: {users: [{name: "Bob", active: false}]}

The tool returns a result object with:
• success: boolean (true if operation succeeded)
• result: the modified JSON object (or null if failed)
• message: success message (if succeeded)
• error: error description (if failed)`,

      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['delete', 'add', 'replace'],
            description:
              'The operation to perform. "delete" removes a field, "add" creates a new field (or overwrites existing), "replace" changes an existing field value.',
          },
          path: {
            type: 'string',
            description:
              'Dot notation path to the field. Examples: "name", "user.email", "users.0.name", "settings.theme.colors.primary". Use empty string "" only for root-level operations.',
          },
          value: {
            description:
              'The value to add or replace. Can be any JSON-compatible type: string, number, boolean, object, array, or null. Required for add/replace operations, ignored for delete.',
          },
          object: {
            type: 'object',
            description:
              'The JSON object to manipulate. The original object is not modified; a new modified copy is returned in the result.',
          },
        },
        required: ['operation', 'path', 'object'],
      },
    },
    blocking: true, // Always wait for result
    timeout: 10000, // 10 seconds should be plenty for JSON operations
  },

  permission: { scope: 'always' as const, riskLevel: 'low' as const },

  execute: async (args: JsonManipulateArgs): Promise<JsonManipulateResult> => {
    try {
      // Validate operation
      if (!['delete', 'add', 'replace'].includes(args.operation)) {
        return {
          success: false,
          result: null,
          error: `Invalid operation: "${args.operation}". Must be "delete", "add", or "replace".`,
        };
      }

      // Validate object is provided
      if (!args.object || typeof args.object !== 'object') {
        return {
          success: false,
          result: null,
          error: 'Invalid object: must provide a valid JSON object',
        };
      }

      // Clone object to avoid mutation (deep clone)
      let clonedObject: any;
      try {
        clonedObject = JSON.parse(JSON.stringify(args.object));
      } catch (error: any) {
        return {
          success: false,
          result: null,
          error: `Cannot clone object: ${error.message}. Object may contain circular references or non-JSON values.`,
        };
      }

      // Perform operation
      switch (args.operation) {
        case 'delete': {
          try {
            const deleted = deleteAtPath(clonedObject, args.path);

            if (!deleted) {
              return {
                success: false,
                result: null,
                error: `Path not found: "${args.path}". The field does not exist in the object.`,
              };
            }

            return {
              success: true,
              result: clonedObject,
              message: `Successfully deleted field at path: "${args.path}"`,
            };
          } catch (error: any) {
            return {
              success: false,
              result: null,
              error: `Delete operation failed: ${error.message}`,
            };
          }
        }

        case 'add': {
          // Validate value is provided
          if (args.value === undefined) {
            return {
              success: false,
              result: null,
              error: 'Add operation requires a "value" parameter',
            };
          }

          try {
            setValueAtPath(clonedObject, args.path, args.value);

            return {
              success: true,
              result: clonedObject,
              message: `Successfully added field at path: "${args.path}"`,
            };
          } catch (error: any) {
            return {
              success: false,
              result: null,
              error: `Add operation failed: ${error.message}`,
            };
          }
        }

        case 'replace': {
          // Validate value is provided
          if (args.value === undefined) {
            return {
              success: false,
              result: null,
              error: 'Replace operation requires a "value" parameter',
            };
          }

          // Check if path exists (replace only works on existing paths)
          if (!pathExists(clonedObject, args.path)) {
            return {
              success: false,
              result: null,
              error: `Path not found: "${args.path}". Use "add" operation to create new fields.`,
            };
          }

          try {
            setValueAtPath(clonedObject, args.path, args.value);

            return {
              success: true,
              result: clonedObject,
              message: `Successfully replaced value at path: "${args.path}"`,
            };
          } catch (error: any) {
            return {
              success: false,
              result: null,
              error: `Replace operation failed: ${error.message}`,
            };
          }
        }

        default:
          return {
            success: false,
            result: null,
            error: `Unknown operation: ${args.operation}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        result: null,
        error: `Unexpected error manipulating JSON: ${error.message}`,
      };
    }
  },
};
