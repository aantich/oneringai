/** Offline Stage 01 demonstration. Run after npm run build; no credentials needed. */
import {
  AgentContextNextGen, ContentType, MessageRole, ToolCallState,
} from '@everworker/oneringai';
import type { ContextPreparation, ContextPrepareOptions, PreparedContext } from '@everworker/oneringai';

function describe(context: AgentContextNextGen, prepared: PreparedContext) {
  const diagnostic: ContextPreparation | null = context.lastPreparation;
  const blocks = prepared.input.flatMap(item => item.type === 'message' ? item.content : []);
  return {
    revision: diagnostic!.revision,
    compacted: prepared.compacted,
    memoryIndexPresent: JSON.stringify(prepared.input).includes('tool_result.read_source.source01'),
    retainedCalls: blocks.filter(block => block.type === ContentType.TOOL_USE).map(block => block.id),
    retainedResults: blocks.filter(block => block.type === ContentType.TOOL_RESULT).map(block => block.tool_use_id),
    estimatedBudget: prepared.budget,
    compactionLog: prepared.compactionLog,
  };
}

export async function demonstrateContextFreshness() {
  const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', maxContextTokens: 2400, responseReserve: 100,
    features: { workingMemory: true, inContextMemory: false } });
  const options: ContextPrepareOptions = {};
  try {
    context.addUserMessage('Start the investigation.');
    const before = describe(context, await context.prepare(options));
    context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.TOOL_USE, id: 'call-source01', name: 'read_source', arguments: '{"source":"sample"}' },
      { type: ContentType.TOOL_USE, id: 'call-source02', name: 'read_source', arguments: '{"source":"native"}' },
    ] }]);
    context.addToolResults([{ tool_use_id: 'call-source01', state: ToolCallState.COMPLETED, content: 'source evidence '.repeat(300) }]);
    // Commit mixed message/native results sharing the same assistant message.
    context.addAssistantResponse([]);
    context.addInputItems([{
      type: 'function_call_output', call_id: 'call-source02', output: 'NATIVE_SOURCE_VERIFIED',
    }]);
    context.addAssistantResponse([{ type: 'message', role: MessageRole.ASSISTANT, content: [
      { type: ContentType.TOOL_USE, id: 'pending01', name: 'lookup', arguments: '{"source":"current"}' },
    ] }]);
    context.addToolResults([{ tool_use_id: 'pending01', state: ToolCallState.COMPLETED, content: 'fresh observation' }]);
    const prepared = await context.prepare(options);
    context.validateRequestBudget({ input: prepared.input, tools: prepared.tools });
    const after = describe(context, prepared);
    const native = await context.tools.execute('store_get', { store: 'notes', key: 'raw.tool_result.read_source.source02' });
    if (!after.memoryIndexPresent || !after.retainedCalls.includes('pending01') ||
        !after.retainedResults.includes('pending01') || prepared.budget.available < 0 ||
        !JSON.stringify(native).includes('NATIVE_SOURCE_VERIFIED')) {
      throw new Error('Freshness demonstration failed its invariants');
    }
    return { before, after, recoveredNativeResult: native };
  } finally { context.destroy(); }
}

// eslint-disable-next-line no-console
console.log(JSON.stringify(await demonstrateContextFreshness(), null, 2));
