/** Runner-independent, test-only conformance contract. No production export or test-runner dependency. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { EvidenceScope, IEvidenceStorage, EvidenceRecord } from '../../src/domain/interfaces/IEvidenceStorage.js';
export interface EvidenceProfile {
  name: string; durability: 'process' | 'restart' | 'fsync';
  create(scope: EvidenceScope, limits?: { maxRecords?: number; maxReadChars?: number }): Promise<IEvidenceStorage>;
  reopen?(scope: EvidenceScope): Promise<IEvidenceStorage>;
}
export async function runEvidenceConformance(profile: EvidenceProfile) {
  let assertions = 0; const check = (condition: unknown) => { assert.ok(condition); assertions++; };
  const scope = { ownerId: 'held-out-owner', namespace: 'conformance/source', tenantId: 'tenant-a' };
  const store = await profile.create(scope, { maxReadChars: 31 });
  const record: EvidenceRecord = { version: 1, recordedAt: Date.now(), source: { toolName: 'held_out_read', executionId: 'source-original', callId: 'call-original', arguments: { id: 'exact-source' }, principal: { userId: scope.ownerId }, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 2 }, result: { id: 'exact-source', text: 'Held out quote é🦊. '.repeat(120) } };
  const expected = structuredClone(record), ref = await store.put(record); check(ref.durability === profile.durability); check(ref.bytes > 0); check(/^[a-f0-9]{64}$/.test(ref.sha256));
  record.result = 'mutated after admission'; assert.deepEqual(await store.readRecord(ref), expected); assertions++;
  const detached = await store.readRecord(ref); detached!.result = 'mutated read'; assert.deepEqual(await store.readRecord(ref), expected); assertions++;
  let text = '', offset = 0, pages = 0;
  for (;;) { const chunk = await store.read(ref, { offset, limit: 31 }); check(chunk && chunk.text.length <= 31); text += chunk!.text; pages++;
    if (chunk!.nextOffset === undefined) break; check(chunk!.nextOffset === offset + chunk!.text.length && chunk!.nextOffset > offset); offset = chunk!.nextOffset; }
  assert.deepEqual(JSON.parse(text), expected); assertions++; check(pages > 2);
  await assert.rejects(store.readRecord({ ...ref, sha256: '0'.repeat(64) })); assertions++;
  const other = await profile.create({ ...scope, tenantId: 'tenant-b' }); check(await other.readRecord(ref) === null);
  const expired = await store.put({ ...expected, expiresAt: Date.now() - 1 }); check(await store.readRecord(expired) === null); check(!(await store.list({ limit: 100 })).entries.some(e => e.reference.id === expired.id));
  const concurrent = await Promise.all(Array.from({ length: 5 }, (_, i) => store.put({ ...expected, source: { ...expected.source, executionId: `parallel-${i}` }, result: { i } })));
  check(new Set(concurrent.map(r => r.id)).size === 5); for (const [i, r] of concurrent.entries()) { assert.deepEqual((await store.readRecord(r))?.result, { i }); assertions++; }
  if (profile.reopen) { const reopened = await profile.reopen(scope); assert.deepEqual(await reopened.readRecord(ref), expected); assertions++; }
  const quota = await profile.create({ ...scope, namespace: 'conformance/quota' }, { maxRecords: 1 }); await quota.put(expected); await assert.rejects(quota.put(expected)); assertions++;
  check(await store.delete(concurrent[0]!) === true); check(await store.readRecord(concurrent[0]!) === null); check(await store.pruneExpired() === 1);
  return { profile: profile.name, durability: profile.durability, assertions, pages, exactSourceSHA256: createHash('sha256').update(JSON.stringify(expected.result)).digest('hex'), processReopen: !!profile.reopen, childProcessRecovery: 'separate required profile' };
}
