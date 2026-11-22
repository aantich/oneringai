/** Storage for an OAuth integration's opaque installation and session snapshot. */
export interface OAuthSessionStorage {
  /** Read the snapshot, or return null for a new installation. */
  load(): Promise<string | null>;
  /** Atomically replace the protected snapshot and resolve after it is committed. */
  save(snapshot: string): Promise<void>;
  /** Optional synchronous check for an unlocked and usable credential store. */
  available?(): boolean;
}
