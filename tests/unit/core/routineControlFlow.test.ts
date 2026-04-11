/**
 * Routine Control Flow Unit Tests
 *
 * Tests for resolveTemplates, readMemoryValue, validateAndResolveInputs,
 * resolveSubRoutine, resolveFlowSource, executeControlFlow (map, fold, until).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveTemplates,
  resolveTaskTemplates,
  validateAndResolveInputs,
  readMemoryValue,
  resolveSubRoutine,
  resolveFlowSource,
  resolveStepArgs,
  executeControlFlow,
  ROUTINE_KEYS,
} from '@/core/routineControlFlow.js';
import type { Task } from '@/domain/entities/Task.js';
import type { RoutineParameter, RoutineExecution } from '@/domain/entities/Routine.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import { createTask } from '@/domain/entities/Task.js';
import type { InContextMemoryPluginNextGen } from '@/core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';
import type { WorkingMemoryPluginNextGen } from '@/core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';

// ============================================================================
// Mock ICM Plugin
// ============================================================================

function createMockIcm(entries: Record<string, unknown> = {}): InContextMemoryPluginNextGen {
  const store = new Map<string, unknown>(Object.entries(entries));
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, _desc: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn((key: string) => store.delete(key)),
    has: vi.fn((key: string) => store.has(key)),
    list: vi.fn(() => [...store.entries()].map(([key]) => ({ key, description: '', priority: 'normal' as const, updatedAt: Date.now(), showInUI: false }))),
    clear: vi.fn(() => store.clear()),
    // Satisfy the interface enough for our tests
    name: 'in_context_memory',
    getInstructions: vi.fn(() => ''),
    getInstructionsTokenSize: vi.fn(() => 0),
    getContent: vi.fn(() => null),
    getContentTokenSize: vi.fn(() => 0),
    getTools: vi.fn(() => []),
    destroy: vi.fn(),
    isDestroyed: false,
    serialize: vi.fn(() => ({ entries: [] })),
    deserialize: vi.fn(),
  } as unknown as InContextMemoryPluginNextGen;
}

// ============================================================================
// Mock WM Plugin
// ============================================================================

function createMockWm(entries: Record<string, unknown> = {}): WorkingMemoryPluginNextGen {
  const store = new Map<string, unknown>(Object.entries(entries));
  return {
    retrieve: vi.fn(async (key: string) => store.get(key)),
    store: vi.fn(async (key: string, _desc: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    query: vi.fn(async () => ({
      entries: [...store.entries()].map(([key, value]) => ({ key, description: '', value, tier: 'raw' })),
      totalSize: 0,
    })),
    name: 'working_memory',
    getInstructions: vi.fn(() => ''),
    getInstructionsTokenSize: vi.fn(() => 0),
    getContent: vi.fn(() => null),
    getContentTokenSize: vi.fn(() => 0),
    getTools: vi.fn(() => []),
    destroy: vi.fn(),
    isDestroyed: false,
  } as unknown as WorkingMemoryPluginNextGen;
}

// ============================================================================
// resolveTemplates
// ============================================================================

describe('resolveTemplates', () => {
  it('resolves param templates', () => {
    const result = resolveTemplates('Hello {{param.name}}!', { name: 'World' }, null);
    expect(result).toBe('Hello World!');
  });

  it('resolves non-string param values as JSON', () => {
    const result = resolveTemplates('Count: {{param.count}}', { count: 42 }, null);
    expect(result).toBe('Count: 42');
  });

  it('resolves object param values as JSON', () => {
    const result = resolveTemplates('Data: {{param.obj}}', { obj: { a: 1 } }, null);
    expect(result).toBe('Data: {"a":1}');
  });

  it('leaves unresolved param templates as-is', () => {
    const result = resolveTemplates('Hello {{param.missing}}!', {}, null);
    expect(result).toBe('Hello {{param.missing}}!');
  });

  it('resolves map templates from ICM', () => {
    const icm = createMockIcm({
      __map_item: 'apple',
      __map_index: 2,
      __map_total: 5,
    });
    const result = resolveTemplates('Item {{map.item}} at {{map.index}} of {{map.total}}', {}, icm);
    expect(result).toBe('Item apple at 2 of 5');
  });

  it('resolves fold templates from ICM', () => {
    const icm = createMockIcm({ __fold_accumulator: 'running total' });
    const result = resolveTemplates('Acc: {{fold.accumulator}}', {}, icm);
    expect(result).toBe('Acc: running total');
  });

  it('leaves unknown namespaces as-is', () => {
    const result = resolveTemplates('{{unknown.key}}', {}, null);
    expect(result).toBe('{{unknown.key}}');
  });

  it('resolves multiple templates in one string', () => {
    const icm = createMockIcm({ __map_item: 'X' });
    const result = resolveTemplates('{{param.a}} and {{map.item}}', { a: 'Y' }, icm);
    expect(result).toBe('Y and X');
  });
});

// ============================================================================
// resolveTaskTemplates
// ============================================================================

describe('resolveTaskTemplates', () => {
  it('resolves templates in task description and expectedOutput', () => {
    const task = createTask({
      name: 'test',
      description: 'Process {{param.item}}',
      expectedOutput: 'Result for {{param.item}}',
    });
    const resolved = resolveTaskTemplates(task, { item: 'foo' }, null);
    expect(resolved.description).toBe('Process foo');
    expect(resolved.expectedOutput).toBe('Result for foo');
  });

  it('returns same task reference when no templates change', () => {
    const task = createTask({ name: 'test', description: 'No templates here' });
    const resolved = resolveTaskTemplates(task, {}, null);
    expect(resolved).toBe(task);
  });

  it('resolves templates in string source', () => {
    const task = createTask({
      name: 'map-task',
      description: 'Map over data',
      controlFlow: {
        type: 'map',
        source: '{{param.keyName}}',
        tasks: [{ name: 's', description: 's' }],
      },
    });
    const resolved = resolveTaskTemplates(task, { keyName: 'my_items' }, null);
    expect((resolved.controlFlow as any).source).toBe('my_items');
  });

  it('resolves templates in source.task', () => {
    const task = createTask({
      name: 'map-task',
      description: 'Map over data',
      controlFlow: {
        type: 'map',
        source: { task: '{{param.taskName}}' },
        tasks: [{ name: 's', description: 's' }],
      },
    });
    const resolved = resolveTaskTemplates(task, { taskName: 'Research' }, null);
    expect((resolved.controlFlow as any).source.task).toBe('Research');
  });

  it('resolves templates in source.key', () => {
    const task = createTask({
      name: 'map-task',
      description: 'Map over data',
      controlFlow: {
        type: 'map',
        source: { key: '{{param.dataKey}}' },
        tasks: [{ name: 's', description: 's' }],
      },
    });
    const resolved = resolveTaskTemplates(task, { dataKey: 'results' }, null);
    expect((resolved.controlFlow as any).source.key).toBe('results');
  });

  it('returns same task when source templates do not change', () => {
    const task = createTask({
      name: 'map-task',
      description: 'Map over data',
      controlFlow: {
        type: 'map',
        source: { task: 'Research' },
        tasks: [{ name: 's', description: 's' }],
      },
    });
    const resolved = resolveTaskTemplates(task, {}, null);
    expect(resolved).toBe(task);
  });
});

// ============================================================================
// validateAndResolveInputs
// ============================================================================

describe('validateAndResolveInputs', () => {
  it('returns empty object when no parameters', () => {
    expect(validateAndResolveInputs(undefined, undefined)).toEqual({});
  });

  it('passes through inputs when no parameters defined', () => {
    const inputs = { a: 1, b: 2 };
    expect(validateAndResolveInputs(undefined, inputs)).toEqual(inputs);
  });

  it('applies default values for missing optional parameters', () => {
    const params: RoutineParameter[] = [
      { name: 'color', description: 'Color', default: 'blue' },
    ];
    const result = validateAndResolveInputs(params, {});
    expect(result.color).toBe('blue');
  });

  it('does not override provided values with defaults', () => {
    const params: RoutineParameter[] = [
      { name: 'color', description: 'Color', default: 'blue' },
    ];
    const result = validateAndResolveInputs(params, { color: 'red' });
    expect(result.color).toBe('red');
  });

  it('throws for missing required parameters', () => {
    const params: RoutineParameter[] = [
      { name: 'target', description: 'Target', required: true },
    ];
    expect(() => validateAndResolveInputs(params, {})).toThrow('Missing required parameter: "target"');
  });

  it('does not throw when required parameter is provided', () => {
    const params: RoutineParameter[] = [
      { name: 'target', description: 'Target', required: true },
    ];
    expect(() => validateAndResolveInputs(params, { target: 'X' })).not.toThrow();
  });
});

// ============================================================================
// readMemoryValue
// ============================================================================

describe('readMemoryValue', () => {
  it('reads from ICM first', async () => {
    const icm = createMockIcm({ key1: 'from-icm' });
    const wm = createMockWm({ key1: 'from-wm' });
    const value = await readMemoryValue('key1', icm, wm);
    expect(value).toBe('from-icm');
  });

  it('falls back to WM when not in ICM', async () => {
    const icm = createMockIcm({});
    const wm = createMockWm({ key1: 'from-wm' });
    const value = await readMemoryValue('key1', icm, wm);
    expect(value).toBe('from-wm');
  });

  it('returns undefined when not in either', async () => {
    const icm = createMockIcm({});
    const wm = createMockWm({});
    const value = await readMemoryValue('missing', icm, wm);
    expect(value).toBeUndefined();
  });

  it('works with null plugins', async () => {
    const value = await readMemoryValue('key', null, null);
    expect(value).toBeUndefined();
  });
});

// ============================================================================
// resolveSubRoutine
// ============================================================================

describe('resolveSubRoutine', () => {
  it('returns RoutineDefinition as-is', () => {
    const def = createRoutineDefinition({
      name: 'sub',
      description: 'Sub routine',
      tasks: [{ name: 'task1', description: 'Do something' }],
    });
    const result = resolveSubRoutine(def, 'parent');
    expect(result).toBe(def);
  });

  it('wraps TaskInput[] into a RoutineDefinition', () => {
    const tasks = [
      { name: 'step1', description: 'First step' },
      { name: 'step2', description: 'Second step' },
    ];
    const result = resolveSubRoutine(tasks, 'parent-task');
    expect(result.name).toBe('parent-task (sub-routine)');
    expect(result.tasks).toHaveLength(2);
  });
});

// ============================================================================
// resolveFlowSource
// ============================================================================

describe('resolveFlowSource', () => {
  const mockAgent = {} as any; // LLM extraction tests will override

  it('resolves string source from ICM', async () => {
    const icm = createMockIcm({ items: [1, 2, 3] });
    const result = await resolveFlowSource(
      { source: 'items' }, 'Map', mockAgent, undefined, icm, null
    );
    expect('array' in result).toBe(true);
    expect((result as any).array).toEqual([1, 2, 3]);
    expect((result as any).maxIter).toBe(3);
  });

  it('resolves string source from WM fallback', async () => {
    const icm = createMockIcm({});
    const wm = createMockWm({ items: ['a', 'b'] });
    const result = await resolveFlowSource(
      { source: 'items' }, 'Map', mockAgent, undefined, icm, wm
    );
    expect('array' in result).toBe(true);
    expect((result as any).array).toEqual(['a', 'b']);
  });

  it('resolves task source via output contract key', async () => {
    const icm = createMockIcm({ '__task_output_Research': ['x', 'y'] });
    const result = await resolveFlowSource(
      { source: { task: 'Research' } }, 'Map', mockAgent, undefined, icm, null
    );
    expect('array' in result).toBe(true);
    expect((result as any).array).toEqual(['x', 'y']);
  });

  it('falls back to dep_result key for task source', async () => {
    const icm = createMockIcm({ '__dep_result_task-123': [1, 2] });
    const execution = {
      plan: {
        tasks: [
          { id: 'task-123', name: 'Research', status: 'completed', dependsOn: [] },
        ],
      },
    } as unknown as RoutineExecution;

    const result = await resolveFlowSource(
      { source: { task: 'Research' } }, 'Map', mockAgent, execution, icm, null
    );
    expect('array' in result).toBe(true);
    expect((result as any).array).toEqual([1, 2]);
  });

  it('resolves key source with path', async () => {
    const icm = createMockIcm({ data: { items: [1, 2, 3] } });
    const result = await resolveFlowSource(
      { source: { key: 'data', path: 'items' } }, 'Map', mockAgent, undefined, icm, null
    );
    expect('array' in result).toBe(true);
    expect((result as any).array).toEqual([1, 2, 3]);
  });

  it('resolves task source with path', async () => {
    const icm = createMockIcm({ '__task_output_Fetch': { response: { results: ['a', 'b'] } } });
    const result = await resolveFlowSource(
      { source: { task: 'Fetch', path: 'response.results' } }, 'Map', mockAgent, undefined, icm, null
    );
    expect('array' in result).toBe(true);
    expect((result as any).array).toEqual(['a', 'b']);
  });

  it('returns error when source not found', async () => {
    const icm = createMockIcm({});
    const result = await resolveFlowSource(
      { source: 'missing' }, 'Map', mockAgent, undefined, icm, null
    );
    expect('completed' in result).toBe(true);
    expect((result as any).completed).toBe(false);
    expect((result as any).error).toContain('source not found');
  });

  it('returns error for empty source ref', async () => {
    const result = await resolveFlowSource(
      { source: {} }, 'Map', mockAgent, undefined, null, null
    );
    expect('completed' in result).toBe(true);
    expect((result as any).error).toContain('source has no task, key, or string value');
  });

  it('respects maxIterations cap', async () => {
    const icm = createMockIcm({ items: [1, 2, 3, 4, 5] });
    const result = await resolveFlowSource(
      { source: 'items', maxIterations: 2 }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).maxIter).toBe(2);
  });

  it('coerces JSON string to array', async () => {
    const icm = createMockIcm({ data: '[1,2,3]' });
    const result = await resolveFlowSource(
      { source: 'data' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual([1, 2, 3]);
  });

  it('coerces object with .data field to array', async () => {
    const icm = createMockIcm({ stuff: { data: ['a', 'b'] } });
    const result = await resolveFlowSource(
      { source: 'stuff' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual(['a', 'b']);
  });

  it('coerces object with .items field to array', async () => {
    const icm = createMockIcm({ stuff: { items: [1, 2] } });
    const result = await resolveFlowSource(
      { source: 'stuff' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual([1, 2]);
  });

  it('coerces object with .results field to array', async () => {
    const icm = createMockIcm({ stuff: { results: ['x'] } });
    const result = await resolveFlowSource(
      { source: 'stuff' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual(['x']);
  });

  it('coerces JSON string containing object with array field', async () => {
    const icm = createMockIcm({ data: '{"items": [1, 2, 3]}' });
    const result = await resolveFlowSource(
      { source: 'data' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual([1, 2, 3]);
  });

  it('attempts LLM extraction for non-coercible values', async () => {
    const icm = createMockIcm({ data: 'apple, banana, cherry' });
    const agent = {
      runDirect: vi.fn().mockResolvedValue({
        output_text: '["apple", "banana", "cherry"]',
      }),
    } as any;

    const result = await resolveFlowSource(
      { source: 'data' }, 'Map', agent, undefined, icm, null
    );
    expect((result as any).array).toEqual(['apple', 'banana', 'cherry']);
    expect(agent.runDirect).toHaveBeenCalledTimes(1);
  });

  it('handles LLM extraction with markdown fences', async () => {
    const icm = createMockIcm({ data: 'some unstructured text' });
    const agent = {
      runDirect: vi.fn().mockResolvedValue({
        output_text: '```json\n["a", "b"]\n```',
      }),
    } as any;

    const result = await resolveFlowSource(
      { source: 'data' }, 'Map', agent, undefined, icm, null
    );
    expect((result as any).array).toEqual(['a', 'b']);
  });

  it('returns error when LLM extraction fails with invalid JSON', async () => {
    const icm = createMockIcm({ data: 'messy text' });
    const agent = {
      runDirect: vi.fn().mockResolvedValue({ output_text: 'not json at all' }),
    } as any;

    const result = await resolveFlowSource(
      { source: 'data' }, 'Map', agent, undefined, icm, null
    );
    expect('completed' in result).toBe(true);
    expect((result as any).error).toContain('LLM extraction failed');
  });

  it('returns error when LLM extraction returns non-array', async () => {
    const icm = createMockIcm({ data: 'some text' });
    const agent = {
      runDirect: vi.fn().mockResolvedValue({ output_text: '{"not": "array"}' }),
    } as any;

    const result = await resolveFlowSource(
      { source: 'data' }, 'Map', agent, undefined, icm, null
    );
    expect('completed' in result).toBe(true);
    expect((result as any).error).toContain('LLM extraction failed');
  });

  it('handles empty array gracefully', async () => {
    const icm = createMockIcm({ items: [] });
    const result = await resolveFlowSource(
      { source: 'items' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual([]);
    expect((result as any).maxIter).toBe(0);
  });

  it('handles null and undefined values as not found', async () => {
    // undefined is returned when key not in memory, which is "not found"
    const icm = createMockIcm({});
    const result = await resolveFlowSource(
      { source: 'nope' }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).completed).toBe(false);
    expect((result as any).error).toContain('source not found');
  });

  it('handles bracket indexing in path', async () => {
    const icm = createMockIcm({ data: { results: [{ entries: ['a', 'b'] }] } });
    const result = await resolveFlowSource(
      { source: { key: 'data', path: 'results[0].entries' } }, 'Map', mockAgent, undefined, icm, null
    );
    expect((result as any).array).toEqual(['a', 'b']);
  });
});

// ============================================================================
// executeControlFlow (integration with mocked executeRoutine)
// ============================================================================

// We need to mock executeRoutine to avoid needing a real Agent
vi.mock('@/core/routineRunner.js', () => ({
  executeRoutine: vi.fn(),
}));

import { executeRoutine } from '@/core/routineRunner.js';
const mockExecuteRoutine = vi.mocked(executeRoutine);

// Mock agent factory
function createMockAgent(icmEntries: Record<string, unknown> = {}): any {
  const icm = createMockIcm(icmEntries);
  const wm = createMockWm({});

  return {
    context: {
      getPlugin: vi.fn((name: string) => {
        if (name === 'in_context_memory') return icm;
        return null;
      }),
      memory: wm,
    },
    // Expose for assertions
    __icm: icm,
    __wm: wm,
  };
}

function makeCompletedExecution(output: unknown = 'done') {
  return {
    id: 'rexec-test',
    routineId: 'routine-test',
    plan: {
      id: 'plan-test',
      goal: 'test',
      tasks: [
        {
          id: 'task-1',
          name: 'sub-task',
          description: 'sub',
          status: 'completed' as const,
          dependsOn: [],
          attempts: 1,
          maxAttempts: 3,
          createdAt: Date.now(),
          lastUpdatedAt: Date.now(),
          result: { success: true, output },
        },
      ],
      allowDynamicTasks: false,
      status: 'completed' as const,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    },
    status: 'completed' as const,
    progress: 100,
    lastUpdatedAt: Date.now(),
  };
}

function makeFailedExecution(error = 'sub failed') {
  return {
    id: 'rexec-test',
    routineId: 'routine-test',
    plan: {
      id: 'plan-test',
      goal: 'test',
      tasks: [
        {
          id: 'task-1',
          name: 'sub-task',
          description: 'sub',
          status: 'failed' as const,
          dependsOn: [],
          attempts: 1,
          maxAttempts: 3,
          createdAt: Date.now(),
          lastUpdatedAt: Date.now(),
          result: { success: false, error },
        },
      ],
      allowDynamicTasks: false,
      status: 'failed' as const,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    },
    status: 'failed' as const,
    progress: 0,
    error,
    lastUpdatedAt: Date.now(),
  };
}

describe('executeControlFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== MAP ==========

  describe('map', () => {
    it('iterates array, calls executeRoutine per element, collects results', async () => {
      const agent = createMockAgent({ items: ['a', 'b', 'c'] });
      mockExecuteRoutine
        .mockResolvedValueOnce(makeCompletedExecution('result-a') as any)
        .mockResolvedValueOnce(makeCompletedExecution('result-b') as any)
        .mockResolvedValueOnce(makeCompletedExecution('result-c') as any);

      const task = createTask({
        name: 'map-test',
        description: 'Map over items',
        controlFlow: {
          type: 'map',
          source: 'items',
          tasks: [{ name: 'process', description: 'Process item' }],
          resultKey: 'results',
        },
      });

      const result = await executeControlFlow(agent, task, {});

      expect(result.completed).toBe(true);
      expect(result.result).toEqual(['result-a', 'result-b', 'result-c']);
      expect(mockExecuteRoutine).toHaveBeenCalledTimes(3);

      // Verify ICM keys were set per iteration
      expect(agent.__icm.set).toHaveBeenCalledWith('__map_item', expect.any(String), 'a', 'high');
      expect(agent.__icm.set).toHaveBeenCalledWith('__map_item', expect.any(String), 'b', 'high');
      expect(agent.__icm.set).toHaveBeenCalledWith('__map_item', expect.any(String), 'c', 'high');

      // Verify cleanup
      expect(agent.__icm.delete).toHaveBeenCalledWith('__map_item');
      expect(agent.__icm.delete).toHaveBeenCalledWith('__map_index');
      expect(agent.__icm.delete).toHaveBeenCalledWith('__map_total');
    });

    it('fails if source is not an array and cannot be coerced', async () => {
      const agent = createMockAgent({ items: 42 });
      // LLM extraction will be attempted — mock it to fail
      agent.runDirect = vi.fn().mockResolvedValue({ output_text: 'not json' });

      const task = createTask({
        name: 'map-test',
        description: 'Map',
        controlFlow: { type: 'map', source: 'items', tasks: [{ name: 's', description: 's' }] },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(false);
      expect(result.error).toContain('not an array');
    });

    it('respects maxIterations', async () => {
      const agent = createMockAgent({ items: [1, 2, 3, 4, 5] });
      mockExecuteRoutine.mockResolvedValue(makeCompletedExecution('ok') as any);

      const task = createTask({
        name: 'map-test',
        description: 'Map',
        controlFlow: {
          type: 'map',
          source: 'items',
          tasks: [{ name: 's', description: 's' }],
          maxIterations: 2,
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(true);
      expect(mockExecuteRoutine).toHaveBeenCalledTimes(2);
    });

    it('fails fast on sub-routine failure', async () => {
      const agent = createMockAgent({ items: [1, 2, 3] });
      mockExecuteRoutine
        .mockResolvedValueOnce(makeCompletedExecution('ok') as any)
        .mockResolvedValueOnce(makeFailedExecution('iteration 1 error') as any);

      const task = createTask({
        name: 'map-test',
        description: 'Map',
        controlFlow: {
          type: 'map',
          source: 'items',
          tasks: [{ name: 's', description: 's' }],
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(false);
      expect(result.error).toContain('iteration 1 failed');
      // Should not have called for third element
      expect(mockExecuteRoutine).toHaveBeenCalledTimes(2);
    });

    it('works with source: { task: "X" } when task output key exists', async () => {
      const agent = createMockAgent({ '__task_output_Research': ['a', 'b'] });
      mockExecuteRoutine
        .mockResolvedValueOnce(makeCompletedExecution('r-a') as any)
        .mockResolvedValueOnce(makeCompletedExecution('r-b') as any);

      const task = createTask({
        name: 'map-test',
        description: 'Map over research results',
        controlFlow: {
          type: 'map',
          source: { task: 'Research' },
          tasks: [{ name: 'analyze', description: 'Analyze' }],
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(true);
      expect(result.result).toEqual(['r-a', 'r-b']);
    });
  });

  // ========== FOLD ==========

  describe('fold', () => {
    it('accumulates results across iterations', async () => {
      const agent = createMockAgent({ numbers: [1, 2, 3] });
      mockExecuteRoutine
        .mockResolvedValueOnce(makeCompletedExecution('sum=1') as any)
        .mockResolvedValueOnce(makeCompletedExecution('sum=3') as any)
        .mockResolvedValueOnce(makeCompletedExecution('sum=6') as any);

      const task = createTask({
        name: 'fold-test',
        description: 'Sum numbers',
        controlFlow: {
          type: 'fold',
          source: 'numbers',
          tasks: [{ name: 'add', description: 'Add number' }],
          initialValue: 0,
          resultKey: 'total',
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(true);
      // Last output becomes accumulator
      expect(result.result).toBe('sum=6');
      expect(mockExecuteRoutine).toHaveBeenCalledTimes(3);

      // Verify accumulator was set in ICM
      expect(agent.__icm.set).toHaveBeenCalledWith(
        '__fold_accumulator',
        expect.any(String),
        0, // initialValue
        'high'
      );

      // Verify cleanup
      expect(agent.__icm.delete).toHaveBeenCalledWith('__fold_accumulator');
    });

    it('uses empty string as valid accumulator (no ICM fallback)', async () => {
      const agent = createMockAgent({ items: ['a'] });

      // Sub-routine produces empty string output — should be used as accumulator
      const emptyExecution = makeCompletedExecution('') as any;
      mockExecuteRoutine.mockImplementation(async (opts: any) => {
        // Simulate LLM updating accumulator via context_set (should be ignored)
        agent.__icm.set('__fold_accumulator', 'acc', 'updated-by-llm', 'high');
        return emptyExecution;
      });

      const task = createTask({
        name: 'fold-test',
        description: 'Fold',
        controlFlow: {
          type: 'fold',
          source: 'items',
          tasks: [{ name: 's', description: 's' }],
          initialValue: 'start',
          resultKey: 'result',
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(true);
      // Empty string is a valid accumulator — should NOT fall back to ICM
      expect(result.result).toBe('');
    });

    it('reads accumulator from ICM when no task output (null)', async () => {
      const agent = createMockAgent({ items: ['a'] });

      // Sub-routine has no completed tasks (getSubRoutineOutput returns null)
      const noOutputExecution = makeCompletedExecution(null) as any;
      mockExecuteRoutine.mockImplementation(async (opts: any) => {
        // Simulate LLM updating accumulator via context_set
        agent.__icm.set('__fold_accumulator', 'acc', 'updated-by-llm', 'high');
        return noOutputExecution;
      });

      const task = createTask({
        name: 'fold-test',
        description: 'Fold',
        controlFlow: {
          type: 'fold',
          source: 'items',
          tasks: [{ name: 's', description: 's' }],
          initialValue: 'start',
          resultKey: 'result',
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(true);
      // No task output (null) → falls back to ICM accumulator
      expect(result.result).toBe('updated-by-llm');
    });

    it('fails on sub-routine failure', async () => {
      const agent = createMockAgent({ items: [1, 2] });
      mockExecuteRoutine.mockResolvedValueOnce(makeFailedExecution() as any);

      const task = createTask({
        name: 'fold-test',
        description: 'Fold',
        controlFlow: {
          type: 'fold',
          source: 'items',
          tasks: [{ name: 's', description: 's' }],
          initialValue: 0,
          resultKey: 'result',
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(false);
    });
  });

  // ========== UNTIL ==========

  describe('until', () => {
    it('stops when condition is met', async () => {
      const agent = createMockAgent({});
      let callCount = 0;

      mockExecuteRoutine.mockImplementation(async () => {
        callCount++;
        // After 2nd iteration, set the condition key
        if (callCount >= 2) {
          agent.__icm.set('done_flag', 'flag', true, 'high');
        }
        return makeCompletedExecution('iteration done') as any;
      });

      const task = createTask({
        name: 'until-test',
        description: 'Until done',
        controlFlow: {
          type: 'until',
          tasks: [{ name: 'step', description: 'Do step' }],
          condition: { memoryKey: 'done_flag', operator: 'truthy', onFalse: 'skip' },
          maxIterations: 10,
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(true);
      expect(mockExecuteRoutine).toHaveBeenCalledTimes(2);
    });

    it('fails when maxIterations exceeded', async () => {
      const agent = createMockAgent({});
      mockExecuteRoutine.mockResolvedValue(makeCompletedExecution('done') as any);

      const task = createTask({
        name: 'until-test',
        description: 'Until',
        controlFlow: {
          type: 'until',
          tasks: [{ name: 'step', description: 'Do step' }],
          condition: { memoryKey: 'never_set', operator: 'truthy', onFalse: 'skip' },
          maxIterations: 3,
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(false);
      expect(result.error).toContain('maxIterations');
      expect(mockExecuteRoutine).toHaveBeenCalledTimes(3);
    });

    it('sets iterationKey in ICM when configured', async () => {
      const agent = createMockAgent({});
      mockExecuteRoutine.mockImplementation(async () => {
        // Meet condition immediately
        agent.__icm.set('done', 'd', true, 'high');
        return makeCompletedExecution() as any;
      });

      const task = createTask({
        name: 'until-test',
        description: 'Until',
        controlFlow: {
          type: 'until',
          tasks: [{ name: 'step', description: 'Do step' }],
          condition: { memoryKey: 'done', operator: 'truthy', onFalse: 'skip' },
          maxIterations: 5,
          iterationKey: '__current_iter',
        },
      });

      await executeControlFlow(agent, task, {});
      expect(agent.__icm.set).toHaveBeenCalledWith('__current_iter', expect.any(String), 0, 'high');
      // Cleanup
      expect(agent.__icm.delete).toHaveBeenCalledWith('__current_iter');
    });

    it('fails fast on sub-routine failure', async () => {
      const agent = createMockAgent({});
      mockExecuteRoutine.mockResolvedValueOnce(makeFailedExecution() as any);

      const task = createTask({
        name: 'until-test',
        description: 'Until',
        controlFlow: {
          type: 'until',
          tasks: [{ name: 'step', description: 'Do step' }],
          condition: { memoryKey: 'x', operator: 'truthy', onFalse: 'skip' },
          maxIterations: 5,
        },
      });

      const result = await executeControlFlow(agent, task, {});
      expect(result.completed).toBe(false);
      expect(result.error).toContain('iteration 0 failed');
    });
  });

  // ========== Unknown type ==========

  it('returns error for unknown control flow type', async () => {
    const agent = createMockAgent({});
    const task = createTask({
      name: 'bad',
      description: 'Bad',
      controlFlow: { type: 'unknown' as any } as any,
    });

    const result = await executeControlFlow(agent, task, {});
    expect(result.completed).toBe(false);
    expect(result.error).toContain('Unknown control flow type');
  });
});

// ============================================================================
// resolveStepArgs
// ============================================================================

describe('resolveStepArgs', () => {
  it('should resolve {{param.X}} templates from inputs', () => {
    const result = resolveStepArgs(
      { url: '{{param.apiUrl}}', method: 'GET' },
      { inputs: { apiUrl: 'https://example.com' } }
    );
    expect(result).toEqual({ url: 'https://example.com', method: 'GET' });
  });

  it('should resolve {{result.TASK}} templates from task results', () => {
    const taskResults = new Map<string, unknown>([['Summarize', 'A brief summary']]);
    const result = resolveStepArgs(
      { body: '{{result.Summarize}}' },
      { inputs: {}, taskResults }
    );
    expect(result).toEqual({ body: 'A brief summary' });
  });

  it('should resolve {{step.STEP}} templates from prior step results', () => {
    const stepResults = new Map<string, unknown>([['Auth', { token: 'abc123' }]]);
    const result = resolveStepArgs(
      { header: '{{step.Auth}}' },
      { inputs: {}, stepResults }
    );
    expect(result).toEqual({ header: '{"token":"abc123"}' });
  });

  it('should leave unresolved templates as-is', () => {
    const result = resolveStepArgs(
      { url: '{{param.missing}}', unknown: '{{foo.bar}}' },
      { inputs: {} }
    );
    expect(result).toEqual({ url: '{{param.missing}}', unknown: '{{foo.bar}}' });
  });

  it('should handle nested objects recursively', () => {
    const result = resolveStepArgs(
      { config: { nested: { url: '{{param.host}}/api' } } },
      { inputs: { host: 'https://api.test' } }
    );
    expect(result).toEqual({ config: { nested: { url: 'https://api.test/api' } } });
  });

  it('should handle arrays recursively', () => {
    const result = resolveStepArgs(
      { items: ['{{param.a}}', '{{param.b}}', 'literal'] },
      { inputs: { a: 'first', b: 'second' } }
    );
    expect(result).toEqual({ items: ['first', 'second', 'literal'] });
  });

  it('should pass non-string values through unchanged', () => {
    const result = resolveStepArgs(
      { count: 42, enabled: true, empty: null },
      { inputs: {} }
    );
    expect(result).toEqual({ count: 42, enabled: true, empty: null });
  });

  it('should JSON.stringify non-string resolved values', () => {
    const result = resolveStepArgs(
      { data: '{{param.obj}}' },
      { inputs: { obj: { key: 'value' } } }
    );
    expect(result).toEqual({ data: '{"key":"value"}' });
  });

  it('should handle mixed namespaces in one string', () => {
    const taskResults = new Map([['Report', 'the report']]);
    const result = resolveStepArgs(
      { msg: 'Results for {{param.user}}: {{result.Report}}' },
      { inputs: { user: 'Alice' }, taskResults }
    );
    expect(result).toEqual({ msg: 'Results for Alice: the report' });
  });
});
