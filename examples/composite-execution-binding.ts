/** C2 public accounting recipe, using supported APIs only. Offline; build first. */
import { Agent, Connector, ContentType, MessageRole, ModelTask } from '@everworker/oneringai';
import { offlineRoutingConnector } from './model-routing/fixture.js';

const { connector, provider, mainModel } = offlineRoutingConnector('composite-accounting-example');
const generate = provider.generate.bind(provider);
provider.generate = async options => {
  const response = await generate(options);
  if (options.input === 'C2_HELPER') {
    const text = '{"ready":true}';
    return { ...response, output_text: text, output: [{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text }] }] };
  }
  return response;
};
const host = new AbortController();
const task = new ModelTask({ limits: { maxCalls: 3 }, signal: host.signal });
const agent = Agent.create({ connector, model: mainModel,
  context: { model: mainModel, features: { workingMemory: false, inContextMemory: false } },
  modelExecution: { customProviderAttempts: 'single', helpers: {
    extractor: { connector: connector.name, model: mainModel, maxOutputTokens: 128 },
  } },
});
try {
  await agent.run('Managed task', { modelTask: task });
  await agent.runDirect('Stateless reflection', { modelTask: task, signal: host.signal, purpose: 'verifier' });
  const extracted = await agent.invokeHelper<{ ready: boolean }>('extractor', 'C2_HELPER', {
    modelTask: task, signal: host.signal,
    schema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false },
  });
  if (extracted.taskId !== task.id || task.snapshot().totals.calls !== 3) throw new Error('Shared accounting failed');
  console.log('One explicit task:', task.snapshot().invocations.map(invocation => invocation.purpose).join(', '));
  console.log('Synthetic calls:', task.snapshot().totals.calls, 'tokens:', task.snapshot().totals.totalTokens);
  console.log('Managed calls use ModelTask cancellation; direct/helper calls also accept their own signal.');
} finally { agent.destroy(); task.destroy(); Connector.remove(connector.name); }
