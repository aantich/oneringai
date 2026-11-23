import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector, ContentType, Vendor } from 'oneringai';
import { describe, expect, it, vi } from 'vitest';
import { CommandProcessor } from '../../../../apps/amos/src/commands/CommandProcessor.js';
import { ConnectorCommand } from '../../../../apps/amos/src/commands/commands/ConnectorCommand.js';
import { ImageCommand } from '../../../../apps/amos/src/commands/commands/ImageCommand.js';
import { ModelCommand } from '../../../../apps/amos/src/commands/commands/ModelCommand.js';
import { DEFAULT_CONFIG, type AmosConfig, type IAmosApp } from '../../../../apps/amos/src/config/types.js';
import { ConnectorManager } from '../../../../apps/amos/src/connectors/ConnectorManager.js';

describe('AMOS local Ollama', () => {
  it('sets up and persists an unauthenticated Inkling connector and activates its model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'amos-ollama-'));
    const name = 'amos-test-inkling-local';
    try {
      const manager = new ConnectorManager(directory);
      let config = structuredClone(DEFAULT_CONFIG);
      const responses = [name, Vendor.Ollama, '', ''];
      const prompt = vi.fn(async () => responses.shift() ?? '');
      const select = vi.fn(async () => 'none');
      const createAgent = vi.fn(async () => {
        expect(config.activeConnector).toBe(name);
        expect(config.activeVendor).toBe(Vendor.Ollama);
        expect(config.activeModel).toBe('inkling-2-mini');
      });
      const app = {
        print: vi.fn(), prompt, select, confirm: vi.fn(async () => true), createAgent,
        getConfig: () => config,
        updateConfig: (updates: Partial<AmosConfig>) => { config = { ...config, ...updates }; },
        saveConfig: vi.fn(), getConnectorManager: () => manager,
      } as unknown as IAmosApp;
      const commands = new CommandProcessor(app);
      commands.register(new ConnectorCommand());

      expect(await commands.execute('/connector add')).toMatchObject({ success: true });
      expect(select).toHaveBeenCalledWith('Authentication type:', ['none', 'api_key', 'oauth']);
      expect(prompt.mock.calls.flat().join('\n')).not.toContain('API Key');
      expect(createAgent).toHaveBeenCalledOnce();
      expect(Connector.get(name).config).toMatchObject({ vendor: Vendor.Ollama, auth: { type: 'none' } });

      manager.unregisterConnector(name);
      const reloaded = new ConnectorManager(directory);
      await reloaded.initialize();
      expect(reloaded.get(name)).toMatchObject({ vendor: Vendor.Ollama, auth: { type: 'none' }, models: ['inkling-2-mini'] });
      reloaded.registerConnector(name);
      expect(Connector.get(name).config.auth).toEqual({ type: 'none' });
    } finally {
      Connector.remove(name);
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('attaches an extensionless image as typed agent input and rejects non-images', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'amos-image-'));
    try {
      const imagePath = join(directory, 'picture with spaces');
      const textPath = join(directory, 'text.jpg');
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3WQAAAAASUVORK5CYII=';
      await writeFile(imagePath, Buffer.from(png, 'base64'));
      await writeFile(textPath, 'just text');

      const commands = new CommandProcessor({ getAgent: () => ({ isReady: () => true }) } as unknown as IAmosApp);
      commands.register(new ImageCommand());
      const result = await commands.execute(`/image "${imagePath}" Describe the image.`);
      expect(result).toMatchObject({
        success: true,
        agentInput: [{ type: 'message', role: 'user', content: [
          { type: ContentType.INPUT_TEXT, text: 'Describe the image.' },
          { type: ContentType.INPUT_IMAGE_URL, image_url: { url: `data:image/png;base64,${png}` } },
        ] }],
      });
      expect(await commands.execute(`/image "${textPath}"`)).toEqual({ success: false, message: 'Choose a PNG, JPEG, or WebP image.' });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('shows Inkling vision, tools and its unpublished output ceiling for a tagged model', async () => {
    const config = { ...structuredClone(DEFAULT_CONFIG), activeModel: 'inkling-2-mini:latest', activeVendor: Vendor.Ollama };
    const commands = new CommandProcessor({ getConfig: () => config } as IAmosApp);
    commands.register(new ModelCommand());
    expect((await commands.execute('/model list')).message).toContain('→ inkling-2-mini [vision, reasoning, tools]');
    const info = (await commands.execute('/model info')).message;
    expect(info).toContain('Output: unknown');
    expect(info).toContain('✓ Vision');
    expect(info).toContain('✓ Function Calling');
  });
});
