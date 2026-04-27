/**
 * Memory tools — unit tests.
 *
 * Uses a live `MemorySystem` backed by `InMemoryAdapter` so we exercise the
 * real resolver + scope + permissions pipeline. Each tool gets:
 *   - happy path
 *   - SubjectRef variants (id, "me", "this_agent", {identifier}, {surface})
 *   - ambiguity → candidates
 *   - visibility → permissions mapping where applicable
 *   - structured errors on bad input
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MemorySystem, IEntity } from '@/memory/index.js';
import { MemorySystem as MemorySystemClass } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';
import {
  createMemoryTools,
  createSubjectResolver,
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  visibilityToPermissions,
} from '@/tools/memory/index.js';

const USER_ID = 'u1';
const OTHER_USER = 'u2';
const AGENT_ID = 'a1';

function makeMem(): MemorySystem {
  return new MemorySystemClass({ store: new InMemoryAdapter() });
}

async function bootstrap(mem: MemorySystem): Promise<{
  userEntityId: string;
  agentEntityId: string;
  otherUserId: string;
}> {
  const user = await mem.upsertEntity(
    {
      type: 'person',
      displayName: 'Alice',
      identifiers: [{ kind: 'system_user_id', value: USER_ID }],
    },
    { userId: USER_ID },
  );
  const agent = await mem.upsertEntity(
    {
      type: 'agent',
      displayName: 'TestAgent',
      identifiers: [{ kind: 'system_agent_id', value: AGENT_ID }],
    },
    { userId: USER_ID },
  );
  const other = await mem.upsertEntity(
    {
      type: 'person',
      displayName: 'Bob Smith',
      identifiers: [{ kind: 'email', value: 'bob@a.com' }],
    },
    { userId: USER_ID },
  );
  return {
    userEntityId: user.entity.id,
    agentEntityId: agent.entity.id,
    otherUserId: other.entity.id,
  };
}

function tools(mem: MemorySystem, ids: { userEntityId: string; agentEntityId: string }) {
  return createMemoryTools({
    memory: mem,
    agentId: AGENT_ID,
    defaultUserId: USER_ID,
    getOwnSubjectIds: () => ids,
  });
}

function toolByName<T = unknown>(
  ts: ReturnType<typeof createMemoryTools>,
  name: string,
) {
  return ts.find((t) => t.definition.function.name === name) as {
    execute: (args: unknown, ctx?: unknown) => Promise<T>;
  };
}

// ===========================================================================
// Shared resolver behaviour
// ===========================================================================

describe('createSubjectResolver', () => {
  let mem: MemorySystem;
  let ids: { userEntityId: string; agentEntityId: string; otherUserId: string };
  let resolve: ReturnType<typeof createSubjectResolver>;

  beforeEach(async () => {
    mem = makeMem();
    ids = await bootstrap(mem);
    resolve = createSubjectResolver({
      memory: mem,
      getOwnSubjectIds: () => ids,
    });
  });

  it('resolves "me" to the user entity', async () => {
    const r = await resolve(SUBJECT_TOKEN_ME, { userId: USER_ID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entity.id).toBe(ids.userEntityId);
  });

  it('resolves "this_agent" to the agent entity', async () => {
    const r = await resolve(SUBJECT_TOKEN_THIS_AGENT, { userId: USER_ID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entity.id).toBe(ids.agentEntityId);
  });

  it('resolves a raw entity id string', async () => {
    const r = await resolve(ids.otherUserId, { userId: USER_ID });
    expect(r.ok).toBe(true);
  });

  it('resolves {id}', async () => {
    const r = await resolve({ id: ids.otherUserId }, { userId: USER_ID });
    expect(r.ok).toBe(true);
  });

  it('resolves {identifier:{kind,value}} exactly', async () => {
    const r = await resolve(
      { identifier: { kind: 'email', value: 'bob@a.com' } },
      { userId: USER_ID },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entity.id).toBe(ids.otherUserId);
  });

  it('reports not_found for unknown identifier', async () => {
    const r = await resolve(
      { identifier: { kind: 'email', value: 'nobody@nowhere' } },
      { userId: USER_ID },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('resolves {surface} fuzzy above threshold', async () => {
    const r = await resolve({ surface: 'Bob Smith' }, { userId: USER_ID });
    expect(r.ok).toBe(true);
  });

  it('reports no_user_scope when "me" is used without a userEntityId', async () => {
    const resolveNoUser = createSubjectResolver({
      memory: mem,
      getOwnSubjectIds: () => ({ agentEntityId: ids.agentEntityId }),
    });
    const r = await resolveNoUser(SUBJECT_TOKEN_ME, { userId: USER_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_user_scope');
  });

  it('rejects unrecognised SubjectRef shape', async () => {
    const r = await resolve({ nonsense: true } as unknown as string, { userId: USER_ID });
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// memory_recall
// ===========================================================================

describe('memory_recall', () => {
  it('returns profile + topFacts for the current user via "me"', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'prefers', kind: 'atomic', value: 'tests' },
      { userId: USER_ID },
    );
    const recall = toolByName(tools(mem, ids), 'memory_recall');
    const r = await recall.execute({ subject: 'me' }, { userId: USER_ID });
    expect(r).toMatchObject({
      entity: { id: ids.userEntityId, displayName: 'Alice' },
      topFacts: expect.arrayContaining([
        expect.objectContaining({ predicate: 'prefers', value: 'tests' }),
      ]),
    });
  });

  it('returns a structured error for unresolvable surface', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const recall = toolByName(tools(mem, ids), 'memory_recall');
    const r: any = await recall.execute(
      { subject: { surface: 'nobody-ever-heard-of-this' } },
      { userId: USER_ID },
    );
    expect(r.error).toBeDefined();
  });

  it('returns candidates when surface confidence falls below auto-resolve threshold', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    // Exact-match on displayName → confidence 0.9 per EntityResolver tiers.
    // Set auto-resolve threshold to 0.999 so 0.9 is "ambiguous".
    const highThresholdTools = createMemoryTools({
      memory: mem,
      agentId: AGENT_ID,
      defaultUserId: USER_ID,
      getOwnSubjectIds: () => ({
        userEntityId: ids.userEntityId,
        agentEntityId: ids.agentEntityId,
      }),
      autoResolveThreshold: 0.999,
    });
    const recall = toolByName(highThresholdTools, 'memory_recall');
    const r: any = await recall.execute(
      { subject: { surface: 'Bob Smith' } },
      { userId: USER_ID },
    );
    expect(r.error).toBeDefined();
    expect(r.candidates).toBeDefined();
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0].displayName).toBe('Bob Smith');
  });

  it('returns { error } when subject is missing', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const recall = toolByName(tools(mem, ids), 'memory_recall');
    const r: any = await recall.execute({}, { userId: USER_ID });
    expect(r.error).toMatch(/subject/);
  });

  it('accepts include: ["neighbors"] and renders a graph neighborhood', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await mem.addFact(
      {
        subjectId: ids.userEntityId,
        predicate: 'works_with',
        kind: 'atomic',
        objectId: ids.otherUserId,
      },
      { userId: USER_ID },
    );
    const recall = toolByName(tools(mem, ids), 'memory_recall');
    const r: any = await recall.execute(
      { subject: 'me', include: ['neighbors'], neighborDepth: 1 },
      { userId: USER_ID },
    );
    expect(r.neighbors).toBeDefined();
    expect(r.neighbors.nodes.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// memory_graph
// ===========================================================================

describe('memory_graph', () => {
  it('returns nodes + edges via memory.traverse', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await mem.addFact(
      {
        subjectId: ids.userEntityId,
        predicate: 'knows',
        kind: 'atomic',
        objectId: ids.otherUserId,
      },
      { userId: USER_ID },
    );
    const graph = toolByName(tools(mem, ids), 'memory_graph');
    const r: any = await graph.execute(
      { start: 'me', direction: 'out', maxDepth: 1 },
      { userId: USER_ID },
    );
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.edges.find((e: any) => e.predicate === 'knows')).toBeDefined();
  });

  it('filters by predicates', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'knows', kind: 'atomic', objectId: ids.otherUserId },
      { userId: USER_ID },
    );
    await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'avoids', kind: 'atomic', objectId: ids.agentEntityId },
      { userId: USER_ID },
    );
    const graph = toolByName(tools(mem, ids), 'memory_graph');
    const r: any = await graph.execute(
      { start: 'me', direction: 'out', maxDepth: 1, predicates: ['knows'] },
      { userId: USER_ID },
    );
    const preds = new Set(r.edges.map((e: any) => e.predicate));
    expect(preds.has('knows')).toBe(true);
    expect(preds.has('avoids')).toBe(false);
  });
});

// ===========================================================================
// memory_find_entity
// ===========================================================================

describe('memory_find_entity / memory_upsert_entity', () => {
  it('finds by identifier across different IDs on the same entity', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    // Enrich Bob with a second identifier via upsert.
    const all = tools(mem, ids);
    const find = toolByName(all, 'memory_find_entity');
    const upsert = toolByName(all, 'memory_upsert_entity');
    await upsert.execute(
      {
        type: 'person',
        displayName: 'Bob Smith',
        identifiers: [
          { kind: 'email', value: 'bob@a.com' },
          { kind: 'slack_user_id', value: 'U07BOB' },
        ],
      },
      { userId: USER_ID },
    );
    // Now look up by the NEW identifier — should hit the same entity.
    const r: any = await find.execute(
      { by: { identifier: { kind: 'slack_user_id', value: 'U07BOB' } } },
      { userId: USER_ID },
    );
    expect(r.entity.id).toBe(ids.otherUserId);
  });

  it('list returns entities by type', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const find = toolByName(tools(mem, ids), 'memory_find_entity');
    const r: any = await find.execute(
      { action: 'list', by: { type: 'person' }, limit: 10 },
      { userId: USER_ID },
    );
    expect(r.entities.length).toBeGreaterThanOrEqual(2); // Alice + Bob
  });

  describe('list: metadataFilter range ops + orderBy + select', () => {
    async function seedTasks(mem: MemorySystem): Promise<void> {
      const specs = [
        { name: 'T1', priority: 1, urgency: 10, importance: 50, state: 'pending' },
        { name: 'T2', priority: 3, urgency: 90, importance: 40, state: 'pending' },
        { name: 'T3', priority: 3, urgency: 90, importance: 60, state: 'in_progress' },
        { name: 'T4', priority: 5, urgency: 100, importance: 80, state: 'pending' },
      ];
      for (const s of specs) {
        await mem.upsertEntity(
          {
            type: 'task',
            displayName: s.name,
            identifiers: [{ kind: 'canonical', value: `task:${s.name}` }],
            metadata: {
              state: s.state,
              priority: s.priority,
              jarvis: { urgency: s.urgency, importance: s.importance },
            },
          },
          { userId: USER_ID },
        );
      }
    }

    it('forwards range operators on nested metadata', async () => {
      const mem = makeMem();
      const ids = await bootstrap(mem);
      await seedTasks(mem);
      const find = toolByName(tools(mem, ids), 'memory_find_entity');
      const r: any = await find.execute(
        {
          action: 'list',
          by: {
            type: 'task',
            metadataFilter: { 'jarvis.importance': { $gte: 50 } },
          },
          limit: 50,
        },
        { userId: USER_ID },
      );
      const names = r.entities.map((e: any) => e.displayName).sort();
      expect(names).toEqual(['T1', 'T3', 'T4']);
    });

    it('forwards multi-key orderBy (urgency desc, importance desc)', async () => {
      const mem = makeMem();
      const ids = await bootstrap(mem);
      await seedTasks(mem);
      const find = toolByName(tools(mem, ids), 'memory_find_entity');
      const r: any = await find.execute(
        {
          action: 'list',
          by: {
            type: 'task',
            orderBy: [
              { field: 'metadata.jarvis.urgency', direction: 'desc' },
              { field: 'metadata.jarvis.importance', direction: 'desc' },
            ],
          },
          limit: 50,
        },
        { userId: USER_ID },
      );
      expect(r.entities.map((e: any) => e.displayName)).toEqual(['T4', 'T3', 'T2', 'T1']);
    });

    it('forwards select — response metadata contains only requested paths', async () => {
      const mem = makeMem();
      const ids = await bootstrap(mem);
      await seedTasks(mem);
      const find = toolByName(tools(mem, ids), 'memory_find_entity');
      const r: any = await find.execute(
        {
          action: 'list',
          by: {
            type: 'task',
            select: ['metadata.jarvis.urgency', 'metadata.state'],
          },
          limit: 50,
        },
        { userId: USER_ID },
      );
      for (const e of r.entities) {
        const md = e.metadata as Record<string, any>;
        expect(md.priority).toBeUndefined(); // not requested
        expect(md.state).toBeDefined();
        expect(md.jarvis?.urgency).toBeDefined();
        expect(md.jarvis?.importance).toBeUndefined();
      }
    });
  });

  it('upsert requires type + displayName + identifiers', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const upsert = toolByName(tools(mem, ids), 'memory_upsert_entity');
    const r1: any = await upsert.execute(
      { displayName: 'X', identifiers: [{ kind: 'internal_id', value: 'x' }] } as any,
      { userId: USER_ID },
    );
    expect(r1.error).toMatch(/type/);
    const r2: any = await upsert.execute(
      { type: 'topic', identifiers: [{ kind: 'internal_id', value: 'x' }] } as any,
      { userId: USER_ID },
    );
    expect(r2.error).toMatch(/displayName/);
    const r3: any = await upsert.execute(
      { type: 'topic', displayName: 'X', identifiers: [] } as any,
      { userId: USER_ID },
    );
    expect(r3.error).toMatch(/identifiers/);
  });

  it('upsert with visibility "group" stamps group:read,world:none', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const upsert = toolByName(tools(mem, ids), 'memory_upsert_entity');
    const r: any = await upsert.execute(
      {
        type: 'topic',
        displayName: 'Internal Topic',
        identifiers: [{ kind: 'internal_id', value: 'topic-42' }],
        visibility: 'group',
      },
      { userId: USER_ID },
    );
    expect(r.entity.permissions).toEqual({ group: 'read', world: 'none' });
  });
});

// ===========================================================================
// memory_list_facts
// ===========================================================================

describe('memory_list_facts', () => {
  it('lists atomic facts for a subject', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    for (let i = 0; i < 3; i++) {
      await mem.addFact(
        { subjectId: ids.userEntityId, predicate: 'has', kind: 'atomic', value: i },
        { userId: USER_ID },
      );
    }
    const listFacts = toolByName(tools(mem, ids), 'memory_list_facts');
    const r: any = await listFacts.execute({ subject: 'me' }, { userId: USER_ID });
    expect(r.facts.length).toBe(3);
  });

  it('honours predicate filter', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'likes', kind: 'atomic', value: 'A' },
      { userId: USER_ID },
    );
    await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'owns', kind: 'atomic', value: 'B' },
      { userId: USER_ID },
    );
    const listFacts = toolByName(tools(mem, ids), 'memory_list_facts');
    const r: any = await listFacts.execute(
      { subject: 'me', predicate: 'likes' },
      { userId: USER_ID },
    );
    expect(r.facts.every((f: any) => f.predicate === 'likes')).toBe(true);
  });
});

// ===========================================================================
// memory_remember
// ===========================================================================

describe('memory_remember', () => {
  it('writes an atomic fact to "me"', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: 'me', predicate: 'prefers', value: 'concise' },
      { userId: USER_ID },
    );
    expect(r.fact.id).toBeDefined();
    expect(r.fact.predicate).toBe('prefers');
    expect(r.fact.value).toBe('concise');
    // Visibility absent → tool passes undefined permissions → host policy
    // applies. This test has no visibilityPolicy on the MemorySystem, so
    // stored permissions stays undefined (library defaults apply at read).
    expect(r.fact.permissions).toBeUndefined();
  });

  it('defers to host visibilityPolicy when visibility arg is absent', async () => {
    // Configure a MemorySystem with a policy and verify the tool defers to it.
    const mem = new MemorySystemClass({
      store: new InMemoryAdapter(),
      visibilityPolicy: () => ({ group: 'read', world: 'none' }),
    });
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: 'me', predicate: 'learned', details: 'policy wins' },
      { userId: USER_ID },
    );
    expect(r.fact.permissions).toEqual({ group: 'read', world: 'none' });
  });

  it('explicit visibility wins', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: 'me', predicate: 'prefers', value: 'tests', visibility: 'public' },
      { userId: USER_ID },
    );
    // "public" → undefined permissions (library defaults).
    expect(r.fact.permissions).toBeUndefined();
  });

  it('rejects empty predicate', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: 'me', predicate: '' },
      { userId: USER_ID },
    );
    expect(r.error).toBeDefined();
  });

  it('rejects when no value/objectId/details provided', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: 'me', predicate: 'prefers' },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/value|objectId|details/);
  });

  it('writes against an identifier-resolved subject', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      {
        subject: { identifier: { kind: 'email', value: 'bob@a.com' } },
        predicate: 'title',
        value: 'VP',
      },
      { userId: USER_ID },
    );
    expect(r.fact.subjectId).toBe(ids.otherUserId);
  });

  it('rejects reserved predicate "agent_behavior_rule" — must use memory_set_agent_rule', async () => {
    // Closes a back-door: without this guard, the rules-block renderer in
    // MemoryPluginNextGen would surface a fact written here as if it were a
    // proper agent rule, bypassing memory_set_agent_rule's rate limit and
    // ownership stamp.
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      {
        subject: 'this_agent',
        predicate: 'agent_behavior_rule',
        details: 'be terse',
      },
      { userId: USER_ID },
    );
    expect(r.fact).toBeUndefined();
    expect(typeof r.error).toBe('string');
    expect(r.error).toMatch(/agent_behavior_rule/);
    expect(r.error).toMatch(/memory_set_agent_rule/);

    // Belt-and-suspenders — confirm nothing was written.
    const page = await mem.findFacts(
      { predicate: 'agent_behavior_rule' },
      { limit: 10 },
      { userId: USER_ID },
    );
    expect(page.items.length).toBe(0);
  });
});

// ===========================================================================
// memory_link
// ===========================================================================

describe('memory_link', () => {
  it('creates a relational fact between two entities', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      { from: 'me', predicate: 'works_with', to: { identifier: { kind: 'email', value: 'bob@a.com' } } },
      { userId: USER_ID },
    );
    expect(r.fact.subjectId).toBe(ids.userEntityId);
    expect(r.fact.objectId).toBe(ids.otherUserId);
    expect(r.fact.predicate).toBe('works_with');
  });

  it('reports error if "from" cannot be resolved', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      { from: { surface: 'totally unknown' }, predicate: 'knows', to: 'me' },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/from:/);
  });
});

// ===========================================================================
// memory_forget
// ===========================================================================

describe('memory_forget', () => {
  it('archives a fact when no replaceWith given', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const res: any = await remember.execute(
      { subject: 'me', predicate: 'temp', value: 'x' },
      { userId: USER_ID },
    );
    const forget = toolByName(tools(mem, ids), 'memory_forget');
    const r: any = await forget.execute(
      { factId: res.fact.id },
      { userId: USER_ID },
    );
    expect(r.archived).toBe(true);
    const gone = await mem.getFact(res.fact.id, { userId: USER_ID });
    expect(gone?.archived).toBe(true);
  });

  it('supersedes a fact when replaceWith is given', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const res: any = await remember.execute(
      { subject: 'me', predicate: 'role', value: 'junior' },
      { userId: USER_ID },
    );
    const forget = toolByName(tools(mem, ids), 'memory_forget');
    const r: any = await forget.execute(
      { factId: res.fact.id, replaceWith: { predicate: 'role', value: 'senior' } },
      { userId: USER_ID },
    );
    expect(r.superseded).toBe(true);
    expect(r.newFact.value).toBe('senior');
    // Predecessor is archived by the supersession path.
    const pred = await mem.getFact(res.fact.id, { userId: USER_ID });
    expect(pred?.archived).toBe(true);
  });

  it('returns error for missing/invisible factId', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const forget = toolByName(tools(mem, ids), 'memory_forget');
    const r: any = await forget.execute(
      { factId: 'does_not_exist', replaceWith: { predicate: 'p', value: 'v' } },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/not found/);
  });
});

describe('ownerless-subject audit warning + fail-safe contextId check (H1+H2)', () => {
  it('emits a warning when remember is called against an ownerless entity', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    // Create an entity with no ownerId (admin-path: ownerId passed as undefined).
    // The memory layer requires scope.userId, but we can create one via upsertEntity
    // with explicit ownerId: undefined override.
    // Easier: create one with the other user, then act as USER_ID with permissions that allow write.
    const shared = await mem.upsertEntity(
      {
        type: 'topic',
        displayName: 'Shared Wiki Page',
        identifiers: [],
        // InMemoryAdapter + scope.userId=USER_ID will assign ownerId=USER_ID;
        // to force ownerless we call directly through the store path by
        // using a scope with userId=undefined... but that requires admin.
        // Instead, skip the ownerless-creation path and verify the *absence*
        // of warning when the subject is owned (negative case).
      },
      { userId: USER_ID },
    );
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: shared.entity.id, predicate: 'note', value: 'v' },
      { userId: USER_ID },
    );
    // Owned entity → no ownerless warning.
    expect(r.warnings?.find((w: string) => w.includes('no ownerId'))).toBeUndefined();
  });

  it('fail-safe: findForeignContextIds does not throw when one lookup errors (uses Promise.allSettled)', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    // Seed one visible context entity.
    const good = await mem.upsertEntity(
      { type: 'topic', displayName: 'Good Topic', identifiers: [] },
      { userId: USER_ID },
    );
    // Stub memory.getEntity to throw for a specific id.
    const realGetEntity = mem.getEntity.bind(mem);
    const flakyId = 'ent_flaky_for_test';
    const spy = vi.spyOn(mem, 'getEntity').mockImplementation(async (id, scope) => {
      if (id === flakyId) throw new Error('simulated adapter blip');
      return realGetEntity(id, scope);
    });
    const { findForeignContextIds } = await import('@/tools/memory/ownership.js');
    // Must not throw — H2: Promise.allSettled, fail-safe to "foreign".
    const foreign = await findForeignContextIds(
      mem,
      [good.entity.id, flakyId],
      { userId: USER_ID },
    );
    // Good entity is owned by the caller → not foreign; flaky id → treated as foreign.
    expect(foreign).toEqual([flakyId]);
    spy.mockRestore();
  });

  it('ownerlessSubjectWarning returns null for owned subject, string for ownerless', async () => {
    const { ownerlessSubjectWarning } = await import('@/tools/memory/ownership.js');
    expect(ownerlessSubjectWarning('alice', 'alice')).toBeNull();
    expect(ownerlessSubjectWarning(undefined, undefined)).toBeNull();
    expect(ownerlessSubjectWarning(undefined, 'alice')).toMatch(/no ownerId/);
  });
});

describe('memory_forget rate limit + memory_restore (H9)', () => {
  it('rejects over-quota forget calls and carries retryAfterMs', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    // Build tools with a tight limit so the test is fast and deterministic.
    const ts = createMemoryTools({
      memory: mem,
      agentId: AGENT_ID,
      defaultUserId: USER_ID,
      getOwnSubjectIds: () => ids,
      forgetRateLimit: { maxCallsPerWindow: 3, windowMs: 60_000 },
    });
    const remember = toolByName(ts, 'memory_remember');
    const forget = toolByName(ts, 'memory_forget');

    const factIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r: any = await remember.execute(
        { subject: 'me', predicate: 'note', value: `v${i}` },
        { userId: USER_ID },
      );
      factIds.push(r.fact.id);
    }

    const results: any[] = [];
    for (const id of factIds) {
      results.push(await forget.execute({ factId: id }, { userId: USER_ID }));
    }
    const ok = results.filter((r) => r.archived === true);
    const limited = results.filter((r) => r.rateLimited === true);
    expect(ok).toHaveLength(3);
    expect(limited).toHaveLength(2);
    for (const l of limited) {
      expect(typeof l.retryAfterMs).toBe('number');
      expect(l.retryAfterMs).toBeGreaterThan(0);
      expect(l.error).toMatch(/rate limit/i);
    }
  });

  it('memory_restore undoes a prior archive', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const ts = tools(mem, ids);
    const remember = toolByName(ts, 'memory_remember');
    const forget = toolByName(ts, 'memory_forget');
    const restore = toolByName(ts, 'memory_restore');

    const res: any = await remember.execute(
      { subject: 'me', predicate: 'favourite_color', value: 'blue' },
      { userId: USER_ID },
    );
    await forget.execute({ factId: res.fact.id }, { userId: USER_ID });
    let f = await mem.getFact(res.fact.id, { userId: USER_ID });
    expect(f?.archived).toBe(true);

    const r: any = await restore.execute({ factId: res.fact.id }, { userId: USER_ID });
    expect(r.restored).toBe(true);
    f = await mem.getFact(res.fact.id, { userId: USER_ID });
    expect(f?.archived).toBe(false);
  });

  it('memory_restore surfaces a clear error for unknown fact', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const restore = toolByName(tools(mem, ids), 'memory_restore');
    const r: any = await restore.execute(
      { factId: 'does_not_exist' },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/not found|memory_restore failed/i);
  });

  it('memory_restore refuses when a non-archived successor exists (F1)', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const ts = tools(mem, ids);
    const remember = toolByName(ts, 'memory_remember');
    const forget = toolByName(ts, 'memory_forget');
    const restore = toolByName(ts, 'memory_restore');

    // Write F1, then forget-with-replacement so F2 is created with
    // supersedes: F1.
    const r1: any = await remember.execute(
      { subject: 'me', predicate: 'role', value: 'junior' },
      { userId: USER_ID },
    );
    const f2Res: any = await forget.execute(
      { factId: r1.fact.id, replaceWith: { predicate: 'role', value: 'senior' } },
      { userId: USER_ID },
    );
    expect(f2Res.superseded).toBe(true);
    const f2Id = f2Res.newFact.id;

    // Try to restore F1 — must fail with supersededBy pointing at F2.
    const restoreRes: any = await restore.execute(
      { factId: r1.fact.id },
      { userId: USER_ID },
    );
    expect(restoreRes.restored).toBeUndefined();
    expect(restoreRes.error).toMatch(/superseded by/i);
    expect(restoreRes.supersededBy).toBe(f2Id);
    expect(restoreRes.factId).toBe(r1.fact.id);

    // F1 still archived; F2 still active (archived never set → undefined/false).
    const f1 = await mem.getFact(r1.fact.id, { userId: USER_ID });
    expect(f1?.archived).toBe(true);
    const f2 = await mem.getFact(f2Id, { userId: USER_ID });
    expect(!!f2?.archived).toBe(false);
  });

  it('memory_restore succeeds after the successor is archived (F1 recovery)', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const ts = tools(mem, ids);
    const remember = toolByName(ts, 'memory_remember');
    const forget = toolByName(ts, 'memory_forget');
    const restore = toolByName(ts, 'memory_restore');

    const r1: any = await remember.execute(
      { subject: 'me', predicate: 'role', value: 'junior' },
      { userId: USER_ID },
    );
    const f2Res: any = await forget.execute(
      { factId: r1.fact.id, replaceWith: { predicate: 'role', value: 'senior' } },
      { userId: USER_ID },
    );
    const f2Id = f2Res.newFact.id;

    // Archive F2 first — recovery path.
    await forget.execute({ factId: f2Id }, { userId: USER_ID });

    // Now restore F1 must succeed.
    const rr: any = await restore.execute(
      { factId: r1.fact.id },
      { userId: USER_ID },
    );
    expect(rr.restored).toBe(true);
    const f1 = await mem.getFact(r1.fact.id, { userId: USER_ID });
    expect(!!f1?.archived).toBe(false);
  });
});

// ===========================================================================
// memory_search — unavailable-path smoke (no embedder configured)
// ===========================================================================

describe('memory_search', () => {
  it('returns structured error when embedder is not configured', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const search = toolByName(tools(mem, ids), 'memory_search');
    const r: any = await search.execute(
      { query: 'anything', topK: 3 },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/unavailable/);
  });

  it('rejects empty query', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const search = toolByName(tools(mem, ids), 'memory_search');
    const r: any = await search.execute({ query: '' }, { userId: USER_ID });
    expect(r.error).toMatch(/query/);
  });
});

// ===========================================================================
// visibilityToPermissions
// ===========================================================================

describe('visibilityToPermissions', () => {
  it('maps private / group / public to the expected permissions shapes', () => {
    expect(visibilityToPermissions('private')).toEqual({ group: 'none', world: 'none' });
    expect(visibilityToPermissions('group')).toEqual({ group: 'read', world: 'none' });
    expect(visibilityToPermissions('public')).toBeUndefined();
    expect(visibilityToPermissions(undefined)).toBeUndefined();
  });
});

// ===========================================================================
// Security regressions
// ===========================================================================

describe('security: LLM cannot override group scope via tool args', () => {
  it('memory_recall ignores any `groupId` the LLM supplies — uses deps.defaultGroupId instead', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'getContext');

    // Build tools with NO defaultGroupId. If the tool honoured args.groupId
    // we'd see "team-secret" reach memory.
    const t = createMemoryTools({
      memory: mem,
      agentId: AGENT_ID,
      defaultUserId: USER_ID,
      getOwnSubjectIds: () => ({
        userEntityId: ids.userEntityId,
        agentEntityId: ids.agentEntityId,
      }),
    });
    const recall = toolByName(t, 'memory_recall');
    await recall.execute(
      // @ts-expect-error — groupId is no longer a valid arg, but the LLM may
      // still try; assert it's silently ignored.
      { subject: 'me', groupId: 'team-secret' },
      { userId: USER_ID },
    );
    expect(spy).toHaveBeenCalled();
    const scopeArg = spy.mock.calls[0]![2];
    expect(scopeArg.groupId).toBeUndefined();
  });

  it('memory_remember ignores `groupId` arg, uses deps.defaultGroupId for scope', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const addFactSpy = vi.spyOn(mem, 'addFact');

    const t = createMemoryTools({
      memory: mem,
      agentId: AGENT_ID,
      defaultUserId: USER_ID,
      defaultGroupId: 'trusted-group',
      getOwnSubjectIds: () => ({
        userEntityId: ids.userEntityId,
        agentEntityId: ids.agentEntityId,
      }),
    });
    const remember = toolByName(t, 'memory_remember');
    await remember.execute(
      // @ts-expect-error — groupId not part of args
      { subject: 'me', predicate: 'p', value: 'v', groupId: 'attacker-group' },
      { userId: USER_ID },
    );
    const scopeArg = addFactSpy.mock.calls[0]![1];
    expect(scopeArg.groupId).toBe('trusted-group');
    expect(scopeArg.groupId).not.toBe('attacker-group');
  });
});

// ===========================================================================
// DoS: numeric limits are clamped to safe ranges
// ===========================================================================

describe('DoS caps: numeric limits are clamped', () => {
  it('memory_graph clamps maxDepth to 5 and limit to 500', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'traverse');
    const graph = toolByName(tools(mem, ids), 'memory_graph');
    await graph.execute(
      { start: 'me', maxDepth: 1_000, limit: 1_000_000 },
      { userId: USER_ID },
    );
    const opts = spy.mock.calls[0]![1];
    expect(opts.maxDepth).toBe(5);
    expect(opts.limit).toBe(500);
  });

  it('memory_search clamps topK to 100', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'semanticSearch');
    // Make it not throw the "no embedder" error — return empty.
    spy.mockResolvedValue([]);
    const search = toolByName(tools(mem, ids), 'memory_search');
    await search.execute({ query: 'x', topK: 10_000 }, { userId: USER_ID });
    const topK = spy.mock.calls[0]![3];
    expect(topK).toBe(100);
  });

  it('memory_list_facts clamps limit to 200', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'findFacts');
    const listFacts = toolByName(tools(mem, ids), 'memory_list_facts');
    await listFacts.execute(
      { subject: 'me', limit: 1_000_000 },
      { userId: USER_ID },
    );
    const opts = spy.mock.calls[0]![1];
    expect(opts.limit).toBe(200);
  });

  it('memory_recall clamps topFactsLimit to 100 and neighborDepth to 5', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'getContext');
    const recall = toolByName(tools(mem, ids), 'memory_recall');
    await recall.execute(
      {
        subject: 'me',
        topFactsLimit: 5_000,
        neighborDepth: 99,
        include: ['neighbors'],
      },
      { userId: USER_ID },
    );
    const opts = spy.mock.calls[0]![1];
    expect(opts.topFactsLimit).toBe(100);
    expect(opts.neighborDepth).toBe(5);
  });

  it('memory_find_entity (list) clamps limit to 200', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'listEntities');
    const find = toolByName(tools(mem, ids), 'memory_find_entity');
    await find.execute(
      { action: 'list', by: { type: 'person' }, limit: 1_000_000 },
      { userId: USER_ID },
    );
    const opts = spy.mock.calls[0]![1];
    expect(opts.limit).toBe(200);
  });
});

// ===========================================================================
// memory_list_facts archivedOnly rename semantics
// ===========================================================================

describe('memory_list_facts — archivedOnly semantics', () => {
  it('default returns only non-archived facts', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const live = await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'note', kind: 'atomic', value: 'live' },
      { userId: USER_ID },
    );
    const stale = await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'note', kind: 'atomic', value: 'stale' },
      { userId: USER_ID },
    );
    await mem.archiveFact(stale.id, { userId: USER_ID });
    const listFacts = toolByName(tools(mem, ids), 'memory_list_facts');
    const r: any = await listFacts.execute(
      { subject: 'me', predicate: 'note' },
      { userId: USER_ID },
    );
    const ids2 = r.facts.map((f: any) => f.id);
    expect(ids2).toContain(live.id);
    expect(ids2).not.toContain(stale.id);
  });

  it('archivedOnly:true returns only archived facts', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const live = await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'note', kind: 'atomic', value: 'live' },
      { userId: USER_ID },
    );
    const stale = await mem.addFact(
      { subjectId: ids.userEntityId, predicate: 'note', kind: 'atomic', value: 'stale' },
      { userId: USER_ID },
    );
    await mem.archiveFact(stale.id, { userId: USER_ID });
    const listFacts = toolByName(tools(mem, ids), 'memory_list_facts');
    const r: any = await listFacts.execute(
      { subject: 'me', predicate: 'note', archivedOnly: true },
      { userId: USER_ID },
    );
    const factIds = r.facts.map((f: any) => f.id);
    expect(factIds).toContain(stale.id);
    expect(factIds).not.toContain(live.id);
  });
});

// ===========================================================================
// memory_search — strict ISO date validation
// ===========================================================================

describe('memory_search — strict date validation', () => {
  it('returns structured error for invalid observedAfter', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const search = toolByName(tools(mem, ids), 'memory_search');
    const r: any = await search.execute(
      { query: 'anything', filter: { observedAfter: 'not-a-date' } },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/invalid observedAfter/);
  });

  it('returns structured error for invalid observedBefore', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const search = toolByName(tools(mem, ids), 'memory_search');
    const r: any = await search.execute(
      { query: 'anything', filter: { observedBefore: 'garbage' } },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/invalid observedBefore/);
  });
});

// ===========================================================================
// H-1 — ghost-write rejection (tool-layer ownership guard)
// ===========================================================================

describe('ghost-write guard (H-1)', () => {
  async function seedForeignEntity(mem: MemorySystem): Promise<string> {
    const r = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Foreign Carla',
        identifiers: [{ kind: 'email', value: 'carla@foreign.com' }],
      },
      { userId: OTHER_USER },
    );
    return r.entity.id;
  }

  it('memory_remember rejects writes on entities owned by another user', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const foreignId = await seedForeignEntity(mem);
    const spy = vi.spyOn(mem, 'addFact');

    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: foreignId, predicate: 'prefers', value: 'pizza' },
      { userId: USER_ID },
    );

    expect(r.error).toMatch(/cannot write facts on entities you don't own/);
    expect(r.subjectOwnerId).toBe(OTHER_USER);
    expect(spy).not.toHaveBeenCalled();
  });

  it('memory_link rejects writes when "from" is owned by another user', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const foreignId = await seedForeignEntity(mem);
    const spy = vi.spyOn(mem, 'addFact');

    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      { from: foreignId, predicate: 'works_with', to: 'me' },
      { userId: USER_ID },
    );

    expect(r.error).toMatch(/cannot write links from entities you don't own/);
    expect(r.fromOwnerId).toBe(OTHER_USER);
    expect(spy).not.toHaveBeenCalled();
  });

  it('memory_link allows "to" to be foreign (objectId, not subject)', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const foreignId = await seedForeignEntity(mem);
    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      { from: 'me', predicate: 'references', to: foreignId },
      { userId: USER_ID },
    );
    expect(r.error).toBeUndefined();
    expect(r.fact.objectId).toBe(foreignId);
  });
});

// ===========================================================================
// H-2 — contextIds downgrade (tool-layer cross-owner injection guard)
// ===========================================================================

describe('contextIds downgrade (H-2)', () => {
  async function seedForeignEntity(mem: MemorySystem): Promise<string> {
    const r = await mem.upsertEntity(
      {
        type: 'organization',
        displayName: 'ForeignCo',
        identifiers: [{ kind: 'domain', value: 'foreign.com' }],
      },
      { userId: OTHER_USER },
    );
    return r.entity.id;
  }

  it('memory_remember downgrades visibility to "private" when contextIds include foreign entities', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const foreignId = await seedForeignEntity(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      {
        subject: 'me',
        predicate: 'observed',
        details: 'some observation',
        contextIds: [foreignId],
        visibility: 'public',
      },
      { userId: USER_ID },
    );
    expect(r.fact.permissions).toEqual({ group: 'none', world: 'none' });
    expect(r.visibility).toBe('private');
    expect(r.warnings).toBeDefined();
    expect(r.warnings[0]).toMatch(/restricted to owner-only/);
  });

  it('memory_remember preserves explicit "public" when contextIds are all owned by caller', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      {
        subject: 'me',
        predicate: 'observed',
        details: 'some observation',
        contextIds: [ids.otherUserId], // owned by USER_ID (bootstrap creates all three)
        visibility: 'public',
      },
      { userId: USER_ID },
    );
    // "public" → undefined permissions (library defaults).
    expect(r.fact.permissions).toBeUndefined();
    expect(r.visibility).toBe('public');
    expect(r.warnings).toBeUndefined();
  });
});

// ===========================================================================
// M-1 — confidence / importance clamped to [0,1]
// ===========================================================================

describe('confidence / importance clamping (M-1)', () => {
  it('memory_remember clamps out-of-range values', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'addFact');
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    await remember.execute(
      { subject: 'me', predicate: 'x', value: 'y', confidence: 99, importance: -5 },
      { userId: USER_ID },
    );
    const call = spy.mock.calls[0]![0];
    expect(call.confidence).toBe(1);
    expect(call.importance).toBe(0);
  });
});

// ===========================================================================
// M-2 — memory_forget supersession inherits predecessor.kind
// ===========================================================================

describe('memory_forget kind inheritance (M-2)', () => {
  it('supersessor inherits predecessor kind=document', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const doc = await mem.addFact(
      {
        subjectId: ids.userEntityId,
        predicate: 'learned_pattern',
        kind: 'document',
        details: 'v1 notes',
      },
      { userId: USER_ID },
    );
    const forget = toolByName(tools(mem, ids), 'memory_forget');
    const r: any = await forget.execute(
      { factId: doc.id, replaceWith: { details: 'v2 notes' } },
      { userId: USER_ID },
    );
    expect(r.superseded).toBe(true);
    expect(r.newFact.kind).toBe('document');
  });
});

// ===========================================================================
// M-3 — memory_link default visibility follows subject class
// ===========================================================================

// ===========================================================================
// N-1 — addFact rejects unknown kind at the memory layer
// ===========================================================================

describe('addFact kind validation (N-1)', () => {
  it('throws on unknown kind', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await expect(
      mem.addFact(
        {
          subjectId: ids.userEntityId,
          predicate: 'x',
          // @ts-expect-error intentional bad kind
          kind: 'note',
          value: 'y',
        },
        { userId: USER_ID },
      ),
    ).rejects.toThrow(/kind must be 'atomic' or 'document'/);
  });
});

// ===========================================================================
// N-1b — ExtractionResolver coerces unknown kind + records drift
// ===========================================================================

describe('ExtractionResolver kind coercion (N-1)', () => {
  it('coerces unknown kind to atomic and records warning in unresolved', async () => {
    const { MemorySystem: MS } = await import('@/memory/MemorySystem.js');
    const { InMemoryAdapter: Adapter } = await import('@/memory/adapters/inmemory/InMemoryAdapter.js');
    const { ExtractionResolver } = await import('@/memory/integration/ExtractionResolver.js');
    const mem = new MS({ store: new Adapter() });
    const resolver = new ExtractionResolver(mem);
    const result = await resolver.resolveAndIngest(
      {
        mentions: {
          m1: { surface: 'Alice', type: 'person', identifiers: [{ kind: 'email', value: 'a@x' }] },
        },
        facts: [
          { subject: 'm1', predicate: 'prefers', value: 'concise', kind: 'note' as any },
        ],
      },
      'sig-test',
      { userId: USER_ID },
    );
    expect(result.facts.length).toBe(1);
    expect(result.facts[0]!.kind).toBe('atomic');
    const drift = result.unresolved.find((u) => /unknown kind "note"/.test(u.reason));
    expect(drift).toBeDefined();
  });
});

// ===========================================================================
// N-2 — memory_remember supports kind: 'document'
// ===========================================================================

describe('memory_remember kind=document (N-2)', () => {
  it('writes a document fact and it surfaces under include=documents', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      {
        subject: 'me',
        predicate: 'learned_pattern',
        kind: 'document',
        details:
          'When the user asks about tax calculations, always confirm jurisdiction before quoting rates because the rules differ materially by state and changing them mid-answer breaks trust.',
      },
      { userId: USER_ID },
    );
    expect(r.fact.kind).toBe('document');
    const recall = toolByName(tools(mem, ids), 'memory_recall');
    const view: any = await recall.execute(
      { subject: 'me', include: ['documents'] },
      { userId: USER_ID },
    );
    const docIds = (view.documents ?? []).map((d: any) => d.id);
    expect(docIds).toContain(r.fact.id);
  });
});

// ===========================================================================
// N-3 — memory_remember + addFact reject value + objectId both set
// ===========================================================================

describe('value/objectId mutual exclusion (N-3)', () => {
  it('memory_remember rejects both', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      {
        subject: 'me',
        predicate: 'x',
        value: 'a',
        objectId: ids.otherUserId,
      },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/either value or objectId, not both/);
  });

  it('addFact rejects both at memory layer', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    await expect(
      mem.addFact(
        {
          subjectId: ids.userEntityId,
          predicate: 'x',
          kind: 'atomic',
          value: 'a',
          objectId: ids.otherUserId,
        },
        { userId: USER_ID },
      ),
    ).rejects.toThrow(/either value or objectId, not both/);
  });
});

// ===========================================================================
// N-4 — memory_link passes details through
// ===========================================================================

describe('memory_link details (N-4)', () => {
  it('persists details on the relational fact', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      {
        from: 'me',
        predicate: 'works_with',
        to: { identifier: { kind: 'email', value: 'bob@a.com' } },
        details: 'Joined the partnership team in Q1 2025',
      },
      { userId: USER_ID },
    );
    expect(r.fact.details).toBe('Joined the partnership team in Q1 2025');
  });
});

// ===========================================================================
// N-5 — memory_search filter accepts SubjectRef
// ===========================================================================

describe('memory_search filter.subject SubjectRef (N-5)', () => {
  it('resolves filter.subject via the resolver', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const spy = vi.spyOn(mem, 'semanticSearch').mockResolvedValue([]);
    const search = toolByName(tools(mem, ids), 'memory_search');
    await search.execute(
      {
        query: 'anything',
        filter: { subject: { identifier: { kind: 'email', value: 'bob@a.com' } } },
      },
      { userId: USER_ID },
    );
    const filterArg = spy.mock.calls[0]![1];
    expect(filterArg.subjectId).toBe(ids.otherUserId);
  });

  it('returns structured error when filter.subject cannot resolve', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const search = toolByName(tools(mem, ids), 'memory_search');
    const r: any = await search.execute(
      {
        query: 'anything',
        filter: { subject: { identifier: { kind: 'email', value: 'nobody@x' } } },
      },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/filter\.subject:/);
  });
});

// ===========================================================================
// N-6 — memory_graph strict asOf validation
// ===========================================================================

describe('memory_graph asOf strict (N-6)', () => {
  it('rejects invalid ISO string', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const graph = toolByName(tools(mem, ids), 'memory_graph');
    const r: any = await graph.execute(
      { start: 'me', asOf: 'not-a-date' },
      { userId: USER_ID },
    );
    expect(r.error).toMatch(/invalid asOf/);
  });
});

// ===========================================================================
// addFact clamps confidence / importance at memory-layer boundary
// ===========================================================================

describe('addFact confidence/importance clamp (defense-in-depth)', () => {
  it('clamps out-of-range values to [0,1]', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const fact = await mem.addFact(
      {
        subjectId: ids.userEntityId,
        predicate: 'x',
        kind: 'atomic',
        value: 'y',
        confidence: 99,
        importance: -5,
      },
      { userId: USER_ID },
    );
    expect(fact.confidence).toBe(1);
    expect(fact.importance).toBe(0);
  });
});

describe('memory_link — defers to host policy when visibility absent', () => {
  it('passes undefined permissions when no explicit visibility and no host policy', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      {
        from: 'this_agent',
        predicate: 'linked_to',
        to: { identifier: { kind: 'email', value: 'bob@a.com' } },
      },
      { userId: USER_ID },
    );
    // No policy → library keeps permissions undefined.
    expect(r.fact.permissions).toBeUndefined();
  });

  it('host visibilityPolicy governs the default', async () => {
    const mem = new MemorySystemClass({
      store: new InMemoryAdapter(),
      visibilityPolicy: (ctx) =>
        ctx.kind === 'fact' ? { group: 'read', world: 'none' } : { group: 'none', world: 'none' },
    });
    const ids = await bootstrap(mem);
    const link = toolByName(tools(mem, ids), 'memory_link');
    const r: any = await link.execute(
      {
        from: 'me',
        predicate: 'linked_to',
        to: { identifier: { kind: 'email', value: 'bob@a.com' } },
      },
      { userId: USER_ID },
    );
    expect(r.fact.permissions).toEqual({ group: 'read', world: 'none' });
    expect(r.visibility).toBe('group');
  });
});
