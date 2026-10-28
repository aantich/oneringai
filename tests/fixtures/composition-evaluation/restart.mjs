import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises'; import { join } from 'node:path';
import { Agent, Connector, Vendor, FileEvidenceStorage, AgentPackageOutcomeServer, exportAgentPackage, hydrateAgentPackageWithOutcomes } from '@everworker/oneringai';
const [mode, directory] = process.argv.slice(2); const checkpointPath = join(directory, 'checkpoint.json'), countPath = join(directory, 'effects.json');
const quote = 'The held-out meeting starts at 14:35; the approved budget is 735 units.';
const provider = { name: 'no-model', capabilities: { text: true }, generate: async () => { throw new Error('Unexpected model IO during recovery'); }, getModelCapabilities: () => ({ supportsTools: true, supportsJSON: true, supportsJSONSchema: true, maxTokens: 8000, maxOutputTokens: 128 }) };
Connector.create({ name: 'restart', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
let effects = mode === 'produce' ? 0 : JSON.parse(await readFile(countPath, 'utf8')).effects;
const source = Agent.create({ connector: 'restart', model: 'offline', tools: [
  { definition: { type: 'function', function: { name: 'meeting_source' } }, output: { effect: 'read' }, execute: async () => ({ id: 'held-out-source-734', quote }) },
  { definition: { type: 'function', function: { name: 'submit_artifact' } }, output: { effect: 'write' }, execute: async () => { effects++; await writeFile(countPath, JSON.stringify({ effects })); return { id: 'held-out-artifact-735', submitted: true }; } },
], context: { model: 'offline', features: { workingMemory: false, inContextMemory: false } } });
const saved = mode === 'recover' ? JSON.parse(await readFile(checkpointPath, 'utf8')) : undefined;
const sourceStorage = new FileEvidenceStorage({ directory, scope: { ownerId: 'source', namespace: 'held-out' } }), localStorage = new FileEvidenceStorage({ directory, scope: { ownerId: 'client', namespace: 'held-out' } });
const pkg = mode === 'produce' ? exportAgentPackage(source) : saved.sourcePackage;
const server = new AgentPackageOutcomeServer(source, pkg, { storage: sourceStorage, authorize: (_access, host) => host.authorized === true, maxInlineBytes: 0 });
let authorized = true;
const transport = { negotiate: r => server.negotiate(r, { authorized }), execute: async r => { const response = await server.execute(r, { authorized }); if (r.toolName === 'submit_artifact') throw new Error('Synthetic disconnect after source commit'); return response; }, getReceipt: r => server.getReceipt(r, { authorized }), cancel: r => server.cancel(r, { authorized }), readEvidence: r => server.readEvidence(r, { authorized }) };
const pair = await hydrateAgentPackageWithOutcomes(mode === 'produce' ? server.package() : saved.checkpoint, { connector: 'restart', model: 'offline', transport, permissions: { autoApproveAll: true }, contextFactory: () => ({ model: 'offline', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: localStorage } } }) });
try {
  if (mode === 'produce') {
    const read = await pair.agent.tools.executeWithOutcome('meeting_source', {}, { callId: 'read-source' }); assert.equal(read.result.quote, quote);
    await pair.agent.tools.executeWithOutcome('submit_artifact', {}, { callId: 'original-submission' });
    const op = pair.session.inspect().find(op => op.toolName === 'submit_artifact'), receipt = await server.getReceipt({ protocol: 'oneringai.tool-outcomes/1', packageId: pkg.packageId, sessionId: op.sessionId, requestId: op.operationId }, { authorized });
    await writeFile(checkpointPath, JSON.stringify({ checkpoint: pair.session.checkpoint(), sourcePackage: pkg, sourceReference: receipt.source, sourceSession: receipt.sessionId }));
    console.log(JSON.stringify({ mode, effects, operations: pair.session.inspect().length }));
  } else {
    assert.equal(pair.session.inspect().find(op => op.toolName === 'meeting_source').pendingSource, false);
    const pending = pair.session.inspect().find(op => op.toolName === 'submit_artifact'); assert.equal(pending.proxyOutcome.status, 'failed');
    const unknown = await pair.session.getReceipt(pending.operationId); assert.equal(unknown.state, 'unknown'); assert.equal(unknown.pendingSource, true);
    await assert.rejects(pair.agent.run('repeat submission'), /reconciliation/);
    authorized = false; await assert.rejects(transport.readEvidence({ protocol: 'oneringai.tool-outcomes/1', packageId: pkg.packageId, sessionId: saved.sourceSession, reference: saved.sourceReference }), /denied/);
    authorized = true; const record = await sourceStorage.readRecord(saved.sourceReference); assert.equal(record.result.payload.result.id, 'held-out-artifact-735');
    const sourceObservation = pair.session.inspect().find(op => op.toolName === 'meeting_source'); const local = await localStorage.readRecord(sourceObservation.reference); assert.equal(local.result.payload.result.quote, quote);
    assert.equal(JSON.parse(await readFile(countPath, 'utf8')).effects, 1);
    console.log(JSON.stringify({ mode, effects: 1, exactSource: true, reauthorization: true, sourceSettlement: record.result.receipt.serverOutcome.status, proxySettlement: pending.proxyOutcome.status, workflow: 'unknown', replayed: 0 }));
  }
} finally { pair.session.close(); pair.agent.destroy(); await server.close(); source.destroy(); Connector.remove('restart'); }
