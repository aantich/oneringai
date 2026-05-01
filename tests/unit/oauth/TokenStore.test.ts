/**
 * TokenStore Unit Tests
 * Tests token lifecycle, validation, and user scoping
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenStore } from '@/connectors/oauth/domain/TokenStore.js';
import { MockTokenStorage } from '../../fixtures/mockStorage.js';

describe('TokenStore', () => {
  let mockStorage: MockTokenStorage;
  let store: TokenStore;

  beforeEach(() => {
    mockStorage = new MockTokenStorage();
    store = new TokenStore('test_key', mockStorage);
  });

  describe('storeToken() - Validation', () => {
    it('should throw error if access_token is missing', async () => {
      await expect(
        store.storeToken({})
      ).rejects.toThrow('OAuth response missing required access_token field');
    });

    it('should throw error if access_token is not a string', async () => {
      await expect(
        store.storeToken({ access_token: 123 as any })
      ).rejects.toThrow('access_token must be a string');
    });

    it('should throw error if expires_in is negative', async () => {
      await expect(
        store.storeToken({ access_token: 'token', expires_in: -100 })
      ).rejects.toThrow('expires_in must be positive');
    });

    it('should accept valid token response', async () => {
      await expect(
        store.storeToken({
          access_token: 'valid_token',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'read write'
        })
      ).resolves.not.toThrow();
    });

    it('should default expires_in to 3600 if not provided', async () => {
      await store.storeToken({ access_token: 'token' });

      const token = await mockStorage.getToken('test_key');
      expect(token?.expires_in).toBe(3600);
    });

    it('should default token_type to Bearer if not provided', async () => {
      await store.storeToken({ access_token: 'token' });

      const token = await mockStorage.getToken('test_key');
      expect(token?.token_type).toBe('Bearer');
    });

    it('should set obtained_at timestamp', async () => {
      const before = Date.now();
      await store.storeToken({ access_token: 'token' });
      const after = Date.now();

      const token = await mockStorage.getToken('test_key');
      expect(token?.obtained_at).toBeGreaterThanOrEqual(before);
      expect(token?.obtained_at).toBeLessThanOrEqual(after);
    });
  });

  describe('storeToken() - User Scoping', () => {
    it('should use base key for undefined userId (single-user mode)', async () => {
      await store.storeToken({ access_token: 'token' });

      expect(mockStorage.has('test_key')).toBe(true);
      expect(mockStorage.has('test_key:undefined')).toBe(false);
    });

    it('should use base key for "default" userId', async () => {
      await store.storeToken({ access_token: 'token' }, 'default');

      expect(mockStorage.has('test_key')).toBe(true);
    });

    it('should produce 4-part key for userId without accountId (default-account fill)', async () => {
      // Contract change: getScopedKey never produces 3-part keys.
      // userId without accountId now lands at `baseKey:userId:default` so
      // strict host adapters (v25 MongoTokenStorage) can parse the shape
      // unambiguously as a user-scoped token.
      await store.storeToken({ access_token: 'token1' }, 'user123');

      expect(mockStorage.has('test_key:user123:default')).toBe(true);
      expect(mockStorage.has('test_key:user123')).toBe(false);
      expect(mockStorage.has('test_key')).toBe(false);
    });

    it('should isolate tokens by userId under the 4-part contract', async () => {
      await store.storeToken({ access_token: 'token1' }, 'user1');
      await store.storeToken({ access_token: 'token2' }, 'user2');
      await store.storeToken({ access_token: 'token3' }); // default → base key (system)

      expect(mockStorage.size()).toBe(3);
      expect(mockStorage.has('test_key:user1:default')).toBe(true);
      expect(mockStorage.has('test_key:user2:default')).toBe(true);
      expect(mockStorage.has('test_key')).toBe(true);
    });
  });

  describe('getAccessToken()', () => {
    it('should throw error if token not found', async () => {
      await expect(
        store.getAccessToken()
      ).rejects.toThrow('No token stored');
    });

    it('should return access_token for default user', async () => {
      await store.storeToken({ access_token: 'my_token' });

      const token = await store.getAccessToken();
      expect(token).toBe('my_token');
    });

    it('should return access_token for specific userId', async () => {
      await store.storeToken({ access_token: 'user1_token' }, 'user1');
      await store.storeToken({ access_token: 'user2_token' }, 'user2');

      const token1 = await store.getAccessToken('user1');
      const token2 = await store.getAccessToken('user2');

      expect(token1).toBe('user1_token');
      expect(token2).toBe('user2_token');
    });

    it('should not return other users tokens', async () => {
      await store.storeToken({ access_token: 'user1_token' }, 'user1');

      await expect(
        store.getAccessToken('user2')
      ).rejects.toThrow('No token stored');
    });
  });

  describe('getRefreshToken()', () => {
    it('should return refresh_token if present', async () => {
      await store.storeToken({
        access_token: 'access',
        refresh_token: 'refresh123'
      });

      const refreshToken = await store.getRefreshToken();
      expect(refreshToken).toBe('refresh123');
    });

    it('should throw error if no refresh_token', async () => {
      await store.storeToken({ access_token: 'access' });

      await expect(
        store.getRefreshToken()
      ).rejects.toThrow('No refresh token available');
    });

    it('should throw error if token not found', async () => {
      await expect(
        store.getRefreshToken()
      ).rejects.toThrow('No refresh token available');
    });
  });

  describe('isValid() - Expiration Logic', () => {
    it('should return false if token not found', async () => {
      const isValid = await store.isValid();
      expect(isValid).toBe(false);
    });

    it('should return true if token not expired', async () => {
      await store.storeToken({
        access_token: 'token',
        expires_in: 3600 // 1 hour
      });

      const isValid = await store.isValid();
      expect(isValid).toBe(true);
    });

    it('should return false if token expired', async () => {
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      await mockStorage.storeToken('test_key', {
        access_token: 'token',
        expires_in: 3600, // 1 hour expiry
        obtained_at: twoHoursAgo, // Stored 2 hours ago
        token_type: 'Bearer',
        scope: 'read',
      });

      const isValid = await store.isValid();
      expect(isValid).toBe(false);
    });

    it('should respect refreshBeforeExpiry buffer', async () => {
      await store.storeToken({
        access_token: 'token',
        expires_in: 600, // 10 minutes
        obtained_at: Date.now()
      });

      // With 15 minute buffer, token expiring in 10 min should be invalid
      const isValid = await store.isValid(900); // 15 minutes buffer
      expect(isValid).toBe(false);
    });

    it('should use default 300s buffer if not specified', async () => {
      await store.storeToken({
        access_token: 'token',
        expires_in: 400, // 6 min 40 sec
        obtained_at: Date.now()
      });

      // Default buffer is 300s (5 min)
      // Token expires in 400s, buffer 300s → valid for 100s more
      const isValid = await store.isValid();
      expect(isValid).toBe(true);
    });

    it('should handle edge case: token expires exactly now', async () => {
      const oneSecondAgo = Date.now() - 1000;
      await mockStorage.storeToken('test_key', {
        access_token: 'token',
        expires_in: 1, // Expires after 1 second
        obtained_at: oneSecondAgo, // 1 second ago → expired now
        token_type: 'Bearer',
        scope: 'read',
      });

      const isValid = await store.isValid(0); // No buffer
      expect(isValid).toBe(false);
    });
  });

  describe('getTokenInfo()', () => {
    it('should return null if no token', async () => {
      const info = await store.getTokenInfo();
      expect(info).toBeNull();
    });

    it('should return token info if exists', async () => {
      await store.storeToken({ access_token: 'token', expires_in: 3600 });

      const info = await store.getTokenInfo();
      expect(info).toBeTruthy();
      expect(info?.access_token).toBe('token');
    });

    it('should respect userId scoping', async () => {
      await store.storeToken({ access_token: 'token' }, 'user1');

      expect(await store.getTokenInfo('user1')).toBeTruthy();
      expect(await store.getTokenInfo('user2')).toBeNull();
      expect(await store.getTokenInfo()).toBeNull(); // default user
    });
  });

  describe('hasRefreshToken()', () => {
    it('should return false if no token', async () => {
      expect(await store.hasRefreshToken()).toBe(false);
    });

    it('should return false if token has no refresh_token', async () => {
      await store.storeToken({ access_token: 'token' });

      expect(await store.hasRefreshToken()).toBe(false);
    });

    it('should return true if refresh_token exists', async () => {
      await store.storeToken({
        access_token: 'token',
        refresh_token: 'refresh'
      });

      expect(await store.hasRefreshToken()).toBe(true);
    });
  });

  describe('clear()', () => {
    it('should delete token for default user', async () => {
      await store.storeToken({ access_token: 'token' });

      await store.clear();

      const info = await store.getTokenInfo();
      expect(info).toBeNull();
    });

    it('should delete token for specific userId', async () => {
      await store.storeToken({ access_token: 'token' }, 'user1');

      await store.clear('user1');

      const info = await store.getTokenInfo('user1');
      expect(info).toBeNull();
    });

    it('should not affect other users tokens when clearing', async () => {
      await store.storeToken({ access_token: 'token1' }, 'user1');
      await store.storeToken({ access_token: 'token2' }, 'user2');

      await store.clear('user1');

      expect(await store.getTokenInfo('user1')).toBeNull();
      expect(await store.getTokenInfo('user2')).toBeTruthy();
    });
  });

  describe('Multi-user isolation', () => {
    it('should completely isolate different users', async () => {
      // Store tokens for 3 users
      await store.storeToken({ access_token: 'token_default', expires_in: 1000 });
      await store.storeToken({ access_token: 'token_alice', expires_in: 2000 }, 'alice');
      await store.storeToken({ access_token: 'token_bob', expires_in: 3000 }, 'bob');

      // Each user gets their own token
      expect(await store.getAccessToken()).toBe('token_default');
      expect(await store.getAccessToken('alice')).toBe('token_alice');
      expect(await store.getAccessToken('bob')).toBe('token_bob');

      // Clear one doesn't affect others
      await store.clear('alice');

      expect(await store.getTokenInfo()).toBeTruthy();
      expect(await store.getTokenInfo('alice')).toBeNull();
      expect(await store.getTokenInfo('bob')).toBeTruthy();
    });
  });
});
