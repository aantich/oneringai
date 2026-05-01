/**
 * OAuth 2.0 Client Credentials Flow
 * Machine-to-machine authentication
 */

import { TokenStore } from '../domain/TokenStore.js';
import type { OAuthConfig } from '../types.js';

export class ClientCredentialsFlow {
  private tokenStore: TokenStore;

  constructor(private config: OAuthConfig) {
    const storageKey = config.storageKey || `client_credentials:${config.clientId}`;
    this.tokenStore = new TokenStore(storageKey, config.storage);
  }

  /**
   * Get token using client credentials.
   *
   * `userId` / `accountId` are accepted for API compatibility with the
   * generic OAuthManager surface (callers like `Connector.fetch` route them
   * through unconditionally), but they are deliberately ignored for token
   * storage: client_credentials is application-level auth — there is exactly
   * ONE token per app regardless of which user is calling. Partitioning the
   * token cache per user wastes storage and produces invalid 3-part
   * `flow:clientId:userId` storage keys that strict host token-storage
   * implementations (e.g. v25 MongoTokenStorage) reject. The caller's
   * `userId` is still meaningful at the API-URL level (e.g. `/users/{id}/...`
   * Microsoft Graph routes) — that mapping happens at the tool layer, not
   * here.
   */
  async getToken(_userId?: string, _accountId?: string): Promise<string> {
    if (await this.tokenStore.isValid(this.config.refreshBeforeExpiry)) {
      return this.tokenStore.getAccessToken();
    }
    return this.requestToken();
  }

  /**
   * Request a new token from the authorization server.
   */
  private async requestToken(): Promise<string> {
    // Create Basic Auth header
    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
    });

    // Add scope if provided
    if (this.config.scope) {
      params.append('scope', this.config.scope);
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${response.status} ${response.statusText} - ${error}`);
    }

    const data: any = await response.json();

    // Store token (encrypted) under the singleton app-level key. See getToken
    // doc above for why userId/accountId are ignored.
    await this.tokenStore.storeToken(data);

    return data.access_token;
  }

  /**
   * Refresh token (client credentials don't use refresh tokens — just request
   * a new one). userId/accountId ignored — see getToken.
   */
  async refreshToken(_userId?: string, _accountId?: string): Promise<string> {
    await this.tokenStore.clear();
    return this.requestToken();
  }

  /**
   * Check if token is valid. userId/accountId ignored — see getToken.
   */
  async isTokenValid(_userId?: string, _accountId?: string): Promise<boolean> {
    return this.tokenStore.isValid(this.config.refreshBeforeExpiry);
  }
}
