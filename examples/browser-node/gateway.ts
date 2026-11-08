/** Scripted local model gateway. No credentials or live provider calls. */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
const raw = (output: unknown[]) => ({ id: 'resp_offline', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed', output,
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
const text = (value: string) => raw([{ type: 'message', id: 'msg_offline', role: 'assistant', content: [{ type: 'output_text', text: value, annotations: [] }] }]);

export async function startGateway(options: { assets?: Record<string, { type: string; data: string | Uint8Array }> } = {}) {
  const requests: Array<{ path: string; body: Record<string, any> }> = [];
  const toolsIssued = new Set<string>(), retries = new Set<string>();
  const server = createServer((request, response) => { void handle(request, response).catch(error => { response.statusCode = 500; response.end(String(error)); }); });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = request.url ?? '/';
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'");
    response.setHeader('Cache-Control', 'no-store');
    if (path.includes('/github/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ type: 'file', sha: 'offline', size: 4, encoding: 'base64', content: '77u/YQ==' })); return;
    }
    if (path.includes('/collections/')) {
      const url = new URL(path, 'http://localhost'), second = url.searchParams.has('cursor');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, channels: [{ id: second ? 'second' : 'first', name: 'offline-channel' }], response_metadata: { next_cursor: second ? '' : 'next' } })); return;
    }
    if (options.assets?.[path]) { const asset = options.assets[path]!; response.setHeader('Content-Type', asset.type); response.end(asset.data); return; }
    if (request.method !== 'POST') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Shared Agent offline demo</title><script type="module" src="/bundle.js"></script>'); return; }
    let source = ''; for await (const chunk of request) source += String(chunk);
    const body = JSON.parse(source) as Record<string, any>;
    requests.push({ path, body });
    if (path.includes('/retry/') && !retries.has(path)) { retries.add(path); response.writeHead(503, { 'content-type': 'application/json', 'retry-after-ms': '1' }); response.end('{}'); return; }
    if (path.includes('/cancel/')) { await new Promise(resolve => setTimeout(resolve, 500)); if (response.destroyed) return; }
    if (body.stream) {
      response.setHeader('Content-Type', 'text/event-stream');
      const completed = text('Restored USD');
      for (const event of [
        { type: 'response.created', response: { ...completed, status: 'in_progress', output: [], usage: null } },
        { type: 'response.output_text.delta', response_id: 'resp_offline', item_id: 'msg_offline', output_index: 0, content_index: 0, delta: 'Restored USD', sequence_number: 1 },
        { type: 'response.completed', response: completed },
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end(); return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (body.text?.format?.type === 'json_schema') {
      response.end(JSON.stringify(text(JSON.stringify({ currency: JSON.stringify(body.input).includes('NULL_CURRENCY_FIXTURE') ? null : 'USD' })))); return;
    }
    if (/\/(direct|cancel|unknown)\//.test(path)) {
      const result = text('Direct result');
      response.end(JSON.stringify(path.includes('/unknown/') ? { ...result, usage: undefined } : result)); return;
    }
    if (!toolsIssued.has(path)) {
      toolsIssued.add(path);
      response.end(JSON.stringify(raw(['get_app_currency', 'lookup_total'].map((name, index) => ({
        type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, name, arguments: '{}', status: 'completed',
      }))))); return;
    }
    response.end(JSON.stringify(text('Total EUR 42')));
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local gateway address');
  return { origin: `http://127.0.0.1:${address.port}`, requests,
    async close(): Promise<void> { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
