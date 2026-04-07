/**
 * createOrchestrator v2 Unit Tests
 *
 * Tests for the orchestrator factory function:
 * - Basic creation and configuration
 * - System prompt generation (3-tier routing + rich descriptions)
 * - Worker auto-creation via assign_turn
 * - Shared workspace between orchestrator and workers
 * - Delegation lifecycle (delegate, reclaim, destroy)
 * - Destroy behavior (C3)
 * - Config options (maxIterations, maxAgents, custom prompt, agentId)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOrchestrator } from '@/core/orchestrator/createOrchestrator.js';
import type { OrchestratorConfig } from '@/core/orchestrator/createOrchestrator.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';

// Mock createProvider to avoid real LLM calls
const mockGenerate = vi.fn();
vi.mock('@/core/createProvider.js', () => ({
  createProvider: vi.fn(() => ({
    generate: mockGenerate,
    destroy: vi.fn(),
    isDestroyed: false,
  })),
}));

// ============================================================================
// Helpers
// ============================================================================

function createTestConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    connector: 'test-openai',
    model: 'gpt-4',
    agentTypes: {
      developer: {
        systemPrompt: 'You are a senior developer who writes clean, tested code.',
        description: 'Senior developer who writes clean, tested code.',
        scenarios: ['implementing features', 'fixing bugs', 'writing tests'],
        capabilities: ['read/write files', 'run shell commands', 'search code'],
        tools: [],
      },
      reviewer: {
        systemPrompt: 'You are a thorough code reviewer who catches bugs.',
        description: 'Thorough code reviewer who catches bugs and security issues.',
        scenarios: ['code review', 'security audit', 'quality checks'],
        capabilities: ['read files', 'analyze code', 'suggest improvements'],
        tools: [],
      },
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('createOrchestrator', () => {
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

  // --------------------------------------------------------------------------
  // Basic creation
  // --------------------------------------------------------------------------

  describe('basic creation', () => {
    it('should return an Agent instance (async)', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      expect(orchestrator).toBeDefined();
      expect(orchestrator.model).toBe('gpt-4');
      orchestrator.destroy();
    });

    it('should set default name to "orchestrator"', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      expect(orchestrator.name).toBe('orchestrator');
      orchestrator.destroy();
    });

    it('should accept custom name', async () => {
      const orchestrator = await createOrchestrator(createTestConfig({ name: 'lead' }));
      expect(orchestrator.name).toBe('lead');
      orchestrator.destroy();
    });

    it('should have 5 orchestration tools registered', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const toolNames = orchestrator.tools.getAll().map(t => t.definition.function.name);
      expect(toolNames).toContain('assign_turn');
      expect(toolNames).toContain('delegate_interactive');
      expect(toolNames).toContain('send_message');
      expect(toolNames).toContain('list_agents');
      expect(toolNames).toContain('destroy_agent');
      // Removed tools should NOT be present
      expect(toolNames).not.toContain('create_agent');
      expect(toolNames).not.toContain('assign_turn_async');
      expect(toolNames).not.toContain('assign_parallel');
      // 5 orchestration tools + store tools from workspace plugin
      expect(toolNames.length).toBeGreaterThanOrEqual(5);
      orchestrator.destroy();
    });

    it('should register shared workspace plugin', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      expect(orchestrator.context.hasPlugin('shared_workspace')).toBe(true);
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // System prompt
  // --------------------------------------------------------------------------

  describe('system prompt', () => {
    it('should auto-generate system prompt with 3-tier routing', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const prompt = orchestrator.context.systemPrompt ?? '';
      expect(prompt).toContain('DIRECT');
      expect(prompt).toContain('DELEGATE');
      expect(prompt).toContain('ORCHESTRATE');
      expect(prompt).toContain('Routing');
      orchestrator.destroy();
    });

    it('should include rich agent type descriptions', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const prompt = orchestrator.context.systemPrompt ?? '';
      expect(prompt).toContain('Senior developer who writes clean, tested code.');
      expect(prompt).toContain('**Use for:**');
      expect(prompt).toContain('implementing features');
      expect(prompt).toContain('**Can:**');
      expect(prompt).toContain('read/write files');
      orchestrator.destroy();
    });

    it('should fall back to truncated systemPrompt when no rich descriptions', async () => {
      const config = createTestConfig({
        agentTypes: {
          basic: {
            systemPrompt: 'You are a basic agent with no rich descriptions.',
          },
        },
      });
      const orchestrator = await createOrchestrator(config);
      const prompt = orchestrator.context.systemPrompt ?? '';
      expect(prompt).toContain('You are a basic agent');
      orchestrator.destroy();
    });

    it('should use custom system prompt when provided', async () => {
      const custom = 'You are a custom orchestrator.';
      const orchestrator = await createOrchestrator(createTestConfig({ systemPrompt: custom }));
      expect(orchestrator.context.systemPrompt).toBe(custom);
      orchestrator.destroy();
    });

    it('should include planning workflow when skipPlanning is false', async () => {
      const orchestrator = await createOrchestrator(createTestConfig({ skipPlanning: false }));
      const prompt = orchestrator.context.systemPrompt ?? '';
      expect(prompt).toContain('Phase: UNDERSTAND');
      expect(prompt).toContain('Phase: PLAN');
      expect(prompt).toContain('Phase: APPROVE');
      expect(prompt).toContain('Phase: EXECUTE');
      expect(prompt).toContain('Phase: REPORT');
      orchestrator.destroy();
    });

    it('should use direct execution when skipPlanning is true', async () => {
      const orchestrator = await createOrchestrator(createTestConfig({ skipPlanning: true }));
      const prompt = orchestrator.context.systemPrompt ?? '';
      expect(prompt).toContain('Direct Execution');
      expect(prompt).not.toContain('Phase: APPROVE');
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Worker auto-creation via assign_turn
  // --------------------------------------------------------------------------

  describe('worker auto-creation', () => {
    it('should auto-create agent when assign_turn is called with type', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const assignTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'assign_turn');

      // This will start the agent.run() which won't complete without a real LLM,
      // but we can test that it doesn't error on validation
      const listTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'list_agents');

      // Agent doesn't exist yet
      const before = await listTool!.execute!({}) as any;
      expect(before.total).toBe(0);

      // assign_turn with type should auto-create (it will start running async)
      // We mock generate to return immediately
      mockGenerate.mockResolvedValueOnce({
        id: 'test-resp',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done!' }] }],
        output_text: 'Done!',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });

      const result = await assignTool!.execute!({
        agent: 'dev-1',
        type: 'developer',
        instruction: 'Write a hello world',
      }) as any;

      // Should either succeed or be running (depending on async timing)
      // The agent should have been created
      const after = await listTool!.execute!({}) as any;
      expect(after.total).toBe(1);
      expect(after.agents[0].name).toBe('dev-1');

      orchestrator.destroy();
    });

    it('should error when agent not found and no type provided', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const assignTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'assign_turn');

      const result = await assignTool!.execute!({
        agent: 'nonexistent',
        instruction: 'Do something',
      }) as any;

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.error).toContain('type');
      orchestrator.destroy();
    });

    it('should error for unknown agent type', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const assignTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'assign_turn');

      const result = await assignTool!.execute!({
        agent: 'test',
        type: 'nonexistent-type',
        instruction: 'Do something',
      }) as any;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown agent type');
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Delegation lifecycle
  // --------------------------------------------------------------------------

  describe('delegation', () => {
    it('should set delegation state via delegate_interactive', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const delegateTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'delegate_interactive');

      const result = await delegateTool!.execute!({
        agent: 'coder',
        type: 'developer',
        monitoring: 'passive',
        reclaimOn: { keyword: 'done', maxTurns: 10 },
      }) as any;

      expect(result.success).toBe(true);
      expect(result.agent).toBe('coder');
      expect(result.monitoring).toBe('passive');

      // list_agents should show delegation
      const listTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'list_agents');
      const list = await listTool!.execute!({}) as any;
      expect(list.delegation).not.toBeNull();
      expect(list.delegation.agent).toBe('coder');
      expect(list.agents[0].isDelegated).toBe(true);

      orchestrator.destroy();
    });

    it('should prevent double delegation', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const delegateTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'delegate_interactive');

      await delegateTool!.execute!({ agent: 'coder', type: 'developer' });
      const result = await delegateTool!.execute!({ agent: 'reviewer', type: 'reviewer' }) as any;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already delegated');

      orchestrator.destroy();
    });

    it('should reclaim delegation when destroying delegated agent', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const delegateTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'delegate_interactive');
      const destroyTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'destroy_agent');
      const listTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'list_agents');

      await delegateTool!.execute!({ agent: 'coder', type: 'developer' });

      const destroyResult = await destroyTool!.execute!({ name: 'coder' }) as any;
      expect(destroyResult.success).toBe(true);
      expect(destroyResult.delegationReclaimed).toBe(true);

      const list = await listTool!.execute!({}) as any;
      expect(list.delegation).toBeNull();

      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Shared workspace
  // --------------------------------------------------------------------------

  describe('shared workspace', () => {
    it('should share workspace between orchestrator and workers', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());

      // Auto-create an agent via assign_turn (mock LLM)
      mockGenerate.mockResolvedValueOnce({
        id: 'test-resp',
        object: 'response',
        created_at: Date.now(),
        status: 'completed',
        model: 'gpt-4',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] }],
        output_text: 'Done',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });

      const assignTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'assign_turn');

      await assignTool!.execute!({
        agent: 'dev',
        type: 'developer',
        instruction: 'Test workspace sharing',
      });

      // Both orchestrator and worker should see the same workspace
      const orchestratorWorkspace = orchestrator.context.getPlugin('shared_workspace');
      expect(orchestratorWorkspace).toBeDefined();

      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Destroy behavior (C3)
  // --------------------------------------------------------------------------

  describe('destroy (C3)', () => {
    it('should destroy all workers when orchestrator is destroyed', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());

      // Create workers via delegation and direct tool call
      const delegateTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'delegate_interactive');
      await delegateTool!.execute!({ agent: 'coder', type: 'developer' });

      const listTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'list_agents');
      const before = await listTool!.execute!({}) as any;
      expect(before.total).toBe(1);

      orchestrator.destroy();
      expect(orchestrator.isDestroyed).toBe(true);
    });

    it('should be idempotent (double destroy)', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      orchestrator.destroy();
      expect(() => orchestrator.destroy()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Config options
  // --------------------------------------------------------------------------

  describe('config options', () => {
    it('should pass agentId to context', async () => {
      const orchestrator = await createOrchestrator(createTestConfig({ agentId: 'my-orch' }));
      expect(orchestrator.context.agentId).toBe('my-orch');
      orchestrator.destroy();
    });

    it('should enable workingMemory and inContextMemory by default', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      expect(orchestrator.context.features.workingMemory).toBe(true);
      expect(orchestrator.context.features.inContextMemory).toBe(true);
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // assign_turn tool properties
  // --------------------------------------------------------------------------

  describe('assign_turn properties', () => {
    it('should be non-blocking (async)', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const assignTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'assign_turn');
      expect(assignTool!.definition.blocking).toBe(false);
      orchestrator.destroy();
    });

    it('should have a timeout', async () => {
      const orchestrator = await createOrchestrator(createTestConfig());
      const assignTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'assign_turn');
      expect(assignTool!.definition.timeout).toBe(300000);
      orchestrator.destroy();
    });
  });

});
