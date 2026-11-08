import { describe, expect, it } from 'vitest';
import { InMemoryEvidenceStorage } from '../../../src/infrastructure/storage/EvidenceStorage.js';
import { InMemoryEvidenceStorage as DirectMemory } from '../../../src/infrastructure/storage/InMemoryEvidenceStorage.js';
import { InMemoryEvidenceStorage as BrowserMemory } from '../../../src/infrastructure/storage/InMemoryEvidenceStorage.browser.js';
import type { EvidenceRecord } from '../../../src/domain/interfaces/IEvidenceStorage.js';

class ExistingBufferExtension extends InMemoryEvidenceStorage {
  protected override async writeBlob(id: string, bytes: Buffer): Promise<void> {
    expect(Buffer.isBuffer(bytes)).toBe(true); await super.writeBlob(id, bytes);
  }
  protected override async readBlob(id: string): Promise<Buffer | null> { return super.readBlob(id); }
}
describe('evidence split compatibility', () => {
  it('retains public/direct constructor identity and protected Buffer operations', async () => {
    expect(DirectMemory).toBe(InMemoryEvidenceStorage);
    const record: EvidenceRecord = { version: 1, recordedAt: 1, source: { toolName: 'fixture', executionId: 'one', effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 0, arguments: {}, principal: {} }, result: { text: '😀 café' } };
    const scope = { ownerId: 'owner', namespace: 'test' };
    const left = new ExistingBufferExtension({ scope }), right = new BrowserMemory({ scope });
    const native = await left.put(record), portable = await right.put(record);
    expect(portable.sha256).toBe(native.sha256); expect(portable.bytes).toBe(native.bytes);
    expect(await left.readRecord(native)).toEqual(record); expect(await right.readRecord(portable)).toEqual(record);
    await expect(right.readRecord({ ...portable, sha256: '0'.repeat(64) })).rejects.toThrow('corrupt');
    expect(await right.delete(portable)).toBe(true); expect(await right.readRecord(portable)).toBeNull();
  });
});
