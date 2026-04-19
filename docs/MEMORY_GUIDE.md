# Memory Layer — User Guide

How to use the oneringai memory layer as a persistent, queryable, agent-accessible knowledge store.

This guide is task-oriented and assumes you've at least skimmed the API reference ([MEMORY_API.md](./MEMORY_API.md)).

---

## Table of Contents

1. [What the memory layer is](#what-the-memory-layer-is)
2. [Quickstart](#quickstart)
3. [How memory gets populated — caller vs library](#how-memory-gets-populated--caller-vs-library)
4. [Choosing a storage backend](#choosing-a-storage-backend)
5. [Configuring embedders and LLM processors](#configuring-embedders-and-llm-processors)
6. [Modeling your domain](#modeling-your-domain)
7. [Writing knowledge](#writing-knowledge)
8. [Reading knowledge](#reading-knowledge)
9. [Controlling the predicate vocabulary](#controlling-the-predicate-vocabulary)
10. [The LLM extraction pipeline](#the-llm-extraction-pipeline)
11. [Entity resolution in practice](#entity-resolution-in-practice)
12. [Profile generation](#profile-generation)
13. [Scope and multi-tenancy](#scope-and-multi-tenancy)
14. [Common patterns](#common-patterns)
15. [Scaling](#scaling)
16. [Troubleshooting](#troubleshooting)

---

## What the memory layer is

A brain-like knowledge store with two first-class concepts:

**Entities** = identity. People, organizations, projects, tasks, events, topics. Each has a display name, aliases, identifiers (emails, domains, etc.), and type-specific metadata.

**Facts** = knowledge. Triples like `(John, works_at, Microsoft)` or `(John, mentioned_topic, "ERP renewal")`. Facts carry confidence, importance, provenance (source signal id), temporal validity, and can bind to multiple entities via `contextIds`.

Everything is append-only with supersession (state changes create new facts that archive predecessors), scope-aware (global / group / user-private), and can be retrieved in brain-like ways (profile + related tasks + related events + top facts in one query).

**Design goals:**
- LLMs never see entity IDs — they emit surface forms ("Microsoft", "Q3 Planning"), and the system resolves to IDs.
- Same code path for tasks, events, people, projects — all are entities with type-specific metadata.
- Multi-entity binding via `contextIds` — "John assigned_task X in the context of Acme-Deal" without polluting the triple.
- Pluggable storage — InMemory for dev, Mongo for production (works with raw driver or Meteor collections).
- Pluggable LLM — embedders + profile generators use any oneringai Connector.

---

## Quickstart

The minimum to get a working memory system in-process:

```ts
import { MemorySystem, InMemoryAdapter } from '@everworker/oneringai/memory';

const memory = new MemorySystem({ store: new InMemoryAdapter() });

// Upsert an entity
const { entity: john } = await memory.upsertEntity(
  {
    type: 'person',
    displayName: 'John Doe',
    identifiers: [{ kind: 'email', value: 'john@acme.com' }],
  },
  {},
);

// Write a fact about them
await memory.addFact(
  {
    subjectId: john.id,
    predicate: 'works_at',
    kind: 'atomic',
    objectId: /* some org entity id */,
  },
  {},
);

// Retrieve context
const view = await memory.getContext(john.id, {}, {});
console.log(view.profile);        // null (no profile yet — requires a generator)
console.log(view.topFacts);       // ranked facts about John
console.log(view.relatedTasks);   // his active tasks
console.log(view.relatedEvents);  // his recent events

await memory.shutdown();
```

For a production setup with Mongo + a real LLM profile generator, see the next section.

---

## How memory gets populated — caller vs library

Straight answer: **the caller produces facts. Memory stores them.** The memory layer does NOT auto-scrape text — you own the LLM call. But we provide two helpers that make the LLM→memory path a one-liner once you have text.

### Two ways to populate

**Way 1 — Direct (caller builds the structure).** You construct entities + facts yourself. Used for structured sources: forms, CRM imports, rules-derived facts, explicit user actions, state-change writes from your app.

```ts
// Any entity type — same API, change `type` + metadata.
const john = (await memory.upsertEntity({
  type: 'person',
  displayName: 'John Doe',
  identifiers: [{ kind: 'email', value: 'john@acme.com' }],
}, scope)).entity;

const task = (await memory.upsertEntity({
  type: 'task',
  displayName: 'Send Q3 proposal',
  identifiers: [],
  metadata: { state: 'pending', dueAt: new Date('2026-04-30'), assigneeId: john.id },
}, scope)).entity;

const event = (await memory.upsertEntity({
  type: 'event',
  displayName: 'Q3 review',
  identifiers: [{ kind: 'calendar_id', value: 'CAL-1' }],
  metadata: { startTime: new Date('2026-04-22'), attendeeIds: [john.id] },
}, scope)).entity;

// Facts — same API for all.
await memory.addFact({
  subjectId: john.id,
  predicate: 'committed_to',
  kind: 'atomic',
  objectId: task.id,
  confidence: 0.95,
  importance: 0.8,
  contextIds: [/* deal id */],
  sourceSignalId: 'manual-entry-abc',
}, scope);
```

**Way 2 — LLM extraction (text → facts).** You give the LLM raw text. It returns JSON. The resolver writes it to memory.

```ts
// Caller's responsibility — you make the LLM call:
const prompt = defaultExtractionPrompt({
  signalText: emailBody,
  signalSourceDescription: 'email from sarah',
});
const response = await extractionAgent.runDirect(prompt, {
  responseFormat: { type: 'json_object' },
});
const parsed = JSON.parse(response.output_text);

// Memory's responsibility — one call resolves entities + writes facts:
await extractor.resolveAndIngest(parsed, signalId, scope);
```

The resolver handles entity deduplication/creation (via surface-form resolution), mention-label → entity-id translation, all the `addFact` calls, and `sourceSignalId` attachment.

### Semantic facts are automatic

A fact is "semantic" (eligible for embedding + vector search) if **either**:
- `kind: 'document'`, OR
- `kind: 'atomic'` AND `details.length ≥ 80` (narrative text).

You don't do anything special. Just fill in `details`:

```ts
await memory.addFact({
  subjectId: john.id,
  predicate: 'expressed_concern',
  kind: 'atomic',
  details: 'Pushed back on Oracle renewal during the Q3 review meeting, mentioned budget constraints and timeline pressure from leadership.',
}, scope);
// → isSemantic auto-computed to true → embedding queue picks it up in background
```

Short attribute facts (`value: 'VP Engineering'`, no `details`) aren't embedded. That's intentional — vector search over short attribute strings is noise. Override explicitly with `isSemantic: false` if you want to skip embedding a long fact.

### Who does what

| Task | Caller | Memory |
|---|---|---|
| Decide what to process (email vs noise) | ✓ | — |
| Call the LLM | ✓ | — |
| Construct extraction prompt | Can use `defaultExtractionPrompt` | Provides template |
| Parse LLM JSON | — | `ExtractionResolver` does it |
| Dedupe entities across signals | — | `upsertEntityBySurface` via resolver |
| Write facts with provenance | — | `addFact` under the hood |
| Decide if a fact is "semantic" | Optional override (`isSemantic: false`) | Auto-computed from length + kind |
| Embed semantic facts | — | Background queue |
| Regenerate profiles | — | Auto (threshold-based) |

### TL;DR

For structured data, call `upsertEntity` + `addFact` yourself. For unstructured text, use `defaultExtractionPrompt` + your LLM + `resolveAndIngest`. Both populate the same store identically. Semantic embedding is automatic once the embedder is configured. See [The LLM extraction pipeline](#the-llm-extraction-pipeline) for the full extraction walkthrough, [Writing knowledge](#writing-knowledge) for structured writes.

---

## Choosing a storage backend

### In-memory — for tests and small-scale

```ts
import { InMemoryAdapter } from '@everworker/oneringai/memory';
const store = new InMemoryAdapter();
```

Zero dependencies. Data is lost on process exit. Good for tests, REPL work, and single-user desktop apps that serialize/deserialize on their own.

You can seed it:

```ts
const store = new InMemoryAdapter({
  entities: [/* pre-loaded entities */],
  facts: [/* pre-loaded facts */],
});
```

### Mongo (raw driver) — for servers

```ts
import { MongoClient } from 'mongodb';
import {
  MongoMemoryAdapter,
  RawMongoCollection,
  ensureIndexes,
} from '@everworker/oneringai/memory';
import type { IEntity, IFact } from '@everworker/oneringai/memory';

const client = await new MongoClient(url).connect();
const db = client.db('myapp');

const entitiesColl = new RawMongoCollection<IEntity>(
  db.collection('memory_entities'),
  client,  // optional — enables transaction support
);
const factsColl = new RawMongoCollection<IFact>(db.collection('memory_facts'), client);

await ensureIndexes({ entities: entitiesColl, facts: factsColl });

const store = new MongoMemoryAdapter({
  entities: entitiesColl,
  facts: factsColl,
  factsCollectionName: 'memory_facts',   // required for native $graphLookup
  useNativeGraphLookup: true,            // enables fast graph traversal
  vectorIndexName: 'memory_facts_vector', // optional — Atlas Vector Search
});
```

### Mongo (Meteor) — for Meteor apps

Writes flow through Meteor's async API, triggering reactive publications. Reads use `rawCollection()` for advanced pipelines.

```ts
import { Mongo } from 'meteor/mongo';
import {
  MongoMemoryAdapter,
  MeteorMongoCollection,
  ensureIndexes,
} from '@everworker/oneringai/memory';

const EntitiesCollection = new Mongo.Collection<IEntity>('memory_entities');
const FactsCollection = new Mongo.Collection<IFact>('memory_facts');

// Clients subscribe normally and see live updates as writes happen.
Meteor.publish('memory.entities', function (groupId) {
  return EntitiesCollection.find({ groupId });
});

Meteor.startup(async () => {
  const entitiesColl = new MeteorMongoCollection(EntitiesCollection);
  const factsColl = new MeteorMongoCollection(FactsCollection);
  await ensureIndexes({ entities: entitiesColl, facts: factsColl });

  const store = new MongoMemoryAdapter({
    entities: entitiesColl,
    facts: factsColl,
    factsCollectionName: 'memory_facts',
    useNativeGraphLookup: true,
  });
  // ... pass to MemorySystem
});
```

### Custom backends

Implement `IMemoryStore` with the six required methods (plus optional `traverse` and `semanticSearch`). Scope filtering, optimistic concurrency, and archived hiding are your responsibility. The `InMemoryAdapter` is a ~600-line reference implementation.

---

## Configuring embedders and LLM processors

Three optional LLM-connected components. All configured **once at startup** and used transparently — the memory layer never asks you to pass models or API keys during operations.

| Component | What it does | Without it |
|---|---|---|
| `IEmbedder` | Embeds fact text + entity identity strings | `semanticSearch` throws; resolver semantic tier disabled |
| `IProfileGenerator` | Generates canonical entity profiles | `regenerateProfile` throws; auto-regen silently no-ops |
| `ExtractionResolver` + your LLM | Converts raw signals → resolved facts | You write extraction + ingestion manually |

### Architecture

```
┌──────────────────┐     ┌────────────────────────┐
│  Connector(name) │────▶│  ConnectorEmbedder     │──┐
│  (OpenAI API key)│     │  text-embedding-3-small│  │
└──────────────────┘     └────────────────────────┘  │
                                                     ▼
┌──────────────────┐     ┌────────────────────────┐ ┌──────────────┐
│  Connector(name) │────▶│ ConnectorProfileGen    │─▶│ MemorySystem │◀─── ExtractionResolver
│  (Anthropic key) │     │ claude-sonnet-4-6      │ │              │        (your extraction
└──────────────────┘     └────────────────────────┘ └──────────────┘         agent + prompt)
```

### The recommended path: `createMemorySystemWithConnectors`

This factory handles all three components in one call. Register connectors first, then configure memory.

```ts
import { Connector, Vendor, Agent } from '@everworker/oneringai';
import {
  createMemorySystemWithConnectors,
  ExtractionResolver,
  defaultExtractionPrompt,
} from '@everworker/oneringai/memory';

// 1. Register connectors at app startup.
Connector.create({
  name: 'openai-embed',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});
Connector.create({
  name: 'anthropic-prod',
  vendor: Vendor.Anthropic,
  auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY! },
});

// 2. Build the memory system.
const memory = createMemorySystemWithConnectors({
  store: /* your adapter — see Choosing a storage backend */,

  // Embedder: semantic search + entity identity embedding.
  connectors: {
    embedding: {
      connector: 'openai-embed',               // name from Connector.create
      model: 'text-embedding-3-small',          // embedding model
      dimensions: 1536,                         // matches the model's output
      // requestedDimensions: 768,              // OPTIONAL: MRL dimension reduction
    },

    // Profile generator: LLM that writes canonical entity profiles.
    profile: {
      connector: 'anthropic-prod',
      model: 'claude-sonnet-4-6',
      temperature: 0.3,                         // default; lower = more factual
      maxOutputTokens: 1200,                    // default
      // promptTemplate: myCustomPrompt,        // OPTIONAL: override default
    },
  },

  // Memory-level config.
  profileRegenerationThreshold: 10,              // regen after N new atomic facts
  entityResolution: {
    autoResolveThreshold: 0.9,                   // conservative; see resolution section
    enableIdentityEmbedding: true,               // default; disables identity-embed if false
  },
});

// 3. (Optional) Build the extraction pipeline.
const extractionAgent = Agent.create({
  connector: 'anthropic-prod',
  model: 'claude-sonnet-4-6',
});
const extractor = new ExtractionResolver(memory);
```

Under the hood:
- `ConnectorEmbedder` wraps `createEmbeddingProvider(Connector.get('openai-embed'))`.
- `ConnectorProfileGenerator` creates an internal `Agent.create({ connector: 'anthropic-prod', model: '...' })` and calls `agent.runDirect(prompt, { responseFormat: { type: 'json_object' } })` when regen fires.
- The memory system owns these instances for its lifetime. Destroy with `await memory.shutdown()`.

### Embedder setup in detail

**Supported vendors** (via `createEmbeddingProvider`): OpenAI, Google, Ollama, Groq, Together, Mistral, DeepSeek, Grok — anything OpenAI-compatible.

**Choosing a model:**

| Model | Dimensions | Cost | Use case |
|---|---|---|---|
| `text-embedding-3-small` | 1536 | Cheap | Default — good speed/quality tradeoff |
| `text-embedding-3-large` | 3072 | Higher | Tighter similarity, better for ambiguous text |
| `text-embedding-3-small` + requestedDimensions: 768 | 768 | Cheap | MRL — smaller vectors, same model, faster search |

**What gets embedded:**

- Atomic facts with `details.length ≥ 80` (auto-computed `isSemantic: true`) OR `kind: 'document'` facts → full `details` (or `summaryForEmbedding` if set).
- Entity identity strings (`<type>: <displayName> | aliases: ... | ids: ...`) → stored as `entity.identityEmbedding`.

Writes return immediately; embedding happens in a background queue. Call `await memory.flushEmbeddings()` to wait for pending work (useful in tests or before shutdown).

**Skipping embedding for a specific fact:**

```ts
await memory.addFact(
  { /* ... */, isSemantic: false },   // explicit opt-out
  scope,
);
```

**BYO embedder** (bypass connectors):

```ts
import { MemorySystem, type IEmbedder } from '@everworker/oneringai/memory';

const myEmbedder: IEmbedder = {
  dimensions: 1536,
  embed: async (text) => {
    const res = await fetch('https://my-embedder/api', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return (await res.json()).vector;
  },
  // Optional batch path — used if supplied.
  embedBatch: async (texts) => /* ... */,
};

const memory = new MemorySystem({ store, embedder: myEmbedder });
```

### Profile generator setup in detail

**Supported vendors** (via `Agent.create`): OpenAI, Anthropic, Google, Groq, Together, Mistral, DeepSeek, Grok, Perplexity, Ollama, Grok, Custom.

**Model recommendations:**

- **Anthropic Claude Sonnet/Opus** — best for nuanced narrative profiles. Default pick.
- **OpenAI GPT-5 / GPT-4.1** — fine alternative; slightly different voice.
- **Smaller/cheaper models (Haiku, GPT-5-mini)** — work but profiles feel thinner. OK for high-volume low-stakes entities.

**When regen fires:**

Every `addFact` with `kind: 'atomic'` checks a background threshold. If the count of atomic facts for the subject entity reaches `profileRegenerationThreshold` (default 10, configurable), a background regen fires:
- Scope of regen = scope of the triggering fact (so group-wide facts regen the group-wide profile).
- Debounced per `(entityId, scopeKey)` — concurrent triggers are collapsed.
- Failure is swallowed — a broken generator never blocks fact writes.

**Manual trigger** (force regen now):

```ts
await memory.regenerateProfile(entityId, { groupId: 'acme' }, 'manual');
```

Target-scope options:
- `{}` — global profile visible to all.
- `{ groupId: 'X' }` — group-wide profile for members of X.
- `{ ownerId: 'U' }` — user-private profile.
- `{ groupId: 'X', ownerId: 'U' }` — private within X.

Different callers can see different profiles of the same entity — `getContext` picks the most-specific visible one.

**Custom prompts** — the default prompt is general-purpose (identity + relationships + recent activity). For domain-specific profiles:

```ts
import type { PromptContext } from '@everworker/oneringai/memory';

function salesProfilePrompt(ctx: PromptContext): string {
  return `You are maintaining a living sales profile for a prospect.

Entity: ${ctx.entity.displayName} (${ctx.entity.type})
Target scope: ${ctx.targetScope.groupId ? 'sales team' : 'personal'}

Facts (most recent first):
${ctx.atomicFacts.slice(0, 50).map(f =>
  `- ${f.predicate}: ${f.details ?? f.objectId ?? JSON.stringify(f.value)}`
).join('\n')}

${ctx.priorProfile ? `Previous profile:\n${ctx.priorProfile.details}` : ''}

Write a markdown profile focused on:
1. Current deal status and next steps
2. Known objections / pain points
3. Communication preferences and cadence
4. Recent signals of intent

Return JSON: { "details": "<markdown>", "summaryForEmbedding": "<one paragraph, ~80 words>" }
`;
}

const memory = createMemorySystemWithConnectors({
  store,
  connectors: {
    profile: {
      connector: 'anthropic-prod',
      model: 'claude-sonnet-4-6',
      promptTemplate: salesProfilePrompt,
    },
  },
});
```

**BYO profile generator:**

```ts
import type { IProfileGenerator } from '@everworker/oneringai/memory';

const myGen: IProfileGenerator = {
  async generate(entity, atomicFacts, priorProfile, targetScope) {
    // Call your service, produce markdown.
    const details = await myLLMService({ entity, facts: atomicFacts });
    const summaryForEmbedding = details.split('\n\n')[0].slice(0, 400);
    return { details, summaryForEmbedding };
  },
};

const memory = new MemorySystem({ store, profileGenerator: myGen });
```

### Extraction pipeline setup

The extraction pipeline is **your** LLM call + the memory layer's resolver. You own the prompt + model choice; the resolver handles persistence.

```ts
const extractionAgent = Agent.create({
  connector: 'anthropic-prod',           // same connector OK; different model fine
  model: 'claude-sonnet-4-6',
});

const extractor = new ExtractionResolver(memory);

async function ingestSignal(signal: { id: string; body: string; source: string }) {
  // Build the prompt — default works for general cases.
  const prompt = defaultExtractionPrompt({
    signalText: signal.body,
    signalSourceDescription: signal.source,
    targetScope: { groupId: currentGroup },
    referenceDate: new Date(),
  });

  // Your LLM call.
  const response = await extractionAgent.runDirect(prompt, {
    responseFormat: { type: 'json_object' },
    temperature: 0.2,
  });
  const raw = JSON.parse(response.output_text);

  // Resolver takes over — no more LLM calls.
  return extractor.resolveAndIngest(
    raw,
    signal.id,                           // attached as sourceSignalId to every fact
    { groupId: currentGroup },
  );
}
```

Use a dedicated Connector for extraction if you want separate rate limits / billing from your profile generator. Two Anthropic connectors with the same API key work:

```ts
Connector.create({ name: 'anthropic-extract', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey } });
Connector.create({ name: 'anthropic-profile', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey } });
```

### Configuration reference

All LLM-related config at a glance:

```ts
createMemorySystemWithConnectors({
  store,

  connectors: {
    embedding: {
      connector: string,                     // REQUIRED: registered Connector name
      model: string,                         // REQUIRED: provider-specific model id
      dimensions: number,                    // REQUIRED: vector size
      requestedDimensions?: number,          // MRL truncation target
    },
    profile: {
      connector: string,                     // REQUIRED if profile section set
      model: string,                         // REQUIRED
      promptTemplate?: (ctx) => string,
      temperature?: number,                  // default 0.3
      maxOutputTokens?: number,              // default 1200
    },
  },

  // Profile regen behavior
  profileRegenerationThreshold?: number,     // default 10

  // Embedding queue behavior
  embeddingQueue?: {
    concurrency?: number,                    // default 4
    retries?: number,                        // default 3
  },

  // Entity resolution (semantic tier uses the embedder)
  entityResolution?: {
    autoResolveThreshold?: number,           // default 0.9
    minFuzzyRatio?: number,                  // default 0.85
    enableIdentityEmbedding?: boolean,       // default true
  },

  // General
  topFactsRanking?: RankingConfig,
  onChange?: (event) => void,
});
```

### Minimal setup (no LLMs at all)

Valid for dev, tests, or apps that populate memory manually:

```ts
const memory = new MemorySystem({ store: new InMemoryAdapter() });
// No embedder → no semantic search, no identity embeddings.
// No profileGenerator → no auto profiles (you can still write them manually).
// Everything else works.
```

---

## Modeling your domain

Entity types are free-form strings, but some are well-known — the memory layer's retrieval defaults (`getContext` tiers like `relatedTasks`, `relatedEvents`) look for specific types and metadata conventions.

### People

```ts
await memory.upsertEntity(
  {
    type: 'person',
    displayName: 'John Doe',
    aliases: ['JD', 'Johnny'],
    identifiers: [
      { kind: 'email', value: 'john@acme.com', isPrimary: true },
      { kind: 'slack_id', value: 'U0123ABCD' },
      { kind: 'github', value: 'johndoe' },
    ],
  },
  scope,
);
```

`identifiers` are the lookup keys — the more you have, the better resolution works across signals. `aliases` are display hints only, not lookup keys.

### Organizations

```ts
await memory.upsertEntity(
  {
    type: 'organization',
    displayName: 'Acme Corp',
    aliases: ['Acme', 'Acme Corporation'],
    identifiers: [
      { kind: 'domain', value: 'acme.com' },
      { kind: 'legal_name', value: 'Acme Corporation Inc.' },
    ],
  },
  scope,
);
```

### Tasks

Tasks are entities. Lifecycle state lives in `metadata` for fast queries, and state transitions are **also** recorded as facts for full history.

```ts
// Create a task
const { entity: task } = await memory.upsertEntity(
  {
    type: 'task',
    displayName: 'Send Q3 budget proposal',
    identifiers: [{ kind: 'linear_id', value: 'TEAM-456' }],  // external id if synced
    metadata: {
      state: 'pending',
      dueAt: new Date('2026-04-30'),
      priority: 'high',
      assigneeId: john.id,
      reporterId: sarah.id,
      projectId: acmeDeal.id,
    },
  },
  scope,
);

// Record the commitment as a fact
await memory.addFact(
  {
    subjectId: john.id,
    predicate: 'committed_to',
    kind: 'atomic',
    objectId: task.id,
    confidence: 0.95,
    importance: 0.8,
    contextIds: [acmeDeal.id],
  },
  scope,
);
```

Later, when John completes it:

```ts
// Record the state change as a fact (for history)
await memory.addFact(
  {
    subjectId: task.id,
    predicate: 'state_changed',
    kind: 'atomic',
    value: { from: 'in_progress', to: 'done' },
    details: 'Completed ahead of schedule',
    sourceSignalId: 'signal_xyz',
  },
  scope,
);

// Update current state on the entity (for fast query)
await memory.updateEntityMetadata(task.id, { state: 'done', completedAt: new Date() }, scope);
```

**Do not** archive completed tasks — filter them by state in queries instead:

```ts
// My open tasks
const { items } = await store.listEntities(
  {
    type: 'task',
    metadataFilter: {
      assigneeId: currentUser,
      state: { $in: ['pending', 'in_progress', 'blocked'] },
    },
  },
  { limit: 50 },
  scope,
);

// Tasks I completed this month
const monthStart = new Date('2026-04-01');
const { items: done } = await store.listEntities(
  { type: 'task', metadataFilter: { assigneeId: currentUser, state: 'done' } },
  { limit: 50 },
  scope,
);
const recent = done.filter(t => (t.metadata?.completedAt as Date) >= monthStart);
```

### Events

Events (meetings, calls, incidents) are also entities.

```ts
const { entity: meeting } = await memory.upsertEntity(
  {
    type: 'event',
    displayName: 'Q3 Planning Review',
    identifiers: [{ kind: 'calendar_id', value: 'CAL-2026-03-14-001' }],
    metadata: {
      kind: 'meeting',
      startTime: new Date('2026-03-14T14:00Z'),
      endTime: new Date('2026-03-14T15:00Z'),
      location: 'Conference Room B',
      attendeeIds: [john.id, sarah.id, alice.id],
      hostId: sarah.id,
    },
  },
  scope,
);

// Things that happened at the meeting become facts with the meeting as context OR subject.
await memory.addFact(
  {
    subjectId: john.id,
    predicate: 'opposed',
    kind: 'atomic',
    value: 'ERP budget proposal',
    details: 'Expressed frustration with Oracle renewal timeline',
    contextIds: [meeting.id],   // binds this observation to the meeting
    confidence: 0.85,
    importance: 0.6,
    sourceSignalId: 'signal_transcript_abc',
  },
  scope,
);
```

Later, `getContext(meeting.id)` returns all observations bound to it — John's objection, any decisions made, attendance facts, etc.

### Projects, topics, clusters

```ts
// Project
await memory.upsertEntity(
  {
    type: 'project',
    displayName: 'Acme Q3 Deal',
    identifiers: [],  // may be internal-only; empty identifiers allowed for projects
    metadata: { status: 'active', stakeholderIds: [john.id, sarah.id] },
  },
  scope,
);

// Topic
await memory.upsertEntity(
  {
    type: 'topic',
    displayName: 'ERP renewal',
    identifiers: [],
  },
  scope,
);
```

---

## Writing knowledge

### Atomic vs document facts

**Atomic** facts are short triples:

```ts
// Relational
{ subjectId: john.id, predicate: 'works_at', kind: 'atomic', objectId: acme.id }

// Attribute
{ subjectId: john.id, predicate: 'current_title', kind: 'atomic', value: 'VP Engineering' }

// Narrative observation (still atomic — `details` is the narrative payload)
{
  subjectId: john.id,
  predicate: 'expressed_concern',
  kind: 'atomic',
  details: 'Pushed back on Oracle renewal timeline during Q3 review',
  confidence: 0.8,
  importance: 0.6,
}
```

**Document** facts are long-form:

```ts
{
  subjectId: john.id,
  predicate: 'profile',              // canonical profile, always returned by getContext
  kind: 'document',
  details: '# John Doe\n\nSenior engineer at Acme...',
  summaryForEmbedding: 'John Doe: VP Engineering at Acme, Oracle-skeptic',
}
```

Other document kinds: `predicate: 'meeting_notes'`, `'research_memo'`, `'biography'`. These are retrieved via `getContext(entity, { include: ['documents'] })`.

### Confidence vs importance

- **`confidence`** (0..1) = how sure we are this is TRUE. High for identifier-derived facts, lower for inferred ones.
- **`importance`** (0..1) = how much this matters LONG-TERM. Default 0.5.

Examples:

| Fact | confidence | importance |
|---|---|---|
| "John is CEO" (LinkedIn says so) | 0.95 | 1.0 |
| "John wore blue shirt today" | 1.0 | 0.1 |
| "John seemed frustrated" (inferred from email tone) | 0.4 | 0.5 |
| "John committed to deliver by Friday" | 0.9 | 0.8 |

Ranking formula: `confidence × recency × predicateWeight × importance_multiplier`. High-importance facts decay slower in effective ranking.

### Context binding with `contextIds`

Use `contextIds` to link a fact to entities that aren't subject or object. The classic case: an action taken in the context of a deal/project.

```ts
// John assigned a task (creating a new task entity) in the context of the Acme deal.
await memory.addFact(
  {
    subjectId: john.id,
    predicate: 'assigned_task',
    kind: 'atomic',
    objectId: task.id,                   // the task entity
    contextIds: [acmeDeal.id, sarah.id], // the deal; also Sarah since she'll review
    sourceSignalId: 'signal_email_123',
  },
  scope,
);
```

Now `getContext(acmeDeal.id)` returns this fact because the deal is in `contextIds`. Same for `getContext(sarah.id)`. Without `contextIds`, only `getContext(john.id)` and `getContext(task.id)` would surface it.

### Supersession

When a fact changes (e.g., title changes, state transitions), don't edit — supersede:

```ts
// Today: John's title was "Engineer"
const oldTitleFact = await memory.addFact(
  { subjectId: john.id, predicate: 'current_title', kind: 'atomic', value: 'Engineer' },
  scope,
);

// Tomorrow: promoted to VP
const newTitleFact = await memory.addFact(
  {
    subjectId: john.id,
    predicate: 'current_title',
    kind: 'atomic',
    value: 'VP Engineering',
    supersedes: oldTitleFact.id,   // archives the old fact atomically
  },
  scope,
);
```

History is preserved — the old fact is still retrievable with `findFacts({..., archived: true})` and via the `supersedes` chain.

---

## Reading knowledge

### The one retrieval API you need: `getContext`

```ts
const view = await memory.getContext(entityId, {}, scope);
```

Returns:
- `view.entity` — the entity itself
- `view.profile` — canonical profile (most-specific visible), or null
- `view.topFacts` — ranked atomic facts where entity is subject OR object OR in contextIds
- `view.relatedTasks` — active tasks linked to the entity (by default)
- `view.relatedEvents` — recent events linked to the entity (by default)

That's usually enough. For specific needs, enable optional tiers:

```ts
const view = await memory.getContext(
  entityId,
  {
    include: ['documents', 'semantic', 'neighbors'],
    documentPredicates: ['meeting_notes', 'research_memo'],
    semanticQuery: 'thoughts on Oracle licensing',
    semanticTopK: 5,
    neighborPredicates: ['works_at', 'reports_to'],
    neighborDepth: 2,
    asOf: new Date('2026-03-01'),
  },
  scope,
);
```

### Performance mode: `tiers: 'minimal'`

```ts
// Skips relatedTasks + relatedEvents — cheapest retrieval.
const view = await memory.getContext(entityId, { tiers: 'minimal' }, scope);
```

### Direct queries

```ts
// All facts where John committed to something
const page = await store.findFacts(
  { subjectId: john.id, predicate: 'committed_to' },
  { limit: 50 },
  scope,
);

// Everything happening around a deal (any relation)
const dealActivity = await store.findFacts(
  { touchesEntity: acmeDeal.id },  // subject OR object OR in contextIds
  { limit: 100, orderBy: { field: 'observedAt', direction: 'desc' } },
  scope,
);

// Recent facts across the system
const recent = await store.findFacts(
  { observedAfter: new Date('2026-04-01') },
  { limit: 100 },
  scope,
);

// What did we know on March 1?
const historical = await store.findFacts(
  { subjectId: john.id, asOf: new Date('2026-03-01') },
  {},
  scope,
);
```

### Semantic search

Finds facts matching an intent. Requires an embedder.

```ts
const hits = await memory.semanticSearch(
  'discussion of Oracle pricing',
  { subjectId: john.id },      // scope to John's facts (optional)
  scope,
  5,                            // topK
);
// hits: [{ fact, score }, ...]
```

### Graph traversal

```ts
const neighborhood = await memory.traverse(
  acme.id,
  {
    direction: 'both',          // out: edges where Acme is subject; in: where object
    maxDepth: 2,
    predicates: ['works_at', 'reports_to', 'manages'],
    limit: 100,
  },
  scope,
);
// neighborhood.nodes + neighborhood.edges
```

### Entity search

```ts
// By substring
const results = await memory.searchEntities('john', { types: ['person'] }, scope);

// By identifier (exact)
const johnsByEmail = await store.findEntitiesByIdentifier('email', 'john@acme.com', scope);

// All active projects
const projects = await store.listEntities(
  { type: 'project', metadataFilter: { status: 'active' } },
  { limit: 50 },
  scope,
);
```

---

## Controlling the predicate vocabulary

Facts have predicates — strings like `works_at`, `assigned_task`, `has_status`. Left unconstrained, an LLM will drift: `worksAt`, `works-at`, `employed_by`, `works_for` all describe the same relationship but won't aggregate, rank, or query as one. The **predicate registry** is the fix.

### Three use patterns

```ts
import { PredicateRegistry, MemorySystem } from '@everworker/oneringai';

// Pattern 1: ship with the 51-predicate starter set.
const memory = new MemorySystem({
  store,
  predicates: PredicateRegistry.standard(),
});

// Pattern 2: extend the starter set with your domain.
const registry = PredicateRegistry.standard();
registry.register({
  name: 'invested_in',
  description: 'Investor relationship.',
  category: 'task',
  rankingWeight: 1.3,
  defaultImportance: 0.9,
});

// Pattern 3: build a fully custom vocabulary and run in strict mode.
const clinical = PredicateRegistry.empty().registerAll([
  { name: 'patient_of', description: '...', category: 'clinical' },
  { name: 'prescribed', description: '...', category: 'clinical' },
]);
const memory2 = new MemorySystem({
  store,
  predicates: clinical,
  predicateMode: 'strict',  // reject anything outside the vocabulary
});
```

### What the registry does

When attached to `MemorySystem`, every `addFact` call:

1. **Canonicalizes.** `worksAt` → `works_at`. `employed_by` → `works_at` (alias). `works-at` → `works_at`.
2. **Applies defaults.** Registry `defaultImportance` fills in for callers that omit importance. Registry `isAggregate` applies to predicates like `interaction_count`.
3. **Auto-supersedes `singleValued`.** Writing `current_title` twice for the same subject auto-archives the first — only the latest is the "current" value. Disable globally with `predicateAutoSupersede: false` if you want append-only semantics.
4. **Feeds ranking.** Registry `rankingWeight` values merge into `RankingConfig.predicateWeights`. User-supplied weights always win on collision.

### Feeding the vocabulary to the LLM

Pass the registry into the extraction prompt so the model learns the house style:

```ts
import { defaultExtractionPrompt } from '@everworker/oneringai';

const prompt = defaultExtractionPrompt({
  signalText: emailBody,
  predicateRegistry: registry,
  maxPredicatesPerCategory: 5,  // cap by category for prompt token budget
});
// Send to LLM …
```

The LLM sees a "Predicate vocabulary" block and will prefer the canonical names. It can still invent new ones — those come out as `IngestionResult.newPredicates` for drift review.

### Drift monitoring

```ts
const result = await resolver.resolveAndIngest(llmOutput, signalId, scope);
if (result.newPredicates.length > 0) {
  // LLM invented these. Periodically review:
  //   - Promote frequent newcomers into the registry.
  //   - Tighten the prompt if they're duplicates of canonical names.
  console.log('Unknown predicates seen:', result.newPredicates);
}
```

In `strict` mode, unknown predicates are rejected at `addFact`; they surface in both `IngestionResult.unresolved` and `IngestionResult.newPredicates`.

### Scope caveat for auto-supersede

Auto-supersede only archives facts visible to the caller. A group-scoped `current_title` fact won't be touched by a user-scoped write (and vice versa). This is intentional — scope isolation is never broken — but it means the same `singleValued` predicate can have multiple "current" values across scopes. Usually fine; just know it's happening.

---

## The LLM extraction pipeline

How you get knowledge INTO memory from raw signals (emails, transcripts, docs).

### Why two phases?

LLMs are great at reading text and identifying who/what/when. They're bad at remembering your entity IDs. So extraction has two phases:

1. **LLM phase:** emit structured JSON with local mention labels + facts referencing those labels. LLM never sees real entity IDs.
2. **Resolver phase:** deterministic code translates mention labels to entity IDs (resolving or creating entities via `upsertEntityBySurface`), then writes facts with `sourceSignalId` attached.

### End-to-end example

```ts
import {
  createMemorySystemWithConnectors,
  ExtractionResolver,
  defaultExtractionPrompt,
} from '@everworker/oneringai/memory';
import { Connector, Vendor, Agent } from '@everworker/oneringai';

// Setup — once at startup.
Connector.create({
  name: 'openai-main',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});
Connector.create({
  name: 'anthropic-prod',
  vendor: Vendor.Anthropic,
  auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY! },
});

const memory = createMemorySystemWithConnectors({
  store: /* your MongoMemoryAdapter */,
  connectors: {
    embedding: {
      connector: 'openai-main',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    profile: {
      connector: 'anthropic-prod',
      model: 'claude-sonnet-4-6',
    },
  },
  profileRegenerationThreshold: 10,
});

const extractor = new ExtractionResolver(memory);

// Extraction agent — lightweight, no tools, structured JSON output.
const extractionAgent = Agent.create({
  connector: 'anthropic-prod',
  model: 'claude-sonnet-4-6',
});

// Per-signal processing:
async function ingestSignal(signal: { id: string; body: string; source: string }) {
  const prompt = defaultExtractionPrompt({
    signalText: signal.body,
    signalSourceDescription: signal.source,
    targetScope: { groupId: currentGroup },
    referenceDate: new Date(),
  });

  const response = await extractionAgent.runDirect(prompt, {
    responseFormat: { type: 'json_object' },
    temperature: 0.2,
  });

  const rawExtraction = JSON.parse(response.output_text);

  const result = await extractor.resolveAndIngest(
    rawExtraction,
    signal.id,                    // becomes sourceSignalId on every fact
    { groupId: currentGroup },
  );

  // Handle any merge candidates — log for human review.
  if (result.mergeCandidates.length > 0) {
    for (const mc of result.mergeCandidates) {
      console.warn(
        `Potential duplicate for "${mc.surface}":`,
        mc.candidates.map((c) => `${c.entity.displayName} (${c.matchedOn}, conf=${c.confidence})`),
      );
    }
  }

  if (result.unresolved.length > 0) {
    console.warn('Failed items:', result.unresolved);
  }

  return result;
}
```

### What the LLM actually emits

Given an input email:

> From: Sarah <sarah@acme.com>
> To: John <john@acme.com>
> Subject: Q3 budget review
>
> Hi John — can you prep the PowerPoint for the Acme deal review on Friday? Due by end of Thursday. Also, MSFT pricing from Microsoft Inc. — need that too.

Well-prompted, the LLM produces:

```json
{
  "mentions": {
    "m1": {
      "surface": "Sarah",
      "type": "person",
      "identifiers": [{ "kind": "email", "value": "sarah@acme.com" }]
    },
    "m2": {
      "surface": "John",
      "type": "person",
      "identifiers": [{ "kind": "email", "value": "john@acme.com" }]
    },
    "m3": { "surface": "prep the PowerPoint for the Acme deal review", "type": "task" },
    "m4": {
      "surface": "Acme",
      "type": "organization",
      "identifiers": [{ "kind": "domain", "value": "acme.com" }]
    },
    "m5": { "surface": "Acme deal", "type": "project" },
    "m6": {
      "surface": "Microsoft",
      "type": "organization",
      "identifiers": [{ "kind": "domain", "value": "microsoft.com" }],
      "aliases": ["MSFT", "Microsoft Inc."]
    }
  },
  "facts": [
    {
      "subject": "m1", "predicate": "requested_task_of",
      "object": "m2", "confidence": 0.95, "importance": 0.7,
      "contextIds": ["m5"]
    },
    {
      "subject": "m2", "predicate": "assigned_task",
      "object": "m3", "confidence": 0.95,
      "contextIds": ["m5"]
    },
    {
      "subject": "m3", "predicate": "due_date",
      "value": "2026-04-23T23:59:59", "confidence": 0.95, "importance": 0.8
    },
    {
      "subject": "m5", "predicate": "related_to",
      "object": "m4"
    },
    {
      "subject": "m2", "predicate": "needs",
      "value": "MSFT pricing from Microsoft",
      "confidence": 0.8, "contextIds": ["m5", "m6"]
    }
  ]
}
```

`ExtractionResolver.resolveAndIngest`:
- Upserts 6 entities. Identifier matches hit John/Sarah/Acme/Microsoft if they exist. `m3` (task) and `m5` (project) have no identifiers — resolve via displayName/alias, or create new.
- Writes 5 facts, translating `m1..m6` to real entity IDs. Every fact gets `sourceSignalId: signal.id`.

### Tasks-as-entities in the extraction

Notice `m3` is a task entity. The LLM doesn't invent a state/due-date schema — it emits:
- A task entity with just surface + type.
- A fact `(task, due_date, "2026-04-23")` as an attribute fact.

You (the caller) can post-process that fact if needed:

```ts
// After ingestion, pull task attribute facts and materialize them into entity metadata.
for (const e of result.entities) {
  if (e.entity.type !== 'task') continue;
  const taskFacts = await store.findFacts(
    { subjectId: e.entity.id, predicate: 'due_date' },
    { limit: 1, orderBy: { field: 'createdAt', direction: 'desc' } },
    scope,
  );
  if (taskFacts.items[0]?.value) {
    await memory.updateEntityMetadata(
      e.entity.id,
      { dueAt: new Date(taskFacts.items[0].value as string), state: 'pending' },
      scope,
    );
  }
}
```

Or wire a rule engine (future) to do this automatically.

---

## Entity resolution in practice

### The threshold decision

`autoResolveThreshold` controls how aggressive resolution is:

| Threshold | Behavior | Trade-off |
|---|---|---|
| 1.0 | Identifier-only auto-resolve | Zero false merges, many duplicates |
| 0.9 (**default**) | Identifier + exact name | Rare false merges, some duplicates |
| 0.85 | + exact alias | |
| 0.6 | + fuzzy ("Microsft" → Microsoft) | More merges, occasional wrong ones |
| 0.5 | + semantic (identity embedding) | Most aggressive |

**When to lower:** your domain has clear name conventions (corporate environments where "Microsoft" always means the tech giant, not a startup). Run occasional cleanup to fix any wrong merges.

**When to raise:** your domain has ambiguous short names ("Alex" could be several people). Keep 0.9 or above, let merge candidates accumulate, review in batches.

Configure at construction:

```ts
const memory = new MemorySystem({
  store,
  entityResolution: { autoResolveThreshold: 0.75 },
});
```

Or per-call:

```ts
await memory.upsertEntityBySurface(input, scope, { autoResolveThreshold: 0.6 });
```

### Alias accumulation

Every time a surface resolves to an existing entity, that surface becomes an alias (if new). Over time entities build up rich alias lists.

```ts
// Day 1: extraction sees "Microsoft" with domain match
// → creates entity, aliases: []

// Day 2: extraction sees "MSFT" with domain match
// → resolves, adds "MSFT" to aliases

// Day 3: extraction sees "Microsoft Corporation" with domain match
// → resolves, adds "Microsoft Corporation" to aliases

// Day 30: extraction sees "MSFT" (no identifier this time — maybe an informal note)
// → exact alias match at confidence 0.85 (no identifier lookup needed)
```

This makes the system smarter with use — resolution gets cheaper and more accurate over time.

### Handling merge candidates

`mergeCandidates` is advisory — the system never auto-merges (that's a data-loss risk). Typical workflow:

```ts
// Log candidates for review
for (const mc of result.mergeCandidates) {
  await adminReviewQueue.add({
    signalId: signal.id,
    surface: mc.surface,
    candidates: mc.candidates.map((c) => ({
      entityId: c.entity.id,
      displayName: c.entity.displayName,
      confidence: c.confidence,
      matchedOn: c.matchedOn,
    })),
  });
}
```

When a human confirms a merge:

```ts
await memory.mergeEntities(winnerId, loserId, scope);
```

This rewrites all facts pointing at `loserId` to point at `winnerId`, merges identifiers/aliases, and archives the loser.

### Manual resolution

If you need more control than `upsertEntityBySurface`:

```ts
const candidates = await memory.resolveEntity(
  { surface: 'Microsoft', type: 'organization' },
  scope,
  { limit: 10, threshold: 0.5 },
);

// Pick one based on your own logic (e.g., recency, custom heuristic)
const chosen = candidates.find((c) => c.entity.metadata?.verified === true);
```

---

## Profile generation

Profiles are the "what do we know about X" canonical narrative — auto-generated from atomic facts, persisted as document facts with `predicate: 'profile'`, regenerated as new information accumulates.

### Setup

Pass a `profileGenerator` at construction:

```ts
const memory = createMemorySystemWithConnectors({
  store,
  connectors: {
    profile: {
      connector: 'anthropic-prod',
      model: 'claude-sonnet-4-6',
      temperature: 0.3,         // lower = tighter, more factual
      maxOutputTokens: 1200,
    },
  },
  profileRegenerationThreshold: 10,  // fires after 10 new atomic facts
});
```

### When it runs

Every `addFact` (atomic kind only) schedules a background threshold check. If the number of atomic facts for the subject in the target scope reaches the threshold, `regenerateProfile` fires asynchronously.

A debounce guard (per `entityId + scopeKey`) prevents concurrent regenerations.

### Manual trigger

```ts
await memory.regenerateProfile(entityId, { groupId: 'acme' }, 'manual');
```

The `targetScope` parameter controls which profile variant is generated:
- `{}` — global profile (visible to all)
- `{ groupId: 'X' }` — group-wide profile (for users in group X)
- `{ ownerId: 'U' }` — user-private profile (only U sees it)
- `{ groupId: 'X', ownerId: 'U' }` — private to U within group X

You can have multiple profiles for the same entity at different scopes. `getContext` picks the most-specific visible one.

### Custom prompts

Override the default:

```ts
import type { PromptContext } from '@everworker/oneringai/memory';

const memory = createMemorySystemWithConnectors({
  store,
  connectors: {
    profile: {
      connector: 'anthropic-prod',
      model: 'claude-sonnet-4-6',
      promptTemplate: (ctx: PromptContext) => `
Write a concise sales-context profile for ${ctx.entity.displayName}.
Focus on: current deal activity, last meeting, known pain points.
Facts (most recent first):
${ctx.atomicFacts.slice(0, 50).map((f) => `- ${f.predicate}: ${f.details ?? f.value}`).join('\n')}

Output JSON: { "details": "<markdown>", "summaryForEmbedding": "<~80 word gist>" }
`,
    },
  },
});
```

---

## Scope and multi-tenancy

### The four scope shapes

- **Global** (no `groupId`, no `ownerId`) — visible to every caller.
- **Group-wide** (`groupId` set) — visible to users in that group.
- **User-private cross-group** (only `ownerId` set) — private notes visible to one user anywhere.
- **User-private within group** (both set) — private to one user in one group.

### When to use which

- **People, organizations with domains** → usually global. Everyone benefits from shared identity data.
- **Projects, internal topics** → group-wide. Scoped to the team/company.
- **Private notes, personal observations** → user-private within group. "My impression of this person."
- **Personal contacts, therapist, HR case** → user-private cross-group. Cross-tenant privacy.

### Worked example: private impression of a shared contact

```ts
// Global entity — shared identity
const { entity: john } = await memory.upsertEntity(
  { type: 'person', displayName: 'John Doe', identifiers: [/* ... */] },
  {},
);

// Group-wide work facts about John — all team members see them
await memory.addFact(
  { subjectId: john.id, predicate: 'works_at', kind: 'atomic', objectId: acme.id, groupId: 'myteam' },
  { groupId: 'myteam' },
);

// Alice's private note — only Alice sees this
await memory.addFact(
  {
    subjectId: john.id,
    predicate: 'observation',
    kind: 'atomic',
    details: 'Seemed annoyed in today\'s meeting',
    groupId: 'myteam',
    ownerId: 'alice',
  },
  { groupId: 'myteam', userId: 'alice' },
);

// Bob (different user, same team) queries John
const viewForBob = await memory.getContext(john.id, {}, { groupId: 'myteam', userId: 'bob' });
// → Bob sees the global entity + the group-wide works_at fact.
// → Does NOT see Alice's private observation.

// Alice queries John
const viewForAlice = await memory.getContext(john.id, {}, { groupId: 'myteam', userId: 'alice' });
// → Alice sees everything Bob sees + her own private observation.
```

### Scope invariant

A fact cannot be broader than its subject entity:

- Global entity → any fact scope is fine (fact can narrow).
- Group-scoped entity → fact must have matching `groupId` (can narrow further by adding `ownerId`).
- User-scoped entity → fact must have matching `ownerId` (and `groupId` if entity has one).

Violations throw `ScopeInvariantError`.

### Profile precedence

`getContext(entityId, {}, { groupId: 'g1', userId: 'u1' })` returns the profile as follows:
1. User-private profile (ownerId=u1) — if exists, wins.
2. Group profile (groupId=g1, no ownerId) — if exists and no user profile.
3. Global profile (no groupId, no ownerId) — fallback.

This lets you have layered profiles: everyone sees the global "John is CEO of Acme"; team members see the group-wide "Works on our account, typically responsive"; Alice sees her user-private "Prefers morning calls, avoid Mondays."

---

## Common patterns

### My open tasks

```ts
const { items } = await store.listEntities(
  {
    type: 'task',
    metadataFilter: {
      assigneeId: currentUserId,
      state: { $in: ['pending', 'in_progress', 'blocked'] },
    },
  },
  { limit: 50 },
  scope,
);
```

### Tasks due this week

```ts
const now = new Date();
const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
const { items } = await store.listEntities(
  { type: 'task', metadataFilter: { assigneeId: currentUserId, state: 'pending' } },
  { limit: 200 },
  scope,
);
const dueSoon = items.filter(t => {
  const due = t.metadata?.dueAt as Date | undefined;
  return due && due >= now && due <= weekEnd;
});
```

### Everything about this deal

```ts
const view = await memory.getContext(dealId, {}, scope);
// view.profile — AI-generated deal summary
// view.topFacts — key actions, decisions, observations (via touchesEntity)
// view.relatedTasks — active tasks for this deal
// view.relatedEvents — recent meetings about this deal
```

### What did we know on date X (bitemporal query)

```ts
const viewAsOf = await memory.getContext(entityId, { asOf: new Date('2026-01-15') }, scope);
// Returns entity + profile + topFacts that existed on that date.
```

### Who changed what (provenance)

```ts
const fact = /* some fact */;
if (fact.sourceSignalId) {
  const signal = await mySignalStore.get(fact.sourceSignalId);
  console.log('Came from:', signal.source, 'at', signal.timestamp);
}

// Full history of a fact across supersessions
async function factHistory(latestId: FactId, scope: ScopeFilter) {
  const chain: IFact[] = [];
  let current = await store.getFact(latestId, scope);
  while (current?.supersedes) {
    chain.push(current);
    current = await store.getFact(current.supersedes, scope);
  }
  if (current) chain.push(current);
  return chain;  // newest → oldest
}
```

### Merging duplicate entities

```ts
// Admin tool: find probable duplicates in a group
const orgs = await store.listEntities({ type: 'organization' }, { limit: 500 }, scope);
for (const org of orgs.items) {
  const candidates = await memory.resolveEntity(
    {
      surface: org.displayName,
      type: 'organization',
    },
    scope,
    { threshold: 0.7 },
  );
  const others = candidates.filter((c) => c.entity.id !== org.id);
  if (others.length > 0) {
    console.log(`${org.displayName} may duplicate:`, others.map((c) => c.entity.displayName));
  }
}

// Human confirms: merge
await memory.mergeEntities(keepId, dropId, scope);
```

### Event capture

```ts
// Set up an event entity when a meeting happens
const { entity: meeting } = await memory.upsertEntity(
  {
    type: 'event',
    displayName: 'Weekly team sync — April 22',
    identifiers: [{ kind: 'calendar_id', value: 'CAL-123' }],
    metadata: {
      kind: 'meeting',
      startTime: new Date('2026-04-22T10:00Z'),
      endTime: new Date('2026-04-22T11:00Z'),
      attendeeIds: [alice.id, bob.id, carol.id],
      hostId: alice.id,
    },
  },
  scope,
);

// Capture decisions and observations as facts with the meeting as context
await memory.addFacts(
  [
    {
      subjectId: bob.id,
      predicate: 'proposed',
      kind: 'atomic',
      value: 'switch from Oracle to Postgres',
      contextIds: [meeting.id],
      importance: 0.8,
    },
    {
      subjectId: alice.id,
      predicate: 'approved',
      kind: 'atomic',
      value: 'Postgres migration',
      contextIds: [meeting.id],
      importance: 1.0,
    },
  ],
  scope,
);

// Later: "what happened at that meeting?"
const meetingContext = await memory.getContext(meeting.id, {}, scope);
// → profile + topFacts (proposed + approved + attendance) + relatedTasks (follow-ups)
```

### Reactive UI (Meteor)

```ts
// Server: publish entities
Meteor.publish('memory.tasks', function (groupId) {
  if (!this.userId) return this.ready();
  return EntitiesCollection.find({
    type: 'task',
    groupId,
    'metadata.assigneeId': this.userId,
    'metadata.state': { $in: ['pending', 'in_progress'] },
  });
});

// Client: reactive subscription — writes via MeteorMongoCollection auto-update UI
Meteor.subscribe('memory.tasks', currentGroupId);
const tasks = EntitiesCollection.find().fetch();
```

---

## Scaling

### Indexes

Always call `ensureIndexes` on startup for Mongo:

```ts
await ensureIndexes({ entities: entitiesColl, facts: factsColl });
```

This creates 9 indexes covering all hot paths: identifier lookup, fact-by-subject, fact-by-object, fact-by-context, recent-by-predicate, task metadata filtering, event metadata filtering.

### Atlas Vector Search (Mongo)

For production-scale semantic search, create an Atlas Vector Search index on the facts collection:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "groupId" },
    { "type": "filter", "path": "ownerId" },
    { "type": "filter", "path": "subjectId" },
    { "type": "filter", "path": "archived" }
  ]
}
```

Then:

```ts
const store = new MongoMemoryAdapter({
  entities, facts,
  vectorIndexName: 'memory_facts_vector',
});
```

Without this, `semanticSearch` falls back to a cursor scan + in-memory cosine — correct but O(N).

### Native `$graphLookup`

```ts
const store = new MongoMemoryAdapter({
  entities, facts,
  useNativeGraphLookup: true,
  factsCollectionName: 'memory_facts',
});
```

Replaces the BFS-over-`findFacts` fallback with a single-aggregation graph query. Use this for production — dramatic speedup for depth ≥ 2 traversals.

### Embedding cost control

```ts
const memory = new MemorySystem({
  store,
  embedder,
  embeddingQueue: {
    concurrency: 2,   // default 4; lower = smoother API consumption
    retries: 3,       // retries on embedder failure
  },
});

// For batch imports, manually flush + check cost:
await memory.addFacts(manyFacts, scope);
await memory.flushEmbeddings();
console.log('embedder calls:', embedCallCount);
```

### When NOT to embed

Every fact with `isSemantic === true` is embedded. The auto-computation rule: `kind === 'document'` OR (`kind === 'atomic'` AND `details.length ≥ 80`). Short attribute facts (no `details`) aren't embedded.

To skip embedding a specific fact explicitly:

```ts
await memory.addFact(
  {
    ...,
    isSemantic: false,  // don't embed
  },
  scope,
);
```

### Profile regeneration cadence

```ts
const memory = createMemorySystemWithConnectors({
  ...,
  profileRegenerationThreshold: 20,  // default 10; higher = less frequent regen
});
```

Tune based on LLM cost vs. freshness. For high-churn entities (active deals), keep low. For stable entities (long-standing contacts), 50+ is fine.

---

## Troubleshooting

### "Entity X not found" when I just created it

Scope mismatch. The entity exists but isn't visible to your caller's scope.

```ts
// Wrong: created in group A, queried in group B
await memory.upsertEntity({ ..., groupId: 'a' }, { groupId: 'a' });
const missing = await memory.getEntity(id, { groupId: 'b' });  // null!
```

### "object entity Y not visible or not found" on addFact

The fact references an `objectId` (or `contextIds`) entity that's outside the caller's scope. This is intentional — prevents leaking entity existence across scopes.

Fix: use matching scope, or ensure the object entity is created at a broader scope (e.g., global).

### Optimistic concurrency error

Two writers tried to update the same entity concurrently. Standard retry pattern:

```ts
async function withRetry<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.name?.includes('OptimisticConcurrency') && i < max - 1) continue;
      throw err;
    }
  }
  throw new Error('unreachable');
}

await withRetry(() => memory.updateEntityMetadata(id, { state: 'done' }, scope));
```

### Too many duplicates from extraction

Your threshold is too conservative (default 0.9 only auto-resolves on identifiers + exact names). Lower to 0.7 or 0.6 for fuzzier matching, BUT enable human review of `mergeCandidates` — fuzzy matches can be wrong.

### Profile never regenerates

Check:
1. Is a `profileGenerator` configured?
2. Does the entity have ≥ `profileRegenerationThreshold` atomic facts?
3. Are the atomic facts visible at the target scope?
4. Auto-regen runs in background — check logs for errors from the LLM call.

Force it:

```ts
await memory.regenerateProfile(entityId, targetScope, 'manual');
```

### Semantic search returns nothing

1. Is an embedder configured?
2. Does the store implement `semanticSearch`? (InMemory and Mongo both do.)
3. Are any facts actually embedded? Check with:
   ```ts
   const n = await store.countFacts(/* any filter */, scope);
   const page = await store.findFacts(/* any */, { limit: 50 }, scope);
   const embedded = page.items.filter((f) => f.embedding).length;
   console.log(`${embedded}/${page.items.length} facts embedded`);
   ```
4. `await memory.flushEmbeddings()` if you just wrote and queried immediately.

### Tests with an embedder are flaky

Use `flushEmbeddings()` to make embedding deterministic in tests:

```ts
await memory.addFact(..., scope);
await memory.flushEmbeddings();
// now semantic search will find it
const results = await memory.semanticSearch('query', {}, scope);
```

### Type error on a well-known metadata field

The memory layer doesn't enforce metadata shapes — they're conventions documented in `types.ts`. If you want runtime guarantees, wrap `upsertEntity` in your own typed helpers:

```ts
interface TaskMetadata {
  state: 'pending' | 'in_progress' | 'done' | 'cancelled' | 'blocked' | 'deferred';
  dueAt?: Date;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  assigneeId?: string;
  reporterId?: string;
  projectId?: string;
  completedAt?: Date;
}

async function upsertTask(mem: MemorySystem, input: { displayName: string; metadata: TaskMetadata; identifiers?: Identifier[] }, scope: ScopeFilter) {
  return mem.upsertEntity(
    { type: 'task', ...input, identifiers: input.identifiers ?? [] },
    scope,
  );
}
```

---

## What's next

The memory layer is solid. Future work happens elsewhere:

- **Agent tools + plugin** — expose memory to oneringai agents via `entity_upsert`, `entity_view`, `fact_add`, `entity_search` tools + `MemoryPluginNextGen`. Not yet shipped.
- **Rules engine (Path A)** — forward-chaining Datalog-lite for derived facts. Interface stub exists in `src/memory/rules/`.
- **Additional adapters** — NeDB for file-based persistence, Neo4j for graph-heavy workloads.

Until those ship, consumers integrate the memory layer by:
1. Wiring it into their app (see Quickstart + backend sections).
2. Calling the LLM with `defaultExtractionPrompt` and feeding output into `ExtractionResolver`.
3. Calling `memory.getContext` when an agent needs to know about an entity.

---

*For the full API reference, see [MEMORY_API.md](./MEMORY_API.md). For the source, see `src/memory/`.*
