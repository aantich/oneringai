/** Build first. Offline by default. --live=openai|anthropic|google makes billable calls. */
import { pathToFileURL } from 'node:url';
import { Agent, Connector, ModelTask, StreamEventType } from '@everworker/oneringai';
import { liveRoutingModels, offlineRoutingConnector } from './model-routing/fixture.js';

export async function demonstrateRouting(live?: keyof typeof liveRoutingModels): Promise<void> {
  if (live) (await import('dotenv')).default.config({ quiet: true });
  const selected = live ? liveRoutingModels[live] : undefined;
  if (live && !selected) throw new Error('Choose --live=openai, anthropic or google');
  const name = 'routing-demonstration';
  const models = selected ?? offlineRoutingConnector(name);
  if (selected) {
    const key = process.env[selected.key]; if (!key) throw new Error(`Missing ${selected.key}`);
    Connector.create({ name, vendor: selected.vendor, auth: { type: 'api_key', apiKey: key }, options: { maxRetries: 0 } });
  }
  const agent = Agent.create({ connector: name, model: models.mainModel, thinking: { enabled: false },
    instructions: 'For this functional routing demonstration, reply with ACK exactly and do not use tools.',
    context: { model: models.mainModel, features: { workingMemory: false, inContextMemory: false } },
    modelExecution: { ...(live ? {} : { customProviderAttempts: 'single' as const }), maxOutputTokensPerCall: 256,
      routing: { routes: { fast: { model: models.fastModel, thinking: { enabled: false } } }, sticky: 'phase',
        select: ({ hints }) => ({ route: hints.taskType === 'lookup' ? 'fast' : 'default', reason: 'Explicit host category rule; no classifier call' }) } },
  });
  const task = new ModelTask({ limits: { maxCalls: 8, deadline: Date.now() + 120_000 } });
  const decisions = [];
  try {
    for (const [taskType, phase] of [['lookup', 'gather'], ['unknown', 'gather'], ['analysis', 'decide']] as const) {
      const response = await agent.run('Acknowledge this separate demonstration step.', { routing: { taskType, phase }, modelTask: task });
      if (!response.output_text?.includes('ACK')) throw new Error('The model did not acknowledge the demonstration step');
      decisions.push(response.routing);
    }
    for await (const event of agent.stream('Acknowledge an explicit default-route stream.', { routing: { route: 'default' }, modelTask: task })) {
      if (event.type === StreamEventType.RESPONSE_COMPLETE) decisions.push(event.routing);
    }
    await agent.run('Acknowledge a routing opt-out.', { routing: null, modelTask: task }); decisions.push(agent.getRoutingDiagnostics());
    if (decisions.map(d => d?.selectedRoute).join(',') !== 'fast,fast,default,default,default') throw new Error('Unexpected route lifecycle');
    if (agent.model !== models.mainModel || agent.tools !== agent.context.tools) throw new Error('Default configuration/shared tool identity changed');
    console.log(JSON.stringify({ mode: live ? `live-${live}` : 'offline synthetic provider', configuredDefault: agent.model,
      decisions, task: task.snapshot(), boundary: 'Functional contract demonstration; no general quality, latency or savings claim.' }, null, 2));
  } finally { agent.destroy(); task.destroy(); Connector.remove(name); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const live = process.argv.find(arg => arg.startsWith('--live='))?.slice(7) as keyof typeof liveRoutingModels | undefined;
  await demonstrateRouting(live);
}
