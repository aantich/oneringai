import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), esm = await import('@everworker/oneringai'), path = require.resolve('@everworker/oneringai');
const cjs = require(path), duplicate = await import(new URL('../../../dist/index.js?collection-copy', import.meta.url)); delete require.cache[path];
const copies = [esm, cjs, duplicate, require(path)], original = globalThis.fetch; let checks = 0, sequence = 0;
try {
  for (const helper of copies) for (const runtime of copies) {
    const name = `pages${sequence++}`; let calls = 0;
    helper.Connector.create({ name, serviceType: 'slack', baseURL: 'https://slack.com/api', auth: { type: 'api_key', apiKey: 'synthetic' } });
    const tools = helper.ConnectorTools.enhanced(name, { profile: 'collections-v1', accountId: 'work' }), manager = new runtime.ToolManager(), other = new runtime.ToolManager();
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ok: true, channels: [{ id: 'one' }, { id: 'two' }], response_metadata: { next_cursor: 'opaque-provider-position' } }), { headers: { 'Content-Type': 'application/json' } }); };
    try {
      manager.registerConnectorTools(name, tools, { accountId: 'work' }); other.registerConnectorTools(name, tools, { accountId: 'work' });
      const first = await manager.executeWithOutcome(`${name}_work_list_channels_page`, { pageSize: 1 }); assert.equal(first.outcome.status, 'succeeded'); checks++;
      assert.equal(first.result.returnedCount, 2); checks++; assert.deepEqual(first.result.items.map(i => i.id), ['one', 'two']); checks++;
      assert.equal(first.result.searchCoverage, 'complete'); checks++; assert.equal(first.result.position.state, 'more'); checks++;
      assert.equal(first.result.position.continuation.includes('opaque-provider-position'), false); checks++;
      manager.registerConnectorTools(name, helper.ConnectorTools.enhanced(name, { profile: 'collections-v1', accountId: 'work' }), { accountId: 'work' });
      const next = await manager.executeWithOutcome(`${name}_work_list_channels_page`, { pageSize: 1, continuation: first.result.position.continuation });
      assert.equal(next.outcome.status, 'succeeded'); checks++; assert.equal(next.result.position.positionId, first.result.position.positionId); checks++;
      const lost = await other.executeWithOutcome(`${name}_work_list_channels_page`, { pageSize: 1, continuation: first.result.position.continuation }); assert.equal(lost.outcome.status, 'failed'); checks++; assert.equal(calls, 2); checks++;
      assert.equal((await manager.executeWithOutcome(`${name}_work_set_channel_topic_strict`, { channel: 'C1', topic: '😀'.repeat(251) })).outcome.status, 'failed'); checks++; assert.equal(calls, 2); checks++;
      assert.equal(manager.list().some(name => name.endsWith('_list_channels')), false); checks++; assert.equal(runtime.AGENT_PACKAGE_PROTOCOL_VERSION, 2); checks++;
    } finally { manager.destroy(); other.destroy(); helper.Connector.remove(name); }
  }
  for (const library of copies) for (const name of ['createCursorCodec', 'selectedConnectorCategories', 'collectionContract', 'managerCursorCodec']) { assert.equal(library[name], undefined); checks++; }
} finally { globalThis.fetch = original; }
console.log(JSON.stringify({ protocol: 'consumer-c5-public-v1', combinations: 16, checks, passed: true }));
