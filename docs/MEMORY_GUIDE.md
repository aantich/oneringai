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
14. [Giving agents memory — the `MemoryPluginNextGen` plugin and `memory_*` tools](#giving-agents-memory--the-memorypluginnextgen-plugin-and-memory_-tools)
15. [Common patterns](#common-patterns)
16. [Scaling](#scaling)
17. [Troubleshooting](#troubleshooting)

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

#### Configuring the task-state vocabulary

If your app uses a different lifecycle than the library default (`pending / in_progress / blocked / deferred / done / cancelled`), configure it at construction instead of hardcoding state strings in every query:

```ts
const memory = new MemorySystem({
  store,
  taskStates: {
    active:   ['proposed', 'scheduled', 'in_progress', 'blocked'],
    terminal: ['done', 'cancelled'],
  },
});
```

The two arrays must be non-empty and disjoint. `getContext.relatedTasks` and future task helpers use this config to decide which tasks are "still open". Read the resolved config via `memory.taskStates`.

#### Canonical identifiers for convergence across signals

Tasks have no natural external strong key — the same task re-surfaced across email, Slack, and calendar gets re-phrased every time. Without a deterministic identifier, re-extraction creates duplicates.

Use `canonicalIdentifier()` to build a `{ kind: 'canonical', value: ... }` identifier from the task's structural invariants:

```ts
import { canonicalIdentifier } from '@everworker/oneringai/memory';

const id = canonicalIdentifier('task', {
  assignee: john.id,
  context: acmeDeal.id,
  title: 'Send budget by Friday',
});
// → { kind: 'canonical', value: 'task:<john-id>:<deal-id>:send-budget-by-friday', isPrimary: false }

await memory.upsertEntity(
  {
    type: 'task',
    displayName: 'Send Q3 budget by Friday',
    identifiers: [id],
    metadata: { state: 'proposed', assigneeId: john.id },
  },
  scope,
);
```

A follow-up signal that re-extracts the same task (perhaps phrased as "send the budget proposal by end of week") builds the same canonical identifier → Tier-1 identifier match in the resolver → converges on the existing entity. The same helper works for events (`canonicalIdentifier('event', { source: 'gcal', id: externalId })`), topics, projects.

`'canonical'` is a library-blessed identifier kind — use it uniformly so tooling can recognize the pattern.

#### Setting type-specific metadata at upsert time

`upsertEntityBySurface` accepts `metadata` directly. This matters for LLM-driven ingestion: the extractor can emit `state`, `dueAt`, `assigneeId` on the mention itself rather than chasing the create with a separate `updateEntityMetadata` call.

**Conservative merge on resolve:** when the upsert matches an existing entity, `metadata` is merged using `'fillMissing'` semantics by default — **only keys absent from the stored metadata are set**. Existing values are never overwritten. This guards against a follow-up re-extraction silently flipping `state` from `in_progress` to `proposed` because the LLM misread a summary email.

```ts
// First extraction — create path, metadata set verbatim
await memory.upsertEntityBySurface(
  {
    surface: 'Send budget by Friday',
    type: 'task',
    identifiers: [canonicalIdentifier('task', { assignee: 'alice', title: 'budget' })],
    metadata: { state: 'proposed', dueAt: '2026-04-30' },
  },
  scope,
);

// Later extraction: resolver converges on the same entity via canonical id.
// metadata merges with fillMissing — the incoming `state: 'done'` is IGNORED
// because state already exists. `priority: 'high'` IS added (new key).
await memory.upsertEntityBySurface(
  {
    surface: 'Budget review task',
    type: 'task',
    identifiers: [canonicalIdentifier('task', { assignee: 'alice', title: 'budget' })],
    metadata: { state: 'done', priority: 'high' },  // state ignored, priority added
  },
  scope,
);
```

To **deliberately** mutate existing metadata, use `updateEntityMetadata(id, patch, scope)` for raw patches, or `transitionTaskState()` for state-machine validated transitions (below). For sync jobs where the caller is the authoritative source of truth, opt into shallow-overwrite via `{ metadataMerge: 'overwrite' }` on `upsertEntityBySurface`.

#### Transitioning task state — `transitionTaskState`

The canonical way to mutate `task.metadata.state` after creation:

```ts
await memory.transitionTaskState(
  task.id,
  'done',
  {
    signalId: 'email-abc123',
    reason: 'Completed ahead of schedule',
    validate: 'strict',
    transitions: {
      pending: ['in_progress', 'cancelled'],
      in_progress: ['done', 'blocked', 'cancelled'],
      blocked: ['in_progress', 'cancelled'],
      done: [],
      cancelled: [],
    },
  },
  scope,
);
```

Side effects (atomic from the caller's perspective):
- Sets `metadata.state = newState`.
- Appends to `metadata.stateHistory: { from, to, at, signalId?, reason? }[]`. No library cap — retention is your problem.
- When `newState` is in `taskStates.terminal` AND `metadata.completedAt` is unset, sets `metadata.completedAt`.
- Writes a `state_changed` atomic fact with `value: { from, to }`, `sourceSignalId`, `importance: 0.7` for audit + retrieval.

**Validate modes:**
- `'warn'` (default): out-of-matrix transitions route through your `onError` hook and still apply.
- `'strict'`: out-of-matrix transitions throw `InvalidTaskTransitionError` — metadata + fact writes are skipped.
- `'none'`: silent.

**No-op short-circuit:** `from === to` returns without writing anything (no history entry, no fact, no version bump).

#### LLM auto-routing of state changes

When the LLM extractor emits a `state_changed` fact on a task entity, the `ExtractionResolver` routes it through `transitionTaskState` automatically — so the metadata update, history append, and `completedAt` for terminal states all fire as part of ingestion. The audit fact still lands.

Tolerant value shapes the extractor can emit: `{ from, to }`, `{ to }`, or a plain string. Non-task subjects and malformed values fall through to plain `addFact` — nothing breaks. Opt out globally via `new MemorySystem({ ..., autoApplyTaskTransitions: false })`.

#### Fetching open tasks + recent topics for prompt injection

Two thin helpers for feeding prior context into extraction prompts (so re-mentions of existing tasks resolve to the same entity instead of creating duplicates):

```ts
const openTasks = await memory.listOpenTasks(scope, {
  assigneeId: currentUser,
  limit: 20,
});
const recentTopics = await memory.listRecentTopics(scope, {
  days: 30,
  limit: 30,
});
```

`listOpenTasks` uses the configured `taskStates.active` as the `$in` filter. Sorted client-side by `dueAt` ascending (undefined last) then `updatedAt` descending.

`listRecentTopics` filters topics updated within the last `days` (default 30). Sorted by `updatedAt` descending.

Both clamp the limit to `[1, 200]`. (Future optimization: push sort + date filter to adapters via `EntityListFilter.orderBy` + `updatedAfter`.)

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

#### Ingesting calendar events — `CalendarSignalAdapter`

The library ships a reference adapter for calendar events. It handles the boilerplate of translating a calendar API payload into seed entities + deterministic relational facts:

```ts
import {
  SignalIngestor,
  CalendarSignalAdapter,
  ConnectorExtractor,
} from '@everworker/oneringai/memory';

const ingestor = new SignalIngestor({
  memory,
  extractor: new ConnectorExtractor({ connector, model: 'gpt-5-mini' }),
  adapters: [new CalendarSignalAdapter()],
});

await ingestor.ingest({
  kind: 'calendar',
  raw: {
    id: 'cal_evt_abc123',
    source: 'gcal',
    title: 'Q3 Planning Review',
    description: 'Go through Q3 priorities and finalize budget.',
    startTime: new Date('2026-05-01T10:00:00Z'),
    endTime: new Date('2026-05-01T11:00:00Z'),
    location: 'Conference Room A',
    organizer: { email: 'alice@acme.com', name: 'Alice' },
    attendees: [
      { email: 'bob@acme.com', name: 'Bob' },
      { email: 'carol@acme.com', rsvpStatus: 'accepted' },
    ],
    kind: 'meeting',
  },
  sourceSignalId: 'gcal:cal_evt_abc123',
  scope,
});
```

What happens:
- Event entity created (or resolved) via canonical identifier `event:gcal:cal_evt_abc123`. Metadata carries `startTime`, `endTime`, `location`, `kind`.
- Alice + Bob + Carol seeded as `person` entities keyed by email.
- Three deterministic facts written: `Alice hosted Event`, `Bob attended Event`, `Carol attended Event`.
- LLM runs against `signalText` (title + description + attendees) to extract any narrative facts from the description.
- Declined attendees: still seeded as people, but no `attended` fact (opt out via `skipDeclinedAttendance: false`).

**Convergence:** re-ingesting the same calendar event (periodic sync, updated invite) hits the same canonical identifier and converges on the existing event entity. Metadata updates use the conservative `fillMissing` merge — existing `startTime` won't be overwritten if the caller sends it again. Use `updateEntityMetadata` directly to deliberately reschedule.

**Custom source formats:** for sources the library doesn't ship an adapter for, implement `SignalSourceAdapter<YourShape>` + emit your own `participants` + `seedFacts`. The `role` field on each seed is what `seedFacts` reference — design it to reflect the structural roles you'll need to wire up.

#### Surfacing attended events

`getContext(person.id).relatedEvents` returns events the person is linked to via three tiers:
1. `event.metadata.attendeeIds` includes the person's id → role `'attended'`
2. `event.metadata.hostId` matches → role `'hosted'`
3. A fact `(person, attended|hosted, event)` exists → role matches the predicate

Tier 3 is what makes the calendar adapter work without duplicating attendee ids into every event's metadata.

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

> For a dedicated walkthrough with copy-paste recipes, see [MEMORY_PREDICATES.md](./MEMORY_PREDICATES.md).

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

The library offers **two levels of abstraction** — pick the one that fits your call site.

### Two levels

1. **High-level: `SignalIngestor`** (recommended default for real signals with metadata). Handles participant seeding from source metadata (email headers, attendee lists, Slack user IDs), pre-binds them to local labels, renders the prompt with a locked vocabulary, calls the LLM, and writes facts. One call, raw → facts. Pluggable adapters for each source type, pluggable extractor for the LLM call.
2. **Low-level: `ExtractionResolver` + `defaultExtractionPrompt`** (the primitives). You own the LLM call and hand raw output (`{mentions, facts}`) to the resolver. Use this when you have your own prompt construction, your own extractor pipeline, or want to run the extraction asynchronously from the write.

Both write through the same `addFact` path — same scope semantics, same `sourceSignalId` flow, same `IngestionResult` shape. The high-level ingestor is built on the low-level primitives; it just adds the seed phase + locked-label prompt rendering.

**Rule of thumb.**
- Email, Slack, calendar, tickets, anything with deterministic sender/recipient metadata → `SignalIngestor`.
- Plain text with no metadata → either works; `SignalIngestor` via `PlainTextAdapter` for uniformity.
- Bespoke extraction flows (custom JSON schema, multi-step, retries at the model level) → keep the primitives.

> Full walkthrough of the high-level pipeline with recipes, custom adapter / custom extractor examples, and pitfalls: [MEMORY_SIGNALS.md](./MEMORY_SIGNALS.md). This section focuses on the primitives.

### High-level quickstart — email in one call

```ts
import {
  createMemorySystemWithConnectors,
  SignalIngestor,
  ConnectorExtractor,
  EmailSignalAdapter,
} from '@everworker/oneringai/memory';

const memory = createMemorySystemWithConnectors({ store, connectors: { /* ... */ } });

const ingestor = new SignalIngestor({
  memory,
  extractor: new ConnectorExtractor({ connector: 'anthropic-prod', model: 'claude-sonnet-4-6' }),
  adapters: [new EmailSignalAdapter()],
});

const result = await ingestor.ingest({
  kind: 'email',
  raw: {
    from: { email: 'anton@everworker.ai', name: 'Anton Antich' },
    to:   [{ email: 'sarah@acme.com',    name: 'Sarah Chen' }],
    cc:   [{ email: 'bob@acme.com' }],
    subject: 'Q3 planning',
    body:    'Let us lock in priorities next week.',
  },
  sourceSignalId: 'gmail_msg_abc123',
  scope: { groupId: 'workspace-1' },
});
// result.entities — participants (seeded via headers) + anything the LLM discovered in the body
// result.facts    — written with sourceSignalId attached
// result.mergeCandidates, result.unresolved, result.newPredicates — review signals
```

What the ingestor does that you don't:
- Upserts `anton@everworker.ai`, `sarah@acme.com`, `bob@acme.com`, plus non-free domains `everworker.ai` and `acme.com` (organizations) — **before** the LLM runs.
- Locks each to labels `m1…m5` and tells the LLM: "these are bound, reference them directly, do not redeclare them, start new labels at m6."
- If the LLM emits a duplicate mention for a seeded label anyway, the pre-bound id wins (defence-in-depth).
- BCC is dropped from both seeding and the prompt — privacy-safe by default.

To swap the LLM (proxy, self-hosted model, etc.) implement the one-method `IExtractor` contract. To support a new source type (Slack, Jira, HubSpot, …) implement the one-method `SignalSourceAdapter<TRaw>`. Both are in [MEMORY_SIGNALS.md](./MEMORY_SIGNALS.md).

### Low-level: why two phases?

LLMs are great at reading text and identifying who/what/when. They're bad at remembering your entity IDs. So extraction has two phases:

1. **LLM phase:** emit structured JSON with local mention labels + facts referencing those labels. LLM never sees real entity IDs.
2. **Resolver phase:** deterministic code translates mention labels to entity IDs (resolving or creating entities via `upsertEntityBySurface`), then writes facts with `sourceSignalId` attached.

If you already have pre-resolved entities for some participants (from upstream metadata), pass them via `ExtractionResolverOptions.preResolved: { label: entityId }` — the resolver seeds the label map and skips upsert for those labels. The `SignalIngestor` above uses this internally.

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

Scope is **who the record is for** (`groupId` + `ownerId`). Permissions are **what they can do with it** (`permissions.group` + `permissions.world`). Both must pass for a caller to read/write.

> **Every record now requires an `ownerId`.** The library throws `OwnerRequiredError` when you try to create an entity or fact without one. Either set `scope.userId` (auto-defaulted to `ownerId`) or pass `input.ownerId` explicitly (admin delegation). See [MEMORY_PERMISSIONS.md](./MEMORY_PERMISSIONS.md#the-owner-invariant).
>
> **Records are public-read by default.** UNIX `644` semantics. If you need to prevent cross-group reads, set `permissions: { world: 'none' }` at write time. The sections below describe the four scope shapes; permissions layer on top.

### Access control at a glance

```ts
permissions?: {
  group?: 'none' | 'read' | 'write';   // default 'read' when groupId is set
  world?: 'none' | 'read' | 'write';   // default 'read'
}
```

Owner always has full access. See the dedicated guide — [MEMORY_PERMISSIONS.md](./MEMORY_PERMISSIONS.md) — for model, recipes, migration, and pitfalls.

### The four scope shapes (scope-only — see MEMORY_PERMISSIONS.md for permissions interaction)

- **Public** (no `groupId`, `ownerId` set) — with default `world: 'read'`, visible to every caller; writable only by the owner.
- **Group-wide** (`groupId` set, `ownerId` set) — default group `read`, world `read`. Set `world: 'none'` for group-private.
- **User-private cross-group** (only `ownerId` set) — private to one user when `world: 'none'`; public-read otherwise.
- **User-private within group** (both set) — private to the owner when `group: 'none', world: 'none'`.

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

## Giving agents memory — the `MemoryPluginNextGen` / `MemoryWritePluginNextGen` plugins and `memory_*` tools

Up to this point the guide has been about the memory *library* — you call `memory.addFact`, `memory.getContext`, etc. from your application. But the whole point of memory is to make agents smarter, so we ship **two complementary context plugins** and a set of **LLM-callable tools** that let the agent read and (optionally) write memory during its own thinking loop.

There are three moving parts:

1. **`MemoryPluginNextGen`** — a [NextGen context plugin](./MEMORY_API.md) that bootstraps a user + agent entity in memory and injects their profiles into the system message. The agent sees its own evolving profile and the user's profile on every turn, without having to ask. Ships the **5 read** `memory_*` tools. Enabled via `features.memory: true`.
2. **`MemoryWritePluginNextGen`** — a lightweight sidecar plugin that adds the **5 write** `memory_*` tools (`memory_remember`, `memory_link`, `memory_upsert_entity`, `memory_forget`, `memory_restore`). No system-message content of its own. Enabled via `features.memoryWrite: true` — requires `features.memory: true` (the read plugin owns entity bootstrap + profile injection).
3. **The `memory_*` tools** (10 total, split 5/5) — high-signal LLM tools for everything the plugin doesn't inject: looking up entities, walking the graph, semantic search (reads); writing facts, linking entities, upserting entities, forgetting/superseding facts (writes).

**Two common wiring choices:**

- **Read + write (traditional):** enable both flags. The agent reads memory via retrieval tools and also decides when to write new facts itself. Good for explicit "remember this" conversations. Higher per-turn token cost (~5k tokens of tool schemas).
- **Read-only + background ingestion:** enable only `memory: true`, and manually register a `SessionIngestorPluginNextGen` that extracts facts from the conversation on a (usually cheaper) separate model. Agent cannot write directly — memory updates itself behind the scenes. Cheaper per turn; write latency lags one turn.

The plugin pair is how **self-learning** works end-to-end: observations flow in through `memory_remember` (or your own ingestion code like `SessionIngestorPluginNextGen`), profiles regenerate incrementally as enough new facts accumulate, and the regenerated profiles appear in context on the next turn. No manual prompt engineering, no static "rules for the agent" file.

### Quick start

```ts
import { Agent, AgentContextNextGen, MemoryPluginNextGen } from '@everworker/oneringai';
import { createMemorySystemWithConnectors, InMemoryAdapter } from '@everworker/oneringai';

// 1. Build a memory system (see "Choosing a storage backend" above).
const memory = createMemorySystemWithConnectors({
  store: new InMemoryAdapter(),
  connectors: {
    embedding: { connector: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    profile:   { connector: 'anthropic', model: 'claude-sonnet-4-6' },
  },
});

// 2. Create an agent with both memory features enabled (read + write).
const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  agentId: 'my-assistant',
  userId: 'alice',             // REQUIRED — memory enforces owner on every record
  contextFeatures: {
    memory: true,               // reads: profile injection + 5 retrieval tools
    memoryWrite: true,          // writes: 5 mutation tools (omit for retrieval-only)
  },
  pluginConfigs: {
    memory: {
      memory,                  // the MemorySystem instance (shared by both plugins)
      // groupId: 'team-A',    // optional: trusted group from your auth layer
      // userProfileInjection: { topFacts: 20, relatedTasks: true },
      // agentProfileInjection: { topFacts: 10 },
    },
    // memoryWrite inherits `memory` from plugins.memory.memory unless overridden.
  },
});

// On every agent turn the system message now includes:
//   ## Agent Profile (agent:my-assistant)
//   ...profile.details (regenerates automatically)...
//   ### Recent top facts (up to 20)
//
//   ## Your User Profile (user:alice)
//   ...profile.details...
//   ### Recent top facts (up to 20)

await agent.run("Remember that I prefer concise responses");
// Agent calls memory_remember({subject:"me", predicate:"prefers", value:"concise responses"})
// Fact is stored, threshold check triggers profile regen in the background,
// next turn the user profile reflects the new preference.
```

### Plugin configuration

```ts
interface MemoryPluginConfig {
  memory: MemorySystem;                    // REQUIRED
  agentId: string;                         // REQUIRED — unique per agent definition
  userId: string;                          // REQUIRED — memory's owner invariant

  // Trusted group from your auth layer. Plumbed into every memory call the
  // plugin + its tools make. LLM tool arguments CANNOT override this —
  // see "Security model" below.
  groupId?: string;

  // Permissions stamped on the bootstrapped user/agent entities.
  // Defaults: library defaults (group:read, world:read).
  userEntityPermissions?:  { group?: 'none'|'read'|'write'; world?: 'none'|'read'|'write' };
  agentEntityPermissions?: { group?: 'none'|'read'|'write'; world?: 'none'|'read'|'write' };

  // What to inject into the system message for each profile.
  userProfileInjection?:  ProfileInjection;
  agentProfileInjection?: ProfileInjection;

  // Per-subject default visibility for `memory_remember` / `memory_link`.
  // Defaults: user → 'private', this_agent → 'group', other → 'private'.
  defaultVisibility?: {
    forUser?:  'private' | 'group' | 'public';
    forAgent?: 'private' | 'group' | 'public';
    forOther?: 'private' | 'group' | 'public';
  };

  // Fuzzy-match threshold for {surface} lookups. Default 0.9 (conservative).
  autoResolveThreshold?: number;
}

interface ProfileInjection {
  profile?: boolean;          // Include profile.details text. Default true.
  topFacts?: number;          // Recent ranked facts. 0 disables. Default 20 (max 100).
  factPredicates?: string[];  // Whitelist for topFacts. Default all.
  relatedTasks?: boolean;     // Include active tasks. Default false.
  relatedEvents?: boolean;    // Include recent events. Default false.
  identifiers?: boolean;      // Render identifier list. Default false.
  maxFactLineChars?: number;  // Truncate each rendered fact line. Default 200.
}
```

### Entity bootstrap

On first `getContent()` the plugin calls `memory.upsertEntity` to ensure:

- A `person` entity with identifier `{kind: 'system_user_id', value: userId}` for the user.
- An `agent` entity with identifier `{kind: 'system_agent_id', value: agentId}` for the agent.

`upsertEntity` is idempotent via identifier match, so repeated constructions of the plugin don't create duplicates. The plugin also uses an in-flight promise to serialise concurrent `getContent()` calls within the same process.

**Note:** cross-process uniqueness is the storage adapter's responsibility. For Mongo you want a unique compound index on `{identifiers.kind, identifiers.value}`.

### The 8 tools

All tools accept a **`SubjectRef`** where an entity is needed — a flexible type that reflects the fact that an entity can have many identifiers (email, slack_id, github_login, internal_id…). Valid forms:

```ts
type SubjectRef =
  | string                                             // entity id, "me", or "this_agent"
  | { id: string }
  | { identifier: { kind: string; value: string } }    // exact identifier match
  | { surface: string };                               // fuzzy resolution (name/alias)
```

Two special tokens: `"me"` → the bootstrapped user entity, `"this_agent"` → the bootstrapped agent entity.

#### `memory_recall`

Pull profile + top-ranked facts + optional tiers for any entity.

```json
{"subject": "me"}
{"subject": {"surface": "Acme deal"}, "include": ["neighbors"]}
{"subject": {"identifier": {"kind": "github_login", "value": "alice99"}}}
{"subject": "this_agent", "include": ["documents"]}
```

Args cap: `topFactsLimit ≤ 100`, `neighborDepth ≤ 5`.

#### `memory_graph`

N-hop traversal from a starting entity. Returns nodes + edges. Backends dispatch automatically — Mongo uses native `$graphLookup` for `direction: 'out' | 'in'` when `useNativeGraphLookup: true`; `direction: 'both'` always falls back to the iterative BFS path because per-hop direction flipping (the co-subject pattern) isn't expressible as a single `$graphLookup` pipeline.

```json
{"start": {"surface": "Anton"}, "direction": "out", "maxDepth": 1, "predicates": ["works_at"]}
{"start": {"surface": "Q3 planning"}, "direction": "in", "maxDepth": 1, "predicates": ["attended"]}
{"start": {"surface": "Anton"}, "direction": "both", "maxDepth": 2, "predicates": ["works_at"]}
```

> Note: bare strings in `start` are interpreted as entity IDs — only `"me"` and `"this_agent"` are special tokens. For name-based lookups, always use the `{"surface":"..."}` form as shown above.

**Query patterns the tool description teaches the LLM:**

| Question shape | Tool args |
|---|---|
| "What does X relate to via P?" | `direction:'out', maxDepth:1, predicates:[P]` |
| "Who/what relates to X via P?" | `direction:'in', maxDepth:1, predicates:[P]` |
| **"Who shares a P-relation with X?"** (co-subject — most common) | `direction:'both', maxDepth:2, predicates:[P]` — co-subjects appear at `depth:2` |
| "Follow P chain from X" (transitive) | `direction:'out', maxDepth:N, predicates:[P]` |
| "Everything around X" (neighborhood) | `direction:'both', maxDepth:N` (omit predicates) |
| "Point-in-time graph" | add `asOf:'<ISO>'` — filters facts with `createdAt ≤ asOf AND (validFrom ≤ asOf OR missing) AND (validUntil ≥ asOf OR missing)` |

Args cap: `maxDepth ≤ 5`, `limit ≤ 500`. `asOf` must be valid ISO-8601 or returns a structured error. `limit` applies to edges as well as nodes.

#### `memory_search`

Semantic text search across facts. Requires an embedder; returns a structured error otherwise.

```json
{"query": "deployment incidents last quarter", "topK": 10}
{"query": "Alice's preferences", "filter": {"subjectId": "<alice-id>"}}
```

Args cap: `topK ≤ 100`. Date filters must be ISO-8601 strings — invalid strings are rejected with a structured error.

#### `memory_find_entity`

Look up, list, or upsert an entity by any of its identifiers, by surface, or by type + metadata. Multi-ID enrichment happens automatically on upsert — if any identifier matches an existing entity, the others get merged in.

```json
{"by": {"identifier": {"kind": "email", "value": "alice@a.com"}}}
{"by": {"surface": "Alice from accounting"}}
{"action": "list", "by": {"type": "project", "metadataFilter": {"state": "active"}}}
{"action": "upsert", "type": "person", "displayName": "Alice Smith",
 "identifiers": [{"kind": "email", "value": "alice@a.com"},
                 {"kind": "slack_user_id", "value": "U07ABC"}]}
```

`list.limit ≤ 200`.

#### `memory_list_facts`

Paginated raw fact enumeration for a subject. Use when you want structured facts (to count, tabulate, export) rather than the synthesised profile.

```json
{"subject": "me", "predicate": "prefers"}
{"subject": {"surface": "Acme deal"}, "limit": 50}
{"subject": "me", "archivedOnly": true}
```

`archivedOnly: true` returns the audit view (archived only); default returns only live facts. `limit ≤ 200`.

#### `memory_remember`

Write a new atomic fact. The LLM should call this proactively whenever the user reveals something worth remembering.

```json
{"subject": "me", "predicate": "prefers", "value": "concise responses"}
{"subject": {"surface": "Acme"}, "predicate": "employee_count",
 "value": 500, "confidence": 0.8, "importance": 0.3}
{"subject": "this_agent", "predicate": "learned_pattern",
 "details": "Ask for dimensions before tax calcs", "visibility": "group"}
```

`visibility` maps to the permission block:
- `"private"` → `{group: 'none', world: 'none'}` (owner-only)
- `"group"`   → `{group: 'read', world: 'none'}` (group-readable)
- `"public"`  → undefined (library defaults: group:read, world:read)

#### `memory_link`

Create a relational fact linking two entities. Both sides accept any `SubjectRef` form.

```json
{"from": {"surface": "Alice"}, "predicate": "attended", "to": {"surface": "Q3 planning"}}
{"from": "me", "predicate": "works_at", "to": {"identifier": {"kind": "domain", "value": "acme.com"}}}
```

#### `memory_forget`

Archive a fact (optionally superseding it with a correction). Supersession preserves the audit chain; archive just hides.

```json
{"factId": "fact_xyz"}
{"factId": "fact_xyz", "replaceWith": {"predicate": "role", "value": "senior engineer"}}
```

### Security model

The library's permission system trusts scope (`{userId, groupId}`) because the host application is responsible for authenticating who the caller is. The memory plugin + tools keep that trust boundary intact:

- **`userId` and `groupId` come from plugin config, NOT from tool arguments.** An LLM in principle controls tool args; if a `groupId` arg were honoured, a user in group A could call `memory_remember({..., groupId: "B"})` and escalate into group B.
- Consequently, tools do **not** accept a `groupId` arg. It's silently ignored if the model tries to pass one.
- The host app is responsible for setting `plugins.memory.groupId` from its authenticated session, not from user input.

**No ghost-writes.** `memory_remember` and `memory_link` reject writes whose subject (`subject` for remember, `from` for link) is owned by another user. Because the memory layer enforces `fact.ownerId == subject.ownerId`, a write against someone else's entity would silently attribute the fact to *them*. Tools return a structured error in that case. Use `memory_upsert_entity` to create your own entity for the fact you want to record.

**`contextIds` auto-downgrade.** If a write specifies `contextIds` that include entities you don't own, and the chosen visibility is `"group"` or `"public"`, the tool silently downgrades visibility to `"private"` and includes a `warnings` entry in the response. This prevents a compromised agent from planting cross-owner facts that would then surface in a victim's graph-walk results.

**Numeric input validation.** All LLM-controllable numeric limits are clamped (see per-tool caps above) to prevent DoS via huge `maxDepth` / `topK` / `limit` values. `confidence` and `importance` are clamped to `[0, 1]` at both the tool layer and the memory layer (`MemorySystem.addFact`) so a rogue `importance: 1e9` can't permanently dominate ranking.

**`kind` is a strict enum.** Every fact is either `'atomic'` (scalar, relation, or brief observation) or `'document'` (long-form prose, indexed for semantic search). `MemorySystem.addFact` rejects anything else. The extraction prompt names both values explicitly with when-to-pick guidance, and `ExtractionResolver` coerces unknown LLM-emitted kinds to `'atomic'` while logging the drift in `IngestionResult.unresolved` for review. `memory_remember` exposes `kind` as an optional arg with a JSON-schema enum so the LLM is constrained at the tool boundary.

**`value` and `objectId` are mutually exclusive.** A fact is either relational (objectId) or attribute (value). Setting both is rejected at both the tool and memory layer — storing both previously produced records that matched predicate-filtered queries ambiguously.

### Using the tools outside the plugin

If you're building a custom agent and don't want the full plugin setup, you can still use the `memory_*` tools directly. Three factories are exported, all sharing the same `CreateMemoryToolsArgs`:

- `createMemoryReadTools(...)` — the 5 retrieval tools (`memory_recall`, `memory_graph`, `memory_search`, `memory_find_entity`, `memory_list_facts`).
- `createMemoryWriteTools(...)` — the 5 mutation tools (`memory_remember`, `memory_link`, `memory_upsert_entity`, `memory_forget`, `memory_restore`).
- `createMemoryTools(...)` — convenience returning all 10.

```ts
import { createMemoryReadTools, createMemoryWriteTools } from '@everworker/oneringai';

const readTools = createMemoryReadTools({
  memory,                              // MemorySystem instance
  agentId: 'my-agent',
  defaultUserId: 'alice',              // fallback when ToolContext.userId is unset
  defaultGroupId: 'team-A',            // TRUSTED — from your auth layer
  // Optional: wire "me" / "this_agent" token resolution.
  getOwnSubjectIds: () => ({ userEntityId: '<ent-id>', agentEntityId: '<ent-id>' }),
  defaultVisibility: { forUser: 'private', forAgent: 'group', forOther: 'private' },
  autoResolveThreshold: 0.9,
});

// Register on any Agent. For a read-only agent skip the write bundle entirely.
agent.registerTools(readTools);

// Or, for full read+write:
const writeTools = createMemoryWriteTools({ memory, agentId: 'my-agent', defaultUserId: 'alice' });
agent.registerTools([...readTools, ...writeTools]);
```

Without `getOwnSubjectIds`, the `"me"` / `"this_agent"` tokens return a structured error; callers must reference entities by id, identifier, or surface.

### Relation to `UserInfoPluginNextGen` and `PersistentInstructionsPluginNextGen`

Both are **deprecated** in favour of `MemoryPluginNextGen`. They keep working unchanged for existing integrations — no breaking change — but new code should prefer the memory plugin:

- Dumb KV → append-only facts with supersession (history preserved).
- Manual updates → incremental profile regeneration (LLM synthesises preferences from observations).
- No confidence/importance → every fact carries them.
- No permissions → three-principal model built in.
- No semantic recall → `memory_search` + `memory_graph` just work.

Where the legacy plugins still fit: small, fixed, agent-side string configuration that never needs to evolve.

### Learning from agent runs — `SessionIngestorPluginNextGen`

The `memory_*` tools let the LLM write deliberately. But you shouldn't rely on it alone — agents forget, skip, or race past moments worth remembering. `SessionIngestorPluginNextGen` is a side-effect plugin that observes the conversation **before every `prepare()`** (crucially, BEFORE any compaction that would evict messages) and extracts structured facts through a dedicated LLM call.

```ts
import { SessionIngestorPluginNextGen } from '@everworker/oneringai';

ctx.registerPlugin(new SessionIngestorPluginNextGen({
  memory,
  agentId: 'sales-assistant',
  userId: currentUserId,
  groupId: currentGroupId,           // optional, trusted from host auth
  connectorName: 'haiku-extractor',  // REQUIRED — no default
  model: 'claude-haiku-4-5-20251001',
  diligence: 'normal',               // 'minimal' | 'normal' | 'thorough'
}));
```

**Required config:** `memory`, `agentId`, `userId`, `connectorName`, `model`. There are **no defaults** on the connector — the host explicitly wires its own extraction backend (usually cheaper than the main agent's model).

**Where it fires.** At the top of `AgentContextNextGen.prepare()`, before system-message assembly and before compaction. Plugin synchronously snapshots the conversation slice since its watermark, kicks off async extraction, returns immediately. `prepare()` is NEVER awaited on this — if the ingestor is slow, the turn proceeds. The next turn sees whatever was persisted by then.

**What it extracts.** The prompt partitions output into three buckets, with pre-bound labels so the LLM never re-resolves the user or agent identity:

| Bucket | Subject | Use for |
|---|---|---|
| **USER facts** | `m_user` (pre-bound) | Preferences, identity claims, personal circumstances |
| **AGENT learnings** | `m_agent` (pre-bound) | Procedures / patterns / rules the agent discovered — `learned_pattern`, `refined_procedure`, `avoided_pitfall`. Use `kind:"document"` for multi-sentence prose |
| **OTHER entities** | new `m1..mN` mentions | People / orgs / projects / events / tasks mentioned in the turn |

**Diligence knob** (default `normal`):
- `minimal` — only facts stated EXPLICITLY. No inference.
- `normal` — explicit + confident inferences. Skip greetings / tool plumbing.
- `thorough` — tentative inferences included, flagged with `confidence < 0.7`.

**Dedup + detail merging.** Every write uses the dedup path:
1. The plugin calls `memory.findDuplicateFact({subjectId, predicate, kind, value, objectId})` before inserting.
2. No match → `addFact` inserts as new.
3. Match → `addFact({dedup:true})` bumps `observedAt` on the existing record (ranking stays fresh), no new row is created. If the new extraction carries non-empty `details`, the plugin makes a **one-off LLM call** passing `(existingDetails, newDetails)` and asks for a merged narrative, then applies it via `memory.updateFactDetails(factId, merged)`. Prior details are overwritten — use supersession if you need an audit chain.
4. If the merge call fails (connector error, rate limit), the plugin keeps the existing details unchanged and moves on — next turn can retry.

**Watermark.** Stable per-message-id, not an array index — this matters because `AgentContextNextGen._conversation` is mutated on every compaction, so indices shift. `lastIngestedMessageId` is persisted via `getState` / `restoreState` (state v2). On restore, `userId` mismatch resets the watermark; v1 (legacy index-based) state is treated as a reset. If the watermark message was itself compacted away between turns, the plugin falls back to "take all" — dedup protects from duplicate writes.

**Truncation is watermark-aware.** The transcript builder walks forward from the oldest un-ingested message and stops once `maxTranscriptChars` is exhausted. The watermark advances to the LAST message that fit, not the end of the slice — messages past the budget stay "not yet ingested" and will be seen on a future turn. No data loss; the ingestor may fall behind on busy sessions, but won't drop observations.

**Ghost-write protection.** The plugin calls `memory.addFact` directly and would otherwise bypass the tool-layer ghost-write guard. Two policies now enforce the invariant at the ingestor layer:
- **Bootstrap**: if `upsertEntity` returns a user/agent entity not owned by the current user (e.g. a group-readable shared entity owned by someone else), the plugin disables itself for the session and logs an error.
- **Mentions**: if a mention's upsert returns a foreign-owned entity, the mention is dropped from the label map — facts referencing it are silently skipped with a warning. Prevents planting facts under another user's ownership via shared / group-visible entities.

**In-flight guard.** One ingest at a time per plugin. If a new turn fires while a previous ingest is still running, the hook bails (next turn will pick up whatever hasn't been ingested yet, since the watermark hasn't advanced).

**Graceful degradation.** Extractor errors log via `logger.warn` and never propagate. A misbehaving plugin cannot break `prepare()`.

**Relationship to `MemoryPluginNextGen` / `MemoryWritePluginNextGen`.** The plugins compose:
- `MemoryPluginNextGen` — injects profiles into the system message + exposes the **5 read** `memory_*` tools.
- `MemoryWritePluginNextGen` — optional sidecar exposing the **5 write** `memory_*` tools for deliberate writes by the LLM. Omit when you want the agent to be retrieval-only.
- `SessionIngestorPluginNextGen` — passively captures observations from the conversation itself, fire-and-forget. Good replacement for `MemoryWritePluginNextGen` when you don't want the main agent to pay the write-tool schema cost or be trusted with direct memory mutations.
- All three bootstrap `person:<userId>` + `agent:<agentId>` entities via identifier-keyed upsert — the operation is idempotent, so running any combination is safe.

### Time-boxed facts

Every fact supports `validFrom` / `validUntil`. Query-time `asOf` filtering (adapter-native on Mongo; in-memory on the default backend) returns only facts valid at that point. The ranking recency decay (`Ranking.ts`, `recencyHalfLifeDays`) applies regardless.

Both extraction prompts (default + session ingestor) include a `## Validity period` section teaching the LLM to set `validUntil` per fact type:
- Ephemeral (today only) → `validUntil = end of today`
- Task / event-bound → `validUntil = due / event end`
- Project / quarter-bound → `validUntil = project end`
- Role / preference / identity → omit `validUntil` (valid until explicitly superseded)

When uncertain, the prompt instructs the LLM to OMIT `validUntil` rather than guess — a too-early expiry would silently hide the fact.

---

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

The memory layer + agent-side plugin are both shipped. Remaining future work:

- **Rules engine (Path A)** — forward-chaining Datalog-lite for derived facts. Interface stub exists in `src/memory/rules/`.
- **Additional adapters** — NeDB for file-based persistence, Neo4j for graph-heavy workloads.
- **Complex graph patterns** — the current `memory_graph` tool does N-hop BFS with predicate filters; true pattern queries (A→X→B via different predicates) would need a step-by-step API.

---

*For the full API reference, see [MEMORY_API.md](./MEMORY_API.md). For the source, see `src/memory/`.*
