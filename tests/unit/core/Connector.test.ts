/**
 * Connector Registry Tests
 *
 * Tests for the static Connector registry: CRUD, auth types, resilience config.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';

describe('Connector', () => {
  beforeEach(() => {
    Connector.clear();
  });

  describe('create() and get()', () => {
    it('should create and retrieve a connector by name', () => {
      const connector = Connector.create({
        name: 'openai-main',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'sk-test-key' },
      });

      expect(connector.name).toBe('openai-main');
      expect(connector.vendor).toBe(Vendor.OpenAI);

      const retrieved = Connector.get('openai-main');
      expect(retrieved).toBe(connector);
    });

    it('should create connector with displayName and baseURL', () => {
      const connector = Connector.create({
        name: 'github',
        auth: { type: 'api_key', apiKey: 'ghp_test' },
        displayName: 'GitHub API',
        baseURL: 'https://api.github.com',
      });

      expect(connector.displayName).toBe('GitHub API');
      expect(connector.baseURL).toBe('https://api.github.com');
    });

    it('should default displayName to name when not provided', () => {
      const connector = Connector.create({
        name: 'my-connector',
        auth: { type: 'api_key', apiKey: 'key123' },
      });

      expect(connector.displayName).toBe('my-connector');
    });
  });

  describe('create() duplicate name', () => {
    it('should throw when creating a connector with a duplicate name', () => {
      Connector.create({
        name: 'openai',
        auth: { type: 'api_key', apiKey: 'sk-1' },
      });

      expect(() =>
        Connector.create({
          name: 'openai',
          auth: { type: 'api_key', apiKey: 'sk-2' },
        })
      ).toThrow(/already exists/);
    });
  });

  describe('create() with empty name', () => {
    it('should throw when name is empty string', () => {
      expect(() =>
        Connector.create({
          name: '',
          auth: { type: 'api_key', apiKey: 'key' },
        })
      ).toThrow(/name is required/);
    });

    it('should throw when name is whitespace only', () => {
      expect(() =>
        Connector.create({
          name: '   ',
          auth: { type: 'api_key', apiKey: 'key' },
        })
      ).toThrow(/name is required/);
    });
  });

  describe('get() non-existent', () => {
    it('should throw when getting a non-existent connector', () => {
      expect(() => Connector.get('does-not-exist')).toThrow(/not found/);
    });

    it('should list available connectors in the error message', () => {
      Connector.create({
        name: 'alpha',
        auth: { type: 'api_key', apiKey: 'key-a' },
      });

      try {
        Connector.get('beta');
        throw new Error('Expected to throw');
      } catch (err) {
        expect((err as Error).message).toContain('alpha');
      }
    });
  });

  describe('has()', () => {
    it('should return true for existing connector', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'k' },
      });
      expect(Connector.has('test')).toBe(true);
    });

    it('should return false for non-existing connector', () => {
      expect(Connector.has('nope')).toBe(false);
    });
  });

  describe('remove()', () => {
    it('should remove a connector and dispose it', () => {
      const connector = Connector.create({
        name: 'removable',
        auth: { type: 'api_key', apiKey: 'k' },
      });

      expect(connector.isDisposed()).toBe(false);

      const removed = Connector.remove('removable');
      expect(removed).toBe(true);
      expect(Connector.has('removable')).toBe(false);
      expect(connector.isDisposed()).toBe(true);
    });

    it('should return false when removing non-existent connector', () => {
      const removed = Connector.remove('ghost');
      expect(removed).toBe(false);
    });

    it('should allow re-creating a connector after removal', () => {
      Connector.create({
        name: 'reusable',
        auth: { type: 'api_key', apiKey: 'k1' },
      });
      Connector.remove('reusable');

      const newConnector = Connector.create({
        name: 'reusable',
        auth: { type: 'api_key', apiKey: 'k2' },
      });
      expect(newConnector.getApiKey()).toBe('k2');
    });
  });

  describe('list() and listAll()', () => {
    it('should list all registered connector names', () => {
      Connector.create({ name: 'a', auth: { type: 'api_key', apiKey: '1' } });
      Connector.create({ name: 'b', auth: { type: 'api_key', apiKey: '2' } });
      Connector.create({ name: 'c', auth: { type: 'api_key', apiKey: '3' } });

      const names = Connector.list();
      expect(names).toHaveLength(3);
      expect(names).toContain('a');
      expect(names).toContain('b');
      expect(names).toContain('c');
    });

    it('should return connector instances via listAll()', () => {
      Connector.create({ name: 'x', auth: { type: 'api_key', apiKey: '1' } });
      Connector.create({ name: 'y', auth: { type: 'api_key', apiKey: '2' } });

      const connectors = Connector.listAll();
      expect(connectors).toHaveLength(2);
      expect(connectors[0]).toBeInstanceOf(Connector);
      expect(connectors[1]).toBeInstanceOf(Connector);
    });

    it('should return size correctly', () => {
      expect(Connector.size()).toBe(0);
      Connector.create({ name: 'one', auth: { type: 'api_key', apiKey: 'k' } });
      expect(Connector.size()).toBe(1);
    });
  });

  describe('clear()', () => {
    it('should remove all connectors and dispose them', () => {
      const c1 = Connector.create({ name: 'c1', auth: { type: 'api_key', apiKey: 'k1' } });
      const c2 = Connector.create({ name: 'c2', auth: { type: 'api_key', apiKey: 'k2' } });

      Connector.clear();

      expect(Connector.list()).toHaveLength(0);
      expect(Connector.size()).toBe(0);
      expect(c1.isDisposed()).toBe(true);
      expect(c2.isDisposed()).toBe(true);
    });
  });

  describe('auth types', () => {
    it('should support api_key auth and return the key', () => {
      const connector = Connector.create({
        name: 'api-key-connector',
        auth: { type: 'api_key', apiKey: 'my-secret-key' },
      });

      expect(connector.getApiKey()).toBe('my-secret-key');
    });

    it('should throw getApiKey() on non-api_key auth type', () => {
      const connector = Connector.create({
        name: 'none-auth',
        auth: { type: 'none' },
      });

      expect(() => connector.getApiKey()).toThrow(/does not use API key auth/);
    });

    it('should support bearer-style api_key with custom header', () => {
      const connector = Connector.create({
        name: 'custom-header',
        auth: {
          type: 'api_key',
          apiKey: 'xkey-123',
          headerName: 'X-API-Key',
          headerPrefix: '',
        },
      });

      expect(connector.getApiKey()).toBe('xkey-123');
    });

    it('should create connector with none auth type', () => {
      const connector = Connector.create({
        name: 'local-ollama',
        vendor: Vendor.Ollama,
        auth: { type: 'none' },
        baseURL: 'http://localhost:11434',
      });

      expect(connector.vendor).toBe(Vendor.Ollama);
      expect(connector.baseURL).toBe('http://localhost:11434');
    });
  });

  describe('resilience config', () => {
    it('should create connector with circuit breaker config', () => {
      const connector = Connector.create({
        name: 'resilient',
        auth: { type: 'api_key', apiKey: 'k' },
        circuitBreaker: {
          enabled: true,
          failureThreshold: 10,
          successThreshold: 3,
          resetTimeoutMs: 60000,
        },
      });

      const metrics = connector.getMetrics();
      expect(metrics.circuitBreakerState).toBe('closed');
      expect(metrics.requestCount).toBe(0);
    });

    it('should create connector with circuit breaker disabled', () => {
      const connector = Connector.create({
        name: 'no-cb',
        auth: { type: 'api_key', apiKey: 'k' },
        circuitBreaker: { enabled: false },
      });

      const metrics = connector.getMetrics();
      expect(metrics.circuitBreakerState).toBeUndefined();
    });

    it('should allow resetting the circuit breaker', () => {
      const connector = Connector.create({
        name: 'cb-reset',
        auth: { type: 'api_key', apiKey: 'k' },
        circuitBreaker: { enabled: true },
      });

      // Should not throw even though there's nothing to reset
      connector.resetCircuitBreaker();
      expect(connector.getMetrics().circuitBreakerState).toBe('closed');
    });
  });

  describe('getDescriptionsForTools()', () => {
    it('should return message when no connectors registered', () => {
      expect(Connector.getDescriptionsForTools()).toContain('No connectors registered');
    });

    it('should list all connectors with display names', () => {
      Connector.create({
        name: 'github',
        auth: { type: 'api_key', apiKey: 'k' },
        displayName: 'GitHub API',
        description: 'Access GitHub repos',
      });

      const desc = Connector.getDescriptionsForTools();
      expect(desc).toContain('github');
      expect(desc).toContain('GitHub API');
      expect(desc).toContain('Access GitHub repos');
    });
  });
});
