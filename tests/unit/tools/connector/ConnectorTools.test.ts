/**
 * Tests for ConnectorTools - vendor-dependent tools framework
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import { Services } from '../../../../src/domain/entities/Services.js';

/** Get the generic API tool from ConnectorTools.for() */
function getApiTool(connectorName: string) {
  const tools = ConnectorTools.for(connectorName);
  const api = tools.find(t => t.definition.function.name.endsWith('_api'));
  if (!api) throw new Error(`No API tool found for ${connectorName}`);
  return api;
}

describe('ConnectorTools', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  describe('Service Detection', () => {
    it('should detect service from explicit serviceType', () => {
      Connector.create({
        name: 'my-slack',
        serviceType: Services.Slack,
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://custom.url.com/api',
      });

      const connector = Connector.get('my-slack');
      const detected = ConnectorTools.detectService(connector);

      expect(detected).toBe('slack');
    });

    it('should detect service from baseURL when no explicit serviceType', () => {
      Connector.create({
        name: 'github',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.github.com',
      });

      const connector = Connector.get('github');
      const detected = ConnectorTools.detectService(connector);

      expect(detected).toBe('github');
    });

    it('should prefer explicit serviceType over baseURL detection', () => {
      Connector.create({
        name: 'custom',
        serviceType: 'jira',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.github.com', // GitHub URL but Jira serviceType
      });

      const connector = Connector.get('custom');
      const detected = ConnectorTools.detectService(connector);

      expect(detected).toBe('jira');
    });

    it('should return undefined for unknown services', () => {
      Connector.create({
        name: 'unknown',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://unknown-service.example.com',
      });

      const connector = Connector.get('unknown');
      const detected = ConnectorTools.detectService(connector);

      expect(detected).toBeUndefined();
    });

    it('should cache service detection results', () => {
      Connector.create({
        name: 'slack',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://slack.com/api',
      });

      const connector = Connector.get('slack');

      // First call
      const result1 = ConnectorTools.detectService(connector);
      // Second call should hit cache
      const result2 = ConnectorTools.detectService(connector);

      expect(result1).toBe(result2);
      expect(result1).toBe('slack');
    });
  });

  describe('Generic API Tool', () => {
    it('should create generic API tool for connector with baseURL', () => {
      Connector.create({
        name: 'test-api',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.example.com',
      });

      const tool = getApiTool('test-api');

      expect(tool.definition.function.name).toBe('test-api_api');
      expect(tool.definition.function.description).toContain('api.example.com');
      expect(tool.execute).toBeDefined();
    });

    it('should include required parameters in schema', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.example.com',
      });

      const tool = getApiTool('test');
      const params = tool.definition.function.parameters;

      expect(params?.required).toContain('method');
      expect(params?.required).toContain('endpoint');
      expect(params?.properties?.method).toBeDefined();
      expect(params?.properties?.endpoint).toBeDefined();
      expect(params?.properties?.body).toBeDefined();
      expect(params?.properties?.queryParams).toBeDefined();
      expect(params?.properties?.headers).toBeDefined();
    });

    it('should have medium risk level permission by default', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.example.com',
      });

      const tool = getApiTool('test');

      expect(tool.permission?.riskLevel).toBe('medium');
      expect(tool.permission?.scope).toBe('session');
    });
  });

  describe('ConnectorTools.for()', () => {
    it('should return generic API tool for connector with baseURL', () => {
      Connector.create({
        name: 'generic',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.example.com',
      });

      const tools = ConnectorTools.for('generic');

      expect(tools.length).toBe(1);
      expect(tools[0].definition.function.name).toBe('generic_api');
    });

    it('should return empty array for connector without baseURL', () => {
      Connector.create({
        name: 'no-base-url',
        auth: { type: 'api_key', apiKey: 'test-key' },
      });

      const tools = ConnectorTools.for('no-base-url');

      expect(tools.length).toBe(0);
    });

    it('should accept connector instance or name string', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.example.com',
      });

      const connector = Connector.get('test');

      const toolsByName = ConnectorTools.for('test');
      const toolsByInstance = ConnectorTools.for(connector);

      expect(toolsByName.length).toBe(toolsByInstance.length);
      expect(toolsByName[0].definition.function.name).toBe(toolsByInstance[0].definition.function.name);
    });
  });

  describe('Service Tool Registration', () => {
    it('should register and use service tool factory', () => {
      const mockFactory = vi.fn().mockReturnValue([
        {
          definition: {
            type: 'function' as const,
            function: { name: 'custom_tool', description: 'Custom tool' },
          },
          execute: async () => ({}),
        },
      ]);

      ConnectorTools.registerService('custom-service', mockFactory);

      Connector.create({
        name: 'custom',
        serviceType: 'custom-service',
        auth: { type: 'api_key', apiKey: 'test-key' },
        baseURL: 'https://api.example.com',
      });

      const tools = ConnectorTools.for('custom');

      expect(mockFactory).toHaveBeenCalled();
      expect(tools.length).toBe(2); // generic + custom
      expect(tools.some((t) => t.definition.function.name === 'custom_custom_tool')).toBe(true);

      // Cleanup
      ConnectorTools.unregisterService('custom-service');
    });

    it('should list supported services', () => {
      ConnectorTools.registerService('test-service-1', () => []);
      ConnectorTools.registerService('test-service-2', () => []);

      const services = ConnectorTools.listSupportedServices();

      expect(services).toContain('test-service-1');
      expect(services).toContain('test-service-2');

      // Cleanup
      ConnectorTools.unregisterService('test-service-1');
      ConnectorTools.unregisterService('test-service-2');
    });

    it('should check if service has tools', () => {
      ConnectorTools.registerService('has-tools', () => []);

      expect(ConnectorTools.hasServiceTools('has-tools')).toBe(true);
      expect(ConnectorTools.hasServiceTools('no-tools')).toBe(false);

      ConnectorTools.unregisterService('has-tools');
    });
  });

  describe('Connector Discovery', () => {
    it('should discover all connectors with serviceType', () => {
      Connector.create({
        name: 'slack-1',
        serviceType: Services.Slack,
        auth: { type: 'api_key', apiKey: 'key1' },
        baseURL: 'https://slack.com/api',
      });

      Connector.create({
        name: 'github-1',
        serviceType: Services.GitHub,
        auth: { type: 'api_key', apiKey: 'key2' },
        baseURL: 'https://api.github.com',
      });

      const discovered = ConnectorTools.discoverAll();

      expect(discovered.size).toBe(2);
      expect(discovered.has('slack-1')).toBe(true);
      expect(discovered.has('github-1')).toBe(true);
    });

    it('should skip AI provider connectors without serviceType', () => {
      // Simulating AI provider connector (has vendor but no serviceType)
      Connector.create({
        name: 'openai',
        vendor: 'openai' as any,
        auth: { type: 'api_key', apiKey: 'key' },
        baseURL: 'https://api.openai.com',
      });

      Connector.create({
        name: 'slack',
        serviceType: Services.Slack,
        auth: { type: 'api_key', apiKey: 'key' },
        baseURL: 'https://slack.com/api',
      });

      const discovered = ConnectorTools.discoverAll();

      expect(discovered.has('openai')).toBe(false);
      expect(discovered.has('slack')).toBe(true);
    });

    it('should find connector by service type', () => {
      Connector.create({
        name: 'my-slack',
        serviceType: Services.Slack,
        auth: { type: 'api_key', apiKey: 'key' },
        baseURL: 'https://slack.com/api',
      });

      const found = ConnectorTools.findConnector(Services.Slack);

      expect(found).toBeDefined();
      expect(found?.name).toBe('my-slack');
    });

    it('should find all connectors for service type', () => {
      Connector.create({
        name: 'slack-1',
        serviceType: Services.Slack,
        auth: { type: 'api_key', apiKey: 'key1' },
        baseURL: 'https://slack.com/api',
      });

      Connector.create({
        name: 'slack-2',
        serviceType: Services.Slack,
        auth: { type: 'api_key', apiKey: 'key2' },
        baseURL: 'https://slack.com/api',
      });

      const found = ConnectorTools.findConnectors(Services.Slack);

      expect(found.length).toBe(2);
    });
  });

  describe('Cache Management', () => {
    it('should clear all caches', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'key' },
        baseURL: 'https://slack.com/api',
      });

      // Populate caches
      ConnectorTools.detectService(Connector.get('test'));
      ConnectorTools.for('test');

      // Clear caches
      ConnectorTools.clearCache();

      // Verify caches are cleared (no way to directly check, but shouldn't throw)
      expect(() => ConnectorTools.detectService(Connector.get('test'))).not.toThrow();
    });

    it('should invalidate cache for specific connector', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'key' },
        baseURL: 'https://slack.com/api',
      });

      // Populate cache
      ConnectorTools.detectService(Connector.get('test'));

      // Invalidate
      ConnectorTools.invalidateCache('test');

      // Should work without issues
      expect(() => ConnectorTools.detectService(Connector.get('test'))).not.toThrow();
    });
  });

  describe('Security Features', () => {
    it('should have describeCall function', () => {
      Connector.create({
        name: 'test',
        auth: { type: 'api_key', apiKey: 'key' },
        baseURL: 'https://api.example.com',
      });

      const tool = getApiTool('test');

      expect(tool.describeCall).toBeDefined();
      expect(tool.describeCall?.({ method: 'GET', endpoint: '/users' })).toBe('GET /users');
    });
  });

  describe('Generic API Tool Execution', () => {
    // Mock global fetch for tool execution tests
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockReset();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function createTestConnector() {
      Connector.create({
        name: 'slack-test',
        serviceType: 'slack',
        auth: { type: 'api_key', apiKey: 'xoxb-test-token' },
        baseURL: 'https://slack.com/api',
      });
    }

    describe('Body Normalization', () => {
      it('should handle body as a proper object (normal case)', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'POST',
          endpoint: '/chat.postMessage',
          body: { channel: 'C123', text: 'hello' },
        });

        expect(result.success).toBe(true);
        const fetchCall = mockFetch.mock.calls[0];
        const sentBody = JSON.parse(fetchCall[1].body);
        expect(sentBody.channel).toBe('C123');
        expect(sentBody.text).toBe('hello');
      });

      it('should handle body as a stringified JSON string (LLM bug)', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        );

        const tool = getApiTool('slack-test');
        // LLM sends body as a string instead of an object
        const result = await tool.execute({
          method: 'POST',
          endpoint: '/chat.postMessage',
          body: '{"channel": "C123", "text": "hello"}' as any,
        });

        expect(result.success).toBe(true);
        const fetchCall = mockFetch.mock.calls[0];
        const sentBody = JSON.parse(fetchCall[1].body);
        // Should be properly parsed, NOT double-serialized
        expect(sentBody.channel).toBe('C123');
        expect(sentBody.text).toBe('hello');
      });

      it('should handle body as a non-JSON string (sent as-is)', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'POST',
          endpoint: '/some-endpoint',
          body: 'plain text body' as any,
        });

        expect(result.success).toBe(true);
        const fetchCall = mockFetch.mock.calls[0];
        // Plain string gets JSON-stringified (wrapped in quotes)
        expect(fetchCall[1].body).toBe('"plain text body"');
      });

      it('should handle missing body gracefully', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'GET',
          endpoint: '/channels.list',
        });

        expect(result.success).toBe(true);
        const fetchCall = mockFetch.mock.calls[0];
        expect(fetchCall[1].body).toBeUndefined();
      });
    });

    describe('API Error Detection', () => {
      it('should detect Slack-style API errors (ok: false)', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: false, error: 'channel_not_found' }),
            { status: 200 }
          )
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'POST',
          endpoint: '/chat.postMessage',
          body: { channel: 'C_INVALID', text: 'test' },
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('channel_not_found');
        expect(result.status).toBe(200);
        expect(result.data).toBeUndefined();
      });

      it('should detect success:false pattern', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ success: false, message: 'invalid_form_data' }),
            { status: 200 }
          )
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'POST',
          endpoint: '/api/endpoint',
          body: { data: 'test' },
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('invalid_form_data');
      });

      it('should detect nested error.message pattern', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { message: 'Not authorized', code: 401 } }),
            { status: 200 }
          )
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'GET',
          endpoint: '/api/data',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Not authorized');
      });

      it('should report success for Slack ok:true responses', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: true, ts: '1234567890.123456', channel: 'C123' }),
            { status: 200 }
          )
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'POST',
          endpoint: '/chat.postMessage',
          body: { channel: 'C123', text: 'hello' },
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ ok: true, ts: '1234567890.123456', channel: 'C123' });
      });

      it('should still detect HTTP-level errors', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response('Unauthorized', { status: 401 })
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'GET',
          endpoint: '/users.list',
        });

        expect(result.success).toBe(false);
        expect(result.status).toBe(401);
        expect(result.error).toBe('Unauthorized');
      });

      it('should handle non-JSON success responses', async () => {
        createTestConnector();
        mockFetch.mockResolvedValueOnce(
          new Response('OK', { status: 200 })
        );

        const tool = getApiTool('slack-test');
        const result = await tool.execute({
          method: 'GET',
          endpoint: '/health',
        });

        expect(result.success).toBe(true);
        expect(result.data).toBe('OK');
      });
    });
  });
});
