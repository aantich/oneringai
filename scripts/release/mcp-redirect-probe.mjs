// The real public adapter and bundled SDK must enforce this, not a source alias
// or the unrelated SDK installed beside the tarball. All traffic is local.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function probeMcpRedirects(api) {
  const leaked = [], admitted = [];
  const sink = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    leaked.push({ header: request.headers['x-offline-secret'], body });
    response.writeHead(400); response.end();
  });
  await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${sink.address().port}`;
  const source = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    admitted.push(request.headers['x-offline-secret']);
    if (request.url !== '/mcp') {
      response.writeHead(307, { location: request.url === '/same-origin' ? '/mcp' : target + '/mcp' }); response.end(); return;
    }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    const message = JSON.parse(text);
    if (message.id === undefined) { response.writeHead(202); response.end(); return; }
    const result = message.method === 'initialize'
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-release-fixture', version: '1' } }
      : { tools: [] };
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${source.address().port}`;
  const names = [];
  try {
    for (const path of ['same-origin', 'cross-origin']) {
      const name = `release-redirect-${path}-${crypto.randomUUID()}`; names.push(name);
      const client = api.MCPRegistry.create({ name, transport: 'http', autoReconnect: false, requestTimeout: 3000,
        transportConfig: { url: origin + '/' + path, headers: { 'X-Offline-Secret': 'synthetic-release-fixture' } } });
      if (path === 'same-origin') { await client.connect(); assert.equal(client.state, 'connected'); }
      else await assert.rejects(() => client.connect());
      api.MCPRegistry.remove(name);
    }
    assert.ok(admitted.includes('synthetic-release-fixture'), 'Authentication fixture was not exercised');
    assert.deepEqual(leaked, [], 'Cross-origin MCP request leaked a header or body');
    return { sameOrigin: 'connected', crossOrigin: 'blocked', forwardedRequests: leaked.length };
  } finally {
    names.forEach(name => api.MCPRegistry.remove(name));
    await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => sink.close(resolve))]);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const require = createRequire(import.meta.url);
  const report = {};
  for (const [format, api] of [['esm', await import('oneringai')], ['cjs', require('oneringai')]]) report[format] = await probeMcpRedirects(api);
  console.log(JSON.stringify(report));
}
