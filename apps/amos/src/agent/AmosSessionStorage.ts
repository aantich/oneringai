import { FileContextStorage, type ContextSessionMetadata, type SerializedContextState, type AgentPresetName } from '@everworker/oneringai';

/** Keep AMOS labels in both the checkpoint and listing across all save paths. */
export class AmosSessionStorage extends FileContextStorage {
  private static readonly writes = new Map<string, Promise<void>>();

  constructor(options: ConstructorParameters<typeof FileContextStorage>[0], private readonly preset: () => AgentPresetName | null) {
    super(options);
  }

  async flush(): Promise<void> { await AmosSessionStorage.writes.get(this.getPath()); }

  override save(id: string, state: SerializedContextState, metadata?: ContextSessionMetadata): Promise<void> {
    // Autosave and explicit saves share the same file/temp path. Keep their
    // read/merge/write operations ordered, including after a failed save.
    const activePreset = this.preset();
    const location = this.getPath();
    const write = (AmosSessionStorage.writes.get(location) ?? Promise.resolve()).then(async () => {
      const existing = await super.load(id);
      const saved = state.metadata as SerializedContextState['metadata'] & ContextSessionMetadata;
      const labels: ContextSessionMetadata = {
        ...existing?.metadata, ...metadata,
        ...(saved.title === undefined ? {} : { title: saved.title }),
        agenticPreset: activePreset,
      };
      await super.save(id, { ...state, metadata: { ...labels, ...state.metadata } }, labels);
    });
    // Replacement runners share this location while their autosave timers overlap.
    const settled = write.catch(() => {});
    AmosSessionStorage.writes.set(location, settled);
    void settled.then(() => { if (AmosSessionStorage.writes.get(location) === settled) AmosSessionStorage.writes.delete(location); });
    return write;
  }
}
