# Hosea shared ChatGPT plan validation — 2026-11-10

Implementation is uncommitted on `main`, based on
`5b1473b9eed97bb4c5f16e9e62bdc0b129c64b50`. Package version remains
`oneringai@2.0.0-beta.3`; this feature is unreleased. No npm publication, app
release, branch creation, push or website deployment was performed.

## Result

Hosea owns one selected SIWC registration for all OpenAI model agents. Native
OneRingAI `Agent.create`, `run`, `stream`, context plugins and the shared
ToolManager retain their APIs. Existing idle chats checkpoint and restore against
the selected connection; provider-bound opaque state retains its original scope.
Credentials refresh centrally and remain in the main process. Missing consent,
sign-out, revocation and persistence failures do not select API-key billing.
Media uses its separately configured API-key credentials. Other vendors retain
their own connections and are not blocked by an OpenAI sign-in ceremony.

See [setup and limits](../CHATGPT_PLAN_ACCESS.md).

## Checks

| Check | Result |
| --- | --- |
| Full library unit suite | 436 files, 9,502 tests passed |
| Follow-up OpenAI/provider and AMOS tests after final capability review | 29 files, 312 tests passed |
| Final ChatGPT request-profile tests | 24 tests passed |
| Hosea offline auth/design/storage tests | 20 tests passed |
| Library build and ESM/CJS export verification | Passed |
| Library typecheck and lint | Passed |
| Hosea typecheck and renderer/main build | Passed |
| AMOS typecheck/build | Passed |
| Offline examples, including AMOS runtime/native compaction | All 30 entrypoints passed |
| Example types and agentic compatibility fixture | Passed |
| Browser page/Worker declarations and offline engine tests | Passed; no reported errors/violations |
| Public/internal API references | Regenerated |
| Documentation validation | 509 TypeScript blocks, 18 complete examples; links/anchors checked |
| Working-tree whitespace check | Passed |

The full unit run preceded the final narrower capability-profile review; the
focused provider/AMOS tests, browser checks and real Electron scenario cover
those final changes. Tests requiring local HTTP/IPC fixtures ran with sandbox
network/IPC restrictions lifted; these remained offline tests.

## Real Electron app scenario

`npm --prefix apps/hosea run test:chatgpt:electron` launches the built app in an
isolated temporary data directory. It replaces external auth/inference traffic
and OS encryption with fixtures; production OAuth identity validation still
verifies a fixture RS256 signature, issuer, audience and nonce through JWKS.

The test uses the actual renderer buttons, IPC, main process, provider SDK,
Agent loops, context tools and persistence. It verifies:

- One browser authorization for two existing chats, a new ChatGPT-only agent
  without an API key, and the default Agent's `run()` path.
- Account-specific model discovery and required streamed/stateless wire options.
- A namespaced `store_set` call and its replay through the existing ToolManager.
- Context/plugin state survives automatic rebinding of an existing chat.
- Sign-out dispatches no inference and never falls back to an API key.
- An explicit API-key selection restores the saved API-mode temperature and key.
- An existing non-OpenAI provider named `hosea-chatgpt` is preserved; the managed
  connection receives a distinct name.
- Desktop/narrow and light/dark account-screen rendering; connected and
  reconnect-required states.

Final scenario: one sign-in; seven synthetic model requests before the explicit
API-key switch, followed by a verified explicit API-key request. Artifacts were
inspected under the temporary directory
`/var/folders/w4/0_95kdj51l35cqyg07_w5v5r0000gn/T/hosea-chatgpt-electron-FZYMYa/`.
Fixture credential data was removed when the app closed.

The account-service tests separately cover concurrent refresh deduplication,
rotating-token persistence, multiple registrations with matching email labels,
identity mismatch, missing plan permission, terminal/transient refresh failure,
logout and bounded revocation retries, cancellation while waiting and during
identity validation, production signed-JWT validation failures (nonce, audience, expiry, missing issued-at and invalid signature), issued-client retention after failed code exchange, locked
storage and failed encryption after refresh.

## Verification boundaries

No real OpenAI account, OAuth grant, subscription allowance or live model request
was used. Production registration/admission, account eligibility, live tool/model
availability and actual OS keychain behavior still require an authorized account
smoke test. No Windows/Linux installer or signed release was built. `store: false`
is not a guarantee about every provider caching or data-handling policy.
