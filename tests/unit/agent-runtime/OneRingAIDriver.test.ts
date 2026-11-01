import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { ToolManager } from '@/core/ToolManager.js';
import { PermissionPolicyManager } from '@/core/permissions/PermissionPolicyManager.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import type { IAgentDefinitionStorage, StoredAgentDefinition } from '@/domain/interfaces/IAgentDefinitionStorage.js';
import {
  AgentDriverConfigurationError,
  AgentRuntime,
  LocalExecutionBackend,
  OneRingAIDriver,
} from '@/agent-runtime/index.js';
import { createMockConnector, resetMockProviders } from '../../helpers/mockConnector.js';

describe('OneRingAIDriver', () => {
  beforeEach(() => Connector.clear());
  afterEach(() => {
    Connector.clear();
    resetMockProviders();
  });

  it('materializes definition tools before initialization and preserves the single native manager', async () => {
    const provider = createMockConnector('definition-native'); makeProviderCurrent(provider);
    provider.queueResponses([{ toolCalls: [{ name: 'probe', arguments: {} }], stopReason: 'tool_use' }, { text: 'done', stopReason: 'end_turn' }]);
    const execute = vi.fn(async () => ({ success: false }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({
      drivers: [new OneRingAIDriver({ trustAgentPolicy: true })],
      resolveTools: () => ({ tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object' } } }, execute }], fingerprint: 'scope-v1' }),
    }) });
    try {
      const session = await runtime.createAgent({ id: 'native', instructions: 'Use probe.', tools: ['probe'] }).openSession({ execution: { driver: 'oneringai.agent', connector: 'definition-native', model: 'gpt-4' }, context: { userId: 'user' }, policy: policy() });
      expect((await (await session.run('probe')).result).status).toBe('completed');
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ userId: 'user' }));
    } finally { await runtime.destroy(); }
  });

  it.each(['host', 'native', 'neither'] as const)('retains both native and resolver permissions when %s denies', async deniedBy => {
    const provider = createMockConnector('native-policy'); makeProviderCurrent(provider);
    provider.queueResponses([{ toolCalls: [{ name: 'probe', arguments: {} }], stopReason: 'tool_use' }, { text: 'done', stopReason: 'end_turn' }]);
    const execute = vi.fn(async (..._args: Parameters<ToolFunction['execute']>) => 'ok'); const manager = new ToolManager();
    const hostPolicy = PermissionPolicyManager.fromConfig({ blocklist: deniedBy === 'host' ? ['probe'] : [], allowlist: ['probe'] });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({
      drivers: [new OneRingAIDriver({ trustAgentPolicy: true, configurationRevision: 'permissions-v1', configureAgent: base => ({ ...base, toolManager: manager, permissions: { blocklist: deniedBy === 'native' ? ['probe'] : [], allowlist: ['probe'] } }) })],
      resolveTools: () => ({ tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object' } } }, execute }], fingerprint: 'policy-v1', permissionManager: hostPolicy,
        toolContext: { roles: ['reviewer'], accountId: 'work', connectorAccounts: { service: 'selected' } } }),
    }) });
    try {
      const session = await runtime.createAgent({ id: 'native', instructions: 'Use probe.', tools: ['probe'] }).openSession({ execution: { driver: 'oneringai.agent', connector: 'native-policy', model: 'gpt-4' }, context: { userId: 'trusted' }, policy: policy() });
      const nativePolicy = manager.getPermissionManager(); expect(nativePolicy).not.toBe(hostPolicy);
      await (await session.run('probe')).result;
      expect(execute).toHaveBeenCalledTimes(deniedBy === 'neither' ? 1 : 0);
      expect(manager.getPermissionManager()).toBe(nativePolicy);
      if (deniedBy === 'neither') expect(execute.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ userId: 'trusted', roles: ['reviewer'], accountId: 'work', connectorAccounts: { service: 'selected' } }));
    } finally { await runtime.destroy(); expect(hostPolicy.isDestroyed).toBe(false); hostPolicy.destroy(); }
  });

  it('runs an existing OneRingAI agent with its shared tool manager and normalized tool events', async () => {
    const provider = createMockConnector('runtime-mock');
    makeProviderCurrent(provider);
    provider.queueResponses([
      { toolCalls: [{ name: 'runtime_probe', arguments: { value: 'ping' } }], stopReason: 'tool_use' },
      { text: 'probe complete', stopReason: 'end_turn', inputTokens: 12, outputTokens: 4 },
    ]);
    const execute = vi.fn(async ({ value }) => ({ echoed: value }));
    const tool: ToolFunction = {
      definition: {
        type: 'function',
        function: {
          name: 'runtime_probe',
          description: 'Echo a test value',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
      execute,
    };
    const agent = Agent.create({
      connector: 'runtime-mock',
      model: 'gpt-4',
      userId: 'user-1',
      instructions: 'Use the supplied tool.',
      tools: [tool],
    });
    expect(agent.tools).toBe(agent.context.tools);

    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({ trustAgentPolicy: true, bindings: { existing: { agent, ownership: 'borrowed' } } })],
      }),
    });
    const session = await runtime.agent({
      id: 'one-ring-existing',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'binding', name: 'existing' } },
    }).openSession({ context: { userId: 'user-1' }, policy: policy() });
    const run = await session.run('Run the probe.');
    const result = await run.result;
    const events = await collect(run.events());

    expect(result.status).toBe('completed');
    expect(result.outputText).toBe('probe complete');
    expect(execute).toHaveBeenCalledWith(
      { value: 'ping' },
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(events.map((event) => event.type)).toContain('tool.started');
    expect(events.map((event) => event.type)).toContain('tool.completed');
    await runtime.destroy();
    expect(agent.isDestroyed).toBe(false);
    agent.destroy();
  });

  it('validates structured output through the common JSON Schema validator', async () => {
    const provider = createMockConnector('runtime-structured');
    makeProviderCurrent(provider);
    provider.queueResponse({ text: '{"answer":42}', stopReason: 'end_turn' });
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          trustAgentPolicy: true,
          factories: {
            structured: ({ context }) => Agent.create({
              connector: 'runtime-structured',
              model: 'gpt-4',
              userId: context.userId,
            }),
          },
        })],
      }),
    });
    const session = await runtime.agent({
      id: 'one-ring-structured',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'factory', name: 'structured' } },
    }).openSession({ context: { userId: 'user-1' }, policy: policy() });
    const run = await session.run('Return JSON.', {
      responseFormat: {
        type: 'json_schema',
        name: 'answer',
        strict: true,
        schema: {
          type: 'object',
          properties: { answer: { type: 'number' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    });
    const result = await run.result;
    const events = await collect(run.events());

    expect(result.status).toBe('completed');
    expect(result.outputParsed).toEqual({ answer: 42 });
    expect(result.enforcement?.structuredOutput).toBe('emulated');
    expect(events.map((event) => event.type)).toContain('agent.message.completed');
    await runtime.destroy();
  });

  it('keeps Agent model and managed-context limits synchronized across runtime overrides', async () => {
    createMockConnector('runtime-model-sync');
    const agent = Agent.create({ connector: 'runtime-model-sync', model: 'gpt-4o' });
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          trustAgentPolicy: true,
          bindings: { synchronized: { agent, ownership: 'borrowed' } },
        })],
      }),
    });
    const session = await runtime.agent({
      id: 'model-sync',
      driver: 'oneringai.agent',
      model: 'gpt-4.1',
      driverConfig: { source: { type: 'binding', name: 'synchronized' } },
    }).openSession({ context: {}, policy: policy() });

    expect(agent.model).toBe('gpt-4.1');
    expect(agent.context.model).toBe('gpt-4.1');
    expect(agent.context.maxContextTokens).toBe(1_000_000);
    await session.destroy();
    expect(agent.model).toBe('gpt-4o');
    expect(agent.context.model).toBe('gpt-4o');
    expect(agent.context.maxContextTokens).toBe(128_000);
    await runtime.destroy();
    agent.destroy();
  });

  it('rejects reasoning controls for known non-reasoning models during preflight', async () => {
    createMockConnector('runtime-no-reasoning');
    const agent = Agent.create({ connector: 'runtime-no-reasoning', model: 'gpt-4.1' });
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          trustAgentPolicy: true,
          bindings: { plain: { agent } },
        })],
      }),
    });

    await expect(runtime.agent({
      id: 'no-reasoning',
      driver: 'oneringai.agent',
      model: 'gpt-4.1',
      reasoning: { effort: 'high' },
      driverConfig: { source: { type: 'binding', name: 'plain' } },
    }).inspect({ policy: policy() })).rejects.toThrow(/does not support reasoning/);
    const capabilities = await runtime.agent({
      id: 'no-reasoning-events',
      driver: 'oneringai.agent',
      model: 'gpt-4.1',
      driverConfig: { source: { type: 'binding', name: 'plain' } },
    }).inspect({ policy: policy() });
    expect(capabilities.capabilities['event.reasoning']?.support).toBe('unsupported');
    await runtime.destroy();
    agent.destroy();
  });

  it('fails closed for unverified model-specific reasoning controls', async () => {
    createMockConnector('runtime-reasoning-controls');
    const agent = Agent.create({ connector: 'runtime-reasoning-controls', model: 'gpt-5.3-codex' });
    const driver = new OneRingAIDriver({
      trustAgentPolicy: true,
      bindings: { controlled: { agent, ownership: 'borrowed' } },
    });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const inspect = (reasoning: Record<string, unknown>) => runtime.agent({
      id: 'reasoning-controls',
      driver: driver.id,
      model: 'gpt-5.3-codex',
      reasoning,
      driverConfig: { source: { type: 'binding', name: 'controlled' } },
    } as never).inspect({ policy: policy() });

    await expect(inspect({ effort: 'max' })).rejects.toThrow(/does not support reasoning effort 'max'/);
    await expect(inspect({ enabled: false })).rejects.toThrow(/no verified reasoning-disable mapping/);
    await expect(inspect({ budgetTokens: 4_096 })).rejects.toThrow(/no verified reasoning-token-budget mapping/);

    const capabilities = await inspect({ effort: 'low' });
    expect(capabilities.capabilities['run.reasoning_override']?.constraints).toEqual({
      requiresReasoningModel: true,
      verifiedEfforts: ['low', 'medium', 'high', 'xhigh'],
      supportsDisabled: false,
      supportsBudgetTokens: false,
    });
    await runtime.destroy();
    agent.destroy();
  });

  it('accepts explicitly verified controls for newly supported OneRingAI models', async () => {
    createMockConnector('runtime-custom-reasoning');
    const agent = Agent.create({ connector: 'runtime-custom-reasoning', model: 'gpt-5.6-sol' });
    const driver = new OneRingAIDriver({
      trustAgentPolicy: true,
      bindings: { custom: { agent, ownership: 'borrowed' } },
      modelReasoningControls: {
        'gpt-5.6-sol': {
          efforts: ['high'],
          supportsDisabled: true,
          supportsBudgetTokens: true,
        },
      },
    });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const capabilities = await runtime.agent({
      id: 'custom-reasoning-controls',
      driver: driver.id,
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'high' },
      driverConfig: { source: { type: 'binding', name: 'custom' } },
    }).inspect({ policy: policy() });

    expect(capabilities.capabilities['run.reasoning_override']?.constraints).toMatchObject({
      verifiedEfforts: ['high'],
      supportsDisabled: true,
      supportsBudgetTokens: true,
    });
    await runtime.destroy();
    agent.destroy();
  });

  it('destroys a factory-created agent when post-creation model validation fails', async () => {
    createMockConnector('runtime-factory-cleanup');
    let created: Agent | undefined;
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          trustAgentPolicy: true,
          factories: {
            mismatched: () => {
              created = Agent.create({ connector: 'runtime-factory-cleanup', model: 'gpt-4.1' });
              return created;
            },
          },
        })],
      }),
    });

    await expect(runtime.agent({
      id: 'factory-cleanup',
      driver: 'oneringai.agent',
      model: 'claude-sonnet-4-6',
      driverConfig: { source: { type: 'factory', name: 'mismatched' } },
    }).openSession({ context: {}, policy: policy() })).rejects.toThrow(/connector vendor/);
    expect(created?.isDestroyed).toBe(true);
    await runtime.destroy();
  });

  it('applies generic model/reasoning overrides and preserves live reasoning events', async () => {
    createMockConnector('runtime-observable');
    const agent = Agent.create({ connector: 'runtime-observable', model: 'gpt-5.3-codex' });
    const stream = vi.spyOn(agent, 'stream').mockImplementation((async function* () {
      yield {
        type: StreamEventType.REASONING_DELTA,
        response_id: 'response-1',
        item_id: 'reason-1',
        delta: 'Checking the workspace',
        sequence_number: 1,
      };
      yield {
        type: StreamEventType.REASONING_DONE,
        response_id: 'response-1',
        item_id: 'reason-1',
        thinking: 'Checking the workspace',
      };
      yield {
        type: StreamEventType.OUTPUT_TEXT_DELTA,
        response_id: 'response-1',
        item_id: 'message-1',
        output_index: 0,
        content_index: 0,
        delta: 'done',
        sequence_number: 2,
      };
      yield {
        type: StreamEventType.OUTPUT_TEXT_DONE,
        response_id: 'response-1',
        item_id: 'message-1',
        output_index: 0,
        text: 'done',
      };
      yield {
        type: StreamEventType.RESPONSE_COMPLETE,
        response_id: 'response-1',
        status: 'completed',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        iterations: 1,
      };
    }) as never);
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          trustAgentPolicy: true,
          bindings: { observable: { agent, ownership: 'borrowed' } },
        })],
      }),
    });
    const session = await runtime.agent({
      id: 'observable-onering',
      driver: 'oneringai.agent',
      model: 'gpt-5.3-codex',
      reasoning: { effort: 'medium' },
      driverConfig: { source: { type: 'binding', name: 'observable' } },
    }).openSession({ context: {}, policy: policy() });
    const run = await session.run('work', {
      model: 'gpt-6-astra',
      reasoning: { effort: 'high' },
    });
    const result = await run.result;
    const events = await collect(run.events());

    expect(result.configuration).toEqual({ model: 'gpt-6-astra', reasoning: { effort: 'high' } });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'reasoning.delta',
      'reasoning.completed',
      'agent.message.delta',
      'agent.message.completed',
    ]));
    expect(events
      .filter((event) => event.type === 'agent.message.delta' || event.type === 'agent.message.completed')
      .every((event) => event.data.phase === 'unknown')).toBe(true);
    expect(stream).toHaveBeenCalledWith('work', {
      thinking: { enabled: true, effort: 'high' },
    });
    await runtime.destroy();
    agent.destroy();
  });

  it('prevents a mutable bound agent from backing concurrent runtime sessions', async () => {
    createMockConnector('runtime-bound');
    const agent = Agent.create({ connector: 'runtime-bound', model: 'gpt-4' });
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({ trustAgentPolicy: true, bindings: { only: { agent } } })],
      }),
    });
    const runtimeAgent = runtime.agent({
      id: 'one-ring-bound',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'binding', name: 'only' } },
    });
    await runtimeAgent.openSession({ context: {}, policy: policy() });
    await expect(runtimeAgent.openSession({ context: {}, policy: policy() }))
      .rejects.toBeInstanceOf(AgentDriverConfigurationError);
    await runtime.destroy();
    agent.destroy();
  });

  it('loads stored agent definitions with the runtime connector registry and user scope', async () => {
    createMockConnector('runtime-stored');
    const definition: StoredAgentDefinition = {
      version: 1,
      agentId: 'stored-agent',
      name: 'Stored agent',
      agentType: 'agent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      connector: { name: 'runtime-stored', model: 'gpt-4' },
    };
    const storage: IAgentDefinitionStorage = {
      save: vi.fn(),
      load: vi.fn(async (agentId) => agentId === definition.agentId ? definition : null),
      delete: vi.fn(),
      exists: vi.fn(async () => true),
      list: vi.fn(async () => []),
      getPath: () => 'memory://agent-definitions',
    };
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({ trustAgentPolicy: true, definitionStorage: storage })],
      }),
    });
    const session = await runtime.agent({
      id: 'stored-runtime-agent',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'stored-definition', agentId: definition.agentId } },
    }).openSession({ context: { userId: 'stored-user' }, policy: policy() });

    expect(session.state).toBe('ready');
    expect(storage.load).toHaveBeenCalledWith(definition.agentId);
    await runtime.destroy();
  });

  it('returns a structured-output error without disguising it as a native failure', async () => {
    const provider = createMockConnector('runtime-invalid-json');
    makeProviderCurrent(provider);
    provider.queueResponse({ text: '{"answer":"wrong"}', stopReason: 'end_turn' });
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          trustAgentPolicy: true,
          factories: {
            invalid: () => Agent.create({ connector: 'runtime-invalid-json', model: 'gpt-4' }),
          },
        })],
      }),
    });
    const session = await runtime.agent({
      id: 'invalid-structured',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'factory', name: 'invalid' } },
    }).openSession({ context: {}, policy: policy() });
    const result = await (await session.run('Return JSON.', {
      responseFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { answer: { type: 'number' } },
          required: ['answer'],
        },
      },
    })).result;

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_STRUCTURED_OUTPUT');
    expect(result.finishReason).toBe('structured_output_invalid');
    await runtime.destroy();
  });

  it('rejects invalid sources, overrides, interactive approval, and mismatched binding scope', async () => {
    createMockConnector('runtime-validation');
    const bound = Agent.create({ connector: 'runtime-validation', model: 'gpt-4', userId: 'owner' });
    const strictRuntime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({
          factories: { strict: () => Agent.create({ connector: 'runtime-validation', model: 'gpt-4' }) },
        })],
      }),
    });
    await expect(strictRuntime.agent({
      id: 'strict-policy',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'factory', name: 'strict' } },
    }).inspect({ policy: policy() })).rejects.toThrow(/trustAgentPolicy/);
    await strictRuntime.destroy();
    const driver = new OneRingAIDriver({
      trustAgentPolicy: true,
      bindings: { bound: { agent: bound } },
      factories: { factory: () => Agent.create({ connector: 'runtime-validation', model: 'gpt-4' }) },
    });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const inspect = (driverConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) => runtime.agent({
      id: 'invalid-onering',
      driver: driver.id,
      driverConfig,
      ...extra,
    }).inspect({ policy: policy() });

    await expect(inspect({})).rejects.toThrow(/source is required/);
    await expect(inspect({ source: { type: 'binding', name: 'missing' } })).rejects.toThrow(/not registered/);
    await expect(inspect({ source: { type: 'factory', name: 'missing' } })).rejects.toThrow(/not registered/);
    await expect(inspect({ source: { type: 'factory', name: 'factory' } }, { connector: 'runtime-validation' }))
      .rejects.toThrow(/runtime overrides/);
    await expect(runtime.agent({
      id: 'interactive-onering',
      driver: driver.id,
      driverConfig: { source: { type: 'factory', name: 'factory' } },
    }).inspect({ policy: { ...policy(), approvals: 'interactive' } }))
      .rejects.toThrow(/interactive approvals/);
    await expect(runtime.agent({
      id: 'scoped-onering',
      driver: driver.id,
      driverConfig: { source: { type: 'binding', name: 'bound' } },
    }).openSession({ context: { userId: 'another-user' }, policy: policy() }))
      .rejects.toThrow(/user scope/);
    await runtime.destroy();
    bound.destroy();
  });

  it('destroys an explicitly owned bound agent', async () => {
    createMockConnector('runtime-owned');
    const owned = Agent.create({ connector: 'runtime-owned', model: 'gpt-4' });
    const runtime = new AgentRuntime({
      backend: new LocalExecutionBackend({
        drivers: [new OneRingAIDriver({ trustAgentPolicy: true, bindings: { owned: { agent: owned, ownership: 'owned' } } })],
      }),
    });
    await runtime.agent({
      id: 'owned-onering',
      driver: 'oneringai.agent',
      driverConfig: { source: { type: 'binding', name: 'owned' } },
    }).openSession({ context: {}, policy: policy() });
    await runtime.destroy();
    expect(owned.isDestroyed).toBe(true);
  });
});

function policy() {
  return {
    filesystem: 'denied' as const,
    commands: 'denied' as const,
    sandboxNetwork: 'denied' as const,
    providerWebSearch: 'denied' as const,
    approvals: 'deny' as const,
  };
}

function makeProviderCurrent(provider: ReturnType<typeof createMockConnector>): void {
  const legacyGenerate = provider.generate.bind(provider);
  const current = provider as ReturnType<typeof createMockConnector> & {
    getModelCapabilities: () => {
      supportsTools: boolean;
      supportsVision: boolean;
      supportsJSON: boolean;
      supportsJSONSchema: boolean;
      maxTokens: number;
      maxOutputTokens: number;
    };
    streamGenerate: (options: unknown) => AsyncIterable<unknown>;
    generate: (options: unknown) => Promise<unknown>;
  };
  current.generate = async (options: unknown) => {
    const response = await legacyGenerate([], options as never);
    return {
      id: `response-${Date.now()}`,
      object: 'response',
      created_at: Date.now(),
      status: 'completed',
      model: 'gpt-4',
      ...response,
    };
  };
  current.getModelCapabilities = () => ({
    supportsTools: true,
    supportsVision: false,
    supportsJSON: true,
    supportsJSONSchema: true,
    maxTokens: 128_000,
    maxOutputTokens: 16_384,
  });
  current.streamGenerate = (options: unknown) => (async function* () {
    const response = await current.generate(options) as Awaited<ReturnType<typeof legacyGenerate>> & {
      status: 'completed';
    };
    const responseId = `response-${Date.now()}`;
    let sequence = 0;
    for (const output of response.output) {
      for (const content of output.type === 'message' ? output.content : []) {
        if (content.type === 'text') {
          yield {
            type: StreamEventType.OUTPUT_TEXT_DELTA,
            response_id: responseId,
            item_id: 'message-1',
            output_index: 0,
            content_index: 0,
            delta: content.text,
            sequence_number: ++sequence,
          };
          yield {
            type: StreamEventType.OUTPUT_TEXT_DONE,
            response_id: responseId,
            item_id: 'message-1',
            output_index: 0,
            text: content.text,
          };
        } else if (content.type === 'tool_use') {
          yield {
            type: StreamEventType.TOOL_CALL_START,
            response_id: responseId,
            item_id: content.id,
            tool_call_id: content.id,
            tool_name: content.name,
          };
          yield {
            type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
            response_id: responseId,
            tool_call_id: content.id,
            tool_name: content.name,
            arguments: typeof content.arguments === 'string' ? content.arguments : JSON.stringify(content.arguments),
          };
        }
      }
    }
    yield {
      type: StreamEventType.RESPONSE_COMPLETE,
      response_id: responseId,
      status: 'completed',
      usage: response.usage,
      iterations: 1,
      stop_reason: response.stopReason,
    };
  })();
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}
