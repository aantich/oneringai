import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import type { AgentSession } from 'openai/resources/beta/agents/agents';
import type { Turn } from 'openai/resources/beta/agents/sessions/turns/turns';

/** Recorded-wire style fake HTTP server exercised through the actual OpenAI SDK. */
export function openAIManagedFixture(options: { dropFirstToolResult?: 'before' | 'after'; idleWithoutTerminal?: boolean; foreignMetadata?: boolean; dropContinuationInput?: boolean; pauseCompletion?: boolean; artifacts?: boolean; foreignArtifact?: boolean; dropInlineUpload?: boolean } = {}) {
  let session: AgentSession | undefined; let turn: Turn | undefined; let sequence = 0; let eventId = 0; let dropped = false;
  const channels = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const counts = { creations: 0, inputs: 0, toolDeliveries: 0, deletes: 0, cancels: 0, streams: 0, itemPages: 0 };
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const encoder = new TextEncoder();
  const event = (value: Record<string, unknown>) => ({ event_id: `event-${++eventId}`, session_id: 'native-session', ...value });
  const publish = (value: Record<string, unknown>) => { const data = encoder.encode(`data: ${JSON.stringify(event(value))}\n\n`); for (const channel of channels) channel.enqueue(data); };
  const close = () => { for (const channel of channels) channel.close(); channels.clear(); };
  const stream = (creation: boolean): Response => {
    counts.streams++;
    let ownController: ReadableStreamDefaultController<Uint8Array> | undefined;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      ownController = controller; channels.add(controller);
      const push = (data: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event(data))}\n\n`));
      if (options.idleWithoutTerminal) { session!.status = 'idle'; session!.required_actions = []; if (turn) turn.status = 'in_progress'; }
      if (creation) push({ type: 'agent.session.created', session });
      if (turn && creation) { push({ type: 'agent.session.turn.created', turn_id: turn.id, turn }); push({ type: 'agent.session.requires_action' }); }
      else push({ type: 'agent.session.idle', session });
      if (options.idleWithoutTerminal) { controller.close(); channels.delete(controller); }
    }, cancel() { if (ownController) channels.delete(ownController); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const list = (data: unknown[], more = false) => json({ object: 'list', data, has_more: more, first_id: (data[0] as { id?: string } | undefined)?.id ?? null, last_id: (data.at(-1) as { id?: string } | undefined)?.id ?? null });
  const startTurn = () => {
    sequence++; counts.inputs++;
    turn = { id: `turn-${sequence}`, agent_id: 'inline-agent', completed_at: null, created_at: sequence, error: null, object: 'agent.session.turn', session_id: 'native-session', started_at: sequence, status: 'waiting', subagent_id: null, usage: null };
    session!.status = 'requires_action'; session!.required_actions = [{ type: 'function_call', name: 'probe', arguments: {}, call_id: `call-${sequence}`, turn_id: turn.id }];
  };
  const complete = () => {
    turn!.status = 'completed'; session!.status = 'idle'; session!.required_actions = [];
    turn!.usage = { input_tokens: 5, output_tokens: 1, total_tokens: 6, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
    publish({ type: 'agent.session.turn.output_text.done', turn_id: turn!.id, item_id: `answer-${sequence}`, content_index: 0, output_index: 0, text: 'ACK' });
    publish({ type: 'agent.session.turn.completed', turn_id: turn!.id, turn, usage: turn!.usage }); close();
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    const pathname = url.pathname.replace(/^\/v1/, ''); requests.push({ method, path: pathname, body });
    const artifact = { id: 'artifact-1', session_id: options.foreignArtifact ? 'foreign' : 'native-session', turn_id: turn?.id, size_bytes: 3, path: '/workspace/answer.txt', environment_id: 'native-environment', object: 'agent.session.artifact', created_at: 1 };
    if (pathname === '/agents/sessions/native-session/artifacts') return list(options.artifacts ? [artifact] : []);
    if (pathname === '/agents/sessions/native-session/artifacts/artifact-1') return json(artifact);
    if (pathname === '/agents/sessions/native-session/artifacts/artifact-1/content') return new Response('ACK', { headers: { 'Content-Type': 'text/plain' } });
    if (pathname === '/agents/environments/native-environment/files' && method === 'POST') { if (options.dropInlineUpload) throw new TypeError('Synthetic inline upload response lost'); return json({ object: 'agent.environment.file', environment_id: 'native-environment', path: body.path, size_bytes: Buffer.from(String(body.data), 'base64').byteLength }); }
    if (pathname === '/agents/sessions' && method === 'POST') {
      counts.creations++;
      const agent = body.agent as AgentSession['agent'];
      session = { id: 'native-session', agent, metadata: { ...(body.metadata as Record<string,string>), ...(options.foreignMetadata ? { onering_scope: 'foreign' } : {}) }, status: 'idle', required_actions: [], created_at: 1, last_active_at: 1, object: 'agent.session', environment: (body.environment as { type: string }).type === 'openai_hosted' ? { ...body.environment as object, id: 'native-environment', network: { access: 'disabled' } } : { type: 'none' }, error: null, usage: null, vault_ids: [] } as AgentSession;
      startTurn(); return stream(true);
    }
    if (pathname === '/agents/sessions' && method === 'GET') return list(session ? [session] : []);
    if (pathname === '/agents/sessions/native-session' && method === 'GET') return json(session);
    if (pathname === '/agents/sessions/native-session' && method === 'POST') { Object.assign(session!.agent, body.agent); return json(session); }
    if (pathname === '/agents/sessions/native-session' && method === 'DELETE') { counts.deletes++; return json({ id: 'native-session', object: 'agent.session.deleted', deleted: true }); }
    if (pathname.endsWith('/events') && method === 'GET') return stream(false);
    if (pathname.endsWith('/events') && method === 'POST') {
      for (const sent of body.events as Record<string,unknown>[]) {
        if (sent.type === 'agent.session.input.message') { if (options.dropContinuationInput) { close(); throw new TypeError('Synthetic input response lost before acceptance'); } startTurn(); publish({ type: 'agent.session.turn.created', turn_id: turn!.id, turn }); publish({ type: 'agent.session.requires_action' }); }
        if (sent.type === 'agent.session.input.cancel') { counts.cancels++; if (!options.idleWithoutTerminal) { turn!.status = 'cancelled'; session!.status = 'idle'; publish({ type: 'agent.session.turn.cancelled', turn_id: turn!.id, turn, usage: null }); close(); } }
        if (sent.type === 'agent.session.input.tool_result') {
          counts.toolDeliveries++;
          if (options.dropFirstToolResult === 'before' && !dropped) { dropped = true; close(); throw new TypeError('Synthetic response lost before acceptance'); }
          if (sent.call_id !== `call-${sequence}` || sent.turn_id !== turn!.id || sent.success !== true || !String(sent.output).includes('businessValue')) throw new Error('Unexpected native tool-result shape');
          if (options.pauseCompletion) { turn!.status = 'in_progress'; session!.status = 'in_progress'; session!.required_actions = []; } else complete();
          if (options.dropFirstToolResult === 'after' && !dropped) { dropped = true; throw new TypeError('Synthetic response lost after acceptance'); }
        }
      }
      return new Response(null, { status: 202 });
    }
    if (pathname.endsWith('/turns') && method === 'GET') return list(turn ? [turn] : []);
    if (/\/turns\/turn-\d+$/.test(pathname)) return json(turn);
    if (pathname.endsWith('/items')) {
      counts.itemPages++;
      const after = url.searchParams.get('after');
      if (!after) return list([{ id: `commentary-${sequence}`, type: 'message', role: 'assistant', phase: 'commentary', status: 'completed', turn_id: turn!.id, content: [{ type: 'output_text', text: 'Working' }] }], true);
      return list([{ id: `answer-${sequence}`, type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', turn_id: turn!.id, content: [{ type: 'output_text', text: 'ACK' }] }]);
    }
    throw new Error(`Unexpected offline OpenAI request ${method} ${pathname}`);
  };
  return { fetch: fetcher, counts, requests, complete, createClient: (clientOptions: ClientOptions) => new OpenAI({ ...clientOptions, fetch: fetcher }) };
}
