import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/** Real in-process MCP; scripted query only. Never launches Claude Code. */
export const offlineClaudeSdk = {
  createSdkMcpServer,
  query: ({ options }: { options?: Options }): Query => {
    const iterator = (async function* (): AsyncGenerator<SDKMessage> {
      const server = options?.mcpServers?.onering_host;
      if (server && 'instance' in server) {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'offline-example', version: '1' });
        await server.instance.connect(serverTransport); await client.connect(clientTransport);
        try {
          const tools = (await client.listTools()).tools;
          if (tools[0]) { const result = await client.callTool({ name: tools[0].name, arguments: {} }); if (result.isError) throw new Error(JSON.stringify(result)); }
        } finally { await client.close(); }
      }
      yield { type: 'result', subtype: 'success', result: 'ACK', session_id: 'offline-native-session', uuid: '00000000-0000-4000-8000-000000000001', duration_ms: 0, duration_api_ms: 0, num_turns: 1, stop_reason: 'end_turn', permission_denials: [], is_error: false, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, fallback_credit: null, inference_geo: 'offline', iterations: [], output_tokens_details: { thinking_tokens: 0 }, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: 'standard', speed: 'standard' }, modelUsage: {}, total_cost_usd: 0 } as SDKMessage;
    })();
    return Object.assign(iterator, { close: () => {}, interrupt: async () => undefined }) as unknown as Query;
  },
};
