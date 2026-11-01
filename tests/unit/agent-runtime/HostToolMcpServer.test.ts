import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RuntimeHostTools } from '@/agent-runtime/RuntimeHostTools.js';
import { HostToolMcpServer } from '@/agent-runtime/HostToolMcpServer.js';

describe('authenticated host-tool MCP bridge', () => {
  it('lists only selected tools, rejects foreign credentials and calls the real manager', async () => {
    const host = new RuntimeHostTools({ tools: [{ definition: { type: 'function', function: { name: 'echo', parameters: { type: 'object', properties: { value: { type: 'string' } } } } }, execute: async args => ({ value: args.value, success: false }) }], fingerprint: 'scope:v1' }, {});
    const server = new HostToolMcpServer(); const client = new Client({ name: 'offline-fixture', version: '1' });
    try {
      const url = await server.start(host);
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } } }));
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(['echo']);
      await host.beginRun('r', new AbortController().signal);
      const result = await client.callTool({ name: 'echo', arguments: { value: 'test' } });
      expect(result.isError).toBe(false);
      expect(result.content).toEqual([{ type: 'text', text: '{"value":"test","success":false}' }]);
      expect((await client.callTool({ name: 'not-selected' })).isError).toBe(true);
      await host.endRun(); expect((await client.callTool({ name: 'echo' })).isError).toBe(true);
    } finally { await client.close(); await server.close(); await host.close(); }
  });
});
