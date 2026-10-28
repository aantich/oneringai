import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { Connector, ConnectorTools, ToolManager } from '@/index.js';
import type { EnhancedConnectorAttempt } from '@/index.js';

const servers: Server[] = [], managers: ToolManager[] = [];
afterEach(async () => {
  managers.splice(0).forEach(manager => manager.destroy());
  Connector.clear(); ConnectorTools.clearCache();
  await Promise.all(servers.splice(0).map(server => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }));
});
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  return `http://127.0.0.1:${address.port}`;
}
function tools(baseURL: string, profile?: string, attempts?: EnhancedConnectorAttempt[]) {
  const connector = Connector.create({ name: 'redirect', serviceType: 'github', baseURL,
    auth: { type: 'api_key', apiKey: 'synthetic-redirect-only', headerName: 'X-API-Key', headerPrefix: '' }, retry: { maxRetries: 0 } });
  const selected = profile ? ConnectorTools.enhanced(connector.name, { profile, onAttempt: attempt => attempts?.push(attempt) }) : ConnectorTools.for(connector.name);
  const manager = new ToolManager(); managers.push(manager); manager.registerConnectorTools(connector.name, selected);
  return { manager, name: profile ? 'redirect_api_exec' : 'redirect_api' };
}
describe('enhanced generic credential destinations across real HTTP redirects', () => {
  it.each(['execution-v1', 'collections-v1'].flatMap(profile => [302, 307].map(status => ({ profile, status }))))('$profile rejects a cross-origin $status before forwarding credentials or a write body', async ({ profile, status }) => {
    let foreignRequests = 0, initialRequests = 0;
    const foreign = await listen((_req, res) => { foreignRequests++; res.end('{}'); });
    const origin = await listen((_req, res) => { initialRequests++; res.writeHead(status, { Location: `${foreign}/capture` }); res.end(); });
    const { manager, name } = tools(origin, profile);
    const report = await manager.executeWithOutcome(name, { method: 'POST', endpoint: '/redirect', body: { synthetic: 'write' } });
    // The first request ran; refusal to follow is an operational failure, not
    // evidence that the original POST was never admitted.
    expect(report.outcome.status).toBe('failed'); expect(JSON.stringify(report.result)).toContain('restricted to the configured connector origin');
    expect(initialRequests).toBe(1); expect(foreignRequests).toBe(0);
  });
  it.each([301, 302, 303, 307, 308])('preserves native same-origin POST/$status semantics and counts each dispatched hop', async status => {
    const received: Array<{ url?: string; method?: string; key?: string; body: string; contentType?: string }> = [], attempts: EnhancedConnectorAttempt[] = [];
    const origin = await listen((req, res) => {
      let body = ''; req.setEncoding('utf8'); req.on('data', data => { body += data; });
      req.on('end', () => {
        received.push({ url: req.url, method: req.method, key: req.headers['x-api-key'] as string, body, contentType: req.headers['content-type'] });
        if (req.url === '/redirect') { res.writeHead(status, { Location: '/final' }); res.end(); }
        else { res.setHeader('Content-Type', 'application/json'); res.end('{"accepted":true}'); }
      });
    });
    const { manager, name } = tools(origin, 'execution-v1', attempts);
    expect((await manager.executeWithOutcome(name, { method: 'POST', endpoint: '/redirect', body: { id: 'one' } })).outcome.status).toBe('succeeded');
    expect(received).toHaveLength(2); expect(received.every(item => item.key === 'synthetic-redirect-only')).toBe(true);
    expect(received[1]).toMatchObject({ url: '/final', method: status === 307 || status === 308 ? 'POST' : 'GET', body: status === 307 || status === 308 ? '{"id":"one"}' : '' });
    if (status !== 307 && status !== 308) expect(received[1]!.contentType).toBeUndefined();
    const dispatched = attempts.filter(attempt => attempt.state === 'dispatched');
    expect(dispatched).toHaveLength(2); expect(new Set(dispatched.map(attempt => attempt.requestId)).size).toBe(2);
    expect(new Set(dispatched.map(attempt => attempt.invocationId)).size).toBe(1);
  });
  it('bounds same-origin redirect loops without replaying an unknown-effect request through retry policy', async () => {
    let requests = 0;
    const origin = await listen((_req, res) => { requests++; res.writeHead(307, { Location: '/loop' }); res.end(); });
    const { manager, name } = tools(origin, 'execution-v1');
    const report = await manager.executeWithOutcome(name, { method: 'POST', endpoint: '/loop', body: { id: 'one' } });
    expect(report.outcome.status).toBe('failed'); expect(JSON.stringify(report.result)).toContain('redirect limit'); expect(requests).toBe(21);
  });
  it('preserves the legacy generic redirect contract', async () => {
    const received: string[] = [];
    const foreign = await listen((req, res) => { received.push(String(req.headers['x-api-key'])); res.end('{"ok":true}'); });
    const origin = await listen((_req, res) => { res.writeHead(302, { Location: `${foreign}/capture` }); res.end(); });
    const { manager, name } = tools(origin);
    expect((await manager.executeWithOutcome(name, { method: 'GET', endpoint: '/redirect' })).outcome.status).toBe('succeeded');
    expect(received).toEqual(['synthetic-redirect-only']);
  });
});
