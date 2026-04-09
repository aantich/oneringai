/**
 * OAuth plugin type definitions
 */

import type { ITokenStorage } from './domain/ITokenStorage.js';

export type OAuthFlow = 'authorization_code' | 'client_credentials' | 'jwt_bearer' | 'static_token';

export interface OAuthConfig {
  // Core config
  flow: OAuthFlow;
  tokenUrl: string;
  clientId: string;

  // Authorization Code specific
  authorizationUrl?: string;
  redirectUri?: string;
  scope?: string;
  usePKCE?: boolean; // Default: true

  // Client Credentials specific
  clientSecret?: string;

  // JWT Bearer specific
  privateKey?: string; // PEM format
  privateKeyPath?: string; // Or path to file
  tokenSigningAlg?: string; // Default: RS256
  audience?: string;

  // Static Token specific (NEW)
  staticToken?: string; // Static API key/token (for OpenAI, Anthropic, etc.)

  // Vendor-specific authorization parameters
  /** Extra query parameters appended to the authorization URL.
   *  Used for vendor-specific requirements, e.g. Google's `access_type: 'offline'`
   *  to obtain a refresh token. */
  authorizationParams?: Record<string, string>;

  // Token management
  autoRefresh?: boolean; // Default: true
  refreshBeforeExpiry?: number; // Seconds before expiry to refresh (default: 300)

  // Storage (optional - defaults to MemoryStorage)
  storage?: ITokenStorage;
  storageKey?: string; // Key for storing this token (default: based on clientId)
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  obtained_at: number;
}
