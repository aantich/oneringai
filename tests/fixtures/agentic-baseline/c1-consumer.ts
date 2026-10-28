/** Built public API controls; not executed. Existing tool types remain unchanged. */
import { createOutcomeTool, ToolManager } from '@everworker/oneringai';
import type { OutcomeInvocation, OutcomeToolOptions, ToolFunction, ToolContext } from '@everworker/oneringai';

const options: OutcomeToolOptions<{ id: string }, { success: boolean; id: string }> = {
  definition: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: { id: { type: 'string' } } } } },
  execute: async ({ id }, invocation) => {
    const context: ToolContext | undefined = invocation.context;
    void context;
    invocation.reportFailure(new Error('Unavailable'));
    return { success: false, id };
  },
};
const ordinary: ToolFunction<{ id: string }, { success: boolean; id: string }> = createOutcomeTool(options);
const manager = new ToolManager(); manager.register(ordinary);
const invocation = {} as OutcomeInvocation;
// @ts-expect-error Only Error reports are accepted by the new callback.
invocation.reportFailure('unavailable');
// @ts-expect-error The invocation wrapper is not an extra field on legacy ToolContext.
const changedContext: ToolContext = { reportFailure: invocation.reportFailure };
void changedContext;
// @ts-expect-error The new helper preserves argument/result type checking.
createOutcomeTool<{ id: string }, string>({ ...options });
