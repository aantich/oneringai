/** Explicit offline entrypoints only: no credentials or provider calls. Build first. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const examples = [
  'examples/custom-context-plugin.ts',
  'examples/plugin-instructions-and-data.ts',
  'examples/agentic-evaluation-baseline.ts', 'examples/context-strategy-comparison.ts',
  'examples/adaptive-model-routing.ts', 'examples/verified-routines.ts', 'examples/routine-store-bridge.ts',
  'examples/agent-runtime-swappable.ts', 'examples/agent-runtime-claude.ts',
  'examples/agent-runtime-openai-managed.ts', 'examples/agent-runtime-claude-managed.ts',
  'examples/agent-runtime-artifacts.ts', 'examples/agent-runtime-recovery.ts',
  'examples/agent-runtime-managed-restart.ts', 'examples/agent-runtime-run-options.ts',
  'examples/agent-runtime-safety.ts', 'apps/amos/examples/agent-runtime-offline.ts',
  'examples/connector-collection-pages.ts', 'examples/enhanced-connector-execution.ts',
  'examples/remote-tool-outcomes.ts', 'examples/composite-execution-binding.ts',
  'examples/outcome-aware-tools.ts', 'examples/composed-meeting-preparation.ts',
  'examples/endpoint-capabilities.ts', 'examples/parameter-policy.ts', 'examples/vendor-presentation.ts',
  'examples/native-context-compaction.ts', 'examples/native-context-recovery.ts',
  'apps/amos/examples/native-compaction-offline.ts',
];
const results = [];
for (const file of examples) {
  const start = Date.now();
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], {
    encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ONERINGAI_ALLOW_LIVE: '0' },
  });
  const passed = result.status === 0 && !result.error;
  results.push({ file, status: passed ? 'pass' : 'failed', ms: Date.now() - start });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${file}`);
  if (!passed) console.error(result.error?.message ?? `${result.stderr}\n${result.stdout}`);
}
const index = process.argv.indexOf('--report');
if (index >= 0) writeFileSync(process.argv[index + 1], JSON.stringify(results, null, 2) + '\n');
if (results.some(result => result.status !== 'pass')) process.exitCode = 1;
