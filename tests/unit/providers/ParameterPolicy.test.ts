import { afterEach, describe, it, expect, vi } from 'vitest';
import { OpenAITextProvider } from '@/infrastructure/providers/openai/OpenAITextProvider.js';
import { applyOpenAIParameterPolicy } from '@/infrastructure/providers/openai/parameterPolicy.js';
import { assessModelParameters, Agent, Connector, Vendor, exportAgentPackage } from '@/index.js';
import type { TextGenerateOptions } from '@/index.js';
const agents: Agent[] = [];
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); Connector.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function transport() {
  const requests: Array<{ url: string; body: any }> = [], batchBodies: any[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/files')) {
      const form = input instanceof Request ? await input.clone().formData() : init?.body as FormData;
      const file = form.get('file') as File; batchBodies.push(...(await file.text()).trim().split('\n').map(line => JSON.parse(line).body));
      return Response.json({ id: 'file-input', object: 'file', purpose: 'batch' });
    }
    const body = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body)); requests.push({ url, body });
    if (url.includes('input_tokens')) return Response.json({ input_tokens: 12 });
    if (url.endsWith('/batches')) return Response.json({ id: 'batch-id', status: 'validating', endpoint: '/v1/responses', input_file_id: 'file-input', completion_window: '24h', created_at: 1 });
    const result = { id: 'response', object: 'response', status: 'completed', model: body.model, output: [{ type: 'message', id: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } };
    return body.stream ? new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(result);
  }); vi.stubGlobal('fetch', fetch); return { requests, batchBodies, fetch };
}
const request = (extra: Partial<TextGenerateOptions> = {}): TextGenerateOptions => ({ model: 'gpt-6-sol', input: 'offline', temperature: 0, ...extra });
const selected = { temperature: 'omit-unsupported' as const };
const provider = () => new OpenAITextProvider({ apiKey: 'offline-fixture', maxRetries: 0 });
describe('selected provider-neutral temperature policy over actual request builders', () => {
  it.each(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-terra'])('assesses default/high reasoning for %s', model => { expect(assessModelParameters({ vendor: Vendor.OpenAI, model, endpoint: 'responses' }).temperature.support).toBe('unsupported'); expect(assessModelParameters({ vendor: Vendor.OpenAI, model, endpoint: 'chat-completions', reasoningEffort: 'high' }).temperature.support).toBe('unsupported'); });
  it.each(['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-terra'])('preserves conditional zero at none for %s', model => { expect(assessModelParameters({ vendor: Vendor.OpenAI, model, endpoint: 'responses', reasoningEffort: 'none' }).temperature.support).toBe('supported'); });
  it.each(['gpt-6-astra', 'gpt-6.1-sol'])('does not accept invalid none for %s', model => { expect(assessModelParameters({ vendor: Vendor.OpenAI, model, endpoint: 'responses', reasoningEffort: 'none' }).reasoningEffort).toBe('unsupported'); });
  it.each(['generation', 'stream', 'count', 'batch'] as const)('%s preserves legacy strict/count behavior and applies explicit omission to actual bodies', async surface => {
    const t = transport(), p = provider();
    const call = async (options: TextGenerateOptions) => { if (surface === 'generation') return p.generate(options); if (surface === 'stream') { for await (const _ of p.streamGenerate(options)) { /* consume */ } return; } if (surface === 'count') return p.compaction.countInput(options); return p.submitBatch([{ customId: 'one', options }], { dataHandling: { allowBatchRetention: true } }); };
    if (surface === 'count') { expect(await call(request())).toBe(12); expect(t.requests.at(-1)?.body).not.toHaveProperty('temperature'); } else await expect(call(request())).rejects.toThrow(/does not support temperature/);
    t.fetch.mockClear(); t.requests.length = 0;
    await expect(call(request({ parameterPolicy: { temperature: 'strict' } }))).rejects.toThrow(/does not support temperature/); expect(t.fetch).not.toHaveBeenCalled();
    const input = request({ parameterPolicy: selected }), original = JSON.stringify(input); await call(input); expect(JSON.stringify(input)).toBe(original);
    const body = surface === 'batch' ? t.batchBodies.at(-1) : t.requests.at(-1)?.body; expect(body).not.toHaveProperty('temperature'); expect(body).not.toHaveProperty('parameterPolicy');
    const before = t.fetch.mock.calls.length; await expect(call(request({ parameterPolicy: selected, vendorOptions: { temperature: 0 } }))).rejects.toThrow(/explicit vendorOptions.temperature/); expect(t.fetch).toHaveBeenCalledTimes(before);
  });
  it.each(['generation', 'stream', 'count', 'batch'] as const)('%s preserves zero with actual none reasoning and keeps explicit unsupported raw controls strict', async surface => {
    const t = transport(), p = provider(), options = request({ parameterPolicy: selected, thinking: { enabled: true, effort: 'none' } });
    const call = async (o: TextGenerateOptions) => surface === 'count' ? p.compaction.countInput(o) : surface === 'batch' ? p.submitBatch([{ customId: 'one', options: o }], { dataHandling: { allowBatchRetention: true } }) : surface === 'stream' ? (async () => { for await (const _ of p.streamGenerate(o)) { /* consume */ } })() : p.generate(o);
    await call(options); const body = surface === 'batch' ? t.batchBodies.at(-1) : t.requests.at(-1)?.body; expect(body.reasoning.effort).toBe('none'); if (surface !== 'count') expect(body.temperature).toBe(0);
    const before = t.fetch.mock.calls.length; await expect(call(request({ parameterPolicy: selected, vendorOptions: { top_p: 0.5 } }))).rejects.toThrow(/top_p/); expect(t.fetch).toHaveBeenCalledTimes(before);
  });
  it('uses effective unified/raw reasoning precedence and preserves unknown/custom values and absence', () => {
    expect(applyOpenAIParameterPolicy(request({ parameterPolicy: selected, thinking: { enabled: true, effort: 'none' }, vendorOptions: { reasoning: { effort: 'high' } } }), 'openai').temperature).toBe(0);
    expect(applyOpenAIParameterPolicy(request({ parameterPolicy: selected, thinking: { enabled: false, effort: 'none' }, vendorOptions: { reasoning: { effort: 'high' } } }), 'openai').temperature).toBeUndefined();
    const unknown = request({ model: 'private-model', parameterPolicy: selected }); expect(applyOpenAIParameterPolicy(unknown, 'openai')).toBe(unknown);
    expect(applyOpenAIParameterPolicy(request({ parameterPolicy: selected }), 'custom').temperature).toBe(0);
    expect(applyOpenAIParameterPolicy(request({ parameterPolicy: selected }), 'openai', 'https://gateway.example/v1').temperature).toBe(0);
    expect(applyOpenAIParameterPolicy({ model: 'gpt-6-sol', input: '', parameterPolicy: selected }, 'openai')).not.toHaveProperty('temperature');
  });
  it('isolates bounded observer failures and never sends policy callbacks over the wire', async () => {
    const t = transport(), observe = vi.fn(async () => { throw new Error('observer rejected'); });
    await provider().generate(request({ parameterPolicy: { ...selected, observe } })); await new Promise(resolve => setImmediate(resolve)); expect(observe).toHaveBeenCalledWith(expect.objectContaining({ action: 'omit', model: 'gpt-6-sol', effectiveReasoningEffort: 'medium' })); expect(JSON.stringify(t.requests[0]?.body)).not.toContain('observe'); expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['run', 'stream', 'direct', 'streamDirect'] as const)('%s applies config/per-call policy to the actual selected model and omits it from portable v2', async surface => {
    const t = transport(); Connector.create({ name: 'policy', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
    const agent = Agent.create({ connector: 'policy', model: 'gpt-4o-mini', temperature: 0, parameterPolicy: selected, thinking: { enabled: true, effort: 'high' }, modelExecution: { routing: { routes: { reasoning: { model: 'gpt-6-sol' } }, select: () => 'reasoning' } }, context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } } }); agents.push(agent); expect(exportAgentPackage(agent).agent.runtime).not.toHaveProperty('parameterPolicy');
    if (surface === 'run') await agent.run('x'); else if (surface === 'stream') for await (const _ of agent.stream('x')) { /* consume */ }
    else if (surface === 'direct') await agent.runDirect('x', { temperature: 0 }); else for await (const _ of agent.streamDirect('x', { temperature: 0 })) { /* consume */ }
    const body = t.requests.at(-1)!.body; if (surface === 'run' || surface === 'stream') { expect(body.model).toBe('gpt-6-sol'); expect(body).not.toHaveProperty('temperature'); } else expect(body.temperature).toBe(0);
    const before = t.fetch.mock.calls.length; if (surface === 'run' || surface === 'stream') { const strict = { parameterPolicy: { temperature: 'strict' as const } }; const call = surface === 'run' ? agent.run('x', strict) : (async () => { for await (const _ of agent.stream('x', strict)) { /* consume */ } })(); await expect(call).rejects.toThrow(/temperature/); expect(t.fetch).toHaveBeenCalledTimes(before); }
    expect(agent.getRuntimeConfigSnapshot().parameterPolicy?.temperature).toBe('omit-unsupported');
  });
  it('assesses selector fallback after the final route/model choice instead of the failed proposal', async () => {
    const t = transport(); Connector.create({ name: 'fallback-policy', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
    const agent = Agent.create({ connector: 'fallback-policy', model: 'gpt-4o-mini', temperature: 0, parameterPolicy: selected,
      modelExecution: { routing: { routes: { reasoning: { model: 'gpt-6-sol' } }, select: () => { throw new Error('selector unavailable'); }, fallback: 'default' } },
      context: { model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } } }); agents.push(agent);
    await agent.run('x'); expect(t.requests.at(-1)?.body).toMatchObject({ model: 'gpt-4o-mini', temperature: 0 });
  });
  it('keeps invalid reasoning strict even when the temperature field was selected for omission', async () => {
    const t = transport(); await expect(provider().generate(request({ model: 'gpt-6-astra', parameterPolicy: selected, thinking: { enabled: true, effort: 'none' } }))).rejects.toThrow(/does not support reasoning effort/); expect(t.fetch).not.toHaveBeenCalled();
  });

  it('applies selected known constraints to Terra and unregistered Astra snapshots without changing legacy scope', async () => {
    const t = transport(); await expect(provider().generate(request({ model: 'gpt-6.1-terra', parameterPolicy: selected, vendorOptions: { top_p: 0.4 } }))).rejects.toThrow(/top_p/);
    await expect(provider().generate(request({ model: 'gpt-6-astra-future-snapshot', parameterPolicy: selected, thinking: { enabled: true, effort: 'none' } }))).rejects.toThrow(/reasoning effort/); expect(t.fetch).not.toHaveBeenCalled();
  });

  it('respects the latest native configuration effort without rewriting the cached request prefix', async () => {
    const t = transport(), options = request({ parameterPolicy: selected, thinking: { enabled: true, effort: 'none' }, input: [{ type: 'configuration_update', reasoning: { effort: 'high' } }] });
    await provider().generate(options); expect(t.requests[0]!.body.reasoning.effort).toBe('none'); expect(t.requests[0]!.body.input.at(-1).reasoning.effort).toBe('high'); expect(t.requests[0]!.body).not.toHaveProperty('temperature');
    const before = t.fetch.mock.calls.length; await expect(provider().generate({ ...options, vendorOptions: { top_p: 0.5 } })).rejects.toThrow(/top_p/); expect(t.fetch).toHaveBeenCalledTimes(before);
  });

  it.each(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-terra'].flatMap(model => ['none', 'low', 'medium', 'high', 'xhigh', 'max'].map(effort => ({ model, effort }))))('projects the documented selected generation pair $model / $effort', async ({ model, effort }) => {
    const t = transport(), options = request({ model, parameterPolicy: selected, thinking: { enabled: true, effort: effort as any } });
    if (effort === 'none' && ['gpt-6-astra', 'gpt-6.1-sol'].includes(model)) { await expect(provider().generate(options)).rejects.toThrow(/reasoning effort/); expect(t.fetch).not.toHaveBeenCalled(); }
    else { await provider().generate(options); expect(t.requests[0]!.body.reasoning.effort).toBe(effort); if (effort === 'none') expect(t.requests[0]!.body.temperature).toBe(0); else expect(t.requests[0]!.body).not.toHaveProperty('temperature'); }
  });

});
