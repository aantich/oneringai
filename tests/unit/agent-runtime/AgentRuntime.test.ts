import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentBusyError,
  AgentCapabilityUnsupportedError,
  AgentDriverConfigurationError,
  AgentDriverNotFoundError,
  AgentRuntime,
  AgentRunTimeoutError,
  LocalExecutionBackend,
} from '@/agent-runtime/index.js';
import type {
  AgentDriver,
  DriverEvent,
  DriverRun,
  DriverOpenSessionRequest,
  DriverRunRequest,
  DriverRunResult,
  DriverSession,
  AgentExecutionBackend, RuntimeSession,
} from '@/agent-runtime/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AgentRuntime local backend', () => {
  it.each(['owned', 'borrowed'] as const)('detaches a late recovery after %s runtime destruction without cancelling native work', async backendOwnership => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const detach = vi.fn(async () => {}); const destroy = vi.fn(async () => {}); const cancel = vi.fn(async () => {});
    const session = { id: 'session_late', isDestroyed: false, detach, destroy, cancelActiveRun: cancel } as unknown as RuntimeSession;
    const backend = { resumeSession: async () => { await pending; return session; }, destroy: vi.fn(async () => {}) } as unknown as AgentExecutionBackend;
    const runtime = new AgentRuntime({ backend, backendOwnership });
    const resumed = runtime.resumeSession({ version: 1, id: session.id }, { context: {} });
    const rejected = expect(resumed).rejects.toThrow('destroyed');
    await runtime.destroy(); release(); await rejected; await runtime.destroy();
    expect(detach).toHaveBeenCalledOnce(); expect(destroy).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    expect(backend.destroy).toHaveBeenCalledTimes(backendOwnership === 'owned' ? 1 : 0);
  });
  it('retains the original recovery reference if late observer cleanup fails', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const destroy = vi.fn(async () => {});
    const session = { isDestroyed: false, detach: async () => { throw new Error('detach failed'); }, destroy } as unknown as RuntimeSession;
    const backend = { resumeSession: async () => { await pending; return session; }, destroy: async () => {} } as unknown as AgentExecutionBackend;
    const runtime = new AgentRuntime({ backend, backendOwnership: 'borrowed' }); const reference = { version: 1 as const, id: 'session_original' };
    const resumed = runtime.resumeSession(reference, { context: {} });
    const rejected = expect(resumed).rejects.toMatchObject({ code: 'AGENT_SESSION_RECOVERY_REQUIRED', reference });
    await runtime.destroy(); release(); await rejected; expect(destroy).not.toHaveBeenCalled();
  });
  it('freezes specs and supports repeatable late event subscriptions', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([
      { type: 'agent.message.delta', data: { text: 'hel' } },
      { type: 'agent.message.delta', data: { text: 'lo' } },
      { type: 'agent.message.completed', data: { text: 'hello' } },
    ], { status: 'completed', outputText: 'hello' }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const source = { id: 'test-agent', driver: driver.id, metadata: { nested: { value: 'original' } } };
    const agent = runtime.agent(source);
    (source.metadata.nested as { value: string }).value = 'changed';

    const session = await agent.openSession({ context: {}, policy: policy() });
    const run = await session.run('hello');
    expect((await run.result).outputText).toBe('hello');

    const first = await collect(run.events());
    const second = await collect(run.events());
    expect(first).toEqual(second);
    expect(first.map((event) => event.type)).toEqual([
      'run.started',
      'agent.message.delta',
      'agent.message.delta',
      'agent.message.completed',
      'run.finished',
    ]);
    expect(agent.spec.metadata).toEqual({ nested: { value: 'original' } });
    expect(Object.isFrozen(agent.spec)).toBe(true);
    await runtime.destroy();
  });

  it('keeps live observation independent from approvals and filters only delivered events', async () => {
    const makeRun = async () => scriptedRun([
      { type: 'reasoning.delta', data: { text: 'considering' } },
      { type: 'plan.updated', data: { items: [] } },
      { type: 'command.output.delta', data: { id: 'command', text: 'working' } },
      { type: 'agent.message.completed', data: { text: 'done' } },
    ], { status: 'completed', outputText: 'done' });
    const driver = new ScriptedDriver(makeRun);
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const agent = runtime.agent({ id: 'observable', driver: driver.id });

    const activitySession = await agent.openSession({
      context: {},
      policy: policy(),
      observation: { mode: 'live', detail: 'activity' },
    });
    const activityRun = await activitySession.run('work autonomously');
    const activityTypes = (await collect(activityRun.events())).map((event) => event.type);
    expect(activityTypes).not.toContain('reasoning.delta');
    expect(activityTypes).toContain('plan.updated');
    expect(activityTypes).toContain('command.output.delta');
    expect((await activityRun.result).status).toBe('completed');

    const finalSession = await agent.openSession({
      context: {},
      policy: policy(),
      observation: { mode: 'final-only', detail: 'reasoning' },
    });
    const finalRun = await finalSession.run('work autonomously');
    const finalTypes = (await collect(finalRun.events())).map((event) => event.type);
    expect(finalTypes).toEqual(['run.started', 'agent.message.completed', 'run.finished']);
    expect((await finalRun.result).outputText).toBe('done');
    await runtime.destroy();
  });

  it('rejects missing required capabilities before opening a session', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], { status: 'completed', outputText: '' }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    await expect(runtime.agent({
      id: 'test-agent',
      driver: driver.id,
      requiredCapabilities: [{ id: 'run.structured_output', minimum: 'native' }],
    }).inspect()).rejects.toBeInstanceOf(AgentCapabilityUnsupportedError);
    await runtime.destroy();
  });

  it('automatically gates structured output and image input at run time', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], { status: 'completed', outputText: '' }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const session = await runtime.agent({ id: 'feature-gates', driver: driver.id }).openSession({
      context: {},
      policy: policy(),
    });

    await expect(session.run('json', {
      responseFormat: { type: 'json_schema', schema: { type: 'object' } },
    })).rejects.toBeInstanceOf(AgentCapabilityUnsupportedError);
    await expect(session.run({
      parts: [{ type: 'workspace-file', path: 'image.png', mediaType: 'image/png' }],
    })).rejects.toBeInstanceOf(AgentCapabilityUnsupportedError);
    expect(driver.runRequests).toEqual([]);
    await runtime.destroy();
  });

  it('allows only one active run per session and one writer per workspace', async () => {
    const gates: Array<() => void> = [];
    const driver = new ScriptedDriver(async () => gatedRun(gates));
    const backend = new LocalExecutionBackend({ drivers: [driver] });
    const runtime = new AgentRuntime({ backend });
    const workspace = await temporaryDirectory();
    const agent = runtime.agent({ id: 'test-agent', driver: driver.id });
    const options = {
      context: {},
      policy: policy(),
      workspace: { type: 'local-directory' as const, path: workspace },
    };
    const sessionA = await agent.openSession(options);
    const sessionB = await agent.openSession(options);
    const first = await sessionA.run('first');

    await expect(sessionA.run('again')).rejects.toBeInstanceOf(AgentBusyError);
    await expect(sessionB.run('parallel')).rejects.toBeInstanceOf(AgentBusyError);
    gates.shift()?.();
    await first.result;
    const second = await sessionB.run('after release');
    gates.shift()?.();
    expect((await second.result).status).toBe('completed');
    await runtime.destroy();
  });

  it('normalizes cancellation and wall-time expiry even when a driver reports completion', async () => {
    const gates: Array<() => void> = [];
    const driver = new ScriptedDriver(async () => gatedRun(gates));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const agent = runtime.agent({ id: 'test-agent', driver: driver.id });

    const cancellable = await agent.openSession({ context: {}, policy: policy() });
    const cancelledRun = await cancellable.run('cancel me');
    const cancellation = cancelledRun.cancel('test cancellation');
    gates.shift()?.();
    await cancellation;
    expect((await cancelledRun.result).status).toBe('cancelled');

    const expiring = await agent.openSession({ context: {}, policy: policy({ wallTimeMs: 10 }) });
    const expiredRun = await expiring.run('expire');
    await new Promise((resolve) => setTimeout(resolve, 20));
    gates.shift()?.();
    const expired = await expiredRun.result;
    expect(expired.status).toBe('failed');
    expect(expired.error?.code).toBe(new AgentRunTimeoutError(10).code);
    expect(expired.finishReason).toBe('timeout');
    await runtime.destroy();
  });

  it('keeps cancellation normalized when a native cancel method throws synchronously', async () => {
    const cancel = vi.fn(() => {
      throw new Error('synchronous native cancel failure');
    });
    const driver = new ScriptedDriver(async (request) => {
      let resolveResult!: (result: DriverRunResult) => void;
      const result = new Promise<DriverRunResult>((resolve) => { resolveResult = resolve; });
      request.signal.addEventListener('abort', () => {
        resolveResult({ status: 'completed', outputText: 'native stopped after signal' });
      }, { once: true });
      return {
        events: (async function* () {
          await result;
          yield* [] as DriverEvent[];
        })(),
        result,
        cancel,
      };
    });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const session = await runtime.agent({ id: 'sync-cancel', driver: driver.id }).openSession({
      context: {},
      policy: policy(),
    });

    const run = await session.run('cancel safely');
    await run.cancel('test cancellation');
    expect((await run.result).status).toBe('cancelled');
    expect(session.state).toBe('ready');
    expect(cancel).toHaveBeenCalled();
    await runtime.destroy();
  });

  it('quarantines a workspace when event failure leaves native termination unconfirmed', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    const pendingResult = new Promise<DriverRunResult>(() => undefined);
    const driver = new ScriptedDriver(async () => ({
      events: (async function* () {
        yield* [] as DriverEvent[];
        throw new Error('native event pump failed');
      })(),
      result: pendingResult,
      cancel,
    }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const workspace = await temporaryDirectory();
    const options = {
      context: {},
      policy: policy(),
      workspace: { type: 'local-directory' as const, path: workspace },
    };

    try {
      const session = await runtime.agent({ id: 'event-failure', driver: driver.id }).openSession(options);
      const run = await session.run('fail the event pump');
      await vi.advanceTimersByTimeAsync(2_100);
      const result = await run.result;
      expect(result).toMatchObject({ status: 'failed', finishReason: 'native_error' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(session.state).toBe('failed');

      const second = await runtime.agent({ id: 'event-failure-second', driver: driver.id }).openSession(options);
      await expect(second.run('must remain quarantined')).rejects.toBeInstanceOf(AgentBusyError);
    } finally {
      vi.useRealTimers();
      await runtime.destroy();
    }
  });

  it('marks bounded output and artifacts incomplete', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], {
      status: 'completed',
      outputText: '0123456789',
      artifacts: [{ type: 'reference', name: 'large', reference: 'x'.repeat(100) }],
    }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const session = await runtime.agent({ id: 'bounded', driver: driver.id }).openSession({
      context: {},
      policy: policy({ outputBytes: 5, artifactBytes: 10 }),
    });
    const result = await (await session.run('bounded')).result;
    expect(result.status).toBe('incomplete');
    expect(Buffer.byteLength(result.outputText)).toBeLessThanOrEqual(5);
    expect(result.artifacts).toEqual([]);
    expect(result.finishReason).toBe('runtime_limit');
    await runtime.destroy();
  });

  it('forwards trusted session metadata and merges input/run metadata', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], { status: 'completed', outputText: 'ok' }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const session = await runtime.agent({ id: 'metadata', driver: driver.id }).openSession({
      context: { tenantId: 'tenant' },
      policy: policy(),
      metadata: { requestId: 'session-request' },
    });
    await (await session.run({
      parts: [{ type: 'text', text: 'metadata' }],
      metadata: { fromInput: true, precedence: 'input' },
    }, {
      metadata: { fromRun: true, precedence: 'run' },
    })).result;

    expect(driver.openRequests[0]?.metadata).toEqual({ requestId: 'session-request' });
    expect(driver.runRequests[0]?.metadata).toEqual({
      fromInput: true,
      fromRun: true,
      precedence: 'run',
    });
    await session.destroy();
    expect(session.isDestroyed).toBe(true);
    await runtime.destroy();
  });

  it('rejects invalid drivers, backends, workspaces, limits, and pre-aborted runs', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], { status: 'completed', outputText: 'ok' }));
    expect(() => new LocalExecutionBackend({ drivers: [driver, driver] })).toThrow(/Duplicate/);
    expect(() => new LocalExecutionBackend({ drivers: [], maxSessionJournalBytes: 0 }))
      .toThrow(AgentDriverConfigurationError);
    expect(() => new LocalExecutionBackend({ drivers: [], maxSessionJournalBytes: 1023 }))
      .toThrow(/at least 1024/);

    const backend = new LocalExecutionBackend({ drivers: [driver] });
    const runtime = new AgentRuntime({ backend, backendOwnership: 'borrowed' });
    await expect(runtime.agent({ id: 'missing', driver: 'missing' }).inspect())
      .rejects.toBeInstanceOf(AgentDriverNotFoundError);
    const agent = runtime.agent({ id: 'invalid-context', driver: driver.id });
    await expect(agent.inspect({
      workspace: { type: 'managed', reference: 'remote' },
      policy: policy(),
    })).rejects.toThrow(/managed workspaces/);
    await expect(agent.inspect({
      workspace: { type: 'local-directory', path: path.parse(process.cwd()).root },
      policy: policy(),
    })).rejects.toThrow(/Filesystem roots/);
    await expect(agent.openSession({
      context: {},
      policy: policy({ eventBufferBytes: 10 }),
    })).rejects.toThrow(/at least 1024/);
    await expect(agent.openSession({
      context: {},
      policy: { ...policy(), approvals: 'sometimes' } as never,
    })).rejects.toThrow(/policy\.approvals/);
    await expect(agent.openSession({
      context: {},
      policy: policy(),
      observation: { mode: 'occasionally' } as never,
    })).rejects.toThrow(/observation\.mode/);
    await expect(agent.openSession({
      context: {},
      policy: policy(),
      controlMode: 'implicit' as never,
    })).rejects.toThrow(/controlMode/);
    expect(() => runtime.agent({
      id: 'invalid-requirement',
      driver: driver.id,
      requiredCapabilities: [{ id: 'event.live', minimum: 'best-effort' as never }],
    })).toThrow(/requiredCapabilities minimum/);

    const session = await agent.openSession({ context: {}, policy: policy() });
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));
    await expect(session.run('no start', { signal: controller.signal })).rejects.toThrow(/already aborted/);
    await runtime.destroy();
    expect(backend.isDestroyed).toBe(false);
    await backend.destroy();
    await expect(backend.inspect({ id: 'after-destroy', driver: driver.id })).rejects.toThrow(/destroyed/);
  });

  it('reserves a session before asynchronous driver startup and bounds a hanging startup cancellation', async () => {
    const never = new Promise<DriverRun>(() => undefined);
    const driver = new ScriptedDriver(async () => never);
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const workspace = await temporaryDirectory();
    const options = {
      context: {},
      policy: policy(),
      workspace: { type: 'local-directory' as const, path: workspace },
    };
    const session = await runtime.agent({ id: 'startup-race', driver: driver.id }).openSession({
      ...options,
    });

    const first = await session.run('first');
    await expect(session.run('second')).rejects.toBeInstanceOf(AgentBusyError);
    await first.cancel('stop hanging startup');
    expect((await first.result).status).toBe('cancelled');
    expect(session.state).toBe('failed');
    const secondSession = await runtime.agent({ id: 'second-agent', driver: driver.id }).openSession(options);
    await expect(secondSession.run('must not overlap')).rejects.toBeInstanceOf(AgentBusyError);
    await runtime.destroy();
  });

  it('attempts native cleanup without masking a post-open capability failure', async () => {
    const destroy = vi.fn(() => {
      throw new Error('cleanup also failed');
    });
    const driver: AgentDriver = {
      id: 'invalid.descriptor',
      inspect: async () => ({
        capabilities: {
          driverId: 'invalid.descriptor',
          capabilities: {},
          configuration: { invalid: 1n } as never,
        },
      }),
      openSession: async () => ({
        run: async () => scriptedRun([], { status: 'completed', outputText: '' }),
        cancelActiveRun: async () => undefined,
        destroy,
        isDestroyed: false,
      }),
    };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });

    await expect(runtime.agent({ id: 'invalid', driver: driver.id }).openSession({
      context: {},
      policy: policy(),
    })).rejects.toThrow(/JSON-serializable/);
    expect(destroy).toHaveBeenCalledOnce();
    await runtime.destroy();
  });

  it('freezes session policy and bounds parsed and native result payloads', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], {
      status: 'completed',
      outputText: JSON.stringify({ value: 'x'.repeat(500) }),
      outputParsed: { value: 'x'.repeat(500) },
      native: { debug: 'y'.repeat(500) },
    }));
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver] }) });
    const mutablePolicy = policy({ outputBytes: 64 });
    const session = await runtime.agent({ id: 'immutable-policy', driver: driver.id }).openSession({
      context: {},
      policy: mutablePolicy,
    });
    mutablePolicy.limits!.outputBytes = 10_000;

    const result = await (await session.run('bounded')).result;
    expect(result.status).toBe('incomplete');
    expect(result.outputParsed).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(result.native?.sanitized))).toBeLessThanOrEqual(128);
    await runtime.destroy();
  });

  it('invalidates existing handles when a runtime with a borrowed backend is destroyed', async () => {
    const driver = new ScriptedDriver(async () => scriptedRun([], { status: 'completed', outputText: 'ok' }));
    const backend = new LocalExecutionBackend({ drivers: [driver] });
    const runtime = new AgentRuntime({ backend, backendOwnership: 'borrowed' });
    const agent = runtime.agent({ id: 'borrowed-handle', driver: driver.id });
    await runtime.destroy();
    await expect(agent.inspect()).rejects.toThrow(/destroyed/);
    await expect(agent.openSession({ context: {}, policy: policy() })).rejects.toThrow(/destroyed/);
    await backend.destroy();
  });
});

class ScriptedDriver implements AgentDriver {
  readonly id = 'test.scripted';
  readonly openRequests: DriverOpenSessionRequest[] = [];
  readonly runRequests: DriverRunRequest[] = [];

  constructor(private readonly makeRun: (request: DriverRunRequest) => Promise<DriverRun>) {}

  async inspect() {
    return {
      capabilities: {
        driverId: this.id,
        capabilities: {
          'session.continue': { id: 'session.continue', support: 'native' as const },
          'run.cancel': { id: 'run.cancel', support: 'native' as const },
          'run.model_override': { id: 'run.model_override', support: 'native' as const },
          'run.reasoning_override': { id: 'run.reasoning_override', support: 'native' as const },
          'run.structured_output': { id: 'run.structured_output', support: 'unsupported' as const },
          'input.image': { id: 'input.image', support: 'unsupported' as const },
        },
      },
    };
  }

  async openSession(request: DriverOpenSessionRequest): Promise<DriverSession> {
    this.openRequests.push(request);
    let destroyed = false;
    return {
      get isDestroyed() { return destroyed; },
      run: async (runRequest) => {
        this.runRequests.push(runRequest);
        return this.makeRun(runRequest);
      },
      cancelActiveRun: async () => undefined,
      destroy: async () => { destroyed = true; },
    };
  }
}

function scriptedRun(events: DriverEvent[], result: DriverRunResult): DriverRun {
  return {
    events: (async function* () { for (const event of events) yield event; })(),
    result: Promise.resolve(result),
    cancel: async () => undefined,
  };
}

function gatedRun(gates: Array<() => void>): DriverRun {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  gates.push(release);
  return {
    events: (async function* () {
      await gate;
      yield { type: 'diagnostic' as const, data: { code: 'GATE_RELEASED' } };
    })(),
    result: gate.then(() => ({ status: 'completed' as const, outputText: 'done' })),
    cancel: async () => undefined,
  };
}

function policy(limits?: { wallTimeMs?: number; eventBufferBytes?: number; outputBytes?: number; artifactBytes?: number }) {
  return {
    filesystem: 'workspace-write' as const,
    commands: 'sandboxed' as const,
    sandboxNetwork: 'denied' as const,
    providerWebSearch: 'denied' as const,
    approvals: 'deny' as const,
    limits,
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'oneringai-runtime-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
