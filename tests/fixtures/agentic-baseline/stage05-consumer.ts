import { AgentContextNextGen, BasePluginNextGen, createInContextMemoryContributor } from '@everworker/oneringai';
import type { ContextContributor, ContextBlock, ContextSelectionManifest, InContextMemoryPluginNextGen } from '@everworker/oneringai';
// Existing structural helper method remains unrelated to companion registration.
export class LegacyPlugin extends BasePluginNextGen {
  name = 'legacy'; getInstructions() { return null; } async getContent() { return 'legacy'; } getContents() { return null; }
  contribute(_oldArgument: string): number { return 42; }
}
export function enable(ctx: AgentContextNextGen, memory: InContextMemoryPluginNextGen) {
  ctx.registerContextContributor(memory.name, createInContextMemoryContributor(memory));
  const block: ContextBlock = { id: 'A', text: 'observation', protected: true };
  const companion: ContextContributor = { getRevision: () => 'host-v1', contribute: async ({ signal }) => { signal.throwIfAborted(); return [block]; } };
  ctx.registerPlugin(new LegacyPlugin()); ctx.registerContextContributor('legacy', companion);
}
export function selected(ctx: AgentContextNextGen): ContextSelectionManifest | undefined { return ctx.lastPreparation?.selection; }
