import { Connector, StreamEventType, Vendor } from '@everworker/oneringai';
import { AgentRuntime, LocalExecutionBackend, OneRingAIDriver, FileRuntimeSessionStorage } from '@everworker/oneringai/agent-runtime';
import type { RuntimeSessionOptions } from '@everworker/oneringai/agent-runtime';
import { CodexSdkDriver } from '@everworker/oneringai/agent-runtime/codex';
import { ClaudeAgentSdkDriver } from '@everworker/oneringai/agent-runtime/claude';
import { OpenAIManagedDriver } from '@everworker/oneringai/agent-runtime/openai-managed';
import { ClaudeManagedDriver } from '@everworker/oneringai/agent-runtime/claude-managed';
import type { Codex, CodexOptions } from '@openai/codex-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';
import { offlineRoutingConnector } from '../model-routing/fixture.js';
import { offlineClaudeSdk } from './claude-fixture.js';
import { openAIManagedFixture } from './openai-managed-fixture.js';
import { claudeManagedFixture } from './claude-managed-fixture.js';

export const harnessFixtureIds = ['oneringai.agent', 'openai.codex.sdk', 'anthropic.agent.sdk', 'openai.agents.api', 'anthropic.managed.api'] as const;

/** All five actual adapters, one definition/tool contract; only model/CLI/HTTP transports are synthetic. */
export function offlineHarness(driver: typeof harnessFixtureIds[number], root: string) {
  const connector = `offline-${driver}`; let calls = 0;
  if (driver === 'oneringai.agent') {
    const native = offlineRoutingConnector(connector); let sequence = 0;
    native.provider.streamGenerate = async function* () {
      if (sequence++ % 2 === 0) {
        yield { type: StreamEventType.TOOL_CALL_START, response_id: 'offline', item_id: `probe-${sequence}`, tool_call_id: `probe-${sequence}`, tool_name: 'probe' };
        yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'offline', tool_call_id: `probe-${sequence}`, tool_name: 'probe', arguments: '{}' };
      } else yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: 'offline', item_id: 'text', output_index: 0, content_index: 0, delta: 'ACK', sequence_number: 1 };
      yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'offline', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, iterations: 1 };
    };
  } else Connector.create({ name: connector, vendor: driver.startsWith('anthropic') ? Vendor.Anthropic : Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-placeholder' } });
  class OfflineCodex {
    constructor(private readonly options: CodexOptions) {}
    startThread() { return this.resumeThread(); }
    resumeThread() {
      const options = this.options;
      return { id: 'offline-thread', runStreamed: async () => ({ events: (async function* () {
        const config = options.config?.mcp_servers as { onering_host?: { url: string } } | undefined;
        if (config?.onering_host) {
          const client = new Client({ name: 'offline-codex', version: '1' });
          try { await client.connect(new StreamableHTTPClientTransport(new URL(config.onering_host.url), { requestInit: { headers: { Authorization: `Bearer ${options.env?.ONERINGAI_HOST_BROKER_TOKEN}` } } })); const result = await client.callTool({ name: 'probe', arguments: {} }); if (result.isError) throw new Error(JSON.stringify(result)); }
          finally { await client.close(); }
        }
        yield { type: 'thread.started', thread_id: 'offline-thread' };
        yield { type: 'item.completed', item: { id: 'text', type: 'agent_message', text: 'ACK' } };
        yield { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } };
      })() }) };
    }
  }
  const openai = openAIManagedFixture({ artifacts: true }); const claude = claudeManagedFixture({ artifacts: true });
  const implementation = driver === 'oneringai.agent' ? new OneRingAIDriver({ trustAgentPolicy: true, configurationRevision: 'offline-v1', configureAgent: base => ({ ...base, context: { model: base.model, features: { workingMemory: false, inContextMemory: false } } }) })
    : driver === 'openai.codex.sdk' ? new CodexSdkDriver({ loadSdk: async () => ({ Codex: OfflineCodex as unknown as new (options?: CodexOptions) => Codex }) })
    : driver === 'anthropic.agent.sdk' ? new ClaudeAgentSdkDriver({ loadSdk: async () => offlineClaudeSdk })
    : driver === 'openai.agents.api' ? new OpenAIManagedDriver({ createClient: openai.createClient }) : new ClaudeManagedDriver({ createClient: claude.createClient });
  const toolResolution = { fingerprint: 'offline-probe-v1', tools: [{ definition: { type: 'function' as const, function: { name: 'probe', description: 'Read the synthetic business value.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => { calls++; return { success: false, businessValue: 'original' }; } }] };
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [implementation], sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')), fileTransfer: () => ({ root, maxBytes: 1024, mediaTypes: ['text/plain'] }), resolveTools: () => toolResolution }) });
  const local = driver === 'oneringai.agent' || driver === 'openai.codex.sdk';
  const options: RuntimeSessionOptions = { execution: { driver, connector, model: driver.startsWith('anthropic') ? 'claude-sonnet-4-6' : driver === 'openai.agents.api' ? 'gpt-6-astra' : 'gpt-6.1-sol' }, context: { userId: 'offline-owner' }, environment: local ? { type: 'local-directory', path: root } : driver.endsWith('.api') ? { type: 'provider-managed' } : { type: 'none' }, policy: { filesystem: local ? 'read-only' : driver === 'openai.agents.api' ? 'workspace-write' : 'denied', commands: local || driver === 'openai.agents.api' ? 'sandboxed' : 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } };
  return { runtime, implementation, toolResolution, options, calls: () => calls, definition: { id: 'shared-assistant', instructions: 'Use probe once and return ACK.', tools: ['probe'] } };
}
