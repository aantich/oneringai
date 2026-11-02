/**
 * Admin integration tests
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { request, createTestUser, promoteUser, migrateDB } from './setup.js';

describe('Admin', () => {
  let adminToken: string;
  let adminId: string;
  let regularToken: string;
  let regularUserId: string;

  beforeAll(async () => {
    await migrateDB();

    // Create admin
    const admin = await createTestUser('admin@test.com');
    adminId = admin.userId;
    await promoteUser(admin.userId, 'super_admin');
    // Re-sign in to get token with admin role
    const res = await request('POST', '/auth/signin', {
      body: { email: 'admin@test.com', password: 'testpassword123' },
    });
    const data = await res.json() as { accessToken: string };
    adminToken = data.accessToken;

    // Create regular user
    const user = await createTestUser('regular@test.com');
    regularToken = user.accessToken;
    regularUserId = user.userId;
  });

  describe('Access control', () => {
    it('should reject non-admin users', async () => {
      const res = await request('GET', '/admin/users', { token: regularToken });
      expect(res.status).toBe(403);
    });

    it('should allow admin users', async () => {
      const res = await request('GET', '/admin/users', { token: adminToken });
      expect(res.status).toBe(200);
    });
  });

  describe('User management', () => {
    it('should list users', async () => {
      const res = await request('GET', '/admin/users', { token: adminToken });
      expect(res.status).toBe(200);
      const users = await res.json() as unknown[];
      expect(users.length).toBeGreaterThan(0);
    });

    it('should get user details', async () => {
      const res = await request('GET', `/admin/users/${regularUserId}`, { token: adminToken });
      expect(res.status).toBe(200);
      const data = await res.json() as { email: string; balance: unknown };
      expect(data.email).toBe('regular@test.com');
      expect(data.balance).toBeTruthy();
    });

    it('should suspend user', async () => {
      const res = await request('PUT', `/admin/users/${regularUserId}/suspend`, { token: adminToken });
      expect(res.status).toBe(200);

      const userRes = await request('GET', `/admin/users/${regularUserId}`, { token: adminToken });
      const user = await userRes.json() as { status: string };
      expect(user.status).toBe('suspended');

      // Re-activate for other tests
      await request('PUT', `/admin/users/${regularUserId}/activate`, { token: adminToken });
    });
  });

  describe('Token management', () => {
    it('should grant tokens', async () => {
      const res = await request('POST', `/admin/tokens/${regularUserId}/grant`, {
        token: adminToken,
        body: { amount: 1000, description: 'Test grant' },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { newBalance: number; granted: number };
      expect(data.granted).toBe(1000);
      expect(data.newBalance).toBeGreaterThanOrEqual(1000);
    });

    it('should get balance', async () => {
      const res = await request('GET', `/admin/tokens/${regularUserId}/balance`, { token: adminToken });
      expect(res.status).toBe(200);
      const data = await res.json() as { current_balance: number };
      expect(data.current_balance).toBeGreaterThan(0);
    });

    it('should get transactions', async () => {
      const res = await request('GET', `/admin/tokens/${regularUserId}/transactions`, { token: adminToken });
      expect(res.status).toBe(200);
      const txns = await res.json() as unknown[];
      expect(txns.length).toBeGreaterThan(0);
    });
  });

  describe('Subscription management', () => {
    it('should change plan', async () => {
      const res = await request('PUT', `/admin/subscriptions/${regularUserId}/plan`, {
        token: adminToken,
        body: { plan: 'pro', grantTokens: true },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { plan: string };
      expect(data.plan).toBe('pro');
    });

    it('should change subscription status', async () => {
      const res = await request('PUT', `/admin/subscriptions/${regularUserId}/status`, {
        token: adminToken,
        body: { status: 'active' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Analytics', () => {
    it('should return platform overview', async () => {
      const res = await request('GET', '/admin/analytics/overview', { token: adminToken });
      expect(res.status).toBe(200);
      const data = await res.json() as { totalUsers: number; activeUsers: number };
      expect(data.totalUsers).toBeGreaterThan(0);
    });
  });

  describe('Audit log', () => {
    it('should list audit entries', async () => {
      const res = await request('GET', '/admin/audit', { token: adminToken });
      expect(res.status).toBe(200);
      const entries = await res.json() as unknown[];
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
