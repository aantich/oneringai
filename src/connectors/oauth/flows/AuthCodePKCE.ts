/**
 * OAuth 2.0 Authorization Code Flow with PKCE (RFC 7636)
 * User authentication for web and mobile apps
 */

import { TokenStore } from '../domain/TokenStore.js';
import { generatePKCE, generateState } from '../utils/pkce.js';
import type { OAuthConfig } from '../types.js';

export class AuthCodePKCEFlow {
  private tokenStore: TokenStore;
  // Store PKCE data per user+account with timestamps for cleanup
  private codeVerifiers: Map<string, { verifier: string; timestamp: number }> = new Map();
  private states: Map<string, { state: string; timestamp: number }> = new Map();
  // Store refresh locks per user+account to prevent concurrent refresh
  private refreshLocks: Map<string, Promise<string>> = new Map();
  // PKCE data TTL: 15 minutes (auth flows should complete within this time)
  private readonly PKCE_TTL = 15 * 60 * 1000;

  constructor(private config: OAuthConfig) {
    const storageKey = config.storageKey || `auth_code:${config.clientId}`;
    this.tokenStore = new TokenStore(storageKey, config.storage);
  }

  /**
   * Build a map key from userId and accountId for internal PKCE/state/lock maps.
   */
  private getMapKey(userId?: string, accountId?: string): string {
    const userPart = userId || 'default';
    return accountId ? `${userPart}:${accountId}` : userPart;
  }

  /**
   * Generate authorization URL for user to visit
   * Opens browser or redirects user to this URL
   *
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async getAuthorizationUrl(userId?: string, accountId?: string): Promise<string> {
    if (!this.config.authorizationUrl) {
      throw new Error('authorizationUrl is required for authorization_code flow');
    }

    if (!this.config.redirectUri) {
      throw new Error('redirectUri is required for authorization_code flow');
    }

    // Clean up expired PKCE data before creating new flow
    this.cleanupExpiredPKCE();

    const mapKey = this.getMapKey(userId, accountId);

    // Generate PKCE pair
    const { codeVerifier, codeChallenge } = generatePKCE();
    this.codeVerifiers.set(mapKey, { verifier: codeVerifier, timestamp: Date.now() });

    // Generate state for CSRF protection
    const state = generateState();
    this.states.set(mapKey, { state, timestamp: Date.now() });

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
    });

    // Add scope if provided
    if (this.config.scope) {
      params.append('scope', this.config.scope);
    }

    // Add PKCE parameters (if enabled, default true)
    if (this.config.usePKCE !== false) {
      params.append('code_challenge', codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    // Add vendor-specific authorization parameters (e.g. Google's access_type=offline)
    if (this.config.authorizationParams) {
      for (const [key, value] of Object.entries(this.config.authorizationParams)) {
        params.set(key, value);
      }
    }

    // Encode userId and accountId in state for retrieval in callback
    // Format: `{random_state}[::userId[::accountId]]`
    let stateWithMetadata = state;
    if (userId || accountId) {
      stateWithMetadata = `${state}::${userId || ''}`;
      if (accountId) {
        stateWithMetadata += `::${accountId}`;
      }
    }
    params.set('state', stateWithMetadata);

    return `${this.config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   *
   * @param code - Authorization code from callback
   * @param state - State parameter from callback (for CSRF verification, may include userId/accountId)
   * @param userId - User identifier (optional, can be extracted from state)
   * @param accountId - Account alias (optional, can be extracted from state)
   */
  async exchangeCode(code: string, state: string, userId?: string, accountId?: string): Promise<void> {
    // Extract userId and accountId from state if embedded
    let actualState = state;
    let actualUserId = userId;
    let actualAccountId = accountId;

    if (state.includes('::')) {
      const parts = state.split('::');
      actualState = parts[0]!;
      if (!actualUserId && parts[1]) {
        actualUserId = parts[1];
      }
      if (!actualAccountId && parts[2]) {
        actualAccountId = parts[2];
      }
    }

    const mapKey = this.getMapKey(actualUserId, actualAccountId);

    // Verify state to prevent CSRF attacks
    const stateData = this.states.get(mapKey);
    if (!stateData) {
      const label = actualAccountId
        ? `user ${actualUserId}, account ${actualAccountId}`
        : `user ${actualUserId}`;
      throw new Error(`No PKCE state found for ${label}. Authorization flow may have expired (15 min TTL).`);
    }

    const expectedState = stateData.state;
    if (actualState !== expectedState) {
      const label = actualAccountId
        ? `user ${actualUserId}, account ${actualAccountId}`
        : `user ${actualUserId}`;
      throw new Error(`State mismatch for ${label} - possible CSRF attack. Expected: ${expectedState}, Got: ${actualState}`);
    }

    if (!this.config.redirectUri) {
      throw new Error('redirectUri is required');
    }

    // Build token request
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
    });

    // Add client secret if provided (confidential clients)
    console.log(`[OAuth:exchangeCode] clientId=${this.config.clientId?.substring(0, 8)}... hasSecret=${!!this.config.clientSecret} secretLen=${this.config.clientSecret?.length ?? 0} tokenUrl=${this.config.tokenUrl} redirectUri=${this.config.redirectUri}`);
    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    } else {
      console.warn('[OAuth:exchangeCode] WARNING: No client_secret available — token exchange may fail for confidential clients');
    }

    // Add code_verifier if PKCE was used
    const verifierData = this.codeVerifiers.get(mapKey);
    if (this.config.usePKCE !== false && verifierData) {
      params.append('code_verifier', verifierData.verifier);
    }

    let response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    // If the provider rejects client_secret (public client), retry without it
    if (!response.ok && this.config.clientSecret) {
      const errorText = await response.text();
      if (isPublicClientError(errorText)) {
        params.delete('client_secret');
        response = await fetch(this.config.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params,
        });
        if (!response.ok) {
          const retryError = await response.text();
          throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${retryError}`);
        }
      } else {
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } else if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${error}`);
    }

    const data: any = await response.json();

    // Store token (encrypted) with user and account scoping
    await this.tokenStore.storeToken(data, actualUserId, actualAccountId);

    // Clear PKCE data (one-time use)
    this.codeVerifiers.delete(mapKey);
    this.states.delete(mapKey);
  }

  /**
   * Get valid token (auto-refreshes if needed)
   * @param userId - User identifier for multi-user support
   * @param accountId - Account alias for multi-account support
   */
  async getToken(userId?: string, accountId?: string): Promise<string> {
    const mapKey = this.getMapKey(userId, accountId);

    // If already refreshing for this user+account, wait for the existing refresh
    if (this.refreshLocks.has(mapKey)) {
      return this.refreshLocks.get(mapKey)!;
    }

    // Return cached token if valid
    if (await this.tokenStore.isValid(this.config.refreshBeforeExpiry, userId, accountId)) {
      return this.tokenStore.getAccessToken(userId, accountId);
    }

    // Try to refresh if we have a refresh token
    if (await this.tokenStore.hasRefreshToken(userId, accountId)) {
      // Start refresh and lock it
      const refreshPromise = this.refreshToken(userId, accountId);
      this.refreshLocks.set(mapKey, refreshPromise);

      try {
        return await refreshPromise;
      } finally {
        // Always clean up lock, even on error
        this.refreshLocks.delete(mapKey);
      }
    }

    // No valid token and can't refresh
    const userLabel = userId ? `user: ${userId}` : 'default user';
    const accountLabel = accountId ? `, account: ${accountId}` : '';
    throw new Error(`No valid token available for ${userLabel}${accountLabel}. User needs to authorize (call startAuthFlow).`);
  }

  /**
   * Refresh access token using refresh token
   * @param userId - User identifier for multi-user support
   * @param accountId - Account alias for multi-account support
   */
  async refreshToken(userId?: string, accountId?: string): Promise<string> {
    const refreshToken = await this.tokenStore.getRefreshToken(userId, accountId);

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    // Add client secret if provided
    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    let response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    // If the provider rejects client_secret (public client), retry without it
    if (!response.ok && this.config.clientSecret) {
      const errorText = await response.text();
      if (isPublicClientError(errorText)) {
        params.delete('client_secret');
        response = await fetch(this.config.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params,
        });
        if (!response.ok) {
          const retryError = await response.text();
          throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${retryError}`);
        }
      } else {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } else if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${error}`);
    }

    const data: any = await response.json();

    // Store new token with user and account scoping
    await this.tokenStore.storeToken(data, userId, accountId);

    return data.access_token;
  }

  /**
   * Check if token is valid
   * @param userId - User identifier for multi-user support
   * @param accountId - Account alias for multi-account support
   */
  async isTokenValid(userId?: string, accountId?: string): Promise<boolean> {
    return this.tokenStore.isValid(this.config.refreshBeforeExpiry, userId, accountId);
  }

  /**
   * Revoke token (if supported by provider)
   * @param revocationUrl - Optional revocation endpoint
   * @param userId - User identifier for multi-user support
   * @param accountId - Account alias for multi-account support
   */
  async revokeToken(revocationUrl?: string, userId?: string, accountId?: string): Promise<void> {
    if (!revocationUrl) {
      // Just clear from storage
      await this.tokenStore.clear(userId, accountId);
      return;
    }

    try {
      const token = await this.tokenStore.getAccessToken(userId, accountId);

      await fetch(revocationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token,
          client_id: this.config.clientId,
        }),
      });
    } finally {
      // Always clear from storage
      await this.tokenStore.clear(userId, accountId);
    }
  }

  /**
   * List account aliases for a user.
   * @param userId - User identifier (optional)
   */
  async listAccounts(userId?: string): Promise<string[]> {
    return this.tokenStore.listAccounts(userId);
  }

  /**
   * Clean up expired PKCE data to prevent memory leaks
   * Removes verifiers and states older than PKCE_TTL (15 minutes)
   */
  private cleanupExpiredPKCE(): void {
    const now = Date.now();

    // Clean up expired code verifiers
    for (const [key, data] of this.codeVerifiers) {
      if (now - data.timestamp > this.PKCE_TTL) {
        this.codeVerifiers.delete(key);
        this.states.delete(key);
      }
    }
  }
}

/**
 * Detect OAuth errors indicating the app is a public client that must not
 * present a client_secret. Covers:
 * - Microsoft/Entra ID: AADSTS700025
 * - Generic OAuth servers that return "invalid_client" with a hint about public clients
 */
function isPublicClientError(responseBody: string): boolean {
  const lower = responseBody.toLowerCase();
  return (
    lower.includes('aadsts700025') ||
    (lower.includes('invalid_client') && lower.includes('public'))
  );
}
