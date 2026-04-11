/**
 * Routine Runner Unit Tests
 *
 * Tests the executeRoutine() function which orchestrates running
 * a RoutineDefinition through an Agent with memory-bridged tasks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeRoutine, ExecuteRoutineOptions } from '@/core/routineRunner.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import type { RoutineDefinition } from '@/domain/entities/Routine.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';

// ============================================================================
// Mock Provider
// ============================================================================

const mockGenerate = vi.fn();
const mockStreamGenerate = vi.fn();
const mockProvider = {
  name: 'openai',
  capabilities: { text: true, images: true, videos: false, audio: false },
  generate: mockGenerate,
  streamGenerate: mockStreamGenerate,
  getModelCapabilities: vi.fn(() => ({
    supportsTools: true,
    supportsVision: true,
    supportsJSON: true,
    supportsJSONSchema: true,
    maxTokens: 128000,
    maxOutputTokens: 16384,
  })),
};

vi.mock('@/core/createProvider.js', () => ({
  createProvider: vi.fn(() => mockProvider),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeTextResponse(text: string) {
  return {
    id: `resp_${Date.now()}`,
    object: 'response',
    created_at: Date.now(),
    status: 'completed',
    model: 'gpt-4',
    output: [
      {
        type: 'message',
        id: `msg_${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: [
          {
            type: ContentType.OUTPUT_TEXT,
            text,
            annotations: [],
          },
        ],
      },
    ],
    output_text: text,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  };
}

function makeValidationResponse(isComplete: boolean, score: number, explanation: string) {
  const json = JSON.stringify({ isComplete, completionScore: score, explanation });
  return makeTextResponse(json);
}

function createSimpleRoutine(overrides?: Partial<RoutineDefinition>): RoutineDefinition {
  return createRoutineDefinition({
    name: 'Test Routine',
    description: 'A test routine',
    tasks: [
      {
        name: 'Task 1',
        description: 'First task',
        expectedOutput: 'Result of task 1',
      },
    ],
    ...overrides,
  });
}

function createMultiTaskRoutine(): RoutineDefinition {
  return createRoutineDefinition({
    name: 'Multi-Task Routine',
    description: 'A routine with multiple tasks',
    tasks: [
      {
        name: 'Task A',
        description: 'First task',
      },
      {
        name: 'Task B',
        description: 'Second task, depends on A',
        dependsOn: ['Task A'],
      },
      {
        name: 'Task C',
        description: 'Third task, depends on B',
        dependsOn: ['Task B'],
      },
    ],
  });
}

function createRoutineWithValidation(): RoutineDefinition {
  return createRoutineDefinition({
    name: 'Validated Routine',
    description: 'A routine with validation criteria',
    tasks: [
      {
        name: 'Validated Task',
        description: 'Task with criteria',
        validation: {
          completionCriteria: [
            'Output contains at least 3 items',
            'All items have names',
          ],
          minCompletionScore: 80,
          skipReflection: false,
        },
      },
    ],
  });
}

function defaultOptions(definition: RoutineDefinition): ExecuteRoutineOptions {
  return {
    definition,
    connector: 'test-openai',
    model: 'gpt-4',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('executeRoutine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Connector.clear();

    Connector.create({
      name: 'test-openai',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'test-key' },
    });
  });

  afterEach(() => {
    Connector.clear();
  });

  // ==========================================================================
  // Basic Execution
  // ==========================================================================

  describe('basic execution', () => {
    it('should execute a single-task routine successfully', async () => {
      const routine = createSimpleRoutine();

      // Agent.run() returns text, then validation auto-passes (no criteria)
      mockGenerate.mockResolvedValue(makeTextResponse('Task completed successfully'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.progress).toBe(100);
      expect(execution.completedAt).toBeDefined();
      expect(execution.plan.tasks[0]!.status).toBe('completed');
      expect(execution.plan.tasks[0]!.result?.success).toBe(true);
    });

    it('should set execution to running and record startedAt', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const before = Date.now();
      const execution = await executeRoutine(defaultOptions(routine));
      const after = Date.now();

      expect(execution.startedAt).toBeGreaterThanOrEqual(before);
      expect(execution.startedAt).toBeLessThanOrEqual(after);
    });

    it('should return a valid RoutineExecution with correct routineId', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.id).toMatch(/^rexec-/);
      expect(execution.routineId).toBe(routine.id);
    });
  });

  // ==========================================================================
  // Task Ordering & Dependencies
  // ==========================================================================

  describe('task ordering and dependencies', () => {
    it('should execute tasks in dependency order', async () => {
      const routine = createMultiTaskRoutine();
      const executionOrder: string[] = [];

      // Track which task prompt is being processed
      mockGenerate.mockImplementation(async (opts: { input: Array<{ role?: string; content?: Array<{ text?: string }> }> }) => {
        // Extract task name from the LAST user message (the task prompt),
        // not the full input which includes plan overview with all task names
        const userMessages = opts.input.filter((m: { role?: string }) => m.role === 'user');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const lastUserText = JSON.stringify(lastUserMsg?.content ?? []);
        if (lastUserText.includes('Current Task: Task A')) executionOrder.push('A');
        else if (lastUserText.includes('Current Task: Task B')) executionOrder.push('B');
        else if (lastUserText.includes('Current Task: Task C')) executionOrder.push('C');
        return makeTextResponse('Done');
      });

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(executionOrder).toEqual(['A', 'B', 'C']);
    });

    it('should not execute a task until its dependencies are completed', async () => {
      const routine = createMultiTaskRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      // All tasks should be completed
      expect(execution.plan.tasks[0]!.status).toBe('completed');
      expect(execution.plan.tasks[1]!.status).toBe('completed');
      expect(execution.plan.tasks[2]!.status).toBe('completed');

      // Task A should have started before Task B
      expect(execution.plan.tasks[0]!.startedAt).toBeLessThanOrEqual(
        execution.plan.tasks[1]!.startedAt!
      );
      // Task B should have started before Task C
      expect(execution.plan.tasks[1]!.startedAt).toBeLessThanOrEqual(
        execution.plan.tasks[2]!.startedAt!
      );
    });

    it('should handle independent tasks (no dependencies)', async () => {
      const routine = createRoutineDefinition({
        name: 'Independent Tasks',
        description: 'Tasks with no dependencies',
        tasks: [
          { name: 'Task X', description: 'Independent task X' },
          { name: 'Task Y', description: 'Independent task Y' },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks.every((t) => t.status === 'completed')).toBe(true);
    });
  });

  // ==========================================================================
  // Conversation Clearing Between Tasks
  // ==========================================================================

  describe('conversation clearing', () => {
    it('should call agent.run multiple times for multi-task routines', async () => {
      const routine = createMultiTaskRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine(defaultOptions(routine));

      // 3 tasks = 3 agent.run calls (each calls generate at least once)
      // The exact number depends on the agent loop, but should be >= 3
      expect(mockGenerate).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // Validation
  // ==========================================================================

  describe('task validation', () => {
    it('should auto-pass tasks with no completion criteria', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks[0]!.result?.validationScore).toBe(100);
      // Should only call generate once (no validation call)
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('should auto-pass tasks with skipReflection=true', async () => {
      const routine = createRoutineDefinition({
        name: 'Skip Validation',
        description: 'Test',
        tasks: [
          {
            name: 'Task',
            description: 'Task with skipped validation',
            validation: {
              completionCriteria: ['Something'],
              skipReflection: true,
            },
          },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks[0]!.result?.validationScore).toBe(100);
      // Only one generate call (task run, no validation)
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('should validate tasks with completion criteria via runDirect', async () => {
      const routine = createRoutineWithValidation();

      // First call: agent.run() for the task
      // Second call: agent.runDirect() for validation
      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Here are 3 items: Apple, Banana, Cherry'))
        .mockResolvedValueOnce(
          makeValidationResponse(true, 95, 'All criteria met')
        );

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks[0]!.result?.validationScore).toBe(95);
      expect(execution.plan.tasks[0]!.result?.validationExplanation).toBe('All criteria met');
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('should fail task when validation score is below minCompletionScore', async () => {
      const routine = createRoutineDefinition({
        name: 'Low Score',
        description: 'Test',
        tasks: [
          {
            name: 'Low Score Task',
            description: 'Task that will get low validation score',
            maxAttempts: 1,
            validation: {
              completionCriteria: ['Must have 10 items'],
              minCompletionScore: 80,
              skipReflection: false,
            },
          },
        ],
      });

      // Task execution + validation (low score) — only 1 attempt allowed
      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Only 2 items'))
        .mockResolvedValueOnce(
          makeValidationResponse(false, 30, 'Only 2 of 10 items found')
        );

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.plan.tasks[0]!.status).toBe('failed');
      expect(execution.plan.tasks[0]!.result?.validationScore).toBe(30);
    });

    it('should treat isComplete=true but score below threshold as failed', async () => {
      const routine = createRoutineDefinition({
        name: 'Score Below Threshold',
        description: 'Test',
        tasks: [
          {
            name: 'Marginal Task',
            description: 'Task with marginal score',
            maxAttempts: 1,
            validation: {
              completionCriteria: ['Something'],
              minCompletionScore: 90,
              skipReflection: false,
            },
          },
        ],
      });

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Partial result'))
        .mockResolvedValueOnce(
          makeValidationResponse(true, 70, 'Partially complete')
        );

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.plan.tasks[0]!.result?.validationScore).toBe(70);
    });

    it('should handle validation response that cannot be parsed as JSON', async () => {
      const routine = createRoutineDefinition({
        name: 'Bad Validation',
        description: 'Test',
        tasks: [
          {
            name: 'Bad Validation Task',
            description: 'Task with unparseable validation',
            maxAttempts: 1,
            validation: {
              completionCriteria: ['Something'],
              skipReflection: false,
            },
          },
        ],
      });

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Done'))
        .mockResolvedValueOnce(makeTextResponse('I think the task was completed well.'));

      const execution = await executeRoutine(defaultOptions(routine));

      // Should fail because validation response couldn't be parsed
      expect(execution.status).toBe('failed');
      expect(execution.plan.tasks[0]!.status).toBe('failed');
    });

    it('should pass ValidationContext (not just responseText) to the validation prompt', async () => {
      const routine = createRoutineWithValidation();
      const capturedContext: unknown[] = [];
      const customValidation = vi.fn((_task: unknown, ctx: unknown) => {
        capturedContext.push(ctx);
        return 'Return JSON: { "isComplete": true, "completionScore": 100, "explanation": "ok" }';
      });

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Agent did stuff'))
        .mockResolvedValueOnce(makeValidationResponse(true, 100, 'ok'));

      await executeRoutine({
        ...defaultOptions(routine),
        prompts: { validation: customValidation },
      });

      expect(capturedContext).toHaveLength(1);
      const ctx = capturedContext[0] as Record<string, unknown>;
      expect(ctx.responseText).toBe('Agent did stuff');
      expect(ctx).toHaveProperty('inContextMemory');
      expect(ctx).toHaveProperty('workingMemoryIndex');
      expect(ctx).toHaveProperty('toolCallLog');
      // toolCallLog should be a string (either tool call details or "(no tool calls)")
      expect(typeof ctx.toolCallLog).toBe('string');
    });
  });

  // ==========================================================================
  // Retry Logic
  // ==========================================================================

  describe('retry logic', () => {
    it('should retry a task up to maxAttempts when validation fails', async () => {
      const routine = createRoutineDefinition({
        name: 'Retry Routine',
        description: 'Test',
        tasks: [
          {
            name: 'Retry Task',
            description: 'Task that needs retrying',
            maxAttempts: 3,
            validation: {
              completionCriteria: ['Must succeed'],
              minCompletionScore: 80,
              skipReflection: false,
            },
          },
        ],
      });

      // Attempt 1: task run + validation fail
      // Attempt 2: task run + validation fail
      // Attempt 3: task run + validation pass
      mockGenerate
        // Attempt 1
        .mockResolvedValueOnce(makeTextResponse('First try'))
        .mockResolvedValueOnce(makeValidationResponse(false, 40, 'Not enough'))
        // Attempt 2
        .mockResolvedValueOnce(makeTextResponse('Second try'))
        .mockResolvedValueOnce(makeValidationResponse(false, 60, 'Getting closer'))
        // Attempt 3
        .mockResolvedValueOnce(makeTextResponse('Third try'))
        .mockResolvedValueOnce(makeValidationResponse(true, 90, 'All good'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks[0]!.status).toBe('completed');
      expect(execution.plan.tasks[0]!.attempts).toBe(3);
      expect(execution.plan.tasks[0]!.result?.validationScore).toBe(90);
    });

    it('should fail after exhausting maxAttempts', async () => {
      const routine = createRoutineDefinition({
        name: 'Exhaust Retries',
        description: 'Test',
        tasks: [
          {
            name: 'Failing Task',
            description: 'Task that keeps failing',
            maxAttempts: 2,
            validation: {
              completionCriteria: ['Impossible criterion'],
              minCompletionScore: 80,
              skipReflection: false,
            },
          },
        ],
      });

      mockGenerate
        // Attempt 1
        .mockResolvedValueOnce(makeTextResponse('Try 1'))
        .mockResolvedValueOnce(makeValidationResponse(false, 20, 'Nope'))
        // Attempt 2
        .mockResolvedValueOnce(makeTextResponse('Try 2'))
        .mockResolvedValueOnce(makeValidationResponse(false, 25, 'Still nope'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.plan.tasks[0]!.status).toBe('failed');
      expect(execution.plan.tasks[0]!.attempts).toBe(2);
    });

    it('should retry on agent.run() throwing an error', async () => {
      const routine = createRoutineDefinition({
        name: 'Error Retry',
        description: 'Test',
        tasks: [
          {
            name: 'Error Task',
            description: 'Task that errors first',
            maxAttempts: 2,
          },
        ],
      });

      mockGenerate
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce(makeTextResponse('Succeeded on retry'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks[0]!.attempts).toBe(2);
    });

    it('should fail after all retries with errors', async () => {
      const routine = createRoutineDefinition({
        name: 'All Errors',
        description: 'Test',
        tasks: [
          {
            name: 'Always Error',
            description: 'Task that always errors',
            maxAttempts: 2,
          },
        ],
      });

      // Both attempts fail with errors
      mockGenerate
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.plan.tasks[0]!.status).toBe('failed');
      expect(execution.plan.tasks[0]!.attempts).toBe(2);
      expect(execution.plan.tasks[0]!.result?.error).toBe('Error 2');
    });
  });

  // ==========================================================================
  // Failure Modes
  // ==========================================================================

  describe('failure modes', () => {
    it('should stop on first failure with fail-fast mode (default)', async () => {
      const routine = createRoutineDefinition({
        name: 'Fail-Fast Routine',
        description: 'Test',
        tasks: [
          { name: 'Task A', description: 'Will succeed' },
          { name: 'Task B', description: 'Will fail', dependsOn: ['Task A'], maxAttempts: 1 },
          { name: 'Task C', description: 'Should not run', dependsOn: ['Task B'] },
        ],
        concurrency: { maxParallelTasks: 1, strategy: 'fifo', failureMode: 'fail-fast' },
      });

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('A done'))
        .mockRejectedValueOnce(new Error('B failed'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.plan.tasks[0]!.status).toBe('completed');
      expect(execution.plan.tasks[1]!.status).toBe('failed');
      expect(execution.plan.tasks[2]!.status).toBe('pending'); // Never started
      expect(execution.error).toContain('Task B');
    });

    it('should continue past failures with continue mode', async () => {
      // Both tasks are independent (no deps). With continue mode, Task B runs after A fails.
      const routine = createRoutineDefinition({
        name: 'Continue Routine',
        description: 'Test',
        tasks: [
          { name: 'Task A', description: 'Will fail', maxAttempts: 1 },
          { name: 'Task B', description: 'Will succeed (no deps)' },
        ],
        concurrency: { maxParallelTasks: 1, strategy: 'fifo', failureMode: 'continue' },
      });

      mockGenerate
        .mockRejectedValueOnce(new Error('A failed'))
        .mockResolvedValueOnce(makeTextResponse('B done'));

      const execution = await executeRoutine(defaultOptions(routine));

      // Not fully completed because Task A failed, but Task B ran
      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Not all tasks completed successfully');
      expect(execution.plan.tasks[0]!.status).toBe('failed');
      expect(execution.plan.tasks[1]!.status).toBe('completed');
    });

    it('should detect blocked tasks (deadlock) and fail', async () => {
      const routine = createRoutineDefinition({
        name: 'Deadlock Routine',
        description: 'Test',
        tasks: [
          { name: 'Task A', description: 'Will fail', maxAttempts: 1 },
          { name: 'Task B', description: 'Depends on A', dependsOn: ['Task A'] },
        ],
        concurrency: { maxParallelTasks: 1, strategy: 'fifo', failureMode: 'continue' },
      });

      mockGenerate.mockRejectedValueOnce(new Error('A failed'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      // Task B is still pending (blocked), Task A failed
      expect(execution.plan.tasks[0]!.status).toBe('failed');
      expect(execution.plan.tasks[1]!.status).toBe('pending');
      expect(execution.error).toContain('blocked');
    });
  });

  // ==========================================================================
  // Callbacks
  // ==========================================================================

  describe('callbacks', () => {
    it('should call onTaskComplete for each successful task', async () => {
      const routine = createMultiTaskRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const completedTasks: string[] = [];
      const execution = await executeRoutine({
        ...defaultOptions(routine),
        onTaskComplete: (task) => {
          completedTasks.push(task.name);
        },
      });

      expect(execution.status).toBe('completed');
      expect(completedTasks).toEqual(['Task A', 'Task B', 'Task C']);
    });

    it('should call onTaskFailed for failed tasks', async () => {
      const routine = createSimpleRoutine({
        tasks: [
          {
            name: 'Failing Task',
            description: 'Will fail',
            maxAttempts: 1,
          },
        ],
      } as Partial<RoutineDefinition>);

      mockGenerate.mockRejectedValue(new Error('Task error'));

      const failedTasks: string[] = [];
      const execution = await executeRoutine({
        ...defaultOptions(routine),
        onTaskFailed: (task) => {
          failedTasks.push(task.name);
        },
      });

      expect(execution.status).toBe('failed');
      expect(failedTasks).toEqual(['Failing Task']);
    });

    it('should pass current execution state to callbacks', async () => {
      const routine = createRoutineDefinition({
        name: 'Callback State',
        description: 'Test',
        tasks: [
          { name: 'Task 1', description: 'First' },
          { name: 'Task 2', description: 'Second', dependsOn: ['Task 1'] },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const progressSnapshots: number[] = [];
      await executeRoutine({
        ...defaultOptions(routine),
        onTaskComplete: (_task, exec) => {
          progressSnapshots.push(exec.progress);
        },
      });

      expect(progressSnapshots).toEqual([50, 100]);
    });
  });

  // ==========================================================================
  // Required Tools & Plugins
  // ==========================================================================

  describe('required tools validation', () => {
    it('should fail if required tools are missing', async () => {
      const routine = createRoutineDefinition({
        name: 'Missing Tools',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Needs tools' }],
        requiredTools: ['nonexistent_tool'],
      });

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Missing required tools');
      expect(execution.error).toContain('nonexistent_tool');
    });

    it('should pass if required tools are provided', async () => {
      const myTool: ToolFunction = {
        definition: {
          type: 'function',
          function: {
            name: 'my_tool',
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        execute: async () => ({ result: 'ok' }),
      };

      const routine = createRoutineDefinition({
        name: 'Has Tools',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Uses my_tool' }],
        requiredTools: ['my_tool'],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [myTool],
      });

      expect(execution.status).toBe('completed');
    });
  });

  describe('required plugins validation', () => {
    it('should pass for working_memory and in_context_memory (always enabled)', async () => {
      const routine = createRoutineDefinition({
        name: 'Plugin Check',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Needs plugins' }],
        requiredPlugins: ['working_memory', 'in_context_memory'],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
    });

    it('should fail if required plugin is not available', async () => {
      const routine = createRoutineDefinition({
        name: 'Missing Plugin',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Needs plugin' }],
        requiredPlugins: ['nonexistent_plugin'],
      });

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Missing required plugins');
      expect(execution.error).toContain('nonexistent_plugin');
    });
  });

  // ==========================================================================
  // Custom Prompts
  // ==========================================================================

  describe('custom prompts', () => {
    it('should use custom system prompt builder', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const customSystem = vi.fn(
        (def: RoutineDefinition) => `Custom system for ${def.name}`
      );

      await executeRoutine({
        ...defaultOptions(routine),
        prompts: { system: customSystem },
      });

      expect(customSystem).toHaveBeenCalledWith(routine);
    });

    it('should use custom task prompt builder', async () => {
      const routine = createSimpleRoutine();
      const customTaskPrompt = vi.fn(() => 'Custom task prompt');

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine({
        ...defaultOptions(routine),
        prompts: { task: customTaskPrompt },
      });

      expect(customTaskPrompt).toHaveBeenCalled();
      const calledTask = customTaskPrompt.mock.calls[0]![0];
      expect(calledTask.name).toBe('Task 1');
    });

    it('should use custom validation prompt builder', async () => {
      const routine = createRoutineWithValidation();
      const customValidation = vi.fn(
        () => 'Return JSON: { "isComplete": true, "completionScore": 100, "explanation": "ok" }'
      );

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Task result'))
        .mockResolvedValueOnce(
          makeValidationResponse(true, 100, 'ok')
        );

      await executeRoutine({
        ...defaultOptions(routine),
        prompts: { validation: customValidation },
      });

      expect(customValidation).toHaveBeenCalled();
      // Verify the second argument is a ValidationContext object, not a plain string
      const context = customValidation.mock.calls[0]![1];
      expect(context).toHaveProperty('responseText');
      expect(context).toHaveProperty('inContextMemory');
      expect(context).toHaveProperty('workingMemoryIndex');
      expect(context).toHaveProperty('toolCallLog');
      expect(context.responseText).toBe('Task result');
    });
  });

  // ==========================================================================
  // Progress Tracking
  // ==========================================================================

  describe('progress tracking', () => {
    it('should track progress correctly across tasks', async () => {
      const routine = createMultiTaskRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const progressValues: number[] = [];
      const execution = await executeRoutine({
        ...defaultOptions(routine),
        onTaskComplete: (_task, exec) => {
          progressValues.push(exec.progress);
        },
      });

      expect(progressValues).toEqual([33, 67, 100]);
      expect(execution.progress).toBe(100);
    });

    it('should track progress correctly when a task fails', async () => {
      const routine = createRoutineDefinition({
        name: 'Partial Progress',
        description: 'Test',
        tasks: [
          { name: 'Task A', description: 'Will succeed' },
          { name: 'Task B', description: 'Will fail', dependsOn: ['Task A'], maxAttempts: 1 },
        ],
      });

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('A done'))
        .mockRejectedValueOnce(new Error('B failed'));

      const execution = await executeRoutine(defaultOptions(routine));

      // Both tasks are terminal (completed + failed), so progress = 100
      // (getRoutineProgress counts terminal statuses)
      expect(execution.progress).toBe(100);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty task list', async () => {
      const routine = createRoutineDefinition({
        name: 'Empty Routine',
        description: 'No tasks',
        tasks: [],
      });

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.progress).toBe(100);
    });

    it('should handle routine with instructions', async () => {
      const routine = createRoutineDefinition({
        name: 'Instructed Routine',
        description: 'Test',
        instructions: 'Always respond in JSON format.',
        tasks: [{ name: 'Task', description: 'Do something' }],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
    });

    it('should handle task with suggested tools in prompt', async () => {
      const routine = createRoutineDefinition({
        name: 'Suggested Tools',
        description: 'Test',
        tasks: [
          {
            name: 'Tool Task',
            description: 'Task suggesting tools',
            suggestedTools: ['read_file', 'write_file'],
          },
        ],
      });

      let capturedInput = '';
      mockGenerate.mockImplementation(async (opts: { input: unknown }) => {
        capturedInput = JSON.stringify(opts.input);
        return makeTextResponse('Done');
      });

      await executeRoutine(defaultOptions(routine));

      expect(capturedInput).toContain('read_file');
      expect(capturedInput).toContain('write_file');
    });

    it('should handle task with expectedOutput in prompt', async () => {
      const routine = createRoutineDefinition({
        name: 'Expected Output',
        description: 'Test',
        tasks: [
          {
            name: 'Output Task',
            description: 'Task with expected output',
            expectedOutput: 'A list of 3 items',
          },
        ],
      });

      let capturedInput = '';
      mockGenerate.mockImplementation(async (opts: { input: unknown }) => {
        capturedInput = JSON.stringify(opts.input);
        return makeTextResponse('Done');
      });

      await executeRoutine(defaultOptions(routine));

      expect(capturedInput).toContain('A list of 3 items');
    });

    it('should destroy agent even if execution fails with an exception', async () => {
      const routine = createSimpleRoutine();

      // Make the first generate throw a non-retryable error
      // Task has 3 maxAttempts by default, so we need 3 failures
      mockGenerate
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      // Agent should have been destroyed (no leaked resources)
      // We can't directly test agent.isDestroyed, but the function should complete without hanging
    });

    it('should set lastUpdatedAt throughout execution', async () => {
      const routine = createMultiTaskRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.lastUpdatedAt).toBeGreaterThan(0);
      expect(execution.completedAt).toBeDefined();
      expect(execution.lastUpdatedAt).toBeGreaterThanOrEqual(execution.completedAt!);
    });
  });

  // ==========================================================================
  // Task Status Transitions
  // ==========================================================================

  describe('task status transitions', () => {
    it('should transition: pending -> in_progress -> completed', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      const task = execution.plan.tasks[0]!;
      expect(task.status).toBe('completed');
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
      expect(task.attempts).toBe(1);
    });

    it('should transition: pending -> in_progress -> failed', async () => {
      const routine = createRoutineDefinition({
        name: 'Fail Transition',
        description: 'Test',
        tasks: [
          { name: 'Failing', description: 'Will fail', maxAttempts: 1 },
        ],
      });

      mockGenerate.mockRejectedValue(new Error('Error'));

      const execution = await executeRoutine(defaultOptions(routine));

      const task = execution.plan.tasks[0]!;
      expect(task.status).toBe('failed');
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
      expect(task.attempts).toBe(1);
    });

    it('should increment attempts on each retry', async () => {
      const routine = createRoutineDefinition({
        name: 'Attempt Counter',
        description: 'Test',
        tasks: [
          {
            name: 'Retry Task',
            description: 'Retries twice',
            maxAttempts: 3,
            validation: {
              completionCriteria: ['Must pass'],
              minCompletionScore: 80,
              skipReflection: false,
            },
          },
        ],
      });

      mockGenerate
        .mockResolvedValueOnce(makeTextResponse('Try 1'))
        .mockResolvedValueOnce(makeValidationResponse(false, 30, 'Nope'))
        .mockResolvedValueOnce(makeTextResponse('Try 2'))
        .mockResolvedValueOnce(makeValidationResponse(true, 90, 'Yes'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.plan.tasks[0]!.attempts).toBe(2);
      expect(execution.plan.tasks[0]!.status).toBe('completed');
    });
  });

  // ==========================================================================
  // Execution Metadata
  // ==========================================================================

  describe('execution metadata', () => {
    it('should set execution.error on failure', async () => {
      const routine = createRoutineDefinition({
        name: 'Error Message',
        description: 'Test',
        tasks: [{ name: 'Fail', description: 'Fails', maxAttempts: 1 }],
      });

      mockGenerate.mockRejectedValue(new Error('Something broke'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.error).toBeDefined();
      expect(execution.error).toContain('Fail');
    });

    it('should not set execution.error on success', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.error).toBeUndefined();
    });

    it('should preserve task results with output', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('The answer is 42'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.plan.tasks[0]!.result?.output).toBe('The answer is 42');
    });
  });

  // ==========================================================================
  // Output Contract Injection
  // ==========================================================================

  describe('output contract injection', () => {
    /**
     * Helper to extract the full serialized input from a mockGenerate call.
     * We stringify the entire input to search for expected text fragments.
     */
    function getSerializedInputFromCall(callIndex: number): string {
      const opts = mockGenerate.mock.calls[callIndex]![0];
      return JSON.stringify(opts);
    }

    it('should inject output storage instructions when downstream task uses source.task', async () => {
      const routine = createRoutineDefinition({
        name: 'Output Contract Test',
        description: 'Test output contract injection',
        tasks: [
          {
            name: 'Task A',
            description: 'Produce items',
          },
          {
            name: 'Task B',
            description: 'Process each item',
            dependsOn: ['Task A'],
            controlFlow: {
              type: 'map',
              source: { task: 'Task A' },
              tasks: { description: 'Process item' },
            },
          },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine(defaultOptions(routine));

      // Task A's prompt (call 0) should contain output storage instructions
      const taskAInput = getSerializedInputFromCall(0);
      expect(taskAInput).toContain('### Output Storage');
      expect(taskAInput).toContain('context_set(\\"__task_output_Task A\\"');
      expect(taskAInput).toContain('Task B');

      // Task B's prompt (call 1) should NOT contain output storage (no downstream consumers)
      const taskBInput = getSerializedInputFromCall(1);
      expect(taskBInput).not.toContain('### Output Storage');
    });

    it('should NOT inject output storage when downstream task uses string source', async () => {
      const routine = createRoutineDefinition({
        name: 'String Source Test',
        description: 'Test string source does not trigger output contract',
        tasks: [
          {
            name: 'Task A',
            description: 'Produce items',
          },
          {
            name: 'Task B',
            description: 'Process each item from key',
            dependsOn: ['Task A'],
            controlFlow: {
              type: 'map',
              source: 'items',
              tasks: { description: 'Process item' },
            },
          },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine(defaultOptions(routine));

      // Task A's prompt should NOT contain output storage (string source = key reference)
      const taskAInput = getSerializedInputFromCall(0);
      expect(taskAInput).not.toContain('### Output Storage');
    });

    it('should inject output storage for multiple downstream consumers', async () => {
      const routine = createRoutineDefinition({
        name: 'Multiple Consumers Test',
        description: 'Test multiple downstream tasks referencing same source',
        tasks: [
          {
            name: 'Task A',
            description: 'Produce items',
          },
          {
            name: 'Task B',
            description: 'Map over items',
            dependsOn: ['Task A'],
            controlFlow: {
              type: 'map',
              source: { task: 'Task A' },
              tasks: { description: 'Process item' },
            },
          },
          {
            name: 'Task C',
            description: 'Fold over items',
            dependsOn: ['Task A'],
            controlFlow: {
              type: 'fold',
              source: { task: 'Task A' },
              tasks: { description: 'Accumulate item' },
              initialValue: '[]',
            },
          },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine(defaultOptions(routine));

      // Task A's prompt should contain output storage for BOTH Task B and Task C
      const taskAInput = getSerializedInputFromCall(0);
      expect(taskAInput).toContain('### Output Storage');
      expect(taskAInput).toContain('Task B');
      expect(taskAInput).toContain('Task C');
      // Should mention both map and fold
      expect(taskAInput).toContain('map over your results');
      expect(taskAInput).toContain('fold over your results');
    });

    it('should NOT inject output storage for until flow type', async () => {
      const routine = createRoutineDefinition({
        name: 'Until Flow Test',
        description: 'Test until flow does not trigger output contract',
        tasks: [
          {
            name: 'Task A',
            description: 'Produce items',
          },
          {
            name: 'Task B',
            description: 'Repeat until done',
            dependsOn: ['Task A'],
            controlFlow: {
              type: 'until',
              tasks: { description: 'Check condition' },
              condition: { type: 'maxIterations', maxIterations: 3 },
            },
          },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine(defaultOptions(routine));

      // Task A's prompt should NOT contain output storage (until has no source)
      const taskAInput = getSerializedInputFromCall(0);
      expect(taskAInput).not.toContain('### Output Storage');
    });
  });

  // ==========================================================================
  // Deterministic Pre-Steps and Post-Steps
  // ==========================================================================

  describe('deterministic pre-steps', () => {
    function makeTool(name: string, result: unknown): ToolFunction {
      return {
        definition: {
          type: 'function',
          function: { name, description: `Test tool ${name}`, parameters: { type: 'object', properties: {} } },
        },
        execute: vi.fn(async () => result),
      };
    }

    it('should execute preSteps before the task loop', async () => {
      const executionOrder: string[] = [];
      const fetchTool = makeTool('fetch_data', { data: [1, 2, 3] });
      (fetchTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        executionOrder.push('prestep:fetch_data');
        return { data: [1, 2, 3] };
      });

      mockGenerate.mockImplementation(async () => {
        executionOrder.push('task');
        return makeTextResponse('Done');
      });

      const routine = createRoutineDefinition({
        name: 'With PreSteps',
        description: 'Test',
        tasks: [{ name: 'Process', description: 'Process data' }],
        preSteps: [
          { name: 'Fetch Data', toolName: 'fetch_data', args: {} },
        ],
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [fetchTool],
      });

      expect(execution.status).toBe('completed');
      expect(executionOrder).toEqual(['prestep:fetch_data', 'task']);
      expect(fetchTool.execute).toHaveBeenCalledTimes(1);
    });

    it('should resolve {{param.X}} templates in preStep args', async () => {
      const fetchTool = makeTool('fetch_data', { ok: true });

      const routine = createRoutineDefinition({
        name: 'Parameterized PreStep',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Do work' }],
        parameters: [{ name: 'url', description: 'API URL', required: true }],
        preSteps: [
          { name: 'Fetch', toolName: 'fetch_data', args: { url: '{{param.url}}', method: 'GET' } },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine({
        ...defaultOptions(routine),
        tools: [fetchTool],
        inputs: { url: 'https://api.example.com/data' },
      });

      expect(fetchTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://api.example.com/data', method: 'GET' }),
        expect.anything()
      );
    });

    it('should fail routine when preStep fails with default onError (fail)', async () => {
      const failingTool = makeTool('fail_tool', null);
      (failingTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('Connection refused');
      });

      const routine = createRoutineDefinition({
        name: 'Failing PreStep',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Should not run' }],
        preSteps: [
          { name: 'Bad Step', toolName: 'fail_tool', args: {} },
        ],
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [failingTool],
      });

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Pre-step failed');
      expect(execution.error).toContain('Bad Step');
      // Task should never have run
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('should continue when preStep fails with onError=continue', async () => {
      const failingTool = makeTool('fail_tool', null);
      (failingTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('Oops');
      });

      const routine = createRoutineDefinition({
        name: 'Continuing PreStep',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Should still run' }],
        preSteps: [
          { name: 'Optional Step', toolName: 'fail_tool', args: {}, onError: 'continue' },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [failingTool],
      });

      expect(execution.status).toBe('completed');
      expect(mockGenerate).toHaveBeenCalled();
    });

    it('should fail when preStep tool is not registered', async () => {
      const routine = createRoutineDefinition({
        name: 'Missing Tool',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Work' }],
        preSteps: [
          { name: 'Ghost', toolName: 'nonexistent_tool', args: {} },
        ],
      });

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Missing tools required by pre/post steps');
      expect(execution.error).toContain('nonexistent_tool');
    });

    it('should call onStepStarted and onStepComplete callbacks', async () => {
      const fetchTool = makeTool('fetch_data', { ok: true });
      const onStepStarted = vi.fn();
      const onStepComplete = vi.fn();

      const routine = createRoutineDefinition({
        name: 'Callbacks',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Work' }],
        preSteps: [
          { name: 'Fetch', toolName: 'fetch_data', args: {} },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine({
        ...defaultOptions(routine),
        tools: [fetchTool],
        onStepStarted,
        onStepComplete,
      });

      expect(onStepStarted).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Fetch', toolName: 'fetch_data' }),
        'pre', 0, expect.anything()
      );
      expect(onStepComplete).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Fetch' }),
        'pre', 0, expect.objectContaining({ ok: true }), expect.anything()
      );
    });

    it('should execute multiple preSteps in order with {{step.X}} chaining', async () => {
      const stepATool = makeTool('step_a', { token: 'abc123' });
      const stepBTool = makeTool('step_b', { ready: true });

      const routine = createRoutineDefinition({
        name: 'Chained PreSteps',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Work' }],
        preSteps: [
          { name: 'Auth', toolName: 'step_a', args: {} },
          { name: 'Init', toolName: 'step_b', args: { token: '{{step.Auth}}' } },
        ],
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      await executeRoutine({
        ...defaultOptions(routine),
        tools: [stepATool, stepBTool],
      });

      expect(stepBTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ token: '{"token":"abc123"}' }),
        expect.anything()
      );
    });
  });

  describe('deterministic post-steps', () => {
    function makeTool(name: string, result: unknown): ToolFunction {
      return {
        definition: {
          type: 'function',
          function: { name, description: `Test tool ${name}`, parameters: { type: 'object', properties: {} } },
        },
        execute: vi.fn(async () => result),
      };
    }

    it('should execute postSteps after successful completion', async () => {
      const executionOrder: string[] = [];
      const notifyTool = makeTool('notify', { sent: true });
      (notifyTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        executionOrder.push('poststep:notify');
        return { sent: true };
      });

      mockGenerate.mockImplementation(async () => {
        executionOrder.push('task');
        return makeTextResponse('Task result here');
      });

      const routine = createRoutineDefinition({
        name: 'With PostSteps',
        description: 'Test',
        tasks: [{ name: 'Analyze', description: 'Do analysis' }],
        postSteps: [
          { name: 'Notify', toolName: 'notify', args: { body: '{{result.Analyze}}' } },
        ],
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [notifyTool],
      });

      expect(execution.status).toBe('completed');
      expect(executionOrder).toEqual(['task', 'poststep:notify']);
      expect(notifyTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Task result here' }),
        expect.anything()
      );
    });

    it('should skip postSteps when routine fails (default on-success trigger)', async () => {
      const notifyTool = makeTool('notify', { sent: true });

      // Make the task fail by exhausting attempts with a permanent error
      mockGenerate.mockRejectedValue(
        new (await import('@/domain/errors/AIErrors.js')).ProviderAuthError('Bad key')
      );

      const routine = createRoutineDefinition({
        name: 'Failing Routine',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Will fail' }],
        postSteps: [
          { name: 'Notify', toolName: 'notify', args: {} },
        ],
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [notifyTool],
      });

      expect(execution.status).toBe('failed');
      expect(notifyTool.execute).not.toHaveBeenCalled();
    });

    it('should run postSteps on failure when postStepsTrigger=always', async () => {
      const cleanupTool = makeTool('cleanup', { cleaned: true });

      mockGenerate.mockRejectedValue(
        new (await import('@/domain/errors/AIErrors.js')).ProviderAuthError('Bad key')
      );

      const routine = createRoutineDefinition({
        name: 'Always PostSteps',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Will fail' }],
        postSteps: [
          { name: 'Cleanup', toolName: 'cleanup', args: {} },
        ],
        postStepsTrigger: 'always',
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [cleanupTool],
      });

      expect(execution.status).toBe('failed');
      expect(cleanupTool.execute).toHaveBeenCalledTimes(1);
    });

    it('should not downgrade status when postStep fails with default onError (continue)', async () => {
      const failingTool = makeTool('bad_notify', null);
      (failingTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('SMTP down');
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const routine = createRoutineDefinition({
        name: 'PostStep Fail Continue',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Work' }],
        postSteps: [
          { name: 'Bad Notify', toolName: 'bad_notify', args: {} },
        ],
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [failingTool],
      });

      // Status should remain completed because onError defaults to 'continue' for postSteps
      expect(execution.status).toBe('completed');
    });

    it('should downgrade status when postStep fails with onError=fail', async () => {
      const failingTool = makeTool('critical_save', null);
      (failingTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('DB down');
      });

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const routine = createRoutineDefinition({
        name: 'PostStep Fail Hard',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Work' }],
        postSteps: [
          { name: 'Critical Save', toolName: 'critical_save', args: {}, onError: 'fail' },
        ],
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [failingTool],
      });

      expect(execution.status).toBe('failed');
      expect(execution.error).toContain('Post-step failed');
    });

    it('should append post-step error to existing error when routine already failed and postStepsTrigger=always', async () => {
      const failingPostTool = makeTool('fail_save', null);
      (failingPostTool.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error('DB down');
      });

      mockGenerate.mockRejectedValue(
        new (await import('@/domain/errors/AIErrors.js')).ProviderAuthError('Bad key')
      );

      const routine = createRoutineDefinition({
        name: 'Both Fail',
        description: 'Test',
        tasks: [{ name: 'Task', description: 'Will fail' }],
        postSteps: [
          { name: 'Save', toolName: 'fail_save', args: {}, onError: 'fail' },
        ],
        postStepsTrigger: 'always',
      });

      const execution = await executeRoutine({
        ...defaultOptions(routine),
        tools: [failingPostTool],
      });

      expect(execution.status).toBe('failed');
      // Original task error should be preserved
      expect(execution.error).toContain('Task "Task" failed');
      // Post-step error should be appended
      expect(execution.error).toContain('Post-step failed');
      expect(execution.error).toContain('Save');
    });
  });

  describe('backward compatibility', () => {
    it('should work identically without preSteps or postSteps', async () => {
      const routine = createSimpleRoutine();
      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const execution = await executeRoutine(defaultOptions(routine));

      expect(execution.status).toBe('completed');
      expect(execution.plan.tasks[0]!.status).toBe('completed');
    });
  });
});
