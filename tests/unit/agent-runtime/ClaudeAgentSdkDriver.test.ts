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
const terminal = (overrides = {}): SDKMessage => ({ type: 'result', subtype: 'success', result: 'ok', session_id: 'native-id', uuid: 'offline-result', is_error: false, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: {}, total_cost_usd: 0, ...overrides } as SDKMessage);
afterEach(() => Connector.clear());
function setup(messages?: SDKMessage[]) {
  Connector.create({ name: 'claude', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'secret-fixture' } });
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
  it('fails closed on native policy, configuration and unverified model effort', async () => {
    const f = setup();
    try {
      await expect(f.agent.inspect({ ...f.options, policy: { ...policy, commands: 'sandboxed' } })).rejects.toThrow('host tools');
      await expect(f.agent.inspect({ ...f.options, execution: { ...f.options.execution, driverConfig: { apiKey: 'bad' } } })).rejects.toThrow('Unknown');
      await expect(f.agent.inspect({ ...f.options, execution: { ...f.options.execution, reasoning: { effort: 'ultra' } } })).rejects.toThrow('Unverified');
    } finally { await f.runtime.destroy(); }
  });
});
