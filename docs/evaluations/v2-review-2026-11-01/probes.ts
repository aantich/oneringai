/** Offline review probes. Never loads .env or contacts a model provider. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connector, PermissionPolicyManager, Vendor } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import { ClaudeAgentSdkDriver } from 'oneringai/agent-runtime/claude';
import { OpenAIManagedDriver } from 'oneringai/agent-runtime/openai-managed';
import OpenAI from 'openai';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { offlineHarness, harnessFixtureIds } from '../../../examples/agent-runtime/harness-fixtures.js';
import { openAIManagedFixture } from '../../../examples/agent-runtime/openai-managed-fixture.js';
import { InMemoryRuntimeSessionStorage, RuntimeControl } from '../../../src/agent-runtime/RuntimeSessionStorage.js';
import { DefinitionSession } from '../../../src/agent-runtime/DefinitionSession.js';
import type { AgentExecutionBackend } from '../../../src/agent-runtime/AgentExecutionBackend.js';
import type { AgentSession, RuntimeSession } from '../../../src/agent-runtime/types.js';
import type { DriverSession } from '../../../src/agent-runtime/AgentDriver.js';

const results: Record<string, unknown> = {};
const fixed = process.argv.includes('--expect-fixed');
const denied = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

async function nativePermissionManager() {
  const root = await mkdtemp(path.join(tmpdir(), 'onering-review-permissions-'));
  const fixture = offlineHarness('oneringai.agent', root);
  const permissionManager = PermissionPolicyManager.fromConfig({ blocklist: ['probe'] });
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({
    drivers: [fixture.implementation],
    resolveTools: () => ({ ...fixture.toolResolution, permissionManager }),
  }) });
  try {
    const session = await runtime.createAgent(fixture.definition).openSession(fixture.options);
    const result = await (await session.run('Call probe once.')).result;
    results.nativePermissionManager = { status: result.status, blockedToolExecutions: fixture.calls() };
    assert.equal(fixture.calls(), fixed ? 0 : 1);
  } finally {
    await runtime.destroy(); await fixture.runtime.destroy(); permissionManager.destroy();
    Connector.clear(); await rm(root, { recursive: true, force: true });
  }
}

async function claudeRedaction() {
  // Deliberately synthetic credential; no real credentials are read or emitted.
  const credential = 'review-only-synthetic-credential';
  Connector.create({ name: 'review-claude', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: credential } });
  const messages = [
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: credential.slice(0, 12) } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: credential.slice(12) } } },
    { type: 'result', subtype: 'success', result: JSON.stringify({ answer: credential }), structured_output: { answer: credential }, session_id: 'offline-native', uuid: 'offline-result', is_error: false, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: {}, total_cost_usd: 0 },
  ] as SDKMessage[];
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new ClaudeAgentSdkDriver({
    loadSdk: async () => ({ createSdkMcpServer, query: () => Object.assign((async function* () { yield* messages; })(), { close() {}, interrupt: async () => {} }) as unknown as Query }),
  })] }) });
  try {
    const session = await runtime.createAgent({ id: 'redaction-review', instructions: 'Return JSON.' }).openSession({
      execution: { driver: 'anthropic.agent.sdk', connector: 'review-claude', model: 'claude-sonnet-4-6' }, context: { userId: 'offline-review' }, policy: denied,
    });
    const run = await session.run('Return JSON.', { responseFormat: { type: 'json_schema', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
    let joinedDeltas = '';
    for await (const event of run.events()) if (event.type === 'agent.message.delta') joinedDeltas += event.data.text;
    const result = await run.result;
    const observation = { status: result.status, outputTextRedacted: !result.outputText.includes(credential), parsedCredentialExposed: JSON.stringify(result.outputParsed).includes(credential), streamedCredentialExposed: joinedDeltas.includes(credential) };
    results.claudeRedaction = observation;
    assert.equal(observation.outputTextRedacted, true);
    assert.equal(observation.parsedCredentialExposed, !fixed);
    assert.equal(observation.streamedCredentialExposed, !fixed);
  } finally { await runtime.destroy(); Connector.clear(); }
}

async function lostStorageAcknowledgement() {
  const storage = new InMemoryRuntimeSessionStorage();
  const lease = await storage.acquire('session_review-ack', { userId: 'offline-review' });
  const initial = await lease.write({ value: 0 }, 0);
  let loseAcknowledgement = true;
  const control = new RuntimeControl({ ...lease, write: async (data, revision) => {
    const saved = await lease.write(data, revision);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Synthetic acknowledgement loss after commit'); }
    return saved;
  } }, initial);
  try {
    await assert.rejects(control.update(data => { data.value = 1; }), /acknowledgement loss/);
    const retryFailures: string[] = [];
    for (let i = 0; i < 2; i++) {
      try { await control.update(data => { data.value = 2; }); }
      catch (error) { retryFailures.push((error as Error).message); }
    }
    results.storageAcknowledgement = { persistedRevision: (await lease.read())?.revision, persistedValue: (await lease.read())?.data.value, cachedValue: control.data.value, retryFailures };
    assert.equal(retryFailures.length, fixed ? 0 : 2);
    if (fixed) assert.equal(control.data.value, 2);
    assert.ok(retryFailures.every(message => message.includes('revision conflict')));
  } finally { await control.release(); }
}

async function lateResumeAfterDestroy() {
  const pending = gate(); let sessionDestroyCalls = 0; let backendDestroyCalls = 0; let detachCalls = 0;
  const source = { id: 'session_review-late', agentId: 'review', state: 'ready', isDestroyed: false, detach: async () => { detachCalls++; }, destroy: async () => { sessionDestroyCalls++; } } as unknown as RuntimeSession;
  const backend = { resumeSession: async () => { await pending.promise; return source; }, destroy: async () => { backendDestroyCalls++; } } as unknown as AgentExecutionBackend;
  const runtime = new AgentRuntime({ backend, backendOwnership: 'borrowed' });
  const resumed = runtime.resumeSession({ version: 1, id: source.id }, { context: { userId: 'offline-review' } });
  await runtime.destroy(); pending.release();
  const late = fixed ? (await assert.rejects(resumed, /destroyed/), undefined) : await resumed;
  await runtime.destroy();
  results.lateResume = { runtimeDestroyed: runtime.isDestroyed, returnedSession: late?.id ?? null, sessionDestroyCalls, backendDestroyCalls, detachCalls };
  assert.equal(sessionDestroyCalls, 0);
  assert.equal(detachCalls, fixed ? 1 : 0);
  await late?.destroy();
}

async function pendingAdmissionShutdown() {
  const pending = gate(); const entered = gate(); let cancelCalls = 0;
  const source = { id: 'session_review-admission', agentId: 'review', state: 'ready', isDestroyed: false, cancelActiveRun: async () => { cancelCalls++; }, destroy: async () => {} } as unknown as AgentSession;
  const native = { inspectState: async () => { entered.release(); await pending.promise; return { connection: 'attached', activity: 'ready', unresolvedEffects: false }; } } as unknown as DriverSession;
  const session = new DefinitionSession(source, native);
  const admission = session.run('offline');
  const rejected = assert.rejects(admission, /closed/);
  await entered.promise;
  let destroyed = false;
  const shutdown = session.destroy().then(() => { destroyed = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  results.pendingAdmissionShutdown = { shutdownSettledWhileInspectionPending: destroyed, cancelCallsBeforeInspectionSettles: cancelCalls };
  assert.equal(destroyed, fixed); assert.equal(cancelCalls, fixed ? 1 : 0);
  pending.release(); await rejected; await shutdown;
}

async function expandedManagedResources() {
  const root = await mkdtemp(path.join(tmpdir(), 'onering-review-managed-'));
  const host = offlineHarness('openai.agents.api', root);
  const wire = openAIManagedFixture(); let expanded = false; let changedResponses = 0;
  const driver = new OpenAIManagedDriver({ createClient: options => new OpenAI({ ...options, fetch: async (input, init) => {
    const response = await wire.fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (expanded && (init?.method ?? 'GET') === 'GET' && url.pathname.endsWith('/agents/sessions/native-session')) {
      const body = await response.json();
      body.vault_ids = ['unselected-vault']; body.environment.desktop = { enabled: true }; changedResponses++;
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }
    return response;
  } }) });
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver], sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'review-control')), resolveTools: () => host.toolResolution }) });
  try {
    const session = await runtime.createAgent(host.definition).openSession(host.options);
    assert.equal((await (await session.run('first')).result).status, 'completed');
    const reference = session.reference(); await session.detach(); expanded = true;
    if (fixed) {
      await assert.rejects(runtime.resumeSession(reference, { context: host.options.context }), /unselected vault/);
      results.expandedManagedResources = { resumedWithUnselectedVaultAndDesktop: false, changedResponses, nativeInputs: wire.counts.inputs, hostToolExecutions: host.calls() };
      assert.equal(wire.counts.inputs, 1); assert.equal(host.calls(), 1); return;
    }
    const resumed = await runtime.resumeSession(reference, { context: host.options.context });
    const result = await (await resumed.run('second')).result;
    results.expandedManagedResources = { resumedWithUnselectedVaultAndDesktop: true, status: result.status, changedResponses, nativeInputs: wire.counts.inputs, hostToolExecutions: host.calls() };
    assert.ok(changedResponses > 0); assert.equal(wire.counts.inputs, 2); assert.equal(result.status, 'completed');
  } finally { expanded = false; await runtime.destroy(); await host.runtime.destroy(); Connector.clear(); await rm(root, { recursive: true, force: true }); }
}

async function allHarnessPermissions() {
  const observations = [];
  for (const id of harnessFixtureIds) {
    const root = await mkdtemp(path.join(tmpdir(), 'onering-review-all-permissions-'));
    const f = offlineHarness(id, root); let deniedCalls = 0;
    const permissionManager = PermissionPolicyManager.fromConfig({ blocklist: ['probe'] });
    permissionManager.on('permission:deny', () => { deniedCalls++; });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [f.implementation], sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'verify-control')), resolveTools: () => ({ ...f.toolResolution, permissionManager }) }) });
    try {
      const session = await runtime.createAgent(f.definition).openSession(f.options);
      const run = await session.run('Use probe.');
      // Some synthetic native transports deliberately fail when a tool is denied.
      // Their terminal/recovery status is separate from the host execution check.
      await run.result.catch(() => undefined);
      assert.equal(f.calls(), 0); assert.ok(deniedCalls > 0);
      observations.push({ driver: id, blockedToolExecutions: f.calls(), deniedCalls });
    } finally { await runtime.destroy(); await f.runtime.destroy(); permissionManager.destroy(); Connector.clear(); await rm(root, { recursive: true, force: true }); }
  }
  results.allHarnessPermissions = observations;
}

await nativePermissionManager();
await claudeRedaction();
await lostStorageAcknowledgement();
await lateResumeAfterDestroy();
await pendingAdmissionShutdown();
await expandedManagedResources();
if (fixed) await allHarnessPermissions();
await writeFile(new URL(fixed ? './fixed-results.json' : './results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
