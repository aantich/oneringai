/** Demo implementation of the existing interface. It is intentionally process/realm local. */
import { CONTEXT_SESSION_FORMAT_VERSION } from 'oneringai';
import type { ContextSessionMetadata, ContextSessionSummary, IContextStorage, SerializedContextState, StoredContextSession } from 'oneringai';
export class DemoMemorySessions implements IContextStorage {
  private readonly sessions = new Map<string, StoredContextSession>();
  async save(sessionId: string, state: SerializedContextState, metadata: ContextSessionMetadata = {}): Promise<void> {
    const prior = this.sessions.get(sessionId), now = new Date().toISOString();
    this.sessions.set(sessionId, { version: CONTEXT_SESSION_FORMAT_VERSION, sessionId, state: structuredClone(state), metadata,
      createdAt: prior?.createdAt ?? now, lastSavedAt: now });
  }
  async load(sessionId: string): Promise<StoredContextSession | null> { return structuredClone(this.sessions.get(sessionId) ?? null); }
  async delete(sessionId: string): Promise<void> { this.sessions.delete(sessionId); }
  async exists(sessionId: string): Promise<boolean> { return this.sessions.has(sessionId); }
  async list(): Promise<ContextSessionSummary[]> { return [...this.sessions.values()].map(item => ({
    sessionId: item.sessionId, createdAt: new Date(item.createdAt), lastSavedAt: new Date(item.lastSavedAt),
    messageCount: item.state.conversation.length, memoryEntryCount: 0, metadata: item.metadata,
  })); }
  getPath(): string { return 'memory://browser-node-demo'; }
}
