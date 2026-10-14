import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEvidenceStorage, InMemoryEvidenceStorage } from '@/infrastructure/storage/EvidenceStorage.js';
import type { EvidenceRecord, IEvidenceStorage } from '@/domain/interfaces/IEvidenceStorage.js';
import { EvidenceError, json } from '@/core/evidence/validation.js';

const scope = { ownerId: 'Alice', namespace: 'task/1', tenantId: 'Acme' };
const dirs: string[] = [];
async function directory() { const d = await mkdtemp(join(tmpdir(), 'oneringai-evidence-')); dirs.push(d); return d; }
function record(result: unknown = { id: 'source-17', text: 'é🦊'.repeat(100) }): EvidenceRecord {
  return { version: 1, recordedAt: Date.now(), source: { toolName: 'search', executionId: 'exec', arguments: { q: 'test' }, principal: { userId: 'Alice' },
    effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 2 }, result };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
for (const kind of ['memory', 'file'] as const) describe(`${kind} bounded evidence contract`, () => {
  async function store(extra = {}): Promise<IEvidenceStorage> { return kind === 'file' ? new FileEvidenceStorage({ directory: await directory(), scope, ...extra }) : new InMemoryEvidenceStorage({ scope, ...extra }); }
  it('acknowledges stable immutable references and reconstructs exact JSON through bounded chunks', async () => {
    const s = await store({ maxReadChars: 17 }); const value = record(); const ref = await s.put(value);
    expect(ref.durability).toBe(kind === 'file' ? 'restart' : 'process'); expect(Object.isFrozen(ref)).toBe(true);
    value.result = 'changed'; expect((await s.readRecord(ref))?.result).not.toBe('changed');
    let text = ''; let offset = 0;
    for (;;) { const page = await s.read(ref, { offset, limit: 17 }); expect(page!.text.length).toBeLessThanOrEqual(17); text += page!.text;
      if (page!.nextOffset === undefined) break; offset = page!.nextOffset; }
    expect(JSON.parse(text)).toEqual(await s.readRecord(ref));
    const detached = await s.readRecord(ref); detached!.result = 'tampered'; expect((await s.readRecord(ref))?.result).not.toBe('tampered');
  });
  it('resolves scoped IDs without requiring the model to supply integrity metadata', async () => {
    const s = await store(); const ref = await s.put(record());
    expect(await s.getReference!(ref.id)).toEqual(ref); await expect(s.getReference!('../escape')).rejects.toMatchObject({ code: 'invalid' });
    await s.delete(ref); expect(await s.getReference!(ref.id)).toBeNull();
  });
  it('provides bounded metadata pagination without exposing arguments or source content', async () => {
    const s = await store(); await Promise.all([s.put(record('SECRET_SOURCE')), s.put(record('OTHER'))]);
    const page = await s.list({ limit: 1 }); expect(page.entries).toHaveLength(1); expect(page.next).toBeDefined();
    expect(JSON.stringify(page)).not.toContain('SECRET_SOURCE'); expect(page.entries[0]).not.toHaveProperty('result'); expect(page.entries[0]).not.toHaveProperty('arguments');
    const next = await s.list({ after: page.next, limit: 1 }); expect(next.entries).toHaveLength(1); expect(next.next).toBeUndefined();
    expect(next.entries[0]!.reference.id).not.toBe(page.entries[0]!.reference.id);
  });
  it('enforces record, total-byte and record-count admission including concurrent writes', async () => {
    const tiny = await store({ maxRecordBytes: 100 }); await expect(tiny.put(record())).rejects.toMatchObject({ code: 'capacity' });
    const s = await store({ maxRecords: 2 }); const results = await Promise.allSettled(Array.from({ length: 5 }, () => s.put(record())));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2); expect((await s.list()).entries).toHaveLength(2);
    const byteLimited = await store({ maxTotalBytes: 1800 }); const first = await byteLimited.put(record());
    await expect(byteLimited.put(record())).rejects.toMatchObject({ code: 'capacity' }); expect(await byteLimited.readRecord(first)).not.toBeNull();
  });
  it('rejects malformed references and digest/size forgery without deleting a valid record', async () => {
    const s = await store(); const ref = await s.put(record());
    for (const forged of [{ ...ref, id: '../../escape' }, { ...ref, sha256: 'bad' }, { ...ref, version: 2 }, { ...ref, bytes: -1 }]) {
      await expect(s.readRecord(forged as typeof ref)).rejects.toBeInstanceOf(EvidenceError);
    }
    for (const forged of [{ ...ref, sha256: '0'.repeat(64) }, { ...ref, bytes: ref.bytes + 1 }]) {
      await expect(s.read(forged)).rejects.toMatchObject({ code: 'corrupt' }); await expect(s.delete(forged)).rejects.toMatchObject({ code: 'corrupt' });
    }
    expect(await s.delete(ref)).toBe(true); expect(await s.read(ref)).toBeNull(); expect(await s.delete(ref)).toBe(false);
  });
  it.each([undefined, NaN, Infinity, 1n, () => 1, new Date(), [, 2], { x: undefined }])('rejects lossy/non-JSON source values %s', async result => {
    const s = await store(); const r = record(); r.result = result; await expect(s.put(r)).rejects.toMatchObject({ code: 'invalid' });
    expect((await s.list()).entries).toHaveLength(0);
  });
  it('rejects cycles and accessors without invoking getters or toJSON', async () => {
    const s = await store(); const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(s.put(record(cyclic))).rejects.toBeInstanceOf(EvidenceError);
    const get = vi.fn(() => 'sensitive'); await expect(s.put(record({ get secret() { return get(); } }))).rejects.toBeInstanceOf(EvidenceError);
    await expect(s.put(record({ toJSON: get }))).rejects.toBeInstanceOf(EvidenceError); expect(get).not.toHaveBeenCalled();
  });
  it('keeps expired data out of reads/listings until explicit pruning frees capacity', async () => {
    const s = await store({ maxRecords: 1 }); const r = record(); r.expiresAt = Date.now() - 1; const ref = await s.put(r);
    expect(await s.readRecord(ref)).toBeNull(); expect((await s.list()).entries).toHaveLength(0); await expect(s.put(record())).rejects.toMatchObject({ code: 'capacity' });
    expect(await s.pruneExpired()).toBe(1); expect(await s.pruneExpired()).toBe(0); await expect(s.put(record())).resolves.toBeDefined();
  });
  it('rejects excessive/invalid pagination and observes cancellation before and after reads', async () => {
    const s = await store(); const ref = await s.put(record());
    for (const options of [{ offset: -1 }, { limit: 0 }, { limit: 8193 }, { offset: 0.5 }, { offset: Number.MAX_SAFE_INTEGER }]) await expect(s.read(ref, options)).rejects.toMatchObject({ code: 'invalid' });
    for (const options of [{ limit: 0 }, { limit: 101 }, { after: '../escape' }]) await expect(s.list(options)).rejects.toMatchObject({ code: 'invalid' });
    const abort = new AbortController(); abort.abort(); await expect(s.read(ref, { signal: abort.signal })).rejects.toThrow(); await expect(s.list({ signal: abort.signal })).rejects.toThrow();
  });
  it('rejects malformed records and invalid storage limits/scopes', async () => {
    const s = await store(); await expect(s.put({ ...record(), version: 2 } as unknown as EvidenceRecord)).rejects.toMatchObject({ code: 'invalid' });
    for (const options of [{ maxRecords: 0 }, { maxReadChars: NaN }, { maxConcurrentReads: 0 }, { scope: { ownerId: '', namespace: 'a' } }]) expect(() => new InMemoryEvidenceStorage({ scope, ...options })).toThrow(EvidenceError);
  });
});

describe('file durability, integrity and isolation', () => {
  it('survives a new instance and preserves case/path-distinct scopes without sanitization collisions', async () => {
    const d = await directory(); const s = new FileEvidenceStorage({ directory: d, scope }); const ref = await s.put(record());
    const restarted = new FileEvidenceStorage({ directory: d, scope }); expect(await restarted.readRecord(ref)).toEqual(await s.readRecord(ref));
    for (const altered of [{ ...scope, ownerId: 'alice' }, { ...scope, namespace: 'task_1' }, { ...scope, tenantId: 'other' }]) {
      const other = new FileEvidenceStorage({ directory: d, scope: altered }); expect(await other.read(ref)).toBeNull(); expect(await other.getReference(ref.id)).toBeNull(); expect((await other.list()).entries).toHaveLength(0); expect(await other.delete(ref)).toBe(false);
    }
  });
  it('supports fsync acknowledgement and does not upgrade old refs through a stronger reader', async () => {
    const d = await directory(); const restart = new FileEvidenceStorage({ directory: d, scope }); const old = await restart.put(record());
    const durable = new FileEvidenceStorage({ directory: d, scope, durability: 'fsync' }); const ref = await durable.put(record()); expect(ref.durability).toBe('fsync');
    expect((await durable.read(old))!.reference.durability).toBe('restart'); expect((await durable.list()).entries.every(e => e.reference.durability === 'restart')).toBe(true);
  });
  it.each(['malformed', 'mutated', 'oversized', 'schema'])('detects %s blobs, including metadata discovery', async kind => {
    const d = await directory(); const s = new FileEvidenceStorage({ directory: d, scope, maxRecordBytes: 4096 }); const ref = await s.put(record());
    const folder = join(d, (await readdir(d))[0]!); const path = join(folder, `${ref.id}.json`); const envelope = JSON.parse(await readFile(path, 'utf8'));
    if (kind === 'malformed') await writeFile(path, '{');
    else if (kind === 'oversized') await writeFile(path, 'x'.repeat(4097));
    else { if (kind === 'schema') envelope.record.version = 99; else envelope.record.result = 'changed'; await writeFile(path, JSON.stringify(envelope)); }
    await expect(s.readRecord(ref)).rejects.toMatchObject({ code: 'corrupt' }); await expect(s.list()).rejects.toBeInstanceOf(EvidenceError); await expect(s.getReference(ref.id)).rejects.toBeInstanceOf(EvidenceError);
  });
  it('blocks symlink blobs and creates private directories/files', async () => {
    const d = await directory(); const s = new FileEvidenceStorage({ directory: d, scope }); const ref = await s.put(record()); const folder = join(d, (await readdir(d))[0]!);
    expect((await stat(folder)).mode & 0o777).toBe(0o700); const path = join(folder, `${ref.id}.json`); expect((await stat(path)).mode & 0o777).toBe(0o600);
    await rm(path); const target = join(d, 'target'); await writeFile(target, 'secret'); await symlink(target, path);
    await expect(s.readRecord(ref)).rejects.toBeInstanceOf(EvidenceError); await expect(s.list()).rejects.toBeInstanceOf(EvidenceError);
  });
  it('coordinates capacity across simultaneous instances in one process', async () => {
    const d = await directory(); const stores = Array.from({ length: 4 }, () => new FileEvidenceStorage({ directory: d, scope, maxRecords: 1 }));
    const settled = await Promise.allSettled(stores.map(s => s.put(record()))); expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('does not acknowledge a filesystem write failure or expose backend exception text', async () => {
    const d = await directory(); const file = join(d, 'file'); await writeFile(file, 'x'); const s = new FileEvidenceStorage({ directory: file, scope });
    const error = await s.put(record()).catch(e => e); expect(error).toMatchObject({ code: 'storage', message: 'Evidence storage' }); expect(String(error)).not.toContain(d);
  });
  it('bounds concurrent blob reads and frees slots after failure', async () => {
    const s = new InMemoryEvidenceStorage({ scope, maxConcurrentReads: 1 }); const ref = await s.put(record());
    const [one, two] = await Promise.allSettled([s.read(ref), s.read(ref)]); expect(one.status).toBe('fulfilled'); expect(two).toMatchObject({ status: 'rejected', reason: { code: 'busy' } });
    expect(await s.readRecord(ref)).not.toBeNull();
  });
  it('limits nesting and rejects symbol-bearing records', () => {
    let value: unknown = null; for (let i = 0; i < 102; i++) value = { value }; expect(() => json(value)).toThrow(EvidenceError);
    expect(() => json({ [Symbol('hidden')]: 'secret' })).toThrow(EvidenceError);
  });
});

describe('strict serialization and bounded write admission', () => {
  it('rejects array accessors and non-enumerable toJSON without executing them', () => {
    const getter = vi.fn(); const array = [1]; Object.defineProperty(array, '0', { get: getter }); expect(() => json(array)).toThrow(EvidenceError);
    const value = {}; Object.defineProperty(value, 'toJSON', { value: getter }); expect(() => json(value)).toThrow(EvidenceError); expect(getter).not.toHaveBeenCalled();
  });
  it('bounds queued mutations and releases admission after completion', async () => {
    const s = new InMemoryEvidenceStorage({ scope, maxPendingWrites: 1 }); const first = s.put(record()); await expect(s.put(record())).rejects.toMatchObject({ code: 'busy' });
    await first; await expect(s.put(record())).resolves.toBeDefined();
  });
});

describe('read cancellation and schema ownership checks', () => {
  it('observes an abort while a read is pending and releases its read slot', async () => {
    const s = new InMemoryEvidenceStorage({ scope, maxConcurrentReads: 1 }); const ref = await s.put(record()); const controller = new AbortController();
    const pending = s.read(ref, { signal: controller.signal }); controller.abort(); await expect(pending).rejects.toThrow(); await expect(s.read(ref)).resolves.not.toBeNull();
  });
  it('rejects missing arguments or malformed principal fields before acknowledging a record', async () => {
    const s = new InMemoryEvidenceStorage({ scope }); const noArgs = record(); delete (noArgs.source as Partial<typeof noArgs.source>).arguments;
    await expect(s.put(noArgs)).rejects.toMatchObject({ code: 'invalid' });
    const badPrincipal = record(); badPrincipal.source.principal.userId = 3 as never; await expect(s.put(badPrincipal)).rejects.toMatchObject({ code: 'invalid' });
  });
});
