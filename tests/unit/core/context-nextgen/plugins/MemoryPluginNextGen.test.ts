/**
 * MemoryPluginNextGen unit tests.
 *
 * Coverage:
 *   - Constructor guards
 *   - Entity bootstrap (idempotent, identifier-keyed, uses configured perms)
 *   - getContent rendering: user + agent profile blocks, topFacts, empty-profile placeholder
 *   - Injection config variants: topFacts=0, factPredicates whitelist, identifiers on/off
 *   - Cache + write-invalidation
 *   - Graceful degradation when memory throws
 *   - userId-unset degraded mode (agent-only)
 *   - getTools() returns 8 tools
 *   - serialize / restoreState round trip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryPluginNextGen } from '@/core/context-nextgen/plugins/MemoryPluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER_ID = 'test-user';
const AGENT_ID = 'test-agent';

function makeMem(opts?: { profileGenerator?: { generate: any } }) {
  return new MemorySystem({
    store: new InMemoryAdapter(),
    profileGenerator: opts?.profileGenerator,
  });
}

async function seedUserProfile(
  mem: MemorySystem,
  userEntityId: string,
  details: string,
): Promise<void> {
  await mem.addFact(
    {
      subjectId: userEntityId,
      predicate: 'profile',
      kind: 'document',
      details,
      summaryForEmbedding: details.slice(0, 80),
    },
    { userId: USER_ID },
  );
}

describe('MemoryPluginNextGen — constructor guards', () => {
  it('throws when memory is missing', () => {
    expect(
      () => new MemoryPluginNextGen({ memory: undefined as any, agentId: AGENT_ID }),
    ).toThrow(/memory/);
  });

  it('throws when agentId is missing', () => {
    const mem = makeMem();
    expect(
      () => new MemoryPluginNextGen({ memory: mem, agentId: undefined as any, userId: USER_ID }),
    ).toThrow(/agentId/);
  });

  it('throws when userId is missing (owner invariant)', () => {
    const mem = makeMem();
    expect(
      () => new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: undefined as any }),
    ).toThrow(/userId/);
  });
});

describe('MemoryPluginNextGen — entity bootstrap', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = makeMem();
  });

  it('creates user + agent entities on first getContent, idempotent across calls', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const out1 = await plugin.getContent();
    const ids1 = plugin.getBootstrappedIds();
    expect(ids1.userEntityId).toBeDefined();
    expect(ids1.agentEntityId).toBeDefined();
    expect(out1).toMatch(/## Agent Profile/);
    expect(out1).toMatch(/## Your User Profile/);

    // Second call returns same entity ids (identifier-keyed upsert is idempotent).
    const plugin2 = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin2.getContent();
    const ids2 = plugin2.getBootstrappedIds();
    expect(ids2.userEntityId).toBe(ids1.userEntityId);
    expect(ids2.agentEntityId).toBe(ids1.agentEntityId);
  });

  it('stamps configured permissions on bootstrapped entities', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      agentEntityPermissions: { group: 'read', world: 'none' },
      userEntityPermissions: { group: 'none', world: 'none' },
    });
    await plugin.getContent();
    const { agentEntityId, userEntityId } = plugin.getBootstrappedIds();
    const agent = await mem.getEntity(agentEntityId!, { userId: USER_ID });
    const user = await mem.getEntity(userEntityId!, { userId: USER_ID });
    expect(agent!.permissions).toEqual({ group: 'read', world: 'none' });
    expect(user!.permissions).toEqual({ group: 'none', world: 'none' });
  });

});

describe('MemoryPluginNextGen — injection shape', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = makeMem();
  });

  it('renders profile details when present, placeholder otherwise', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    // Bootstrap first so we can target the user entity with a profile fact.
    await plugin.getContent();
    const { userEntityId } = plugin.getBootstrappedIds();
    await seedUserProfile(mem, userEntityId!, 'Alice is a power user who prefers concise replies.');

    plugin.invalidate();
    const out = await plugin.getContent();
    expect(out).toMatch(/Alice is a power user/);
    // Agent profile still placeholder.
    expect(out).toMatch(/No profile yet/);
  });

  it('renders top-ranked facts under "Recent top facts"', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      userProfileInjection: { topFacts: 3 },
    });
    await plugin.getContent();
    const { userEntityId } = plugin.getBootstrappedIds();
    for (let i = 0; i < 3; i++) {
      await mem.addFact(
        {
          subjectId: userEntityId!,
          predicate: 'prefers',
          kind: 'atomic',
          value: `preference_${i}`,
          importance: 0.8,
        },
        { userId: USER_ID },
      );
    }
    plugin.invalidate();
    const out = await plugin.getContent();
    expect(out).toMatch(/Recent top facts/);
    expect(out).toMatch(/preference_/);
  });

  it('topFacts=0 omits the facts section entirely', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      userProfileInjection: { topFacts: 0 },
    });
    await plugin.getContent();
    const { userEntityId } = plugin.getBootstrappedIds();
    await mem.addFact(
      {
        subjectId: userEntityId!,
        predicate: 'prefers',
        kind: 'atomic',
        value: 'x',
      },
      { userId: USER_ID },
    );
    plugin.invalidate();
    const out = await plugin.getContent();
    expect(out).not.toMatch(/Recent top facts/);
  });

  it('factPredicates whitelist filters recent facts', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      userProfileInjection: { topFacts: 20, factPredicates: ['prefers'] },
    });
    await plugin.getContent();
    const { userEntityId } = plugin.getBootstrappedIds();
    await mem.addFact(
      { subjectId: userEntityId!, predicate: 'prefers', kind: 'atomic', value: 'concise' },
      { userId: USER_ID },
    );
    await mem.addFact(
      { subjectId: userEntityId!, predicate: 'dislikes', kind: 'atomic', value: 'verbose' },
      { userId: USER_ID },
    );
    plugin.invalidate();
    const out = await plugin.getContent();
    expect(out).toMatch(/prefers: "concise"/);
    expect(out).not.toMatch(/dislikes/);
  });

  it('identifiers: true renders the identifier list', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      userProfileInjection: { identifiers: true },
    });
    const out = await plugin.getContent();
    expect(out).toMatch(/Identifiers/);
    expect(out).toMatch(/system_user_id=test-user/);
  });
});

describe('MemoryPluginNextGen — cache + invalidation', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = makeMem();
  });

  it('cached getContent avoids re-fetching until TTL expires or dirty is set', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      contentCacheMs: 10_000,
    });
    const getContextSpy = vi.spyOn(mem, 'getContext');
    const first = await plugin.getContent();
    const callsAfterFirst = getContextSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second call within TTL — no new getContext calls.
    const second = await plugin.getContent();
    expect(second).toBe(first);
    expect(getContextSpy.mock.calls.length).toBe(callsAfterFirst);

    // Invalidate explicitly — third call re-fetches.
    plugin.invalidate();
    await plugin.getContent();
    expect(getContextSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('contentCacheMs=0 disables caching (always re-renders)', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      contentCacheMs: 0,
    });
    const spy = vi.spyOn(mem, 'getContext');
    await plugin.getContent();
    const afterFirst = spy.mock.calls.length;
    await plugin.getContent();
    expect(spy.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('tool-driven writes through onWriteToOwnSubjects flip the dirty flag', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    await plugin.getContent();
    const spy = vi.spyOn(mem, 'getContext');
    const before = spy.mock.calls.length;

    // Simulate the remember tool invoking onWriteToOwnSubjects via getTools.
    const tools = plugin.getTools();
    const remember = tools.find((t) => t.definition.function.name === 'memory_remember')!;
    await remember.execute(
      { subject: 'me', predicate: 'prefers', value: 'tests' },
      { userId: USER_ID },
    );
    // Next render should re-fetch because dirty flipped.
    await plugin.getContent();
    expect(spy.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('MemoryPluginNextGen — graceful degradation', () => {
  it('returns placeholder + logs on memory error instead of throwing', async () => {
    const mem = makeMem();
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    // Make getContext throw — bootstrap still runs OK, but content render fails.
    await plugin.getContent();
    vi.spyOn(mem, 'getContext').mockRejectedValue(new Error('DB down'));
    plugin.invalidate();
    const out = await plugin.getContent();
    expect(out).toMatch(/memory unavailable/);
    // No throw — placeholder returned.
  });
});

describe('MemoryPluginNextGen — getTools', () => {
  it('returns exactly the 8 memory tools, cached across calls', () => {
    const mem = makeMem();
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const tools = plugin.getTools();
    const names = tools.map((t) => t.definition.function.name).sort();
    expect(names).toEqual([
      'memory_find_entity',
      'memory_forget',
      'memory_graph',
      'memory_link',
      'memory_list_facts',
      'memory_recall',
      'memory_remember',
      'memory_search',
    ]);
    // Same array on second call (cached).
    expect(plugin.getTools()).toBe(tools);
  });
});

describe('MemoryPluginNextGen — state serialization', () => {
  it('getState + restoreState round-trips entity ids', async () => {
    const mem = makeMem();
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin.getContent();
    const state = plugin.getState();

    const plugin2 = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    plugin2.restoreState(state);
    expect(plugin2.getBootstrappedIds()).toEqual(plugin.getBootstrappedIds());
  });

  it('restoreState ignores unknown versions', () => {
    const mem = makeMem();
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    plugin.restoreState({ version: 999, userEntityId: 'X', agentEntityId: 'Y' });
    expect(plugin.getBootstrappedIds()).toEqual({});
  });
});
