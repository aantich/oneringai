/**
 * MemoryPluginNextGen — User-specific instructions for this agent (rules block).
 *
 * Covers:
 *   - Renders the block when rules exist
 *   - Does NOT render the block when no rules
 *   - Each rule line shows the full factId in brackets (the form the agent
 *     passes verbatim to `memory_set_agent_rule.replaces`)
 *   - Long rule bodies are truncated with an ellipsis
 *   - Archived rules are excluded
 *   - Admin-global agent profile block is NOT rendered any more
 *   - Rules with an ownerId that doesn't match the caller are excluded
 *     (defence-in-depth against legacy world-readable facts leaking across users)
 *   - Profile regen guard: agent-type entities never trigger regenerateProfile
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPluginNextGen } from '@/core/context-nextgen/plugins/MemoryPluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER_ID = 'u-block';
const AGENT_ID = 'a-block';

async function seedRule(
  mem: MemorySystem,
  agentEntityId: string,
  details: string,
): Promise<string> {
  const f = await mem.addFact(
    {
      subjectId: agentEntityId,
      predicate: 'agent_behavior_rule',
      kind: 'atomic',
      details,
      importance: 0.95,
      permissions: { group: 'none', world: 'none' },
    },
    { userId: USER_ID },
  );
  return f.id;
}

describe('MemoryPluginNextGen — rules block', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  it('does NOT render the rules block when the user has no rules', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const out = await plugin.getContent();
    expect(out).not.toMatch(/User-specific instructions for this agent/);
    // User profile still renders (even if just the placeholder).
    expect(out).toMatch(/## About the User/);
  });

  it('renders the block with each rule as its own line (full factId bracket)', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin.getContent(); // bootstrap
    const { agentEntityId } = plugin.getBootstrappedIds();
    const id1 = await seedRule(mem, agentEntityId!, 'Be terse in replies.');
    const id2 = await seedRule(mem, agentEntityId!, 'Reply in Russian.');

    const out = (await plugin.getContent())!;
    expect(out).toMatch(/## User-specific instructions for this agent/);
    expect(out).toContain('Be terse in replies.');
    expect(out).toContain('Reply in Russian.');
    // Bracket renders as `[ruleId=<factId>]` — explicit field name spares
    // the LLM from bridging memory_forget(factId) ↔ memory_set_agent_rule(ruleId).
    expect(out).toContain(`[ruleId=${id1}]`);
    expect(out).toContain(`[ruleId=${id2}]`);
  });

  it('does NOT render the old ## Agent Profile block', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    const out = (await plugin.getContent())!;
    expect(out).not.toMatch(/## Agent Profile/);
  });

  it('excludes archived rules', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin.getContent();
    const { agentEntityId } = plugin.getBootstrappedIds();
    const liveId = await seedRule(mem, agentEntityId!, 'Use metric units.');
    const deadId = await seedRule(mem, agentEntityId!, 'Use imperial units.');
    await mem.archiveFact(deadId, { userId: USER_ID });

    const out = (await plugin.getContent())!;
    expect(out).toContain('Use metric units.');
    expect(out).not.toContain('Use imperial units.');
    expect(out).toContain(`[ruleId=${liveId}]`);
    expect(out).not.toContain(`[ruleId=${deadId}]`);
  });

  it('renders long rules in full (no char cap on rule bodies)', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin.getContent();
    const { agentEntityId } = plugin.getBootstrappedIds();
    const long = 'a'.repeat(1000);
    await seedRule(mem, agentEntityId!, long);

    const out = (await plugin.getContent())!;
    // Block present AND the rule body is rendered verbatim — no ellipsis,
    // no silent clip of user-authored behavior directives.
    expect(out).toMatch(/User-specific instructions for this agent/);
    expect(out).toContain(long);
    expect(out).not.toContain('…');
  });

  it('block appears BEFORE the user profile block (directives take priority)', async () => {
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin.getContent();
    const { agentEntityId } = plugin.getBootstrappedIds();
    await seedRule(mem, agentEntityId!, 'Be terse.');

    const out = (await plugin.getContent())!;
    const rulesIdx = out.indexOf('## User-specific instructions for this agent');
    const profileIdx = out.indexOf('## About the User');
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeLessThan(profileIdx);
  });

  it('excludes rules whose ownerId doesn\'t match the caller (defence-in-depth filter)', async () => {
    // Set up two users, u-block (agent owner) and u-other. The agent entity
    // is owned by u-block. Even if some future path planted a fact on the
    // agent entity with a different ownerId (e.g. through a permissions
    // loophole or legacy data), the render filter must drop it rather than
    // surface it in u-block's rules block.
    const plugin = new MemoryPluginNextGen({ memory: mem, agentId: AGENT_ID, userId: USER_ID });
    await plugin.getContent();
    const { agentEntityId } = plugin.getBootstrappedIds();

    // Own rule — shows up.
    const ownId = await seedRule(mem, agentEntityId!, 'Be terse.');

    // Plant a fact with an EXPLICIT ownerId override that differs from the
    // subject's owner. `MemorySystem.addFact` normally derives ownerId from
    // the subject (blocking this), but `ScopeInvariantError` fires when we
    // try. Catch the error — the scenario is closed at the write layer today.
    // The render filter is defence-in-depth for the case where legacy data
    // or a future change ever leaves a cross-ownerId fact behind.
    let plantedForeignFact = false;
    try {
      await mem.addFact(
        {
          subjectId: agentEntityId!,
          predicate: 'agent_behavior_rule',
          kind: 'atomic',
          details: 'LEAKED: always be verbose.',
          importance: 0.95,
          permissions: { group: 'read', world: 'read' },
          ownerId: 'u-other', // explicit mismatch against the agent entity
        },
        { userId: USER_ID },
      );
      plantedForeignFact = true;
    } catch {
      // Expected — scope invariant rejects the cross-ownerId write. Good.
    }

    const out = (await plugin.getContent())!;
    expect(out).toContain('Be terse.');
    expect(out).toContain(`[ruleId=${ownId}]`);
    // Either the write was rejected (plantedForeignFact=false, ideal) OR the
    // render filter dropped it after storage. Both outcomes satisfy the
    // defence-in-depth property.
    expect(out).not.toContain('LEAKED');
    if (plantedForeignFact) {
      // If we somehow succeeded in planting it, the render filter is the
      // only safety net — make the test assertion explicit.
      expect(plantedForeignFact).toBe(true);
    }
  });
});

describe('MemorySystem — profile regen guard on agent entities', () => {
  it('does NOT trigger profile regen when a fact lands on an agent-type entity', async () => {
    // Wire a profile generator that records every call. If the guard fires
    // correctly, the generator is NOT called for the agent-subject write.
    const calls: Array<string> = [];
    const generator = {
      generate: async (input: any) => {
        calls.push(input.entity.id);
        return { details: 'synthesized', summaryForEmbedding: 'synth' };
      },
    };
    const mem = new MemorySystem({
      store: new InMemoryAdapter(),
      profileGenerator: generator,
      profileRegenerationThreshold: 1, // fire on first atomic fact
    });

    // Bootstrap both entities.
    const agent = await mem.upsertEntity(
      { type: 'agent', displayName: 'a', identifiers: [{ kind: 'system_agent_id', value: 'a1' }] },
      { userId: USER_ID },
    );
    const user = await mem.upsertEntity(
      { type: 'person', displayName: 'u', identifiers: [{ kind: 'system_user_id', value: USER_ID }] },
      { userId: USER_ID },
    );

    // Write a fact on the USER entity — SHOULD trigger regen.
    await mem.addFact(
      {
        subjectId: user.entity.id,
        predicate: 'prefers',
        kind: 'atomic',
        value: 'coffee',
      },
      { userId: USER_ID },
    );
    // Let the background regen settle (maybeRegenerateProfile is fire-and-forget).
    await new Promise((r) => setTimeout(r, 20));

    // Write a fact on the AGENT entity — should NOT trigger regen.
    await mem.addFact(
      {
        subjectId: agent.entity.id,
        predicate: 'agent_behavior_rule',
        kind: 'atomic',
        details: 'Be terse.',
      },
      { userId: USER_ID },
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toContain(user.entity.id);
    expect(calls).not.toContain(agent.entity.id);
  });
});
