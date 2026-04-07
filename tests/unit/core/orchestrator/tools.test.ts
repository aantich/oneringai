/**
 * Orchestration Tools v2 Unit Tests
 *
 * Tests for:
 * - buildWorkspaceDelta: workspace change formatting
 * - buildOrchestrationTools: all 5 orchestration tools
 *   - assign_turn: auto-create, async (blocking: false), autoDestroy, timeout
 *   - delegate_interactive: delegation state, double-delegation prevention, isRunning guard
 *   - send_message: injection, validation
 *   - list_agents: status reporting + delegation info
 *   - destroy_agent: validation, running guard, cleanup, delegation reclaim
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildOrchestrationTools, buildWorkspaceDelta, createDelegationState } from '@/core/orchestrator/tools.js';
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
  runResult: { status?: string; output_text: string; usage?: { total_tokens: number } };
  runError: Error;
  runDelay: number;
}> = {}) {
  const {
    model = 'gpt-4',
    isRunning = false,
    isPaused = false,
    isDestroyed = false,
    runResult = { status: 'completed', output_text: 'done', usage: { total_tokens: 100 } },
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
    delegationState: createDelegationState(),
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
  it('should return exactly 5 tools', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    expect(tools).toHaveLength(5);
  });

  it('should return tools with correct names', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    const names = tools.map(t => t.definition.function.name);
    expect(names).toEqual([
      'assign_turn',
      'delegate_interactive',
      'send_message',
      'list_agents',
      'destroy_agent',
    ]);
  });

  it('should mark assign_turn as non-blocking', () => {
    const ctx = createToolsContext();
    const tools = buildOrchestrationTools(ctx);
    const tool = findTool(tools, 'assign_turn');
    expect(tool.definition.blocking).toBe(false);
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
// assign_turn tool
// ============================================================================

describe('assign_turn', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'assign_turn');
  });

  it('should run existing agent and return result', async () => {
    const mockAgent = createMockAgent({
      runResult: { status: 'completed', output_text: 'Auth module complete', usage: { total_tokens: 500 } },
    });
    ctx.agents.set('dev', mockAgent);

    const result = await tool.execute!({ agent: 'dev', instruction: 'Build auth module' }) as any;
    expect(result.success).toBe(true);
    expect(result.agent).toBe('dev');
    expect(result.result).toBe('Auth module complete');
    expect(result.totalTokens).toBe(500);
  });

  it('should auto-create agent when type is provided', async () => {
    const result = await tool.execute!({
      agent: 'new-dev',
      type: 'developer',
      instruction: 'Build something',
    }) as any;

    expect(result.success).toBe(true);
    expect(ctx.agents.has('new-dev')).toBe(true);
    expect(ctx.createWorkerAgent).toHaveBeenCalledWith('new-dev', 'developer');
  });

  it('should error when agent not found and no type provided', async () => {
    const result = await tool.execute!({ agent: 'ghost', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.error).toContain('type');
  });

  it('should error for unknown agent type', async () => {
    const result = await tool.execute!({ agent: 'x', type: 'unknown', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown agent type');
    expect(result.error).toContain('developer');
    expect(result.error).toContain('reviewer');
  });

  it('should error for destroyed agent', async () => {
    ctx.agents.set('dead', createMockAgent({ isDestroyed: true }));

    const result = await tool.execute!({ agent: 'dead', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
  });

  it('should enforce max agents limit', async () => {
    for (let i = 0; i < 20; i++) {
      ctx.agents.set(`agent-${i}`, createMockAgent());
    }

    const result = await tool.execute!({ agent: 'overflow', type: 'developer', instruction: 'hello' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum agent limit');
  });

  it('should prepend workspace delta to instruction', async () => {
    const mockAgent = createMockAgent();
    ctx.agents.set('dev', mockAgent);

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

  it('should auto-destroy agent when autoDestroy is true', async () => {
    const mockAgent = createMockAgent();
    (ctx.createWorkerAgent as any).mockReturnValue(mockAgent);

    const result = await tool.execute!({
      agent: 'temp',
      type: 'developer',
      instruction: 'One-shot task',
      autoDestroy: true,
    }) as any;

    expect(result.success).toBe(true);
    expect(result.destroyed).toBe(true);
    expect(mockAgent.destroy).toHaveBeenCalled();
    expect(ctx.agents.has('temp')).toBe(false);
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

  it('should have blocking: false on definition', () => {
    expect(tool.definition.blocking).toBe(false);
  });

  it('should have timeout on definition', () => {
    expect(tool.definition.timeout).toBe(300000);
  });

  it('should have descriptionFactory listing available types', () => {
    expect(tool.descriptionFactory).toBeDefined();
    const desc = tool.descriptionFactory!({});
    expect(desc).toContain('developer');
    expect(desc).toContain('reviewer');
  });
});


// ============================================================================
// delegate_interactive tool
// ============================================================================

describe('delegate_interactive', () => {
  let ctx: OrchestrationToolsContext;
  let tool: ToolFunction;

  beforeEach(() => {
    ctx = createToolsContext();
    tool = findTool(buildOrchestrationTools(ctx), 'delegate_interactive');
  });

  it('should set delegation state', async () => {
    const result = await tool.execute!({
      agent: 'coder',
      type: 'developer',
      monitoring: 'active',
      reclaimOn: { keyword: 'done', maxTurns: 5 },
    }) as any;

    expect(result.success).toBe(true);
    expect(result.agent).toBe('coder');
    expect(result.monitoring).toBe('active');
    expect(ctx.delegationState.active).toBe(true);
    expect(ctx.delegationState.agentName).toBe('coder');
    expect(ctx.delegationState.monitoring).toBe('active');
    expect(ctx.delegationState.reclaimOn.keyword).toBe('done');
    expect(ctx.delegationState.reclaimOn.maxTurns).toBe(5);
    expect(ctx.delegationState.turnCount).toBe(0);
  });

  it('should auto-create agent when type is provided', async () => {
    const result = await tool.execute!({ agent: 'new-coder', type: 'developer' }) as any;

    expect(result.success).toBe(true);
    expect(ctx.agents.has('new-coder')).toBe(true);
    expect(ctx.createWorkerAgent).toHaveBeenCalledWith('new-coder', 'developer');
  });

  it('should default to passive monitoring', async () => {
    await tool.execute!({ agent: 'coder', type: 'developer' });
    expect(ctx.delegationState.monitoring).toBe('passive');
  });

  it('should prevent double delegation', async () => {
    await tool.execute!({ agent: 'coder', type: 'developer' });
    const result = await tool.execute!({ agent: 'reviewer', type: 'reviewer' }) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Already delegated');
  });

  it('should error for unknown type without existing agent', async () => {
    const result = await tool.execute!({ agent: 'coder', type: 'unknown' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown agent type');
  });

  it('should send briefing to agent if provided', async () => {
    const mockAgent = createMockAgent();
    (ctx.createWorkerAgent as any).mockReturnValue(mockAgent);

    await tool.execute!({
      agent: 'coder',
      type: 'developer',
      briefing: 'The user wants to debug an auth issue',
    });

    expect(mockAgent.inject).toHaveBeenCalledWith('The user wants to debug an auth issue', 'developer');
  });
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
    expect(result.delegation).toBeNull();
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

  it('should show delegation info when active', async () => {
    ctx.agents.set('coder', createMockAgent());
    ctx.delegationState.active = true;
    ctx.delegationState.agentName = 'coder';
    ctx.delegationState.monitoring = 'active';
    ctx.delegationState.turnCount = 3;
    ctx.delegationState.reclaimOn = { keyword: 'done' };

    const result = await tool.execute!({}) as any;
    expect(result.delegation).not.toBeNull();
    expect(result.delegation.agent).toBe('coder');
    expect(result.delegation.monitoring).toBe('active');
    expect(result.delegation.turnCount).toBe(3);
    expect(result.agents[0].isDelegated).toBe(true);
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

  it('should reject destroying a running agent', async () => {
    ctx.agents.set('busy', createMockAgent({ isRunning: true }));

    const result = await tool.execute!({ name: 'busy' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('currently running');
  });

  it('should auto-reclaim delegation when destroying delegated agent', async () => {
    const mockAgent = createMockAgent();
    ctx.agents.set('coder', mockAgent);
    ctx.delegationState.active = true;
    ctx.delegationState.agentName = 'coder';
    ctx.delegationState.turnCount = 5;

    const result = await tool.execute!({ name: 'coder' }) as any;
    expect(result.success).toBe(true);
    expect(result.delegationReclaimed).toBe(true);
    expect(ctx.delegationState.active).toBe(false);
  });

  it('should not set delegationReclaimed for non-delegated agent', async () => {
    ctx.agents.set('dev', createMockAgent());

    const result = await tool.execute!({ name: 'dev' }) as any;
    expect(result.success).toBe(true);
    expect(result.delegationReclaimed).toBe(false);
  });
});

// ============================================================================
// describeCall
// ============================================================================

describe('describeCall', () => {
  it('assign_turn should describe assignment', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'assign_turn');
    expect(tool.describeCall!({ agent: 'dev' })).toBe('assign dev');
  });

  it('delegate_interactive should describe delegation', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'delegate_interactive');
    expect(tool.describeCall!({ agent: 'coder' })).toBe('delegate → coder');
  });

  it('send_message should describe target', () => {
    const ctx = createToolsContext();
    const tool = findTool(buildOrchestrationTools(ctx), 'send_message');
    expect(tool.describeCall!({ agent: 'dev' })).toBe('message → dev');
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
});
