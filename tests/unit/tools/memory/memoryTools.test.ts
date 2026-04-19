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

import { describe, it, expect, beforeEach } from 'vitest';
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

describe('memory_find_entity', () => {
  it('finds by identifier across different IDs on the same entity', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    // Enrich Bob with a second identifier via upsert.
    const find = toolByName(tools(mem, ids), 'memory_find_entity');
    await find.execute(
      {
        action: 'upsert',
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

  it('upsert requires type + displayName', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const find = toolByName(tools(mem, ids), 'memory_find_entity');
    const r1: any = await find.execute(
      { action: 'upsert', displayName: 'X' },
      { userId: USER_ID },
    );
    expect(r1.error).toMatch(/type/);
    const r2: any = await find.execute(
      { action: 'upsert', type: 'topic' },
      { userId: USER_ID },
    );
    expect(r2.error).toMatch(/displayName/);
  });

  it('upsert with visibility "group" stamps group:read,world:none', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const find = toolByName(tools(mem, ids), 'memory_find_entity');
    const r: any = await find.execute(
      {
        action: 'upsert',
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
    // Default visibility for "me" = private → { group: 'none', world: 'none' }
    expect(r.fact.permissions).toEqual({ group: 'none', world: 'none' });
  });

  it('default visibility for "this_agent" is "group"', async () => {
    const mem = makeMem();
    const ids = await bootstrap(mem);
    const remember = toolByName(tools(mem, ids), 'memory_remember');
    const r: any = await remember.execute(
      { subject: 'this_agent', predicate: 'learned', details: 'x' },
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
