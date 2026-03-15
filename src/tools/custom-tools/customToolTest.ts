/**
 * custom_tool_test - Executes custom tool code in the VM sandbox for testing
 *
 * Reuses executeInVM from the executeJavaScript tool.
 * Uses descriptionFactory to dynamically show available connectors.
 */

import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { executeInVM } from '../code/executeJavaScript.js';
import { Connector } from '../../core/Connector.js';
import { buildTestDescription } from './sandboxDescription.js';

interface TestArgs {
  code: string;
  inputSchema: Record<string, unknown>;
  testInput: unknown;
  connectorName?: string;
  timeout?: number;
}

interface TestResult {
  success: boolean;
  result: unknown;
  logs: string[];
  error?: string;
  executionTime: number;
}

const DEFAULT_TEST_TIMEOUT = 10000;
const MAX_TEST_TIMEOUT = 30000;

export function createCustomToolTest(): ToolFunction<TestArgs, TestResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'custom_tool_test',
        description: 'Test custom tool code by executing it in the VM sandbox with provided test input.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript code to test. See tool description for full sandbox API reference.',
            },
            inputSchema: {
              type: 'object',
              description: 'The input schema (for documentation, not enforced at test time)',
            },
            testInput: {
              description: 'Test input data — available as `input` in the code',
            },
            connectorName: {
              type: 'string',
              description: 'Optional connector name for authenticated API access',
            },
            timeout: {
              type: 'number',
              description: `Execution timeout in ms. Default: ${DEFAULT_TEST_TIMEOUT}, max: ${MAX_TEST_TIMEOUT}`,
            },
          },
          required: ['code', 'inputSchema', 'testInput'],
        },
      },
      timeout: MAX_TEST_TIMEOUT + 5000,
    },

    descriptionFactory: (context?: ToolContext) => buildTestDescription(context),

    permission: { scope: 'once' as const, riskLevel: 'high' as const, sensitiveArgs: ['code'] },

    execute: async (args: TestArgs, context?: ToolContext): Promise<TestResult> => {
      const logs: string[] = [];
      const startTime = Date.now();
      const timeout = Math.min(Math.max(args.timeout || DEFAULT_TEST_TIMEOUT, 0), MAX_TEST_TIMEOUT);

      try {
        const registry = context?.connectorRegistry ?? Connector.asRegistry();
        const result = await executeInVM(
          args.code,
          args.testInput,
          timeout,
          logs,
          context?.userId,
          registry,
        );

        return {
          success: true,
          result,
          logs,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          result: null,
          logs,
          error: (error as Error).message,
          executionTime: Date.now() - startTime,
        };
      }
    },

    describeCall: (args: TestArgs) => `testing code (${args.code.length} chars)`,
  };
}

/** Default custom_tool_test instance */
export const customToolTest = createCustomToolTest();
