import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, Vendor } from 'oneringai';
import { describe, expect, it, vi } from 'vitest';
import { CommandProcessor } from '../../../../apps/amos/src/commands/CommandProcessor.js';
import { ConnectorCommand } from '../../../../apps/amos/src/commands/commands/ConnectorCommand.js';
import { ModelCommand } from '../../../../apps/amos/src/commands/commands/ModelCommand.js';
import { DEFAULT_CONFIG, type AmosConfig, type IAmosApp } from '../../../../apps/amos/src/config/types.js';
import { ConnectorManager } from '../../../../apps/amos/src/connectors/ConnectorManager.js';

const { listModels, prepareModel, getModelCapabilities } = vi.hoisted(() => ({
  listModels: vi.fn(async () => ['local-text', 'Inkling-2-Mini-oQ4e-mtp']),
  prepareModel: vi.fn(async () => undefined),
  getModelCapabilities: vi.fn((model: string) => ({
    supportsTools: model !== 'local-text', supportsVision: model !== 'local-text',
    supportsJSONSchema: model !== 'local-text', maxTokens: 65536,
  })),
}));
vi.mock('oneringai', async importOriginal => ({
  ...await importOriginal<typeof import('oneringai')>(),
  createProvider: () => ({ listModels, prepareModel, getModelCapabilities }),
}));

describe('AMOS local oMLX', () => {
  it('persists a connector, selects an installed model and reports endpoint capability data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'amos-omlx-'));
    const name = 'amos-test-omlx';
    const model = 'Inkling-2-Mini-oQ4e-mtp';
    try {
      const manager = new ConnectorManager(directory);
      let config = structuredClone(DEFAULT_CONFIG);
      const responses = [name, 'omlx', 'local-test-key', ''];
      const app = {
        print: vi.fn(),
        prompt: vi.fn(async () => responses.shift() ?? ''),
        select: vi.fn(async (_question: string, options: string[]) => options.includes('api_key') ? 'api_key' : model),
        confirm: vi.fn(async () => true),
        createAgent: vi.fn(async () => undefined),
        getConfig: () => config,
        updateConfig: (updates: Partial<AmosConfig>) => { config = { ...config, ...updates }; },
        saveConfig: vi.fn(),
        getConnectorManager: () => manager,
      } as unknown as IAmosApp;
      const commands = new CommandProcessor(app);
      commands.register(new ConnectorCommand());
      commands.register(new ModelCommand());

      expect(await commands.execute('/connector add')).toMatchObject({ success: true });
      expect(config).toMatchObject({ activeConnector: name, activeVendor: Vendor.OMLX, activeModel: model });
      expect(Connector.get(name).config).toMatchObject({ vendor: Vendor.OMLX, auth: { type: 'api_key', apiKey: 'local-test-key' } });
      expect((await commands.execute('/model list')).message).toContain(`→ ${model} [vision, tools]`);
      expect((await commands.execute('/model info')).message).toContain('Native JSON schema: supported without tools');
      expect(await commands.execute('/model local-text')).toMatchObject({ success: true });
      expect(config.activeModel).toBe('local-text');

      manager.unregisterConnector(name);
      const reloaded = new ConnectorManager(directory);
      await reloaded.initialize();
      expect(reloaded.get(name)).toMatchObject({ vendor: Vendor.OMLX, auth: { type: 'api_key' } });
    } finally {
      Connector.remove(name);
      await rm(directory, { force: true, recursive: true });
    }
  });
});
