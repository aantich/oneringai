/** Synthetic local-provider measurement; no live LLM or exact tokenizer claim. */
import { Agent, Connector, Vendor, simpleTokenEstimator } from 'oneringai';
import { ScriptedLoopProvider } from '../agent-loop/scripted-provider.js';
class LargeContextProvider extends ScriptedLoopProvider {
  override getModelCapabilities() { return { supportsTools: true, supportsVision: false, supportsJSON: true,
    supportsJSONSchema: false, maxTokens: 1_100_000, maxInputTokens: 1_100_000, maxOutputTokens: 128 }; }
}
export async function runLargeContextScenario(readHeap?: () => number | undefined) {
  const connector = 'large-context-' + crypto.randomUUID(), model = 'offline-large-context';
  const provider = new LargeContextProvider([{ text: 'Large context accepted' }]);
  Connector.create({ name: connector, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const agent = Agent.create({ connector, model, modelExecution: { customProviderAttempts: 'single', maxOutputTokensPerCall: 128 },
    context: { model, maxContextTokens: 1_100_000, responseReserve: 128, features: { workingMemory: false, inContextMemory: false } } });
  // About one million tokens under the current public estimator; report its
  // actual estimate instead of treating characters as provider tokens.
  const text = 'word'.repeat(875_000), before = readHeap?.(), start = performance.now();
  let preparedAfterMs: number | undefined;
  agent.context.once('context:prepared', () => { preparedAfterMs = performance.now() - start; });
  let timerLagMs: number | undefined;
  const timer = setTimeout(() => { timerLagMs = performance.now() - start; }, 0);
  try {
    const response = await agent.run(text), runMs = performance.now() - start;
    if (response.output_text !== 'Large context accepted') throw new Error('Large-context fixture failed');
    const serializationStart = performance.now(), serialized = JSON.stringify(provider.requests[0]);
    const serializationMs = performance.now() - serializationStart;
    await new Promise(resolve => setTimeout(resolve, 0));
    return { inputBytes: new TextEncoder().encode(text).length, estimatedInputTokens: simpleTokenEstimator.estimateTokens(text),
      preparedTokens: agent.context.lastPreparation?.budget.totalUsed, serializedBytes: new TextEncoder().encode(serialized).length,
      preparedAfterMs, runMs, serializationMs, timerLagMs, heapBefore: before, heapAfter: readHeap?.(), model: 'local scripted provider',
      estimator: 'OneRingAI simpleTokenEstimator; not a provider tokenizer' };
  } finally { clearTimeout(timer); agent.destroy(); Connector.remove(connector); }
}
