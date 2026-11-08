import { Agent, AgentContextNextGen, BasePluginNextGen, Connector, ModelTask, PluginRegistry, Vendor } from 'oneringai';
import type { AgentConfig, ContextContributor, IContextStorage, ToolFunction } from 'oneringai';
import { ExecutionContext } from 'oneringai/agents';
void ExecutionContext;
export { runPluginRegressions, runTransportRegressions } from './agent-regressions.js';
export function sharedConsumer(storage: IContextStorage, tools: ToolFunction[], gateway: string) {
  class AppPlugin extends BasePluginNextGen implements ContextContributor {
    readonly name = 'browser_type_fixture';
    getInstructions(): string { return 'Use app data as data.'; }
    async getContent(): Promise<null> { return null; }
    getContents(): string { return 'app data'; }
    getRevision(): number { return 1; }
    contribute() { return [{ id: 'one', text: 'app data' }]; }
  }
  PluginRegistry.register('browser_type_fixture', () => new AppPlugin());
  Connector.create({ name: 'app-model', vendor: Vendor.OpenAI, auth: { type: 'none' }, baseURL: gateway });
  const config: AgentConfig = { connector: 'app-model', model: 'gpt-4o-mini', tools,
    context: { model: 'gpt-4o-mini', storage, features: { workingMemory: true, inContextMemory: true, browserTypeFixture: true } } };
  const agent = Agent.create(config), context: AgentContextNextGen = agent.context;
  const task = new ModelTask();
  return { agent, context, task };
}
