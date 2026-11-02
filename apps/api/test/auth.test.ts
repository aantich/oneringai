/**
 * Auth integration tests
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { request, createTestUser, migrateDB } from './setup.js';

describe('Auth', () => {
  beforeAll(migrateDB);

  describe('POST /auth/signup', () => {
    it('should create a new user', async () => {
      const res = await request('POST', '/auth/signup', {
        body: { email: 'new@test.com', password: 'password123' },
      });

      expect(res.status).toBe(201);
      const data = await res.json() as { user: { id: string; email: string }; accessToken: string };
      expect(data.user.email).toBe('new@test.com');
      expect(data.accessToken).toBeTruthy();
    });

    it('should reject duplicate email', async () => {
      await request('POST', '/auth/signup', {
        body: { email: 'dupe@test.com', password: 'password123' },
      });

      const res = await request('POST', '/auth/signup', {
        body: { email: 'dupe@test.com', password: 'password123' },
      });

      expect(res.status).toBe(409);
    });

    it('should reject short password', async () => {
      const res = await request('POST', '/auth/signup', {
        body: { email: 'short@test.com', password: 'short' },
      });

      expect(res.status).toBe(400);
    });

    it('should reject invalid email', async () => {
      const res = await request('POST', '/auth/signup', {
        body: { email: 'notanemail', password: 'password123' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/signin', () => {
    it('should sign in with valid credentials', async () => {
      await request('POST', '/auth/signup', {
        body: { email: 'signin@test.com', password: 'password123' },
      });

      const res = await request('POST', '/auth/signin', {
        body: { email: 'signin@test.com', password: 'password123' },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { accessToken: string };
      expect(data.accessToken).toBeTruthy();
    });

    it('should reject invalid password', async () => {
      const res = await request('POST', '/auth/signin', {
        body: { email: 'signin@test.com', password: 'wrongpassword' },
      });

      expect(res.status).toBe(401);
    });

    it('should reject unknown email', async () => {
      const res = await request('POST', '/auth/signin', {
        body: { email: 'unknown@test.com', password: 'password123' },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token', async () => {
      const user = await createTestUser();

      const res = await request('POST', '/auth/refresh', {
        body: { refreshToken: user.refreshToken },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { accessToken: string; refreshToken: string };
      expect(data.accessToken).toBeTruthy();
      expect(data.refreshToken).toBeTruthy();
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout and invalidate refresh token', async () => {
      const user = await createTestUser();

      const res = await request('POST', '/auth/logout', {
        token: user.accessToken,
        body: { refreshToken: user.refreshToken },
      });

      expect(res.status).toBe(200);

      // Refresh token should no longer work
      const refreshRes = await request('POST', '/auth/refresh', {
        body: { refreshToken: user.refreshToken },
      });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('Protected routes', () => {
    it('should return 401 without token', async () => {
      const res = await request('GET', '/registry/models');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request('GET', '/registry/models', {
        token: 'invalid-token',
      });
      expect(res.status).toBe(401);
    });
  });
});
