/** Additive Stage 02 consumer, compiled against the built public package. */
import { ToolManager } from '@everworker/oneringai';
import type { ToolFunction, IToolExecutionPipeline, IToolExecutionPlugin, ToolExecutionOutcome, ToolExecutionReport } from '@everworker/oneringai';
import type { ToolExecutionOptions } from '@everworker/oneringai/types';

// Existing third-party two-argument pipeline implementations remain assignable.
export class LegacyPipeline implements IToolExecutionPipeline {
  use(_plugin: IToolExecutionPlugin): this { return this; }
  remove(_name: string): boolean { return false; }
  has(_name: string): boolean { return false; }
  get(_name: string): IToolExecutionPlugin | undefined { return undefined; }
  list(): IToolExecutionPlugin[] { return []; }
  async execute(tool: ToolFunction, args: unknown): Promise<unknown> { return tool.execute(args); }
}
export async function inspect(manager: ToolManager, signal: AbortSignal): Promise<ToolExecutionOutcome> {
  const options: ToolExecutionOptions = { signal, timeoutMs: 100, callId: 'consumer-call', runId: 'consumer-run' };
  const report: ToolExecutionReport = await manager.executeWithOutcome('legacy_probe', {}, options);
  return report.outcome;
}
