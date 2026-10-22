/** Offline separate-process restart; --live=openai|anthropic opts into billable native/stream replay. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { Agent, Connector, ContextCompactionStrategy, FileContextStorage, FileEvidenceStorage, ContentType, MessageRole, ModelTask, StreamEventType, Vendor } from '@everworker/oneringai';
import type { AgentConfig } from '@everworker/oneringai';
import { createNativeFixture } from './native-compaction/fixture.js';

const child = process.argv[2] === '--restore';
dotenv.config({ quiet: true });
const live = process.argv.find(arg => arg.startsWith('--live='))?.split('=')[1];
if (live && !['openai', 'anthropic'].includes(live)) throw new Error('Select --live=openai or --live=anthropic');
const model = live === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-6-astra';
const key = live ? process.env[live === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] : undefined;
if (live && !key) throw new Error('Configure the selected provider credential in .env');
const directory = child ? process.argv[3]! : await mkdtemp(join(tmpdir(), 'native-restart-'));
const fixture = createNativeFixture();
Connector.create({ name: 'native-recovery', vendor: live === 'anthropic' ? Vendor.Anthropic : Vendor.OpenAI,
  auth: key ? { type: 'api_key', apiKey: key } : { type: 'none' }, ...(live ? {} : { options: { provider: fixture.provider } }) });
const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 150000 } });
const storage = new FileContextStorage({ agentId: 'native-demo', baseDirectory: directory });
const evidence = new FileEvidenceStorage({ directory: join(directory, 'evidence'), scope: { ownerId: 'owner', namespace: 'native-demo' } });
const config: AgentConfig = { hooks: { 'before:llm': () => ({ modified: { max_output_tokens: 256 } }) }, connector: 'native-recovery', model, userId: 'owner', thinking: { enabled: false },
  ...(live ? {} : { modelExecution: { customProviderAttempts: 'single' } }), session: { id: 'native-demo', storage, autoSave: false },
  context: { model, features: { workingMemory: false, inContextMemory: false, evidence: true },
    plugins: { evidence: { storage: evidence } },
    compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 }, automatic: false }) } };
let agent: Agent | undefined;
try {
  if (child) {
    agent = await Agent.resume('native-demo', config as Parameters<typeof Agent.resume>[1]);
    assert.ok(agent.context.getState().nativeContinuation);
    let output = '';
    for await (const event of agent.stream('Give the project code ORBIT_16A and its confirmed limit from the saved context. Reply with both only.', { modelTask: task })) {
      if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) output += event.delta;
    }
    if (live) { assert.match(output, /ORBIT_16A/); assert.match(output, /37/); }
    else { assert.equal(fixture.calls.native, 0); assert.equal(fixture.calls.main, 1); }
    const wrong = { ...config, model: 'other-model', context: { ...config.context, model: 'other-model' } } as Parameters<typeof Agent.resume>[1];
    await assert.rejects(Agent.resume('native-demo', wrong), /binding|model|invalid/i);
    const original = await storage.load('trusted-pre-native'); assert.ok(original);
    agent.context.restoreState(original.state);
    assert.equal(agent.context.getState().nativeContinuation, undefined);
    if (!live) { assert.equal(fixture.calls.native, 0); assert.equal(fixture.calls.main, 1); }
    console.log('Child: native resume, cross-model rejection and trusted pre-native recovery pass; no action replay.');
  } else {
    agent = Agent.create(config);
    for (let i = 0; i < 8; i++) { agent.context.addUserMessage(`Historical step ${i}. Project ORBIT_16A has confirmed limit 37.`); agent.context.addAssistantResponse([
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Recoverable exact source. '.repeat(200).trimEnd() }] }]); }
    await agent.saveSession('native-demo');
    await storage.save('trusted-pre-native', agent.context.getState());
    const report = await agent.compactContext({ modelTask: task }); assert.equal(report.checkpointed, true);
    const first = agent.context.getState().nativeContinuation!;
    assert.equal(first.sourceReferences.length, 1);
    assert.match(JSON.stringify((await evidence.readRecord(first.sourceReferences[0]!))!.result), /ORBIT_16A/);
    // A second native transaction replaces the first window and retains its proofs.
    for (let i = 0; i < 4; i++) { agent.context.addUserMessage(`Later step ${i}, same ORBIT_16A limit 37.`); agent.context.addAssistantResponse([
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Further historical details. '.repeat(200).trimEnd() }] }]); }
    const second = await agent.compactContext({ modelTask: task }); assert.equal(second.history.status, 'compacted');
    assert.equal(agent.context.getState().nativeContinuation!.sourceReferences.length, 2);
    agent.destroy(); agent = undefined;
    const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--restore', directory, ...(live ? [`--live=${live}`] : [])], { encoding: 'utf8', timeout: live ? 150000 : 30000 });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Child restart failed');
    console.log(result.stdout.trim());
  }
} finally { agent?.destroy(); task.destroy(); Connector.remove('native-recovery'); if (!child) await rm(directory, { recursive: true, force: true }); }
