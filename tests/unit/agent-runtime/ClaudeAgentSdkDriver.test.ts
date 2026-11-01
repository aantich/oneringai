import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { AgentRuntime, LocalExecutionBackend } from '@/agent-runtime/index.js';
import { ClaudeAgentSdkDriver } from '@/agent-runtime/claude.js';

const policy = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;
const terminal = (overrides = {}): SDKMessage => ({ type: 'result', subtype: 'success', result: 'ok', session_id: 'native-id', uuid: 'offline-result', is_error: false, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: {}, total_cost_usd: 0, ...overrides } as unknown as SDKMessage);
afterEach(() => Connector.clear());
function setup(messages?: SDKMessage[], key = 'secret-fixture') {
  Connector.create({ name: 'claude', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: key } });
  const requests: Options[] = [];
  const execute = vi.fn(async () => ({ success: false, answer: 'value' }));
  const query = vi.fn(({ options }: { options?: Options }) => {
    requests.push(options!);
    const iterator = (async function* () {
      if (messages) { yield* messages; return; }
      const server = options!.mcpServers!.onering_host;
      if (!server || !('instance' in server)) throw new Error('Missing real SDK MCP instance');
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'offline', version: '1' });
      await server.instance.connect(serverTransport); await client.connect(clientTransport);
      try {
        expect((await client.listTools()).tools[0]?.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
        expect((await client.callTool({ name: 'probe', arguments: {} })).isError).toBe(false);
      } finally { await client.close(); }
      yield terminal();
    })();
    return Object.assign(iterator, { close: vi.fn(), interrupt: vi.fn(async () => undefined) }) as unknown as Query;
  });
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [new ClaudeAgentSdkDriver({ loadSdk: async () => ({ createSdkMcpServer, query }) })], resolveTools: () => ({ fingerprint: 'host-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute }] }) }) });
  const agent = runtime.createAgent({ id: 'claude', instructions: 'test', tools: ['probe'] });
  const options = { execution: { driver: 'anthropic.agent.sdk', connector: 'claude', model: 'claude-sonnet-4-6' }, context: { userId: 'fixture' }, policy };
  return { runtime, agent, options, requests, query, execute };
}
describe('Claude SDK local driver', () => {
  it('uses the actual SDK in-process MCP instance with raw schemas and isolated configuration', async () => {
    const fixture = setup();
    try {
      await fixture.agent.inspect(fixture.options); expect(fixture.query).not.toHaveBeenCalled();
      const session = await fixture.agent.openSession(fixture.options);
      expect((await (await session.run('first')).result).status).toBe('completed');
      expect((await (await session.run('second')).result).outputText).toBe('ok');
      expect(fixture.execute).toHaveBeenCalledTimes(2);
      expect(fixture.requests[1]?.resume).toBe('native-id');
      expect(fixture.requests[0]).toMatchObject({ settingSources: [], tools: [], plugins: [], agents: {}, strictMcpConfig: true, permissionPrompts: 'none', allowedTools: ['mcp__onering_host__probe'] });
      expect(fixture.requests[0]?.env).not.toHaveProperty('OPENAI_API_KEY');
      expect(fixture.requests[0]?.env?.ANTHROPIC_API_KEY).toBe('secret-fixture');
    } finally { await fixture.runtime.destroy(); }
  });
  it.each(['error_during_execution','error_max_turns','error_max_budget_usd'])('maps %s without claiming completion', async subtype => {
    const f = setup([terminal({ subtype, result: undefined, is_error: false, errors: ['secret-fixture failure'] })]);
    try {
      const session = await f.agent.openSession(f.options); const result = await (await session.run('test')).result;
      expect(result.status).toBe(subtype === 'error_during_execution' ? 'failed' : 'incomplete'); expect(JSON.stringify(result)).not.toContain('secret-fixture');
    } finally { await f.runtime.destroy(); }
  });
  it('validates structured output locally after verified terminal completion', async () => {
    const f = setup([terminal({ structured_output: { answer: 42 } })]);
    try {
      const session = await f.agent.openSession(f.options);
      const result = await (await session.run('json', { responseFormat: { type: 'json_schema', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } } })).result;
      expect(result.status).toBe('failed'); expect(result.error?.code).toBe('AGENT_STRUCTURED_OUTPUT'); expect(session.state).toBe('ready');
    } finally { await f.runtime.destroy(); }
  });
  it('redacts arbitrarily split text/thinking deltas independently and preserves block boundaries', async () => {
    const key = 'secret-fixture';
    const text = `before ${key} after`; const thinking = `why ${key} done`;
    const messages: SDKMessage[] = [];
    const stream = (event: unknown) => messages.push({ type: 'stream_event', event } as SDKMessage);
    stream({ type: 'message_start' });
    for (let i = 0; i < Math.max(text.length, thinking.length); i++) {
      if (i < text.length) stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text[i] } });
      if (i < thinking.length) stream({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: thinking[i] } });
    }
    stream({ type: 'content_block_stop', index: 0 }); stream({ type: 'content_block_stop', index: 1 });
    stream({ type: 'message_stop' });
    // A new message reuses index 0 and ends on an incomplete sensitive prefix.
    stream({ type: 'message_start' }); stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' safe secr' } });
    messages.push(terminal({ result: text }));
    const f = setup(messages);
    try {
      const run = await (await f.agent.openSession(f.options)).run('test');
      const events = []; for await (const event of run.events()) events.push(event);
      expect(events.filter(event => event.type === 'agent.message.delta').map(event => event.data.text).join('')).toBe('before [REDACTED] after safe [REDACTED]');
      expect(events.filter(event => event.type === 'reasoning.delta').map(event => event.data.text).join('')).toBe('why [REDACTED] done');
      expect(JSON.stringify(events)).not.toContain(key);
      expect((await run.result).outputText).toBe('before [REDACTED] after');
    } finally { await f.runtime.destroy(); }
  });
  it.each([false, true])('sanitizes decoded JSON strings and keys before validation, structured=%s', async structured => {
    const key = 'secret-"\\-fixture';
    const value = { answer: key, nested: { [key]: [key] } };
    const f = setup([terminal({ result: JSON.stringify(value), ...(structured ? { structured_output: value } : {}) })], key);
    try {
      const session = await f.agent.openSession(f.options);
      const run = await session.run('json', { responseFormat: { type: 'json_schema', schema: { type: 'object', properties: { answer: { type: 'string' }, nested: { type: 'object' } }, required: ['answer', 'nested'], additionalProperties: false } } });
      const result = await run.result;
      expect(result.status).toBe('completed');
      expect(result.outputParsed).toEqual({ answer: '[REDACTED]', nested: { '[REDACTED]': ['[REDACTED]'] } });
      expect(JSON.parse(result.outputText)).toEqual(result.outputParsed);
      expect(JSON.stringify(result)).not.toContain(JSON.stringify(key).slice(1, -1));
    } finally { await f.runtime.destroy(); }
  });
  it('fails explicitly when redaction cannot satisfy the schema without returning the sensitive value', async () => {
    const f = setup([terminal({ structured_output: { answer: 'secret-fixture' } })]);
    try {
      const result = await (await (await f.agent.openSession(f.options)).run('json', { responseFormat: { type: 'json_schema', schema: { type: 'object', properties: { answer: { const: 'secret-fixture' } }, required: ['answer'] } } })).result;
      expect(result.status).toBe('failed'); expect(result.error?.code).toBe('AGENT_STRUCTURED_OUTPUT');
      expect(result.outputParsed).toBeUndefined(); expect(JSON.stringify(result)).not.toContain('secret-fixture');
    } finally { await f.runtime.destroy(); }
  });
  it('fails closed on native policy, configuration and unverified model effort', async () => {
    const f = setup();
    try {
      await expect(f.agent.inspect({ ...f.options, policy: { ...policy, commands: 'sandboxed' } })).rejects.toThrow('host tools');
      await expect(f.agent.inspect({ ...f.options, execution: { ...f.options.execution, driverConfig: { apiKey: 'bad' } } })).rejects.toThrow('Unknown');
      await expect(f.agent.inspect({ ...f.options, execution: { ...f.options.execution, reasoning: { effort: 'ultra' } } })).rejects.toThrow('Unverified');
    } finally { await f.runtime.destroy(); }
  });
});
