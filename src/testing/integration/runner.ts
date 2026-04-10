/**
 * Integration Test Runner
 *
 * Executes integration test suites against real connectors.
 * The runner is connector-agnostic — it receives pre-created tools
 * from the host app (e.g., via ConnectorTools.for()).
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type {
  IntegrationTestSuite,
  IntegrationTestCase,
  TestCaseResult,
  TestSuiteResult,
  TestContext,
  RunSuiteOptions,
} from './types.js';

/** Global registry of all test suites */
const suiteRegistry: IntegrationTestSuite[] = [];

/**
 * Register a test suite. Called by each suite module.
 */
export function registerSuite(suite: IntegrationTestSuite): void {
  const existing = suiteRegistry.findIndex((s) => s.id === suite.id);
  if (existing >= 0) {
    suiteRegistry[existing] = suite;
  } else {
    suiteRegistry.push(suite);
  }
}

/**
 * Strip the connector prefix from tool names to get base names.
 *
 * ConnectorTools.for() names tools as `{connectorName}_{toolName}`.
 * We need to map back to base names for suite test cases.
 *
 * Strategy: Try to match each tool's full name against known test tool names.
 * The prefix is everything before the first matching suffix.
 */
function buildToolMap(
  tools: ToolFunction[],
  suite: IntegrationTestSuite
): Map<string, ToolFunction> {
  const map = new Map<string, ToolFunction>();

  // Collect all tool names referenced by the suite
  const expectedNames = new Set(suite.tests.map((t) => t.toolName));
  // Also add 'api' for generic API tool
  expectedNames.add('api');

  for (const tool of tools) {
    const fullName = tool.definition.function.name;

    // Try to find a matching suffix from expected names
    for (const expected of expectedNames) {
      if (fullName === expected || fullName.endsWith(`_${expected}`)) {
        map.set(expected, tool);
        break;
      }
    }

    // Also store by full name as fallback
    if (!map.has(fullName)) {
      map.set(fullName, tool);
    }
  }

  return map;
}

export class IntegrationTestRunner {
  /**
   * Run a single test suite with real tools.
   */
  static async runSuite(
    suite: IntegrationTestSuite,
    tools: ToolFunction[],
    params: Record<string, string>,
    options?: RunSuiteOptions
  ): Promise<TestSuiteResult> {
    const startedAt = new Date().toISOString();
    const results: TestCaseResult[] = [];
    let skipRemaining = false;

    const toolMap = buildToolMap(tools, suite);

    const context: TestContext = {
      params,
      state: {},
      userId: options?.userId,
      connectorName: options?.connectorName,
      log: (message: string) => {
        options?.onProgress?.({
          testName: '__log',
          toolName: '',
          status: 'passed',
          duration: 0,
          message,
        });
      },
    };

    for (const testCase of suite.tests) {
      // Check cancellation
      if (options?.signal?.aborted) {
        results.push({
          testName: testCase.name,
          toolName: testCase.toolName,
          status: 'skipped',
          duration: 0,
          message: 'Cancelled by user',
        });
        continue;
      }

      // Skip remaining if a critical test failed
      if (skipRemaining) {
        results.push({
          testName: testCase.name,
          toolName: testCase.toolName,
          status: 'skipped',
          duration: 0,
          message: 'Skipped due to prior critical failure',
        });
        const skippedResult = results[results.length - 1];
        if (skippedResult) options?.onProgress?.(skippedResult);
        continue;
      }

      const result = await this.runTestCase(testCase, toolMap, context);
      results.push(result);
      options?.onProgress?.(result);

      // If critical test failed, skip remaining
      if (testCase.critical && result.status !== 'passed') {
        skipRemaining = true;
      }
    }

    const completedAt = new Date().toISOString();

    const summary = {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      error: results.filter((r) => r.status === 'error').length,
      total: results.length,
    };

    return {
      suiteId: suite.id,
      connectorName: options?.connectorName ?? 'unknown',
      serviceType: suite.serviceType,
      startedAt,
      completedAt,
      results,
      summary,
    };
  }

  /**
   * Run a single test case with error handling, timing, and cleanup.
   */
  private static async runTestCase(
    testCase: IntegrationTestCase,
    toolMap: Map<string, ToolFunction>,
    context: TestContext
  ): Promise<TestCaseResult> {
    // Check if tool exists in the tool map
    if (!toolMap.has(testCase.toolName)) {
      return {
        testName: testCase.name,
        toolName: testCase.toolName,
        status: 'skipped',
        duration: 0,
        message: `Tool '${testCase.toolName}' not available in this connector`,
      };
    }

    // Check required params
    if (testCase.requiredParams) {
      const missing = testCase.requiredParams.filter((p) => !context.params[p]);
      if (missing.length > 0) {
        return {
          testName: testCase.name,
          toolName: testCase.toolName,
          status: 'skipped',
          duration: 0,
          message: `Missing required params: ${missing.join(', ')}`,
        };
      }
    }

    const start = Date.now();
    try {
      context.log(`Running: ${testCase.name}`);
      const result = await testCase.execute(toolMap, context);
      const duration = Date.now() - start;

      return {
        testName: testCase.name,
        toolName: testCase.toolName,
        status: result.success ? 'passed' : 'failed',
        duration,
        message: result.message,
        response: result.data,
      };
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        testName: testCase.name,
        toolName: testCase.toolName,
        status: 'error',
        duration,
        message: `Unexpected error: ${error.message}`,
        error: error.stack ?? error.message,
      };
    } finally {
      // Run cleanup if defined
      if (testCase.cleanup) {
        try {
          await testCase.cleanup(toolMap, context);
        } catch (cleanupErr: unknown) {
          const cleanupError =
            cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr));
          context.log(`Cleanup warning for '${testCase.name}': ${cleanupError.message}`);
        }
      }
    }
  }

  /**
   * Validate that required params are present.
   * @returns Array of error messages (empty = valid)
   */
  static validateParams(
    suite: IntegrationTestSuite,
    params: Record<string, string>
  ): string[] {
    const errors: string[] = [];
    for (const param of suite.requiredParams) {
      if (!params[param.key]?.trim()) {
        errors.push(`Missing required parameter: ${param.label} (${param.key})`);
      }
    }
    return errors;
  }

  /**
   * Get all registered test suites.
   */
  static getAllSuites(): IntegrationTestSuite[] {
    return [...suiteRegistry];
  }

  /**
   * Get test suites matching a service type.
   */
  static getSuitesForService(serviceType: string): IntegrationTestSuite[] {
    return suiteRegistry.filter((s) => s.serviceType === serviceType);
  }
}
