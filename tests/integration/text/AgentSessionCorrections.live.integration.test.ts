import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import dotenv from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { Agent, AgentContextNextGen, AgentRegistry, BasePluginNextGen, Connector, FileContextStorage, MessageRole, ContentType, ModelTask, Vendor } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_AGENT_PRESETS_LIVE === '1';
const report: Record<string, unknown>[] = [];
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
class JsonExtension extends BasePluginNextGen {
  readonly name = 'json_extension'; value = 'SAVED'; fail = false;
  getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
  override getState() { const value = this.value; return { toJSON() { return { value }; } }; }
  override restoreState(state: unknown) { if (this.fail) { this.value = 'UNCERTAIN'; throw Error('fixture restore refused'); } this.value = (state as { value: string }).value; }
}
afterAll(async () => {
  if (!enabled || !process.env.AGENT_SESSION_CORRECTIONS_REPORT_PATH) return;
  const path = process.env.AGENT_SESSION_CORRECTIONS_REPORT_PATH;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ protocol: 'stage12-session-corrections-live-v1', recordedAt: new Date().toISOString(), scope: 'Actual model continuation after failed shared handoff, JSON-converting plugin restoration and guarded legacy recovery. File storage and local blocked tools; no external writes or quality claim.', report }, null, 2) + '\n');
});
describe.skipIf(!enabled).sequential('Stage 12 session correction continuation', () => {
  for (const p of providers) it(`${p.name} continues from original history and authority after recovery`, async () => {
    if (!p.key) throw Error(`Missing ${p.name} credential for explicitly enabled live gate`);
    const directory = await mkdtemp(join(tmpdir(), 'stage12-session-live-')), name = `stage12-session-${p.name}`;
    Connector.create({ name, vendor: p.vendor, auth: { type: 'api_key', apiKey: p.key } });
    const storage = new FileContextStorage({ agentId: 'host', baseDirectory: directory });
    const context = AgentContextNextGen.create({ model: p.model, storage, journalFilter: [], features: { workingMemory: false, inContextMemory: false } });
    const extension = new JsonExtension(); context.registerPlugin(extension);
    const task = new ModelTask({ limits: { maxCalls: 2 } }); let writes = 0;
    const owner = Agent.create({ connector: name, model: p.model, context, permissions: { blocklist: ['blocked_write'] },
      instructions: 'Remember the marker in the first user message. When asked, return only that exact marker with no extra text.',
      thinking: { enabled: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
      vendorOptions: p.name === 'google' ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } : undefined,
      tools: [{ definition: { type: 'function', function: { name: 'blocked_write', description: 'Local blocked fixture', parameters: { type: 'object', properties: {} } } }, execute: async () => { writes++; } }],
    });
    try {
      const marker = `EXACT_STAGE12_RECOVERED_${p.name.toUpperCase()}`;
      context.addInputItems([{ type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: `Remember this marker: ${marker}` }] }]);
      await owner.saveSession('A'); const good = JSON.parse(JSON.stringify(context.getState()));
      await storage.save('B', { ...good, systemPrompt: 'Rejected candidate history', conversation: [] });
      const policy = owner.policyManager, failure = Error('host rejected notification');
      AgentRegistry.once('agent:registered', ({ agent }) => agent.on('session:loaded', () => { throw failure; }));
      await expect(Agent.resume('B', { connector: name, model: p.model, context, instructions: 'Rejected candidate prompt', session: { storage } })).rejects.toBe(failure);
      expect(context.sessionId).toBe('A'); expect(context.tools.getPermissionManager()).toBe(policy); expect(policy.isDestroyed).toBe(false);
      expect((await owner.tools.executeWithOutcome('blocked_write', {})).outcome.status).toBe('denied'); expect(writes).toBe(0);
      extension.value = 'LATER'; expect(await owner.loadSession('A')).toBe(true); expect(extension.value).toBe('SAVED');
      extension.fail = true; await expect(owner.loadSession('B')).rejects.toThrow('fixture restore refused'); extension.fail = false;
      await storage.save('legacy', { ...good, pluginStates: {} }); expect(await owner.loadSession('legacy')).toBe(true);
      await expect(owner.saveSession()).rejects.toThrow('Checkpoint rollback failed'); expect(extension.value).toBe('UNCERTAIN');
      expect(await owner.loadSession('A')).toBe(true); await owner.saveSession(); expect(extension.value).toBe('SAVED');
      const response = await owner.run('Return the exact marker now.', { modelTask: task }); expect(response.output_text?.trim()).toBe(marker);
      expect(writes).toBe(0); expect(context.tools.getPermissionManager()).toBe(policy);
      report.push({ provider: p.name, model: p.model, passed: true, markerMatches: true, checkpoint: context.sessionId, blockedWrites: writes, pluginValue: extension.value, policyAlive: !policy.isDestroyed, usage: task.snapshot() });
    } catch (error) {
      report.push({ provider: p.name, model: p.model, passed: false, blockedWrites: writes, errorType: error instanceof Error ? error.name : 'unknown' });
      throw Error(`Stage12 session recovery ${p.name} failed; secrets omitted.`, { cause: error instanceof Error && error.name === 'AssertionError' ? error : undefined });
    } finally { owner.destroy(); context.destroy(); task.destroy(); Connector.remove(name); await rm(directory, { recursive: true, force: true }); }
  }, 120000);
});
