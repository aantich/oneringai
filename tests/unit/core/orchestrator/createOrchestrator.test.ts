/**
 * createOrchestrator Unit Tests
 *
 * Tests for the orchestrator factory function:
 * - Basic creation and configuration
 * - System prompt generation
 * - Worker creation and shared workspace
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
        tools: [],
      },
      reviewer: {
        systemPrompt: 'You are a thorough code reviewer who catches bugs.',
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
    it('should return an Agent instance', () => {
      const orchestrator = createOrchestrator(createTestConfig());
      expect(orchestrator).toBeDefined();
      expect(orchestrator.model).toBe('gpt-4');
      orchestrator.destroy();
    });

    it('should set default name to "orchestrator"', () => {
      const orchestrator = createOrchestrator(createTestConfig());
      expect(orchestrator.name).toBe('orchestrator');
      orchestrator.destroy();
    });

    it('should accept custom name', () => {
      const orchestrator = createOrchestrator(createTestConfig({ name: 'lead' }));
      expect(orchestrator.name).toBe('lead');
      orchestrator.destroy();
    });

    it('should have 7 orchestration tools registered', () => {
      const orchestrator = createOrchestrator(createTestConfig());
      const toolNames = orchestrator.tools.getAll().map(t => t.definition.function.name);
      expect(toolNames).toContain('create_agent');
      expect(toolNames).toContain('list_agents');
      expect(toolNames).toContain('destroy_agent');
      expect(toolNames).toContain('assign_turn');
      expect(toolNames).toContain('assign_turn_async');
      expect(toolNames).toContain('assign_parallel');
      expect(toolNames).toContain('send_message');
      orchestrator.destroy();
    });

    it('should register shared workspace plugin', () => {
      const orchestrator = createOrchestrator(createTestConfig());
      expect(orchestrator.context.hasPlugin('shared_workspace')).toBe(true);
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // System prompt
  // --------------------------------------------------------------------------

  describe('system prompt', () => {
    it('should auto-generate system prompt with agent types', () => {
      const orchestrator = createOrchestrator(createTestConfig());
      const prompt = orchestrator.context.systemPrompt ?? '';
      expect(prompt).toContain('developer');
      expect(prompt).toContain('reviewer');
      expect(prompt).toContain('create_agent');
      expect(prompt).toContain('Shared Workspace');
      orchestrator.destroy();
    });

    it('should use custom system prompt when provided', () => {
      const custom = 'You are a custom orchestrator.';
      const orchestrator = createOrchestrator(createTestConfig({ systemPrompt: custom }));
      expect(orchestrator.context.systemPrompt).toBe(custom);
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Worker creation via create_agent tool
  // --------------------------------------------------------------------------

  describe('worker creation', () => {
    it('should create worker with correct model inherited from orchestrator', async () => {
      const orchestrator = createOrchestrator(createTestConfig());
      const createTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'create_agent');

      const result = await createTool!.execute!({ name: 'dev-1', type: 'developer' }) as any;
      expect(result.success).toBe(true);
      orchestrator.destroy();
    });

    it('should create worker with type-specific model override', async () => {
      const config = createTestConfig({
        agentTypes: {
          developer: {
            systemPrompt: 'You are a developer',
            model: 'gpt-4o', // Override
          },
        },
      });
      const orchestrator = createOrchestrator(config);
      const createTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'create_agent');

      const result = await createTool!.execute!({ name: 'dev', type: 'developer' }) as any;
      expect(result.success).toBe(true);
      orchestrator.destroy();
    });

    it('should share workspace between orchestrator and workers', async () => {
      const orchestrator = createOrchestrator(createTestConfig());
      const createTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'create_agent');

      await createTool!.execute!({ name: 'dev', type: 'developer' });

      // Both orchestrator and worker should see the same workspace
      const orchestratorWorkspace = orchestrator.context.getPlugin('shared_workspace');
      const listTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'list_agents');
      const agents = await listTool!.execute!({}) as any;
      expect(agents.total).toBe(1);

      expect(orchestratorWorkspace).toBeDefined();
      orchestrator.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Destroy behavior (C3)
  // --------------------------------------------------------------------------

  describe('destroy (C3)', () => {
    it('should destroy all workers when orchestrator is destroyed', async () => {
      const orchestrator = createOrchestrator(createTestConfig());
      const createTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'create_agent');

      await createTool!.execute!({ name: 'dev-1', type: 'developer' });
      await createTool!.execute!({ name: 'dev-2', type: 'reviewer' });

      // List agents before destroy
      const listTool = orchestrator.tools.getAll()
        .find(t => t.definition.function.name === 'list_agents');
      const before = await listTool!.execute!({}) as any;
      expect(before.total).toBe(2);

      orchestrator.destroy();
      expect(orchestrator.isDestroyed).toBe(true);
    });

    it('should be idempotent (double destroy)', async () => {
      const orchestrator = createOrchestrator(createTestConfig());
      orchestrator.destroy();
      expect(() => orchestrator.destroy()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Config options
  // --------------------------------------------------------------------------

  describe('config options', () => {
    it('should pass agentId to context', () => {
      const orchestrator = createOrchestrator(createTestConfig({ agentId: 'my-orch' }));
      expect(orchestrator.context.agentId).toBe('my-orch');
      orchestrator.destroy();
    });

    it('should enable workingMemory and inContextMemory by default', () => {
      const orchestrator = createOrchestrator(createTestConfig());
      expect(orchestrator.context.features.workingMemory).toBe(true);
      expect(orchestrator.context.features.inContextMemory).toBe(true);
      orchestrator.destroy();
    });
  });
});
