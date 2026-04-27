/**
 * MemoryPluginNextGen — User's Active Priorities block + timezone surfacing.
 *
 * Covers:
 *   - Walks `tracks_priority` facts on the user entity, fetches priority
 *     entities, renders them with horizon/weight/deadline/scope tags
 *   - Active-only filter: status='met'/'dropped' priorities are excluded
 *   - Sort order: weight desc, deadline asc as tiebreak
 *   - Section omitted when no `tracks_priority` facts exist
 *   - Section omitted when all referenced priorities are non-active
 *   - Position: priorities block appears immediately after the user profile,
 *     before the org profile (when group bootstrap is configured)
 *   - Timezone line surfaces `metadata.jarvis.tz` on the user entity, in 3rd
 *     person; absent when not set
 *   - Timezone is NOT rendered on the org block (user-only convention by default)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPluginNextGen } from '@/core/context-nextgen/plugins/MemoryPluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER_ID = 'u-pri';
const AGENT_ID = 'a-pri';
const GROUP_ID = 'g-pri';

async function bootstrap(plugin: MemoryPluginNextGen): Promise<{
  userEntityId: string;
  agentEntityId: string;
  groupEntityId?: string;
}> {
  await plugin.getContent();
  const ids = plugin.getBootstrappedIds();
  return {
    userEntityId: ids.userEntityId!,
    agentEntityId: ids.agentEntityId!,
    groupEntityId: ids.groupEntityId,
  };
}

/**
 * Extract just the priorities block from the rendered output. The full output
 * also contains "Recent activity" and "Recent top facts" sections that surface
 * `tracks_priority` facts and reference the same priority displayNames — those
 * are correct (they're activity log entries, not priority claims), but they'd
 * make whole-output substring assertions ambiguous. Scope assertions to the
 * dedicated priorities block to test what we actually mean.
 */
function extractPrioritiesBlock(out: string): string {
  const start = out.indexOf("## User's Active Priorities");
  if (start === -1) return '';
  const after = out.slice(start);
  // Block ends at the next `## ` heading or the closing `</memory-context:`.
  const nextHeading = after.slice(2).search(/\n## /);
  const closing = after.indexOf('</memory-context:');
  let endRel: number;
  if (nextHeading !== -1 && (closing === -1 || nextHeading + 2 < closing)) {
    endRel = nextHeading + 2;
  } else if (closing !== -1) {
    endRel = closing;
  } else {
    endRel = after.length;
  }
  return after.slice(0, endRel);
}

async function seedPriority(
  mem: MemorySystem,
  userEntityId: string,
  args: {
    displayName: string;
    horizon?: 'Q' | 'Y';
    weight?: number;
    deadline?: string;
    status?: 'active' | 'met' | 'dropped';
    scope?: 'personal' | 'team' | 'company';
  },
): Promise<{ priorityId: string }> {
  const { entity } = await mem.upsertEntity(
    {
      type: 'priority',
      displayName: args.displayName,
      identifiers: [
        {
          kind: 'canonical',
          value: `priority:${USER_ID}:${args.displayName.toLowerCase().replace(/\s+/g, '-')}`,
        },
      ],
      metadata: {
        jarvis: {
          priority: {
            horizon: args.horizon,
            weight: args.weight,
            deadline: args.deadline,
            status: args.status ?? 'active',
            scope: args.scope,
          },
        },
      },
    },
    { userId: USER_ID },
  );
  await mem.addFact(
    {
      subjectId: userEntityId,
      predicate: 'tracks_priority',
      kind: 'atomic',
      objectId: entity.id,
    },
    { userId: USER_ID },
  );
  return { priorityId: entity.id };
}

describe("MemoryPluginNextGen — User's Active Priorities", () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  it('omits the section entirely when no tracks_priority facts exist', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const out = (await plugin.getContent())!;
    expect(out).not.toMatch(/User's Active Priorities/);
  });

  it('renders one bullet per active priority with horizon/weight/deadline/scope tags', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);

    await seedPriority(mem, userEntityId, {
      displayName: 'Ship NA launch',
      horizon: 'Q',
      weight: 0.8,
      deadline: '2026-06-30T00:00:00Z',
      scope: 'team',
    });

    const out = (await plugin.getContent())!;
    expect(out).toMatch(/## User's Active Priorities/);
    expect(out).toContain('Ship NA launch');
    expect(out).toContain('horizon=Q');
    expect(out).toContain('weight=0.80');
    // MemorySystem.upsertEntity coerces ISO-string metadata fields to Date,
    // so the renderer round-trips via Date.toISOString() — always with .000Z.
    expect(out).toContain('deadline=2026-06-30T00:00:00.000Z');
    expect(out).toContain('scope=team');
  });

  it('excludes priorities with status met or dropped', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);

    await seedPriority(mem, userEntityId, {
      displayName: 'Active goal',
      weight: 0.9,
      status: 'active',
    });
    await seedPriority(mem, userEntityId, {
      displayName: 'Done goal',
      weight: 0.7,
      status: 'met',
    });
    await seedPriority(mem, userEntityId, {
      displayName: 'Abandoned goal',
      weight: 0.6,
      status: 'dropped',
    });

    const out = (await plugin.getContent())!;
    const block = extractPrioritiesBlock(out);
    expect(block).toContain('Active goal');
    expect(block).not.toContain('Done goal');
    expect(block).not.toContain('Abandoned goal');
  });

  it('omits the section when ALL referenced priorities are non-active', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);

    await seedPriority(mem, userEntityId, {
      displayName: 'Done goal',
      status: 'met',
    });

    const out = (await plugin.getContent())!;
    expect(out).not.toMatch(/User's Active Priorities/);
  });

  it('sorts by weight desc, deadline asc as tiebreak', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);

    await seedPriority(mem, userEntityId, { displayName: 'Light goal', weight: 0.2 });
    await seedPriority(mem, userEntityId, {
      displayName: 'Heavy late',
      weight: 0.9,
      deadline: '2026-12-31T00:00:00Z',
    });
    await seedPriority(mem, userEntityId, {
      displayName: 'Heavy soon',
      weight: 0.9,
      deadline: '2026-06-01T00:00:00Z',
    });

    const block = extractPrioritiesBlock((await plugin.getContent())!);
    const heavySoonIdx = block.indexOf('Heavy soon');
    const heavyLateIdx = block.indexOf('Heavy late');
    const lightIdx = block.indexOf('Light goal');

    expect(heavySoonIdx).toBeGreaterThan(-1);
    expect(heavyLateIdx).toBeGreaterThan(-1);
    expect(lightIdx).toBeGreaterThan(-1);
    // Heavy soon (same weight as Heavy late, earlier deadline) wins tiebreak.
    expect(heavySoonIdx).toBeLessThan(heavyLateIdx);
    // Both heavy beat light.
    expect(heavyLateIdx).toBeLessThan(lightIdx);
  });

  it('priorities block appears IMMEDIATELY after the user profile, before the org block', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      groupId: GROUP_ID,
      groupBootstrap: { displayName: 'Acme Inc.' },
    });
    const { userEntityId } = await bootstrap(plugin);
    await seedPriority(mem, userEntityId, { displayName: 'Goal A', weight: 0.8 });

    const out = (await plugin.getContent())!;
    const userIdx = out.indexOf('## About the User');
    const prioritiesIdx = out.indexOf("## User's Active Priorities");
    const orgIdx = out.indexOf("## About the User's Organization");

    expect(userIdx).toBeGreaterThan(-1);
    expect(prioritiesIdx).toBeGreaterThan(-1);
    expect(orgIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeLessThan(prioritiesIdx);
    expect(prioritiesIdx).toBeLessThan(orgIdx);
  });

  it('frames priorities in 3rd person (about the user, not the agent)', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);
    await seedPriority(mem, userEntityId, { displayName: 'Goal A', weight: 0.8 });

    const out = (await plugin.getContent())!;
    // Section heading is 3rd-person possessive — not "Your".
    expect(out).toMatch(/## User's Active Priorities/);
    expect(out).not.toMatch(/## Your Active Priorities/);
    expect(out).not.toMatch(/## Your Priorities/);
    // The descriptive caption clarifies these are the user's goals.
    expect(out).toContain("USER's goals, not yours");
  });

  it('treats status as active when omitted (early-data fallback)', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);

    // Seed a priority entity with NO status field — early-data shape from
    // before the status field was conventional. Should still render.
    const { entity } = await mem.upsertEntity(
      {
        type: 'priority',
        displayName: 'Legacy goal',
        identifiers: [{ kind: 'canonical', value: 'priority:legacy' }],
        metadata: { jarvis: { priority: { weight: 0.5 } } },
      },
      { userId: USER_ID },
    );
    await mem.addFact(
      {
        subjectId: userEntityId,
        predicate: 'tracks_priority',
        kind: 'atomic',
        objectId: entity.id,
      },
      { userId: USER_ID },
    );

    const out = (await plugin.getContent())!;
    expect(out).toContain('Legacy goal');
  });
});

describe('MemoryPluginNextGen — user timezone surfacing', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  it('renders **Timezone:** line when metadata.jarvis.tz is set on the user', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const { userEntityId } = await bootstrap(plugin);

    // Host stamps tz on the user entity post-bootstrap. metadataMerge:'overwrite'
    // forces the new metadata to win over the bootstrap's empty metadata.
    await mem.upsertEntity(
      {
        type: 'person',
        displayName: `user:${USER_ID}`,
        identifiers: [{ kind: 'system_user_id', value: USER_ID }],
        metadata: { jarvis: { tz: 'Europe/Berlin' } },
        metadataMerge: 'overwrite',
      },
      { userId: USER_ID },
    );

    const out = (await plugin.getContent())!;
    expect(out).toContain('**Timezone:** Europe/Berlin');
    // Falls within the user profile block, BEFORE the priorities heading
    // (when present) and BEFORE any other section.
    const userIdx = out.indexOf('## About the User');
    const tzIdx = out.indexOf('**Timezone:**');
    expect(userIdx).toBeGreaterThan(-1);
    expect(tzIdx).toBeGreaterThan(userIdx);

    // Sanity: the round-trip used the bootstrapped user id.
    const ent = await mem.getEntity(userEntityId, { userId: USER_ID });
    expect((ent?.metadata?.jarvis as Record<string, unknown>)?.tz).toBe('Europe/Berlin');
  });

  it('omits the **Timezone:** line when not set', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await bootstrap(plugin);
    const out = (await plugin.getContent())!;
    expect(out).not.toContain('**Timezone:**');
  });

  it('omits the **Timezone:** line when jarvis.tz is empty/non-string', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await bootstrap(plugin);

    await mem.upsertEntity(
      {
        type: 'person',
        displayName: `user:${USER_ID}`,
        identifiers: [{ kind: 'system_user_id', value: USER_ID }],
        metadata: { jarvis: { tz: '' } },
        metadataMerge: 'overwrite',
      },
      { userId: USER_ID },
    );
    const out = (await plugin.getContent())!;
    expect(out).not.toContain('**Timezone:**');
  });

  it('does NOT render Timezone on the organization block (user-only by convention)', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      groupId: GROUP_ID,
      groupBootstrap: { displayName: 'Acme Inc.' },
    });
    const { groupEntityId } = await bootstrap(plugin);

    // Plant a tz on the org entity. The renderer must ignore it — `tz` on the
    // user is the surfaced convention; orgs would use a different field if
    // ever needed and this prevents accidental cross-render.
    await mem.upsertEntity(
      {
        type: 'organization',
        displayName: 'Acme Inc.',
        identifiers: [{ kind: 'system_group_id', value: GROUP_ID }],
        metadata: { jarvis: { tz: 'America/New_York' } },
        metadataMerge: 'overwrite',
      },
      { userId: USER_ID, groupId: GROUP_ID },
    );

    const out = (await plugin.getContent())!;
    // The user block has no tz set, so no Timezone line anywhere in output.
    expect(out).not.toContain('**Timezone:**');
    expect(out).not.toContain('America/New_York');
    expect(groupEntityId).toBeDefined();
  });
});
