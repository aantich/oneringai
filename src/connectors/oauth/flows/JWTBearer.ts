/**
 * OAuth 2.0 JWT Bearer Flow (RFC 7523)
 * Service account authentication using private key signing
 */

import { SignJWT, importPKCS8 } from 'jose';
import * as fs from 'fs';
import { createPrivateKey } from 'crypto';
import { TokenStore } from '../domain/TokenStore.js';
import type { OAuthConfig } from '../types.js';

/**
 * Normalize any PEM-encoded private key to PKCS#8 (which is what jose's
 * importPKCS8 requires). GitHub Apps, `openssl genrsa`, and many other tools
 * emit PKCS#1 ("-----BEGIN RSA PRIVATE KEY-----"); we accept that, EC
 * ("-----BEGIN EC PRIVATE KEY-----"), and native PKCS#8 transparently.
 */
function normalizePrivateKeyPem(pem: string): string {
  const trimmed = pem.trim();
  if (trimmed.includes('-----BEGIN PRIVATE KEY-----')) return trimmed;
  const keyObject = createPrivateKey({ key: trimmed, format: 'pem' });
  const converted = keyObject.export({ format: 'pem', type: 'pkcs8' });
  return typeof converted === 'string' ? converted : converted.toString('utf8');
}

export class JWTBearerFlow {
  private tokenStore: TokenStore;
  private privateKey: string;

  constructor(private config: OAuthConfig) {
    const storageKey = config.storageKey || `jwt_bearer:${config.clientId}`;
    this.tokenStore = new TokenStore(storageKey, config.storage);

    // Load private key
    let raw: string;
    if (config.privateKey) {
      raw = config.privateKey;
    } else if (config.privateKeyPath) {
      try {
        raw = fs.readFileSync(config.privateKeyPath, 'utf8');
      } catch (error) {
        throw new Error(`Failed to read private key from ${config.privateKeyPath}: ${(error as Error).message}`);
      }
    } else {
      throw new Error('JWT Bearer flow requires privateKey or privateKeyPath');
    }

    // Accept PKCS#1 / EC / PKCS#8 PEMs transparently — jose only understands
    // PKCS#8. See normalizePrivateKeyPem above.
    try {
      this.privateKey = normalizePrivateKeyPem(raw);
    } catch (error) {
      throw new Error(
        `Invalid JWT Bearer private key: ${(error as Error).message}. ` +
          `Supply a PEM-encoded PKCS#1, PKCS#8, or EC private key.`
      );
    }
  }

  /**
   * Generate signed JWT assertion
   */
  private async generateJWT(): Promise<string> {
    // Back-date `iat` by 60s to tolerate clock skew with the token endpoint
    // (GitHub recommends this explicitly for GitHub Apps).
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = nowSec - 60;
    const alg = this.config.tokenSigningAlg || 'RS256';
    // Default 1 hour; GitHub caps at 10 min, template overrides to 540.
    const lifetime = this.config.tokenLifetimeSeconds ?? 3600;

    // Parse private key
    const key = await importPKCS8(this.privateKey, alg);

    // Build JWT payload. For RFC 7523, `sub` is conventional; for GitHub App
    // auth it is not needed (only `iss` + `iat` + `exp`) but harmless.
    const builder = new SignJWT({})
      .setProtectedHeader({ alg })
      .setIssuer(this.config.clientId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + lifetime);
    // GitHub App installation tokens reject JWTs with `aud`, `sub`, or `scope`.
    // Only include those for RFC 7523 flows.
    if ((this.config.tokenRequestStyle ?? 'form') !== 'bearer') {
      builder
        .setSubject(this.config.clientId)
        .setAudience(this.config.audience || this.config.tokenUrl);
      if (this.config.scope) {
        // replay scope via payload (jose doesn't expose a setter for arbitrary claims on SignJWT directly)
      }
    }
    const jwt = await builder.sign(key);

    return jwt;
  }

  /**
   * Get token using JWT Bearer assertion
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async getToken(userId?: string, accountId?: string): Promise<string> {
    // Return cached token if valid
    if (await this.tokenStore.isValid(this.config.refreshBeforeExpiry, userId, accountId)) {
      return this.tokenStore.getAccessToken(userId, accountId);
    }

    // Request new token
    return this.requestToken(userId, accountId);
  }

  /**
   * Request token using JWT assertion.
   *
   * Supports two delivery styles (controlled by `config.tokenRequestStyle`):
   * - `'form'` (default, RFC 7523) — form-urlencoded body with grant_type + assertion
   * - `'bearer'` (GitHub App installation tokens) — Authorization: Bearer <JWT> header
   *   on an empty POST; response uses `token` + `expires_at` instead of
   *   `access_token` + `expires_in`.
   */
  private async requestToken(userId?: string, accountId?: string): Promise<string> {
    const assertion = await this.generateJWT();
    const style = this.config.tokenRequestStyle ?? 'form';

    let response: Response;
    if (style === 'bearer') {
      response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${assertion}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } else {
      const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      });
      response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `JWT Bearer token request failed: ${response.status} ${response.statusText} - ${error}`
      );
    }

    const data: any = await response.json();

    // Normalize GitHub-style responses (`token` + `expires_at`) to the standard
    // OAuth shape (`access_token` + `expires_in`) so downstream code and the
    // TokenStore see a consistent schema.
    if (style === 'bearer') {
      const token: string = data.token ?? data.access_token;
      const expiresIn: number =
        typeof data.expires_in === 'number'
          ? data.expires_in
          : data.expires_at
          ? Math.max(
              60,
              Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000)
            )
          : 3600;
      const normalized = { ...data, access_token: token, expires_in: expiresIn };
      await this.tokenStore.storeToken(normalized, userId, accountId);
      return token;
    }

    await this.tokenStore.storeToken(data, userId, accountId);
    return data.access_token;
  }

  /**
   * Refresh token (generate new JWT and request new token)
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async refreshToken(userId?: string, accountId?: string): Promise<string> {
    await this.tokenStore.clear(userId, accountId);
    return this.requestToken(userId, accountId);
  }

  /**
   * Check if token is valid
   * @param userId - User identifier for multi-user support (optional)
   * @param accountId - Account alias for multi-account support (optional)
   */
  async isTokenValid(userId?: string, accountId?: string): Promise<boolean> {
    return this.tokenStore.isValid(this.config.refreshBeforeExpiry, userId, accountId);
  }
}
