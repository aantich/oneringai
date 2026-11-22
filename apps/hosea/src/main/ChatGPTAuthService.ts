/** Hosea applies one selected registration across its OpenAI agents. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatGPTPlanAuth, type ChatGPTPlanAuthOptions, type OAuthSessionStorage } from 'oneringai/auth/openai';
import type { ChatGPTStatus } from '../shared/chatgpt.js';

export interface ChatGPTAuthOptions extends Pick<ChatGPTPlanAuthOptions, 'assertCanChange' | 'onChanged' | 'fetch' | 'now'> {
  directory: string;
  openExternal: (url: string) => Promise<void>;
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
  available: () => boolean;
}

function accountStorage(options: ChatGPTAuthOptions): OAuthSessionStorage {
  const file = join(options.directory, 'accounts.enc');
  return {
    available: options.available,
    async load() {
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (!options.available()) throw new Error('OS credential encryption is unavailable');
      return options.decrypt(bytes);
    },
    async save(snapshot) {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const temporary = join(options.directory, `accounts-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, options.encrypt(snapshot), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}

export class ChatGPTAuthService {
  private readonly auth: ChatGPTPlanAuth;

  constructor(options: ChatGPTAuthOptions) {
    this.auth = new ChatGPTPlanAuth({
      applicationName: 'Hosea', openBrowser: options.openExternal, storage: accountStorage(options),
      assertCanChange: options.assertCanChange, onChanged: options.onChanged, fetch: options.fetch, now: options.now,
    });
  }

  initialize(): Promise<void> { return this.auth.initialize(); }
  status(): ChatGPTStatus { return this.auth.status(); }
  get activeProfileId(): string | null { return this.auth.selectedAccountId; }
  get busy(): boolean { return this.auth.busy; }

  assertAPIKeyAccess(): void {
    const status = this.status();
    if (status.message) throw new Error(status.message);
    if (this.busy || status.usePlan) throw new Error('ChatGPT plan access is selected. Reconnect ChatGPT or explicitly choose API-key billing.');
  }

  async signIn(profileId?: string, requestConsent = false): Promise<ChatGPTStatus> {
    await this.auth.signIn({ accountId: profileId || undefined, requestConsent, select: true });
    return this.status();
  }

  cancel(): void { this.auth.cancel(); }

  async select(profileId: string): Promise<ChatGPTStatus> {
    await this.auth.selectAccount(profileId);
    return this.status();
  }

  async useAPIKeys(): Promise<ChatGPTStatus> {
    await this.auth.clearSelection();
    return this.status();
  }

  async signOut(profileId: string): Promise<{ status: ChatGPTStatus; warning?: string }> {
    const result = await this.auth.signOut(profileId);
    return { ...result, status: this.status() };
  }

  createConnector(name: string, profileId: string): void {
    this.auth.createConnector(name, profileId, { requireSelected: true });
  }

  accessToken(profileId: string): Promise<string> {
    return this.auth.getAccessToken(profileId, { requireSelected: true });
  }
}
