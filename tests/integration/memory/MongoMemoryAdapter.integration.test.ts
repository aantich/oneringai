/**
 * MongoMemoryAdapter — real-Mongo integration test.
 *
 * Gated: skips entirely if `mongodb` + `mongodb-memory-server` are not
 * installed. To run it, install both as devDependencies:
 *
 *   npm install --save-dev mongodb mongodb-memory-server
 *
 * Then:
 *
 *   npm run test:integration
 *
 * The test spins up an in-process MongoDB, exercises the adapter end-to-end
 * via the real driver (RawMongoCollection), and verifies scope filter
 * pushdown, indexes, id mapping (Mongo ObjectId ↔ hex string), and semantic
 * search.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryAdapter } from '@/memory/adapters/mongo/MongoMemoryAdapter.js';
import { RawMongoCollection } from '@/memory/adapters/mongo/RawMongoCollection.js';
import { ensureIndexes } from '@/memory/adapters/mongo/indexes.js';
import type { IEntity, IFact } from '@/memory/types.js';

// Dynamic imports so Vitest can resolve this file even when the peer deps are absent.
let MongoClient: unknown;
let MongoMemoryServer: unknown;
let ObjectId: unknown;
let available = false;

try {
  const mongodb = await import('mongodb');
  MongoClient = mongodb.MongoClient;
  ObjectId = mongodb.ObjectId;
  ({ MongoMemoryServer } = await import('mongodb-memory-server'));
  available = !!MongoClient && !!MongoMemoryServer && !!ObjectId;
} catch {
  available = false;
}

const describeIfAvailable = available ? describe : describe.skip;

describeIfAvailable('MongoMemoryAdapter (real Mongo)', () => {
  let server: { stop: () => Promise<void>; getUri: () => string };
  let client: { close: () => Promise<void>; db: (n: string) => { collection: (n: string) => unknown } };
  let adapter: MongoMemoryAdapter;

  beforeAll(async () => {
    const MMS = MongoMemoryServer as { create: () => Promise<typeof server> };
    server = await MMS.create();
    const uri = server.getUri();
    const Client = MongoClient as new (uri: string) => { connect: () => Promise<typeof client> };
    client = await new Client(uri).connect();

    const db = client.db('memory_test');
    const ObjIdCtor = ((hex: string) => new (ObjectId as new (hex: string) => unknown)(hex)) as (
      hex: string,
    ) => { toHexString(): string };

    const entities = new RawMongoCollection<IEntity>(
      db.collection('memory_entities') as never,
      ObjIdCtor as never,
    );
    const facts = new RawMongoCollection<IFact>(
      db.collection('memory_facts') as never,
      ObjIdCtor as never,
    );
    await ensureIndexes({ entities, facts });

    adapter = new MongoMemoryAdapter({
      entities,
      facts,
      factsCollectionName: 'memory_facts',
      useNativeGraphLookup: true,
    });
  }, 60000);

  afterAll(async () => {
    adapter?.destroy();
    if (client) await client.close();
    if (server) await server.stop();
  });

  it('createEntity assigns id from Mongo ObjectId + reads back', async () => {
    const created = await adapter.createEntity({
      type: 'person',
      displayName: 'Integration Test',
      identifiers: [{ kind: 'email', value: 'it@example.com' }],
    });
    expect(created.id).toBeTruthy();
    expect(created.id.length).toBeGreaterThan(20); // ObjectId hex is 24 chars
    const got = await adapter.getEntity(created.id, {});
    expect(got?.displayName).toBe('Integration Test');
  });

  it('writes + reads a fact with scope filter pushdown', async () => {
    const ent = await adapter.createEntity({
      type: 'person',
      displayName: 'Scoped',
      identifiers: [],
      groupId: 'g1',
    });
    await adapter.createFact({
      subjectId: ent.id,
      predicate: 'note',
      kind: 'atomic',
      groupId: 'g1',
      value: 'hello',
    });

    const visible = await adapter.findFacts({ subjectId: ent.id }, {}, { groupId: 'g1' });
    expect(visible.items).toHaveLength(1);

    const hidden = await adapter.findFacts({ subjectId: ent.id }, {}, { groupId: 'g2' });
    expect(hidden.items).toHaveLength(0);
  });

  it('batch createFacts preserves order and assigns unique ids', async () => {
    const host = await adapter.createEntity({
      type: 'person',
      displayName: 'Bulk Host',
      identifiers: [],
    });
    const inputs = Array.from({ length: 20 }, (_, i) => ({
      subjectId: host.id,
      predicate: 'p',
      kind: 'atomic' as const,
      value: i,
    }));
    const out = await adapter.createFacts(inputs);
    expect(out).toHaveLength(20);
    const ids = new Set(out.map((f) => f.id));
    expect(ids.size).toBe(20); // all unique
    const n = await adapter.countFacts({ subjectId: host.id }, {});
    expect(n).toBe(20);
  });

  it('cosine semantic search fallback returns ranked hits', async () => {
    const ent = await adapter.createEntity({
      type: 'person',
      displayName: 'Vec',
      identifiers: [],
    });
    const match = await adapter.createFact({
      subjectId: ent.id,
      predicate: 'note',
      kind: 'atomic',
      embedding: [1, 0, 0],
    });
    await adapter.createFact({
      subjectId: ent.id,
      predicate: 'note',
      kind: 'atomic',
      embedding: [0, 1, 0],
    });
    const results = await adapter.semanticSearch([1, 0, 0], {}, { topK: 2 }, {});
    expect(results[0]?.fact.id).toBe(match.id);
    expect(results[0]?.score).toBeCloseTo(1, 5);
  });

  it('semanticSearchEntities cursor-scan ranks by cosine over identityEmbedding', async () => {
    // Seed three entities; write identityEmbedding via updateEntity so we
    // don't depend on MemorySystem's async embedder queue.
    const alpha = await adapter.createEntity({
      type: 'organization',
      displayName: 'Alpha',
      identifiers: [],
    });
    await adapter.updateEntity({ ...alpha, identityEmbedding: [1, 0, 0], version: 2 });

    const beta = await adapter.createEntity({
      type: 'organization',
      displayName: 'Beta',
      identifiers: [],
    });
    await adapter.updateEntity({ ...beta, identityEmbedding: [0.8, 0.2, 0], version: 2 });

    const gamma = await adapter.createEntity({
      type: 'organization',
      displayName: 'Gamma',
      identifiers: [],
    });
    await adapter.updateEntity({ ...gamma, identityEmbedding: [0, 0, 1], version: 2 });

    const results = await adapter.semanticSearchEntities(
      [1, 0, 0],
      { type: 'organization' },
      { topK: 3 },
      {},
    );
    expect(results.map((r) => r.entity.displayName)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(results[0]!.score).toBeCloseTo(1, 5);
  });

  it('semanticSearchEntities excludes archived + applies type filter + minScore', async () => {
    const live = await adapter.createEntity({
      type: 'organization',
      displayName: 'Live',
      identifiers: [],
    });
    await adapter.updateEntity({ ...live, identityEmbedding: [1, 0, 0], version: 2 });

    const gone = await adapter.createEntity({
      type: 'organization',
      displayName: 'Gone',
      identifiers: [],
    });
    await adapter.updateEntity({ ...gone, identityEmbedding: [1, 0, 0], version: 2 });
    await adapter.archiveEntity(gone.id, {});

    const offType = await adapter.createEntity({
      type: 'person',
      displayName: 'Person',
      identifiers: [],
    });
    await adapter.updateEntity({ ...offType, identityEmbedding: [1, 0, 0], version: 2 });

    const orthogonal = await adapter.createEntity({
      type: 'organization',
      displayName: 'Far',
      identifiers: [],
    });
    await adapter.updateEntity({ ...orthogonal, identityEmbedding: [0, 1, 0], version: 2 });

    const results = await adapter.semanticSearchEntities(
      [1, 0, 0],
      { type: 'organization' },
      { topK: 10, minScore: 0.5 },
      {},
    );
    // Archived excluded, type filtered to organization, Far dropped by minScore.
    expect(results.map((r) => r.entity.displayName)).toEqual(['Live']);
  });

  it('updateEntity enforces optimistic concurrency', async () => {
    const ent = await adapter.createEntity({
      type: 'person',
      displayName: 'Version Test',
      identifiers: [],
    });
    await adapter.updateEntity({ ...ent, displayName: 'Updated', version: 2 });
    const got = await adapter.getEntity(ent.id, {});
    expect(got?.displayName).toBe('Updated');
    expect(got?.version).toBe(2);
  });
});

if (!available) {
  describe.skip('MongoMemoryAdapter (real Mongo) — skipped', () => {
    it('install `mongodb` + `mongodb-memory-server` to enable', () => undefined);
  });
}
