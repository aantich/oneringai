import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { EvidenceReference } from '../../domain/interfaces/IEvidenceStorage.js';
import type { RoutineObservation, RoutineSource } from './types.js';

/** JSON snapshot semantics, with an early allocation guard and exact final byte check. */
export function boundedData<T>(value: T, maximum: number): { data: T; bytes: number } {
  let estimate = 0;
  const json = JSON.stringify(value, (key, child) => {
    if (typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint'
      || (typeof child === 'number' && !Number.isFinite(child))) throw new InvalidConfigError('Routine observations require JSON data');
    estimate += Buffer.byteLength(key) + (typeof child === 'string' ? Buffer.byteLength(child) : 8);
    if (estimate > maximum) throw new InvalidConfigError('Routine observation capacity exceeded');
    return child;
  });
  if (json === undefined) throw new InvalidConfigError('Routine observations require JSON data');
  const bytes = Buffer.byteLength(json);
  if (bytes > maximum) throw new InvalidConfigError('Routine observation capacity exceeded');
  return { data: JSON.parse(json) as T, bytes };
}

export function freezeData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

function referenceData(value: EvidenceReference): EvidenceReference {
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > 1024
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || !['process', 'restart', 'fsync'].includes(value.durability)) {
    throw new InvalidConfigError('Invalid routine source acknowledgement');
  }
  return freezeData({ version: 1, id: value.id, sha256: value.sha256, bytes: value.bytes, durability: value.durability });
}

interface SourceState {
  meta: RoutineSource;
  raw?: { value: unknown };
  pending: boolean;
  changed: number;
  coveredThrough?: number;
}

/** One operation's temporary data ownership; archival uses the host's existing storage. */
export class RoutineObservations {
  private readonly sources = new Map<string, SourceState>();
  private readonly frames = new Map<string, RoutineObservation>();
  private readonly archivedFrames = new Map<string, string>();
  private sequence = 0;
  readonly sourceIndexId: string;
  constructor(readonly operationId: string, readonly maximum: number) { this.sourceIndexId = `${operationId}:sources`; }

  get revision(): number { return this.sequence; }
  protectSince(revision: number): void { for (const source of this.sources.values()) if (source.changed > revision && !source.meta.reference) source.pending = true; }

  retain(kind: RoutineSource['kind'], value: unknown, key?: string): string {
    const changed = ++this.sequence;
    const id = key ?? `${this.operationId}:source:${changed}`;
    const existing = this.sources.get(id);
    if (!existing) this.sources.set(id, { meta: { id, kind, retained: 'operation' }, raw: { value }, pending: false, changed });
    else if (!existing.meta.reference) { existing.raw = { value }; existing.changed = changed; }
    return id;
  }

  archived(kind: RoutineSource['kind'], reference: EvidenceReference, key?: string): string {
    const changed = ++this.sequence, id = key ?? `${this.operationId}:source:${changed}`;
    this.sources.set(id, { meta: { id, kind, retained: 'evidence', reference: referenceData(reference) }, pending: false, changed });
    return id;
  }

  source(id: string, inline = false): RoutineSource {
    const state = this.sources.get(id);
    if (!state) throw new InvalidConfigError('Unknown routine observation source');
    if (inline && state.raw) {
      try { return freezeData({ ...state.meta, data: boundedData(state.raw.value, this.maximum).data }); }
      catch { state.pending = true; }
    }
    return freezeData({ ...state.meta });
  }

  requireArchive(id: string): void { const state = this.sources.get(id); if (state && !state.meta.reference) state.pending = true; }
  get hasPending(): boolean { return [...this.sources.values()].some(source => source.pending); }

  acknowledge(id: string, reference: EvidenceReference): void {
    const state = this.sources.get(id); if (!state) throw new InvalidConfigError('Unknown routine observation source');
    const accepted = referenceData(reference);
    if (state.meta.reference) {
      if (JSON.stringify(state.meta.reference) !== JSON.stringify(accepted)) throw new InvalidConfigError('Routine source acknowledgement is immutable');
      return;
    }
    state.meta = { ...state.meta, retained: 'evidence', reference: accepted };
    state.pending = false; delete state.raw;
    if (state.coveredThrough !== undefined) {
      // The host now owns the archived complete view/index. Retire its delivered
      // source metadata too, rather than retaining an implicit operation journal.
      for (const [key, source] of this.sources) if (key !== id && !source.pending && source.changed <= state.coveredThrough && !source.meta.reference) {
        source.meta = { ...source.meta, retained: 'evidence', reference: accepted }; delete source.raw;
      }
      for (const [key, sourceId] of this.archivedFrames) if (sourceId !== id && !this.sources.has(sourceId)) this.archivedFrames.delete(key);
    }
  }

  read(id: string, maximum = this.maximum): unknown {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new InvalidConfigError('Source read maxBytes must be a positive integer');
    if (id === this.sourceIndexId) return boundedData({ operationId: this.operationId, revision: this.sequence,
      sources: [...this.sources.keys()].map(key => this.source(key)) }, maximum).data;
    const state = this.sources.get(id);
    if (!state) throw new InvalidConfigError('Unknown routine observation source');
    if (!state.raw) throw new InvalidConfigError('Source is archived; read its reference through the owning evidence backend');
    return boundedData(state.raw.value, maximum).data;
  }

  view(key: string, candidate: RoutineObservation): RoutineObservation {
    const archiveId = this.archivedFrames.get(key);
    if (archiveId) {
      const source = this.source(archiveId);
      const compact: RoutineObservation = { operationId: candidate.operationId, ...(candidate.executionId ? { executionId: candidate.executionId } : {}), phase: candidate.phase, reason: candidate.reason,
        ...(candidate.phase === 'task' ? { taskId: candidate.taskId } : {}),
        tasks: [], toolOutcomes: [], stepOutcomes: [], sources: [source], complete: !this.hasPending,
        ...(candidate.quality ? { quality: candidate.quality } : {}),
        ...(candidate.initialVerification ? { initialVerification: candidate.initialVerification } : {}),
        ...(candidate.verification ? { verification: candidate.verification } : {}),
      } as RoutineObservation;
      const frozen = freezeData(boundedData(compact, this.maximum).data);
      const frames = new Map(this.frames); frames.set(key, frozen);
      try { boundedData([...frames.values()], this.maximum); }
      catch { this.archivedFrames.delete(key); return this.view(key, compact); }
      this.frames.set(key, frozen); return frozen;
    }
    try {
      const snapshot = boundedData(candidate, this.maximum).data;
      const frames = new Map(this.frames); frames.set(key, snapshot);
      boundedData([...frames.values()], this.maximum);
      const frozen = freezeData(snapshot); this.frames.set(key, frozen); return frozen;
    } catch {
      // Retain the complete candidate + previous snapshots before reducing the view.
      const coveredThrough = this.sequence;
      const id = this.retain('observation', { prior: [...this.frames.values()], current: candidate,
        sources: [...this.sources.keys()].map(source => this.source(source)) });
      this.sources.get(id)!.coveredThrough = coveredThrough;
      this.requireArchive(id); this.archivedFrames.set(key, id); this.frames.clear();
      return this.view(key, candidate);
    }
  }

  observations(): readonly RoutineObservation[] { return freezeData([...this.frames.values()]); }
  inspectSources(limit = 24): { sources: readonly RoutineSource[]; omittedSources: number } {
    const entries = [...this.sources.keys()];
    return { sources: freezeData(entries.slice(0, limit).map(id => this.source(id))), omittedSources: Math.max(0, entries.length - limit) };
  }
  references(): readonly EvidenceReference[] {
    return [...this.sources.values()].flatMap(source => source.meta.reference ? [source.meta.reference] : []);
  }
}
