/** Actual process restart, actual vendor SDKs, and one external loopback mock service. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openAIManagedFixture } from './agent-runtime/openai-managed-fixture.js';
import { claudeManagedFixture } from './agent-runtime/claude-managed-fixture.js';

for (const vendor of ['openai', 'claude'] as const) {
  const root = await mkdtemp(path.join(tmpdir(), 'managed-restart-'));
  const wire = vendor === 'openai' ? openAIManagedFixture({ pauseCompletion: true }) : claudeManagedFixture({ pauseAfterTool: true });
  const failures: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/fixture-status') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ deliveries: 'toolDeliveries' in wire.counts ? wire.counts.toolDeliveries : wire.counts.deliveries })); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('Mock request bound'); chunks.push(chunk); }
      const result = await wire.fetch(`http://127.0.0.1${request.url}`, { method: request.method, headers: request.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}) });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      // A quiet SSE stream must acknowledge headers before the caller can send its first input.
      response.flushHeaders();
      const reader = result.body?.getReader(); if (!reader) { response.end(); return; }
      response.once('close', () => { void reader.cancel().catch(() => undefined); });
      for (;;) { const item = await reader.read(); if (item.done) break; if (!response.write(item.value)) await once(response, 'drain'); }
      response.end();
    } catch (error) { failures.push(String(error)); if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const childFile = fileURLToPath(new URL('./agent-runtime/managed-restart-child.ts', import.meta.url));
    const child = async (role: string) => {
      const childProcess = spawn(process.execPath, ['--import', 'tsx', childFile, role, vendor, root, `http://127.0.0.1:${address.port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; for (const stream of [childProcess.stdout, childProcess.stderr]) stream.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) childProcess.kill(); });
      const timer = setTimeout(() => childProcess.kill(), 20000);
      try { const [code] = await once(childProcess, 'exit'); if (code !== 0) throw new Error(`Offline ${vendor}/${role} child failed: ${output}; wire errors=${JSON.stringify(failures)}; requests=${JSON.stringify(wire.requests.map(request => [request.method, request.path]).slice(-15))}`); return output; } finally { clearTimeout(timer); }
    };
    await child('produce');
    if (('cancels' in wire.counts ? wire.counts.cancels : wire.counts.interrupts) !== 0) throw new Error('Observer process exit cancelled native work');
    wire.complete(); const output = await child('recover');
    if (wire.counts.inputs !== 1) throw new Error('Native input repeated across process restart');
    console.log(output.trim());
  } finally { server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
}
