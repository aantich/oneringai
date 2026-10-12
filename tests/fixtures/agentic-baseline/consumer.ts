/** Compile against the BUILT package root, never source or implementation paths. */
import {
  Agent, AgentContextNextGen, BasePluginNextGen, Connector, Vendor,
  DEFAULT_FEATURES, FileContextStorage,
} from '@everworker/oneringai';
import type {
  ToolFunction, ITextProvider, IContextPluginNextGen, ICompactionStrategy,
  CompactionContext, CompactionResult, ConsolidationResult, SerializedContextState,
  AgentEvents, TokenUsage, IContextStorage,
} from '@everworker/oneringai';

export class ConsumerPlugin extends BasePluginNextGen {
  readonly name = 'consumer-fixture';
  getInstructions(): string { return 'Retain the current task constraint.'; }
  async getContent(): Promise<string> { this.updateTokenCache(3); return 'Constraint: read only'; }
  getContents(): unknown { return { constraint: 'read only' }; }
}

export const plugin: IContextPluginNextGen = new ConsumerPlugin();
export const strategy: ICompactionStrategy = {
  name: 'consumer-strategy', displayName: 'Consumer strategy', description: 'Compatibility fixture', threshold: 0.8,
  async compact(_context: CompactionContext, _target: number): Promise<CompactionResult> {
    return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
  },
  async consolidate(_context: CompactionContext): Promise<ConsolidationResult> {
    return { performed: false, tokensChanged: 0, actions: [] };
  },
};

export const tool: ToolFunction = {
  definition: { type: 'function', function: { name: 'legacy_probe', parameters: { type: 'object', properties: {} } } },
  execute: async () => ({ value: 'unchanged', success: false }),
  describeCall: () => 'Read compatibility probe',
};

export function createConsumer(provider: ITextProvider, storage: IContextStorage): Agent {
  Connector.create({ name: 'consumer-compat', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { ...DEFAULT_FEATURES }, storage });
  context.registerPlugin(plugin);
  context.setCompactionStrategy(strategy);
  const agent = Agent.create({ connector: 'consumer-compat', model: 'gpt-4o-mini', context, tools: [tool] });
  agent.on('llm:response', (event: AgentEvents['llm:response']) => {
    const usage: TokenUsage = event.response.usage;
    void usage;
  });
  return agent;
}

export async function exerciseConsumer(agent: Agent, state: SerializedContextState): Promise<void> {
  agent.context.restoreState(state);
  const response = await agent.run('Hello', { temperature: 0 });
  const text: string | undefined = response.output_text;
  const direct = await agent.runDirect('Hello', { maxOutputTokens: 128 });
  for await (const event of agent.stream('Hello')) void event;
  await agent.context.save('compatibility');
  await agent.context.load('compatibility');
  const shared: boolean = agent.tools === agent.context.tools;
  void text; void direct; void shared;
  agent.destroy();
}

export const fileStorage: IContextStorage = new FileContextStorage({ agentId: 'consumer', baseDirectory: '/tmp/oneringai-consumer-fixture' });
