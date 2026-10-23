/** Offline plugin/native-state composition demonstration. Build first; no credentials/network. */
import { Agent, Connector, ContentType, ContextCompactionStrategy, InContextMemoryPluginNextGen, MessageRole, Vendor } from '@everworker/oneringai';
import { offlineRoutingConnector } from './model-routing/fixture.js';

const fixture = offlineRoutingConnector('routing-context-example');
const { compaction: _nativeAdapter, ...portableProvider } = fixture.provider;
const defaultConnector = Connector.create({ name: 'routing-portable-default', vendor: Vendor.Google, auth: { type: 'none' }, options: { provider: portableProvider } });
const agent = Agent.create({ connector: defaultConnector.name, model: fixture.mainModel,
  context: { model: fixture.mainModel, maxContextTokens: 5000, responseReserve: 256, criticalCompactionThreshold: .5,
    features: { evidence: true, workingMemory: false, inContextMemory: true },
    compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 } }) },
  modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 1024,
    routing: { routes: { fast: { connector: fixture.connector.name, model: fixture.fastModel, allowContextTransfer: true } }, select: () => 'fast' } },
});
try {
  const memory = agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
  memory.set('confirmed', 'Host-confirmed reference', { reference: 'R14', status: 'observed' }, 'critical');
  const originalPlugin = JSON.stringify(memory.getState()); const tools = agent.tools;
  for (let i = 0; i < 5; i++) {
    agent.context.addUserMessage(`Original user request ${i}`);
    agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text: 'Earlier observed detail. '.repeat(200) }] }]);
  }
  await agent.run('Continue the demonstration.');
  const native = agent.context.getState().nativeContinuation;
  if (native?.binding.model !== fixture.fastModel || JSON.stringify(memory.getState()) !== originalPlugin || agent.tools !== tools) throw new Error('Native/plugin composition failed');
  const calls = fixture.requests.length;
  let blocked = false;
  try { await agent.run('Attempt incompatible main model.', { routing: null }); }
  catch (error) { if (!(error instanceof Error) || !error.message.includes('ineligible')) throw error; blocked = true; }
  if (!blocked || fixture.requests.length !== calls) throw new Error('Protected state was transferred');
  await agent.run('Continue on its compatible route.');
  console.log(JSON.stringify({ configuredModel: agent.model, selectedModel: agent.getRoutingDiagnostics()?.model,
    incompatibleSwitchBlocked: blocked, pluginStatePreserved: true, sharedToolManager: agent.tools === agent.context.tools,
    preparation: agent.context.lastPreparation, usage: agent.getModelUsage(),
    boundary: 'Synthetic native protocol fixture; no provider quality/cost claim. Exact source remains in the enabled evidence store.' }, null, 2));
} finally { agent.destroy(); Connector.remove(fixture.connector.name); Connector.remove(defaultConnector.name); }
