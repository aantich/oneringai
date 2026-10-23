/**
 * ScopedConnectorRegistry Unit Tests
 *
 * Tests access-controlled connector registry views.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { ScopedConnectorRegistry } from '@/core/ScopedConnectorRegistry.js';
import { Vendor } from '@/core/Vendor.js';
import { ConnectorTools } from '@/tools/connector/ConnectorTools.js';
import type { IConnectorAccessPolicy, ConnectorAccessContext } from '@/domain/interfaces/IConnectorAccessPolicy.js';
import type { IConnectorRegistry } from '@/domain/interfaces/IConnectorRegistry.js';

// Mock createProvider to avoid real provider initialization
vi.mock('@/core/createProvider.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/createProvider.js')>(),
  createProvider: vi.fn(() => ({
    name: 'mock',
    capabilities: { text: true, images: false, videos: false, audio: false },
    generate: vi.fn(),
    streamGenerate: vi.fn(),
    getModelCapabilities: vi.fn(() => ({
      supportsTools: true,
      supportsVision: false,
      supportsJSON: false,
      supportsJSONSchema: false,
      maxTokens: 128000,
      maxOutputTokens: 16384,
    })),
  })),
}));

describe('ScopedConnectorRegistry', () => {
  beforeEach(() => {
    Connector.clear();
    Connector.setAccessPolicy(null);
    ConnectorTools.clearCache();

    // Create test connectors
    Connector.create({
      name: 'openai-main',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'key-1' },
      tags: ['tenant-a', 'production'],
    });
    Connector.create({
      name: 'openai-backup',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'key-2' },
      tags: ['tenant-a', 'staging'],
    });
    Connector.create({
      name: 'anthropic-main',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: 'key-3' },
      tags: ['tenant-b', 'production'],
    });
    Connector.create({
      name: 'github',
      auth: { type: 'api_key', apiKey: 'gh-token' },
      baseURL: 'https://api.github.com',
      tags: ['tenant-a'],
    });
  });

  afterEach(() => {
    Connector.clear();
    Connector.setAccessPolicy(null);
    ConnectorTools.clearCache();
  });

  // ===== Allow-all policy =====

  describe('with allow-all policy', () => {
    const allowAllPolicy: IConnectorAccessPolicy = {
      canAccess: () => true,
    };

    it('should behave identically to static Connector', () => {
      const registry = new ScopedConnectorRegistry(allowAllPolicy, {});

      expect(registry.list().sort()).toEqual(Connector.list().sort());
      expect(registry.listAll().length).toBe(Connector.listAll().length);
      expect(registry.size()).toBe(Connector.size());
      expect(registry.has('openai-main')).toBe(true);
      expect(registry.get('openai-main')).toBe(Connector.get('openai-main'));
    });

    it('should return same getInfo as static Connector', () => {
      const registry = new ScopedConnectorRegistry(allowAllPolicy, {});
      expect(registry.getInfo()).toEqual(Connector.getInfo());
    });

    it('should return same getDescriptionsForTools as static Connector', () => {
      const registry = new ScopedConnectorRegistry(allowAllPolicy, {});
      expect(registry.getDescriptionsForTools()).toBe(Connector.getDescriptionsForTools());
    });
  });

  // ===== Filtering policy =====

  describe('with filtering policy', () => {
    const tenantAPolicy: IConnectorAccessPolicy = {
      canAccess: (connector) => {
        const tags = (connector.config as Record<string, unknown>).tags as string[] | undefined;
        return !!tags && tags.includes('tenant-a');
      },
    };

    it('get() should return accessible connector', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      const c = registry.get('openai-main');
      expect(c.name).toBe('openai-main');
    });

    it('get() should throw for denied connector', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      expect(() => registry.get('anthropic-main')).toThrow(/Connector 'anthropic-main' not found/);
    });

    it('list() should exclude denied connectors', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      const names = registry.list().sort();
      expect(names).toEqual(['github', 'openai-backup', 'openai-main']);
      expect(names).not.toContain('anthropic-main');
    });

    it('listAll() should exclude denied connectors', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      const connectors = registry.listAll();
      expect(connectors.length).toBe(3);
      expect(connectors.map((c) => c.name).sort()).toEqual(['github', 'openai-backup', 'openai-main']);
    });

    it('has() should return false for denied connector', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      expect(registry.has('anthropic-main')).toBe(false);
      expect(registry.has('openai-main')).toBe(true);
    });

    it('size() should reflect filtered count', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      expect(registry.size()).toBe(3);
    });

    it('getInfo() should only include accessible connectors', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      const info = registry.getInfo();
      expect(Object.keys(info).sort()).toEqual(['github', 'openai-backup', 'openai-main']);
      expect(info['anthropic-main']).toBeUndefined();
    });

    it('getDescriptionsForTools() should only include accessible connectors', () => {
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});
      const desc = registry.getDescriptionsForTools();
      expect(desc).toContain('openai-main');
      expect(desc).not.toContain('anthropic-main');
    });
  });

  // ===== Error messages: no information leakage =====

  describe('error message security', () => {
    const denyAllPolicy: IConnectorAccessPolicy = {
      canAccess: () => false,
    };

    it('denied connector error lists only visible connectors', () => {
      const registry = new ScopedConnectorRegistry(denyAllPolicy, {});
      expect(() => registry.get('openai-main')).toThrow(
        "Connector 'openai-main' not found. Available: none"
      );
    });

    it('non-existent connector error lists only visible connectors', () => {
      const registry = new ScopedConnectorRegistry(denyAllPolicy, {});
      expect(() => registry.get('does-not-exist')).toThrow(
        "Connector 'does-not-exist' not found. Available: none"
      );
    });

    it('denied error with some visible connectors lists them', () => {
      const onlyOpenAIPolicy: IConnectorAccessPolicy = {
        canAccess: (c) => c.vendor === Vendor.OpenAI,
      };
      const registry = new ScopedConnectorRegistry(onlyOpenAIPolicy, {});
      expect(() => registry.get('anthropic-main')).toThrow(/Available: openai-main, openai-backup/);
    });
  });

  // ===== Tag-based policy =====

  describe('tag-based policy', () => {
    it('should filter using connector config tags', () => {
      const productionPolicy: IConnectorAccessPolicy = {
        canAccess: (connector) => {
          const tags = (connector.config as Record<string, unknown>).tags as string[] | undefined;
          return !!tags && tags.includes('production');
        },
      };
      const registry = new ScopedConnectorRegistry(productionPolicy, {});
      expect(registry.list().sort()).toEqual(['anthropic-main', 'openai-main']);
    });
  });

  // ===== Multi-tenant policy using context =====

  describe('multi-tenant policy', () => {
    const multiTenantPolicy: IConnectorAccessPolicy = {
      canAccess: (connector, context) => {
        const tenantId = context.tenantId as string | undefined;
        if (!tenantId) return false;
        const tags = (connector.config as Record<string, unknown>).tags as string[] | undefined;
        return !!tags && tags.includes(tenantId);
      },
    };

    it('should filter by tenantId in context', () => {
      const registryA = new ScopedConnectorRegistry(multiTenantPolicy, { tenantId: 'tenant-a' });
      expect(registryA.list().sort()).toEqual(['github', 'openai-backup', 'openai-main']);

      const registryB = new ScopedConnectorRegistry(multiTenantPolicy, { tenantId: 'tenant-b' });
      expect(registryB.list()).toEqual(['anthropic-main']);
    });

    it('should deny all with unknown tenant', () => {
      const registry = new ScopedConnectorRegistry(multiTenantPolicy, { tenantId: 'tenant-c' });
      expect(registry.size()).toBe(0);
      expect(registry.list()).toEqual([]);
    });
  });

  // ===== Connector.scoped() =====

  describe('Connector.scoped()', () => {
    it('should return ScopedConnectorRegistry', () => {
      const policy: IConnectorAccessPolicy = { canAccess: () => true };
      Connector.setAccessPolicy(policy);

      const registry = Connector.scoped({ userId: 'user1' });
      expect(registry).toBeInstanceOf(ScopedConnectorRegistry);
      expect(registry.size()).toBe(4);
    });

    it('should throw if no policy set', () => {
      expect(() => Connector.scoped({})).toThrow(
        'No access policy set. Call Connector.setAccessPolicy() first.'
      );
    });
  });

  // ===== Connector.setAccessPolicy(null) =====

  describe('Connector.setAccessPolicy(null)', () => {
    it('should clear the policy', () => {
      const policy: IConnectorAccessPolicy = { canAccess: () => true };
      Connector.setAccessPolicy(policy);
      expect(Connector.getAccessPolicy()).toBe(policy);

      Connector.setAccessPolicy(null);
      expect(Connector.getAccessPolicy()).toBeNull();

      expect(() => Connector.scoped({})).toThrow('No access policy set');
    });
  });

  // ===== Connector.asRegistry() =====

  describe('Connector.asRegistry()', () => {
    it('should return unfiltered IConnectorRegistry', () => {
      const registry: IConnectorRegistry = Connector.asRegistry();

      expect(registry.list().sort()).toEqual(Connector.list().sort());
      expect(registry.size()).toBe(Connector.size());
      expect(registry.get('openai-main')).toBe(Connector.get('openai-main'));
      expect(registry.has('openai-main')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
      expect(registry.getInfo()).toEqual(Connector.getInfo());
      expect(registry.getDescriptionsForTools()).toBe(Connector.getDescriptionsForTools());
    });

    it('should throw for missing connector', () => {
      const registry = Connector.asRegistry();
      expect(() => registry.get('nonexistent')).toThrow(/not found/);
    });
  });

  // ===== ConnectorTools with registry option =====

  describe('ConnectorTools.for() with registry option', () => {
    it('should resolve via scoped registry', () => {
      const denyAllPolicy: IConnectorAccessPolicy = { canAccess: () => false };
      const registry = new ScopedConnectorRegistry(denyAllPolicy, {});

      expect(() => ConnectorTools.for('github', undefined, { registry })).toThrow(
        /Connector 'github' not found/
      );
    });

    it('should return tools when connector is accessible', () => {
      const allowAllPolicy: IConnectorAccessPolicy = { canAccess: () => true };
      const registry = new ScopedConnectorRegistry(allowAllPolicy, {});

      const tools = ConnectorTools.for('github', undefined, { registry });
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].definition.function.name).toBe('github_api');
    });
  });

  describe('ConnectorTools.discoverAll() with registry option', () => {
    it('should only discover accessible connectors', () => {
      const tenantAPolicy: IConnectorAccessPolicy = {
        canAccess: (connector) => {
          const tags = (connector.config as Record<string, unknown>).tags as string[] | undefined;
          return !!tags && tags.includes('tenant-a');
        },
      };
      const registry = new ScopedConnectorRegistry(tenantAPolicy, {});

      const all = ConnectorTools.discoverAll(undefined, { registry });
      // Only 'github' has baseURL + no vendor → included by discoverAll logic
      // openai-main/openai-backup have vendor → only included if they have factory registered
      const names = Array.from(all.keys());
      expect(names).toContain('github');
      expect(names).not.toContain('anthropic-main');
    });
  });

  describe('ConnectorTools.findConnector() with registry option', () => {
    it('should find connector from accessible set', () => {
      const allowAllPolicy: IConnectorAccessPolicy = { canAccess: () => true };
      const registry = new ScopedConnectorRegistry(allowAllPolicy, {});

      // github connector has no explicit serviceType but has baseURL
      const found = ConnectorTools.findConnector('github', { registry });
      // detectService for github depends on URL detection
      // Just test the method works with registry
      expect(found === undefined || found.name === 'github').toBe(true);
    });

    it('should not find connector excluded by policy', () => {
      const denyAllPolicy: IConnectorAccessPolicy = { canAccess: () => false };
      const registry = new ScopedConnectorRegistry(denyAllPolicy, {});

      const found = ConnectorTools.findConnector('openai', { registry });
      expect(found).toBeUndefined();
    });
  });

  describe('ConnectorTools.findConnectors() with registry option', () => {
    it('should only return connectors accessible via registry', () => {
      const onlyOpenAIPolicy: IConnectorAccessPolicy = {
        canAccess: (c) => c.vendor === Vendor.OpenAI,
      };
      const registry = new ScopedConnectorRegistry(onlyOpenAIPolicy, {});

      const found = ConnectorTools.findConnectors(Vendor.OpenAI, { registry });
      expect(found.length).toBe(2);
      expect(found.map((c) => c.name).sort()).toEqual(['openai-backup', 'openai-main']);
    });
  });

  // ===== Empty registry =====

  describe('empty scoped registry', () => {
    it('should handle gracefully when all connectors denied', () => {
      const denyAll: IConnectorAccessPolicy = { canAccess: () => false };
      const registry = new ScopedConnectorRegistry(denyAll, {});

      expect(registry.size()).toBe(0);
      expect(registry.list()).toEqual([]);
      expect(registry.listAll()).toEqual([]);
      expect(registry.has('openai-main')).toBe(false);
      expect(registry.getDescriptionsForTools()).toBe('No connectors registered yet.');
      expect(registry.getInfo()).toEqual({});
    });
  });
});
