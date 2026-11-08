import { MemoryEvidenceStorage } from './MemoryEvidenceStorage.js';
import type { EvidenceStorageOptions } from './EvidenceStorageBase.js';
/** Bounded realm-local evidence; share the instance explicitly when resuming. */
export class InMemoryEvidenceStorage extends MemoryEvidenceStorage<Buffer> {
  constructor(options: EvidenceStorageOptions) { super(options, { encode: text => Buffer.from(text, 'utf8'), decode: bytes => bytes.toString('utf8') }); }
}
