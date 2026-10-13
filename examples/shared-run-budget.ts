/** Deterministic offline reservation, exhaustion and unknown-price demonstration. Build first. */
import { pathToFileURL } from 'node:url';
import { ModelTask, ModelBudgetExceededError } from '@everworker/oneringai';
import type { ModelCallDescriptor } from '@everworker/oneringai';

export async function demonstrateSharedBudget(): Promise<void> {
  const task = new ModelTask({ limits: { maxCalls: 3, maxTokens: 100 } });
  const unknownPrice = new ModelTask({ limits: { maxCostUSD: 1 } });
  const request: ModelCallDescriptor = { purpose: 'offline-model', connector: 'offline', model: 'offline-model', inputTokenBound: 80, outputTokenBound: 20 };
  const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
  let release!: () => void;
  try {
    const admitted = task.execute(request, async () => { await new Promise<void>(resolve => { release = resolve; }); return usage; }, { usage: u => u });
    void admitted.catch(() => undefined);
    await task.execute(request, async () => usage).then(() => { throw new Error('Concurrent overcommit was incorrectly admitted'); }, error => {
      if (!(error instanceof ModelBudgetExceededError)) throw error;
      console.log('Concurrent reservation rejected before dispatch.');
    });
    release(); await admitted;
    await task.execute({ ...request, inputTokenBound: 60 }, async () => usage, { usage: u => u });
    const external = { id: 'external-once', purpose: 'external-report', connector: 'offline', model: 'offline-model', usage };
    task.recordExternal(external); task.recordExternal(external);
    if (task.snapshot().totals.totalTokens !== 45 || task.snapshot().totals.calls !== 3) throw new Error('Usage was counted twice');
    await unknownPrice.execute(request, async () => usage).then(() => { throw new Error('Unknown-priced request was incorrectly admitted'); }, error => {
      if (!(error instanceof ModelBudgetExceededError)) throw error;
      console.log('Hard monetary ceiling rejected unknown prices. Token/call limits can still be used.');
    });
    console.log(JSON.stringify(task.snapshot().totals, null, 2));
    console.log('All usage is synthetic. Unknown model prices remain unknown; no LLM calls made.');
  } finally { release?.(); task.destroy(); unknownPrice.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await demonstrateSharedBudget();
