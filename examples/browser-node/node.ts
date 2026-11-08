/** Build first. npm run example:browser-node. Local scripted HTTP only. */
import { startGateway } from './gateway.js';
import { runSharedScenario } from './shared.js';
import { DemoMemorySessions } from './memory-sessions.js';
const gateway = await startGateway();
try {
  const report = await runSharedScenario({ baseURL: gateway.origin + '/gateway/node/v1', connector: 'browser-node-offline', storage: new DemoMemorySessions() });
  console.log(JSON.stringify({ host: 'node', ...report }, null, 2));
} finally { await gateway.close(); }
