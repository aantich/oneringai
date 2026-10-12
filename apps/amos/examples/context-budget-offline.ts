/** Render real AMOS context commands without credentials or a terminal session. */
import { AgentContextNextGen } from '@everworker/oneringai';
import { inspectContext } from '../src/agent/contextInspection.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import type { IAgentRunner, IAmosApp } from '../src/config/types.js';

const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 3000, responseReserve: 100,
  features: { workingMemory: false, inContextMemory: false }, strategy: 'default' });
const runner = { isReady: () => true,
  getContextBudget: async () => (await inspectContext(context)).budget,
  getContextBreakdown: async () => (await inspectContext(context)).breakdown,
} as unknown as IAgentRunner;
const app = { getAgent: () => runner } as unknown as IAmosApp;
try {
  context.addUserMessage('Inspect the selected request.');
  for (const state of ['before preparation', 'after preparation', 'after request contributions']) {
    if (state === 'after preparation') await context.prepare();
    if (state === 'after request contributions') await context.prepare({ modelMaxContextTokens: 1000,
      getRequestOptions: () => ({ response_format: { type: 'json_schema', json_schema: {
        name: 'inspection', schema: { type: 'object', description: 'known schema '.repeat(60), properties: {} },
      } } }),
    });
    for (const subcommand of ['budget', 'breakdown']) {
      const result = await new ContextCommand().execute({ app, args: [subcommand], rawInput: `/context ${subcommand}` });
      if (!result.success) throw new Error(result.message);
      // eslint-disable-next-line no-console
      console.log(`${state}: /context ${subcommand}\n${result.message}\n`);
    }
  }
} finally { context.destroy(); }
