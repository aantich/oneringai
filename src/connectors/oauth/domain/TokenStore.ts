/**
 * Token Store (Domain Layer)
 * Manages token lifecycle using pluggable storage backend
 */

import { ITokenStorage, StoredToken } from './ITokenStorage.js';
import { MemoryStorage } from '../infrastructure/storage/MemoryStorage.js';

export class TokenStore {
  private storage: ITokenStorage;
  private baseStorageKey: string;

  constructor(storageKey: string = 'default', storage?: ITokenStorage) {
    this.baseStorageKey = storageKey;
    // Default to in-memory storage (encrypted)
    this.storage = storage || new MemoryStorage();
  }

  /**
   * Get user-scoped (and optionally account-scoped) storage key.
   *
   * Output is exactly two shapes:
   * - **2-part** `baseKey` — system / app-level (no userId, no accountId).
   * - **4-part** `baseKey:userId:accountId` — user-scoped, with `'default'`
   *   substituted for whichever component the caller omitted.
   *
   * The previous 3-part `baseKey:userId` shape (userId without accountId) is
   * deliberately gone. Strict host storage adapters (e.g. v25
   * MongoTokenStorage) reject 3-part keys because the contract is "system
   * tokens are 2-part, user tokens always carry an accountId" — a 3-part key
   * is ambiguous between the two. Defaulting accountId to `'default'`
   * collapses the bug class without losing any information: callers that
   * pass only userId continue to see exactly one token per user, just under
   * the explicit 4-part key now.
   *
   * @param userId - User identifier (optional, defaults to single-user mode)
   * @param accountId - Account alias for multi-account support (optional)
   * @returns Storage key — always 2 parts (system) or 4 parts (user)
   */
  private getScopedKey(userId?: string, accountId?: string): string {
    const hasUser = !!(userId && userId !== 'default');
    const hasAccount = !!accountId;
    if (!hasUser && !hasAccount) {
      // Single-user / system mode (backward compatible).
      return this.baseStorageKey;
    }
    const userPart = hasUser ? userId! : 'default';
    const accountPart = hasAccount ? accountId! : 'default';
    return `${this.baseStorageKey}:${userPart}:${accountPart}`;
  }

  /**
   * Store token (encrypted by storage layer)
   * @param tokenResponse - Token response from OAuth provider
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async storeToken(tokenResponse: any, userId?: string, accountId?: string): Promise<void> {
    // Validate required fields
    if (!tokenResponse.access_token) {
      throw new Error('OAuth response missing required access_token field');
    }

    if (typeof tokenResponse.access_token !== 'string') {
      throw new Error('access_token must be a string');
    }

    if (tokenResponse.expires_in !== undefined && tokenResponse.expires_in < 0) {
      throw new Error('expires_in must be positive');
    }

    const token: StoredToken = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_in: tokenResponse.expires_in || 3600,
      token_type: tokenResponse.token_type || 'Bearer',
      scope: tokenResponse.scope,
      obtained_at: Date.now(),
    };

    const key = this.getScopedKey(userId, accountId);
    await this.storage.storeToken(key, token);
  }

  /**
   * Get access token
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async getAccessToken(userId?: string, accountId?: string): Promise<string> {
    const key = this.getScopedKey(userId, accountId);
    const token = await this.storage.getToken(key);
    if (!token) {
      const userLabel = userId ? `user: ${userId}` : 'default user';
      const accountLabel = accountId ? `, account: ${accountId}` : '';
      throw new Error(`No token stored for ${userLabel}${accountLabel}`);
    }
    return token.access_token;
  }

  /**
   * Get refresh token
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async getRefreshToken(userId?: string, accountId?: string): Promise<string> {
    const key = this.getScopedKey(userId, accountId);
    const token = await this.storage.getToken(key);
    if (!token?.refresh_token) {
      const userLabel = userId ? `user: ${userId}` : 'default user';
      const accountLabel = accountId ? `, account: ${accountId}` : '';
      throw new Error(`No refresh token available for ${userLabel}${accountLabel}`);
    }
    return token.refresh_token;
  }

  /**
   * Check if has refresh token
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async hasRefreshToken(userId?: string, accountId?: string): Promise<boolean> {
    const key = this.getScopedKey(userId, accountId);
    const token = await this.storage.getToken(key);
    return !!token?.refresh_token;
  }

  /**
   * Check if token is valid (not expired)
   *
   * @param bufferSeconds - Refresh this many seconds before expiry (default: 300 = 5 min)
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async isValid(bufferSeconds: number = 300, userId?: string, accountId?: string): Promise<boolean> {
    const key = this.getScopedKey(userId, accountId);
    const token = await this.storage.getToken(key);
    if (!token) {
      return false;
    }

    const expiresAt = token.obtained_at + token.expires_in * 1000;
    const bufferMs = bufferSeconds * 1000;

    return Date.now() < expiresAt - bufferMs;
  }

  /**
   * Clear stored token
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async clear(userId?: string, accountId?: string): Promise<void> {
    const key = this.getScopedKey(userId, accountId);
    await this.storage.deleteToken(key);
  }

  /**
   * Get full token info
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async getTokenInfo(userId?: string, accountId?: string): Promise<StoredToken | null> {
    const key = this.getScopedKey(userId, accountId);
    return this.storage.getToken(key);
  }

  /**
   * Re-key a token from one accountId to another.
   * Used to stabilize account IDs — e.g., replacing a temporary random ID
   * with the actual email address discovered after OAuth completes.
   *
   * If oldAccountId === newAccountId, this is a no-op.
   * If a token already exists under newAccountId, it is replaced.
   *
   * @param userId - User identifier
   * @param oldAccountId - Current account alias (e.g., temporary random ID)
   * @param newAccountId - New account alias (e.g., discovered email address)
   * @returns true if the token was re-keyed, false if no token found under oldAccountId
   */
  async rekeyAccount(userId: string, oldAccountId: string, newAccountId: string): Promise<boolean> {
    if (oldAccountId === newAccountId) return true;

    // Read token under old key
    const oldKey = this.getScopedKey(userId, oldAccountId);
    const token = await this.storage.getToken(oldKey);
    if (!token) return false;

    // Remove any stale token under the new key (from a prior auth of the same account)
    const newKey = this.getScopedKey(userId, newAccountId);
    await this.storage.deleteToken(newKey);

    // Store under the new key
    await this.storage.storeToken(newKey, token);

    // Remove the old key
    await this.storage.deleteToken(oldKey);

    return true;
  }

  /**
   * Remove a specific account's stored token.
   * Used when a user unlinks/disconnects one of their accounts.
   *
   * @param userId - User identifier
   * @param accountId - Account alias to remove
   * @returns true if a token was deleted, false if no token existed
   */
  async removeAccount(userId: string, accountId: string): Promise<boolean> {
    if (!userId || !accountId) {
      throw new Error('removeAccount requires non-empty userId and accountId');
    }
    const key = this.getScopedKey(userId, accountId);
    const existing = await this.storage.getToken(key);
    if (!existing) return false;
    await this.storage.deleteToken(key);
    return true;
  }

  /**
   * List account aliases for a user on this connector.
   * Returns account IDs that have stored tokens.
   *
   * @param userId - Optional user identifier
   * @returns Array of account aliases (e.g., ['work', 'personal'])
   */
  async listAccounts(userId?: string): Promise<string[]> {
    if (!this.storage.listKeys) {
      return [];
    }

    const allKeys = await this.storage.listKeys();
    const userPart = userId && userId !== 'default' ? userId : 'default';
    const prefix = `${this.baseStorageKey}:${userPart}:`;

    const accounts: string[] = [];
    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        const accountId = key.slice(prefix.length);
        // Only include if it's a direct account (no further colons)
        if (accountId && !accountId.includes(':')) {
          accounts.push(accountId);
        }
      }
    }

    return accounts;
  }
}
