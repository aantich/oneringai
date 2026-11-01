# Bounded Codex subscription and OpenAI API validation

Date: 2026-11-01. Source baseline: `fed745a0ec58e348c791723884a516958cf3a13d`
on `version2`, plus the reviewed bridge correction and tests in this working tree.
This is branch validation, not an npm release or full vendor certification.

The user explicitly authorized the updated `.env` OpenAI key, requested as much
Codex subscription testing as possible, and requested very light API-key usage.
This supersedes the previous live pause for this bounded run only. Other providers,
media generation and an unrestricted integration-suite run were not enabled.

## Results

| Validation | Result | Actual scope |
| --- | --- | --- |
| Codex subscription suite | 10 tests pass; five native turns in the final run | Real SDK/CLI, host MCP, structured streaming output, ordered event replay, request deduplication/conflicts, pre-dispatch cancellation, owner isolation, unsupported-transfer rejection, native history, sandboxed command, verified idle restoration and in-flight cancellation. |
| Protected task state | Two API cases pass | OpenAI `run` and `stream`; corrected host constraints, pending remote action, no duplicate submission. |
| Invocation-owned tool outcomes | Two API cases pass | OpenAI `run` and `stream`; business decline remains data, explicitly reported operational failure retains its outcome. |
| Workflow preset | Two API cases pass | OpenAI `run` and `stream`; original evidence retained and host completion checked. |
| Controlled structured repair | One API case passes | Two real model invocations; intentionally corrupted local text repaired with invocation/usage accounting. |
| Full offline units | 9,326 tests / 424 files pass | Includes the new Codex private-bridge configuration regression. A later host-denial regression also passes: 9,327 distinct unit cases across the recorded runs. |
| Build and public checks | Pass | ESM/CJS build and shared Connector identity, source types/lint, example types, built consumer compatibility, explicit strict typecheck of the new live test, and SDK configuration serialization. |
| Deterministic examples | Nine pass | All runtime examples, crash-recovery fixtures and the AMOS runtime example; synthetic providers, no live AMOS UI claim. |

Initial offline runs needed a retry with local socket/IPC access: the sandbox
blocked localhost fixture servers and tsx's local pipe. The permitted reruns pass.
The machine-readable [summary](LIVE_VALIDATION_2026_11_01.json) retains selected
case results and usage without credentials, raw requests or provider headers.

## Direct API usage

Only `gpt-4o-mini` was allowed by a temporary fetch guard. Across all four selected
suite runs: **14 requests, 5,145 input tokens, 113 output tokens**, all successful.
The guard shared a 20-request ceiling, rejected output caps above 512 tokens and
JSON requests above 64 KiB, and refused other models and hosts before dispatch.
Actual selected requests used output caps of at most 256 tokens. No retry was
needed. The `.env` key was never passed to the Codex evaluation or printed.

Using the checked-in model registry's token rates, this sample estimates to about
**$0.00084**. This is an estimate, not a billing statement, and excludes subscription
usage. No media, managed-agent creation, storage or other separately priced tools
were exercised.

## Codex authentication and runtime boundary

The installed TypeScript SDK is `@openai/codex-sdk@0.149.0`. The successful run used
the locally installed app CLI, `0.162.0-alpha.17.2`, and model `gpt-6.1-sol` with low
reasoning. The SDK's bundled CLI reported `model_not_found` / unsupported for the
two tested ChatGPT-subscription model selections (`gpt-6.1-sol`, `gpt-5.3-codex`).
That is a recorded account/client boundary, not a passing compatibility result or
proof that either model is universally unavailable.

Production `CodexSdkDriver` **still requires an API-key connector**. This test uses
the existing `loadSdk` embedding seam and a clearly named test-only subclass to
bootstrap a disposable Codex home from the owner's existing file-backed ChatGPT
login. It forces ChatGPT authentication and removes API-key/base-URL overrides;
there is no fallback to billable Platform authentication. It copies neither user
configuration nor plugins. Credential copies and native test state are removed in
teardown. Nothing adds a public subscription-login feature or changes AMOS auth.
OpenAI documents [SDK control](https://developers.openai.com/codex/sdk) and
[Codex sign-in and login caching](https://learn.chatgpt.com/docs/auth).

A host-written, unchanged probe runs in the actual native shell and fails if an
OpenAI API key or the internal MCP bearer token is visible. Its successful command
event and output file are verified by the host. Recovery hashes the exact native
transcript before restoring; it does not submit a task to test recovery. An aborted
host wait can intentionally retain an unresolved observation: deletion must reject
until source reconciliation. The test verifies that guard, then removes only its
disposable synthetic fixture. This is not a production reconciliation recipe.

## Live defect corrected

Codex's current MCP approval defaults prevented an internal host-tool call when
the native driver correctly used `approvalPolicy: 'never'`. The private
`onering_host` server now explicitly uses `default_tools_approval_mode: 'approve'`.
This setting is restricted to the authenticated, selected-tool bridge: OneRingAI's
existing ToolManager still applies host permissions, scope and active-run checks.
Native approvals and unrelated MCP tools are unchanged. A real authenticated MCP
unit regression verifies a blocked host tool executes zero times. The SDK probe
also verifies serialization of this exact setting. See the official
[MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp#other-configuration-options).
Generated built-in registry fingerprints were refreshed by the existing generator,
which hashes shared source; no tool implementations were manually changed.

## Reproduce the subscription suite

These commands are for the repository checkout, not an installed npm package:

```bash
codex login status
CODEX_LIVE_CLI="$(command -v codex)" npm run test:runtime:subscription
```

An eligible ChatGPT subscription, current local CLI, file-backed Codex login and
explicit local permission to run the SDK/native sandbox are required. Set
`CODEX_LIVE_MODEL` only to an account-supported model with registered capabilities.
`CODEX_SUBSCRIPTION_REPORT_PATH` optionally writes the credential-free test summary.
The suite is disabled without its opt-in flag and never loads `.env`.

The API sample selected only the named OpenAI cases, not all integration tests:
task-state `openai (run|stream):`, outcome-tools `openai (run|stream):`, preset
`openai workflow (run|stream)$`, and the single controlled OpenAI structured-repair
case. Future runs require explicit scope and bounds again; do not enable every
live flag merely because `.env` contains credentials.

Remaining live gates include production API-key Codex execution, managed OpenAI
agents, Claude SDK/managed agents, other providers, large native compaction,
media/Realtime, cross-process native SDK recovery and actual AMOS/Hosea UI runs.
Offline coverage remains distinct from those unperformed live checks.
