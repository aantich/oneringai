import dotenv from 'dotenv';
import { describe, it, expect } from 'vitest';
import { Agent, Connector, Vendor, InMemoryEvidenceStorage, AgentPackageOutcomeServer, exportAgentPackage, hydrateAgentPackageWithOutcomes, ModelTask, StreamEventType } from '../../../src/index.js';
import type { RemoteOutcomeTransport } from '../../../src/index.js';
dotenv.config({ quiet: true });
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
describe.skipIf(process.env.RUN_REMOTE_OUTCOMES_LIVE !== '1').sequential('C7 real managed remote observations', () => {
  for (const p of providers) for (const mode of ['run', 'stream'] as const) it(`${p.name}/${mode}: consumes exact remote data with separate source/proxy observations`, async () => {
    if (!p.key) throw new Error('Required live credential missing'); const name = `c7-${p.name}-${mode}`;
    Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
    const source = Agent.create({ connector: name, model: p.model, tools: [{ definition: { type: 'function', function: { name: 'read_remote_marker', description: 'Read the exact local test marker.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, output: { effect: 'read' }, execute: async () => ({ marker: 'C7_SOURCE_VERIFIED', success: false, meaning: 'business data' }) }], context: { model: p.model, features: { workingMemory: false, inContextMemory: false } } });
    const sourceStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'source', namespace: name } }), localStorage = new InMemoryEvidenceStorage({ scope: { ownerId: 'client', namespace: name } });
    const server = new AgentPackageOutcomeServer(source, exportAgentPackage(source), { storage: sourceStorage, authorize: () => true, maxInlineBytes: 0 });
    const transport: RemoteOutcomeTransport = { negotiate: r => server.negotiate(r, {}), execute: r => server.execute(r, {}), getReceipt: r => server.getReceipt(r, {}), cancel: r => server.cancel(r, {}), readEvidence: r => server.readEvidence(r, {}) };
    const task = new ModelTask({ limits: { maxCalls: 3 } }); let agent: Agent | undefined;
    try {
      let turn = 0; const pair = await hydrateAgentPackageWithOutcomes(server.package(), { connector: name, model: p.model, transport, permissions: { autoApproveAll: true },
        agentConfig: { temperature: 0, thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 } },
        hooks: { 'before:llm': async hook => { if (turn++ === 0) hook.options.tool_choice = { type: 'function', function: { name: 'read_remote_marker' } }; else { hook.options.tools = []; delete hook.options.tool_choice; } return {}; } },
        contextFactory: () => ({ model: p.model, responseReserve: 128, features: { workingMemory: false, inContextMemory: false, evidence: true }, plugins: { evidence: { storage: localStorage } } }) }); agent = pair.agent;
      const input = 'Call read_remote_marker once. Its success field is business data. Return exactly the marker field, without commentary.';
      let text = ''; if (mode === 'run') text = (await agent.run(input, { modelTask: task })).output_text ?? ''; else for await (const e of agent.stream(input, { modelTask: task })) if (e.type === StreamEventType.OUTPUT_TEXT_DELTA) text += e.delta;
      expect(text).toContain('C7_SOURCE_VERIFIED'); const observation = pair.session.inspect()[0]!; expect(observation.pendingSource).toBe(false); expect(observation.proxyOutcome?.status).toBe('succeeded'); expect(observation.receipt?.serverOutcome?.status).toBe('succeeded'); expect(observation.proxyOutcome?.executionId).not.toBe(observation.receipt?.serverOutcome?.executionId); expect(task.snapshot().totals.calls).toBe(2);
    } catch (error) { throw new Error(`C7 ${p.name}/${mode}: ${error instanceof Error ? error.name : 'unknown'}${error instanceof Error && error.name === 'AssertionError' ? ` ${error.message}` : ''}; credentials omitted`); }
    finally { agent?.destroy(); await server.close(); source.destroy(); task.destroy(); Connector.remove(name); }
  }, 90_000);
});
