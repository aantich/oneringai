import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connector, ConnectorTools, ToolManager, AgentContextNextGen, InMemoryEvidenceStorage } from '@/index.js';
import type { Agent, ConnectorPage, ToolFunction } from '@/index.js';
import { ToolCatalogPluginNextGen } from '@/core/context-nextgen/plugins/ToolCatalogPluginNextGen.js';
import { acquireComposition } from '@/core/execution/composition.js';
import { fixture } from './routing/fixture.js';

const managers: ToolManager[] = [], agents: Agent[] = [], contexts: AgentContextNextGen[] = [];
const families = [
  { service: 'microsoft', baseURL: 'https://graph.microsoft.com/v1.0', count: 12, pages: 3 },
  { service: 'google-api', baseURL: 'https://www.googleapis.com', count: 12, pages: 3 },
  { service: 'slack', baseURL: 'https://slack.com/api', count: 11, pages: 6 },
  { service: 'github', baseURL: 'https://api.github.com', count: 9, pages: 5 },
];
function connector(family = families[2]!, name = 'collection') { return Connector.create({ name, serviceType: family.service, baseURL: family.baseURL, auth: { type: 'api_key', apiKey: 'synthetic-collection-key' }, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 } }); }
function selected(accountId?: string, name = 'collection') { return ConnectorTools.enhanced(name, { profile: 'collections-v1', ...(accountId ? { accountId } : {}) }); }
function manager(tools: ToolFunction[] = selected(), name = 'collection', accountId?: string) { const value = new ToolManager(); managers.push(value); value.registerConnectorTools(name, tools, { accountId }); return value; }
const json = (value: unknown, headers?: Record<string, string>, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const page = async (value: ToolManager, name: string, args: unknown = {}): Promise<ConnectorPage<any>> => { const report = await value.executeWithOutcome(name, args); expect(report.outcome.status, JSON.stringify(report.result)).toBe('succeeded'); return report.result; };
afterEach(() => { agents.splice(0).forEach(a => a.destroy()); contexts.splice(0).forEach(c => c.destroy()); managers.splice(0).forEach(m => m.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); Connector.setRegistry(null); Connector.clear(); ConnectorTools.clearCache(); });

describe('fixed collections profile and exact stable traversal', () => {
  it.each(families)('$service replaces only affected variants and preserves frozen old/execution-v1 contracts', family => {
    connector(family); const old = ConnectorTools.for('collection'), exec = ConnectorTools.enhanced('collection', { profile: 'execution-v1' });
    const before = JSON.stringify([old.map(t => t.definition), exec.map(t => t.definition)]), tools = selected();
    expect(tools).toHaveLength(family.count); expect(tools.filter(t => t.definition.function.name.endsWith('_page'))).toHaveLength(family.pages);
    expect(tools.filter(t => t.definition.function.name.endsWith('_strict'))).toHaveLength(family.service === 'slack' ? 1 : 0);
    expect(JSON.stringify([old.map(t => t.definition), exec.map(t => t.definition)])).toBe(before);
    const value = manager(tools); expect(value.getEnabledRegistrations().every(reg => reg.source === 'connector:collection')).toBe(true);
    expect(() => value.registerConnectorTools('collection', exec)).toThrow(/one enhanced profile/);
    expect(value.list()).toEqual(tools.map(t => t.definition.function.name));
  });
  it('traverses fourteen provider pages without prefix loss, including over-return and an empty intermediate page', async () => {
    connector(); const expected: string[] = [], seen: string[] = [], positions = new Set<string>(); let dispatches = 0;
    const fetch = vi.fn(async input => {
      const url = new URL(String(input)), number = Number(url.searchParams.get('cursor') ?? 0); dispatches++;
      const items = number === 5 ? [] : Array.from({ length: number === 13 ? 1 : 4 }, (_, i) => ({ id: `${number}:${i}`, name: `channel-${number}-${i}`, untouched: { detail: i } }));
      expected.push(...items.map(item => item.id));
      return json({ ok: true, channels: items, response_metadata: { next_cursor: number === 13 ? '' : String(number + 1) } });
    }); vi.stubGlobal('fetch', fetch); const value = manager(); let continuation: string | undefined;
    do {
      const result = await page(value, 'collection_list_channels_page', { pageSize: 2, ...(continuation ? { continuation } : {}) });
      expect(result.returnedCount).toBe(result.items.length); seen.push(...result.items.map(item => item.id)); expect(result.searchCoverage).toBe('complete');
      expect(result.reportedTotal).toBeUndefined();
      if (result.position.state === 'more') { expect(positions.has(result.position.positionId)).toBe(false); positions.add(result.position.positionId); continuation = result.position.continuation; }
      else { expect(result.position.state).toBe('end'); continuation = undefined; }
    } while (continuation);
    expect(dispatches).toBe(14); expect(seen).toEqual(expected); expect(new Set(seen).size).toBe(49); expect(fetch).toHaveBeenCalledTimes(14);
  });
  it('does not infer exhaustion from full/empty counts or a provider more flag without a cursor', async () => {
    connector(); const value = manager(); vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, messages: [], has_more: true })));
    const result = await value.executeWithOutcome('collection_get_thread_page', { channel: 'C1', ts: '1.0' });
    expect(result.outcome.status).toBe('failed'); expect(result.result).toMatchObject({ items: [], returnedCount: 0, position: { state: 'unknown', reason: 'provider_more_without_usable_cursor' }, observedPage: { body: { has_more: true } } });
  });
  it('keeps every thread parent/reply and the provider continuation, without inventing reply counts', async () => {
    connector(); const value = manager(); vi.stubGlobal('fetch', vi.fn(async input => new URL(String(input)).searchParams.has('cursor')
      ? json({ ok: true, messages: [{ ts: '2', text: 'reply two' }], has_more: false, response_metadata: { next_cursor: '' } })
      : json({ ok: true, messages: [{ ts: '0', text: 'parent', reply_count: 2 }, { ts: '1', text: 'reply one' }], has_more: true, response_metadata: { next_cursor: 'thread-position' } })));
    const first = await page(value, 'collection_get_thread_page', { channel: 'C1', ts: '0', pageSize: 1 }); expect(first.items.map(i => i.ts)).toEqual(['0', '1']);
    expect(first.position.state).toBe('more'); const second = await page(value, 'collection_get_thread_page', { channel: 'C1', ts: '0', pageSize: 1, continuation: (first.position as { continuation: string }).continuation });
    expect(second.items.map(i => i.ts)).toEqual(['2']); expect(second.returnedCount).toBe(1); expect(second.position.state).toBe('end');
  });
  it('makes repeated provider positions detectable independently of randomized envelopes', async () => {
    connector(); vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, channels: [{ id: 'same' }], response_metadata: { next_cursor: 'repeated' } })));
    const value = manager(), first = await page(value, 'collection_list_channels_page');
    const second = await page(value, 'collection_list_channels_page', { continuation: (first.position as any).continuation });
    expect((second.position as any).positionId).toBe((first.position as any).positionId); expect((second.position as any).continuation).not.toBe((first.position as any).continuation);
  });
});

describe('provider page contracts', () => {
  it.each([
    [0, 'list_files', {}, { value: [{ id: 'one', extra: true }, { id: 'two' }] }],
    [0, 'search_files', { query: 'report' }, { value: [{ hitsContainers: [{ hits: [{ hitId: 'one' }, { hitId: 'two' }], total: 2, moreResultsAvailable: false }] }] }],
    [0, 'list_meetings', { startDateTime: '2026-10-01', endDateTime: '2026-10-02' }, { value: [{ id: 'one' }, { id: 'two' }] }],
    [1, 'list_files', {}, { files: [{ id: 'one' }, { id: 'two' }], incompleteSearch: false }],
    [1, 'search_files', { query: 'report' }, { files: [{ id: 'one' }, { id: 'two' }], incompleteSearch: false }],
    [1, 'list_meetings', { startDateTime: '2026-10-01T00:00:00Z', endDateTime: '2026-10-02T00:00:00Z' }, { items: [{ id: 'one' }, { id: 'two' }] }],
    [2, 'list_channels', {}, { ok: true, channels: [{ id: 'one' }, { id: 'two' }], response_metadata: { next_cursor: '' } }],
    [2, 'get_messages', { channel: 'C1' }, { ok: true, messages: [{ ts: 'one' }, { ts: 'two' }], has_more: false }],
    [2, 'get_thread', { channel: 'C1', ts: 'parent' }, { ok: true, messages: [{ ts: 'one' }, { ts: 'two' }], has_more: false }],
    [2, 'get_users', {}, { ok: true, members: [{ id: 'one' }, { id: 'two' }], response_metadata: { next_cursor: '' } }],
    [2, 'search_messages', { query: 'report' }, { ok: true, messages: { matches: [{ ts: 'one' }, { ts: 'two' }], total: 2, paging: { page: 1, pages: 1 } } }],
    [2, 'get_mentions', {}, { ok: true, messages: { matches: [{ ts: 'one' }, { ts: 'two' }], total: 2, pagination: { page: 1, page_count: 1 } } }],
    [3, 'search_files', { repository: 'o/r', pattern: '**/*.ts', ref: 'main' }, { tree: [{ type: 'blob', path: 'src/one.ts' }, { type: 'blob', path: 'src/two.ts' }], truncated: false }],
    [3, 'search_code', { repository: 'o/r', query: 'report' }, { items: [{ path: 'one' }, { path: 'two' }], total_count: 2, incomplete_results: false }],
    [3, 'list_branches', { repository: 'o/r' }, [{ name: 'one' }, { name: 'two' }]],
    [3, 'pr_files', { repository: 'o/r', pull_number: 1 }, [{ filename: 'one' }, { filename: 'two' }]],
    [3, 'pr_comments', { repository: 'o/r', pull_number: 1 }, [{ id: 'one' }, { id: 'two' }]],
  ] as const)('family %s/%s fetches exactly one logical page and returns its whole allowed array', async (family, operation, args, body) => {
    connector(families[family]); const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async input => { calls.push(String(input)); return String(input).endsWith('/auth.test') ? json({ ok: true, user_id: 'SELF' }) : json(body); }));
    const result = await page(manager(), `collection_${operation}_page`, { ...args, pageSize: 1 }); expect(result.returnedCount).toBe(2); expect(result.position.state).toBe('end'); expect(calls.filter(url => !url.endsWith('/auth.test'))).toHaveLength(1); expect(calls).toHaveLength(operation === 'get_mentions' ? 2 : 1);
  });
  it('retains exact Graph nextLink and reapplies required timezone headers to an empty later page', async () => {
    connector(families[0]); const next = 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=a%2B%2F%3D&opaque=%2525'; const requests: Array<{ url: string; prefer: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => { requests.push({ url: String(input), prefer: new Headers(init.headers).get('Prefer') }); return requests.length === 1 ? json({ value: [{ id: 'event' }], '@odata.nextLink': next, '@odata.count': 11 }) : json({ value: [] }); }));
    const value = manager(), args = { startDateTime: '2026-10-01T00:00:00Z', endDateTime: '2026-10-02T00:00:00Z', timeZone: 'Europe/Zurich' };
    const first = await page(value, 'collection_list_meetings_page', args), second = await page(value, 'collection_list_meetings_page', { ...args, continuation: (first.position as any).continuation });
    expect(first.reportedTotal).toBe(11); expect(requests[1]).toEqual({ url: next, prefer: 'outlook.timezone="Europe/Zurich"' }); expect(second.position.state).toBe('end'); expect(second.items).toEqual([]);
  });
  it.each(['https://untrusted.example.test/v1.0/me/drive/root/children?x=1', 'https://graph.microsoft.com/v1.0/users/other/drive/root/children?x=1', null])('retains the observed Graph page and fails on invalid provider position %s', async next => {
    connector(families[0]); const fetch = vi.fn(async () => json({ value: [{ id: 'keep-source', content: 'body' }], '@odata.nextLink': next })); vi.stubGlobal('fetch', fetch);
    const result = await manager().executeWithOutcome('collection_list_files_page', {}); expect(result.outcome.status).toBe('failed'); expect(result.result).toMatchObject({ items: [{ id: 'keep-source' }], position: { state: 'unknown' }, observedPage: { body: { value: [{ id: 'keep-source', content: 'body' }] } } }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('carries incomplete Drive search through an empty intermediate and final complete page', async () => {
    connector(families[1]); let n = 0; vi.stubGlobal('fetch', vi.fn(async () => json(++n === 1 ? { files: [{ id: 'a' }], incompleteSearch: true, nextPageToken: 'two' } : n === 2 ? { files: [], incompleteSearch: false, nextPageToken: 'three' } : { files: [{ id: 'z' }], incompleteSearch: false })));
    const value = manager(); let continuation: string | undefined; const ids: string[] = [];
    for (let i = 0; i < 3; i++) { const result = await page(value, 'collection_search_files_page', { query: "Bob's report", ...(continuation ? { continuation } : {}) }); expect(result.searchCoverage).toBe('incomplete'); ids.push(...result.items.map(i => i.id)); continuation = result.position.state === 'more' ? result.position.continuation : undefined; }
    expect(continuation).toBeUndefined(); expect(ids).toEqual(['a', 'z']);
  });
  it.each([false, undefined])('keeps Drive missing/false coverage explicit (%s)', async flag => {
    connector(families[1]); vi.stubGlobal('fetch', vi.fn(async () => json({ files: [], ...(flag === undefined ? {} : { incompleteSearch: flag }) })));
    const result = await page(manager(), 'collection_list_files_page'); expect(result.searchCoverage).toBe(flag === false ? 'complete' : 'unknown'); expect(result.position.state).toBe('end');
  });
  it('advances Microsoft Search from the complete over-returned page, without dropping hit metadata', async () => {
    connector(families[0]); const offsets: number[] = []; vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      offsets.push(JSON.parse(String(init.body)).requests[0].from); const first = offsets.length === 1;
      return json({ value: [{ hitsContainers: [{ hits: first ? [{ hitId: 'a', resource: { id: 'raw-a' } }, { hitId: 'b', resource: { id: 'raw-b' } }] : [], moreResultsAvailable: first, total: 2 }] }] });
    })); const value = manager(), first = await page(value, 'collection_search_files_page', { query: 'report', pageSize: 1 });
    expect(first.items).toHaveLength(2); expect(first.reportedTotal).toBe(2); expect(first.searchCoverage).toBe('unknown');
    const last = await page(value, 'collection_search_files_page', { query: 'report', pageSize: 1, continuation: (first.position as any).continuation }); expect(last.position.state).toBe('end'); expect(offsets).toEqual([0, 2]);
  });
  it('uses GitHub Link relations, returns all raw rows and preserves branch filtering across pages', async () => {
    connector(families[3]); const requests: string[] = [], next = 'https://api.github.com/repos/o/r/branches?per_page=1&page=2&protected=true'; vi.stubGlobal('fetch', vi.fn(async input => {
      requests.push(String(input)); return requests.length === 1 ? json([{ name: 'keep-a', commit: { sha: 'a' }, providerExtra: 'intact' }, { name: 'skip' }], { Link: `<${next}>; rel="next", <${next}>; rel="last"` }) : json([{ name: 'keep-b' }]);
    })); const value = manager(), args = { repository: 'o/r', pageSize: 1, protected_only: true, filter: 'keep' };
    const first = await page(value, 'collection_list_branches_page', args), last = await page(value, 'collection_list_branches_page', { ...args, continuation: (first.position as any).continuation });
    expect(first.items[0].providerExtra).toBe('intact'); expect(last.items.map(i => i.name)).toEqual(['keep-b']); expect(requests[0]).toContain('protected=true'); expect(requests[1]).toBe(next); expect(last.position.state).toBe('end');
  });
  it('distinguishes GitHub code search exhaustion from provider search ceilings', async () => {
    connector(families[3]); vi.stubGlobal('fetch', vi.fn(async () => json({ items: [{ path: 'a', text_matches: [{ fragment: 'full fragment' }] }], total_count: 1001, incomplete_results: false })));
    const result = await page(manager(), 'collection_search_code_page', { repository: 'o/r', query: 'query' }); expect(result.position.state).toBe('end'); expect(result.searchCoverage).toBe('incomplete'); expect(result.reportedTotal).toBe(1001);
  });
  it.each(['issue', 'review_comment', 'review'])('reads one explicit GitHub discussion collection (%s)', async commentType => {
    connector(families[3]); const fetch = vi.fn(async () => json([{ id: 1, body: 'full body' }])); vi.stubGlobal('fetch', fetch);
    expect((await page(manager(), 'collection_pr_comments_page', { repository: 'o/r', pull_number: 1, commentType })).items).toEqual([{ id: 1, body: 'full body' }]);
    expect(String(fetch.mock.calls[0]![0])).toContain(commentType === 'issue' ? '/issues/1/comments' : commentType === 'review' ? '/pulls/1/reviews' : '/pulls/1/comments'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns the whole matching GitHub tree and explicit provider truncation without a capped scan', async () => {
    connector(families[3]); const tree = Array.from({ length: 71 }, (_, n) => ({ path: `src/${n}.ts`, type: 'blob', sha: String(n), size: n })); const fetch = vi.fn(async () => json({ tree, truncated: true })); vi.stubGlobal('fetch', fetch);
    const result = await page(manager(), 'collection_search_files_page', { repository: 'o/r', pattern: '**/*.ts', ref: 'feature/branch' }); expect(result.items).toEqual(tree); expect(result.position.state).toBe('end'); expect(result.searchCoverage).toBe('incomplete'); expect(fetch).toHaveBeenCalledTimes(1); expect(String(fetch.mock.calls[0]![0])).toContain('feature%2Fbranch');
  });
  it('rejects unsupported code-search ref and missing tree ref before transport', async () => {
    connector(families[3]); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const value = manager();
    expect((await value.executeWithOutcome('collection_search_code_page', { repository: 'o/r', query: 'x', ref: 'branch' })).outcome.status).toBe('failed');
    expect((await value.executeWithOutcome('collection_search_files_page', { repository: 'o/r', pattern: '*' })).outcome.status).toBe('failed'); expect(fetch).not.toHaveBeenCalled();
  });
  it('binds a mention continuation to the authenticated Slack query identity', async () => {
    connector(); let auth = 0, reads = 0; vi.stubGlobal('fetch', vi.fn(async input => {
      if (String(input).endsWith('/auth.test')) return json({ ok: true, user_id: ++auth === 1 ? 'FIRST' : 'REPLACED' });
      reads++; return json({ ok: true, messages: { matches: [{ ts: 'one' }], total: 2, paging: { page: 1, pages: 2 } } });
    })); const value = manager(), first = await page(value, 'collection_get_mentions_page');
    const next = await value.executeWithOutcome('collection_get_mentions_page', { continuation: (first.position as any).continuation }); expect(next.outcome.status).toBe('failed'); expect(next.result.error).toContain('identity changed'); expect(reads).toBe(1); expect(auth).toBe(2);
  });
  it('does not invent a URL-user requirement for tenant-global Microsoft search with app credentials', async () => {
    const c = Connector.create({ name: 'collection', serviceType: 'microsoft', baseURL: 'https://graph.microsoft.com/v1.0', auth: { type: 'oauth', flow: 'client_credentials', clientId: 'synthetic', clientSecret: 'synthetic', tokenUrl: 'https://login.microsoftonline.com/synthetic/oauth2/v2.0/token' } }); vi.spyOn(c, 'getToken').mockResolvedValue('synthetic');
    const fetch = vi.fn(async () => json({ value: [{ hitsContainers: [{ hits: [{ hitId: 'one' }], moreResultsAvailable: false }] }] })); vi.stubGlobal('fetch', fetch);
    expect((await page(manager(), 'collection_search_files_page', { query: 'report' })).items).toEqual([{ hitId: 'one' }]); expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('authenticated bounded continuation ownership', () => {
  it('rejects ambiguous new catalog identities and legacy source collisions before mutation or I/O', () => {
    connector(families[2], 'account:work'); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(() => selected(undefined, 'account:work')).toThrow(/colon/);
    connector(families[2], 'account'); expect(() => selected('work:other', 'account')).toThrow(/colon/);
    const value = manager(ConnectorTools.for('account:work'), 'account:work'); const before = value.list();
    expect(() => value.registerConnectorTools('account', selected('work', 'account'), { accountId: 'work' })).toThrow(/identity collision/); expect(value.list()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['query', 'size', 'order', 'principal', 'account', 'roles', 'tampered', 'fresh-manager'])('rejects %s changes before another transport', async change => {
    connector(families[1]); const fetch = vi.fn(async () => json({ files: [{ id: 'page' }], incompleteSearch: false, nextPageToken: 'provider-secret-position' })); vi.stubGlobal('fetch', fetch);
    const tools = selected('work'), value = manager(tools, 'collection', 'work'); value.setToolContext({ userId: 'host', roles: ['reader'] });
    const first = await page(value, 'collection_work_search_files_page', { query: 'one' }); let continuation = (first.position as any).continuation;
    expect(continuation).not.toContain('provider-secret-position'); expect(continuation.length).toBeLessThan(65_537);
    let next = value, name = 'collection_work_search_files_page'; const args: Record<string, unknown> = { query: 'one', continuation };
    if (change === 'query') args.query = 'other'; if (change === 'size') args.pageSize = 2; if (change === 'order') args.orderBy = 'name desc';
    if (change === 'principal') value.setToolContext({ userId: 'other', roles: ['reader'] }); if (change === 'roles') value.setToolContext({ userId: 'host', roles: ['admin'] });
    if (change === 'tampered') args.continuation = continuation.slice(0, -8) + 'AAAAAAAA';
    if (change === 'fresh-manager') { next = manager(tools, 'collection', 'work'); next.setToolContext({ userId: 'host', roles: ['reader'] }); }
    if (change === 'account') { next = manager(selected('personal'), 'collection', 'personal'); name = 'collection_personal_search_files_page'; next.setToolContext({ userId: 'host', roles: ['reader'] }); }
    const report = await next.executeWithOutcome(name, args); expect(report.outcome.status).toBe('failed'); expect(report.result.error).toMatch(/continuation/); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('accepts normalized omitted/explicit defaults through the same manager after reconstructing tool definitions', async () => {
    connector(families[1]); const fetch = vi.fn(async () => json({ files: [], nextPageToken: 'again', incompleteSearch: false })); vi.stubGlobal('fetch', fetch);
    const value = manager(), first = await page(value, 'collection_list_files_page'); value.registerConnectorTools('collection', selected());
    expect((await page(value, 'collection_list_files_page', { pageSize: 100, orderBy: 'folder,name', corpora: 'user', supportsAllDrives: true, includeItemsFromAllDrives: true, continuation: (first.position as any).continuation })).position.state).toBe('more'); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves a full oversized provider position and page as an explicit failed observation', async () => {
    connector(families[1]); const next = 'opaque-source-'.repeat(6000); vi.stubGlobal('fetch', vi.fn(async () => json({ files: [{ id: 'exact-row', content: 'entire row' }], nextPageToken: next, incompleteSearch: false })));
    const result = await manager().executeWithOutcome('collection_list_files_page', {}); expect(result.outcome.status).toBe('failed'); expect(result.result).toMatchObject({ items: [{ id: 'exact-row', content: 'entire row' }], position: { state: 'unknown' }, observedPage: { body: { nextPageToken: next } } });
  });
  it('separates direct tool-set codecs from managed ownership and from a reconstructed tool set', async () => {
    connector(); vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, channels: [], response_metadata: { next_cursor: 'two' } })));
    const tools = selected(), tool = tools.find(t => t.definition.function.name === 'collection_list_channels_page')!;
    const first = await tool.execute({}), continuation = (first as any).position.continuation;
    expect((await tool.execute({ continuation }) as any).position.state).toBe('more');
    expect((await manager(tools).executeWithOutcome('collection_list_channels_page', { continuation })).outcome.status).toBe('failed');
    expect((await selected().find(t => t.definition.function.name === 'collection_list_channels_page')!.execute({ continuation }) as any).error).toMatch(/continuation/);
  });
});

describe('strict mutations, evidence and lifecycle', () => {
  it.each(['x'.repeat(250), '😀'.repeat(250), 'e\u0301'.repeat(125), ''])('sends a valid Unicode topic unchanged (%#)', async topic => {
    connector(); const sent: string[] = []; vi.stubGlobal('fetch', vi.fn(async (_input, init) => { sent.push(JSON.parse(String(init.body)).topic); return json({ ok: true, channel: { topic: { value: topic } } }); }));
    const result = await manager().executeWithOutcome('collection_set_channel_topic_strict', { channel: 'C1', topic }); expect(result.outcome.status).toBe('succeeded'); expect(sent).toEqual([topic]); expect(result.result.topic).toBe(topic);
  });
  it.each(['x'.repeat(251), '😀'.repeat(251), 'e\u0301'.repeat(126)])('rejects an oversized topic before I/O (%#)', async topic => {
    connector(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const result = await manager().executeWithOutcome('collection_set_channel_topic_strict', { channel: 'C1', topic }); expect(result.outcome.status).toBe('failed'); expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves the old topic prefix normalization and execution-v1 schema unchanged', async () => {
    connector(); const sent: string[] = []; vi.stubGlobal('fetch', vi.fn(async (_input, init) => { sent.push(JSON.parse(String(init.body)).topic); return json({ ok: true, channel: { topic: { value: 'legacy' } } }); }));
    await ConnectorTools.for('collection').find(t => t.definition.function.name === 'collection_set_channel_topic')!.execute({ channel: 'C1', topic: 'x'.repeat(251) }); expect(sent).toEqual(['x'.repeat(250)]);
  });
  it('stores every over-returned read row before projection and retains source on projection failure', async () => {
    connector(); const rows = Array.from({ length: 17 }, (_, i) => ({ ts: String(i), text: `EXACT-${i}-` + 'body '.repeat(2000) })); const fetch = vi.fn(async () => json({ ok: true, messages: rows, has_more: false })); vi.stubGlobal('fetch', fetch);
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'collection' } });
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage, projectThresholdBytes: 1 } } }); contexts.push(context);
    const tools = selected(); context.tools.registerConnectorTools('collection', tools);
    const result = await context.tools.executeWithOutcome('collection_get_messages_page', { channel: 'C1', pageSize: 1 }); expect(result.result.items).toEqual(rows); expect(result.result.returnedCount).toBe(17); expect(result.evidence?.projection).not.toContain('body body');
    expect((await storage.readRecord(result.evidence!.reference!))?.result).toEqual(result.result);
    tools.find(t => t.definition.function.name === 'collection_get_messages_page')!.output!.summarize = () => { throw new Error('projection failure'); };
    const failed = await context.tools.executeWithOutcome('collection_get_messages_page', { channel: 'C1' }); expect(failed.outcome.status).toBe('succeeded'); expect(failed.evidence?.status).toBe('projection_failed'); expect((await storage.readRecord(failed.evidence!.reference!))?.result).toEqual(failed.result); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retains malformed provider source rather than pretending the page was empty', async () => {
    connector(families[3]); vi.stubGlobal('fetch', vi.fn(async () => json({ unexpected: ['source-is-kept'] })));
    const result = await manager().executeWithOutcome('collection_list_branches_page', { repository: 'o/r' }); expect(result.outcome.status).toBe('failed'); expect(result.result.observedPage).toEqual({ body: { unexpected: ['source-is-kept'] } });
  });
  it('does not retry strict writes or dispatch after token revocation', async () => {
    const c = connector(); const fetch = vi.fn(async () => json({ ok: false, error: 'retry' }, undefined, 503)); vi.stubGlobal('fetch', fetch); const value = manager();
    expect((await value.executeWithOutcome('collection_set_channel_topic_strict', { channel: 'C1', topic: 'one write' })).outcome.status).toBe('failed'); expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(c, 'getToken').mockImplementation(async () => { throw new Error('token revoked'); });
    expect((await value.executeWithOutcome('collection_list_channels_page', {})).outcome.status).toBe('failed'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels a page safe-read backoff before a second physical attempt', async () => {
    Connector.create({ name: 'collection', serviceType: 'slack', baseURL: 'https://slack.com/api', auth: { type: 'api_key', apiKey: 'synthetic' }, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 1000 } });
    const fetch = vi.fn(async () => json({ ok: false, error: 'retry' }, undefined, 503)); vi.stubGlobal('fetch', fetch); const controller = new AbortController(), value = manager();
    const running = value.executeWithOutcome('collection_list_channels_page', {}, { signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); controller.abort(); const result = await running; expect(result.outcome.status).toBe('cancelled'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains every source row when evidence storage fails without another page request', async () => {
    connector(); const items = [{ ts: 'one', text: 'EXACT-ONE ' + 'source '.repeat(2000) }, { ts: 'two', text: 'EXACT-TWO' }]; const fetch = vi.fn(async () => json({ ok: true, messages: items, has_more: false })); vi.stubGlobal('fetch', fetch);
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'host', namespace: 'failed-pages' } }); vi.spyOn(storage, 'put').mockRejectedValue(new Error('Synthetic storage failure'));
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage, projectThresholdBytes: 1 } } }); contexts.push(context); context.tools.registerConnectorTools('collection', selected());
    const result = await context.tools.executeWithOutcome('collection_get_messages_page', { channel: 'C1', pageSize: 1 }); expect(result.outcome.status).toBe('succeeded'); expect(result.result.items).toEqual(items); expect(result.evidence?.status).toBe('storage_failed'); expect(result.evidence?.projection).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('actual Agent catalog and manager-local ownership', () => {
  function catalogAgent(profile: boolean) {
    const tools = profile ? selected('work') : ConnectorTools.for('collection', undefined, { accountId: 'work' });
    const f = fixture({ identities: [{ connector: 'collection', accountId: 'work', ...(profile ? { toolFilter: tools.map(t => t.definition.function.name) } : {}) }], context: { features: { toolCatalog: true } }, permissions: { autoApproveAll: true } }); agents.push(f.agent);
    if (profile) f.agent.tools.registerConnectorTools('collection', tools, { accountId: 'work' });
    return { agent: f.agent, catalog: f.agent.context.getPlugin<ToolCatalogPluginNextGen>('tool_catalog')!, tools };
  }
  it('overlays only the selected manager across discovery, search, unload/reload and codec reuse', async () => {
    connector(); vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, channels: [{ id: 'row' }], response_metadata: { next_cursor: 'again' } })));
    const current = catalogAgent(true), legacy = catalogAgent(false), category = 'connector:collection:work';
    const discovered = JSON.stringify(await current.agent.tools.execute('tool_catalog_search', { category })); expect(discovered).toContain('collection_work_list_channels_page'); expect(discovered).not.toContain('collection_work_list_channels"');
    current.catalog.executeLoad(category); const first = await page(current.agent.tools, 'collection_work_list_channels_page');
    await current.agent.tools.execute('tool_catalog_unload', { category }); expect(current.agent.tools.listEnabled()).not.toContain('collection_work_list_channels_page');
    const reload = current.catalog.executeLoad(category); expect(reload.error).toBeUndefined();
    const next = await page(current.agent.tools, 'collection_work_list_channels_page', { continuation: (first.position as any).continuation }); expect((next.position as any).positionId).toBe((first.position as any).positionId);
    const actual = current.agent.tools.getEnabledRegistrations().filter(reg => reg.source === category); expect(actual.map(reg => reg.tool.definition.function.name).sort()).toEqual(current.tools.map(t => t.definition.function.name).sort()); expect(actual.every(reg => reg.tool.connectorAccountId === 'work')).toBe(true);
    legacy.catalog.executeLoad(category); expect(legacy.agent.tools.listEnabled()).toContain('collection_work_list_channels'); expect(legacy.agent.tools.listEnabled()).not.toContain('collection_work_list_channels_page');
    expect(JSON.stringify(await current.agent.tools.execute('tool_catalog_search', { listAll: true }))).not.toContain('collection_work_list_channels"');
  });
  it('keeps the codec through nested temporary scopes and restores visibility without legacy aliases', async () => {
    connector(); vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, channels: [], response_metadata: { next_cursor: 'again' } })));
    const { agent, tools } = catalogAgent(true); const name = 'collection_work_list_channels_page', first = await page(agent.tools, name);
    const lease = acquireComposition(agent), outer = lease.enterScope(new Set([name])), inner = lease.enterScope(new Set());
    expect(agent.tools.listEnabled()).not.toContain(name); inner();
    expect((await lease.admit(() => page(agent.tools, name, { continuation: (first.position as any).continuation }))).position.state).toBe('more'); outer(); lease.release();
    expect(agent.tools.listEnabled()).toEqual(expect.arrayContaining(tools.map(t => t.definition.function.name))); expect(agent.tools.list()).not.toContain('collection_work_list_channels');
  });
  it('removes already loaded and disabled legacy aliases for exactly the selected account', () => {
    connector(); const value = manager(ConnectorTools.for('collection', undefined, { accountId: 'work' }), 'collection', 'work'); value.setEnabled(value.list(), false);
    value.registerConnectorTools('collection', ConnectorTools.for('collection', undefined, { accountId: 'personal' }), { accountId: 'personal' }); value.registerConnectorTools('collection', selected('work'), { accountId: 'work' });
    expect(value.list()).not.toContain('collection_work_list_channels'); expect(value.list()).toContain('collection_work_list_channels_page'); expect(value.list()).toContain('collection_personal_list_channels');
  });
  it('compacts and reloads the selected category immediately after registration while preserving its cursor key', async () => {
    connector(); vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, channels: [], response_metadata: { next_cursor: 'again' } })));
    const { agent, catalog } = catalogAgent(true), name = 'collection_work_list_channels_page'; const first = await page(agent.tools, name);
    expect(catalog.isCompactable()).toBe(true); expect(await catalog.compact(1)).toBeGreaterThan(0); expect(agent.tools.listEnabled()).not.toContain(name);
    expect(catalog.executeLoad('connector:collection:work').error).toBeUndefined(); expect((await page(agent.tools, name, { continuation: (first.position as any).continuation })).position.state).toBe('more');
    expect(JSON.stringify(catalog.getContents())).not.toContain('collection_work_list_channels"');
  });
});
