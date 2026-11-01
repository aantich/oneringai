# Memory Signal Ingestion — Usage Guide

The memory layer ships a **signal ingestion pipeline** that turns raw inbound documents (emails, meeting notes, chat messages, tickets, transcripts…) into entities + facts, without ambiguity over who is who.

This guide covers the recipes. For the underlying API, see [MEMORY_API.md](./MEMORY_API.md); for predicate vocabulary, see [MEMORY_PREDICATES.md](./MEMORY_PREDICATES.md).

---

## Table of contents
- [Why signal ingestion](#why-signal-ingestion)
- [Architecture](#architecture)
- [Quick start — plain text](#quick-start--plain-text)
- [Quick start — email](#quick-start--email)
- [Building a custom adapter](#building-a-custom-adapter)
- [Custom extractor (swap the LLM)](#custom-extractor-swap-the-llm)
- [Participant seeds — semantics + caveats](#participant-seeds--semantics--caveats)
- [Pre-resolved labels in the prompt](#pre-resolved-labels-in-the-prompt)
- [Known entities vs pre-resolved labels](#known-entities-vs-pre-resolved-labels)
- [Handling the result](#handling-the-result)
- [Common pitfalls](#common-pitfalls)

---

## Why signal ingestion

Left to its own devices, the LLM will hallucinate identities. "Anton emailed Sarah" — which Anton? If your app just pumps the email body through an extraction prompt, the LLM might emit a mention like `{ surface: "Anton", type: "person" }` with no identifier. The memory layer then can't disambiguate against existing `Anton Antich <anton@everworker.ai>` in the graph.

Email headers already contain the answer: `from: anton@everworker.ai`. The signal pipeline leverages that:

1. **Deterministic seeding.** An adapter extracts participants from metadata (headers, attendee lists, DB joins). Each participant has strong identifiers (email, Slack ID, domain).
2. **Pre-binding.** The memory layer resolves each seed via `upsertEntityBySurface` BEFORE the LLM runs. These entity IDs are locked to local labels `m1`, `m2`, ….
3. **Locked vocabulary.** The extraction prompt renders a "Pre-resolved labels" block instructing the LLM to use those labels verbatim in facts and NOT redeclare them.
4. **LLM does less work.** It only invents labels for entities genuinely new to the signal body. Identity ambiguity for participants is eliminated upstream.

---

## Architecture

```
raw signal → SignalSourceAdapter.extract ┐
                                         │
              ExtractedSignal { text, participants, sourceDescription }
                                         │
                                         ▼
                               SignalIngestor
                                         │
            ┌────────────────────────────┴──────────────┐
            │ 1. seed phase                             │
            │    each participant → upsertEntityBySurface
            │    → PreResolvedBinding[]                 │
            │                                           │
            │ 2. prompt rendering                       │
            │    defaultExtractionPrompt + bindings     │
            │                                           │
            │ 3. extract phase                          │
            │    IExtractor.extract(prompt) → JSON     │
            │                                           │
            │ 4. resolve + write                        │
            │    ExtractionResolver.resolveAndIngest    │
            │      ({ preResolved })                    │
            └────────────────────────────┬──────────────┘
                                         ▼
                                 IngestionResult
```

Two things are pluggable:

| Plug point              | Contract                                          | Stock implementations                          |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `SignalSourceAdapter`   | `extract(raw) => ExtractedSignal`                 | `PlainTextAdapter`, `EmailSignalAdapter`       |
| `IExtractor`            | `extract(prompt) => Promise<ExtractionOutput>`    | `ConnectorExtractor` (wraps Connector + model) |

Both are exported from `oneringai` — write your own for anything.

---

## Quick start — plain text

```ts
import {
  MemorySystem,
  InMemoryAdapter,
  SignalIngestor,
  ConnectorExtractor,
  PlainTextAdapter,
} from 'oneringai';

const store = new InMemoryAdapter();
const memory = new MemorySystem({ store });

const ingestor = new SignalIngestor({
  memory,
  extractor: new ConnectorExtractor({
    connector: 'openai-main',
    model: 'gpt-5-mini',
  }),
  adapters: [new PlainTextAdapter()],
});

const result = await ingestor.ingest({
  kind: 'text',
  raw: { text: 'Jane Smith is the new CTO at Acme Corp.', source: 'onboarding-note' },
  sourceSignalId: 'note_42',
  scope: { groupId: 'org-1' },
});

console.log(result.entities.map((e) => e.entity.displayName));
// → ['Jane Smith', 'Acme Corp']
```

The LLM is in charge of inventing mentions here — plain text carries no metadata.

---

## Quick start — email

```ts
import { SignalIngestor, ConnectorExtractor, EmailSignalAdapter } from 'oneringai';

const ingestor = new SignalIngestor({
  memory,
  extractor: new ConnectorExtractor({ connector: 'anthropic-main', model: 'claude-sonnet-4-6' }),
  adapters: [new EmailSignalAdapter()],   // seeds orgs by default
});

const result = await ingestor.ingest({
  kind: 'email',
  raw: {
    from: { email: 'anton@everworker.ai', name: 'Anton Antich' },
    to:   [{ email: 'sarah@acme.com', name: 'Sarah Chen' }],
    cc:   [{ email: 'bob@acme.com' }],
    subject: 'Q3 planning',
    body: 'Let us lock in the Q3 priorities next week. I will bring the latest roadmap.',
  },
  sourceSignalId: 'gmail_msg_abc123',
  scope: { groupId: 'workspace-1' },
});
```

What happens under the hood:
- `EmailSignalAdapter.extract` produces participants: Anton (person, `email=anton@everworker.ai`), Sarah (person), Bob (person), plus two organization seeds — `everworker.ai` and `acme.com` (GMail / Outlook are filtered out automatically).
- Each seed is upserted → labels bound as `m1 … m5`.
- The prompt tells the LLM "m1 is Anton Antich (from), m2 is Sarah Chen (to), … start new labels at m6."
- The LLM writes facts like `{ subject: "m1", predicate: "will_attend", object: "m6" }` where m6 is a task it discovers in the body.
- `ExtractionResolver` writes those facts against real entity IDs.

BCC is intentionally dropped — it's not forwarded to the extractor or seeded, so you don't accidentally leak a hidden recipient's identity into the LLM's context.

---

## Building a custom adapter

Adapters are trivial — one method, no I/O. Given a Slack message:

```ts
import type { SignalSourceAdapter, ExtractedSignal } from 'oneringai';

interface SlackMessage {
  channel: string;
  userId: string;        // workspace-scoped, e.g. "U07ABCD1234"
  userName: string;
  text: string;
  threadTs?: string;
  mentions?: Array<{ userId: string; userName: string }>;
}

export class SlackMessageAdapter implements SignalSourceAdapter<SlackMessage> {
  readonly kind = 'slack';

  extract(raw: SlackMessage): ExtractedSignal {
    return {
      signalText: raw.text,
      signalSourceDescription: `Slack message in #${raw.channel}`,
      participants: [
        {
          role: 'author',
          type: 'person',
          identifiers: [{ kind: 'slack_id', value: raw.userId }],
          displayName: raw.userName,
        },
        ...(raw.mentions ?? []).map((m) => ({
          role: 'mentioned',
          type: 'person' as const,
          identifiers: [{ kind: 'slack_id', value: m.userId }],
          displayName: m.userName,
        })),
      ],
    };
  }
}

ingestor.registerAdapter(new SlackMessageAdapter());
```

Guidelines:
- **Pure function.** No network, no DB. Fetch data ahead of time, pass it via `raw`.
- **Strong identifiers only.** Seeds need `kind` + `value` that uniquely identify the entity. `slack_id`, `email`, `domain`, `github`, `phone` are good. Display name alone is not an identifier.
- **Don't over-seed.** If a field in metadata isn't someone you'd like in the graph as a first-class entity, don't seed it. A "from: noreply@…" notification sender is spam, not a participant.
- **Subject-line handling.** For email-like sources, prepend the subject to `signalText` so the LLM sees it. Adapter is responsible for shaping the body the LLM reads.

---

## Custom extractor (swap the LLM)

Any object satisfying the `IExtractor` contract works:

```ts
import type { IExtractor, ExtractionOutput } from 'oneringai';

class ProxyExtractor implements IExtractor {
  constructor(private proxyUrl: string, private apiKey: string) {}
  async extract(prompt: string): Promise<ExtractionOutput> {
    const res = await fetch(`${this.proxyUrl}/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify({ prompt }),
    });
    return res.json();
  }
}

const ingestor = new SignalIngestor({
  memory,
  extractor: new ProxyExtractor('https://proxy.internal', process.env.PROXY_KEY!),
});
```

For tests, a mock that returns fixtures is a one-liner:

```ts
const extractor: IExtractor = { async extract() { return { mentions: {}, facts: [] }; } };
```

---

## Participant seeds — semantics + caveats

A `ParticipantSeed` is a hard commitment — "this identifier IS an entity in the graph." Implications:

- **Seeds are upserted before the LLM runs.** If the identifier matches an existing entity via your configured `autoResolveThreshold`, you get that entity back. Otherwise a new one is created.
- **Seeds are always `resolved: true` in the result.** They show up in `IngestionResult.entities` regardless of whether the LLM's output referenced them.
- **Seeds without strong identifiers are rejected.** Seeding on display name alone would bind ambiguously — two people named "Sarah" would collide. The ingestor records a `seed:N` error in `unresolved` and skips the seed instead.
- **Organization seeding is opt-in (default on).** `EmailSignalAdapter` seeds non-free domains as `organization` entities. Free providers (Gmail, Outlook, Yahoo, …) are skipped because their domain doesn't identify a single organization. Pass `seedOrganizations: false` to disable, or `freeEmailProviders: [...]` to override the skip list.

---

## Pre-resolved labels in the prompt

When seeds exist, `defaultExtractionPrompt` renders this block:

```md
## Pre-resolved labels
The following local labels are ALREADY bound to entities in the knowledge graph. Reference them directly in `facts`. DO NOT redeclare them in `mentions`.

- `m1` — from: person "Anton Antich" (email=anton@everworker.ai)
- `m2` — to: person "Sarah Chen" (email=sarah@acme.com)
- `m3` — from-org: organization "everworker.ai" (domain=everworker.ai)

When introducing NEW entities from the signal body, start labels at `m4`.
```

And the "Output format" section already tells the LLM `mentions` is a separate object from `facts`. Between them, well-tuned models respect the contract.

Defensive guarantee: if the LLM ignores the instruction and redeclares `m1` in `mentions`, the `ExtractionResolver` silently skips the duplicate — the pre-resolved binding wins.

---

## Known entities vs pre-resolved labels

Both appear in the prompt. They behave differently:

|                        | `knownEntities`                                 | pre-resolved labels                                                 |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Origin                 | caller-supplied hint (e.g. pre-fetched matches) | derived from signal metadata (adapter → seed phase)                 |
| Binding to local label | none — LLM must emit a mention to reference it  | bound — LLM references the label directly                           |
| LLM mention required?  | yes                                             | no (redeclaration is ignored)                                       |
| Cost                   | zero                                            | one `upsertEntityBySurface` per seed                                |
| Use when               | you want the LLM to *prefer* a surface form     | you have deterministic identifiers and want zero ambiguity          |

Use `knownEntities` for thread participants you've seen before but don't want to hard-bind; use pre-resolved seeds (via `participants`) for header-derived identities.

---

## Handling the result

```ts
interface IngestionResult {
  entities: IngestionResolvedEntity[];   // all labels (seeds + mentions)
  facts: IFact[];                        // successfully written facts
  mergeCandidates: {...}[];              // near-matches that didn't cross autoResolveThreshold
  unresolved: IngestionError[];          // seed:N or fact:N errors
  newPredicates: string[];               // unknown-to-registry predicates (drift signal)
}
```

Patterns:

- **Review `mergeCandidates` asynchronously** — a human UI or nightly job reconciles near-matches, optionally calling `memory.mergeEntities` on winners.
- **Monitor `newPredicates`** — periodically scan ingested batches. Entries usually mean either (a) the LLM is inventing vocabulary → refine your prompt, or (b) you need to register new predicates in your registry.
- **Log `unresolved`** — `seed:N` means your adapter produced a bad seed (fix the adapter). `fact:N` means the LLM output referenced an undefined label (usually a model blip — safe to retry the signal).

---

## Common pitfalls

1. **Seeding free-provider domains as orgs.** `EmailSignalAdapter` already skips them. If you roll your own adapter, don't seed `gmail.com` / `outlook.com` as organizations — thousands of unrelated entities would collapse into one.
2. **Passing display-name-only seeds.** Rejected by design. Upsert via `memory.upsertEntityBySurface` separately first, then pass the resolved entity as `knownEntities` if you want the LLM to *prefer* it.
3. **Mutating `raw` after `extract`.** Adapters are synchronous and pure; callers should treat `raw` as data, not state. If you share the same `raw` object across threads or retries, it's fine — adapters don't mutate it.
4. **Forgetting `sourceSignalId`.** It's how you trace facts back to the originating signal later (`findFacts({ sourceSignalIds: [...] })`). Use a stable ID from your signal store — the library doesn't own signal storage.
5. **Using the default extractor in tests.** `ConnectorExtractor` runs real LLM calls. For tests, supply a mock `IExtractor` with canned fixtures.
6. **Scope mismatches.** `ingest({ scope })` is the scope facts get written under, AND the scope seeds are resolved under. If a seed's existing entity is scoped more broadly than the caller (e.g. global), it's visible and will be reused; if scoped more narrowly, a new entity will be created in the caller's scope. Be deliberate about scope propagation.
