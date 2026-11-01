/** Create the agent once, bind all five harnesses; actual adapters with offline transports. */
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import { Connector } from 'oneringai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harnessFixtureIds, offlineHarness } from './agent-runtime/harness-fixtures.js';
import { canonicalJSON, usageSummary } from './agentic-baseline/reporter.js';

const root = await mkdtemp(path.join(tmpdir(), 'onering-swappable-'));
const fixtures = harnessFixtureIds.map(driver => offlineHarness(driver, root));
const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: fixtures.map(fixture => fixture.implementation), sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'shared-control')), resolveTools: () => fixtures[0]!.toolResolution }) });
try {
  const agent = runtime.createAgent(fixtures[0]!.definition); let expectedCalls = 0;
  for (const fixture of fixtures) {
    const inspection = await agent.inspect(fixture.options);
    const session = await agent.openSession(fixture.options);
    for (const input of ['first', 'continue']) {
      const run = await session.run(input, { requestId: input }); const result = await run.result;
      expectedCalls++;
      if (result.status !== 'completed' || result.outputText !== 'ACK' || fixtures[0]!.calls() !== expectedCalls) throw new Error(JSON.stringify({ result, calls: fixtures[0]!.calls(), expectedCalls }));
      console.log(canonicalJSON({ mocked: true, driver: fixture.options.execution.driver, digest: inspection.definitionDigest, outputText: result.outputText, toolCalls: 1, inputUsage: usageSummary([result.usage?.inputTokens ?? null]) }));
    }
    await runtime.deleteSession(session.reference(), { context: fixture.options.context });
  }
} finally { await runtime.destroy(); await Promise.all(fixtures.map(fixture => fixture.runtime.destroy())); Connector.clear(); await rm(root, { recursive: true, force: true }); }
