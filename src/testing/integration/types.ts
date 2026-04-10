/**
 * Integration Test Suite Types
 *
 * Defines the structure for connector integration tests.
 * Tests are defined in oneringai and executed by host apps (e.g., Everworker v25)
 * that provide authenticated connectors.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';

/**
 * Parameter definition for a test suite.
 * Host app presents these as input fields to the user before running tests.
 */
export interface TestParam {
  /** Unique key used to look up this param in TestContext.params */
  key: string;
  /** Human-readable label for UI */
  label: string;
  /** Description / help text */
  description: string;
  /** Input type hint for UI */
  type: 'string' | 'email' | 'url' | 'boolean';
  /** Whether the param must be provided (tests using it are skipped if missing) */
  required: boolean;
  /** Default value (pre-filled in UI) */
  default?: string;
}

/**
 * Result of a single test case execution.
 */
export interface TestCaseResult {
  /** Test case name */
  testName: string;
  /** Tool name this test exercises (without connector prefix) */
  toolName: string;
  /** Outcome */
  status: 'passed' | 'failed' | 'skipped' | 'error';
  /** Execution time in ms */
  duration: number;
  /** Human-readable summary */
  message?: string;
  /** Error details (stack trace, API error, etc.) */
  error?: string;
  /** Arguments sent to the tool (for debugging) */
  request?: unknown;
  /** Tool response (for debugging) */
  response?: unknown;
}

/**
 * Result of running a full test suite against a connector.
 */
export interface TestSuiteResult {
  /** Suite ID (e.g., 'google-workspace') */
  suiteId: string;
  /** Connector name that was tested */
  connectorName: string;
  /** Detected service type */
  serviceType: string;
  /** ISO timestamp when suite started */
  startedAt: string;
  /** ISO timestamp when suite completed */
  completedAt: string;
  /** Per-test results in execution order */
  results: TestCaseResult[];
  /** Aggregated counts */
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    error: number;
    total: number;
  };
}

/**
 * Shared context passed to all test cases in a suite run.
 */
export interface TestContext {
  /** User-provided params (emails, channels, repos, etc.) */
  params: Record<string, string>;
  /** Shared mutable state between test cases (e.g., created event ID for later get/delete) */
  state: Record<string, unknown>;
  /** User ID for ToolContext (from the authenticated user running the tests) */
  userId?: string;
  /** Connector name being tested */
  connectorName?: string;
  /** Real-time log callback */
  log: (message: string) => void;
}

/**
 * A single test case within a suite.
 */
export interface IntegrationTestCase {
  /** Descriptive test name (e.g., 'Create a calendar meeting') */
  name: string;
  /** Tool name this exercises (without connector prefix, e.g., 'create_meeting') */
  toolName: string;
  /** Short description of what this test verifies */
  description: string;
  /**
   * If true, failure here skips all remaining tests in the suite.
   * Use for setup tests whose output is needed by later tests
   * (e.g., create_meeting must succeed for get_meeting to run).
   */
  critical?: boolean;
  /**
   * Param keys this test requires. If any are missing from TestContext.params,
   * the test is automatically skipped.
   */
  requiredParams?: string[];
  /**
   * Execute the test.
   * @param tools - Map of tool name (without connector prefix) → ToolFunction
   * @param context - Shared test context
   * @returns success=true if test passed, with optional message and data
   */
  execute: (
    tools: Map<string, ToolFunction>,
    context: TestContext
  ) => Promise<{ success: boolean; message?: string; data?: unknown }>;
  /**
   * Optional cleanup that runs even if the test failed.
   * Use to delete resources created during the test.
   */
  cleanup?: (
    tools: Map<string, ToolFunction>,
    context: TestContext
  ) => Promise<void>;
}

/**
 * Definition of a complete integration test suite for a service type.
 */
export interface IntegrationTestSuite {
  /** Unique suite ID (e.g., 'google-workspace') */
  id: string;
  /** Service type this suite tests (must match ConnectorTools.detectService output) */
  serviceType: string;
  /** Human-readable name (e.g., 'Google Workspace') */
  name: string;
  /** Description of what this suite covers */
  description: string;
  /** Params that must be provided for any tests to run */
  requiredParams: TestParam[];
  /** Params that enable additional tests if provided */
  optionalParams: TestParam[];
  /** Ordered list of test cases (execution order matters) */
  tests: IntegrationTestCase[];
}

/**
 * Options for running a test suite.
 */
export interface RunSuiteOptions {
  /** User ID passed to ToolContext */
  userId?: string;
  /** Connector name (for result tracking) */
  connectorName?: string;
  /** Called after each test case completes (for real-time UI updates) */
  onProgress?: (result: TestCaseResult) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}
