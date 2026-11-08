import { MemoryEvidenceStorage } from './MemoryEvidenceStorage.js';
import type { EvidenceStorageOptions } from './EvidenceStorageBase.js';
import { encodeUTF8, decodeUTF8 } from '../runtime/primitives.js';
/** Bounded realm-local evidence; share the instance explicitly when resuming. */
export class InMemoryEvidenceStorage extends MemoryEvidenceStorage<Uint8Array> {
  constructor(options: EvidenceStorageOptions) { super(options, { encode: encodeUTF8, decode: decodeUTF8 }); }
}
