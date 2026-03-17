/**
 * Unit tests for shared provider config extraction helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import {
  extractOpenAICompatConfig,
  extractGoogleConfig,
  extractGoogleMediaConfig,
  extractGrokMediaConfig,
} from '../../../src/core/extractProviderConfig.js';

describe('extractProviderConfig', () => {
  beforeEach(() => {
    Connector.clear();
  });

  afterEach(() => {
    Connector.clear();
  });

  describe('extractOpenAICompatConfig', () => {
    it('should extract config for api_key auth', () => {
      const connector = Connector.create({
        name: 'test-openai',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'sk-test-123' },
        baseURL: 'https://api.openai.com/v1',
      });

      const config = extractOpenAICompatConfig(connector);
      expect(config.auth.apiKey).toBe('sk-test-123');
      expect(config.baseURL).toBe('https://api.openai.com/v1');
    });

    it('should extract config for none auth (Ollama)', () => {
      const connector = Connector.create({
        name: 'ollama',
        vendor: Vendor.Ollama,
        auth: { type: 'none' as const },
        baseURL: 'http://localhost:11434/v1',
      });

      const config = extractOpenAICompatConfig(connector);
      expect(config.auth.apiKey).toBe('ollama');
      expect(config.baseURL).toBe('http://localhost:11434/v1');
    });

    it('should throw for JWT auth', () => {
      const connector = Connector.create({
        name: 'jwt-test',
        vendor: Vendor.OpenAI,
        auth: {
          type: 'jwt',
          privateKey: 'test-key',
          tokenUrl: 'https://example.com/token',
          clientId: 'test-id',
        } as any,
      });

      expect(() => extractOpenAICompatConfig(connector)).toThrow('requires API key authentication');
    });

    it('should include provider label in error message', () => {
      const connector = Connector.create({
        name: 'jwt-test',
        vendor: Vendor.OpenAI,
        auth: {
          type: 'jwt',
          privateKey: 'key',
          tokenUrl: 'url',
          clientId: 'id',
        } as any,
      });

      expect(() => extractOpenAICompatConfig(connector, 'MyProvider')).toThrow('MyProvider requires API key');
    });
  });

  describe('extractGoogleConfig', () => {
    it('should extract API key', () => {
      const connector = Connector.create({
        name: 'test-google',
        vendor: Vendor.Google,
        auth: { type: 'api_key', apiKey: 'google-key-123' },
      });

      const config = extractGoogleConfig(connector);
      expect(config.apiKey).toBe('google-key-123');
    });

    it('should throw for non-api_key auth', () => {
      const connector = Connector.create({
        name: 'google-none',
        vendor: Vendor.Google,
        auth: { type: 'none' as const },
      });

      expect(() => extractGoogleConfig(connector)).toThrow('Google requires API key');
    });
  });

  describe('extractGoogleMediaConfig', () => {
    it('should extract auth and timeout options', () => {
      const connector = Connector.create({
        name: 'google-media',
        vendor: Vendor.Google,
        auth: { type: 'api_key', apiKey: 'gkey' },
        options: { timeout: 30000, maxRetries: 3 },
      });

      const config = extractGoogleMediaConfig(connector);
      expect(config.auth.apiKey).toBe('gkey');
      expect(config.timeout).toBe(30000);
      expect(config.maxRetries).toBe(3);
    });
  });

  describe('extractGrokMediaConfig', () => {
    it('should extract config with baseURL', () => {
      const connector = Connector.create({
        name: 'test-grok',
        vendor: Vendor.Grok,
        auth: { type: 'api_key', apiKey: 'grok-key' },
        baseURL: 'https://api.x.ai/v1',
      });

      const config = extractGrokMediaConfig(connector);
      expect(config.auth.apiKey).toBe('grok-key');
      expect(config.baseURL).toBe('https://api.x.ai/v1');
    });

    it('should throw for non-api_key auth', () => {
      const connector = Connector.create({
        name: 'grok-none',
        vendor: Vendor.Grok,
        auth: { type: 'none' as const },
      });

      expect(() => extractGrokMediaConfig(connector)).toThrow('Grok requires API key');
    });
  });
});
