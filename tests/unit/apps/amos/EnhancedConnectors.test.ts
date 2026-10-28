import { afterEach, expect, it, vi } from 'vitest';
import { Connector, ConnectorTools, ToolManager } from '@everworker/oneringai';
import { describeToolOutcome } from '../../../../apps/amos/src/agent/toolOutcomes.js';
afterEach(() => { vi.unstubAllGlobals(); Connector.clear(); });
it('AMOS renders an actual selected-factory failure through its existing outcome adapter', async () => {
  Connector.create({ name: 'amos-slack', serviceType: 'slack', baseURL: 'https://slack.com/api', auth: { type: 'api_key', apiKey: 'synthetic' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":false,"error":"missing_scope"}', { headers: { 'Content-Type': 'application/json' } })));
  const manager = new ToolManager(); manager.registerConnectorTools('amos-slack', ConnectorTools.enhanced('amos-slack', { profile: 'execution-v1' }));
  try {
    const report = await manager.executeWithOutcome('amos-slack_get_channel_info_exec', { channel: 'C1' });
    expect(report.outcome.status).toBe('failed'); expect(describeToolOutcome(report.outcome)).toContain('missing_scope'); expect(report.result).toMatchObject({ success: false });
  } finally { manager.destroy(); }
});
