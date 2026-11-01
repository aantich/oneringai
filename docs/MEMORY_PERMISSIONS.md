# Memory Permissions — Usage Guide

The memory layer ships a three-principal access-control model on top of the existing scope system. Every entity and fact carries an `ownerId` (required) plus an optional `permissions` block governing what **group members** and **the world** can do with it, plus an optional explicit **`acl`** for per-identity grants beyond those three principals. Writes are authorized; reads are filtered at the storage layer.

This guide covers the model, defaults, migration, and recipes. For the API reference, see [MEMORY_API.md § Access Control](./MEMORY_API.md#access-control).

---

## Table of contents
- [The model at a glance](#the-model-at-a-glance)
- [The three principals](#the-three-principals)
- [Access levels](#access-levels)
- [Defaults — public-read by default](#defaults--public-read-by-default)
- [The owner invariant](#the-owner-invariant)
- [Admin delegation](#admin-delegation)
- [Read filtering vs write authorization](#read-filtering-vs-write-authorization)
- [Principal-based ACLs (explicit grants)](#principal-based-acls-explicit-grants)
- [Recipes](#recipes)
- [Migration notes](#migration-notes)
- [Adapter responsibilities](#adapter-responsibilities)
- [Pitfalls](#pitfalls)

---

## The model at a glance

```ts
interface Permissions {
  group?: AccessLevel;  // what group members (non-owner) can do
  world?: AccessLevel;  // what everyone outside the group can do
}

type AccessLevel = 'none' | 'read' | 'write';   // 'write' implies 'read'
```

Every record is subject to three evaluations in order:

1. **Owner**: if `record.ownerId === caller.userId` → full access, always.
2. **Group**: if `record.groupId === caller.groupId` → use `permissions.group`.
3. **World**: otherwise → use `permissions.world`.

There is no built-in role or admin hierarchy. Narrow grants are available
through the optional principal-based `acl` layer described below; your host
still decides which authenticated callers may create or change those grants.

---

## The three principals

### Owner
- The user identified by `record.ownerId`.
- Always has full access. Not subject to any permission bit.
- Must be present on every record (see [owner invariant](#the-owner-invariant)).

### Group
- The set of users whose `scope.groupId` matches `record.groupId`.
- Only meaningful when the record has a `groupId` set.
- Access governed by `permissions.group`.

### World
- Everyone else: either callers outside `record.groupId`, or — when the record has no `groupId` — every caller.
- Access governed by `permissions.world`.

---

## Access levels

| Level     | Read?   | Write?  |
| --------- | ------- | ------- |
| `none`    | no      | no      |
| `read`    | yes     | no      |
| `write`   | yes     | yes     |

One field per principal. No bitmask confusion, no "write without read".

---

## Defaults — public-read by default

When `permissions` is omitted:

| `permissions.group`  | `permissions.world`     |
| -------------------- | ----------------------- |
| `'read'` (default)   | `'read'` (default)      |

Every record is **publicly readable, owner-only writable**. Matches UNIX `644` semantics.

**To make a record group-private (not visible outside the group):**
```ts
permissions: { world: 'none' }
```

**To make it fully owner-private:**
```ts
permissions: { group: 'none', world: 'none' }
```

**To make it group-editable (any group member can write):**
```ts
permissions: { group: 'write' }
```

**To make it world-editable (wiki-style):**
```ts
permissions: { world: 'write' }
```

`permissions.group` is only meaningful when `record.groupId` is set. For groupless records, **it's silently ignored** — the group principal doesn't exist, so setting `group: 'write'` without a `groupId` has no effect. No error is raised; document the expectation in your call sites.

---

## The owner invariant

**Every record — entity or fact — must carry an `ownerId`.**

`MemorySystem.upsertEntity` / `addFact` enforce this: if neither the caller nor the input provides an ownerId, they throw `OwnerRequiredError`.

```ts
// rejected
await mem.upsertEntity({ /* …, no ownerId */ }, {});   // throws OwnerRequiredError

// accepted — ownerId defaults from scope.userId
await mem.upsertEntity({ /* … */ }, { userId: 'alice' });

// accepted — explicit ownerId wins (admin case, see below)
await mem.upsertEntity({ /* …, ownerId: 'bob' */ }, { userId: 'admin' });
```

Why: the owner shortcut (unconditional full access) is the cornerstone of the model. Without a guaranteed owner, every mutation would need a dance to figure out who's allowed; with it, every mutation short-circuits cheaply and correctly.

Facts inherit ownership from their subject entity when `input.ownerId` is absent — so you rarely need to set it explicitly at the fact level.

### Profile regeneration inherits permissions

Auto- and manual profile regeneration (`MemorySystem.regenerateProfile`) inherits the prior profile fact's `permissions` block when one exists. A profile that was explicitly set to `{ world: 'none' }` stays private across every regeneration—the library never silently widens visibility. When no prior profile exists, the first profile goes through `MemorySystem.visibilityPolicy`; only hosts without a policy fall back to the public-read library default. Configure the policy centrally, or make the first write explicit:

```ts
await mem.addFact(
  {
    subjectId: person.id,
    predicate: 'profile',
    kind: 'document',
    details: '…',
    permissions: { world: 'none' },
  },
  { userId: 'alice' },
);
// Subsequent regenerations inherit { world: 'none' }.
```

---

## Admin delegation

The library does NOT check that `input.ownerId === scope.userId`. A caller may create a record owned by *another user* by setting `ownerId` explicitly:

```ts
await mem.upsertEntity(
  {
    type: 'person',
    displayName: 'Bob Smith',
    identifiers: [{ kind: 'email', value: 'bob@acme.com' }],
    ownerId: 'bob',              // delegating ownership to bob
  },
  { userId: 'admin' },            // admin is the creator but not the owner
);
```

This is intentional — it's your admin hook. Restricting it would force every "create on behalf of" operation through an ugly bypass. If your app needs to forbid delegation, enforce it at the call site.

The resulting record is owned by `bob`: bob has full access, `admin` sees it only via group/world permissions (or not at all if those are `none`).

---

## Read filtering vs write authorization

Access enforcement happens in two places:

### Read filtering — at the storage layer

Every read path (`getEntity`, `findFacts`, `listEntities`, `searchEntities`, `traverse`, `semanticSearch`, `countFacts`, `findEntitiesByIdentifier`) returns only records where `canAccess(record, caller, 'read') === true`. Each adapter translates this into its native query language:

- **InMemoryAdapter** — an in-process predicate.
- **MongoMemoryAdapter** — a Mongo `$or` of three branches (owner / group-read / world-read).

Records you can't read are indistinguishable from records that don't exist. No `PermissionDeniedError` on reads — you just get fewer results.

### Write authorization — at MemorySystem

Every mutation method:
1. Loads the existing record via the scoped read filter.
2. If the record is not found (or invisible), throws a not-found error.
3. If found but `canAccess(record, caller, 'write') === false`, throws `PermissionDeniedError`.
4. Proceeds with the mutation.

UNIX-shaped: you need read to learn a record exists; write is a separate check. The error surface lets callers distinguish "not there" from "there but denied".

Affected methods:
- `archiveEntity`, `deleteEntity`, `mergeEntities`
- `archiveFact`, `supersedeFact`, `addFact` (when `supersedes` is set)
- `upsertEntity` (dirty path — when merging new identifiers into an existing entity)

### Permission-window caveat on cascades

`archiveEntity` / `deleteEntity` cascade to referencing facts; `mergeEntities` rewrites references. Both use the **scope-window** (only see facts visible to caller) and a new **permission-window** (only touch facts the caller can write). Facts the caller can see but not write are left untouched. That's intentional — preventing privilege escalation via cascade — but means a partial merge or cascade is possible. Handle it at the application layer (e.g. re-run the merge as admin) if you need full cleanup.

---

## Principal-based ACLs (explicit grants)

Owner / group / world covers the common cases, but it can't express *"this specific other person, agent, or service can read this record."* The principal-ACL layer adds that — explicit, per-identity grants that sit **alongside** owner/group/world, not instead of it.

> **Backwards compatible.** If you never set an `acl` and never pass `scope.principals`, nothing in this section changes anything — the three-principal model runs exactly as documented above.

### Principals

A *principal* is an opaque canonical token identifying an access identity:

| Token | Built with | Means |
| ----- | ---------- | ----- |
| `user:<id>` | `principalUser(id)` | A specific user (the owner is always `user:<ownerId>`) |
| `entity:<id>` | `principalEntity(id)` | A specific entity — typically a `person` (the key to "account links later") |
| `group:<id>` | `principalGroup(id)` | Every member of a group |
| `service:<name>` | `principalService(name)` | A non-human service identity |
| `world` | `PRINCIPAL_WORLD` | Everyone (the broadest read token) |

All are exported from `oneringai`. `parsePrincipal(token)` splits a token into `{kind, id}`; an unrecognized prefix parses as `kind: 'unknown'` — **never** `world`, so a malformed or future-prefixed token is never silently treated as public.

### The `acl` field

Entities and facts take an optional `acl: ACLEntry[]`:

```ts
interface ACLEntry {
  principal: Principal;              // e.g. principalEntity('alice')
  actions: Array<'read' | 'write'>;  // [] grants nothing (NOT a silent read)
}
```

Example — a user-private fact that a named participant can also read:

```ts
import { principalEntity } from 'oneringai';

await mem.addFact(
  {
    subjectId: deal.id,
    predicate: 'note',
    kind: 'atomic',
    details: '…',
    permissions: { group: 'none', world: 'none' },   // owner-private base
    acl: [{ principal: principalEntity('alice'), actions: ['read'] }],
  },
  { userId: 'owner', groupId: 'g1' },
);
// Readable by: owner (always) + the holder of entity:alice. Nobody else.
```

### Materialized token sets

On **every write**, the storage boundary projects `ownerId` + `groupId` + `permissions` + `acl` into two arrays stored on the record:

```ts
readPrincipals:  string[]   // every principal that may read
writePrincipals: string[]   // every principal that may write  (⊆ readPrincipals)
```

- **Library-owned — never set these by hand.** They're recomputed deterministically (and sorted, for stable diffs and idempotent backfills) on each create/update.
- Owner ⇒ both arrays. `group: 'read'` ⇒ `group:<id>` in read; `group: 'write'` ⇒ both. Same for `world`. Each `acl` entry adds its principal to read and/or write per its `actions`.
- A read query becomes a single sargable `readPrincipals: { $in: <caller tokens> }`; an in-process check is a set intersection.

### Querying in principal mode — `scope.principals`

A caller opts into the principal model by passing `ScopeFilter.principals`. The **presence** of the field (any length, including empty) is authoritative:

```ts
import { principalUser, principalGroup, principalEntity, PRINCIPAL_WORLD } from 'oneringai';

const scope = {
  principals: [
    principalUser('alice'),           // own user token → owner access to alice's records
    principalGroup('g1'),             // groups alice belongs to
    principalEntity(alicePersonId),   // alice's Person entity (account-link grants)
    PRINCIPAL_WORLD,                  // see public records
  ],
};
const fact = await mem.getFact(id, scope);   // visible iff tokens intersect readPrincipals
```

- A record is authorized **iff** the caller's token set intersects the record's `read`/`write` array.
- **Empty set → nothing.** `{ principals: [] }` matches and authorizes nothing.
- **Absent → legacy.** Omit `principals` entirely and the unchanged owner/group/world path runs (full backward compatibility).
- When `principals` is present, `userId` / `groupId` are **ignored for the access decision** — encode those identities as tokens in the set instead.

It is the **host's job to build the token set correctly** (the library trusts it, exactly as it trusts `scope.userId` / `groupId`):

| You must… | …or else |
| --------- | -------- |
| include `PRINCIPAL_WORLD` | the caller can't see public records (fails **closed** — safe) |
| include the caller's own `user:<id>` | the owner loses owner access (fails closed) |
| include **only** `group:<id>` tokens the caller truly belongs to | over-including a group token **leaks** that group's records (fails **open** — a host bug) |

### Changing access after creation — `setAccess`

`MemorySystem.setAccess` is the first-class mutator for the explicit-grant layer:

```ts
await mem.setAccess('fact', factId,
  [{ principal: principalEntity('bob'), actions: ['read'] }],
  scope,
);
```

- Requires `write` on the record (`PermissionDeniedError` otherwise).
- **Replaces** the record's `acl` with the array you pass, then re-materializes `read` / `writePrincipals`.
- Touches only the `acl` layer — it does **not** change `ownerId` or the `permissions.{group, world}` block (those remain owner-driven; see [Changing access on an existing record](#changing-access-on-an-existing-record) below).

### "Account links later" — grants follow entity merges

When two `person` entities turn out to be the same identity, `mergeEntities(winner, loser, scope)` rewrites every `entity:<loserId>` grant to `entity:<winnerId>` across all entities and facts (in `acl` and the materialized arrays). A record that was readable via the loser's principal becomes readable via the winner's — so when a contact's accounts are linked, their prior facts stay visible under the surviving identity. (Optional store capability `rewriteEntityPrincipal`; both built-in adapters implement it. Scoped to the caller's tenant; the merge already enforced write access on winner + loser.)

### Migration gate — `backfillAccessPrincipals`

Rows written before the principal model (or by any path predating the storage-boundary stamp) have **no** `readPrincipals`. There is **no legacy fallback for principal callers**: a row lacking `readPrincipals` is invisible to a `scope.principals` caller at query time *and* denied by the in-process `canAccess`. Therefore:

> ⚠️ **You MUST run `backfillAccessPrincipals` to completion before any host code starts passing `scope.principals`.**

```ts
const res = await mem.backfillAccessPrincipals(scope, { batchSize: 500 });
// → { entitiesScanned, entitiesUpdated, factsScanned, factsUpdated }
```

- Recomputes each row's arrays from its own `ownerId` / `groupId` / `permissions` / `acl` and writes **only when they differ** — idempotent; re-running is a no-op.
- Covers **live and archived** rows. `{ force: true }` rewrites every row regardless (use after the materialization rules change).
- `batchSize` clamps to `[1, 1000]` (default 500). Paginates by the unique primary key (`_id`), so every row is touched exactly once — even when timestamps tie.

### Authorizing your OWN collections (host extension)

The principal kit in `src/access/principals.ts` is exported from the package root so a host can apply the *same* grammar and materializer to its own (non-memory) collections — no further library change required to extend coverage:

```ts
import {
  materializePrincipals, fromLibraryPermissions, fromNimbleAudit,
  readFilterForPrincipals, writeFilterForPrincipals,
  principalUser, principalEntity, parsePrincipal,
} from 'oneringai';

// Project your collection's native shape → the two arrays, store them, and
// query with readFilterForPrincipals(callerTokens):
const { readPrincipals, writePrincipals } = materializePrincipals(
  fromNimbleAudit(doc.isPublic, doc.ownerId, doc.groupId, doc.acl),
);
```

`fromLibraryPermissions` mirrors the memory layer's `{group, world}` defaults; `fromNimbleAudit` maps an `{isPublic, ownerId, groupId}` shape. Both feed the single `materializePrincipals` projector, so every collection stays observationally identical.

### Mongo deployment

`readPrincipals` is covered automatically: `ensureAdapterIndexes()` builds principal-led b-tree indexes (`memory_ent_principals`, `memory_fact_principals_subject` / `_object`), and `ensureVectorSearchIndexes()` declares `readPrincipals` as a `type: 'filter'` path on the Atlas Vector Search indexes. Nothing extra to do — but the footgun is real: if you ever hand-build an Atlas vector index, `readPrincipals` **must** be declared `type: 'filter'` or `$vectorSearch` silently drops the scope clause (a cross-tenant read leak with no error at query time). Use the programmatic helpers. The adapter deliberately never compounds two array fields (`readPrincipals` + `contextIds`), which MongoDB rejects ("cannot index parallel arrays").

---

## Recipes

### A team-private note

```ts
await mem.addFact(
  {
    subjectId: entity.id,
    predicate: 'memo',
    kind: 'document',
    details: '…confidential…',
    permissions: { world: 'none' },
  },
  { userId: 'alice', groupId: 'engineering' },
);
```

Visible to: alice (owner), anyone in `engineering` (group default `read`). Outside callers: invisible.

### A fully-private user note

```ts
permissions: { group: 'none', world: 'none' }
```

Only the owner sees it — group members and outsiders cannot even enumerate it.

### A public read-only reference entity

```ts
await mem.upsertEntity(
  {
    type: 'organization',
    displayName: 'OpenAI',
    identifiers: [{ kind: 'domain', value: 'openai.com' }],
    ownerId: 'system',
    // default permissions → world: 'read', group: 'read'
  },
  { userId: 'admin' },
);
```

Visible to everyone, writable only by `system` (your designated admin/system user).

### A wiki-editable entry

```ts
permissions: { world: 'write' }   // anyone can edit
```

### A team-collaborative task

```ts
await mem.upsertEntity(
  {
    type: 'task',
    displayName: 'Refactor auth',
    identifiers: [{ kind: 'task_key', value: 'AUTH-42' }],
    groupId: 'backend-team',
    permissions: { group: 'write' },   // any team member can update; world read-only
  },
  { userId: 'alice', groupId: 'backend-team' },
);
```

### Changing access on an existing record

Two layers, two stories:

- **Explicit `acl` grants are mutable** via the first-class **`setAccess(kind, id, acl, scope)`** (requires `write`; replaces the `acl` and re-materializes the token arrays). See [Principal-based ACLs § Changing access after creation](#changing-access-after-creation--setaccess).
- **The `permissions.{group, world}` block is still write-once at the `MemorySystem` level.** `upsertEntity` does NOT rewrite `permissions` on existing records — if the dirty path fires (adding new identifiers to an already-stored entity), the caller's `input.permissions` is **silently ignored** and the existing permissions persist. This is deliberate: upsert is an idempotent write path, not an admin tool, and it would be a foot-cannon for any code that upserts on a hot path to carry the risk of accidentally rewriting an ACL.

To change `group` / `world` after creation:

- **Preferred**: get the owner to re-emit the record with the new permissions. Owner-driven permission changes compose with the audit trail via supersession on fact-level profiles or ordinary updates on entities (owner always has write).
- **Admin escape hatch**: call `store.updateEntity` / `store.updateFact` directly, bypassing `MemorySystem`. You must first verify the caller's authority yourself (the library won't enforce anything here — the store is a lower-level surface). The storage boundary still re-materializes `read` / `writePrincipals` from the new permissions, so the token arrays never drift.

---

## Migration notes

This is a **breaking change** relative to pre-permissions versions. Two effects to plan for:

### 1. Public-read default

Previously, a record with `{groupId: 'acme', ownerId: 'alice'}` was invisible to callers outside `acme`. Now, with default `world: 'read'`, it's readable by anyone. To preserve the old group-privacy semantics, set `permissions.world = 'none'` explicitly on records that shouldn't leak.

**Migration plan:** identify which record types your app treats as group-private and bulk-update their `permissions.world = 'none'` at migration time. Reads before migration can see more than they used to — audit any UI that surfaces "anyone's records" before rolling out.

### 2. Owner required on all new writes

Existing records without `ownerId` are tolerated on reads (the adapter's filter handles them), but you cannot create new records without one. Any caller code that created records with `scope: {}` or with no explicit `ownerId` must now:
- Use a scope with `userId` set, OR
- Pass `input.ownerId` explicitly.

**Migration plan:** run a one-time backfill that assigns `ownerId` (e.g. to a distinguished `"system"` user) for all legacy records. After backfill, write-time mutations on legacy records work via the owner shortcut for that system user.

### 3. Stricter write semantics

Previously, any caller whose scope could *see* a record could write it. Now writes require the owner shortcut or explicit `group: 'write'` / `world: 'write'`. This is an improvement but may surface bugs in code paths that relied on the permissive old behavior. Expect `PermissionDeniedError` in places that previously silently succeeded.

### 4. Principal mode requires a backfill first

This step applies **only if** you intend to start passing `scope.principals` (the [principal-based ACL](#principal-based-acls-explicit-grants) path). Principal callers have **no legacy fallback** — a row that lacks materialized `readPrincipals` is invisible to them. Run `await mem.backfillAccessPrincipals(scope)` to completion across every tenant before flipping any caller to principal mode. It's idempotent, so it's safe to re-run; new writes are materialized automatically. Callers that never set `scope.principals` are unaffected.

---

## Adapter responsibilities

If you're writing a custom `IMemoryStore` adapter, your contract for permissions:

1. **Every read path** (`getEntity`, `getFact`, `findFacts`, `listEntities`, `searchEntities`, `findEntitiesByIdentifier`, `traverse`, `semanticSearch`, `countFacts`) MUST filter results via `canAccess(record, scope, 'read')`. You can implement this either natively (InMemoryAdapter style) or via a query-language translation (MongoAdapter style using the `scopeToFilter` helper).

2. **Mutations don't need permission checks** — MemorySystem does them before calling the adapter. Your mutations still need to enforce scope visibility (can't update a record the caller can't see) via the existing scope filter. `MemorySystem` layers write-auth on top.

3. **Store `permissions` verbatim** — don't normalize or default at the storage layer. All default logic lives in `AccessControl.ts` so it stays consistent across adapters.

4. Recommended indexes (Mongo example): compound on `(ownerId, groupId)` covers the owner shortcut + group match branches. Single-field on `permissions.world` and `permissions.group` if you frequently query with filters that depend on those levels.

5. **If you support principal mode**, materialize the token arrays on every write by calling `principalsForLibraryRecord(record)` (from `oneringai`) at the storage boundary, storing the returned `readPrincipals` / `writePrincipals` on the row — and recompute them whenever a write touches `acl` / `permissions` / `ownerId` / `groupId` (use `patchTouchesAccessFields(patch)` to gate partial updates). `scopeToFilter` already emits the `readPrincipals: { $in }` branch when `scope.principals` is present, and `canAccess` already honours it; the only adapter responsibility is keeping the materialized arrays current. Optionally implement `rewriteEntityPrincipal(from, to, scope)` so entity merges rewrite `entity:` grants (skipped silently if you don't). Both built-in adapters do all of this — read `InMemoryAdapter` for the minimal reference.

---

## Pitfalls

1. **Forgetting `ownerId`.** The most common migration slip. `OwnerRequiredError` is explicit — catch it at integration boundaries.

2. **Public-read surprise.** Don't assume scope isolation still makes a record private. It doesn't — `permissions.world = 'none'` is now the explicit knob.

3. **`permissions.group` on a groupless record.** Silently ignored. If you set `group: 'write'` but forget `groupId`, only the owner can write.

4. **Confusing scope vs permissions.** Scope is "which records apply to this caller"; permissions are "what this caller can do to those records." Both gates must pass for a mutation to succeed.

5. **Partial merges / cascades.** A merge or delete can leave dangling references if the caller lacks write on some referenced facts. Not an error — document in your app if full cleanup is required, and re-run with a broader scope.

6. **Admin delegation visibility.** When `admin` creates a record with `ownerId = 'bob'`, the admin may not be able to see it again unless the record also has group or world read permissions. Plan admin tooling accordingly (admin scope usually sees records because it's the group's `ownerId` or because the record is group-visible).

7. **Incomplete principal token sets.** In principal mode (`scope.principals`), the host builds the token set and the library trusts it. Forgetting `PRINCIPAL_WORLD` hides public records; forgetting the caller's own `user:<id>` drops owner access (both fail **closed**). The dangerous direction is the opposite: including a `group:<id>` the caller doesn't belong to **leaks** that group's records (fails **open**). Treat token-set construction with the same care as authenticating `scope.userId`.

8. **Passing `scope.principals` before backfilling.** A principal caller has no legacy fallback — un-materialized rows are invisible. Always run [`backfillAccessPrincipals`](#migration-gate--backfillaccessprincipals) to completion first.
