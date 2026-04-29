/**
 * MemoryPluginNextGen — persona routing.
 *
 * When `personaEntityId` is configured, behavior rules are read from / written
 * to the persona entity instead of the variant agent entity. Lets multiple
 * agent variants (chat / Slack / email assistant) share one identity block.
 *
 * Covers:
 *   - Rules block renders facts on the persona entity, not the variant
 *   - Variant agent entity is still bootstrapped (per-variant analytics intact)
 *   - `getOwnSubjectIds().agentEntityId` returns the persona id
 *   - `getBootstrappedIds().agentEntityId` returns the variant id (unchanged
 *     contract — "what was actually bootstrapped")
 *   - Without `personaEntityId`, behavior is identical to the legacy path
 *     (rules subject == variant)
 *   - Two plugins sharing one persona render the same rules block
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPluginNextGen } from '@/core/context-nextgen/plugins/MemoryPluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER_ID = 'u-persona';
const AGENT_ID = 'a-chat';
const SECOND_AGENT_ID = 'a-slack';

async function seedRule(
  mem: MemorySystem,
  subjectEntityId: string,
  details: string,
): Promise<string> {
  const f = await mem.addFact(
    {
      subjectId: subjectEntityId,
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

async function upsertPersona(mem: MemorySystem): Promise<string> {
  const result = await mem.upsertEntity(
    {
      type: 'assistant_persona',
      displayName: 'Assistant',
      identifiers: [{ kind: 'system_assistant_persona_id', value: USER_ID }],
    },
    { userId: USER_ID },
  );
  return result.entity.id;
}

describe('MemoryPluginNextGen — persona routing', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  it('renders rules from the persona entity, not the variant agent entity', async () => {
    const personaId = await upsertPersona(mem);
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      personaEntityId: personaId,
    });
    // Bootstrap variant agent entity.
    await plugin.getContent();
    const { agentEntityId: variantId } = plugin.getBootstrappedIds();
    expect(variantId).toBeDefined();
    expect(variantId).not.toBe(personaId);

    // Rule on persona — should render.
    const personaRuleId = await seedRule(mem, personaId, 'My name is Jarvis.');
    // Rule on variant — should NOT render (persona is the rule subject now).
    const variantRuleId = await seedRule(mem, variantId!, 'Variant-only rule.');

    const out = (await plugin.getContent())!;
    expect(out).toContain('My name is Jarvis.');
    expect(out).toContain(`[ruleId=${personaRuleId}]`);
    expect(out).not.toContain('Variant-only rule.');
    expect(out).not.toContain(`[ruleId=${variantRuleId}]`);
  });

  it('still bootstraps the variant agent entity (analytics path intact)', async () => {
    const personaId = await upsertPersona(mem);
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      personaEntityId: personaId,
    });
    await plugin.getContent();
    const ids = plugin.getBootstrappedIds();
    expect(ids.agentEntityId).toBeDefined();
    expect(ids.agentEntityId).not.toBe(personaId);
    // The variant entity should be a real entity in the store.
    const variant = await mem.getEntity(ids.agentEntityId!, { userId: USER_ID });
    expect(variant?.type).toBe('agent');
  });

  it('getOwnSubjectIds reports persona as agentEntityId; getBootstrappedIds reports variant', async () => {
    const personaId = await upsertPersona(mem);
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      personaEntityId: personaId,
    });
    await plugin.getContent();

    const subj = plugin.getOwnSubjectIds();
    const boot = plugin.getBootstrappedIds();
    expect(subj.agentEntityId).toBe(personaId);
    expect(boot.agentEntityId).not.toBe(personaId);
    expect(boot.agentEntityId).toBeDefined();
    // userEntityId is the same in both views.
    expect(subj.userEntityId).toBe(boot.userEntityId);
    expect(subj.userEntityId).toBeDefined();
  });

  it('two variants sharing one persona render the same rules block', async () => {
    const personaId = await upsertPersona(mem);
    const chat = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      personaEntityId: personaId,
    });
    const slack = new MemoryPluginNextGen({
      memory: mem,
      agentId: SECOND_AGENT_ID,
      userId: USER_ID,
      personaEntityId: personaId,
    });
    await chat.getContent();
    await slack.getContent();

    // Variants are distinct entities.
    expect(chat.getBootstrappedIds().agentEntityId).not.toBe(
      slack.getBootstrappedIds().agentEntityId,
    );
    // Both report the same persona as the rule subject.
    expect(chat.getOwnSubjectIds().agentEntityId).toBe(personaId);
    expect(slack.getOwnSubjectIds().agentEntityId).toBe(personaId);

    // Write a rule on the persona — both variants render it.
    await seedRule(mem, personaId, 'I reply tersely.');
    const chatOut = (await chat.getContent())!;
    const slackOut = (await slack.getContent())!;
    expect(chatOut).toContain('I reply tersely.');
    expect(slackOut).toContain('I reply tersely.');
  });

  it('without personaEntityId, rules subject is the variant (legacy path)', async () => {
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
    });
    await plugin.getContent();
    const { agentEntityId: variantId } = plugin.getBootstrappedIds();
    expect(variantId).toBeDefined();

    // getOwnSubjectIds and getBootstrappedIds agree.
    expect(plugin.getOwnSubjectIds().agentEntityId).toBe(variantId);

    // Rule on variant — renders.
    await seedRule(mem, variantId!, 'Be terse.');
    const out = (await plugin.getContent())!;
    expect(out).toContain('Be terse.');
  });

  it('persona id is reported on getOwnSubjectIds even before first getContent (no bootstrap needed)', async () => {
    const personaId = await upsertPersona(mem);
    const plugin = new MemoryPluginNextGen({
      memory: mem,
      agentId: AGENT_ID,
      userId: USER_ID,
      personaEntityId: personaId,
    });
    // No getContent() call yet — variant agent entity not bootstrapped.
    expect(plugin.getBootstrappedIds().agentEntityId).toBeUndefined();
    // Persona id is constructor-provided, available immediately.
    expect(plugin.getOwnSubjectIds().agentEntityId).toBe(personaId);
  });
});
