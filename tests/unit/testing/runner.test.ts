import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationTestRunner, registerSuite } from '../../../src/testing/integration/runner.js';
import type {
  IntegrationTestSuite,
  IntegrationTestCase,
  TestCaseResult,
} from '../../../src/testing/integration/types.js';
import type { ToolFunction, FunctionToolDefinition } from '../../../src/domain/entities/Tool.js';

/**
 * Create a mock ToolFunction with a given name and execute behavior.
 */
function mockTool(
  name: string,
  executeFn?: (args: any) => Promise<any>
): ToolFunction {
  return {
    definition: {
      type: 'function',
      function: {
        name,
        description: `Mock tool: ${name}`,
        parameters: { type: 'object', properties: {} },
      },
    } as FunctionToolDefinition,
    execute: executeFn ?? (async () => ({ success: true })),
  };
}

/**
 * Create a minimal test suite for testing runner behavior.
 */
function createTestSuite(
  overrides: Partial<IntegrationTestSuite> & { tests: IntegrationTestCase[] }
): IntegrationTestSuite {
  return {
    id: overrides.id ?? 'test-suite',
    serviceType: overrides.serviceType ?? 'test-service',
    name: overrides.name ?? 'Test Suite',
    description: overrides.description ?? 'Test suite for runner tests',
    requiredParams: overrides.requiredParams ?? [],
    optionalParams: overrides.optionalParams ?? [],
    tests: overrides.tests,
  };
}

describe('IntegrationTestRunner', () => {
  describe('runSuite', () => {
    it('should run all test cases and return results', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Test 1',
            toolName: 'tool_a',
            description: 'First test',
            execute: async (tools) => {
              const tool = tools.get('tool_a')!;
              const result = await tool.execute({});
              return { success: result.success, message: 'OK' };
            },
          },
          {
            name: 'Test 2',
            toolName: 'tool_b',
            description: 'Second test',
            execute: async () => ({ success: true, message: 'Also OK' }),
          },
        ],
      });

      const tools = [
        mockTool('myconnector_tool_a'),
        mockTool('myconnector_tool_b'),
      ];

      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.suiteId).toBe('test-suite');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('passed');
      expect(result.results[1].status).toBe('passed');
      expect(result.summary.passed).toBe(2);
      expect(result.summary.total).toBe(2);
    });

    it('should skip tests when tool is not available', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Missing tool test',
            toolName: 'nonexistent_tool',
            description: 'Uses a tool not in the tool set',
            execute: async () => ({ success: true }),
          },
        ],
      });

      const result = await IntegrationTestRunner.runSuite(suite, [], {});

      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].message).toContain('not available');
    });

    it('should skip tests when required params are missing', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Needs email',
            toolName: 'tool_a',
            description: 'Requires email param',
            requiredParams: ['testEmail'],
            execute: async () => ({ success: true }),
          },
        ],
      });

      const tools = [mockTool('conn_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].message).toContain('testEmail');
    });

    it('should record failed tests', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Failing test',
            toolName: 'tool_a',
            description: 'Returns failure',
            execute: async () => ({
              success: false,
              message: 'API returned 403',
            }),
          },
        ],
      });

      const tools = [mockTool('conn_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].message).toBe('API returned 403');
      expect(result.summary.failed).toBe(1);
    });

    it('should record errors from thrown exceptions', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Erroring test',
            toolName: 'tool_a',
            description: 'Throws an error',
            execute: async () => {
              throw new Error('Network timeout');
            },
          },
        ],
      });

      const tools = [mockTool('conn_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('error');
      expect(result.results[0].message).toContain('Network timeout');
      expect(result.results[0].error).toBeDefined();
    });

    it('should skip remaining tests after critical failure', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Critical setup',
            toolName: 'tool_a',
            description: 'Must succeed for others to run',
            critical: true,
            execute: async () => ({
              success: false,
              message: 'Setup failed',
            }),
          },
          {
            name: 'Dependent test',
            toolName: 'tool_b',
            description: 'Depends on critical test',
            execute: async () => ({ success: true }),
          },
          {
            name: 'Another dependent',
            toolName: 'tool_a',
            description: 'Also depends',
            execute: async () => ({ success: true }),
          },
        ],
      });

      const tools = [mockTool('c_tool_a'), mockTool('c_tool_b')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('failed');
      expect(result.results[1].status).toBe('skipped');
      expect(result.results[1].message).toContain('critical');
      expect(result.results[2].status).toBe('skipped');
      expect(result.summary).toEqual({
        passed: 0,
        failed: 1,
        skipped: 2,
        error: 0,
        total: 3,
      });
    });

    it('should NOT skip after critical test passes', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Critical setup',
            toolName: 'tool_a',
            description: 'Passes',
            critical: true,
            execute: async () => ({ success: true }),
          },
          {
            name: 'Next test',
            toolName: 'tool_b',
            description: 'Should run',
            execute: async () => ({ success: true }),
          },
        ],
      });

      const tools = [mockTool('c_tool_a'), mockTool('c_tool_b')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('passed');
      expect(result.results[1].status).toBe('passed');
    });

    it('should call onProgress after each test', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'T1',
            toolName: 'tool_a',
            description: 'First',
            execute: async () => ({ success: true }),
          },
          {
            name: 'T2',
            toolName: 'tool_b',
            description: 'Second',
            execute: async () => ({ success: true }),
          },
        ],
      });

      const tools = [mockTool('c_tool_a'), mockTool('c_tool_b')];
      const progressCalls: TestCaseResult[] = [];

      await IntegrationTestRunner.runSuite(suite, tools, {}, {
        onProgress: (r) => progressCalls.push(r),
      });

      // Filter out log messages
      const testResults = progressCalls.filter((r) => r.testName !== '__log');
      expect(testResults).toHaveLength(2);
      expect(testResults[0].testName).toBe('T1');
      expect(testResults[1].testName).toBe('T2');
    });

    it('should run cleanup even on failure', async () => {
      const cleanupCalled = vi.fn();
      const suite = createTestSuite({
        tests: [
          {
            name: 'Failing with cleanup',
            toolName: 'tool_a',
            description: 'Fails but has cleanup',
            execute: async () => ({ success: false, message: 'fail' }),
            cleanup: async () => {
              cleanupCalled();
            },
          },
        ],
      });

      const tools = [mockTool('c_tool_a')];
      await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(cleanupCalled).toHaveBeenCalledOnce();
    });

    it('should handle cleanup errors gracefully', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Test with broken cleanup',
            toolName: 'tool_a',
            description: 'Cleanup throws',
            execute: async () => ({ success: true }),
            cleanup: async () => {
              throw new Error('Cleanup exploded');
            },
          },
        ],
      });

      const tools = [mockTool('c_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      // Test itself should still be passed
      expect(result.results[0].status).toBe('passed');
    });

    it('should respect abort signal', async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-abort

      const suite = createTestSuite({
        tests: [
          {
            name: 'Should be skipped',
            toolName: 'tool_a',
            description: 'Never runs',
            execute: async () => ({ success: true }),
          },
        ],
      });

      const tools = [mockTool('c_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {}, {
        signal: controller.signal,
      });

      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].message).toContain('Cancelled');
    });

    it('should pass shared state between tests', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Writer',
            toolName: 'tool_a',
            description: 'Writes to state',
            execute: async (_tools, ctx) => {
              ctx.state.createdId = 'abc-123';
              return { success: true };
            },
          },
          {
            name: 'Reader',
            toolName: 'tool_b',
            description: 'Reads from state',
            execute: async (_tools, ctx) => {
              const id = ctx.state.createdId;
              return {
                success: id === 'abc-123',
                message: `Got ID: ${id}`,
              };
            },
          },
        ],
      });

      const tools = [mockTool('c_tool_a'), mockTool('c_tool_b')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[1].status).toBe('passed');
      expect(result.results[1].message).toBe('Got ID: abc-123');
    });

    it('should measure duration', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Slow test',
            toolName: 'tool_a',
            description: 'Takes some time',
            execute: async () => {
              await new Promise((r) => setTimeout(r, 50));
              return { success: true };
            },
          },
        ],
      });

      const tools = [mockTool('c_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].duration).toBeGreaterThanOrEqual(40);
    });

    it('should include timestamps', async () => {
      const suite = createTestSuite({
        tests: [
          {
            name: 'Quick',
            toolName: 'tool_a',
            description: 'Fast test',
            execute: async () => ({ success: true }),
          },
        ],
      });

      const tools = [mockTool('c_tool_a')];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
        new Date(result.completedAt).getTime()
      );
    });
  });

  describe('tool name mapping', () => {
    it('should strip connector prefix from tool names', async () => {
      const executeSpy = vi.fn(async () => ({ success: true, value: 42 }));
      const suite = createTestSuite({
        tests: [
          {
            name: 'Uses prefixed tool',
            toolName: 'list_channels',
            description: 'Tool name is list_channels but actual is slack_list_channels',
            execute: async (tools) => {
              const tool = tools.get('list_channels')!;
              const result = await tool.execute({});
              return { success: result.success };
            },
          },
        ],
      });

      const tools = [mockTool('my_slack_list_channels', executeSpy)];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('passed');
      expect(executeSpy).toHaveBeenCalled();
    });

    it('should handle tools with account prefix', async () => {
      const executeSpy = vi.fn(async () => ({ success: true }));
      const suite = createTestSuite({
        tests: [
          {
            name: 'Account-prefixed tool',
            toolName: 'post_message',
            description: 'Tool is slack_work_post_message',
            execute: async (tools) => {
              const tool = tools.get('post_message')!;
              await tool.execute({});
              return { success: true };
            },
          },
        ],
      });

      const tools = [mockTool('slack_work_post_message', executeSpy)];
      const result = await IntegrationTestRunner.runSuite(suite, tools, {});

      expect(result.results[0].status).toBe('passed');
    });
  });

  describe('validateParams', () => {
    it('should return empty array when all required params present', () => {
      const suite = createTestSuite({
        requiredParams: [
          { key: 'email', label: 'Email', description: '', type: 'email', required: true },
        ],
        tests: [],
      });

      const errors = IntegrationTestRunner.validateParams(suite, { email: 'test@test.com' });
      expect(errors).toHaveLength(0);
    });

    it('should return errors for missing required params', () => {
      const suite = createTestSuite({
        requiredParams: [
          { key: 'email', label: 'Email', description: '', type: 'email', required: true },
          { key: 'channel', label: 'Channel', description: '', type: 'string', required: true },
        ],
        tests: [],
      });

      const errors = IntegrationTestRunner.validateParams(suite, { email: 'test@test.com' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Channel');
    });

    it('should reject blank/whitespace params', () => {
      const suite = createTestSuite({
        requiredParams: [
          { key: 'name', label: 'Name', description: '', type: 'string', required: true },
        ],
        tests: [],
      });

      const errors = IntegrationTestRunner.validateParams(suite, { name: '   ' });
      expect(errors).toHaveLength(1);
    });
  });

  describe('suite registry', () => {
    it('should return registered suites', () => {
      // Suites are registered by side-effect imports in the integration index
      // For this test, register a custom one
      const customSuite = createTestSuite({
        id: 'custom-test-runner-suite',
        serviceType: 'custom-test',
        tests: [],
      });
      registerSuite(customSuite);

      const all = IntegrationTestRunner.getAllSuites();
      const found = all.find((s) => s.id === 'custom-test-runner-suite');
      expect(found).toBeDefined();
    });

    it('should filter suites by service type', () => {
      const suite1 = createTestSuite({
        id: 'filter-test-1',
        serviceType: 'filter-target',
        tests: [],
      });
      const suite2 = createTestSuite({
        id: 'filter-test-2',
        serviceType: 'filter-other',
        tests: [],
      });
      registerSuite(suite1);
      registerSuite(suite2);

      const matches = IntegrationTestRunner.getSuitesForService('filter-target');
      expect(matches.some((s) => s.id === 'filter-test-1')).toBe(true);
      expect(matches.some((s) => s.id === 'filter-test-2')).toBe(false);
    });

    it('should update existing suite on re-register', () => {
      const original = createTestSuite({
        id: 'reregister-test',
        name: 'Original',
        serviceType: 'rr',
        tests: [],
      });
      registerSuite(original);

      const updated = createTestSuite({
        id: 'reregister-test',
        name: 'Updated',
        serviceType: 'rr',
        tests: [],
      });
      registerSuite(updated);

      const all = IntegrationTestRunner.getAllSuites();
      const found = all.filter((s) => s.id === 'reregister-test');
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('Updated');
    });
  });
});
