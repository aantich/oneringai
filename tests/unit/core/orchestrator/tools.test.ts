/**
 * Orchestration Tools Unit Tests
 *
 * Tests for:
 * - buildWorkspaceDelta: workspace change formatting
 * - buildOrchestrationTools: all 7 orchestration tools
 *   - create_agent: validation, max agents, creation
 *   - list_agents: status reporting
 *   - destroy_agent: validation, running guard, cleanup
 *   - assign_turn: blocking execution, timeout, error handling
 *   - assign_turn_async: non-blocking flag
 *   - assign_parallel: fan-out, duplicate detection, partial failures
 *   - send_message: injection, validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildOrchestrationTools, buildWorkspaceDelta } from '@/core/orchestrator/tools.js';
import type { OrchestrationToolsContext } from '@/core/orchestrator/tools.js';
import { SharedWorkspacePluginNextGen } from '@/core/context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a mock Agent with controllable behavior */
function createMockAgent(overrides: Partial<{
  model: string;
  isRunning: boolean;
  isPaused: boolean;
  isDestroyed: boolean;
  runResult: { output_text: string; usage?: { total_tokens: number } };
  runError: Error;
  runDelay: number;
}> = {}) {
  const {
    model = 'gpt-4',
    isRunning = false,
    isPaused = false,
    isDestroyed = false,
    runResult = { output_text: 'done', usage: { total_tokens: 100 } },
    runError,
    runDelay = 0,
  } = overrides;

  return {
    model,
    isRunning: vi.fn(() => isRunning),
    isPaused: vi.fn(() => isPaused),
    isDestroyed,
    destroy: vi.fn(),
    inject: vi.fn(),
    run: vi.fn(async () => {
      if (runDelay > 0) await new Promise(r => setTimeout(r, runDelay));
      if (runError) throw runError;
      return runResult;
    }),
    registryId: `mock-${Math.random().toString(36).slice(2)}`,
    context: { registerPlugin: vi.fn() },
  } as any;  // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Build a tools context with defaults */
function createToolsContext(overrides: Partial<OrchestrationToolsContext> = {}): OrchestrationToolsContext {
  return {
    workspace: new SharedWorkspacePluginNextGen(),
    agents: new Map(),
    agentTypes: new Map([
      ['developer', { systemPrompt: 'You are a developer' }],
      ['reviewer', { systemPrompt: 'You are a code reviewer' }],
    ]),
    lastTurnTimestamps: new Map(),
    createWorkerAgent: vi.fn((name: string) => createMockAgent()),
    ...overrides,
  };
}

/** Find tool by name from tools array */
function findTool(tools: ToolFunction[], name: string): ToolFunction {
  const tool = tools.find(t => t.definition.function.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

// ============================================================================
// buildWorkspaceDelta
// ============================================================================

describe('buildWorkspaceDelta', () => {
  let workspace: SharedWorkspacePluginNextGen;
  let lastSeen: Map<string, number>;

  beforeEach(() => {
    workspace = new SharedWorkspacePluginNextGen();
    lastSeen = new Map();
  });

  it('should return empty string when no changes', () => {
    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toBe('');
  });

  it('should return empty string when agent has seen all changes', async () => {
    await workspace.storeSet('plan', { summary: 'Plan', author: 'other' });
    lastSeen.set('agent-1', Date.now() + 1000);

    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toBe('');
  });

  it('should show NEW entries created after last seen', async () => {
    lastSeen.set('agent-1', Date.now() - 1000);

    await workspace.storeSet('plan', { summary: 'The plan', author: 'alice' });

    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toContain('Workspace changes since your last turn');
    expect(delta).toContain('NEW');
    expect(delta).toContain('"plan"');
    expect(delta).toContain('alice');
    expect(delta).toContain('The plan');
  });

  it('should show UPDATED entries modified after last seen', async () => {
    await workspace.storeSet('plan', { summary: 'v1', author: 'alice' });

    // Agent saw the initial version
    lastSeen.set('agent-1', Date.now());
    await new Promise(r => setTimeout(r, 5)); // ensure timestamps differ

    // Someone updates it
    await workspace.storeSet('plan', { summary: 'v2', author: 'bob' });

    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toContain('UPDATED');
    expect(delta).toContain('v2');
    expect(delta).toContain('v2'); // version 2
  });

  it('should include recent log entries', async () => {
    workspace.appendLog('alice', 'Started working on auth');

    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toContain('Recent log');
    expect(delta).toContain('alice');
    expect(delta).toContain('Started working on auth');
  });

  it('should cap entries at MAX_DELTA_ENTRIES (20)', async () => {
    for (let i = 0; i < 25; i++) {
      await workspace.storeSet(`entry-${i}`, { summary: `Entry ${i}`, author: 'a' });
    }

    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toContain('showing 20 of 25');
  });

  it('should cap log at MAX_DELTA_LOG (10)', () => {
    for (let i = 0; i < 15; i++) {
      workspace.appendLog('a', `msg-${i}`);
    }

    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toContain('last 10 of 15');
  });

  it('should end with double newline for concatenation', async () => {
    await workspace.storeSet('x', { summary: 'X', author: 'a' });
    const delta = buildWorkspaceDelta('agent-1', workspace, lastSeen);
    expect(delta).toMatch(/\n\n$/);
  });
});

// ============================================================================
// buildOrchestrationTools
// ============================================================================

describe('buildOrchestrationTools', () => {
  it('should return exactly 7 tools', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    expect(tools).toHaveLength(7);
  });

  it('should return tools with correct names', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    const names = tools.map(t => t.definition.function.name);
    expect(names).toEqual([
      'create_agent',
      'list_agents',
      'destroy_agent',
      'assign_turn',
      'assign_turn_async',
      'assign_parallel',
      'send_message',
    ]);
  });

  it('should mark assign_turn_async as non-blocking', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    const asyncTool = findTool(tools, 'assign_turn_async');
    expect(asyncTool.definition.blocking).toBe(false);
  });

  it('should set all tools to low risk', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    for (const tool of tools) {
      expect(tool.permission?.riskLevel).toBe('low');
    }
  });
});

// ============================================================================
// create_agent tool
// ============================================================================

describe('create_agent', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'create_agent');
  });

  it('should create an agent with valid name and type', async () => {
    const result = await tool.execute!({ name: 'dev-1', type: 'developer' }) as any;
    expect(result.success).toBe(true);
    expect(result.name).toBe('dev-1');
    expect(result.type).toBe('developer');
    expect(ctx.agents.has('dev-1')).toBe(true);
    expect(ctx.createWorkerAgent).toHaveBeenCalledWith('dev-1', 'developer');
  });

  it('should reject duplicate agent name', async () => {
    ctx.agents.set('dev-1', createMockAgent());

    const result = await tool.execute!({ name: 'dev-1', type: 'developer' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('should reject unknown agent type', async () => {
    const result = await tool.execute!({ name: 'dev-1', type: 'unknown' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown agent type');
    expect(result.error).toContain('developer');
    expect(result.error).toContain('reviewer');
  });

  it('should enforce max agents limit (default 20)', async () => {
    for (let i = 0; i < 20; i++) {
      ctx.agents.set(`agent-${i}`, createMockAgent());
    }

    const result = await tool.execute!({ name: 'agent-21', type: 'developer' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum agent limit');
  });

  it('should enforce custom max agents limit', async () => {
    ctx = createToolsContext({ maxAgents: 2 });
    tool = findTool(buildOrchestrationTools(ctx), 'create_agent');

    ctx.agents.set('a', createMockAgent());
    ctx.agents.set('b', createMockAgent());

    const result = await tool.execute!({ name: 'c', type: 'developer' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('2');
  });

  it('should have descriptionFactory listing available types', () => {
    expect(tool.descriptionFactory).toBeDefined();
    const desc = tool.descriptionFactory!({});
    expect(desc).toContain('developer');
    expect(desc).toContain('reviewer');
  });
});

// ============================================================================
// list_agents tool
// ============================================================================

describe('list_agents', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'list_agents');
  });

  it('should return empty list when no agents', async () => {
    const result = await tool.execute!({}) as any;
    expect(result.agents).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should list agents with status', async () => {
    ctx.agents.set('idle-agent', createMockAgent({ isRunning: false, isPaused: false }));
    ctx.agents.set('running-agent', createMockAgent({ isRunning: true }));
    ctx.agents.set('paused-agent', createMockAgent({ isPaused: true }));

    const result = await tool.execute!({}) as any;
    expect(result.total).toBe(3);

    const idle = result.agents.find((a: any) => a.name === 'idle-agent');
    expect(idle.status).toBe('idle');

    const running = result.agents.find((a: any) => a.name === 'running-agent');
    expect(running.status).toBe('running');

    const paused = result.agents.find((a: any) => a.name === 'paused-agent');
    expect(paused.status).toBe('paused');
  });

  it('should include model and isDestroyed', async () => {
    ctx.agents.set('dev', createMockAgent({ model: 'gpt-4o', isDestroyed: true }));

    const result = await tool.execute!({}) as any;
    expect(result.agents[0].model).toBe('gpt-4o');
    expect(result.agents[0].isDestroyed).toBe(true);
  });
});

// ============================================================================
// destroy_agent tool
// ============================================================================

describe('destroy_agent', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'destroy_agent');
  });

  it('should destroy an idle agent', async () => {
    const mockAgent = createMockAgent();
    ctx.agents.set('dev', mockAgent);
    ctx.lastTurnTimestamps.set('dev', Date.now());

    const result = await tool.execute!({ name: 'dev' }) as any;
    expect(result.success).toBe(true);
    expect(mockAgent.destroy).toHaveBeenCalled();
    expect(ctx.agents.has('dev')).toBe(false);
    expect(ctx.lastTurnTimestamps.has('dev')).toBe(false);
  });

  it('should reject destroying a non-existent agent', async () => {
    const result = await tool.execute!({ name: 'ghost' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should reject destroying a running agent (M1)', async () => {
    ctx.agents.set('busy', createMockAgent({ isRunning: true }));

    const result = await tool.execute!({ name: 'busy' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('currently running');
  });
});

// ============================================================================
// assign_turn tool
// ============================================================================

describe('assign_turn', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'assign_turn');
  });

  it('should run agent and return result', async () => {
    const mockAgent = createMockAgent({
      runResult: { output_text: 'Auth module complete', usage: { total_tokens: 500 } },
    });
    ctx.agents.set('dev', mockAgent);

    const result = await tool.execute!({ agent: 'dev', instruction: 'Build auth module' }) as any;
    expect(result.success).toBe(true);
    expect(result.agent).toBe('dev');
    expect(result.result).toBe('Auth module complete');
    expect(result.totalTokens).toBe(500);
  });

  it('should prepend workspace delta to instruction', async () => {
    const mockAgent = createMockAgent();
    ctx.agents.set('dev', mockAgent);

    // Add something to workspace so delta is non-empty
    await ctx.workspace.storeSet('plan', { summary: 'Build plan', author: 'orchestrator' });

    await tool.execute!({ agent: 'dev', instruction: 'Continue work' });

    const calledWith = mockAgent.run.mock.calls[0][0] as string;
    expect(calledWith).toContain('Workspace changes');
    expect(calledWith).toContain('Continue work');
  });

  it('should update lastTurnTimestamps on success', async () => {
    ctx.agents.set('dev', createMockAgent());
    const before = Date.now();

    await tool.execute!({ agent: 'dev', instruction: 'Do stuff' });

    expect(ctx.lastTurnTimestamps.has('dev')).toBe(true);
    expect(ctx.lastTurnTimestamps.get('dev')!).toBeGreaterThanOrEqual(before);
  });

  it('should return error for non-existent agent', async () => {
    const result = await tool.execute!({ agent: 'ghost', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error for destroyed agent', async () => {
    ctx.agents.set('dead', createMockAgent({ isDestroyed: true }));

    const result = await tool.execute!({ agent: 'dead', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
  });

  it('should handle agent.run() errors gracefully', async () => {
    ctx.agents.set('dev', createMockAgent({ runError: new Error('LLM failure') }));

    const result = await tool.execute!({ agent: 'dev', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM failure');
  });

  it('should timeout with custom timeout value', async () => {
    ctx.agents.set('slow', createMockAgent({ runDelay: 2000 }));

    const result = await tool.execute!({
      agent: 'slow',
      instruction: 'hello',
      timeout: 0.05, // 50ms
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  }, 10000);
});

// ============================================================================
// assign_turn_async tool
// ============================================================================

describe('assign_turn_async', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'assign_turn_async');
  });

  it('should have blocking: false on definition', () => {
    expect(tool.definition.blocking).toBe(false);
  });

  it('should have timeout on definition', () => {
    expect(tool.definition.timeout).toBe(300000);
  });

  it('should execute the same as assign_turn', async () => {
    const mockAgent = createMockAgent({
      runResult: { output_text: 'async result', usage: { total_tokens: 200 } },
    });
    ctx.agents.set('dev', mockAgent);

    const result = await tool.execute!({ agent: 'dev', instruction: 'Do async work' }) as any;
    expect(result.success).toBe(true);
    expect(result.result).toBe('async result');
  });

  it('should return error for non-existent agent', async () => {
    const result = await tool.execute!({ agent: 'ghost', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error for destroyed agent', async () => {
    ctx.agents.set('dead', createMockAgent({ isDestroyed: true }));
    const result = await tool.execute!({ agent: 'dead', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
  });
});

// ============================================================================
// assign_parallel tool
// ============================================================================

describe('assign_parallel', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'assign_parallel');
  });

  it('should run multiple agents in parallel', async () => {
    ctx.agents.set('dev-1', createMockAgent({
      runResult: { output_text: 'result-1', usage: { total_tokens: 100 } },
    }));
    ctx.agents.set('dev-2', createMockAgent({
      runResult: { output_text: 'result-2', usage: { total_tokens: 200 } },
    }));

    const result = await tool.execute!({
      assignments: [
        { agent: 'dev-1', instruction: 'Task A' },
        { agent: 'dev-2', instruction: 'Task B' },
      ],
    }) as any;

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results[0].result).toBe('result-1');
    expect(result.results[1].result).toBe('result-2');
  });

  it('should reject empty assignments', async () => {
    const result = await tool.execute!({ assignments: [] }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('No assignments');
  });

  it('should reject null/undefined assignments', async () => {
    const result = await tool.execute!({}) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('No assignments');
  });

  it('should reject duplicate agents (L2)', async () => {
    ctx.agents.set('dev', createMockAgent());

    const result = await tool.execute!({
      assignments: [
        { agent: 'dev', instruction: 'Task A' },
        { agent: 'dev', instruction: 'Task B' },
      ],
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Duplicate');
    expect(result.error).toContain('dev');
  });

  it('should reject if any agent does not exist', async () => {
    ctx.agents.set('dev-1', createMockAgent());

    const result = await tool.execute!({
      assignments: [
        { agent: 'dev-1', instruction: 'Task A' },
        { agent: 'ghost', instruction: 'Task B' },
      ],
    }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('ghost');
    expect(result.error).toContain('not found');
  });

  it('should handle partial failures', async () => {
    ctx.agents.set('ok', createMockAgent({
      runResult: { output_text: 'fine' },
    }));
    ctx.agents.set('fail', createMockAgent({
      runError: new Error('Boom'),
    }));

    const result = await tool.execute!({
      assignments: [
        { agent: 'ok', instruction: 'Task A' },
        { agent: 'fail', instruction: 'Task B' },
      ],
    }) as any;

    expect(result.success).toBe(false); // not all succeeded
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);

    const okResult = result.results.find((r: any) => r.agent === 'ok');
    expect(okResult.success).toBe(true);
    expect(okResult.result).toBe('fine');

    const failResult = result.results.find((r: any) => r.agent === 'fail');
    expect(failResult.success).toBe(false);
    expect(failResult.error).toContain('Boom');
  });

  it('should update lastTurnTimestamps for successful agents', async () => {
    ctx.agents.set('dev', createMockAgent());
    const before = Date.now();

    await tool.execute!({
      assignments: [{ agent: 'dev', instruction: 'Work' }],
    });

    expect(ctx.lastTurnTimestamps.get('dev')!).toBeGreaterThanOrEqual(before);
  });

  it('should timeout individual agents', async () => {
    ctx.agents.set('fast', createMockAgent({ runResult: { output_text: 'done' } }));
    ctx.agents.set('slow', createMockAgent({ runDelay: 2000 }));

    const result = await tool.execute!({
      assignments: [
        { agent: 'fast', instruction: 'Quick' },
        { agent: 'slow', instruction: 'Slow' },
      ],
      timeout: 0.05, // 50ms
    }) as any;

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);

    const slowResult = result.results.find((r: any) => r.agent === 'slow');
    expect(slowResult.error).toContain('Timed out');
  }, 10000);
});

// ============================================================================
// send_message tool
// ============================================================================

describe('send_message', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'send_message');
  });

  it('should inject message into agent', async () => {
    const mockAgent = createMockAgent();
    ctx.agents.set('dev', mockAgent);

    const result = await tool.execute!({ agent: 'dev', message: 'Also handle rate limiting' }) as any;
    expect(result.success).toBe(true);
    expect(mockAgent.inject).toHaveBeenCalledWith('Also handle rate limiting');
  });

  it('should reject for non-existent agent', async () => {
    const result = await tool.execute!({ agent: 'ghost', message: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should reject for destroyed agent', async () => {
    ctx.agents.set('dead', createMockAgent({ isDestroyed: true }));

    const result = await tool.execute!({ agent: 'dead', message: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
  });
});

// ============================================================================
// describeCall
// ============================================================================

describe('describeCall', () => {
  it('create_agent should describe creation', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'create_agent');
    expect(tool.describeCall!({ name: 'dev', type: 'developer' })).toBe('create dev (developer)');
  });

  it('list_agents should describe listing', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'list_agents');
    expect(tool.describeCall!({})).toBe('list agents');
  });

  it('destroy_agent should describe destruction', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'destroy_agent');
    expect(tool.describeCall!({ name: 'dev' })).toBe('destroy dev');
  });

  it('assign_turn should describe blocking assignment', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'assign_turn');
    expect(tool.describeCall!({ agent: 'dev' })).toBe('assign dev (blocking)');
  });

  it('assign_turn_async should describe async assignment', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'assign_turn_async');
    expect(tool.describeCall!({ agent: 'dev' })).toBe('assign dev (async)');
  });

  it('assign_parallel should describe parallel agents', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'assign_parallel');
    expect(tool.describeCall!({ assignments: [{ agent: 'a' }, { agent: 'b' }] })).toBe('parallel: a, b');
  });

  it('send_message should describe target', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'send_message');
    expect(tool.describeCall!({ agent: 'dev' })).toBe('message → dev');
  });
});
