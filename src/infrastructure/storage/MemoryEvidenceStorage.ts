import { randomUUID } from '../runtime/primitives.js';
import { EvidenceStorage } from './EvidenceStorageBase.js';
/** Bounded process-local store. Share the instance explicitly when resuming in-process. */
export class MemoryEvidenceStorage<Bytes extends Uint8Array> extends EvidenceStorage<Bytes> {
  readonly durability = 'process' as const;
  protected readonly queueKey = randomUUID();
  private readonly blobs = new Map<string, Bytes>();
  protected async inventory(): Promise<Array<{ id: string; bytes: number }>> { return [...this.blobs].map(([id, b]) => ({ id, bytes: b.length })); }
  protected async writeBlob(id: string, bytes: Bytes): Promise<void> { this.blobs.set(id, bytes); }
  protected async readBlob(id: string): Promise<Bytes | null> { return this.blobs.get(id) ?? null; }
  protected async removeBlob(id: string): Promise<boolean> { return this.blobs.delete(id); }
}
