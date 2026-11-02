/**
 * Metering integration tests
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import { request, createTestUser, promoteUser, migrateDB } from './setup.js';

describe('Metering', () => {
  let adminToken: string;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    await migrateDB();

    // Create admin
    const admin = await createTestUser('meter-admin@test.com');
    await promoteUser(admin.userId, 'super_admin');
    const adminRes = await request('POST', '/auth/signin', {
      body: { email: 'meter-admin@test.com', password: 'testpassword123' },
    });
    adminToken = ((await adminRes.json()) as { accessToken: string }).accessToken;

    // Create user
    const user = await createTestUser('meter-user@test.com');
    userToken = user.accessToken;
    userId = user.userId;

    // Grant tokens
    await request('POST', `/admin/tokens/${userId}/grant`, {
      token: adminToken,
      body: { amount: 10000 },
    });

    // Seed a model
    await env.DB.prepare(
      `INSERT INTO models (id, vendor, name, max_input_tokens, max_output_tokens, vendor_input_cpm, vendor_output_cpm, features, is_active)
       VALUES ('gpt-test', 'openai', 'GPT Test', 128000, 4096, 2.0, 8.0, '{}', 1)`,
    ).run();
  });

  describe('Balance check', () => {
    it('should allow requests with sufficient balance', async () => {
      const res = await request('GET', '/billing/balance', { token: userToken });
      expect(res.status).toBe(200);
      const data = await res.json() as { current_balance: number };
      expect(data.current_balance).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('Credentials', () => {
    it('should store and list credentials', async () => {
      // Store
      const storeRes = await request('POST', '/credentials', {
        token: userToken,
        body: { serviceId: 'openai', apiKey: 'sk-test-key-12345', label: 'test', isDefault: true },
      });
      expect(storeRes.status).toBe(201);

      // List
      const listRes = await request('GET', '/credentials', { token: userToken });
      expect(listRes.status).toBe(200);
      const creds = await listRes.json() as Array<{ serviceId: string; label: string }>;
      expect(creds.length).toBe(1);
      expect(creds[0]!.serviceId).toBe('openai');
      // Should NOT contain the actual key
      expect(JSON.stringify(creds)).not.toContain('sk-test-key');
    });
  });

  describe('Token pricing', () => {
    it('should set and read platform pricing', async () => {
      // Set pricing
      const setRes = await request('PUT', '/admin/pricing/gpt-test', {
        token: adminToken,
        body: { platformInputTpm: 200, platformOutputTpm: 800 },
      });
      expect(setRes.status).toBe(200);

      // Read pricing
      const getRes = await request('GET', '/admin/pricing/gpt-test', { token: adminToken });
      expect(getRes.status).toBe(200);
      const data = await getRes.json() as { platformInputTpm: number; platformOutputTpm: number };
      expect(data.platformInputTpm).toBe(200);
      expect(data.platformOutputTpm).toBe(800);
    });

    it('should clear pricing override', async () => {
      await request('DELETE', '/admin/pricing/gpt-test', { token: adminToken });

      const getRes = await request('GET', '/admin/pricing/gpt-test', { token: adminToken });
      const data = await getRes.json() as { platformInputTpm: number | null };
      expect(data.platformInputTpm).toBeNull();
    });
  });

  describe('Model registry', () => {
    it('should seed models from library', async () => {
      const seedRes = await request('POST', '/admin/models/seed', { token: adminToken });
      expect(seedRes.status).toBe(200);

      // Check models exist
      const modelsRes = await request('GET', '/registry/models', { token: userToken });
      expect(modelsRes.status).toBe(200);
      const models = await modelsRes.json() as unknown[];
      expect(models.length).toBeGreaterThan(10); // Should have 30+ from library
    });

    it('should add a custom model', async () => {
      const res = await request('POST', '/admin/models', {
        token: adminToken,
        body: {
          id: 'custom-model-1',
          vendor: 'custom',
          name: 'Custom Model',
          maxInputTokens: 8000,
          maxOutputTokens: 2000,
          vendorInputCpm: 0.5,
          vendorOutputCpm: 1.5,
          features: { streaming: true },
        },
      });
      expect(res.status).toBe(201);

      const getRes = await request('GET', '/admin/models/custom-model-1', { token: adminToken });
      expect(getRes.status).toBe(200);
    });

    it('should disable a model', async () => {
      await request('DELETE', '/admin/models/custom-model-1', { token: adminToken });

      const getRes = await request('GET', '/admin/models/custom-model-1', { token: adminToken });
      const data = await getRes.json() as { isActive: boolean };
      expect(data.isActive).toBe(false);
    });
  });
});
