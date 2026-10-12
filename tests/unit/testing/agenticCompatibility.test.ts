import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent, AgentContextNextGen, BasePluginNextGen, Connector, Vendor, DEFAULT_FEATURES,
  FileContextStorage,
} from '../../../src/index.js';
import type { StoredContextSession, ICompactionStrategy, ToolFunction } from '../../../src/index.js';
import { ReplayProvider } from '../../../examples/agentic-baseline/replay-provider.js';

const directories: string[] = [];
const contexts: AgentContextNextGen[] = [];
afterEach(async () => {
  contexts.splice(0).forEach(context => context.destroy());
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('Stage 00 compatibility boundaries', () => {
  it('preserves default features, the algorithmic strategy, and shared ToolManager identity', () => {
    const name = 'stage00-defaults';
    Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ReplayProvider([]) } });
    const agent = Agent.create({ connector: name, model: 'gpt-4o-mini' });
    try {
      expect(agent.tools).toBe(agent.context.tools);
      expect(agent.context.features).toMatchObject({ workingMemory: true, inContextMemory: true, persistentInstructions: false, userInfo: false, toolCatalog: false, sharedWorkspace: false, memory: false, memoryWrite: false });
      expect(agent.context.compactionStrategy.name).toBe('algorithmic');
      expect(agent.listTools()).toContain('store_set');
    } finally { agent.destroy(); Connector.remove(name); }
  });

  it('keeps custom plugin/strategy lifecycle and persistence extension points usable', async () => {
    const destroyed = vi.fn();
    class LegacyPlugin extends BasePluginNextGen {
      readonly name = 'legacy-plugin';
      value = 'read only';
      getInstructions(): string { return 'Retain the constraint.'; }
      async getContent(): Promise<string> { this.updateTokenCache(3); return this.value; }
      getContents(): unknown { return this.value; }
      getState(): unknown { return { value: this.value }; }
      restoreState(state: unknown): void { this.value = (state as { value: string }).value; this.invalidateTokenCache(); }
      destroy(): void { destroyed(); }
    }
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { ...DEFAULT_FEATURES, workingMemory: false, inContextMemory: false } });
    contexts.push(context);
    const plugin = new LegacyPlugin();
    const strategy: ICompactionStrategy = {
      name: 'legacy-strategy', displayName: 'Legacy', description: 'Compatibility probe', threshold: 0.8,
      compact: async () => ({ tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] }),
      consolidate: async () => ({ performed: false, tokensChanged: 0, actions: [] }),
    };
    context.registerPlugin(plugin);
    context.setCompactionStrategy(strategy);
    context.restoreState({ conversation: [], pluginStates: { 'legacy-plugin': { value: 'restored constraint' } }, metadata: { model: 'gpt-4o-mini', savedAt: 1 } });
    expect((await context.prepare()).input).toBeDefined();
    expect(context.getState().pluginStates['legacy-plugin']).toEqual({ value: 'restored constraint' });
    context.destroy(); context.destroy();
    expect(destroyed).toHaveBeenCalledTimes(1);
    contexts.splice(contexts.indexOf(context), 1);
  });

  it('returns application tool payloads intact and does not reinterpret success:false', async () => {
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini' });
    contexts.push(context);
    const payload = { success: false, value: 7, nested: { preserved: true } };
    const tool: ToolFunction = {
      definition: { type: 'function', function: { name: 'compat_payload', parameters: { type: 'object', properties: {} } } },
      execute: async () => payload,
    };
    context.tools.register(tool);
    expect(await context.tools.execute('compat_payload', {})).toEqual(payload);
  });

  it('restores the pinned format-v1 session, source pair, and plugin state without migration', async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), 'oneringai-stage00-'));
    directories.push(baseDirectory);
    const storage = new FileContextStorage({ agentId: 'legacy-stage00', baseDirectory });
    await mkdir(storage.getPath(), { recursive: true });
    const json = await readFile(new URL('../../fixtures/agentic-baseline/session-v1.json', import.meta.url), 'utf8');
    await writeFile(join(storage.getPath(), 'legacy-stage00.json'), json);
    const stored = JSON.parse(json) as StoredContextSession;
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage });
    contexts.push(context);
    expect(await context.load('legacy-stage00')).toBe(true);
    expect(context.getConversation()).toEqual(stored.state.conversation);
    expect(context.systemPrompt).toBe(stored.state.systemPrompt);
    expect(context.getState().pluginStates.in_context_memory).toEqual(stored.state.pluginStates.in_context_memory);
    const prepared = await context.prepare();
    expect(JSON.stringify(prepared.input)).toContain('legacy-call');
    await context.save('roundtrip');
    const next = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage });
    contexts.push(next);
    expect(await next.load('roundtrip')).toBe(true);
    expect(next.getConversation()).toEqual(context.getConversation());
  });

  it('keeps missing and syntactically corrupt session loading graceful', async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), 'oneringai-stage00-'));
    directories.push(baseDirectory);
    const storage = new FileContextStorage({ agentId: 'malformed-stage00', baseDirectory });
    await mkdir(storage.getPath(), { recursive: true });
    await writeFile(join(storage.getPath(), 'broken.json'), '{"state":');
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', storage });
    contexts.push(context);
    expect(await context.load('missing')).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { expect(await context.load('broken')).toBe(false); } finally { warn.mockRestore(); }
    expect(context.getConversation()).toEqual([]);
  });
});
