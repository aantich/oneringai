/** Offline: node --import tsx examples/native-context-hooks.ts
 * Explicit: add --manual. Live: --live=openai or --live=anthropic (.env; at most 8 attempts).
 * Manual Anthropic demonstrates fixed thinking with an 8192-token budget.
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { Agent, Connector, ContextCompactionStrategy, ContentType, MessageRole, ModelTask, Vendor } from '@everworker/oneringai';
import type { InContextMemoryPluginNextGen } from '@everworker/oneringai';
import { createNativeFixture } from './native-compaction/fixture.js';

dotenv.config({ quiet: true });
const manual = process.argv.includes('--manual');
const fixedThinking = manual && process.argv.includes('--live=anthropic');
const live = process.argv.find(arg => arg.startsWith('--live='))?.split('=')[1];
if (live && !['openai', 'anthropic'].includes(live)) throw new Error('Use --live=openai or --live=anthropic');
const model = live === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-6-astra';
const key = live ? process.env[live === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] : undefined;
if (live && !key) throw new Error('Configure the selected provider key in .env');
const fixture = createNativeFixture();
Connector.create({ name: 'native-hooks', vendor: live === 'anthropic' ? Vendor.Anthropic : Vendor.OpenAI,
  auth: key ? { type: 'api_key', apiKey: key } : { type: 'none' }, ...(live ? {} : { options: { provider: fixture.provider } }) });
const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 150000 } });
let hooks = 0;
const agent = Agent.create({ connector: 'native-hooks', model, thinking: fixedThinking ? { enabled: true, mode: 'enabled', budgetTokens: 8192 } : { enabled: false },
  instructions: 'Answer directly from supplied context without using tools.',
  hooks: { 'before:llm': () => ({ modified: { max_output_tokens: fixedThinking ? 16384 : 256 } }) },
  ...(live ? {} : { modelExecution: { customProviderAttempts: 'single' } }),
  lifecycleHooks: { beforeCompaction: async () => {
    hooks++;
    // Preserving a fact changes plugin content. The same preparation refreshes
    // that view once before reducing history; it never reruns this hook.
    agent.context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!
      .set('saved', 'Confirmed host note', 'ORBIT_16A has confirmed limit 37.', 'critical');
  } },
  context: { model, maxContextTokens: 22000, responseReserve: 300, criticalCompactionThreshold: .3,
    features: { workingMemory: false, inContextMemory: true, evidence: true },
    compactionStrategy: new ContextCompactionStrategy({ plugins: 'off', history: { mode: 'native', preserveRecentTurns: 0 }, automatic: !manual }) } });
try {
  for (let index = 0; index < 8; index++) {
    agent.context.addUserMessage(`Step ${index}: ORBIT_16A has confirmed limit 37.`);
    agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text: 'Routine historical progress details. '.repeat(200).trimEnd() }] }]);
  }
  const explicit = manual ? await agent.compactContext({ target: 'history', modelTask: task }) : undefined;
  const answer = await agent.run('Return the project code and confirmed limit.', { modelTask: task });
  assert.equal(hooks, 1); assert.equal((explicit ?? agent.context.lastPreparation?.compactionDetails)?.history.status, 'compacted');
  assert.match(answer.output_text ?? '', /ORBIT_16A/); assert.match(answer.output_text ?? '', /37/);
  assert.match(JSON.stringify(agent.context.getPlugin('in_context_memory')!.getState()), /confirmed limit 37/);
  console.log(live ? `LIVE ${live}` : 'OFFLINE protocol fixture; no model quality claim');
  console.log(`Memory preserved by one lifecycle hook; ${manual ? 'manual' : 'automatic'} native history reduced; managed continuation completed.`);
  console.log(answer.output_text, task.snapshot().totals);
} finally { agent.destroy(); task.destroy(); Connector.remove('native-hooks'); }
