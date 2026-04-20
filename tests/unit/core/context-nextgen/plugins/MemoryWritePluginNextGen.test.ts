/**
 * MemoryWritePluginNextGen unit tests.
 *
 * Coverage:
 *   - Constructor guards (memory / agentId / userId required)
 *   - getTools() returns exactly the 5 write tools, cached across calls
 *   - getInstructions() returns the write block (not null, mentions each tool)
 *   - getContent() returns null (side-effect plugin, no system-message body)
 *   - Token accounting: getTokenSize=0, getInstructionsTokenSize>0
 *   - getOwnSubjectIds callback is threaded into write tools ("me" resolves)
 *   - destroy() clears cached tools and flips isDestroyed
 *   - getState / restoreState round-trip shape
 *   - Shared-instance sanity: write + read tools on the same MemorySystem see each other's writes
 */

import { describe, it, expect } from 'vitest';
import { MemoryWritePluginNextGen } from '@/core/context-nextgen/plugins/MemoryWritePluginNextGen.js';
import { MemoryPluginNextGen } from '@/core/context-nextgen/plugins/MemoryPluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER_ID = 'test-user';
const AGENT_ID = 'test-agent';

function makeMem(): MemorySystem {
  return new MemorySystem({ store: new InMemoryAdapter() });
}

describe('MemoryWritePluginNextGen — constructor guards', () => {
  it('throws when memory is missing', () => {
    expect(
      () =>
        new MemoryWritePluginNextGen({
          memory: undefined as any,
          agentId: AGENT_ID,
          userId: USER_ID,
        }),
    ).toThrow(/memory/);
  });

  it('throws when agentId is missing', () => {
    const mem = makeMem();
    expect(
      () =>
        new MemoryWritePluginNextGen({
          memory: mem,
          agentId: undefined as any,
          userId: USER_ID,
        }),
    ).toThrow(/agentId/);
  });

  it('throws when userId is missing (owner invariant)', () => {
    const mem = makeMem();
    expect(
      () =>
        new MemoryWritePluginNextGen({
          memory: mem,
          agentId: AGENT_ID,
          userId: undefined as any,
        }),
    ).toThrow(/userId/);
  });
});

describe('MemoryWritePluginNextGen — tools', () => {
  it('returns exactly the 5 write tools, cached across calls', () => {
    const mem = makeMem();
    const plugin = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const tools = plugin.getTools();
    const names = tools.map((t) => t.definition.function.name).sort();
    expect(names).toEqual([
      'memory_forget',
      'memory_link',
      'memory_remember',
      'memory_restore',
      'memory_upsert_entity',
    ]);
    expect(plugin.getTools()).toBe(tools); // cached
  });

  it('has no overlap with MemoryPluginNextGen read tools', () => {
    const mem = makeMem();
    const readPlugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const writePlugin = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const readNames = new Set(readPlugin.getTools().map((t) => t.definition.function.name));
    const writeNames = new Set(writePlugin.getTools().map((t) => t.definition.function.name));
    for (const n of writeNames) expect(readNames.has(n)).toBe(false);
  });
});

describe('MemoryWritePluginNextGen — instructions + content', () => {
  it('getInstructions returns the write block mentioning every tool', () => {
    const mem = makeMem();
    const plugin = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const text = plugin.getInstructions() ?? '';
    expect(text).toMatch(/memory_remember/);
    expect(text).toMatch(/memory_link/);
    expect(text).toMatch(/memory_forget/);
    expect(text).toMatch(/memory_restore/);
    expect(text).toMatch(/memory_upsert_entity/);
  });

  it('getContent returns null (side-effect plugin)', async () => {
    const mem = makeMem();
    const plugin = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    expect(await plugin.getContent()).toBeNull();
  });

  it('getTokenSize is 0; getInstructionsTokenSize > 0', () => {
    const mem = makeMem();
    const plugin = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    expect(plugin.getTokenSize()).toBe(0);
    expect(plugin.getInstructionsTokenSize()).toBeGreaterThan(0);
    // Second call cached.
    const first = plugin.getInstructionsTokenSize();
    expect(plugin.getInstructionsTokenSize()).toBe(first);
  });
});

describe('MemoryWritePluginNextGen — getOwnSubjectIds threading', () => {
  it('"me" resolves via the supplied callback', async () => {
    const mem = makeMem();
    // Seed a user entity that getOwnSubjectIds will point at.
    const userRes = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Alice',
        identifiers: [{ kind: 'email', value: 'alice@a.com' }],
      },
      { userId: USER_ID },
    );

    const plugin = new MemoryWritePluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      getOwnSubjectIds: () => ({ userEntityId: userRes.entity.id }),
    });

    const remember = plugin
      .getTools()
      .find((t) => t.definition.function.name === 'memory_remember');
    expect(remember).toBeDefined();

    // Use the "me" token — should route to the seeded entity.
    const result: any = await remember!.execute(
      { subject: 'me', predicate: 'likes', value: 'coffee' },
      { userId: USER_ID },
    );
    expect(result.error).toBeUndefined();
    expect(result.fact.subjectId).toBe(userRes.entity.id);
  });

  it('without a callback, "me" returns an error from the tool', async () => {
    const mem = makeMem();
    const plugin = new MemoryWritePluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    const remember = plugin
      .getTools()
      .find((t) => t.definition.function.name === 'memory_remember');
    const result: any = await remember!.execute(
      { subject: 'me', predicate: 'likes', value: 'coffee' },
      { userId: USER_ID },
    );
    expect(typeof result.error).toBe('string');
  });
});

describe('MemoryWritePluginNextGen — lifecycle', () => {
  it('destroy clears cached tools and flips isDestroyed', () => {
    const mem = makeMem();
    const plugin = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const before = plugin.getTools();
    expect(before.length).toBe(5);
    plugin.destroy();
    expect(plugin.isDestroyed).toBe(true);
    // Re-calling getTools after destroy currently re-creates (consistent with
    // MemoryPluginNextGen's behavior). If that ever changes, update this test.
    const after = plugin.getTools();
    expect(after.length).toBe(5);
  });

  it('getState / restoreState round-trips identity shape', () => {
    const mem = makeMem();
    const a = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const state = a.getState();
    const b = new MemoryWritePluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    expect(() => b.restoreState(state)).not.toThrow();
    // State is identity-only; no mutable content to compare.
    expect((state as any).agentId).toBe(AGENT_ID);
    expect((state as any).userId).toBe(USER_ID);
  });
});

describe('MemoryWritePluginNextGen — co-op with MemoryPluginNextGen over shared store', () => {
  it('facts written by write tool are visible to read tool on the same MemorySystem', async () => {
    const mem = makeMem();

    // Seed user entity + have read plugin bootstrap it.
    const readPlugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    await readPlugin.getContent(); // triggers bootstrap
    const ids = readPlugin.getBootstrappedIds();
    expect(ids.userEntityId).toBeDefined();

    const writePlugin = new MemoryWritePluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      getOwnSubjectIds: () => readPlugin.getBootstrappedIds(),
    });

    const remember = writePlugin
      .getTools()
      .find((t) => t.definition.function.name === 'memory_remember')!;
    await remember.execute(
      { subject: 'me', predicate: 'favourite_color', value: 'teal' },
      { userId: USER_ID },
    );

    const listFacts = readPlugin
      .getTools()
      .find((t) => t.definition.function.name === 'memory_list_facts')!;
    const r: any = await listFacts.execute({ subject: 'me' }, { userId: USER_ID });
    const match = r.facts.find(
      (f: any) => f.predicate === 'favourite_color' && f.value === 'teal',
    );
    expect(match).toBeDefined();
  });
});
