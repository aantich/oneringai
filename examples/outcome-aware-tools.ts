/** C1 offline example. Build first; no credentials or external services are used. */
import { pathToFileURL } from 'node:url';
import { createOutcomeTool, ToolManager } from '@everworker/oneringai';
import type { ToolExecutionReport } from '@everworker/oneringai';

export async function demonstrateOutcomeTools(): Promise<ToolExecutionReport[]> {
  const manager = new ToolManager();
  // The same frozen application value can describe a valid decline or a caught
  // operational failure. Its fields never determine framework status.
  const raw = Object.freeze({ success: false, message: 'No record returned' });
  const definition = (name: string) => ({ type: 'function' as const,
    function: { name, description: 'Synthetic offline lookup', parameters: { type: 'object', properties: {} } } });
  const declined = createOutcomeTool({ definition: definition('declined_lookup'), execute: async () => raw });
  const unavailable = createOutcomeTool({ definition: definition('unavailable_lookup'), execute: async (_args, invocation) => {
    try { throw new Error('Synthetic service unavailable'); }
    catch (error) {
      invocation.reportFailure(error as Error); // Use a public-safe operational message.
      return raw;
    }
  } });
  manager.register(declined); manager.register(unavailable);
  try {
    const accepted = await manager.executeWithOutcome('declined_lookup', {});
    const failed = await manager.executeWithOutcome('unavailable_lookup', {});
    if (accepted.result !== raw || failed.result !== raw || accepted.outcome.status !== 'succeeded' || failed.outcome.status !== 'failed') {
      throw new Error('Invocation outcome demonstration failed');
    }
    // Direct execution preserves the callback's raw return, without an admitted
    // framework outcome. executeWithOutcome is the semantic diagnostic surface.
    if (await unavailable.execute({}) !== raw) throw new Error('Direct return changed');
    return [accepted, failed];
  } finally { manager.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const report of await demonstrateOutcomeTools()) {
    console.log(report.outcome.toolName, report.outcome.status, report.result);
  }
}
