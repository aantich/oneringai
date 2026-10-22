/** Four-policy functional pilot; --live makes bounded billable OpenAI main/helper/native calls. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { comparisonTasks, compareContextStrategy } from './context-strategy-comparison.js';
dotenv.config({ quiet: true });
const live = process.argv.includes('--live');
const task = comparisonTasks['held-out'][0]!;
const results = [];
for (const strategy of ['algorithmic', 'observation-masking', 'structured-summary', 'context-compaction'] as const) {
  const result = await compareContextStrategy(task, strategy, live, { mainModel: 'gpt-6-astra', compactionThreshold: .6 });
  results.push(result);
  console.log(strategy, result.predicate, result.usage.totals, result.errorDetails ?? '');
  assert.equal(result.passed, true, `${strategy}: ${JSON.stringify(result.errorDetails ?? result.predicate)}`);
  if (strategy === 'context-compaction') assert.equal(result.nativeCompaction?.history.status, 'compacted');
}
const report = { protocol: 'stage-16a-comparison-v1', live, recordedAt: new Date().toISOString(),
  scope: 'One fixed held-out synthetic read-only task, identical source/result and host completion predicates. Native uses the main model; structured summary uses a configured helper. Offline results are scripted protocol checks. This pilot does not establish comparative quality, cost, or statistical non-inferiority.', results };
if (process.env.NATIVE_COMPARISON_REPORT_PATH) await writeFile(process.env.NATIVE_COMPARISON_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
