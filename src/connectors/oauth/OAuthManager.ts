/**
 * OAuth Manager - Main entry point for OAuth 2.0 authentication
 * Supports multiple flows: Authorization Code (with PKCE), Client Credentials, JWT Bearer, Static Token
 */

import { AuthCodePKCEFlow } from './flows/AuthCodePKCE.js';
import { ClientCredentialsFlow } from './flows/ClientCredentials.js';
import { JWTBearerFlow } from './flows/JWTBearer.js';
import { StaticTokenFlow } from './flows/StaticToken.js';
import { FileStorage } from './infrastructure/storage/FileStorage.js';
import type { OAuthConfig, OAuthCallbackResult } from './types.js';

export class OAuthManager {
  private flow: AuthCodePKCEFlow | ClientCredentialsFlow | JWTBearerFlow | StaticTokenFlow;

  constructor(config: OAuthConfig) {
    // Validate configuration
    this.validateConfig(config);

    // Create appropriate flow implementation
    switch (config.flow) {
      case 'authorization_code':
        this.flow = new AuthCodePKCEFlow(config);
        break;

      case 'client_credentials':
        this.flow = new ClientCredentialsFlow(config);
        break;

      case 'jwt_bearer':
        this.flow = new JWTBearerFlow(config);
        break;

      case 'static_token':
        this.flow = new StaticTokenFlow(config);
        break;

      default:
        throw new Error(`Unknown OAuth flow: ${(config as any).flow}`);
    }
  }

  /**
   * Get valid access token
   * Automatically refreshes if expired
   *
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async getToken(userId?: string, accountId?: string): Promise<string> {
    return this.flow.getToken(userId, accountId);
  }

  /**
   * Force refresh the token
   *
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async refreshToken(userId?: string, accountId?: string): Promise<string> {
    return this.flow.refreshToken(userId, accountId);
  }

  /**
   * Check if current token is valid
   *
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async isTokenValid(userId?: string, accountId?: string): Promise<boolean> {
    return this.flow.isTokenValid(userId, accountId);
  }

  // ==================== Authorization Code Flow Methods ====================

  /**
   * Start authorization flow (Authorization Code only)
   * Returns URL for user to visit
   *
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   * @returns Authorization URL for the user to visit
   */
  async startAuthFlow(userId?: string, accountId?: string): Promise<string> {
    if (!(this.flow instanceof AuthCodePKCEFlow)) {
      throw new Error('startAuthFlow() is only available for authorization_code flow');
    }

    return this.flow.getAuthorizationUrl(userId, accountId);
  }

  /**
   * Handle OAuth callback (Authorization Code only)
   * Call this with the callback URL after user authorizes
   *
   * Returns an optional raw ID token for caller-side OIDC verification. The ID
   * token is not verified or persisted by the library; non-OIDC flows return {}.
   *
   * @param callbackUrl - Full callback URL with code and state parameters
   * @param userId - Optional user identifier (can be extracted from state if embedded)
   * @param accountId - Optional account alias (can be extracted from state if embedded)
   */
  async handleCallback(callbackUrl: string, userId?: string, accountId?: string): Promise<OAuthCallbackResult> {
    if (!(this.flow instanceof AuthCodePKCEFlow)) {
      throw new Error('handleCallback() is only available for authorization_code flow');
    }

    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      throw new Error('Missing authorization code in callback URL');
    }

    if (!state) {
      throw new Error('Missing state parameter in callback URL');
    }

    return this.flow.exchangeCode(code, state, userId, accountId);
  }

  /**
   * Revoke token (if supported by provider)
   *
   * @param revocationUrl - Optional revocation endpoint URL
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async revokeToken(revocationUrl?: string, userId?: string, accountId?: string): Promise<void> {
    if (this.flow instanceof AuthCodePKCEFlow) {
      await this.flow.revokeToken(revocationUrl, userId, accountId);
    } else {
      throw new Error('Token revocation not implemented for this flow');
    }
  }

  /**
   * List account aliases for a user (Authorization Code only)
   *
   * @param userId - User identifier (optional)
   * @returns Array of account aliases (e.g., ['work', 'personal'])
   */
  async listAccounts(userId?: string): Promise<string[]> {
    if (this.flow instanceof AuthCodePKCEFlow) {
      return this.flow.listAccounts(userId);
    }
    return [];
  }

  /**
   * Re-key a token from one accountId to another (Authorization Code only).
   *
   * @param userId - User identifier
   * @param oldAccountId - Current account alias
   * @param newAccountId - New account alias
   * @returns true if re-keyed, false if no token found under oldAccountId
   */
  async rekeyAccount(userId: string, oldAccountId: string, newAccountId: string): Promise<boolean> {
    if (!(this.flow instanceof AuthCodePKCEFlow)) {
      throw new Error('rekeyAccount() is only available for authorization_code flow');
    }
    return this.flow.rekeyAccount(userId, oldAccountId, newAccountId);
  }

  /**
   * Remove a specific account's stored token (Authorization Code only).
   * Used when a user unlinks/disconnects one of their accounts.
   *
   * @param userId - User identifier
   * @param accountId - Account alias to remove
   * @returns true if a token was deleted, false if no token existed
   */
  async removeAccount(userId: string, accountId: string): Promise<boolean> {
    if (!(this.flow instanceof AuthCodePKCEFlow)) {
      throw new Error('removeAccount() is only available for authorization_code flow');
    }
    return this.flow.removeAccount(userId, accountId);
  }

  // ==================== Validation ====================

  private validateConfig(config: OAuthConfig): void {
    // Required fields
    if (!config.flow) {
      throw new Error('OAuth flow is required (authorization_code, client_credentials, jwt_bearer, or static_token)');
    }

    // tokenUrl and clientId not required for static_token
    if (config.flow !== 'static_token') {
      if (!config.tokenUrl) {
        throw new Error('tokenUrl is required');
      }

      if (!config.clientId) {
        throw new Error('clientId is required');
      }
    }

    // Flow-specific validation
    switch (config.flow) {
      case 'authorization_code':
        if (!config.authorizationUrl) {
          throw new Error('authorizationUrl is required for authorization_code flow');
        }
        if (!config.redirectUri) {
          throw new Error('redirectUri is required for authorization_code flow');
        }
        break;

      case 'client_credentials':
        if (!config.clientSecret) {
          throw new Error('clientSecret is required for client_credentials flow');
        }
        break;

      case 'jwt_bearer':
        if (!config.privateKey && !config.privateKeyPath) {
          throw new Error(
            'privateKey or privateKeyPath is required for jwt_bearer flow'
          );
        }
        break;

      case 'static_token':
        if (!config.staticToken) {
          throw new Error('staticToken is required for static_token flow');
        }
        break;
    }

    // Warn only if the built-in FileStorage is in play without an encryption
    // key. Custom ITokenStorage implementations (MongoDB, Redis, app-specific)
    // manage their own encryption and do not read OAUTH_ENCRYPTION_KEY —
    // warning them is a false alarm that obscures real problems.
    if (config.storage instanceof FileStorage && !process.env.OAUTH_ENCRYPTION_KEY) {
      console.warn(
        'WARNING: Using FileStorage without OAUTH_ENCRYPTION_KEY environment variable. ' +
          'Tokens will be encrypted with an auto-generated key that changes on restart, ' +
          'making previously persisted tokens undecryptable after a restart!'
      );
    }
  }
}
