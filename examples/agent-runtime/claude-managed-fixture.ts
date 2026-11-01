import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import type { BetaManagedAgentsSession } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { BetaManagedAgentsAgent } from '@anthropic-ai/sdk/resources/beta/agents/agents';
import type { BetaEnvironment } from '@anthropic-ai/sdk/resources/beta/environments/environments';

/** Actual Anthropic SDK, synthetic managed resource/event HTTP responses. */
export function claudeManagedFixture(options: { budgetPause?: boolean; dropToolResult?: 'before' | 'after'; missingUsage?: boolean; pauseAfterTool?: boolean; dropEnvironmentCreation?: boolean; borrowedEnvironment?: boolean; artifacts?: boolean; foreignFile?: boolean; expiredFile?: boolean; dropFileUpload?: boolean; dropMount?: boolean } = {}) {
  let agent: BetaManagedAgentsAgent | undefined; let environment: BetaEnvironment | undefined; let session: BetaManagedAgentsSession | undefined;
  if (options.borrowedEnvironment) environment = { id: 'borrowed-environment', metadata: {}, config: { type: 'cloud', networking: { type: 'limited', allowed_hosts: [], allow_mcp_servers: false, allow_package_managers: false }, packages: { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], type: 'packages' } } } as unknown as BetaEnvironment;
  const files = new Map<string, { id: string; filename: string; mime_type: string; size_bytes: number; downloadable: boolean; created_at: string; type: 'file'; scope?: { type: 'session'; id: string }; expires_at?: string }>();
  let fileBytes = new Uint8Array(); let fileDropped = false;
  if (options.artifacts) files.set('native-file', { id: 'native-file', filename: 'answer.txt', mime_type: 'text/plain', size_bytes: 3, downloadable: true, type: 'file', created_at: 'offline', scope: { type: 'session', id: options.foreignFile ? 'foreign' : 'native-session' }, ...(options.expiredFile ? { expires_at: '2000-01-01T00:00:00Z' } : {}) });
  const history: BetaManagedAgentsSessionEvent[] = []; const channels = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder(); let serial = 0; let turn = 0; let dropped = false;
  const counts = { agents: 0, environments: 0, sessions: 0, inputs: 0, deliveries: 0, interrupts: 0, sessionDeletes: 0, agentArchives: 0, environmentDeletes: 0, eventPages: 0, streams: 0 };
  const authKeys: (string | null)[] = []; const bearerHeaders: (string | null)[] = []; const workspaceHeaders: (string | null)[] = []; const cookies: (string | null)[] = [];
  const requests: { method: string; path: string; body: Record<string,unknown> }[] = [];
  const publish = (data: Record<string,unknown>) => {
    const value = { id: `native-event-${++serial}`, processed_at: new Date(serial * 1000).toISOString(), ...data } as BetaManagedAgentsSessionEvent;
    history.push(value); for (const channel of channels) channel.enqueue(encoder.encode(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)); return value;
  };
  const close = () => { for (const channel of channels) channel.close(); channels.clear(); };
  const complete = () => {
    publish({ type: 'agent.message', content: [{ type: 'text', text: 'ACK' }] });
    session!.status = 'idle'; session!.usage = options.missingUsage ? {} : { input_tokens: turn * 5, output_tokens: turn, cache_read_input_tokens: 0 };
    publish({ type: 'session.status_idle', stop_reason: { type: 'end_turn' }, stop_details: null }); close();
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const page = (data: unknown[], next: string | null = null) => json({ data, next_page: next });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const pathname = url.pathname; const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string,unknown> : {};
    const headers = new Headers(init?.headers); authKeys.push(headers.get('x-api-key')); bearerHeaders.push(headers.get('authorization')); workspaceHeaders.push(headers.get('anthropic-workspace-id')); cookies.push(headers.get('cookie'));
    requests.push({ method, path: pathname, body });
    if (pathname === '/v1/files' && method === 'GET') return page([...files.values()].filter(file => !url.searchParams.get('scope_id') || !!file.scope));
    if (pathname === '/v1/files' && method === 'POST') {
      const form = init!.body as FormData; const file = form.get('file') as File;
      fileBytes = new Uint8Array(await file.arrayBuffer());
      const metadata = { id: 'uploaded-file', filename: file.name, mime_type: file.type, size_bytes: file.size, downloadable: true, type: 'file' as const, created_at: 'offline' };
      files.set(metadata.id, metadata);
      if (options.dropFileUpload && !fileDropped) { fileDropped = true; throw new TypeError('Synthetic upload response lost'); }
      return json(metadata);
    }
    if (/^\/v1\/files\/[^/]+$/.test(pathname) && method === 'GET') return json(files.get(pathname.split('/').at(-1)!));
    if (pathname.endsWith('/content') && pathname.startsWith('/v1/files/')) return new Response(pathname.includes('uploaded-file') ? fileBytes : 'ACK', { headers: { 'Content-Type': 'text/plain' } });
    if (pathname.startsWith('/v1/files/') && method === 'DELETE') { files.delete(pathname.split('/').at(-1)!); return json({ id: pathname.split('/').at(-1), type: 'file_deleted' }); }
    if (pathname === '/v1/sessions/native-session/resources' && method === 'POST') {
      const resource = { ...body, id: 'mounted-file', created_at: 'offline', updated_at: 'offline' }; (session!.resources as unknown[]).push(resource);
      if (options.dropMount) throw new TypeError('Synthetic mount response lost'); return json(resource);
    }
    if (pathname === '/v1/sessions/native-session/resources' && method === 'GET') return page(session!.resources);
    if (pathname === '/v1/agents' && method === 'POST') {
      counts.agents++;
      agent = { ...body, id: 'native-agent', type: 'agent', version: 1, archived_at: null, tools: (body.tools as Record<string,unknown>[]).map(tool => tool.type === 'agent_toolset_20260401' ? { ...tool, configs: tool.configs ?? [] } : tool) } as unknown as BetaManagedAgentsAgent;
      return json(agent);
    }
    if (pathname === '/v1/agents' && method === 'GET') return page(agent ? [agent] : []);
    if (pathname === '/v1/agents/native-agent' && method === 'GET') return json(agent);
    if (pathname === '/v1/agents/native-agent/archive') { counts.agentArchives++; agent!.archived_at = 'offline'; return json(agent); }
    if (pathname === '/v1/environments' && method === 'POST') {
      counts.environments++; environment = { ...body, id: 'native-environment', type: 'environment', archived_at: null } as unknown as BetaEnvironment; if (options.dropEnvironmentCreation) throw new TypeError('Synthetic environment creation response lost'); return json(environment);
    }
    if (pathname === '/v1/environments' && method === 'GET') return page(environment ? [environment] : []);
    if ((pathname === '/v1/environments/native-environment' || pathname === '/v1/environments/borrowed-environment') && method === 'GET') return json(environment);
    if (pathname === '/v1/environments/native-environment' && method === 'DELETE') { counts.environmentDeletes++; return json({ id: 'native-environment', type: 'environment_deleted' }); }
    if (pathname === '/v1/sessions' && method === 'POST') {
      counts.sessions++;
      session = { ...body, id: 'native-session', type: 'session', agent, status: 'idle', resources: [], vault_ids: [], usage: options.missingUsage ? {} : { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 } } as unknown as BetaManagedAgentsSession;
      return json(session);
    }
    if (pathname === '/v1/sessions' && method === 'GET') return page(session ? [session] : []);
    if (pathname === '/v1/sessions/native-session' && method === 'GET') return json(session);
    if (pathname === '/v1/sessions/native-session' && method === 'DELETE') { counts.sessionDeletes++; return json({ id: 'native-session', type: 'session_deleted' }); }
    if (pathname.endsWith('/events/stream') && method === 'GET') {
      counts.streams++; let own: ReadableStreamDefaultController<Uint8Array> | undefined;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { own = controller; channels.add(controller); }, cancel() { if (own) channels.delete(own); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (pathname.endsWith('/events') && method === 'GET') {
      counts.eventPages++;
      // Exercise PageCursor, whose continuation field is next_page, not has_more.
      const split = Math.max(1, Math.floor(history.length / 2));
      return url.searchParams.get('page') === 'second' ? page(history.slice(split)) : page(history.slice(0, split), history.length > split ? 'second' : null);
    }
    if (pathname.endsWith('/events') && method === 'POST') {
      const accepted: BetaManagedAgentsSessionEvent[] = [];
      for (const value of body.events as Record<string,unknown>[]) {
        if (value.type === 'user.message') {
          turn++; counts.inputs++; accepted.push(publish(value)); session!.status = 'running'; publish({ type: 'session.status_running' });
          if (options.budgetPause) { session!.status = 'idle'; publish({ type: 'session.status_idle', stop_reason: { type: 'budget_reached' }, stop_details: null }); }
          else { const call = publish({ type: 'agent.custom_tool_use', name: 'probe', input: {} }); session!.status = 'idle'; publish({ type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: [call.id] }, stop_details: null }); }
        }
        if (value.type === 'user.custom_tool_result') {
          counts.deliveries++;
          if (options.dropToolResult === 'before' && !dropped) { dropped = true; close(); throw new TypeError('Synthetic result response lost before acceptance'); }
          if (value.is_error !== false || !JSON.stringify(value.content).includes('businessValue')) throw new Error('Wrong custom tool-result shape');
          const duplicate = history.find(event => event.type === 'user.custom_tool_result' && event.custom_tool_use_id === value.custom_tool_use_id);
          if (!duplicate) accepted.push(publish(value));
          if (options.pauseAfterTool) session!.status = 'running'; else complete();
          if (options.dropToolResult === 'after' && !dropped) { dropped = true; throw new TypeError('Synthetic result response lost after acceptance'); }
        }
        if (value.type === 'user.interrupt') {
          counts.interrupts++; accepted.push(publish(value)); session!.status = 'idle'; publish({ type: 'session.status_idle', stop_reason: { type: 'end_turn' }, stop_details: null }); close();
        }
      }
      return json({ data: accepted });
    }
    throw new Error(`Unexpected offline Claude request ${method} ${pathname}`);
  };
  return { fetch: fetcher, counts, requests, authKeys, bearerHeaders, workspaceHeaders, cookies, complete, createClient: (clientOptions: ClientOptions) => new Anthropic({ ...clientOptions, fetch: fetcher }) };
}
