import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { RuntimeHostTools } from './RuntimeHostTools.js';
import { errorMessage } from './internal.js';

/** Per-session loopback control channel. Credentials never enter shell environment policy. */
export class HostToolMcpServer {
  readonly token = randomBytes(32).toString('hex');
  private http?: Server;
  private readonly clients = new Set<McpServer>();
  async start(tools: RuntimeHostTools): Promise<string> {
    this.http = createServer(async (req, res) => {
      const expected = Buffer.from(`Bearer ${this.token}`);
      const actual = Buffer.from(req.headers.authorization ?? '');
      if (req.url !== '/mcp' || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.writeHead(401).end(); return;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      // Stateless transports avoid accepting an untrusted cross-session MCP ID.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, allowedHosts: [req.headers.host!] });
      const server = new McpServer({ name: 'onering-host', version: '1' }, { capabilities: { tools: {} } });
      this.clients.add(server);
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.definitions.map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters as { type: 'object' } })) }));
      server.setRequestHandler(CallToolRequestSchema, async request => {
        try {
          const report = await tools.execute(request.params.name, request.params.arguments ?? {}, String(request.params._meta?.['onering-call-id'] ?? randomBytes(16).toString('hex')));
          return { content: [{ type: 'text', text: report.modelText }], isError: report.outcome.status !== 'succeeded' };
        } catch (error) { return { content: [{ type: 'text', text: errorMessage(error) }], isError: true }; }
      });
      res.on('close', () => { this.clients.delete(server); void server.close(); });
      try { await server.connect(transport); await transport.handleRequest(req, res); }
      catch { if (!res.headersSent) res.writeHead(500).end(); }
    });
    await new Promise<void>((resolve, reject) => { this.http!.once('error', reject); this.http!.listen(0, '127.0.0.1', resolve); });
    const address = this.http.address();
    if (!address || typeof address === 'string') throw new Error('Missing broker address');
    return `http://127.0.0.1:${address.port}/mcp`;
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.clients].map(client => client.close()));
    this.http?.closeAllConnections();
    if (this.http?.listening) await new Promise<void>((resolve, reject) => this.http!.close(error => error ? reject(error) : resolve()));
  }
}
