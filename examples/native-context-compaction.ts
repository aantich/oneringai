/** Offline: node --import tsx examples/native-context-compaction.ts
 * Live: same command --live=openai or --live=anthropic (.env, billable, max 8 model attempts).
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { Agent, Connector, ContextCompactionStrategy, ContentType, MessageRole, ModelTask, Vendor } from '@everworker/oneringai';
import { createNativeFixture } from './native-compaction/fixture.js';

dotenv.config({ quiet: true });
const live = process.argv.find(arg => arg.startsWith('--live='))?.split('=')[1];
if (live && !['openai', 'anthropic'].includes(live)) throw new Error('Use --live=openai or --live=anthropic');
const model = live === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-6-astra';
const key = live ? process.env[live === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] : undefined;
if (live && !key) throw new Error('Configure the selected provider key in .env');
const fixture = createNativeFixture();
Connector.create({ name: 'native-demo', vendor: live === 'anthropic' ? Vendor.Anthropic : Vendor.OpenAI,
  auth: key ? { type: 'api_key', apiKey: key } : { type: 'none' }, ...(live ? {} : { options: { provider: fixture.provider } }) });
const task = new ModelTask({ limits: { maxCalls: 8 } });
const agent = Agent.create({ hooks: { 'before:llm': () => ({ modified: { max_output_tokens: 256 } }) }, connector: 'native-demo', model, userId: 'demo-owner', thinking: { enabled: false },
  ...(live ? {} : { modelExecution: { customProviderAttempts: 'single' } }),
  context: { model, features: { evidence: true },
    compactionStrategy: new ContextCompactionStrategy({ plugins: 'auto', history: 'native', automatic: false }) } });
try {
  assert.equal(agent.tools, agent.context.tools);
  // The ordinary default stays unchanged. Other explicit combinations are
  // {plugins:'auto',history:'off'}, {plugins:'off',history:'native'}, and both off.
  for (let index = 0; index < 8; index++) {
    agent.context.addUserMessage(`Step ${index}: ORBIT_16A has confirmed limit 37.`);
    agent.context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT,
      content: [{ type: ContentType.OUTPUT_TEXT, text: 'Historical progress details. '.repeat(200).trimEnd() }] }]);
  }
  const plugins = await agent.compactContext({ target: 'plugins', modelTask: task });
  assert.equal(plugins.history.reason, 'not_selected');
  const history = await agent.compactContext({ target: 'history', modelTask: task });
  assert.equal(history.history.status, 'compacted');
  const evidence = agent.context.getPlugin('evidence');
  console.log(live ? `LIVE ${live}` : 'OFFLINE protocol fixture; no model quality claim');
  console.log({ plugins: plugins.plugins, history: history.history.status,
    inputBefore: history.inputTokensBefore, inputAfter: history.inputTokensAfter,
    sources: history.history.sourceReferences.map(reference => reference.id), evidencePlugin: evidence?.name });
  // Known server-owned continuation conflicts fail before another native/model
  // call or history rewrite. This also runs offline; no rejected API call is sent.
  const callsBeforeRejection = task.snapshot().totals.calls;
  const historyBeforeRejection = structuredClone(agent.context.getConversation());
  await assert.rejects(agent.run('Unsupported continuation', { continuationToken: 'server-owned-state', modelTask: task }), /server-owned state/);
  assert.equal(task.snapshot().totals.calls, callsBeforeRejection);
  assert.deepEqual(agent.context.getConversation(), historyBeforeRejection);
  const response = await agent.run('Return the project code and confirmed limit.', { modelTask: task });
  assert.match(response.output_text ?? '', /ORBIT_16A/); assert.match(response.output_text ?? '', /37/);
  console.log(response.output_text, task.snapshot().totals);
} finally { agent.destroy(); task.destroy(); Connector.remove('native-demo'); }
