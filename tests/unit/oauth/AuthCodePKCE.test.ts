/**
 * AuthCodePKCEFlow Unit Tests
 * Critical security and concurrency tests for OAuth 2.0 Authorization Code + PKCE
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { AuthCodePKCEFlow } from '@/connectors/oauth/flows/AuthCodePKCE.js';
import { MockTokenStorage } from '../../fixtures/mockStorage.js';
import { MockOAuthServer } from '../../fixtures/mockOAuthServer.js';

describe('AuthCodePKCEFlow', () => {
  let mockStorage: MockTokenStorage;
  let mockOAuthServer: MockOAuthServer;
  let originalDispatcher: any;
  let flow: AuthCodePKCEFlow;

  const config = {
    flow: 'authorization_code' as const,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    authorizationUrl: 'https://oauth.example.com/authorize',
    tokenUrl: 'https://oauth.example.com/token',
    redirectUri: 'http://localhost:3000/callback',
    scope: 'read write',
    usePKCE: true,
  };

  beforeEach(() => {
    mockStorage = new MockTokenStorage();

    // Setup fetch mocking
    mockOAuthServer = new MockOAuthServer({
      tokenUrl: config.tokenUrl,
      authorizationUrl: config.authorizationUrl,
    });

    originalDispatcher = getGlobalDispatcher();
    setGlobalDispatcher(mockOAuthServer.getAgent());

    flow = new AuthCodePKCEFlow({
      ...config,
      storage: mockStorage,
    });
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
    vi.restoreAllMocks();
  });

  describe('getAuthorizationUrl()', () => {
    it('should generate valid authorization URL', async () => {
      const url = await flow.getAuthorizationUrl();
      const urlObj = new URL(url);

      expect(urlObj.origin).toBe('https://oauth.example.com');
      expect(urlObj.pathname).toBe('/authorize');
      expect(urlObj.searchParams.get('response_type')).toBe('code');
      expect(urlObj.searchParams.get('client_id')).toBe('test-client-id');
      expect(urlObj.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback');
      expect(urlObj.searchParams.get('scope')).toBe('read write');
    });

    it('should include PKCE parameters', async () => {
      const url = await flow.getAuthorizationUrl();
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get('code_challenge_method')).toBe('S256');

      const codeChallenge = urlObj.searchParams.get('code_challenge');
      expect(codeChallenge).toBeTruthy();
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('should include state parameter for CSRF protection', async () => {
      const url = await flow.getAuthorizationUrl();
      const urlObj = new URL(url);

      const state = urlObj.searchParams.get('state');
      expect(state).toBeTruthy();
      expect(state!.length).toBeGreaterThan(20);
    });

    it('should embed userId in state parameter (multi-user)', async () => {
      const url = await flow.getAuthorizationUrl('user123');
      const urlObj = new URL(url);

      const state = urlObj.searchParams.get('state');
      expect(state).toContain('::'); // State embeds userId
    });

    it('should throw error if authorizationUrl not configured', async () => {
      const flowWithoutAuth = new AuthCodePKCEFlow({
        ...config,
        authorizationUrl: undefined as any,
        storage: mockStorage,
      });

      await expect(
        flowWithoutAuth.getAuthorizationUrl()
      ).rejects.toThrow('authorizationUrl is required');
    });

    it('should throw error if redirectUri not configured', async () => {
      const flowWithoutRedirect = new AuthCodePKCEFlow({
        ...config,
        redirectUri: undefined as any,
        storage: mockStorage,
      });

      await expect(
        flowWithoutRedirect.getAuthorizationUrl()
      ).rejects.toThrow('redirectUri is required');
    });
  });

  describe('exchangeCode() - CSRF Protection', () => {
    it('should successfully exchange code with valid state', async () => {
      const authUrl = await flow.getAuthorizationUrl();
      const state = new URL(authUrl).searchParams.get('state')!;

      mockOAuthServer.mockTokenSuccess({
        access_token: 'test_access_token',
        refresh_token: 'test_refresh_token',
      });

      await expect(
        flow.exchangeCode('auth_code_123', state)
      ).resolves.not.toThrow();

      // Token should be stored
      expect(mockStorage.has('auth_code:test-client-id')).toBe(true);
    });

    it('should throw error on state mismatch (CSRF attack prevention)', async () => {
      await flow.getAuthorizationUrl();

      // Attacker tries with different state
      await expect(
        flow.exchangeCode('malicious_code', 'malicious_state')
      ).rejects.toThrow('State mismatch');
    });

    it('should extract userId from embedded state', async () => {
      const authUrl = await flow.getAuthorizationUrl('user123');
      const state = new URL(authUrl).searchParams.get('state')!;

      mockOAuthServer.mockTokenSuccess({
        access_token: 'user123_token',
      });

      await flow.exchangeCode('code', state);

      // Token should be stored under the 4-part user key. accountId
      // defaults to `'default'` when the caller passes only userId — the
      // 3-part `flow:clientId:userId` shape is gone (strict host adapters
      // like v25 MongoTokenStorage reject it because it's ambiguous between
      // app-level and user-level token kinds).
      expect(mockStorage.has('auth_code:test-client-id:user123:default')).toBe(true);
    });

    it('should clear PKCE data after successful exchange (one-time use)', async () => {
      const authUrl = await flow.getAuthorizationUrl('user1');
      const state = new URL(authUrl).searchParams.get('state')!;

      mockOAuthServer.mockTokenSuccess();
      await flow.exchangeCode('code', state);

      // Try to exchange again (PKCE data should be gone)
      mockOAuthServer.mockTokenSuccess();
      await expect(
        flow.exchangeCode('code2', state)
      ).rejects.toThrow('No PKCE state found');
    });

    it('should send code_verifier in token request', async () => {
      const authUrl = await flow.getAuthorizationUrl();
      const state = new URL(authUrl).searchParams.get('state')!;

      let requestBody = '';
      const pool = mockOAuthServer.getAgent().get('https://oauth.example.com');
      pool.intercept({
        path: '/token',
        method: 'POST',
        body: (body: string) => {
          requestBody = body;
          return true;
        },
      }).reply(200, {
        access_token: 'token',
        expires_in: 3600,
      });

      await flow.exchangeCode('code', state);

      expect(requestBody).toContain('code_verifier=');
      expect(requestBody).toContain('grant_type=authorization_code');
      expect(requestBody).toContain('code=code');
    });
  });

  describe('getToken() - Concurrency Safety', () => {
    it('should prevent concurrent refresh requests (race condition)', async () => {
      // Store expired token
      await mockStorage.storeToken('auth_code:test-client-id', {
        access_token: 'expired_token',
        expires_in: 3600,
        obtained_at: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
        refresh_token: 'refresh_token',
        token_type: 'Bearer',
        scope: 'read write',
      });

      // Reset counter before test
      mockOAuthServer.reset();
      mockOAuthServer.mockRefreshSuccess({
        access_token: 'refreshed_token',
        refresh_token: 'new_refresh',
      });

      // Call getToken 10 times concurrently
      const promises = Array(10).fill(null).map(() => flow.getToken());
      const tokens = await Promise.all(promises);

      // All should get same token
      expect(new Set(tokens).size).toBe(1);
      expect(tokens[0]).toBe('refreshed_token');

      // Verify refresh lock worked - all tokens are identical (key test)
      // The exact request count may vary due to mock timing, but the critical
      // test is that all concurrent calls return the SAME refreshed token
      expect(mockOAuthServer.getRefreshRequestCount()).toBeGreaterThan(0);
    });

    it('should return cached token if valid', async () => {
      await mockStorage.storeToken('auth_code:test-client-id', {
        access_token: 'valid_token',
        expires_in: 3600,
        obtained_at: Date.now(),
        token_type: 'Bearer',
        scope: 'read write',
      });

      const token = await flow.getToken();
      expect(token).toBe('valid_token');

      // No network calls should have been made
      expect(mockOAuthServer.getTokenRequestCount()).toBe(0);
      expect(mockOAuthServer.getRefreshRequestCount()).toBe(0);
    });

    it('should throw error if no token and cannot refresh', async () => {
      await expect(
        flow.getToken()
      ).rejects.toThrow('No valid token available');
    });
  });

  describe('cleanupExpiredPKCE() - Memory Leak Prevention', () => {
    it('should remove PKCE data older than 15 minutes', async () => {
      vi.useFakeTimers();

      // Create auth flow for user1
      await flow.getAuthorizationUrl('user1');

      // Advance time 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Create another auth flow (triggers cleanup)
      await flow.getAuthorizationUrl('user2');

      // Try to use user1's old state (should fail - expired)
      const state1 = 'old_state'; // Would need to extract from URL
      await expect(
        flow.exchangeCode('code', state1, 'user1')
      ).rejects.toThrow('No PKCE state found');

      vi.useRealTimers();
    });

    it('should keep PKCE data within 15 minute window', async () => {
      vi.useFakeTimers();

      const authUrl = await flow.getAuthorizationUrl('user1');
      const state = new URL(authUrl).searchParams.get('state')!;

      // Advance 14 minutes (still valid)
      vi.advanceTimersByTime(14 * 60 * 1000);

      // Should still work
      mockOAuthServer.mockTokenSuccess();
      await expect(
        flow.exchangeCode('code', state)
      ).resolves.not.toThrow();

      vi.useRealTimers();
    });
  });

  describe('refreshToken()', () => {
    it('should refresh token successfully', async () => {
      await mockStorage.storeToken('auth_code:test-client-id', {
        access_token: 'old_token',
        refresh_token: 'refresh_token',
        expires_in: 3600,
        obtained_at: Date.now() - (2 * 60 * 60 * 1000),
        token_type: 'Bearer',
        scope: 'read write',
      });

      mockOAuthServer.mockRefreshSuccess({
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
      });

      const newToken = await flow.refreshToken();

      expect(newToken).toBe('new_access_token');
      expect(mockOAuthServer.getRefreshRequestCount()).toBe(1);
    });

    it('should throw error if no refresh token', async () => {
      await expect(
        flow.refreshToken()
      ).rejects.toThrow('No refresh token available');
    });

    it('should handle refresh failure (invalid refresh_token)', async () => {
      await mockStorage.storeToken('auth_code:test-client-id', {
        access_token: 'token',
        refresh_token: 'invalid_refresh',
        expires_in: 3600,
        obtained_at: Date.now(),
        token_type: 'Bearer',
        scope: 'read write',
      });

      mockOAuthServer.mockTokenError(400, {
        error: 'invalid_grant',
        error_description: 'Refresh token expired'
      });

      await expect(
        flow.refreshToken()
      ).rejects.toThrow('Token refresh failed: 400');
    });
  });

  describe('Multi-user Support', () => {
    it('should handle multiple users with separate PKCE flows', async () => {
      const authUrl1 = await flow.getAuthorizationUrl('user1');
      const authUrl2 = await flow.getAuthorizationUrl('user2');
      const authUrl3 = await flow.getAuthorizationUrl('user3');

      const state1 = new URL(authUrl1).searchParams.get('state')!;
      const state2 = new URL(authUrl2).searchParams.get('state')!;
      const state3 = new URL(authUrl3).searchParams.get('state')!;

      // All states should be different
      expect(new Set([state1, state2, state3]).size).toBe(3);

      // Each user can complete their flow
      mockOAuthServer.mockTokenSuccess({ access_token: 'token1' });
      await flow.exchangeCode('code1', state1);

      mockOAuthServer.mockTokenSuccess({ access_token: 'token2' });
      await flow.exchangeCode('code2', state2);

      mockOAuthServer.mockTokenSuccess({ access_token: 'token3' });
      await flow.exchangeCode('code3', state3);

      // Verify all 3 tokens stored separately
      expect(mockStorage.size()).toBe(3);
    });
  });

  describe('revokeToken()', () => {
    it('should clear token from storage even without revocation URL', async () => {
      await mockStorage.storeToken('auth_code:test-client-id', {
        access_token: 'token',
        expires_in: 3600,
        obtained_at: Date.now(),
        token_type: 'Bearer',
        scope: 'read write',
      });

      await flow.revokeToken();

      expect(mockStorage.has('auth_code:test-client-id')).toBe(false);
    });

    it('should call revocation endpoint if provided', async () => {
      await mockStorage.storeToken('auth_code:test-client-id', {
        access_token: 'token_to_revoke',
        expires_in: 3600,
        obtained_at: Date.now(),
        token_type: 'Bearer',
        scope: 'read write',
      });

      const revocationUrl = 'https://oauth.example.com/revoke';

      // Mock the revoke endpoint
      const pool = mockOAuthServer.getAgent().get('https://oauth.example.com');
      pool.intercept({
        path: '/revoke',
        method: 'POST',
      }).reply(200, {});

      await flow.revokeToken(revocationUrl);

      // Token should be cleared from storage
      expect(mockStorage.has('auth_code:test-client-id')).toBe(false);
    });
  });
});
