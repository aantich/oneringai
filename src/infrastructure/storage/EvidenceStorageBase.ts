import { randomUUID, byteLength } from '../runtime/primitives.js';
import type { EvidenceScope, EvidenceDurability, EvidenceRecord, EvidenceReference, EvidenceReadOptions, EvidenceChunk, EvidenceEntry, IEvidenceStorage } from '../../domain/interfaces/IEvidenceStorage.js';
import { EvidenceError, hash, integer, json, validateRecord, validateReference, validateScope, validateEvidenceId } from '../../core/evidence/validation.js';
export interface EvidenceStorageOptions {
  scope: EvidenceScope;
  /** Defaults: record 4 MiB, scope 64 MiB / 1000 records; writes fail at capacity. */
  maxRecordBytes?: number;
  maxTotalBytes?: number;
  maxRecords?: number;
  /** Defaults: 8192 characters per chunk, 8 simultaneous reads. Busy reads fail. */
  maxReadChars?: number;
  maxConcurrentReads?: number;
  /** Bound queued mutations in this process, default 32. */
  maxPendingWrites?: number;
}
export interface FileEvidenceStorageOptions extends EvidenceStorageOptions {
  directory: string;
  /** Default restart; fsync also synchronizes file and directory entries before acknowledgement. */
  durability?: 'restart' | 'fsync';
}

// File instances in this process share quota admission. Cross-process writers require
// host coordination or a transactional custom backend; this is not a distributed lock.
const queues = new Map<string, Promise<unknown>>();
const pending = new Map<string, number>();
export abstract class EvidenceStorage<Bytes extends Uint8Array> implements IEvidenceStorage {
  readonly scope: Readonly<EvidenceScope>;
  abstract readonly durability: EvidenceDurability;
  protected readonly maxRecordBytes: number;
  protected readonly maxTotalBytes: number;
  protected readonly maxRecords: number;
  private readonly maxReadChars: number;
  private readonly maxConcurrentReads: number;
  private reads = 0;
  private readonly maxPendingWrites: number;
  protected abstract readonly queueKey: string;
  constructor(options: EvidenceStorageOptions, private readonly codec: { encode(text: string): Bytes; decode(bytes: Bytes): string }) {
    this.scope = validateScope(options.scope);
    this.maxRecordBytes = integer(options.maxRecordBytes ?? 4 * 1024 * 1024);
    this.maxTotalBytes = integer(options.maxTotalBytes ?? 64 * 1024 * 1024);
    this.maxRecords = integer(options.maxRecords ?? 1000);
    this.maxReadChars = integer(options.maxReadChars ?? 8192);
    this.maxConcurrentReads = integer(options.maxConcurrentReads ?? 8);
    this.maxPendingWrites = integer(options.maxPendingWrites ?? 32);
  }
  protected abstract inventory(): Promise<Array<{ id: string; bytes: number }>>;
  protected abstract writeBlob(id: string, bytes: Bytes): Promise<void>;
  protected abstract readBlob(id: string): Promise<Bytes | null>;
  protected abstract removeBlob(id: string): Promise<boolean>;
  /** Capture admitted input synchronously, before waiting on earlier mutations. */
  private serial<T>(fn: () => Promise<T>, prepare?: () => void): Promise<T> {
    const count = pending.get(this.queueKey) ?? 0;
    if (count >= this.maxPendingWrites) return Promise.reject(new EvidenceError('busy'));
    pending.set(this.queueKey, count + 1);
    try { prepare?.(); }
    catch (error) {
      const remaining = (pending.get(this.queueKey) ?? 1) - 1;
      if (remaining) pending.set(this.queueKey, remaining); else pending.delete(this.queueKey);
      return Promise.reject(error);
    }
    const prior = queues.get(this.queueKey) ?? Promise.resolve();
    const current = prior.catch(() => undefined).then(fn);
    queues.set(this.queueKey, current);
    void current.finally(() => {
      const remaining = (pending.get(this.queueKey) ?? 1) - 1;
      if (remaining) pending.set(this.queueKey, remaining); else pending.delete(this.queueKey);
      if (queues.get(this.queueKey) === current) queues.delete(this.queueKey);
    }).catch(() => undefined);
    return current;
  }
  private async guarded<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.reads >= this.maxConcurrentReads) throw new EvidenceError('busy');
    this.reads++;
    try { const result = await fn(); signal?.throwIfAborted(); return result; }
    catch (error) { if (error instanceof EvidenceError || signal?.aborted) throw error; throw new EvidenceError('storage'); }
    finally { this.reads--; }
  }
  private reference(id: string, bytes: Bytes, acknowledged = false): EvidenceReference {
    return Object.freeze({ version: 1, id, sha256: hash(bytes), bytes: bytes.length, durability: this.durability === 'fsync' && !acknowledged ? 'restart' : this.durability });
  }
  private decode(bytes: Bytes): EvidenceRecord {
    try {
      if (bytes.length > this.maxRecordBytes) throw new EvidenceError('corrupt');
      const value = JSON.parse(this.codec.decode(bytes)) as { scope: EvidenceScope; record: EvidenceRecord; integrity: string };
      if (json(value.scope) !== json(this.scope)) throw new EvidenceError('corrupt');
      if (value.integrity !== hash(json({ scope: value.scope, record: value.record }))) throw new EvidenceError('corrupt');
      validateRecord(value.record);
      return value.record;
    } catch { throw new EvidenceError('corrupt'); }
  }
  private async verified(reference: EvidenceReference): Promise<EvidenceRecord | null> {
    validateReference(reference);
    const bytes = await this.readBlob(reference.id);
    if (!bytes) return null;
    if (bytes.length !== reference.bytes || hash(bytes) !== reference.sha256) throw new EvidenceError('corrupt');
    const record = this.decode(bytes);
    return record.expiresAt !== undefined && record.expiresAt <= Date.now() ? null : record;
  }
  /** Optional hint for middleware to inherit this store's existing capacity without changing custom adapters. */
  get serializationLimitBytes(): number { return Math.min(this.maxRecordBytes, this.maxTotalBytes); }
  async put(record: EvidenceRecord): Promise<EvidenceReference> {
    let bytes: Bytes;
    const id = randomUUID();
    return this.serial(async () => {
      try {
        const entries = await this.inventory();
        if (entries.length >= this.maxRecords || entries.reduce((total, e) => total + e.bytes, 0) + bytes.length > this.maxTotalBytes) throw new EvidenceError('capacity');
        await this.writeBlob(id, bytes);
        return this.reference(id, bytes, true);
      } catch (error) { if (error instanceof EvidenceError) throw error; throw new EvidenceError('storage'); }
    }, () => {
      const overhead = byteLength(',"integrity":' + JSON.stringify('0'.repeat(64)));
      if (this.serializationLimitBytes <= overhead) throw new EvidenceError('capacity');
      const data = json({ scope: this.scope, record }, this.serializationLimitBytes - overhead);
      validateRecord(JSON.parse(data).record as EvidenceRecord);
      // Reuse the exact captured JSON rather than serializing the source graph a second time.
      bytes = this.codec.encode(data.slice(0, -1) + ',"integrity":' + JSON.stringify(hash(data)) + '}');
    });
  }
  async getReference(id: string, signal?: AbortSignal): Promise<EvidenceReference | null> {
    validateEvidenceId(id);
    return this.guarded(async () => {
      const bytes = await this.readBlob(id);
      if (!bytes) return null;
      const record = this.decode(bytes);
      return record.expiresAt !== undefined && record.expiresAt <= Date.now() ? null : this.reference(id, bytes);
    }, signal);
  }
  async readRecord(reference: EvidenceReference): Promise<EvidenceRecord | null> {
    return this.guarded(() => this.verified(reference));
  }
  async read(reference: EvidenceReference, options: EvidenceReadOptions = {}): Promise<EvidenceChunk | null> {
    const offset = integer(options.offset ?? 0, 0);
    const limit = integer(options.limit ?? this.maxReadChars);
    if (limit > this.maxReadChars) throw new EvidenceError('invalid');
    return this.guarded(async () => {
      const record = await this.verified(reference);
      if (!record) return null;
      const serialized = json(record);
      if (offset > serialized.length) throw new EvidenceError('invalid');
      const end = Math.min(offset + limit, serialized.length);
      return { reference: this.referenceCopy(reference), text: serialized.slice(offset, end), totalChars: serialized.length,
        ...(end < serialized.length ? { nextOffset: end } : {}) };
    }, options.signal);
  }
  private referenceCopy(r: EvidenceReference): EvidenceReference {
    return { version: 1, id: r.id, sha256: r.sha256, bytes: r.bytes, durability: r.durability };
  }
  async list(options: { after?: string; limit?: number; signal?: AbortSignal } = {}): Promise<{ entries: EvidenceEntry[]; next?: string }> {
    const limit = integer(options.limit ?? 20);
    if (limit > 100 || (options.after !== undefined && !/^[0-9a-f-]{36}$/.test(options.after))) throw new EvidenceError('invalid');
    return this.guarded(async () => {
      const inventory = (await this.inventory()).sort((a, b) => a.id.localeCompare(b.id));
      const entries: EvidenceEntry[] = [];
      for (const item of inventory) {
        options.signal?.throwIfAborted();
        if (options.after && item.id <= options.after) continue;
        const bytes = await this.readBlob(item.id);
        if (!bytes) continue;
        const record = this.decode(bytes);
        if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) continue;
        if (entries.length === limit) return { entries, next: entries[entries.length - 1]!.reference.id };
        const s = record.source;
        entries.push({ reference: this.reference(item.id, bytes), recordedAt: record.recordedAt,
          ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }), toolName: s.toolName,
          ...(s.callId === undefined ? {} : { callId: s.callId }), status: s.status, completion: s.completion, effect: s.effect });
      }
      return { entries };
    }, options.signal);
  }
  async delete(reference: EvidenceReference): Promise<boolean> {
    validateReference(reference);
    return this.serial(async () => {
      // Includes expired records; a forged digest must never authorize deletion.
      const bytes = await this.readBlob(reference.id);
      if (!bytes) return false;
      if (hash(bytes) !== reference.sha256 || bytes.length !== reference.bytes) throw new EvidenceError('corrupt');
      this.decode(bytes);
      return this.removeBlob(reference.id);
    });
  }
  async pruneExpired(now = Date.now()): Promise<number> {
    if (!Number.isFinite(now)) throw new EvidenceError('invalid');
    return this.serial(async () => {
      let count = 0;
      for (const item of await this.inventory()) {
        const bytes = await this.readBlob(item.id);
        if (!bytes) continue;
        const record = this.decode(bytes);
        if (record.expiresAt !== undefined && record.expiresAt <= now && await this.removeBlob(item.id)) count++;
      }
      return count;
    });
  }
}
