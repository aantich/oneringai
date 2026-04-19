# Memory Predicate Library — Usage Guide

The memory layer ships with a pluggable **predicate registry** that controls the vocabulary used for facts. Without a registry, predicates are free-form strings. With one, you get canonicalization, sensible defaults, auto-supersession for single-valued predicates, ranking weights, and an LLM prompt that teaches your vocabulary to the model.

This guide covers the recipes. For the API reference, see [MEMORY_API.md § Predicate Registry](./MEMORY_API.md#predicate-registry).

---

## Table of Contents

1. [When to use a registry](#when-to-use-a-registry)
2. [Three setup patterns](#three-setup-patterns)
3. [The standard library](#the-standard-library)
4. [Extending the standard library](#extending-the-standard-library)
5. [Building a custom vocabulary](#building-a-custom-vocabulary)
6. [Canonicalization — what it does](#canonicalization--what-it-does)
7. [`singleValued` auto-supersession](#singlevalued-auto-supersession)
8. [`isAggregate` counters](#isaggregate-counters)
9. [Feeding the vocabulary to the LLM](#feeding-the-vocabulary-to-the-llm)
10. [Drift monitoring — `newPredicates`](#drift-monitoring--newpredicates)
11. [Strict mode](#strict-mode)
12. [Ranking weights](#ranking-weights)
13. [Recipes](#recipes)
14. [Migration & gotchas](#migration--gotchas)

---

## When to use a registry

Use a registry when any of these matter:

- **LLM vocabulary drift.** Without one, the model will emit `worksAt`, `works_at`, `works-at`, `employed_by`, `works_for` for the same concept across different extractions. Ranking, aggregation, and querying won't unify them.
- **Single-valued attributes.** Facts like `current_title` or `has_status` should supersede on new writes, not accumulate. The registry handles this automatically.
- **Importance defaults.** `works_at` is identity-level (importance 1.0); `mentioned` is ephemeral (0.3). Centralizing these defaults avoids every caller passing `importance` manually.
- **Ranking weights.** Some predicates should outrank others in top-facts ranking regardless of recency. The registry lets you set these once.
- **LLM prompt hygiene.** Dumping a list of canonical names into the extraction prompt dramatically improves model consistency.

If none of these apply, skip the registry — the memory layer works fine without one.

---

## Three setup patterns

### Pattern 1 — use the standard library as-is

```ts
import { MemorySystem, PredicateRegistry, InMemoryAdapter } from '@everworker/oneringai';

const memory = new MemorySystem({
  store: new InMemoryAdapter(),
  predicates: PredicateRegistry.standard(),
});
```

51 predicates across 9 categories. Good starting point for general knowledge-graph use cases (people, orgs, tasks, communications).

### Pattern 2 — extend the standard library with your domain

```ts
const registry = PredicateRegistry.standard();
registry.register({
  name: 'invested_in',
  description: 'Investor relationship between person/org and company.',
  category: 'financial',
  subjectTypes: ['person', 'organization'],
  objectTypes: ['organization'],
  defaultImportance: 0.9,
  rankingWeight: 1.3,
  aliases: ['investor_of', 'funded'],
});
registry.register({
  name: 'board_member_of',
  description: 'Person sits on an organization\'s board.',
  category: 'financial',
  subjectTypes: ['person'],
  objectTypes: ['organization'],
  inverse: 'has_board_member',
  defaultImportance: 1.0,
  rankingWeight: 1.4,
});

const memory = new MemorySystem({ store, predicates: registry });
```

### Pattern 3 — fully custom vocabulary + strict mode

```ts
const clinical = PredicateRegistry.empty().registerAll([
  { name: 'patient_of', description: 'Patient-doctor relation.', category: 'clinical' },
  { name: 'prescribed', description: 'Prescription event.', category: 'clinical', defaultImportance: 0.8 },
  { name: 'diagnosed_with', description: 'Clinical diagnosis.', category: 'clinical', defaultImportance: 1.0 },
  { name: 'admitted_to', description: 'Hospital admission.', category: 'clinical' },
  { name: 'discharged_from', description: 'Discharge event.', category: 'clinical' },
]);

const memory = new MemorySystem({
  store,
  predicates: clinical,
  predicateMode: 'strict', // reject anything outside this vocabulary
});
```

---

## The standard library

```ts
PredicateRegistry.standard()
```

Returns a fresh instance (safe to mutate). 51 predicates in 9 categories:

| Category | Predicates |
|---|---|
| **identity** | `works_at`, `reports_to`, `current_title`, `current_role`, `located_in`, `is_member_of`, `founded` |
| **organizational** | `part_of`, `subsidiary_of`, `manages`, `owns`, `acquired`, `merged_with` |
| **task** | `assigned_task`, `committed_to`, `completed`, `created`, `reviewed`, `approved`, `blocked_by`, `depends_on`, `has_due_date`, `has_priority` |
| **state** | `state_changed`, `has_status`, `current_status` |
| **communication** | `emailed`, `called`, `messaged`, `met_with`, `mentioned`, `cc_ed`, `responded_to`, `interaction_count` *(aggregate)* |
| **observation** | `observed_topic`, `expressed_concern`, `expressed_interest`, `acknowledged`, `noted` |
| **temporal** | `occurred_on`, `scheduled_for`, `started_on`, `ended_on` |
| **document** | `profile`, `biography`, `memo`, `meeting_notes`, `research_note` |
| **social** | `knows`, `works_with`, `colleague_of` |

Special predicates with auto-behavior:

- **`singleValued`** (writes supersede prior): `current_title`, `current_role`, `has_due_date`, `has_priority`, `has_status`, `current_status`, `started_on`, `ended_on`.
- **`isAggregate`** (updates in place): `interaction_count`.
- **`profile`**: consumed by `MemorySystem.getContext` as the canonical per-entity profile. Don't rename.

---

## Extending the standard library

Start from standard, register your domain predicates:

```ts
const r = PredicateRegistry.standard();
r.register({ name: 'investor_in', description: '…', category: 'financial', rankingWeight: 1.3 });
r.register({ name: 'customer_of', description: '…', category: 'commercial', rankingWeight: 1.2 });
```

Override a standard predicate by unregistering + re-registering:

```ts
r.unregister('works_at');
r.register({
  name: 'works_at',
  description: 'Employment — customized for your domain.',
  category: 'identity',
  aliases: ['worksAt', 'employed_by', 'works_for'], // add the extra form your LLM produces
  defaultImportance: 1.0,
  rankingWeight: 2.0, // bump it up
});
```

---

## Building a custom vocabulary

For domains where the standard library is noise (legal, clinical, bioinformatics, etc.), start from `empty()` and define only what you need:

```ts
const legal = PredicateRegistry.empty().registerAll([
  { name: 'represents', description: 'Attorney-client representation.', category: 'legal' },
  { name: 'filed', description: 'Legal filing action.', category: 'legal' },
  { name: 'settled_with', description: 'Settlement agreement.', category: 'legal', defaultImportance: 0.9 },
  { name: 'plaintiff_in', description: 'Plaintiff role in case.', category: 'legal' },
  { name: 'defendant_in', description: 'Defendant role in case.', category: 'legal' },
]);
```

Combine with `predicateMode: 'strict'` to prevent the LLM from inventing general-purpose predicates outside your domain.

---

## Canonicalization — what it does

When a registry is attached, `addFact` normalizes the predicate before storage:

| Input | Stored as |
|---|---|
| `works_at` | `works_at` (unchanged) |
| `worksAt` | `works_at` (camelCase → snake) |
| `works-at` | `works_at` (dash → snake) |
| `Works At` | `works_at` (whitespace → snake) |
| `WORKS_AT` | `works_at` (lowercased) |
| `employed_by` | `works_at` (alias lookup) |
| `unknown_thing` | `unknown_thing` (unknown passes through) |

All downstream reads, ranking, and aggregation see the canonical form.

---

## `singleValued` auto-supersession

A `singleValued: true` predicate means "the subject has exactly one current value for this predicate." When you write a new value, the prior fact is automatically archived and the new one `supersedes` it.

```ts
const alice = await memory.upsertEntity({
  type: 'person',
  displayName: 'Alice',
  identifiers: [{ kind: 'email', value: 'a@a.com' }],
}, {});

// First write
const first = await memory.addFact(
  { subjectId: alice.entity.id, predicate: 'current_title', kind: 'atomic', value: 'Engineer' },
  {},
);

// Second write — first is auto-archived; second has supersedes=first.id
const second = await memory.addFact(
  { subjectId: alice.entity.id, predicate: 'current_title', kind: 'atomic', value: 'Senior Engineer' },
  {},
);
// second.supersedes === first.id
// first is archived; queries return only second.
```

### Disable auto-supersession globally

```ts
new MemorySystem({
  store,
  predicates: registry,
  predicateAutoSupersede: false, // append-only semantics for all singleValued predicates
});
```

### Scope isolation

Auto-supersession is scope-bounded. A group-scoped write can't archive a user-scoped prior (and vice versa). This means `current_title` may have multiple "current" values across scopes — intentional, not a bug.

```ts
// User A sets current_title
await memory.addFact({ subjectId: alice.id, predicate: 'current_title', kind: 'atomic', value: 'Engineer', ownerId: 'userA' }, { userId: 'userA' });

// User B sets current_title — does NOT supersede A's (different scope)
await memory.addFact({ subjectId: alice.id, predicate: 'current_title', kind: 'atomic', value: 'Manager', ownerId: 'userB' }, { userId: 'userB' });

// A still sees "Engineer". B sees "Manager". Both coexist.
```

---

## `isAggregate` counters

An `isAggregate` predicate is meant to update in place rather than supersede. The standard library has `interaction_count`. You can treat it as a rolling counter:

```ts
await memory.addFact(
  {
    subjectId: user.id,
    predicate: 'interaction_count',
    kind: 'atomic',
    objectId: customer.id,
    value: 1,
  },
  {},
);
```

Note: the memory layer does not implement counter semantics itself — you increment the value. The `isAggregate` flag documents intent and ensures the predicate doesn't accidentally get marked `singleValued` (which would auto-archive the prior). Callers integrating with aggregation pipelines can inspect `fact.isAggregate` and aggregate appropriately.

---

## Feeding the vocabulary to the LLM

Pass the registry into the extraction prompt so the model learns the canonical names:

```ts
import { defaultExtractionPrompt } from '@everworker/oneringai';

const prompt = defaultExtractionPrompt({
  signalText: emailBody,
  signalSourceDescription: 'email from alice@acme.com',
  predicateRegistry: registry,
  maxPredicatesPerCategory: 5, // cap to keep prompt token budget in check (default 5)
});
```

The rendered block looks like:

```
## Predicate vocabulary
Use these predicate names where applicable. If none fits, invent a snake_case one.

### identity
- `works_at` — Person-to-organization employment relationship. (inverse: `employs`) (aliases: `worksAt`, `employed_by`, `employee_of`)
  e.g. (John, works_at, Acme)
- `reports_to` — Management chain — subject reports to object. (inverse: `manages`)
  e.g. (John, reports_to, Jane)
…
```

The LLM can still invent predicates outside the vocabulary — see [drift monitoring](#drift-monitoring--newpredicates).

### Narrow the prompt to relevant categories

For a support-ticket signal, you probably don't need `organizational` predicates. Filter:

```ts
const prompt = defaultExtractionPrompt({
  signalText,
  predicateRegistry: registry,
  // Only include the categories the LLM needs for this extraction
  maxPredicatesPerCategory: 8,
  // Use registry.renderForPrompt directly if you want finer control:
  // predicateRegistry renders inside the prompt automatically,
  // or pre-render yourself and swap in a custom prompt template.
});
```

For advanced prompt shaping, render directly:

```ts
const block = registry.renderForPrompt({
  categories: ['task', 'communication', 'state'],
  subjectType: 'person',
  maxPerCategory: 10,
});
// inject `block` into your custom prompt
```

---

## Drift monitoring — `newPredicates`

When the LLM emits a predicate not in your registry, it's canonicalized and written anyway (permissive mode). The extraction result surfaces these for review:

```ts
const result = await resolver.resolveAndIngest(llmOutput, 'signal_123', scope);

if (result.newPredicates.length > 0) {
  // The LLM invented these. Options:
  //   - Promote frequent ones into the registry.
  //   - Tighten the prompt with better examples / explicit warnings.
  //   - Accept them as long-tail (they still get canonicalized + stored).
  await logToDashboard({ driftPredicates: result.newPredicates, signalId: 'signal_123' });
}
```

`newPredicates` is always deduplicated by canonical form and empty when no registry is configured.

---

## Strict mode

Reject any fact whose canonicalized predicate is not in the registry:

```ts
new MemorySystem({
  store,
  predicates: registry,
  predicateMode: 'strict',
});

// This throws:
await memory.addFact({ subjectId, predicate: 'mystery_thing', kind: 'atomic', value: 'x' }, {});
// Error: addFact: predicate 'mystery_thing' (canonical: 'mystery_thing') not in registry.
```

Through `ExtractionResolver`, rejections land in `result.unresolved` (via the existing try/catch) AND `result.newPredicates`:

```ts
const result = await resolver.resolveAndIngest(llmOutput, 'signal_123', scope);
// result.unresolved[i] — has reason "not in registry"
// result.newPredicates — same predicates listed for drift tracking
```

**Strict mode requires a registry.** Setting `predicateMode: 'strict'` without a `predicates` registry throws at `MemorySystem` construction.

**When to use strict:**
- Closed domain (clinical, legal) where unknown predicates indicate a prompt bug.
- Production with a well-tuned vocabulary and low drift tolerance.

**When to stay permissive:**
- Exploratory / general knowledge graph.
- Active vocabulary iteration (let the LLM suggest predicates, promote frequent ones).

---

## Ranking weights

Registry `rankingWeight` values feed into `RankingConfig.predicateWeights`. Higher weight → higher score in `topFacts` ranking. User-supplied weights always win on collision.

```ts
// Registry sets works_at → 1.5
// User overrides works_at → 3.0

const memory = new MemorySystem({
  store,
  predicates: PredicateRegistry.standard(),
  topFactsRanking: {
    predicateWeights: { works_at: 3.0 }, // wins over registry's 1.5
  },
});
```

The ranking formula: `score = confidence × recency × predicateWeight × importanceMultiplier`. See [MEMORY_API.md § Ranking](./MEMORY_API.md#ranking).

---

## Recipes

### R1 — Inspect what's in the registry

```ts
registry.list();                             // all definitions
registry.list({ categories: ['task'] });     // filter by category
registry.list({ subjectType: 'person' });    // filter by subject-type hint
registry.categories();                       // list of all categories
registry.get('worksAt');                     // lookup (accepts any form)
registry.has('employed_by');                 // boolean
```

### R2 — Canonicalize a predicate outside `addFact`

Useful when you have a predicate string from user input and want to canonicalize before a query:

```ts
const canonical = memory.canonicalizePredicate('worksAt'); // → 'works_at'
const facts = await memory.findFacts({ predicate: canonical, subjectId }, ...);
```

Also:

```ts
memory.hasPredicateRegistry();       // boolean
memory.getPredicateDefinition('works_at'); // full PredicateDefinition | null
```

### R3 — Register a batch of domain predicates from a config file

```ts
import myPredicates from './my-vocabulary.json';

const r = PredicateRegistry.standard();
r.registerAll(myPredicates);
```

### R4 — Export the registry for documentation

```ts
// Print a markdown-formatted vocabulary reference for your docs:
console.log(registry.renderForPrompt({ maxPerCategory: 999 }));
```

### R5 — Reset (unregister all, keep instance)

```ts
for (const def of registry.list()) registry.unregister(def.name);
```

Or just create a fresh one: `PredicateRegistry.empty()`.

---

## Migration & gotchas

### Alias ↔ canonical name collisions rejected at register time

You cannot register an alias that's already another predicate's canonical name, or another alias, or register a name that's already an alias. The registry throws on collision — catch it at config-load time, not at runtime.

### `isAggregate` + `singleValued` are mutually exclusive

A predicate can't be both an aggregate counter and a single-valued attribute. The registry throws at register time if you try.

### Canonicalization doesn't reach queries automatically

`memory.findFacts({ predicate: 'worksAt' })` will NOT match facts stored as `works_at`. The registry's canonicalization runs on the **write** path (`addFact`). For queries, call `memory.canonicalizePredicate(input)` yourself, or use canonical names directly.

Rationale: `findFacts` is adapter-level; canonicalization is a MemorySystem-level concern. Adding it to every read would couple layers.

### The `profile` predicate is load-bearing

`MemorySystem.getContext` looks for `predicate: 'profile', kind: 'document'`. The standard registry ships this predicate with that exact name. If you unregister it or rename it, profile retrieval breaks.

### Freshly-created entity vs. auto-supersede timing

Auto-supersede does a synchronous `findFacts` for the prior visible fact for `(subject, predicate)`. If two concurrent `addFact` calls arrive for the same `singleValued` predicate at the same subject, both may see "no prior" and write duplicates. For strict correctness under concurrency, serialize writes for the same `(subject, predicate)` at the caller layer. In practice this rarely matters (single-process Node, await boundaries).

---

## See also

- [MEMORY_API.md § Predicate Registry](./MEMORY_API.md#predicate-registry) — API reference.
- [MEMORY_GUIDE.md § Controlling the predicate vocabulary](./MEMORY_GUIDE.md#controlling-the-predicate-vocabulary) — context within the broader memory-layer narrative.
- [MEMORY_GUIDE.md § The LLM extraction pipeline](./MEMORY_GUIDE.md#the-llm-extraction-pipeline) — how predicates flow from LLM → resolver → storage.
