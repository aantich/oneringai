// Reusable SDK seam proof. Explicit closures own transport before SDK signals
// are combined. No ambient current invocation or global fetch patch is used.
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

function check(condition, message) { if (!condition) throw new Error(message); }
const rawOpenAI = {
  id: 'resp_fixture', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed',
  output: [{ type: 'message', id: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'verified', annotations: [] }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};
const anthropicEvents = [
  ['message_start', { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'verified' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
  ['message_stop', { type: 'message_stop' }],
];
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const sse = events => new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

export async function probeTransport() {
  const requests = [], signals = new Map(), attempts = new Map();
  let credentials = 0;
  const createFetch = owner => async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const payload = JSON.parse(String(init?.body ?? (request ? await request.clone().text() : '{}')));
    const signal = init?.signal ?? request?.signal;
    check(!signal?.aborted, 'Unexpected aborted request');
    requests.push({ owner, model: payload.model, rewrittenSignal: signal !== signals.get(owner) });
    const count = (attempts.get(owner) ?? 0) + 1; attempts.set(owner, count);
    if (owner === 'openai-a' && count === 1) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } });
    if (owner.startsWith('openai')) return payload.stream ? sse([['response.completed', { type: 'response.completed', response: rawOpenAI }]]) : json(rawOpenAI);
    if (owner.startsWith('anthropic')) return sse(anthropicEvents);
    if (owner.startsWith('google')) return json({ candidates: [{ content: { role: 'model', parts: [{ text: 'verified' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
    return json({ input_tokens: 12 });
  };
  const baselineFetch = createFetch('auxiliary');
  const openai = new OpenAI({ apiKey: async () => { credentials++; await Promise.resolve(); return 'offline-fixture'; }, fetch: baselineFetch, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const anthropic = new Anthropic({ apiKey: 'offline-fixture', fetch: baselineFetch, dangerouslyAllowBrowser: true, maxRetries: 0 });
  const operations = ['openai-a', 'openai-b', 'anthropic-a', 'anthropic-b', 'google-a', 'google-b'].map(async owner => {
    const signal = new AbortController().signal;
    signals.set(owner, signal);
    // Capture the private operation binding before entering the SDK.
    const ownedFetch = createFetch(owner);
    await Promise.resolve();
    if (owner.startsWith('openai')) {
      const client = openai.withOptions({ fetch: ownedFetch });
      if (owner.endsWith('-b')) {
        const stream = await client.responses.create({ model: 'gpt-4o-mini', input: 'fixture', stream: true }, { signal });
        let observed = false;
        for await (const event of stream) observed ||= event.type === 'response.completed';
        check(observed, 'OpenAI lazy stream lost completion');
      } else check((await client.responses.create({ model: 'gpt-4o-mini', input: 'fixture' }, { signal })).output_text === 'verified', 'OpenAI response mismatch');
    } else if (owner.startsWith('anthropic')) {
      const client = anthropic.withOptions({ fetch: ownedFetch });
      const stream = client.messages.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 16 }, { signal });
      check((await stream.finalMessage()).content[0].text === 'verified', 'Anthropic stream mismatch');
    } else {
      const client = new GoogleGenAI({ apiKey: 'offline-fixture', httpOptions: { fetch: ownedFetch } });
      const result = await client.models.generateContent({ model: 'gemini-2.5-flash', contents: 'fixture', config: { abortSignal: signal } });
      check(result.text === 'verified', 'Google response mismatch');
    }
  });
  await Promise.all(operations);
  const count = await openai.responses.inputTokens.count({ model: 'gpt-4o-mini', input: 'fixture' });
  check(count.input_tokens === 12, 'Unbound auxiliary request changed');
  check(requests.length === 8, 'Unexpected retry/ownership count');
  check(attempts.get('openai-a') === 2 && attempts.get('auxiliary') === 1, 'Retry or unbound request acquired the wrong owner');
  for (const [owner, count] of attempts) if (!['openai-a', 'auxiliary'].includes(owner)) check(count === 1, 'Concurrent owner changed');
  check(credentials >= 3, 'Rotating credential callback was not retained');
  check(requests.some(value => value.owner !== 'auxiliary' && value.rewrittenSignal), 'SDK signal rewrite was not exercised');
  return { status: 'pass', requests, credentials, scope: 'actual SDK closure/retry/concurrency/stream seams; not the ModelTask ledger' };
}
