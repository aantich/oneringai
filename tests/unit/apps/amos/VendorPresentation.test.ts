import { it, expect, vi } from 'vitest';
import { VendorCommand } from '../../../../apps/amos/src/commands/commands/VendorCommand.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { IAmosApp } from '../../../../apps/amos/src/config/types.js';
it('uses the shared presentation catalog while preserving all existing AMOS labels and vendor IDs', async () => {
  const connectors = vi.fn((_vendor: string) => []), app = { getConfig: () => structuredClone(DEFAULT_CONFIG), getConnectorManager: () => ({ getVendorConnectors: connectors }) } as unknown as IAmosApp;
  const result = await new VendorCommand().execute({ app, args: ['list'], rawInput: '/vendor list' }); expect(result.success).toBe(true);
  for (const label of ['OpenAI', 'Anthropic', 'Google AI', 'Google Vertex AI', 'Groq', 'Together AI', 'xAI Grok', 'DeepSeek', 'Mistral AI', 'Perplexity', 'Ollama (Local)', 'Custom']) expect(result.message).toContain(label);
  expect(connectors.mock.calls.map(call => call[0])).toContain('custom');
});

it('keeps unknown restored vendor labels explicit instead of reading Object prototype members', async () => {
  const config = structuredClone(DEFAULT_CONFIG); (config as any).activeVendor = 'constructor';
  const app = { getConfig: () => config, getConnectorManager: () => ({ getVendorConnectors: () => [] }) } as unknown as IAmosApp;
  const result = await new VendorCommand().execute({ app, args: ['info'], rawInput: '/vendor info' }); expect(result.message).toContain('Vendor: constructor (constructor)'); expect(result.message).not.toContain('function Object');
});
