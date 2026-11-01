/**
 * Explicit local evaluation only. Production CodexSdkDriver remains API-key-only.
 * Its supported embedding seam bootstraps a disposable ChatGPT login cache; no
 * API key, ambient configuration, or user workspace is passed to the child CLI.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';
import type { CodexOptions, Thread, ThreadOptions } from '@openai/codex-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import { AgentRuntime, FileRuntimeSessionStorage, LocalExecutionBackend } from '../../../src/agent-runtime/index.js';
import type { AgentRun, AgentRunEvent, RuntimeSession, RuntimeSessionReference } from '../../../src/agent-runtime/index.js';
import { CodexSdkDriver } from '../../../src/agent-runtime/codex.js';

const enabled = process.env.RUN_CODEX_SUBSCRIPTION_LIVE === '1';
const model = process.env.CODEX_LIVE_MODEL ?? 'gpt-6.1-sol';
const connectorName = 'codex-subscription-evaluation';
const shellProbe = `const fs = require('node:fs');
if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || process.env.ONERINGAI_HOST_BROKER_TOKEN) throw new Error('Credential visible to the native shell');
fs.writeFileSync('native-probe.txt', 'NATIVE_WORKSPACE_OK');
console.log('NATIVE_WORKSPACE_OK');
`;
const homes = new Set<string>();
const marker = `SUBSCRIPTION_${randomUUID().replaceAll('-', '')}`;
let root: string;
let runtime: AgentRuntime;
let session: RuntimeSession;
let reference: RuntimeSessionReference;
let nativeRuns = 0;
let probeCalls = 0;
let firstRun: AgentRun;
let checkpointChecks = 0;
let expectedTranscript: { file: string; digest: string } | undefined;
let slowStarted: (() => void) | undefined;
let sourceReady = false;
let attached = false;
let retainedSyntheticCancellation = false;
const checks: Array<{ check: string; nativeRuns: number; inputTokens?: number; outputTokens?: number }> = [];
const nativeErrors: string[] = [];

const format = { type: 'json_schema' as const, name: 'subscription_probe', strict: true,
  schema: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'], additionalProperties: false } };

class SubscriptionEvaluationCodex extends Codex {
  constructor(options: CodexOptions = {}) {
    const home = options.env?.CODEX_HOME;
    if (!home) throw new Error('Evaluation requires the driver-owned disposable home');
    const source = path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'auth.json');
    const auth = JSON.parse(readFileSync(source, 'utf8'));
    if (!auth.tokens?.access_token || auth.auth_mode === 'api_key') throw new Error('A file-backed Codex ChatGPT sign-in is required; API fallback is forbidden');
    // Never copy Platform keys, user config, plugins, or transcripts.
    writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null,
      tokens: auth.tokens, ...(auth.last_refresh ? { last_refresh: auth.last_refresh } : {}) }), { mode: 0o600 });
    homes.add(home);
    super({ ...options, apiKey: undefined, baseUrl: undefined,
      ...(process.env.CODEX_LIVE_CLI ? { codexPathOverride: process.env.CODEX_LIVE_CLI } : {}),
      config: { ...options.config, forced_login_method: 'chatgpt', cli_auth_credentials_store: 'file' } });
  }
  override startThread(options: ThreadOptions = {}): Thread { return countRuns(super.startThread(options)); }
  override resumeThread(id: string, options: ThreadOptions = {}): Thread { return countRuns(super.resumeThread(id, options)); }
}

function countRuns(thread: Thread): Thread {
  const run = thread.runStreamed.bind(thread);
  thread.runStreamed = async (...args) => {
    nativeRuns++;
    const result = await run(...args);
    return { events: (async function* () {
      for await (const event of result.events) {
        if (event.type === 'error' || event.type === 'turn.failed') nativeErrors.push((event.type === 'error' ? event.message : event.error.message).slice(0, 2000));
        yield event;
      }
    })() };
  };
  return thread;
}
async function observe(run: AgentRun): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}
async function transcript(): Promise<{ file: string; digest: string }> {
  for (const home of homes) {
    for (const file of await readdir(home, { recursive: true })) {
      if (!file.endsWith('.jsonl') || !file.includes('rollout-')) continue;
      const absolute = await realpath(path.join(home, file));
      const data = await readFile(absolute);
      if (data.includes(marker)) return { file: absolute, digest: createHash('sha256').update(data).digest('hex') };
    }
  }
  throw new Error('The exact native transcript containing the retained source was not found');
}

describe.skipIf(!enabled).sequential('Codex subscription evaluation (test-only authentication bootstrap)', () => {
  beforeEach(context => {
    if (!context.task.name.startsWith('uses the actual SDK') && !context.task.name.startsWith('rejects pre-aborted') && (!sourceReady || !attached)) context.skip();
  });
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'onering-codex-subscription-'));
    writeFileSync(path.join(root, 'verify-key-isolation.cjs'), shellProbe);
    Connector.create({ name: connectorName, vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'subscription-evaluation-placeholder-not-a-platform-key' } });
    const driver = new CodexSdkDriver({ loadSdk: async () => ({ Codex: SubscriptionEvaluationCodex }),
      verifyNativeCheckpoint: async state => {
        expect(expectedTranscript).toBeDefined();
        expect(expectedTranscript!.file.startsWith(state.directory + path.sep)).toBe(true);
        expect(expectedTranscript!.file).toContain(state.nativeSessionId);
        expect(createHash('sha256').update(await readFile(expectedTranscript!.file)).digest('hex')).toBe(expectedTranscript!.digest);
        checkpointChecks++;
      } });
    runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver],
      sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')),
      resolveTools: () => ({ fingerprint: 'subscription-probes-v1', tools: [
        { definition: { type: 'function', function: { name: 'read_probe', description: 'Read the exact host-owned test marker.',
          parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          execute: async () => { probeCalls++; return { marker }; } },
        { definition: { type: 'function', function: { name: 'slow_probe', description: 'Start the host cancellation test and wait.',
          parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          execute: async (_args, context) => { slowStarted?.(); await new Promise<void>(resolve => {
            if (context?.signal?.aborted) resolve(); else context?.signal?.addEventListener('abort', () => resolve(), { once: true });
          }); return { cancelled: true }; } },
      ] }) }) });
    const agent = runtime.createAgent({ id: 'subscription-live', instructions: 'Follow the test request precisely. Use read_probe only when requested. Use slow_probe only for a cancellation request. Keep answers short. Never read credential files or print credentials/environment-variable values. A boolean check of whether an API-key variable is set is allowed when requested.', tools: ['read_probe', 'slow_probe'] });
    const options = { execution: { driver: driver.id, connector: connectorName, model, reasoning: { effort: 'low' as const }, driverConfig: { skipGitRepoCheck: true } },
      context: { userId: 'subscription-evaluation-owner', tenantId: 'local-evaluation' },
      environment: { type: 'local-directory' as const, path: root },
      policy: { filesystem: 'workspace-write' as const, commands: 'sandboxed' as const, sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const, approvals: 'deny' as const,
        limits: { wallTimeMs: 90_000, eventBufferBytes: 2 * 1024 * 1024, outputBytes: 128 * 1024 } } };
    const inspection = await agent.inspect(options);
    expect(inspection.definitionDigest).toBeTruthy();
    session = await agent.openSession(options);
    attached = true;
    reference = session.reference();
  }, 30_000);

  afterAll(async () => {
    try {
      if (reference && !retainedSyntheticCancellation) await runtime.deleteSession(reference, { context: { userId: 'subscription-evaluation-owner', tenantId: 'local-evaluation' } });
    } finally {
      await runtime?.destroy();
      Connector.remove(connectorName);
      await Promise.all([...homes].map(home => rm(home, { recursive: true, force: true })));
      if (root) await rm(root, { recursive: true, force: true });
      if (process.env.CODEX_SUBSCRIPTION_REPORT_PATH) writeFileSync(process.env.CODEX_SUBSCRIPTION_REPORT_PATH, JSON.stringify({
        protocol: 'codex-subscription-evaluation-v1', model, nativeRuns, probeCalls, checkpointChecks, checks, nativeErrors,
        boundary: 'Actual Codex SDK/driver/runtime with a test-only ChatGPT login bootstrap; production subscription authentication is not implemented.' }, null, 2) + '\n');
    }
  }, 30_000);

  it('uses the actual SDK and authenticated host MCP bridge with structured streaming output', async () => {
    firstRun = await session.run('Call read_probe exactly once. Remember its marker and return it in the requested JSON format.', { requestId: 'first-probe', responseFormat: format });
    const events = observe(firstRun);
    const result = await firstRun.result;
    expect(result.status, JSON.stringify({ error: result.error, nativeErrors })).toBe('completed');
    expect(result.outputParsed).toEqual({ marker });
    expect(probeCalls).toBe(1);
    expect((await events).some(event => event.type === 'tool.completed')).toBe(true);
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    sourceReady = true;
    checks.push({ check: 'host-tools-schema-streaming', nativeRuns, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens });
  }, 120_000);

  it('replays an identical request and rejects conflicting reuse without another native dispatch', async () => {
    const count = nativeRuns;
    const replay = await session.run('Call read_probe exactly once. Remember its marker and return it in the requested JSON format.', { requestId: 'first-probe', responseFormat: format });
    expect(replay.id).toBe(firstRun.id);
    expect((await replay.result).outputParsed).toEqual({ marker });
    await expect(session.run('Conflicting input', { requestId: 'first-probe', responseFormat: format })).rejects.toThrow();
    expect(nativeRuns).toBe(count);
    expect(probeCalls).toBe(1);
    checks.push({ check: 'request-replay-and-conflict', nativeRuns });
  });

  it('rejects pre-aborted input without native dispatch', async () => {
    const count = nativeRuns;
    const controller = new AbortController(); controller.abort();
    await expect(session.run('Must not dispatch', { signal: controller.signal })).rejects.toThrow();
    expect(nativeRuns).toBe(count);
    checks.push({ check: 'pre-dispatch-cancellation', nativeRuns });
  });

  it('replays correlated ordered events and honors the sequence cursor without native dispatch', async () => {
    const count = nativeRuns;
    const events = await observe(firstRun);
    expect(events.length).toBeGreaterThan(2);
    expect(events.every((event, index) => event.runId === firstRun.id && event.sessionId === firstRun.sessionId && (index === 0 || event.sequence > events[index - 1]!.sequence))).toBe(true);
    const cursor = events[Math.floor(events.length / 2)]!.sequence;
    const replay: AgentRunEvent[] = [];
    for await (const event of firstRun.events({ afterSequence: cursor })) replay.push(event);
    expect(replay).toEqual(events.filter(event => event.sequence > cursor));
    expect(nativeRuns).toBe(count);
    checks.push({ check: 'ordered-correlated-event-cursor', nativeRuns });
  });

  it('rejects a foreign session owner before native recovery', async () => {
    const count = nativeRuns;
    await expect(runtime.resumeSession(reference, { context: { userId: 'foreign-owner', tenantId: 'local-evaluation' } })).rejects.toThrow();
    expect(nativeRuns).toBe(count);
    expect(checkpointChecks).toBe(0);
    checks.push({ check: 'foreign-owner-rejection', nativeRuns });
  });

  it('rejects unsupported explicit file transfers without native execution', async () => {
    const count = nativeRuns;
    await expect(session.uploadFile({ path: 'unavailable.txt', mediaType: 'text/plain' })).rejects.toThrow();
    await expect(session.downloadArtifact({ reference: 'unavailable', path: 'unavailable.txt' })).rejects.toThrow();
    expect(nativeRuns).toBe(count);
    checks.push({ check: 'unsupported-transfer-rejection', nativeRuns });
  });

  it('continues the same native thread using retained source history', async () => {
    const run = await session.run('Without calling any tool, return the exact marker from the previous read_probe result.', { responseFormat: format });
    const events = observe(run);
    const result = await run.result; await events;
    expect(result.status, JSON.stringify(result.error)).toBe('completed');
    expect(result.outputParsed).toEqual({ marker });
    expect(probeCalls).toBe(1);
    checks.push({ check: 'native-multiturn-history', nativeRuns });
  }, 120_000);

  it('executes a sandboxed workspace command and keeps Platform keys out of the shell', async () => {
    const run = await session.run('Run the existing host-provided script with the shell command node verify-key-isolation.cjs. Do not modify that script or create its output file yourself. It checks only credential-variable presence, writes native-probe.txt on success, and prints a marker. Return that observed marker in JSON. Do not call host tools.', { responseFormat: format });
    const observed = observe(run);
    const result = await run.result;
    const events = await observed;
    expect(result.status, JSON.stringify(result.error)).toBe('completed');
    expect(result.outputParsed).toEqual({ marker: 'NATIVE_WORKSPACE_OK' });
    expect((await readFile(path.join(root, 'native-probe.txt'), 'utf8')).trim()).toBe('NATIVE_WORKSPACE_OK');
    expect(await readFile(path.join(root, 'verify-key-isolation.cjs'), 'utf8')).toBe(shellProbe);
    expect(events.some(event => event.type === 'command.completed' && String(event.data.command).includes('verify-key-isolation.cjs') && event.data.exitCode === 0)).toBe(true);
    checks.push({ check: 'workspace-command-and-key-isolation', nativeRuns });
  }, 120_000);

  it('restores verified idle native history and replays without executing its action again', async () => {
    await session.detach();
    attached = false;
    expectedTranscript = await transcript();
    session = await runtime.resumeSession(reference, { context: { userId: 'subscription-evaluation-owner', tenantId: 'local-evaluation' } });
    attached = true;
    const count = nativeRuns;
    const replay = await session.run('Call read_probe exactly once. Remember its marker and return it in the requested JSON format.', { requestId: 'first-probe', responseFormat: format });
    expect((await replay.result).outputParsed).toEqual({ marker });
    expect(nativeRuns).toBe(count);
    const run = await session.run('After restoration, return the original remembered read_probe marker without tools.', { responseFormat: format });
    const events = observe(run);
    const result = await run.result; await events;
    expect(result.status).toBe('completed'); expect(result.outputParsed).toEqual({ marker });
    expect(checkpointChecks).toBeGreaterThan(0); expect(probeCalls).toBe(1);
    checks.push({ check: 'verified-native-restore-and-idempotency', nativeRuns });
  }, 120_000);

  it('cancels a real in-flight native turn during a host tool wait', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); slowStarted = entered;
    const run = await session.run('Cancellation test: call slow_probe exactly once and wait for its result.');
    const events = observe(run);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cancellation probe was not called')), 60_000); })]);
      await run.cancel('Host-requested subscription smoke cancellation');
      expect((await run.result).status).toBe('cancelled'); await events;
      if ((await session.inspectState()).unresolvedEffects) {
        await expect(runtime.deleteSession(reference, { context: { userId: 'subscription-evaluation-owner', tenantId: 'local-evaluation' } })).rejects.toThrow(/Reconcile retained tool effects/);
        // Only the disposable synthetic read fixture is removed in afterAll.
        // This is not acknowledgement/reconciliation of a production effect.
        retainedSyntheticCancellation = true;
        checks.push({ check: 'cancelled-observation-deletion-guard', nativeRuns });
      }
      checks.push({ check: 'in-flight-tool-cancellation', nativeRuns });
    } finally { if (timer) clearTimeout(timer); slowStarted = undefined; }
  }, 120_000);
});
