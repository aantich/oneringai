import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esm = await import('@everworker/oneringai'), cjsPath = require.resolve('@everworker/oneringai');
const cjs = require(cjsPath), duplicateESM = await import(new URL('../../../dist/index.js?enhanced-copy', import.meta.url));
delete require.cache[cjsPath]; const copies = [esm, cjs, duplicateESM, require(cjsPath)];
const originalFetch = globalThis.fetch; let checks = 0, sequence = 0;
try {
  for (const helper of copies) for (const runtime of copies) {
    const name = `profile${sequence++}`; let calls = 0; const attempts = [];
    globalThis.fetch = async () => { calls++; return new Response('{"ok":false,"error":"not_allowed"}', { headers: { 'Content-Type': 'application/json' } }); };
    helper.Connector.create({ name, serviceType: 'slack', baseURL: 'https://slack.com/api', auth: { type: 'api_key', apiKey: 'synthetic' } });
    const oldTools = helper.ConnectorTools.for(name), snapshot = JSON.stringify(oldTools.map(tool => tool.definition));
    const tools = helper.ConnectorTools.enhanced(name, { profile: 'execution-v1', accountId: 'work', timeoutMs: 1000, onAttempt: value => attempts.push(value) });
    const manager = new runtime.ToolManager(); manager.registerConnectorTools(name, tools, { accountId: 'work' });
    const legacy = new runtime.ToolManager(); legacy.registerConnectorTools(name, oldTools);
    try {
      assert.equal(tools.length, 11); checks++;
      const old = await legacy.executeWithOutcome(`${name}_get_channel_info`, { channel: 'C1' });
      const next = await manager.executeWithOutcome(`${name}_work_get_channel_info_exec`, { channel: 'C1' });
      assert.equal(old.outcome.status, 'succeeded'); checks++; assert.equal(next.outcome.status, 'failed'); checks++;
      assert.deepEqual(old.result, next.result); checks++;
      assert.deepEqual(attempts.map(value => value.state), ['dispatched', 'received']); checks++;
      assert.equal(attempts.every(value => value.accountId === 'work'), true); checks++;
      assert.equal(manager.getRegistration(`${name}_work_get_channel_info_exec`).source, `connector:${name}:work`); checks++;
      const before = calls;
      assert.equal((await manager.executeWithOutcome(`${name}_work_api_exec`, { method: 'GET', endpoint: 'https://untrusted.example.test/collect' })).outcome.status, 'denied'); checks++;
      assert.equal(calls, before); checks++;
      assert.equal(JSON.stringify(oldTools.map(tool => tool.definition)), snapshot); checks++;
      globalThis.fetch = async () => new Promise(() => {});
      const controller = new AbortController(); const pending = manager.executeWithOutcome(`${name}_work_get_channel_info_exec`, { channel: 'C1' }, { signal: controller.signal });
      void pending.catch(() => {}); controller.abort();
      await assert.rejects(pending, error => error.outcome?.status === 'cancelled'); checks++;
      manager.registerConnectorTools(name, helper.ConnectorTools.enhanced(name, { profile: 'execution-v1', accountId: 'work', timeoutMs: 5 }), { accountId: 'work' });
      await assert.rejects(manager.executeWithOutcome(`${name}_work_get_channel_info_exec`, { channel: 'C1' }), error => error.outcome?.status === 'timed_out' && error.outcome.timeoutMs === 5); checks++;
      assert.equal(runtime.AGENT_PACKAGE_PROTOCOL_VERSION, 2); checks++;
    } finally { manager.destroy(); legacy.destroy(); helper.Connector.remove(name); }
  }
  for (const library of copies) for (const name of ['buildEnhancedTools', 'registerEnhancedFactory', 'connectorFailure', 'markConnectorExecution', 'attachConnectorAttempts']) { assert.equal(library[name], undefined); checks++; }
} finally { globalThis.fetch = originalFetch; }
console.log(JSON.stringify({ protocol: 'consumer-c4-public-v1', combinations: 16, checks, passed: true }));
