/**
 * createRoutineTool Unit Tests
 *
 * Tests the factory that converts RoutineDefinition → non-blocking ToolFunction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoutineTool, registerRoutineToolCategory } from '@/core/createRoutineTool.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import type { RoutineDefinition } from '@/domain/entities/Routine.js';
import { ToolCatalogRegistry } from '@/core/ToolCatalogRegistry.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';

// ============================================================================
// Mock Provider
// ============================================================================

const mockGenerate = vi.fn();
const mockProvider = {
  name: 'openai',
  capabilities: { text: true, images: true, videos: false, audio: false },
  generate: mockGenerate,
  streamGenerate: vi.fn(),
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
    output: [{
      type: 'message',
      id: `msg_${Date.now()}`,
      role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text, annotations: [] }],
    }],
    output_text: text,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  };
}

function createTestRoutine(overrides?: Partial<RoutineDefinition>): RoutineDefinition {
  return createRoutineDefinition({
    name: 'Weekly Report',
    description: 'Fetch data and generate a weekly report',
    parameters: [
      { name: 'email', description: 'Recipient email', required: true },
      { name: 'format', description: 'Output format', default: 'markdown' },
    ],
    tasks: [
      { name: 'Analyze', description: 'Analyze data' },
      { name: 'Report', description: 'Generate report', dependsOn: ['Analyze'] },
    ],
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('createRoutineTool', () => {
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

  describe('tool definition', () => {
    it('should derive tool name from routine name', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      expect(tool.definition.function.name).toBe('routine_weekly_report');
    });

    it('should sanitize special characters in routine name', () => {
      const routine = createTestRoutine({ name: 'My Complex Routine!! (v2)' });
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      expect(tool.definition.function.name).toBe('routine_my_complex_routine_v2');
    });

    it('should use custom toolName when provided', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
        toolName: 'my_custom_tool',
      });

      expect(tool.definition.function.name).toBe('my_custom_tool');
    });

    it('should set blocking: false', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      expect(tool.definition.blocking).toBe(false);
    });

    it('should set timeout from routine timeoutMs', () => {
      const routine = createTestRoutine({ timeoutMs: 120000 });
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      expect(tool.definition.timeout).toBe(120000);
    });

    it('should default timeout to 1 hour when timeoutMs not set', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      expect(tool.definition.timeout).toBe(3_600_000);
    });

    it('should derive parameters schema from RoutineParameter[]', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      const params = tool.definition.function.parameters!;
      expect(params.properties).toHaveProperty('email');
      expect(params.properties).toHaveProperty('format');
      expect((params.properties as Record<string, any>).email.description).toBe('Recipient email');
      expect((params.properties as Record<string, any>).format.default).toBe('markdown');
      expect(params.required).toEqual(['email']);
    });

    it('should handle routine with no parameters', () => {
      const routine = createTestRoutine({ parameters: undefined });
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      const params = tool.definition.function.parameters!;
      expect(params.properties).toEqual({});
      expect(params.required).toBeUndefined();
    });

    it('should use routine description as tool description', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      expect(tool.definition.function.description).toBe('Fetch data and generate a weekly report');
    });
  });

  describe('execution', () => {
    it('should call createAgent, run routine, destroy agent, and return results', async () => {
      const routine = createTestRoutine();
      const destroySpy = vi.fn();

      mockGenerate.mockResolvedValue(makeTextResponse('Done'));

      const { Agent } = await import('@/core/Agent.js');
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => {
          const agent = Agent.create({
            connector: 'test-openai',
            model: 'gpt-4',
          });
          const origDestroy = agent.destroy.bind(agent);
          agent.destroy = () => { destroySpy(); origDestroy(); };
          return agent;
        },
      });

      const result = await tool.execute({ email: 'test@example.com' }) as any;

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].task).toBe('Analyze');
      expect(result.results[1].task).toBe('Report');
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it('should destroy agent even when routine fails', async () => {
      const routine = createTestRoutine({ requiredPlugins: ['nonexistent_plugin'], parameters: undefined });
      const destroySpy = vi.fn();

      const { Agent } = await import('@/core/Agent.js');
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => {
          const agent = Agent.create({ connector: 'test-openai', model: 'gpt-4' });
          const origDestroy = agent.destroy.bind(agent);
          agent.destroy = () => { destroySpy(); origDestroy(); };
          return agent;
        },
      });

      const result = await tool.execute({}) as any;

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('describeCall', () => {
    it('should produce a readable call description', () => {
      const routine = createTestRoutine();
      const tool = createRoutineTool({
        definition: routine,
        createAgent: () => { throw new Error('not called'); },
      });

      const desc = tool.describeCall!({ email: 'alice@test.com', format: 'html' });
      expect(desc).toContain('Weekly Report');
      expect(desc).toContain('email=alice@test.com');
      expect(desc).toContain('format=html');
    });
  });
});

describe('registerRoutineToolCategory', () => {
  afterEach(() => {
    // Clean up registered categories
    try {
      ToolCatalogRegistry.unregisterCategory('routines:executable');
    } catch { /* may not exist */ }
  });

  it('should register a category with tools in ToolCatalogRegistry', () => {
    const routineA = createTestRoutine({ name: 'Routine A' });
    const routineB = createTestRoutine({ name: 'Routine B' });

    registerRoutineToolCategory({
      definitions: [routineA, routineB],
      createAgent: () => { throw new Error('not called in registration'); },
    });

    const categories = ToolCatalogRegistry.getCategories();
    const cat = categories.find(c => c.name === 'routines:executable');
    expect(cat).toBeDefined();
    expect(cat!.displayName).toBe('Executable Routines');

    const tools = ToolCatalogRegistry.getToolsInCategory('routines:executable');
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toContain('routine_routine_a');
    expect(tools.map(t => t.name)).toContain('routine_routine_b');
  });

  it('should use custom category name', () => {
    const routine = createTestRoutine();

    registerRoutineToolCategory({
      definitions: [routine],
      createAgent: () => { throw new Error('not called'); },
      categoryName: 'my:routines',
      categoryDisplayName: 'My Routines',
    });

    const categories = ToolCatalogRegistry.getCategories();
    const cat = categories.find(c => c.name === 'my:routines');
    expect(cat).toBeDefined();
    expect(cat!.displayName).toBe('My Routines');

    // Clean up
    try { ToolCatalogRegistry.unregisterCategory('my:routines'); } catch { /* ok */ }
  });
});
