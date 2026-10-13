import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Connector } from '@/core/Connector.js';
import { ConnectorTools } from '@/tools/connector/ConnectorTools.js';
import { ToolManager } from '@/core/ToolManager.js';
import type { ToolContext } from '@/domain/interfaces/IToolContext.js';

const fetchMock = vi.fn();
const connector = () => Connector.create({ name: 'cancel-http', auth: { type: 'api_key', apiKey: 'local-test-only' }, baseURL: 'https://fixture.invalid',
  retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 1000 } });
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { Connector.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
function abortingFetch(_url: string, options: RequestInit) {
  return new Promise<Response>((_resolve, reject) => { options.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true }); });
}

describe('Connector cancellation boundaries', () => {
  it('composes host cancellation and connector timeout and retains the host reason', async () => {
    vi.useFakeTimers(); fetchMock.mockImplementation(abortingFetch); const host = new AbortController();
    const call = connector().fetch('/slow', { signal: host.signal, timeout: 100 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(0); host.abort(new Error('host stopped'));
    expect((await call).message).toBe('host stopped'); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves the legacy per-attempt timeout message and does not retry aborts', async () => {
    vi.useFakeTimers(); fetchMock.mockImplementation(abortingFetch);
    const call = connector().fetch('/slow', { timeout: 10 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(10); expect((await call).message).toContain('Request timeout after 10ms'); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not send a request after host abort while OAuth token resolution is pending', async () => {
    const conn = connector(); let release!: (token: string) => void;
    const getToken = vi.spyOn(conn, 'getToken').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const host = new AbortController(); const call = conn.fetch('/write', { method: 'POST', signal: host.signal }, 'alice', 'work').catch(e => e);
    host.abort(); expect((await call).name).toBe('AbortError'); release('unused'); await Promise.resolve();
    expect(getToken).toHaveBeenCalledWith('alice', 'work'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('whole-operation deadline includes token resolution and cannot send an expired write', async () => {
    vi.useFakeTimers(); const conn = connector(); let release!: (token: string) => void;
    vi.spyOn(conn, 'getToken').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const call = conn.fetch('/write', { method: 'POST', timeoutScope: 'operation', timeout: 10 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(10); expect((await call).name).toBe('TimeoutError'); release('unused'); await Promise.resolve(); expect(fetchMock).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('whole-operation deadline aborts a streaming body after headers', async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('first')); } })));
    const response = await connector().fetch('/stream', { timeoutScope: 'operation', timeout: 10 });
    const reader = response.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    const next = reader.read().catch(e => e); await vi.advanceTimersByTimeAsync(10); expect((await next).name).toBe('TimeoutError'); expect(vi.getTimerCount()).toBe(0);
  });
  it('default header timeout does not impose a new deadline on a response body', async () => {
    vi.useFakeTimers(); let finish!: () => void;
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(c) { finish = () => { c.enqueue(new TextEncoder().encode('later')); c.close(); }; } })));
    const response = await connector().fetch('/body', { timeout: 10 }); const text = response.text(); await vi.advanceTimersByTimeAsync(20); finish(); expect(await text).toBe('later'); expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans the operation timer on full body consumption, preserves Response metadata, and supports clones', async () => {
    vi.useFakeTimers(); const source = new Response('complete', { status: 201, headers: { 'x-test': 'yes' } }); Object.defineProperty(source, 'url', { value: 'https://fixture.invalid/body' });
    fetchMock.mockResolvedValue(source); const response = await connector().fetch('/body', { timeoutScope: 'operation', timeout: 100 }); const clone = response.clone();
    expect(await response.text()).toBe('complete'); expect(await clone.text()).toBe('complete'); expect(response.status).toBe(201); expect(response.url).toBe(source.url); expect(response.headers.get('x-test')).toBe('yes'); expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans the operation timer when a body is cancelled', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const response = await connector().fetch('/body', { timeoutScope: 'operation', timeout: 100 }); await response.body!.cancel(); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans the operation timer on body failure and body-free responses', async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.error(new Error('broken body')); } })));
    await expect((await connector().fetch('/body', { timeoutScope: 'operation', timeout: 100 })).text()).rejects.toThrow('broken body');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })); await Connector.get('cancel-http').fetch('/empty', { timeoutScope: 'operation', timeout: 100 }); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['network', 'status'] as const)('safe policy avoids replaying ambiguous POST after %s failure', async kind => {
    if (kind === 'network') fetchMock.mockRejectedValue(new Error('connection lost')); else fetchMock.mockResolvedValue(new Response('uncertain', { status: 503 }));
    const call = connector().fetch('/write', { method: 'POST', retryPolicy: 'safe' });
    if (kind === 'network') await expect(call).rejects.toThrow('connection lost'); else expect((await call).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('preserves legacy POST retry behavior when safe policy is not selected', async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValueOnce(new Response('retry', { status: 503 })).mockResolvedValueOnce(new Response('ok'));
    const call = connector().fetch('/write', { method: 'POST' }); await vi.runAllTimersAsync(); expect((await call).ok).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('host abort interrupts retry backoff and prevents the next attempt', async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValue(new Response('retry', { status: 503 })); const host = new AbortController();
    const call = connector().fetch('/read', { signal: host.signal, retryPolicy: 'safe' }).catch(e => e);
    await vi.advanceTimersByTimeAsync(0); host.abort(new Error('cancel backoff')); expect((await call).message).toBe('cancel backoff'); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('safe reads can retry, and explicit skipRetry also skips status retries', async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValueOnce(new Response('retry', { status: 503 })).mockResolvedValueOnce(new Response('ok'));
    const conn = connector(); const call = conn.fetch('/read', { retryPolicy: 'safe' }); await vi.runAllTimersAsync(); expect((await call).ok).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response('retry', { status: 503 })); expect((await conn.fetch('/read', { skipRetry: true })).status).toBe(503); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('local HTTP tool/connector integration', () => {
  let server: Server | undefined; let manager: ToolManager | undefined;
  afterEach(async () => { manager?.destroy(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); });
  async function loopback() {
    vi.unstubAllGlobals();
    server = createServer((req, res) => { if (req.url === '/stream') { res.writeHead(200); res.write('first'); } });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    return Connector.create({ name: 'loopback', auth: { type: 'api_key', apiKey: 'local-only' }, baseURL: `http://127.0.0.1:${address.port}`, retry: { maxRetries: 0 } });
  }
  it('caller cancellation remains effective during a native fetch body read', async () => {
    const conn = await loopback(); const host = new AbortController(); const response = await conn.fetch('/stream', { signal: host.signal, timeout: 500 });
    const reader = response.body!.getReader(); await reader.read(); const next = reader.read().catch(e => e); host.abort(); expect((await next).name).toBe('AbortError');
  });
  it('generic connector tools receive execution cancellation and retain trusted user/account bindings', async () => {
    const conn = await loopback(); manager = new ToolManager({ toolExecutionTimeout: 30 });
    const generated = ConnectorTools.for('loopback'); expect(generated.length).toBeGreaterThan(0); manager.register(generated[0]!);
    const context: ToolContext = { userId: 'alice', accountId: 'work' }; manager.setToolContext(context);
    const token = vi.spyOn(conn, 'getToken').mockResolvedValue('local-only');
    const error = await manager.execute(generated[0]!.definition.function.name, { method: 'POST', endpoint: '/slow', path: '/slow', url: '/slow' }).catch(e => e);
    expect(error.outcome.status).toBe('timed_out'); expect(token).toHaveBeenCalledWith('alice', 'work'); expect(context).not.toHaveProperty('signal');
  });
});

describe('retry cleanup and clone regressions', () => {
  it.each(['host', 'deadline'] as const)('settles during pending safe retry cleanup on %s cancellation, observes late rejection and never redispatches', async cause => {
    vi.useFakeTimers(); const host = new AbortController(); let rejectCleanup!: (e: Error) => void;
    const response = new Response('retry', { status: 503 });
    vi.spyOn(response.body!, 'cancel').mockImplementation(() => new Promise((_r, reject) => { rejectCleanup = reject; }));
    fetchMock.mockResolvedValue(response);
    const call = connector().fetch('/retry', { retryPolicy: 'safe', timeoutScope: 'operation', timeout: 20, signal: host.signal }).catch(e => e);
    await vi.advanceTimersByTimeAsync(0);
    if (cause === 'host') host.abort(new Error('host cleanup stop')); else await vi.advanceTimersByTimeAsync(20);
    expect((await call).message).toContain(cause === 'host' ? 'host cleanup stop' : 'timeout');
    rejectCleanup(new Error('late cleanup rejection')); await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start a retry when cleanup itself aborts the host signal', async () => {
    const host = new AbortController(); const response = new Response('retry', { status: 503 });
    vi.spyOn(response.body!, 'cancel').mockImplementation(async () => { host.abort(new Error('cleanup aborted')); }); fetchMock.mockResolvedValue(response);
    await expect(connector().fetch('/retry', { retryPolicy: 'safe', signal: host.signal })).rejects.toThrow('cleanup aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps retrying safe reads after completed cleanup', async () => {
    vi.useFakeTimers(); const response = new Response('retry', { status: 503 }); const cancel = vi.spyOn(response.body!, 'cancel');
    fetchMock.mockResolvedValueOnce(response).mockResolvedValueOnce(new Response('ok'));
    const call = connector().fetch('/retry', { retryPolicy: 'safe', timeoutScope: 'operation', timeout: 5000 });
    await vi.advanceTimersByTimeAsync(1100); const result = await call; expect(await result.text()).toBe('ok');
    expect(cancel).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('native body-used and locked clone errors remain enforced', async () => {
    fetchMock.mockResolvedValue(new Response('body')); const response = await connector().fetch('/body', { timeoutScope: 'operation', timeout: 1000 });
    const clone = response.clone(); const reader = clone.body!.getReader(); expect(() => clone.clone()).toThrow(TypeError); reader.releaseLock();
    const chained = clone.clone(); expect(await response.text()).toBe('body'); expect(() => response.clone()).toThrow(TypeError);
    expect(await clone.text()).toBe('body'); expect(() => clone.clone()).toThrow(TypeError); expect(await chained.text()).toBe('body');
  });
  it.each(['host', 'deadline'] as const)('shares %s cancellation through original and chained cloned body readers', async cause => {
    vi.useFakeTimers(); const host = new AbortController(); const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel })));
    const response = await connector().fetch('/stream', { timeoutScope: 'operation', timeout: 20, signal: host.signal });
    const clone = response.clone(); const chained = clone.clone();
    const results = [response, clone, chained].map(r => r.arrayBuffer().catch(e => e)); await vi.advanceTimersByTimeAsync(0);
    if (cause === 'host') host.abort(new Error('cloned host stop')); else await vi.advanceTimersByTimeAsync(20);
    for (const result of await Promise.all(results)) expect(result.message).toContain(cause === 'host' ? 'cloned host stop' : 'timeout');
    expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels all tee branches once without creating independent operation timers', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const response = await connector().fetch('/stream', { timeoutScope: 'operation', timeout: 50 }); const clone = response.clone();
    expect(vi.getTimerCount()).toBe(1); await Promise.all([response.body!.cancel('one'), clone.body!.cancel('two')]);
    expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('operation body cancellation cleanup', () => {
  it('retains its deadline while native cancellation waits for an upstream tee branch', async () => {
    vi.useFakeTimers(); let close!: () => void;
    const upstream = new Response(new ReadableStream<Uint8Array>({ start(c) { close = () => c.close(); } }));
    fetchMock.mockResolvedValue(upstream.clone());
    const response = await connector().fetch('/body', { timeoutScope: 'operation', timeout: 20 });
    const cancelled = response.body!.cancel().catch(e => e); await vi.advanceTimersByTimeAsync(20);
    expect((await cancelled).name).toBe('TimeoutError'); expect(vi.getTimerCount()).toBe(0);
    close(); await upstream.text();
  });
});
