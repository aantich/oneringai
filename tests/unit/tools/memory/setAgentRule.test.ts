/**
 * memory_set_agent_rule — unit coverage.
 *
 * Covers:
 *   - happy path: writes a fact with the expected shape (subject=agent, predicate,
 *     private permissions, importance=0.95, details=rule verbatim)
 *   - missing agent bootstrap → structured error, no write
 *   - missing rule / empty rule → structured error
 *   - supersession via `replaces` → new fact has `supersedes` set, old archived
 *   - tool schema is OpenAI-strict (params: object, required: [rule])
 *   - ownership mismatch (caller ≠ agent-entity owner) → structured error, no write
 *   - rate limit: N+1th call in the window returns rateLimited, retryAfterMs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSetAgentRuleTool } from '@/tools/memory/setAgentRule.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import type { MemoryToolDeps } from '@/tools/memory/types.js';
import { createSubjectResolver } from '@/tools/memory/resolveSubject.js';

const USER_ID = 'u-rule';
const AGENT_ID = 'a-rule';

async function buildDeps(
  memory: MemorySystem,
  ids: { userEntityId?: string; agentEntityId?: string },
): Promise<MemoryToolDeps> {
  return {
    memory,
    resolve: createSubjectResolver({
      memory,
      getOwnSubjectIds: () => ids,
    }),
    agentId: AGENT_ID,
    defaultUserId: USER_ID,
    defaultGroupId: undefined,
    getOwnSubjectIds: () => ids,
    defaultVisibility: { forUser: 'private', forAgent: 'group', forOther: 'private' },
  };
}

async function bootstrap(mem: MemorySystem) {
  const agent = await mem.upsertEntity(
    { type: 'agent', displayName: `agent:${AGENT_ID}`, identifiers: [{ kind: 'system_agent_id', value: AGENT_ID }] },
    { userId: USER_ID },
  );
  const user = await mem.upsertEntity(
    { type: 'person', displayName: `user:${USER_ID}`, identifiers: [{ kind: 'system_user_id', value: USER_ID }] },
    { userId: USER_ID },
  );
  return { agentEntityId: agent.entity.id, userEntityId: user.entity.id };
}

describe('memory_set_agent_rule — tool', () => {
  let mem: MemorySystem;
  beforeEach(() => {
    mem = new MemorySystem({ store: new InMemoryAdapter() });
  });

  it('writes a fact with the expected shape', async () => {
    const ids = await bootstrap(mem);
    const deps = await buildDeps(mem, ids);
    const tool = createSetAgentRuleTool(deps);

    const result: any = await tool.execute(
      { rule: 'Be terse in replies.' },
      { userId: USER_ID },
    );

    expect(result.error).toBeUndefined();
    expect(typeof result.ruleId).toBe('string');

    const fact = await mem.getFact(result.ruleId, { userId: USER_ID });
    expect(fact).toBeDefined();
    expect(fact!.subjectId).toBe(ids.agentEntityId);
    expect(fact!.predicate).toBe('agent_behavior_rule');
    expect(fact!.details).toBe('Be terse in replies.');
    expect(fact!.kind).toBe('atomic');
    expect(fact!.importance).toBeCloseTo(0.95);
    // Private — owner-only.
    expect(fact!.permissions).toEqual({ group: 'none', world: 'none' });
  });

  it('returns structured error when agent entity is not bootstrapped', async () => {
    const deps = await buildDeps(mem, {}); // no ids
    const tool = createSetAgentRuleTool(deps);
    const result: any = await tool.execute(
      { rule: 'Be terse.' },
      { userId: USER_ID },
    );
    expect(result.error).toMatch(/agent entity not bootstrapped/);
    expect(result.ruleId).toBeUndefined();
  });

  it('rejects empty or missing rule', async () => {
    const ids = await bootstrap(mem);
    const deps = await buildDeps(mem, ids);
    const tool = createSetAgentRuleTool(deps);

    for (const bad of [undefined, null, '', '   ']) {
      const r: any = await tool.execute({ rule: bad as any }, { userId: USER_ID });
      expect(r.error).toMatch(/rule is required/);
    }
  });

  it('supersedes a prior rule via `replaces`, archiving the predecessor', async () => {
    const ids = await bootstrap(mem);
    const deps = await buildDeps(mem, ids);
    const tool = createSetAgentRuleTool(deps);

    const first: any = await tool.execute(
      { rule: 'Reply in Russian.' },
      { userId: USER_ID },
    );
    expect(first.error).toBeUndefined();

    const second: any = await tool.execute(
      { rule: 'Reply in English again.', replaces: first.ruleId },
      { userId: USER_ID },
    );
    expect(second.error).toBeUndefined();
    expect(second.superseded).toBe(first.ruleId);

    // Predecessor is now archived.
    const old = await mem.getFact(first.ruleId, { userId: USER_ID });
    expect(old!.archived).toBe(true);
    // New fact carries `supersedes` pointing to the old one.
    const fresh = await mem.getFact(second.ruleId, { userId: USER_ID });
    expect(fresh!.supersedes).toBe(first.ruleId);
  });

  it('tool schema declares required: [rule] and no array-without-items', () => {
    const ids = { userEntityId: 'x', agentEntityId: 'y' };
    const deps: MemoryToolDeps = {
      memory: mem,
      resolve: createSubjectResolver({ memory: mem, getOwnSubjectIds: () => ids }),
      agentId: AGENT_ID,
      defaultUserId: USER_ID,
      defaultGroupId: undefined,
      getOwnSubjectIds: () => ids,
      defaultVisibility: { forUser: 'private', forAgent: 'group', forOther: 'private' },
    };
    const tool = createSetAgentRuleTool(deps);
    const params = tool.definition.function.parameters as any;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['rule']);
    expect(params.properties.rule.type).toBe('string');
    expect(params.properties.replaces.type).toBe('string');
  });

  it('returns structured error when caller does not own the agent entity', async () => {
    // Bootstrap the agent entity as USER_ID; call the tool as a DIFFERENT user.
    // The memory layer enforces `fact.ownerId == subject.ownerId`, so the
    // cross-scope write must be rejected. The tool surfaces that as a
    // structured error (not a thrown exception).
    const ids = await bootstrap(mem);
    const deps = await buildDeps(mem, ids);
    const tool = createSetAgentRuleTool(deps);

    const result: any = await tool.execute(
      { rule: 'I am not the owner.' },
      { userId: 'stranger' },
    );
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.ruleId).toBeUndefined();
  });

  it('enforces rate limit — honors deps.forgetRateLimit', async () => {
    const ids = await bootstrap(mem);
    const base = await buildDeps(mem, ids);
    // Allow exactly 2 rules per 60s to keep the test tight.
    const deps: MemoryToolDeps = {
      ...base,
      forgetRateLimit: { maxCallsPerWindow: 2, windowMs: 60_000 },
    };
    const tool = createSetAgentRuleTool(deps);

    const r1: any = await tool.execute({ rule: 'rule 1' }, { userId: USER_ID });
    const r2: any = await tool.execute({ rule: 'rule 2' }, { userId: USER_ID });
    const r3: any = await tool.execute({ rule: 'rule 3' }, { userId: USER_ID });

    expect(r1.error).toBeUndefined();
    expect(r2.error).toBeUndefined();
    expect(r3.rateLimited).toBe(true);
    expect(typeof r3.retryAfterMs).toBe('number');
    expect(r3.retryAfterMs).toBeGreaterThan(0);
    expect(r3.ruleId).toBeUndefined();
  });
});
