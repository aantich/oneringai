# Memory Layer — API Reference

Detailed API reference for `src/memory/` (v2).

All public symbols are exported from `@everworker/oneringai/src/memory/index.js` (or `./memory` depending on your import configuration). The memory layer is self-contained — its only dependency on the rest of oneringai is via the `integration/` subfolder, which you can choose to use or replace.

---

## Table of Contents

1. [Core Types](#core-types)
2. [MemorySystem](#memorysystem)
3. [Storage Adapters](#storage-adapters)
4. [Entity Resolution](#entity-resolution)
5. [Integration Layer](#integration-layer)
6. [Extraction Helpers](#extraction-helpers)
7. [Ranking](#ranking)
8. [Predicate Registry](#predicate-registry)
9. [Events](#events)
10. [Errors](#errors)
11. [Type Reference](#type-reference)

---

## Core Types

### `IEntity`

```ts
interface IEntity extends ScopeFields {
  id: EntityId;                 // opaque string; typically "ent_<uuid>"
  type: string;                 // open string; see well-known types below
  displayName: string;          // human-readable primary name
  aliases?: string[];           // alternate display forms (NOT lookup keys)
  identifiers: Identifier[];    // lookup keys (uniqueness-bearing)
  metadata?: Record<string, unknown>;  // type-specific fields
  archived?: boolean;
  identityEmbedding?: number[]; // for semantic entity resolution (populated async)
  version: number;              // optimistic concurrency token
  createdAt: Date;
  updatedAt: Date;
  groupId?: string;             // from ScopeFields — group-scoped entity
  ownerId?: string;             // from ScopeFields — user-scoped entity
}
```

**Well-known `type` conventions:**

| Type | Required identifier kinds | Conventional metadata |
|---|---|---|
| `person` | any of: email, slack_id, phone, github | — |
| `organization` | any of: domain, legal_name, ticker, duns | — |
| `project` | (group-scoped slug, optional) | `status`, `stakeholderIds` |
| `task` | external_id optional | `state`, `dueAt`, `priority`, `assigneeId`, `reporterId`, `projectId`, `completedAt` |
| `event` | external_id optional | `startTime`, `endTime`, `location`, `kind`, `attendeeIds`, `hostId` |
| `topic` | — | — |
| `cluster` | — | `anchorEntityIds`, `firstSeen`, `lastSeen` |

`type` is **not an enum** — you can add your own types. The memory layer's defaults (for `getContext` tiers like `relatedTasks`) look for `type === 'task'` and `type === 'event'` specifically.

### `IFact`

```ts
interface IFact extends ScopeFields {
  id: FactId;
  subjectId: EntityId;
  predicate: string;            // e.g. 'works_at', 'assigned_task', 'profile'
  kind: 'atomic' | 'document';

  // Payload — atomic uses (objectId XOR value), document uses details.
  objectId?: EntityId;
  value?: unknown;
  details?: string;

  // Retrieval
  summaryForEmbedding?: string; // document kind: short gist, embedded in place of details
  embedding?: number[];         // populated async by the embedding queue
  isSemantic?: boolean;         // computed at write time; gates embedding eligibility

  // Quality + provenance
  confidence?: number;          // 0..1; default 1.0 for ranking
  sourceSignalId?: string;      // opaque signal reference (memory layer doesn't interpret)
  derivedBy?: string;           // rule-engine rule id if inferred

  // Salience
  importance?: number;          // 0..1; default 0.5. Ranking multiplier.

  // Multi-entity binding
  contextIds?: EntityId[];      // entities this fact is "about" beyond subject/object

  // Lifecycle
  supersedes?: FactId;          // predecessor id (archived when this fact is written)
  archived?: boolean;
  isAggregate?: boolean;        // $inc counters; never superseded

  // Temporal
  observedAt?: Date;
  validFrom?: Date;
  validUntil?: Date;

  metadata?: Record<string, unknown>;
  createdAt: Date;
  groupId?: string;
  ownerId?: string;
}
```

**Writing rules:**

- Atomic fact: set exactly one of `objectId` (relational) or `value` (attribute). `details` is optional narrative.
- Document fact: set `details` (long-form markdown). Leave `objectId`/`value` unset.
- Canonical profile: `predicate: 'profile'`, `kind: 'document'`. `MemorySystem.getContext` returns this automatically.
- Supersession: set `supersedes` to the prior fact's id. `MemorySystem.addFact` writes the new fact first, then archives the predecessor (crash-safe ordering).
- Signal provenance: always set `sourceSignalId` when the fact came from a signal. Opaque string; library users own the signal store.

### `Identifier`

```ts
interface Identifier {
  kind: string;           // 'email' | 'slack_id' | 'phone' | 'domain' | 'github' | 'legal_name' | 'ticker' | ...
  value: string;          // the id itself; stored lowercase internally
  isPrimary?: boolean;    // optional display hint
  verified?: boolean;
  source?: string;        // which signal/source added it
  addedAt?: Date;
}
```

Identifiers are stored lowercase internally for case-insensitive matching. Mixed-case inputs (`"John@ACME.com"`) resolve correctly.

### Scope

```ts
interface ScopeFields {
  groupId?: string;
  ownerId?: string;
}
```

- `(none, none)` — **global** — visible to all callers
- `(groupId, none)` — **group-wide** — visible to members of the group
- `(none, ownerId)` — **user-private** across all groups
- `(groupId, ownerId)` — **user-private within a group**

```ts
interface ScopeFilter {
  groupId?: string;   // caller's group
  userId?: string;    // caller's user id
}
```

**Visibility rule:**

A record is visible iff:
- `!record.groupId || record.groupId === filter.groupId`, AND
- `!record.ownerId || record.ownerId === filter.userId`.

**Scope invariant (enforced on fact writes):**

A fact's scope constraints must be a superset of its subject entity's scope:
- If `entity.groupId` set → `fact.groupId` must equal it.
- If `entity.ownerId` set → `fact.ownerId` must equal it.
- Facts may narrow further (add `ownerId` when entity has only `groupId`).

Violations throw `ScopeInvariantError`.

---

## MemorySystem

The facade. All business logic lives here.

### Construction

```ts
class MemorySystem implements IDisposable {
  constructor(config: MemorySystemConfig);
}

interface MemorySystemConfig {
  store: IMemoryStore;                         // required
  embedder?: IEmbedder;                         // optional; enables semantic search + identity embedding
  profileGenerator?: IProfileGenerator;         // optional; enables regenerateProfile + auto-regen
  ruleEngine?: IRuleEngine;                     // optional; enables deriveFactsFor
  profileRegenerationThreshold?: number;        // default 10 new atomic facts
  topFactsRanking?: RankingConfig;              // default half-life 90d, min confidence 0.2
  embeddingQueue?: EmbeddingQueueConfig;        // default concurrency 4, retries 3
  entityResolution?: EntityResolutionConfig;    // default threshold 0.90, minFuzzy 0.85, identityEmbedding enabled
  predicates?: PredicateRegistry;               // optional; canonicalization + defaults + auto-supersede (see below)
  predicateMode?: 'permissive' | 'strict';      // default 'permissive'; strict rejects unknowns
  predicateAutoSupersede?: boolean;             // default true; controls singleValued auto-supersede
  onChange?: (event: ChangeEvent) => void;      // fire-and-forget event hook
}
```

### Entity operations

#### `upsertEntity`

Create or merge-identifiers-into an entity, keyed on matching identifiers.

```ts
upsertEntity(
  input: Partial<IEntity> & {
    identifiers: Identifier[];   // may be empty array for projects/topics without external keys
    displayName: string;
    type: string;
  },
  scope: ScopeFilter,
): Promise<UpsertEntityResult>;

interface UpsertEntityResult {
  entity: IEntity;
  created: boolean;
  mergedIdentifiers: number;    // count of new identifiers added to existing entity
  mergeCandidates: EntityId[];  // other entities that matched by some identifiers
}
```

**Dedup logic:**
1. For each identifier, call `findEntitiesByIdentifier(kind, value, scope)`.
2. Zero matches → create new entity (version 1).
3. One match → merge new identifiers/aliases; bump version.
4. Multi distinct matches → pick the one with the most identifier hits; others reported in `mergeCandidates`.

**Scope defaults:** if `input.groupId`/`input.ownerId` absent, defaults to `scope.groupId`/`scope.userId` (caller's context).

#### `upsertEntityBySurface`

Entry point for LLM extraction pipelines. Translates a surface form (e.g. `"Microsoft"`) to an entity, creating or resolving.

```ts
upsertEntityBySurface(
  input: UpsertBySurfaceInput,
  scope: ScopeFilter,
  opts?: UpsertBySurfaceOptions,
): Promise<UpsertBySurfaceResult>;

interface UpsertBySurfaceInput {
  surface: string;                   // raw text as extracted by LLM
  type: string;
  identifiers?: Identifier[];
  aliases?: string[];                // alternate forms spotted nearby
  contextEntityIds?: EntityId[];     // siblings in the extraction — for disambiguation
}

interface UpsertBySurfaceOptions {
  autoResolveThreshold?: number;     // override default (0.90)
}

interface UpsertBySurfaceResult {
  entity: IEntity;
  resolved: boolean;                 // true = matched existing, false = created new
  mergeCandidates: EntityCandidate[]; // near-matches for human review
}
```

**Flow:**
1. Call `resolveEntity` with the same query.
2. If top candidate confidence ≥ threshold, append surface + new identifiers as aliases on the matched entity (alias accumulation). Return.
3. Otherwise create a new entity with the surface as `displayName`. Return near-matches as `mergeCandidates`.

Never auto-merges. `mergeCandidates` is advisory — use `MemorySystem.mergeEntities` to actually merge after human review.

#### `resolveEntity`

Return ranked candidate entities for a surface form.

```ts
resolveEntity(
  query: ResolveEntityQuery,
  scope: ScopeFilter,
  opts?: ResolveEntityOptions,
): Promise<EntityCandidate[]>;

interface ResolveEntityQuery {
  surface: string;
  type?: string;
  identifiers?: Identifier[];
  contextEntityIds?: EntityId[];
}

interface ResolveEntityOptions {
  limit?: number;        // default 5
  threshold?: number;    // default 0.5 (inclusive minimum confidence)
}

interface EntityCandidate {
  entity: IEntity;
  confidence: number;    // 0..1
  matchedOn: 'identifier' | 'displayName' | 'alias' | 'fuzzy' | 'embedding';
}
```

**Matching tiers:**

| Tier | Match | Confidence |
|---|---|---|
| 1 | Identifier (kind+value) | 1.0 |
| 2 | Exact `displayName` (after normalization — case/punctuation/suffix insensitive) | 0.9 |
| 3 | Exact alias | 0.85 |
| 4 | Fuzzy (normalized Levenshtein ≥ `minFuzzyRatio`) | 0.6–0.84 |
| 5 | Semantic (`identityEmbedding` cosine) | 0.4–0.8 |

**Context-aware disambiguation:** when multiple candidates pass threshold and none is a perfect identifier match, candidates that share facts with entities in `contextEntityIds` get a confidence boost (+0.05 per overlap, capped at 1.0).

#### `getEntity`

```ts
getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null>;
```

Returns null if entity is archived or not visible to caller.

#### `searchEntities`

Substring search over displayName, aliases, and identifier values.

```ts
searchEntities(
  query: string,
  opts: { types?: string[]; limit?: number; cursor?: string },
  scope: ScopeFilter,
): Promise<Page<IEntity>>;
```

#### `mergeEntities`

Merge two entities. Winner keeps all of loser's identifiers + aliases. All facts where loser is subject/object are rewritten to winner. Loser is archived.

```ts
mergeEntities(winnerId: EntityId, loserId: EntityId, scope: ScopeFilter): Promise<IEntity>;
```

**Scope-window limitation** (intentional, defence-in-depth): the fact-rewrite step only touches facts visible to the caller. Facts scoped more narrowly (e.g. other users' private facts on either entity) are left pointing at the archived loser. A "complete" merge requires a caller with broad-enough scope.

Emits `entity.merge` event.

#### `archiveEntity`

Soft-delete. Cascades to facts: all facts where this entity appears as subject or object are also archived.

```ts
archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void>;
```

Emits `entity.archive` event.

#### `deleteEntity`

```ts
deleteEntity(id: EntityId, scope: ScopeFilter, opts?: { hard?: boolean }): Promise<void>;
```

- Default (`hard: false`): same as `archiveEntity` — soft-delete, facts archived.
- `hard: true`: permanent delete of the entity; referencing facts are archived (not deleted).

#### `updateEntityMetadata`

Shallow-merge a patch into `entity.metadata`. Version-bumping, scope-checked, emits event.

```ts
updateEntityMetadata(
  id: EntityId,
  patch: Record<string, unknown>,
  scope: ScopeFilter,
): Promise<IEntity>;
```

Use this for task state changes, event metadata updates, etc. Does NOT re-queue identity embedding (metadata doesn't affect identity string).

```ts
// Mark a task as done
await memory.updateEntityMetadata(taskId, { state: 'done', completedAt: new Date() }, scope);
```

### Fact operations

#### `addFact`

Write a new fact. Enforces scope invariants, visibility checks on `objectId` + `contextIds`, supersession, embedding-queue enqueue, and profile auto-regen threshold.

```ts
addFact(
  input: Partial<IFact> & {
    subjectId: EntityId;
    predicate: string;
    kind: FactKind;
  },
  scope: ScopeFilter,
): Promise<IFact>;
```

**Validation:**
- Subject entity must be visible to caller.
- If `objectId` set, object entity must be visible to caller.
- If `contextIds` set, every entity in the list must be visible to caller.
- Scope invariant against subject entity.

**Auto-computed fields (if absent):**
- `id`: `fact_<uuid>`
- `createdAt`: now
- `observedAt`: now
- `isSemantic`: `true` for document kind; `true` for atomic with `details.length ≥ 80`; else `false`.
- `groupId`/`ownerId`: derived from input → subject entity → scope.

**Supersession:** if `supersedes` set, the new fact is written first, then the predecessor is archived (crash-safe ordering).

**Embedding queue:** if `isSemantic && embedder configured`, the fact is enqueued for async embedding. Writes return immediately.

**Profile auto-regen:** if `kind === 'atomic' && profileGenerator configured`, checks threshold and fires background regen if met.

Emits `fact.add` (and `fact.supersede` when supersession occurs).

#### `addFacts`

```ts
addFacts(inputs: Array<...>, scope: ScopeFilter): Promise<IFact[]>;
```

Serial batch — each fact passes through full validation. Preserves order.

#### `supersedeFact`

Convenience wrapper around `addFact` with `supersedes` pre-filled.

```ts
supersedeFact(
  oldId: FactId,
  newInput: Partial<IFact> & { predicate: string; kind: FactKind; subjectId: EntityId },
  scope: ScopeFilter,
): Promise<IFact>;
```

#### `archiveFact`

```ts
archiveFact(id: FactId, scope: ScopeFilter): Promise<void>;
```

Emits `fact.archive`.

### Retrieval

#### `getContext`

Primary retrieval API. Returns a rich view of an entity: profile + top ranked facts + optional tiers (documents, semantic, neighbors, related tasks, related events).

```ts
getContext(
  entityId: EntityId,
  opts: ContextOptions,
  scope: ScopeFilter,
): Promise<EntityView>;

interface ContextOptions {
  topFactsLimit?: number;              // default 15
  include?: ('documents' | 'semantic' | 'neighbors')[];
  tiers?: 'full' | 'minimal';          // default 'full' → includes relatedTasks + relatedEvents
  documentPredicates?: string[];       // filter document tier
  semanticQuery?: string;              // required for semantic tier
  semanticTopK?: number;               // default 5
  neighborPredicates?: string[];
  neighborDepth?: number;              // default 1
  asOf?: Date;                         // temporal view
  relatedTasksLimit?: number;          // default 15
  relatedEventsLimit?: number;         // default 15
  recentEventsWindowDays?: number;     // default 90
}

interface EntityView {
  entity: IEntity;
  profile: IFact | null;               // most-specific visible profile; null if none
  topFacts: IFact[];                   // subject OR object OR contextIds, ranked
  relatedTasks?: RelatedTask[];        // default-on (unless tiers:'minimal')
  relatedEvents?: RelatedEvent[];      // default-on (unless tiers:'minimal')
  documents?: IFact[];                 // if include: ['documents']
  semantic?: Array<{ fact: IFact; score: number }>;  // if include: ['semantic']
  neighbors?: Neighborhood;            // if include: ['neighbors']
}

interface RelatedTask { task: IEntity; role: string; }  // role: 'assigned_to' | 'reporter_of' | 'project_of' | 'context_of'
interface RelatedEvent { event: IEntity; role: string; when?: Date; }
```

**Top facts query:** uses `touchesEntity` filter — returns facts where the entity is **subject OR object OR in contextIds**. Then ranked by `scoreFact` (see [Ranking](#ranking)) and truncated to `topFactsLimit`.

**Profile resolution precedence:** ownerId match > groupId match > global. Most-specific visible.

**Related tasks:** queries task entities (`type: 'task'`) where:
- `metadata.assigneeId === entityId` (role: `assigned_to`)
- `metadata.reporterId === entityId` (role: `reporter_of`)
- `metadata.projectId === entityId` (role: `project_of`)
- entity appears in `contextIds` of a fact whose subject/object is a task (role: `context_of`)
Filtered to non-terminal states (`pending`, `in_progress`, `blocked`, `deferred`).

**Related events:** event entities in a recent window (`recentEventsWindowDays`) where entity is in `metadata.attendeeIds` or `metadata.hostId`, plus events reached via `contextIds` on facts about the subject.

Throws if the entity is not visible / archived / missing.

#### `getProfile`

```ts
getProfile(entityId: EntityId, scope: ScopeFilter): Promise<IFact | null>;
```

Returns the most-specific visible profile document fact. Scope resolution order: `ownerId` match > `groupId` match > global.

#### `traverse`

Graph traversal. Uses native `store.traverse` if present, else falls back to `genericTraverse` (BFS over `findFacts`).

```ts
traverse(
  entityId: EntityId,
  opts: TraversalOptions,
  scope: ScopeFilter,
): Promise<Neighborhood>;

interface TraversalOptions {
  predicates?: string[];        // filter edge predicates
  direction: 'out' | 'in' | 'both';
  maxDepth: number;             // required hard bound
  limit?: number;               // max nodes returned
  asOf?: Date;
}

interface Neighborhood {
  nodes: Array<{ entity: IEntity; depth: number }>;
  edges: Array<{ fact: IFact; from: EntityId; to: EntityId; depth: number }>;
}
```

#### `semanticSearch`

Vector search over facts. Requires embedder + `store.semanticSearch` capability.

```ts
semanticSearch(
  query: string,
  filter: FactFilter,
  scope: ScopeFilter,
  topK?: number,    // default 5
): Promise<Array<{ fact: IFact; score: number }>>;
```

Throws `SemanticSearchUnavailableError` if either is missing.

### Profile lifecycle

#### `regenerateProfile`

```ts
regenerateProfile(
  entityId: EntityId,
  targetScope: ScopeFields,
  trigger?: 'threshold' | 'manual',
): Promise<IFact>;
```

Runs the profile generator against the entity's atomic facts visible at the target scope, writes the resulting document fact with `predicate: 'profile'`, supersedes the prior profile at the same scope if present.

**Auto-triggers:** `addFact` schedules this in the background (debounced per `(entityId, scope)` via an in-flight set) when the fact count for the entity reaches `profileRegenerationThreshold`.

Throws `ProfileGeneratorMissingError` if no generator is configured.

Emits `profile.regenerate`.

### Rule engine

#### `deriveFactsFor`

```ts
deriveFactsFor(entityId: EntityId, scope: ScopeFilter): Promise<IFact[]>;
```

Invokes the configured rule engine with a read-only `IScopedMemoryView`. Returns the derived facts after writing them through `addFact`. Returns `[]` if no engine is configured.

**Sandboxing:** the view exposes only `getEntity` and `findFacts` — rules cannot write. Derived fact specs go through the same validation pipeline as caller-initiated writes.

### Embedding queue control

```ts
flushEmbeddings(): Promise<void>;     // await all pending embedding jobs
pendingEmbeddings(): number;           // count of queued + in-flight
```

### Lifecycle

```ts
destroy(): void;                 // sync, idempotent; stops queue, rejects further ops
shutdown(): Promise<void>;       // flushes queue, then destroys; calls store.shutdown if present
isDestroyed: boolean;
```

---

## Storage Adapters

### `IMemoryStore` contract

Every adapter must implement this:

```ts
// Input types — adapter assigns id + version + timestamps on create.
type NewEntity = Omit<IEntity, 'id' | 'version' | 'createdAt' | 'updatedAt'>;
type NewFact   = Omit<IFact,   'id' | 'createdAt'>;

interface IMemoryStore {
  // ===== Entities (required) =====
  createEntity(input: NewEntity): Promise<IEntity>;                      // returns with id populated
  createEntities(inputs: NewEntity[]): Promise<IEntity[]>;
  updateEntity(entity: IEntity): Promise<void>;                          // version must be stored+1
  getEntity(id: EntityId, scope: ScopeFilter): Promise<IEntity | null>;
  findEntitiesByIdentifier(kind: string, value: string, scope: ScopeFilter): Promise<IEntity[]>;
  searchEntities(query: string, opts: EntitySearchOptions, scope: ScopeFilter): Promise<Page<IEntity>>;
  listEntities(filter: EntityListFilter, opts: ListOptions, scope: ScopeFilter): Promise<Page<IEntity>>;
  archiveEntity(id: EntityId, scope: ScopeFilter): Promise<void>;
  deleteEntity(id: EntityId, scope: ScopeFilter): Promise<void>;

  // ===== Facts (required) =====
  createFact(input: NewFact): Promise<IFact>;                            // returns with id populated
  createFacts(inputs: NewFact[]): Promise<IFact[]>;
  getFact(id: FactId, scope: ScopeFilter): Promise<IFact | null>;
  findFacts(filter: FactFilter, opts: FactQueryOptions, scope: ScopeFilter): Promise<Page<IFact>>;
  updateFact(id: FactId, patch: Partial<IFact>, scope: ScopeFilter): Promise<void>;
  countFacts(filter: FactFilter, scope: ScopeFilter): Promise<number>;

  // ===== Graph (optional) =====
  traverse?(startId: EntityId, opts: TraversalOptions, scope: ScopeFilter): Promise<Neighborhood>;

  // ===== Vector (optional) =====
  semanticSearch?(
    queryVector: number[],
    filter: FactFilter,
    opts: SemanticSearchOptions,
    scope: ScopeFilter,
  ): Promise<Array<{ fact: IFact; score: number }>>;

  // ===== Lifecycle =====
  destroy(): void;
  shutdown?(): Promise<void>;
}
```

**Adapter responsibilities:**

1. Apply `ScopeFilter` to every read (defence-in-depth; MemorySystem also filters).
2. Assign primary ids on `createEntity` / `createFact`. Native mechanisms preferred (Mongo ObjectId → hex string; Meteor Random.id(); UUID for in-memory).
3. Enforce optimistic concurrency on `updateEntity`: reject if incoming `version !== stored.version + 1`.
4. Hide archived records by default; show only when `filter.archived === true`.
5. Support `asOf` on fact queries (`validFrom ≤ asOf ≤ validUntil ?? ∞` AND `createdAt ≤ asOf`).
6. Support `metadataFilter` on `listEntities` — equality + `{ $in: [...] }` at minimum.
7. Support `contextId` and `touchesEntity` filters on `findFacts`.

### `InMemoryAdapter`

```ts
class InMemoryAdapter implements IMemoryStore {
  constructor(opts?: { entities?: IEntity[]; facts?: IFact[] });
}
```

Zero-dep default. Good for tests, single-process dev, and small deployments. Maintains:

- Primary id indexes
- Identifier lookup index `(kind, value-lowercase)` → entity ids
- Fact indexes: `bySubject`, `byObject`, `byContext`
- Scope filtering inline on every read

### `MongoMemoryAdapter`

```ts
class MongoMemoryAdapter implements IMemoryStore {
  constructor(opts: MongoMemoryAdapterOptions);
}

interface MongoMemoryAdapterOptions {
  entities: IMongoCollectionLike<IEntity>;
  facts: IMongoCollectionLike<IFact>;
  useNativeGraphLookup?: boolean;             // default false; requires facts.aggregate
  vectorIndexName?: string;                   // Atlas Vector Search index name
  vectorCandidateMultiplier?: number;         // default 10
  factsCollectionName?: string;               // required for useNativeGraphLookup
  defaultPageSize?: number;                   // default 100
}
```

Works identically with the raw mongodb driver (`RawMongoCollection`) and Meteor (`MeteorMongoCollection`). See [Collection wrappers](#collection-wrappers).

### Collection wrappers

The adapter depends only on `IMongoCollectionLike` — a narrow structural contract. Two built-in wrappers, plus users can implement their own.

#### `IMongoCollectionLike`

```ts
interface IMongoCollectionLike<T extends { id: string }> {
  // Writes
  insertOne(doc: T): Promise<void>;
  insertMany(docs: T[]): Promise<void>;
  updateOne(filter, update, opts?): Promise<MongoUpdateResult>;
  deleteOne(filter): Promise<void>;
  deleteMany(filter): Promise<void>;
  bulkWrite?(ops): Promise<void>;

  // Reads
  findOne(filter, opts?): Promise<T | null>;
  find(filter, opts?): Promise<T[]>;
  countDocuments(filter): Promise<number>;
  aggregate?(pipeline): Promise<unknown[]>;

  // Index management
  createIndex?(spec, opts?): Promise<void>;

  // Transactions
  withTransaction?<R>(fn: () => Promise<R>): Promise<R>;
}
```

#### `RawMongoCollection`

Wraps a `mongodb`-driver `Collection`. Supports all optional capabilities. Accepts an optional `MongoClient` for transactions.

```ts
class RawMongoCollection<T> implements IMongoCollectionLike<T> {
  constructor(col: RawMongoDriverCollection<T>, client?: RawMongoClientLike);
}
```

#### `MeteorMongoCollection`

Wraps a Meteor `Mongo.Collection`. **Writes flow through Meteor's async API** (`insertAsync`, `updateAsync`, `removeAsync`) — preserving reactive publications. Complex reads (`aggregate`) fall back to `rawCollection()`.

```ts
class MeteorMongoCollection<T> implements IMongoCollectionLike<T> {
  constructor(col: MeteorCollectionLike<T>);
}
```

### `ensureIndexes`

One-time index setup helper.

```ts
ensureIndexes(args: { entities; facts }): Promise<void>;
```

Creates:
- Entities: identifier lookup, list-by-type, primary-key, task metadata, event metadata.
- Facts: by-subject (with observedAt sort), by-object, by-context, recent-by-predicate, primary-key.

No-op if the collection doesn't implement `createIndex`.

### Writing your own adapter

Minimum required operations:
- Entity CRUD + optimistic concurrency on `updateEntity`; adapter-assigned ids on `createEntity`
- Identifier lookup
- Fact CRUD + all filter options (`subjectId`, `objectId`, `contextId`, `touchesEntity`, `predicate`, `kind`, `archived`, `asOf`, `minConfidence`, temporal)
- Scope filtering on every read
- `metadataFilter` on `listEntities`
- `searchEntities` (case-insensitive substring on displayName, aliases, identifier values)

Optional capabilities (detected by MemorySystem via duck-typing):
- `traverse` — otherwise generic BFS is used
- `semanticSearch` — otherwise semantic tier is unavailable

See `src/memory/adapters/inmemory/InMemoryAdapter.ts` as the reference implementation.

---

## Entity Resolution

### `EntityResolver`

Usually called via `MemorySystem.resolveEntity` / `upsertEntityBySurface`. Direct use is possible for custom orchestration.

```ts
class EntityResolver {
  constructor(hooks: ResolverMemoryHooks, config?: EntityResolutionConfig);
  resolve(query, scope, opts?): Promise<EntityCandidate[]>;
  upsertBySurface(input, scope, opts?): Promise<UpsertBySurfaceResult>;
}

interface EntityResolutionConfig {
  autoResolveThreshold?: number;       // default 0.90 (conservative)
  minFuzzyRatio?: number;              // default 0.85
  enableIdentityEmbedding?: boolean;   // default true
}
```

### `fuzzy` helpers

```ts
function normalizedLevenshteinRatio(a: string, b: string): number;  // 0..1
function normalizeSurface(s: string): string;
```

Normalization:
- lowercase
- strip non-alphanumeric (except whitespace)
- strip corporate suffixes (`Inc`, `Corp`, `LLC`, `Ltd`, `Limited`, `GmbH`, `S.A.`, `PLC`, `Corporation`)
- collapse whitespace

So `"Microsoft Inc."` and `"MICROSOFT"` normalize to `"microsoft"`.

### `buildIdentityString`

```ts
function buildIdentityString(args: {
  type: string;
  displayName: string;
  aliases: string[];
  identifiers: Identifier[];
}): string;
```

Produces the short string that's embedded for `IEntity.identityEmbedding`. Format: `"<type>: <displayName> | aliases: <top 3> | ids: <up to 3 primary+secondary>"`.

---

## Integration Layer

Helpers that bridge oneringai Connectors into the memory layer's `IEmbedder` / `IProfileGenerator`. Optional — you can pass your own impls directly.

### `ConnectorEmbedder`

Adapts `IEmbeddingProvider` (wired via a named `Connector`) to `IEmbedder`.

```ts
class ConnectorEmbedder implements IEmbedder {
  constructor(config: ConnectorEmbedderConfig);
  static withProvider(args: { provider; model; dimensions; requestedDimensions? }): ConnectorEmbedder;
  readonly dimensions: number;
  embed(text): Promise<number[]>;
  embedBatch(texts): Promise<number[][]>;
}

interface ConnectorEmbedderConfig {
  connector: string;              // registered connector name
  model: string;                  // e.g. 'text-embedding-3-small'
  dimensions: number;             // matches model output (or MRL-reduced target)
  requestedDimensions?: number;   // passed to provider for MRL models
}
```

Connector must be registered via `Connector.create(...)` before constructing.

### `ConnectorProfileGenerator`

Adapts an LLM connector + model into `IProfileGenerator` via `Agent.runDirect` with JSON response format.

```ts
class ConnectorProfileGenerator implements IProfileGenerator {
  constructor(config: ConnectorProfileGeneratorConfig);
  static withAgent(args: { agent; promptTemplate?; temperature?; maxOutputTokens? }): ConnectorProfileGenerator;
  generate(entity, atomicFacts, priorProfile, targetScope): Promise<{ details; summaryForEmbedding }>;
  destroy(): void;
}

interface ConnectorProfileGeneratorConfig {
  connector: string;
  model: string;                                     // e.g. 'claude-sonnet-4-6'
  promptTemplate?: (ctx: PromptContext) => string;   // override defaultProfilePrompt
  temperature?: number;                              // default 0.3
  maxOutputTokens?: number;                          // default 1200
}
```

Parses the response as JSON with `{details, summaryForEmbedding}`. Falls back gracefully (using the raw output as `details`) if parsing fails.

### `createMemorySystemWithConnectors`

One-call factory.

```ts
function createMemorySystemWithConnectors(
  config: MemorySystemWithConnectorsConfig,
): MemorySystem;

type MemorySystemWithConnectorsConfig = Omit<MemorySystemConfig, 'embedder' | 'profileGenerator'> & {
  connectors?: {
    embedding?: ConnectorEmbedderConfig;
    profile?: ConnectorProfileGeneratorConfig;
  };
};
```

### `defaultProfilePrompt`

Default prompt for profile regeneration. Takes entity + atomic facts + prior profile + target scope, returns structured JSON. Override via `ConnectorProfileGeneratorConfig.promptTemplate`.

```ts
function defaultProfilePrompt(ctx: PromptContext): string;
```

---

## Extraction Helpers

For the "raw signal → structured memory" pipeline.

### `defaultExtractionPrompt`

```ts
function defaultExtractionPrompt(ctx: ExtractionPromptContext): string;

interface ExtractionPromptContext {
  signalText: string;
  signalSourceDescription?: string;       // e.g. "email from john@acme.com"
  targetScope?: ScopeFields;
  knownEntities?: IEntity[];              // pre-loaded candidates to hint at
  referenceDate?: Date;                   // for relative dates like "next Friday"
}
```

Instructs the LLM to emit JSON with `mentions` (local label → surface + type + identifiers + aliases) and `facts` (triples referencing mention labels, not entity IDs).

### `ExtractionResolver`

Converts raw LLM output into resolved entities + persisted facts.

```ts
class ExtractionResolver {
  constructor(memory: MemorySystem);

  resolveAndIngest(
    output: ExtractionOutput,
    sourceSignalId: string,
    scope: ScopeFilter,
    opts?: ExtractionResolverOptions,
  ): Promise<IngestionResult>;
}

interface ExtractionOutput {
  mentions: Record<string, ExtractionMention>;   // label → mention
  facts: ExtractionFactSpec[];
}

interface ExtractionMention {
  surface: string;
  type: string;
  identifiers?: Identifier[];
  aliases?: string[];
}

interface ExtractionFactSpec {
  subject: string;                         // mention label
  predicate: string;
  object?: string;                         // mention label (relational)
  value?: unknown;                         // attribute value
  details?: string;
  summaryForEmbedding?: string;
  confidence?: number;
  importance?: number;
  contextIds?: string[];                   // mention labels
  kind?: FactKind;                         // default 'atomic'
  validFrom?: string | Date;
  validUntil?: string | Date;
  observedAt?: string | Date;
}

interface IngestionResult {
  entities: Array<{
    label: string;
    entity: IEntity;
    resolved: boolean;
    mergeCandidates: EntityCandidate[];
  }>;
  facts: IFact[];
  mergeCandidates: Array<{
    label: string;
    surface: string;
    candidates: EntityCandidate[];
  }>;
  unresolved: Array<{ where: string; reason: string }>;
}
```

**Flow:**
1. For each mention: `memory.upsertEntityBySurface(...)`. Passes already-resolved sibling labels as `contextEntityIds` for disambiguation.
2. For each fact: translates `subject`/`object`/`contextIds` from mention labels to entity IDs; attaches `sourceSignalId`; calls `memory.addFact`.
3. Returns per-item successes + errors.

One bad mention or fact does NOT abort the rest — errors collected in `unresolved`.

---

## Ranking

```ts
function scoreFact(fact: IFact, config: RankingConfig, now: Date): number;
function rankFacts(facts: IFact[], config: RankingConfig, now: Date): IFact[];

interface RankingConfig {
  predicateWeights?: Record<string, number>;     // default 1.0
  recencyHalfLifeDays?: number;                  // default 90
  minConfidence?: number;                        // default 0.2
}
```

**Formula:** `score = confidence × recencyDecay × predicateWeight × importanceMultiplier`

Where:
- `recencyDecay = 0.5 ^ (ageDays / halfLifeDays)` — age from `observedAt` (fallback `createdAt`).
- `importanceMultiplier = 0.3 + importance × 1.4` — default importance 0.5 → multiplier 1.0. Max (importance 1.0) → 1.7×.
- If `confidence < minConfidence`, score is 0.

`rankFacts` returns the sorted list descending, with zero-scored facts filtered out.

---

## Predicate Registry

See [MEMORY_PREDICATES.md](./MEMORY_PREDICATES.md) for usage recipes and walkthroughs. This section is the API reference.

Pluggable vocabulary for fact predicates. Optional — when no registry is configured, predicates remain free-form strings (canonicalization is a no-op). When a registry is attached, `addFact` gains:

- **Canonicalization.** `worksAt`, `works-at`, `employed_by` all collapse to `works_at` before storage.
- **Default importance.** When the caller omits `importance`, the registry's `defaultImportance` is applied (falls back to ranking default 0.5 otherwise).
- **Default `isAggregate`.** For aggregate predicates like `interaction_count`.
- **Auto-supersede for `singleValued` predicates.** Writing `current_title` twice for the same subject auto-archives the first. Disable globally via `predicateAutoSupersede: false`.
- **Ranking weights.** Registry `rankingWeight` values fold into `RankingConfig.predicateWeights`. User-supplied weights win on collision.
- **LLM prompt rendering.** `registry.renderForPrompt()` produces a markdown vocabulary block for injection into extraction prompts.

### Shape

```ts
interface PredicateDefinition {
  name: string;                         // canonical snake_case — the id
  description: string;
  category: string;                     // 'identity' | 'task' | 'communication' | …
  payloadKind?: 'relational' | 'attribute' | 'narrative';
  subjectTypes?: string[];
  objectTypes?: string[];
  inverse?: string;                     // e.g. reports_to ↔ manages
  aliases?: string[];                   // alternate surface forms → this
  defaultImportance?: number;           // 0..1
  rankingWeight?: number;               // default 1.0 in RankingConfig
  isAggregate?: boolean;                // updates in place; mutually exclusive with singleValued
  singleValued?: boolean;               // auto-supersede prior on new write
  examples?: string[];
}

class PredicateRegistry {
  static standard(): PredicateRegistry;                // 51-predicate starter set
  static empty(): PredicateRegistry;

  register(def: PredicateDefinition): this;
  registerAll(defs: PredicateDefinition[]): this;
  unregister(name: string): this;

  get(nameOrAlias: string): PredicateDefinition | null;
  has(nameOrAlias: string): boolean;

  canonicalize(input: string): string;

  list(filter?: { categories?: string[]; subjectType?: string }): PredicateDefinition[];
  categories(): string[];

  renderForPrompt(opts?: {
    categories?: string[];
    subjectType?: string;
    maxPerCategory?: number;                            // default 5
  }): string;

  toRankingWeights(base?: Record<string, number>): Record<string, number>;
}
```

### Standard library

`PredicateRegistry.standard()` returns a fresh registry with 51 predicates across 9 categories:

| Category | Predicates |
|---|---|
| identity | works_at, reports_to, current_title, current_role, located_in, is_member_of, founded |
| organizational | part_of, subsidiary_of, manages, owns, acquired, merged_with |
| task | assigned_task, committed_to, completed, created, reviewed, approved, blocked_by, depends_on, has_due_date, has_priority |
| state | state_changed, has_status, current_status |
| communication | emailed, called, messaged, met_with, mentioned, cc_ed, responded_to, interaction_count *(aggregate)* |
| observation | observed_topic, expressed_concern, expressed_interest, acknowledged, noted |
| temporal | occurred_on, scheduled_for, started_on, ended_on |
| document | profile, biography, memo, meeting_notes, research_note |
| social | knows, works_with, colleague_of |

`singleValued`: `current_title`, `current_role`, `has_due_date`, `has_priority`, `has_status`, `current_status`, `started_on`, `ended_on`. `isAggregate`: `interaction_count`.

**Note:** `profile` is consumed by `MemorySystem.getContext` (document fact with predicate=`profile` is the canonical per-entity profile). Do not rename.

### Usage

```ts
import { MemorySystem, PredicateRegistry } from '@everworker/oneringai';

// Use the standard library as-is.
const memory = new MemorySystem({
  store,
  predicates: PredicateRegistry.standard(),
});

// Extend the standard library with your own predicates.
const custom = PredicateRegistry.standard();
custom.register({
  name: 'invested_in',
  description: 'Investor relationship.',
  category: 'task',
  rankingWeight: 1.3,
  defaultImportance: 0.9,
});
const memory2 = new MemorySystem({ store, predicates: custom });

// Build your own vocabulary from scratch.
const domain = PredicateRegistry.empty().registerAll([
  { name: 'patient_of', description: 'Patient-doctor relation.', category: 'clinical' },
  // ...
]);
const memory3 = new MemorySystem({ store, predicates: domain, predicateMode: 'strict' });
```

### Strict vs. permissive mode

- **permissive** (default): unknown predicates are accepted and canonicalized; they show up in `IngestionResult.newPredicates` for vocabulary-drift review.
- **strict**: `addFact` throws when the predicate is not in the registry. Strict rejections through `ExtractionResolver` land in `IngestionResult.unresolved` AND `newPredicates`.

Setting `predicateMode: 'strict'` without a `predicates` registry throws at `MemorySystem` construction.

### Auto-supersession scope isolation

Auto-supersession for `singleValued` predicates is scope-bounded: it only archives prior facts visible to the caller. A user-scoped write cannot implicitly archive a group-scoped prior (and vice-versa). This means a `singleValued` predicate can have multiple per-scope "current" values — intentional for isolation, surprising if unexpected.

### Prompt rendering

```ts
const prompt = defaultExtractionPrompt({
  signalText,
  predicateRegistry: PredicateRegistry.standard(),
  maxPredicatesPerCategory: 5,         // default
});
```

The rendered block is appended to the default extraction prompt. LLM output predicates canonicalize + dedupe at ingest time; unknowns surface in `IngestionResult.newPredicates`.

---

## Events

Optional `onChange` callback fires on every state-changing operation. Fire-and-forget — listener errors never impact the data path.

```ts
type ChangeEvent =
  | { type: 'entity.upsert'; entity: IEntity; created: boolean }
  | { type: 'entity.archive'; entityId: EntityId }
  | { type: 'entity.merge'; winnerId: EntityId; loserId: EntityId }
  | { type: 'fact.add'; fact: IFact }
  | { type: 'fact.archive'; factId: FactId }
  | { type: 'fact.supersede'; oldId: FactId; newId: FactId }
  | { type: 'profile.regenerate'; entityId: EntityId; scope: ScopeFields; factId: FactId };
```

---

## Errors

Exported error classes:

| Class | From | Meaning |
|---|---|---|
| `ScopeInvariantError` | `MemorySystem` | Fact scope is broader than subject entity's scope |
| `SemanticSearchUnavailableError` | `MemorySystem` | No embedder or no `store.semanticSearch` |
| `ProfileGeneratorMissingError` | `MemorySystem` | `regenerateProfile` called without a generator |
| `OptimisticConcurrencyError` | `InMemoryAdapter` | Version mismatch on `updateEntity` |
| `ScopeViolationError` | `InMemoryAdapter` | Write target not visible to caller |
| `MongoOptimisticConcurrencyError` | `MongoMemoryAdapter` | Version mismatch; duplicate key on insert |

Best practice: callers catch `MongoOptimisticConcurrencyError` / `OptimisticConcurrencyError` and retry with a fresh read of the entity.

---

## Type Reference

Full list of exported types:

**Entities + facts**
- `EntityId`, `FactId`, `FactKind`
- `IEntity`, `IFact`, `Identifier`
- `NewEntity`, `NewFact` (input shapes for `createEntity` / `createFact`)
- `ScopeFields`, `ScopeFilter`

**Store**
- `IMemoryStore`
- `EntityListFilter`, `EntitySearchOptions`, `ListOptions`
- `FactFilter`, `FactOrderBy`, `FactQueryOptions`
- `Page<T>`
- `SemanticSearchOptions`

**Retrieval**
- `EntityView`, `ContextOptions`, `ContextTier`
- `RelatedTask`, `RelatedEvent`
- `Neighborhood`, `TraversalOptions`
- `UpsertEntityResult`

**Resolution**
- `EntityCandidate`
- `ResolveEntityQuery`, `ResolveEntityOptions`
- `UpsertBySurfaceInput`, `UpsertBySurfaceOptions`, `UpsertBySurfaceResult`
- `EntityResolutionConfig`

**Extension points**
- `IEmbedder`, `IProfileGenerator`
- `IRuleEngine`, `IScopedMemoryView`

**Integration**
- `ConnectorEmbedderConfig`, `ConnectorProfileGeneratorConfig`
- `MemoryConnectorsConfig`, `MemorySystemWithConnectorsConfig`
- `PromptContext` (profile prompt), `ExtractionPromptContext`
- `ExtractionMention`, `ExtractionFactSpec`, `ExtractionOutput`
- `IngestionResolvedEntity`, `IngestionError`, `IngestionResult`
- `ExtractionResolverOptions`

**Mongo adapter**
- `IMongoCollectionLike`, `MongoFilter`, `MongoFindOptions`, `MongoUpdate`, `MongoUpdateOptions`, `MongoUpdateResult`, `MongoSort`, `MongoBulkOp`
- `RawMongoDriverCollection`, `RawMongoClientLike`
- `MeteorCollectionLike`
- `MongoMemoryAdapterOptions`
- `EnsureIndexesArgs`

**Events + config**
- `ChangeEvent`
- `MemorySystemConfig`, `EmbeddingQueueConfig`, `RankingConfig`

---

*For usage patterns, end-to-end examples, and architectural guidance, see [MEMORY_GUIDE.md](./MEMORY_GUIDE.md).*
