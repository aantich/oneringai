import { afterEach, expect, it, vi } from 'vitest';
import { Connector, ConnectorTools, ToolManager } from '@everworker/oneringai';
import { describeCollectionPage } from '../../../../apps/amos/src/agent/collectionPages.js';
afterEach(() => { vi.unstubAllGlobals(); Connector.clear(); });
it('AMOS describes an actual page as returned count, position and coverage without a false total', async () => {
  Connector.create({ name: 'amos-drive', serviceType: 'google-api', baseURL: 'https://www.googleapis.com', auth: { type: 'api_key', apiKey: 'synthetic' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"files":[{"id":"one"},{"id":"two"}],"incompleteSearch":true}', { headers: { 'Content-Type': 'application/json' } })));
  const manager = new ToolManager(); manager.registerConnectorTools('amos-drive', ConnectorTools.enhanced('amos-drive', { profile: 'collections-v1' }));
  try {
    const report = await manager.executeWithOutcome('amos-drive_list_files_page', { pageSize: 1 }); expect(report.outcome.status).toBe('succeeded');
    expect(describeCollectionPage('amos-drive_list_files_page', report.result)).toBe('Returned 2 items; end of provider pagination; search coverage incomplete.');
  } finally { manager.destroy(); }
});
it('AMOS preserves legacy/custom rendering and distinguishes a provider-reported total', () => {
  const value = { items: [1], returnedCount: 1, reportedTotal: 20, searchCoverage: 'unknown', position: { state: 'more', continuation: 'opaque', positionId: 'id' } };
  expect(describeCollectionPage('source_list_page', value)).toContain('Returned 1 items; provider reports 20; more pages available; search coverage unknown');
  expect(describeCollectionPage('legacy_list', value)).toBeNull(); expect(describeCollectionPage('source_list_page', { ...value, returnedCount: 100 })).toBeNull();
});
