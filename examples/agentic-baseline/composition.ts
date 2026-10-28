/** Host-owned composed evaluation utility. It is not a library inspector or workflow backend. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto'; import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { Agent, Connector, InMemoryEvidenceStorage, AgentPackageOutcomeServer, exportAgentPackage, createAgentPackageOutcomeTools, createRoutineRunner, createRoutineDefinition, ModelTask } from '@everworker/oneringai';
import type { RemoteOutcomeTransport, RemoteOutcomeSession, ToolFunction } from '@everworker/oneringai';
import { offlineRoutingConnector } from '../model-routing/fixture.js';
import { canonicalJSON } from './reporter.js';
export async function runMeetingComposition(variant: 'local' | 'remote', fixture = 'held-out') {
  const start = performance.now(), directory = await mkdtemp(join(tmpdir(), 'oneringai-meeting-'));
  const { connector, mainModel } = offlineRoutingConnector(`meeting-${variant}-${fixture}-${Date.now()}`);
  const exact = { id: `source-${fixture}`, quote: `Approved ${fixture} meeting: 14:35, budget 735 units.`, success: false };
  const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: fixture } });
  let submissions = 0, providerComplete = false, artifactWrites = 0;
  const sourceTools: ToolFunction[] = [
    { definition: { type: 'function', function: { name: 'meeting_source' } }, output: { effect: 'read', summarize: () => `Source ${exact.id}; retrieve exact evidence before quoting.` }, execute: async () => structuredClone(exact) },
    { definition: { type: 'function', function: { name: 'submit_meeting' } }, output: { effect: 'write' }, execute: async () => ({ id: `submission-${++submissions}`, status: 'accepted' }) },
  ];
  let server: AgentPackageOutcomeServer | undefined, sourceAgent: Agent | undefined, session: RemoteOutcomeSession | undefined;
  let selectedTools = sourceTools;
  if (variant === 'remote') {
    sourceAgent = Agent.create({ connector, model: mainModel, tools: sourceTools, context: { model: mainModel, features: { workingMemory: false, inContextMemory: false } } });
    server = new AgentPackageOutcomeServer(sourceAgent, exportAgentPackage(sourceAgent), { storage: new InMemoryEvidenceStorage({ scope: { ownerId: 'source', namespace: fixture } }), authorize: (_access, host: { approved: boolean }) => host.approved, maxInlineBytes: 0 });
    const transport: RemoteOutcomeTransport = { negotiate: r => server!.negotiate(r, { approved: true }), execute: r => server!.execute(r, { approved: true }), getReceipt: r => server!.getReceipt(r, { approved: true }), cancel: r => server!.cancel(r, { approved: true }), readEvidence: r => server!.readEvidence(r, { approved: true }) };
    const toolkit = await createAgentPackageOutcomeTools(server.package(), { transport, storage }); selectedTools = toolkit.tools; session = toolkit.session;
  }
  async function exactSource() {
    const entries = (await storage.list({ limit: 100 })).entries.filter(e => e.toolName === 'meeting_source'); assert.equal(entries.length, 1);
    const record = await storage.readRecord(entries[0]!.reference); assert.ok(record);
    const body = record.result as any, raw = variant === 'remote' ? body.payload.result : body;
    assert.deepEqual(raw, exact); return { raw, reference: entries[0]!.reference };
  }
  const artifact = join(directory, 'meeting.md');
  const agent = Agent.create({ connector, model: mainModel, userId: 'host', tools: [...selectedTools,
    { definition: { type: 'function', function: { name: 'write_meeting_artifact' } }, output: { effect: 'write' }, execute: async () => { const source = await exactSource(); await writeFile(artifact, `${source.raw.id}\n${source.raw.quote}\n`); artifactWrites++; return { id: 'meeting.md', source: source.reference }; } }],
    context: { model: mainModel, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage, projectThresholdBytes: 0 } } },
    modelExecution: { customProviderAttempts: 'single' }, emptyResponseRetry: { enabled: false } });
  const task = new ModelTask({ limits: { maxCalls: 2 } }); let verifierCalls = 0;
  const runner = createRoutineRunner({ verify: async observation => { verifierCalls++;
    if (observation.phase === 'task') return providerComplete ? { kind: 'verified' } : { kind: 'waiting', reason: 'Accepted submission is not confirmed completion' };
    const source = await exactSource(), text = await readFile(artifact, 'utf8');
    return text === `${source.raw.id}\n${source.raw.quote}\n` && providerComplete && artifactWrites === 1 ? { kind: 'verified', references: [source.reference] } : { kind: 'blocked', reason: 'Artifact/source confirmation missing' };
  } });
  try {
    const capabilities = agent.inspectCapabilities(); assert.equal(capabilities.loop.hostCompletionCheck, false); assert.equal(agent.tools, agent.context.tools);
    const definition = createRoutineDefinition({ name: 'Meeting preparation', description: 'Held-out local synthetic source and provider state',
      preSteps: [{ name: 'read', toolName: 'meeting_source', args: {} }, { name: 'submit', toolName: 'submit_meeting', args: {} }],
      tasks: [{ name: 'prepare', description: 'Acknowledge the prepared source. Host checks submission state independently.' }],
      postSteps: [{ name: 'artifact', toolName: 'write_meeting_artifact', args: {} }] });
    const first = await runner.run({ agent, definition, execution: { modelTask: task } }); assert.equal(first.state, 'waiting'); assert.equal(artifactWrites, 0); assert.equal(submissions, 1);
    assert.equal(runner.inspect(first.operationId)?.lifecycle, 'paused');
    if (!('continuation' in first)) throw new Error('Expected same-process continuation');
    await assert.rejects(runner.resume(first.continuation, { authorize: () => false }), /authorization/);
    providerComplete = true; const final = await runner.resume(first.continuation, { authorize: () => true }); assert.equal(final.state, 'completed');
    assert.equal(submissions, 1); assert.equal(artifactWrites, 1); assert.equal(task.snapshot().totals.calls, 1);
    const source = await exactSource(); const sourceHash = createHash('sha256').update(canonicalJSON(source.raw)).digest('hex');
    const checkpoint = agent.context.getState(); assert.ok(checkpoint); assert.deepEqual((await exactSource()).raw, exact);
    return { fixture, variant, passed: true, configured: { loopOwner: 'managed-agent', hostCompletionCheck: capabilities.loop.hostCompletionCheck, evidence: capabilities.context.features.evidence, taskState: capabilities.context.features.taskState, strategy: capabilities.context.strategy },
      observed: { routineVerification: final.state, verifierCalls, initialState: first.state, submissions, artifactWrites, modelCalls: task.snapshot().totals.calls, remote: session?.inspect() ?? [], sourceHash },
      falseVerifiedCompletions: 0, duplicateEffects: submissions - 1, unauthorizedDisclosures: 0, exactSourceAccuracy: 1, redundantModelCalls: 0,
      latencyMs: performance.now() - start, knownModelCostSubtotalUSD: task.snapshot().totals.knownModelCostUSD, unknownModelCostInvocations: task.snapshot().totals.unknownCostInvocations, unknownExternalCost: variant === 'remote', wholeOperationCost: variant === 'remote' ? 'external_unknown' : task.snapshot().totals.unknownCostInvocations ? 'unknown' : 'registry-estimate', restartWorkflowAuthority: 'not-restored' };
  } finally { runner.close(); session?.close(); agent.destroy(); task.destroy(); await server?.close(); sourceAgent?.destroy(); Connector.remove(connector.name); await rm(directory, { recursive: true, force: true }); }
}
export function compositionSummary(results: Awaited<ReturnType<typeof runMeetingComposition>>[]) {
  const durations = results.map(r => r.latencyMs).sort((a, b) => a - b), percentile = (fraction: number) => durations[Math.max(0, Math.ceil(durations.length * fraction) - 1)] ?? null;
  return { protocol: 'consumer-composition-evaluation/1', samples: results.length, passed: results.every(r => r.passed), falseVerifiedCompletions: results.reduce((n, r) => n + r.falseVerifiedCompletions, 0), duplicateEffects: results.reduce((n, r) => n + r.duplicateEffects, 0), unauthorizedDisclosures: results.reduce((n, r) => n + r.unauthorizedDisclosures, 0), latencyMs: { p50: percentile(0.5), p95: percentile(0.95) }, comparison: 'Functional synthetic acceptance; no comparative model-quality or cost claim', results };
}
