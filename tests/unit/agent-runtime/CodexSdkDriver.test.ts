import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodexOptions, Input, ThreadEvent, ThreadOptions, TurnOptions } from '@openai/codex-sdk';
import {
  AgentRuntime,
  AgentDriverConfigurationError,
  AgentRuntimeDependencyError,
  LocalExecutionBackend,
} from '@/agent-runtime/index.js';
import { CodexSdkDriver } from '@/agent-runtime/codex.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';

const temporaryDirectories: string[] = [];
let capturedCodexOptions: CodexOptions | undefined;
let capturedThreadOptions: ThreadOptions | undefined;
let capturedInput: Input | undefined;
let capturedTurnOptions: TurnOptions | undefined;
let nativeEvents: (signal: AbortSignal | undefined) => AsyncIterable<ThreadEvent>;
let startThreadCalls = 0;
let resumeThreadCalls = 0;
let resumedThreadId: string | undefined;

describe('CodexSdkDriver', () => {
  beforeEach(() => {
    Connector.clear();
    Connector.create({
      name: 'codex-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'unit-test-secret' },
    });
    capturedCodexOptions = undefined;
    capturedThreadOptions = undefined;
    capturedInput = undefined;
    capturedTurnOptions = undefined;
    startThreadCalls = 0;
    resumeThreadCalls = 0;
    resumedThreadId = undefined;
    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-123' },
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'message-1', type: 'agent_message', text: 'hel' } },
      { type: 'item.updated', item: { id: 'message-1', type: 'agent_message', text: 'hello' } },
      { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: 'hello' } },
      { type: 'turn.completed', usage: usage() },
    ]);
  });

  afterEach(async () => {
    Connector.clear();
    delete process.env.RUNTIME_TEST_SECRET;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('isolates configuration and normalizes Codex messages, commands, changes, and usage', async () => {
    process.env.RUNTIME_TEST_SECRET = 'must-not-leak';
    const workspace = await temporaryDirectory();
    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-123' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: { id: 'command-1', type: 'command_execution', command: 'pwd', aggregated_output: '', status: 'in_progress' },
      },
      {
        type: 'item.completed',
        item: { id: 'command-1', type: 'command_execution', command: 'pwd', aggregated_output: `workspace=${workspace};unit-test-secret`, exit_code: 0, status: 'completed' },
      },
      {
        type: 'item.completed',
        item: { id: 'change-1', type: 'file_change', changes: [{ path: 'result.txt', kind: 'add' }], status: 'completed' },
      },
      {
        type: 'item.completed',
        item: { id: 'change-outside', type: 'file_change', changes: [{ path: '../outside.txt', kind: 'update' }], status: 'failed' },
      },
      {
        type: 'item.started',
        item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'demo', tool: 'probe', arguments: { token: 'unit-test-secret' }, status: 'in_progress' },
      },
      {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'demo',
          tool: 'probe',
          arguments: {},
          result: { content: [], structured_content: { token: 'unit-test-secret' } },
          status: 'completed',
        },
      },
      { type: 'item.started', item: { id: 'search-1', type: 'web_search', query: 'runtime query' } },
      { type: 'item.completed', item: { id: 'search-1', type: 'web_search', query: 'runtime query' } },
      { type: 'item.completed', item: { id: 'reason-1', type: 'reasoning', text: 'safe summary unit-test-secret' } },
      { type: 'item.completed', item: { id: 'todo-1', type: 'todo_list', items: [{ text: 'done', completed: true }] } },
      { type: 'item.completed', item: { id: 'error-1', type: 'error', message: 'non-fatal unit-test-secret' } },
      { type: 'item.started', item: { id: 'message-1', type: 'agent_message', text: 'hel' } },
      { type: 'item.updated', item: { id: 'message-1', type: 'agent_message', text: 'hello' } },
      { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: 'hello' } },
      { type: 'turn.completed', usage: usage() },
    ]);
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: { tenantId: 'tenant-1', userId: 'user-1' },
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const run = await session.run('perform the task');
    const result = await run.result;
    const normalized = await collect(run.events());

    expect(result.status).toBe('completed');
    expect(result.outputText).toBe('hello');
    expect(result.artifacts).toEqual([{ type: 'workspace-change', path: 'result.txt', change: 'created' }]);
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(normalized.map((event) => event.type)).toEqual(expect.arrayContaining([
      'command.started',
      'command.output.delta',
      'command.completed',
      'file.changed',
      'reasoning.delta',
      'reasoning.completed',
      'plan.updated',
      'agent.message.delta',
      'agent.message.completed',
      'usage.updated',
    ]));
    expect(JSON.stringify({ result, normalized })).not.toContain('unit-test-secret');
    expect(JSON.stringify(normalized)).toContain('[REDACTED]');
    expect(capturedInput).toBe('perform the task');
    expect(capturedCodexOptions?.apiKey).toBe('unit-test-secret');
    expect(capturedCodexOptions?.baseUrl).toBe('https://api.openai.com/v1');
    expect(capturedCodexOptions?.env?.RUNTIME_TEST_SECRET).toBeUndefined();
    expect(capturedCodexOptions?.env?.OPENAI_API_KEY).toBeUndefined();
    expect(capturedCodexOptions?.env?.HOME).toBe(capturedCodexOptions?.env?.CODEX_HOME);
    expect(capturedCodexOptions?.config).toMatchObject({
      developer_instructions: 'Act as a coding agent.',
      model_provider: 'openai',
      show_raw_agent_reasoning: false,
      allow_login_shell: false,
      agents: { enabled: false },
      shell_environment_policy: {
        inherit: 'core',
        ignore_default_excludes: false,
        exclude: ['*KEY*', '*SECRET*', '*TOKEN*'],
        include_only: expect.arrayContaining(['PATH', 'HOME', 'LC_*']),
      },
    });
    expect(capturedThreadOptions).toMatchObject({
      model: 'gpt-5.3-codex',
      sandboxMode: 'workspace-write',
      workingDirectory: await realpath(workspace),
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      approvalPolicy: 'never',
    });
    await runtime.destroy();
  });

  it('resolves and validates rotating API keys when opening a Codex session', async () => {
    Connector.remove('codex-test');
    let currentKey = 'rotating-session-key';
    let resolutions = 0;
    Connector.create({
      name: 'codex-test',
      vendor: Vendor.OpenAI,
      auth: {
        type: 'api_key_provider',
        getApiKey: async () => {
          resolutions++;
          return currentKey;
        },
      },
    });
    const workspace = await temporaryDirectory();
    const runtime = runtimeWithFakeSdk();

    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    expect(capturedCodexOptions?.apiKey).toBe('rotating-session-key');
    expect(resolutions).toBe(1);
    await session.destroy();

    currentKey = '   ';
    await expect(runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    })).rejects.toThrow("Connector 'codex-test' API key provider returned an empty key");
    expect(resolutions).toBe(2);
    await runtime.destroy();
  });

  it('continues a second turn by resuming the native Codex thread', async () => {
    const workspace = await temporaryDirectory();
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });

    expect((await (await session.run('first turn')).result).status).toBe('completed');
    expect((await (await session.run('second turn')).result).status).toBe('completed');
    expect(startThreadCalls).toBe(1);
    expect(resumeThreadCalls).toBe(1);
    expect(resumedThreadId).toBe('thread-123');
    await runtime.destroy();
  });

  it('fails reasoning preflight for non-reasoning and unverified model/effort pairs', async () => {
    const workspace = await temporaryDirectory();
    const runtime = runtimeWithFakeSdk();
    const open = (model: string) => runtime.agent({
      id: `codex-${model}`,
      driver: 'openai.codex.sdk',
      connector: 'codex-test',
      model,
      reasoning: { effort: 'high' },
    }).inspect({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });

    await expect(open('gpt-4.1')).rejects.toThrow(/does not support reasoning/);
    await expect(open('gpt-5.5-pro')).rejects.toThrow(/no verified reasoning-effort mapping/);
    await runtime.destroy();

    const configured = runtimeWithFakeSdk({ 'gpt-5.5-pro': ['high'] });
    const capabilities = await configured.agent({
      id: 'codex-configured-reasoning',
      driver: 'openai.codex.sdk',
      connector: 'codex-test',
      model: 'gpt-5.5-pro',
      reasoning: { effort: 'high' },
    }).inspect({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    expect(capabilities.capabilities['run.reasoning_override']?.constraints?.verifiedEfforts)
      .toEqual(['high']);
    await configured.destroy();
  });

  it('passes native output schemas and validates the final response', async () => {
    const workspace = await temporaryDirectory();
    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-json' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'message-json', type: 'agent_message', text: '{"ok":true}' } },
      { type: 'turn.completed', usage: usage() },
    ]);
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    const result = await (await session.run('json', {
      responseFormat: { type: 'json_schema', name: 'result', strict: true, schema },
    })).result;

    expect(capturedTurnOptions?.outputSchema).toEqual(schema);
    expect(result.outputParsed).toEqual({ ok: true });
    expect(result.enforcement).toEqual({ structuredOutput: 'native' });
    await runtime.destroy();
  });

  it('selects model and reasoning generically at session and run scope', async () => {
    const workspace = await temporaryDirectory();
    const runtime = runtimeWithFakeSdk();
    const session = await runtime.agent({
      id: 'codex-configurable',
      driver: 'openai.codex.sdk',
      connector: 'codex-test',
      model: 'gpt-5.3-codex',
      reasoning: { effort: 'medium' },
    }).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const result = await (await session.run('override', {
      model: 'gpt-6.1-sol',
      reasoning: { effort: 'ultra' },
    })).result;

    expect(capturedThreadOptions).toMatchObject({
      model: 'gpt-6.1-sol',
      modelReasoningEffort: 'ultra',
    });
    expect(result.configuration).toEqual({ model: 'gpt-6.1-sol', reasoning: { effort: 'ultra' } });
    await runtime.destroy();
  });

  it('redacts a credential even when it arrives across incremental message updates', async () => {
    const workspace = await temporaryDirectory();
    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-redaction' },
      { type: 'item.started', item: { id: 'message-secret', type: 'agent_message', text: 'unit-' } },
      { type: 'item.updated', item: { id: 'message-secret', type: 'agent_message', text: 'unit-test-' } },
      { type: 'item.completed', item: { id: 'message-secret', type: 'agent_message', text: 'unit-test-secret' } },
      { type: 'turn.completed', usage: usage() },
    ]);
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const run = await session.run('do not leak');
    const result = await run.result;
    const deltas = (await collect(run.events()))
      .filter((event) => event.type === 'agent.message.delta')
      .map((event) => String(event.data.text ?? ''))
      .join('');

    expect(deltas).toBe('[REDACTED]');
    expect(result.outputText).toBe('[REDACTED]');
    expect(deltas).not.toContain('unit-test-');
    await runtime.destroy();
  });

  it('fails a native structured response that does not satisfy the requested schema', async () => {
    const workspace = await temporaryDirectory();
    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-json-invalid' },
      { type: 'item.completed', item: { id: 'message-json', type: 'agent_message', text: '{"ok":"no"}' } },
      { type: 'turn.completed', usage: usage() },
    ]);
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const result = await (await session.run('invalid json schema', {
      responseFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
        },
      },
    })).result;
    expect(result).toMatchObject({
      status: 'failed',
      finishReason: 'structured_output_invalid',
      error: { code: 'AGENT_STRUCTURED_OUTPUT' },
    });
    await runtime.destroy();
  });

  it('propagates cancellation through the SDK AbortSignal', async () => {
    const workspace = await temporaryDirectory();
    nativeEvents = (signal) => (async function* () {
      yield { type: 'turn.started' };
      if (!signal?.aborted) {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      }
      throw signal?.reason ?? new Error('aborted');
    })();
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const run = await session.run('wait');
    await viWaitFor(() => capturedTurnOptions?.signal !== undefined);
    await run.cancel('stop');
    expect(capturedTurnOptions?.signal?.aborted).toBe(true);
    expect((await run.result).status).toBe('cancelled');
    await runtime.destroy();
  });

  it('rejects project Codex config unless the workspace is explicitly trusted', async () => {
    const workspace = await temporaryDirectory();
    await mkdir(path.join(workspace, '.codex'));
    await writeFile(path.join(workspace, '.codex', 'config.toml'), '[mcp_servers.untrusted]\nurl="https://example.com"\n');
    const runtime = runtimeWithFakeSdk();
    await expect(runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    })).rejects.toBeInstanceOf(AgentDriverConfigurationError);
    await runtime.destroy();
  });

  it('rechecks disabled project configuration before every turn', async () => {
    const workspace = await temporaryDirectory();
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    await mkdir(path.join(workspace, '.codex'));
    await writeFile(path.join(workspace, '.codex', 'config.toml'), '[mcp_servers.late]\ncommand="late"\n');
    const result = await (await session.run('must fail')).result;
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('appeared after session creation');
    await runtime.destroy();
  });

  it('allows explicitly trusted local project config while retaining runtime overrides', async () => {
    const workspace = await temporaryDirectory();
    await mkdir(path.join(workspace, '.codex'));
    await writeFile(path.join(workspace, '.codex', 'config.toml'), 'model_reasoning_effort="high"\n');
    const runtime = runtimeWithFakeSdk();
    const session = await runtime.agent({
      id: 'trusted-codex-agent',
      driver: 'openai.codex.sdk',
      connector: 'codex-test',
      model: 'gpt-5.3-codex',
      driverConfig: { allowProjectConfig: true },
    }).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    expect(session.state).toBe('ready');
    expect(capturedCodexOptions?.config).toMatchObject({ model_provider: 'openai', allow_login_shell: false });
    await runtime.destroy();
  });

  it('rejects policies the Codex SDK cannot enforce', async () => {
    const workspace = await temporaryDirectory();
    const runtime = runtimeWithFakeSdk();
    await expect(runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: { ...policy(), commands: 'denied' },
    })).rejects.toThrow(/shell-disabled/);
    await runtime.destroy();
  });

  it('reports missing or incompatible optional SDKs as typed dependency errors', async () => {
    const workspace = await temporaryDirectory();
    const driver = new CodexSdkDriver({
      loadSdk: async () => { throw new Error('module missing'); },
    });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    await expect(runtime.agent({
      id: 'codex-missing-sdk',
      driver: driver.id,
      connector: 'codex-test',
      model: 'gpt-5.3-codex',
    }).inspect({
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    })).rejects.toBeInstanceOf(AgentRuntimeDependencyError);
    await runtime.destroy();
  });

  it('normalizes failed and incomplete native turns', async () => {
    const workspace = await temporaryDirectory();
    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-failed' },
      { type: 'turn.failed', error: { message: 'native failed' } },
    ]);
    const runtime = runtimeWithFakeSdk();
    const failedSession = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const failed = await (await failedSession.run('fail')).result;
    expect(failed).toMatchObject({
      status: 'failed',
      finishReason: 'native_error',
      error: { code: 'CODEX_TURN_FAILED' },
    });

    nativeEvents = () => events([
      { type: 'thread.started', thread_id: 'thread-incomplete' },
      { type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'partial' } },
    ]);
    const incompleteSession = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const incomplete = await (await incompleteSession.run('incomplete')).result;
    expect(incomplete).toMatchObject({
      status: 'failed',
      finishReason: 'stream_incomplete',
      error: { code: 'CODEX_STREAM_INCOMPLETE' },
    });
    await runtime.destroy();
  });

  it('rejects malformed specs, driver config, connectors, and contextual policy', async () => {
    const workspace = await temporaryDirectory();
    Connector.create({
      name: 'codex-wrong-vendor',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: 'not-used' },
    });
    Connector.create({
      name: 'codex-no-key',
      vendor: Vendor.OpenAI,
      auth: { type: 'none' },
    });
    Connector.create({
      name: 'codex-org-project',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'not-used' },
      options: { organization: 'org-test', project: 'project-test' },
    });
    const driver = new CodexSdkDriver({ loadSdk: async () => ({ Codex: FakeCodex as never }) });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const inspect = (spec: Record<string, unknown>, requestedPolicy = policy(), includeWorkspace = true) => runtime.agent({
      id: 'invalid-codex',
      driver: driver.id,
      ...(spec as object),
    } as never).inspect({
      ...(includeWorkspace ? { workspace: { type: 'local-directory' as const, path: workspace } } : {}),
      policy: requestedPolicy,
    });

    await expect(inspect({ model: 'gpt-5.3-codex' })).rejects.toThrow(/connector is required/);
    await expect(inspect({ connector: 'codex-test' })).rejects.toThrow(/model is required/);
    await expect(inspect({ connector: 'codex-test', model: 'gpt-5.3-codex', driverConfig: { unknown: true } }))
      .rejects.toThrow(/Unknown Codex SDK/);
    await expect(inspect({ connector: 'codex-test', model: 'gpt-5.3-codex', reasoning: { effort: 'max' } }))
      .rejects.toThrow(/does not support reasoning effort/);
    await expect(inspect({ connector: 'codex-test', model: 'gpt-5.3-codex', driverConfig: { skipGitRepoCheck: 'yes' } }))
      .rejects.toThrow(/must be a boolean/);
    await expect(inspect({ connector: 'codex-wrong-vendor', model: 'gpt-5.3-codex' }))
      .rejects.toThrow(/Vendor.OpenAI/);
    await expect(inspect({ connector: 'codex-no-key', model: 'gpt-5.3-codex' }))
      .rejects.toThrow(/api_key/);
    await expect(inspect({ connector: 'codex-org-project', model: 'gpt-5.3-codex' }))
      .rejects.toThrow(/cannot forward/);
    await expect(inspect({ connector: 'codex-test', model: 'not-registered' }))
      .rejects.toThrow(/model registry/);
    await expect(inspect({ connector: 'codex-test', model: 'gpt-5.3-codex' }, policy(), false))
      .rejects.toThrow(/explicit local-directory workspace/);
    await expect(inspect({ connector: 'codex-test', model: 'gpt-5.3-codex' }, { ...policy(), filesystem: 'denied' }))
      .rejects.toThrow(/read-only workspace/);
    await expect(inspect({ connector: 'codex-test', model: 'gpt-5.3-codex' }, { ...policy(), approvals: 'interactive' }))
      .rejects.toThrow(/Interactive Codex/);
    await runtime.destroy();
  });

  it('rejects image inputs that resolve outside the workspace', async () => {
    const workspace = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const outsideImage = path.join(outside, 'outside.png');
    await writeFile(outsideImage, 'not-an-image');
    await symlink(outsideImage, path.join(workspace, 'linked.png'));
    const runtime = runtimeWithFakeSdk();
    const session = await runtimeAgent(runtime).openSession({
      context: {},
      workspace: { type: 'local-directory', path: workspace },
      policy: policy(),
    });
    const result = await (await session.run({
      parts: [{ type: 'workspace-file', path: 'linked.png', mediaType: 'image/png' }],
    })).result;
    expect(result.error?.message).toContain('outside the workspace');
    await runtime.destroy();
  });
});

class FakeThread {
  constructor(public id: string | null = null) {}

  async runStreamed(input: Input, options?: TurnOptions) {
    capturedInput = input;
    capturedTurnOptions = options;
    const source = nativeEvents(options?.signal);
    const self = this;
    return {
      events: (async function* () {
        for await (const event of source) {
          if (event.type === 'thread.started') self.id = event.thread_id;
          yield event;
        }
      })(),
    };
  }
}

class FakeCodex {
  constructor(options?: CodexOptions) {
    capturedCodexOptions = options;
  }

  startThread(options?: ThreadOptions) {
    startThreadCalls++;
    capturedThreadOptions = options;
    return new FakeThread();
  }

  resumeThread(id: string, options?: ThreadOptions) {
    resumeThreadCalls++;
    resumedThreadId = id;
    capturedThreadOptions = options;
    return new FakeThread(id);
  }
}

function runtimeWithFakeSdk(modelReasoningEfforts?: Record<string, Array<'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'>>): AgentRuntime {
  const driver = new CodexSdkDriver({
    loadSdk: async () => ({ Codex: FakeCodex as never }),
    modelReasoningEfforts,
  });
  return new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
}

function runtimeAgent(runtime: AgentRuntime) {
  return runtime.agent({
    id: 'codex-agent',
    driver: 'openai.codex.sdk',
    connector: 'codex-test',
    model: 'gpt-5.3-codex',
    instructions: 'Act as a coding agent.',
  });
}

function policy() {
  return {
    filesystem: 'workspace-write' as const,
    commands: 'sandboxed' as const,
    sandboxNetwork: 'denied' as const,
    providerWebSearch: 'denied' as const,
    approvals: 'deny' as const,
  };
}

function usage() {
  return {
    input_tokens: 10,
    cached_input_tokens: 2,
    cache_write_input_tokens: 1,
    output_tokens: 5,
    reasoning_output_tokens: 3,
  };
}

async function* events(items: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  for (const event of items) yield event;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'oneringai-codex-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function viWaitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
