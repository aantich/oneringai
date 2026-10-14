/** Offline: npm run example:durable-evidence (build first). Uses a temporary directory and cleans it. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { AgentContextNextGen, ContentType, FileContextStorage, FileEvidenceStorage, InMemoryStorage, MessageRole, ToolCallState } from '@everworker/oneringai';
import type { ToolFunction } from '@everworker/oneringai';

const directory = await mkdtemp(join(tmpdir(), 'oneringai-evidence-example-'));
const scope = { ownerId: 'example-user', namespace: 'search-demo' };
const result = { status: 'found', ids: ['DOC_17', 'DOC_42'], exactMarker: 'SOURCE_EXACT_672', rows: 'Large search evidence. '.repeat(4000) };
const storage = new FileEvidenceStorage({ directory: join(directory, 'evidence'), scope });
const sessions = new FileContextStorage({ agentId: 'evidence-example', baseDirectory: join(directory, 'sessions') });
const create = (store: FileEvidenceStorage) => AgentContextNextGen.create({ model: 'gpt-4o-mini', agentId: 'evidence-example', userId: scope.ownerId,
  storage: sessions, features: { workingMemory: true, inContextMemory: false, evidence: true },
  plugins: { workingMemory: { storage: new InMemoryStorage() }, evidence: { storage: store } } });
let context = create(storage);
try {
  const search: ToolFunction = { definition: { type: 'function', function: { name: 'large_search', description: 'Return synthetic search evidence', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
    execute: async () => result, output: { expectedSize: 'large', effect: 'read', summarize: value => {
      const r = value as typeof result; return JSON.stringify({ status: r.status, ids: r.ids });
    } } };
  context.tools.register(search);
  context.addUserMessage('Find the documents.');
  context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'search-call', name: 'large_search', arguments: '{}' }] }]);
  const report = await context.tools.executeWithOutcome('large_search', {}, { callId: 'search-call', runId: 'example-run' });
  assert.equal(report.result, result); assert.ok(report.evidence?.reference); assert.ok(report.evidence.projection);
  context.addToolResults([{ tool_use_id: 'search-call', content: report.result, evidence: report.evidence, state: ToolCallState.COMPLETED }]);
  assert.ok(!JSON.stringify(context.getCurrentInput()).includes(result.rows));
  context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.OUTPUT_TEXT, text: 'Two documents found.' }] }]);
  await context.memory!.store('temporary', 'Evictable scratch', { scratch: 'discard me' });
  await context.memory!.delete('temporary');
  const rollover = await context.rollover({ preserveRecentTurns: 0, summarize: async () => 'Search completed; inspect evidence for the source.' });
  assert.equal(rollover.performed, true);
  await context.save('evidence-demo'); context.destroy();
  const restarted = new FileEvidenceStorage({ directory: join(directory, 'evidence'), scope });
  context = create(restarted); assert.equal(await context.load('evidence-demo'), true);
  assert.deepEqual((await restarted.readRecord(report.evidence.reference))?.result, result);
  // A genuinely separate Node process checks restart recovery through the built public package.
  const script = `import { FileEvidenceStorage } from '@everworker/oneringai';
    const [directory, scope, reference] = process.argv.slice(1);
    const storage = new FileEvidenceStorage({directory, scope: JSON.parse(scope)});
    const record = await storage.readRecord(JSON.parse(reference));
    if (record?.result?.exactMarker !== 'SOURCE_EXACT_672') throw new Error('Evidence did not survive restart');
    console.log('Separate-process exact evidence recovery passed');`;
  const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, join(directory, 'evidence'), JSON.stringify(scope), JSON.stringify(report.evidence.reference)], { cwd: process.cwd() });
  console.log(`Raw application result: ${JSON.stringify(result).length} characters; model projection: ${report.evidence.projection.length} characters.`);
  console.log('Status and document IDs preserved; scratch evicted; history rolled over; saved context restored.');
  console.log(child.stdout.trim());
  console.log(`Acknowledgement: ${report.evidence.reference.durability}. This demonstrates ordinary restart, not crash/replica durability.`);
} finally { context.destroy(); await rm(directory, { recursive: true, force: true }); }
