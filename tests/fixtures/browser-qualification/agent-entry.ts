import { runSharedScenario } from '../../../examples/browser-node/shared.js';
import { DemoMemorySessions } from '../../../examples/browser-node/memory-sessions.js';
import { runLargeContextScenario } from '../../../examples/browser-node/large-context.js';
import { runPluginRegressions, runTransportRegressions, runLoopRegressions, runSchemaRegressions } from '../browser-consumer/agent-regressions.js';
const run = async (baseURL: string) => runSharedScenario({ baseURL, connector: `browser-${crypto.randomUUID()}`, storage: new DemoMemorySessions() });
const regressions = async (baseURL: string) => ({ plugins: await runPluginRegressions(), transport: await runTransportRegressions(baseURL), loop: await runLoopRegressions(baseURL), schemas: await runSchemaRegressions(baseURL) });
Object.assign(globalThis, { runAgentScenario: run, runLargeContextScenario, runAgentRegressions: regressions });
if (typeof document === 'undefined') globalThis.onmessage = async ({ data }) => {
  try { globalThis.postMessage({ report: data === 'large-context' ? await runLargeContextScenario() : data.regressions ? await regressions(data.regressions) : await run(data) }); }
  catch (error) { globalThis.postMessage({ error: String(error instanceof Error ? error.stack : error) }); }
};
