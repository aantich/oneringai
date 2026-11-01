# AMOS agent runtime cookbook

Use runtime mode when one logical assistant should run through OneRingAI, local
Codex or Claude SDKs, or either managed API. AMOS calls the public runtime APIs;
each adapter owns its native agent loop. The normal AMOS interface remains the
place for native Agent context, routing, routines, helper and tool-mutation commands.

This chapter owns AMOS setup and commands. The [canonical runtime chapter](../../../USER_GUIDE.md#agent-runtime-preview)
owns library signatures, authentication, tools, capabilities and recovery guarantees.
The [examples index](../../../examples/README.md#agent-runtime-harness-examples)
contains deterministic checks and expected output. Availability is source on branch;
live provider/platform/account checks remain paused and no package release is claimed.

## Start the ready-to-run host

From the repository root, install the project dependencies and optional SDK peers,
then build the library and app:

```bash
npm install
npm install --no-save @openai/codex-sdk @anthropic-ai/claude-agent-sdk
npm run build
npm run --prefix apps/amos build
```

The [trusted example host](../examples/runtime-host.ts) defaults to synthetic,
offline execution using the actual OneRingAI adapter. It makes no provider requests.
Choose a private data directory; use a fresh one for an independent mock scenario:

```bash
AMOS_DATA_DIR=$(mktemp -d) node --import tsx apps/amos/dist/index.js \
  --runtime-host apps/amos/examples/runtime-host.ts
```

`--import tsx` loads the example's TypeScript bootstrap. A JavaScript `.mjs` host
needs no TS loader. The bootstrap is executable main-process code; keep its filename
out of model/renderer input. It exports `createAmosRuntimeHost(dataDir)` returning
`runtime`, `definition`, `options`, optional `resume` and optional `saveReference`.
The optional callback persists a session locator after opening or recovering an
uncertain setup. `/save` retries that persistence independently of model execution.

Choose the mock adapter at startup with `AMOS_RUNTIME_DRIVER`:

| Value | Placement/profile in the example | Continuation and recovery |
| --- | --- | --- |
| `oneringai.agent` | Native Agent; host-selected tool and default memory tools | Turns and idle context restore |
| `openai.codex.sdk` | Local read-only workspace and sandboxed commands | Turns; prior-history restore needs a real host checkpoint verifier |
| `anthropic.agent.sdk` | Host tools only; native filesystem/shell/web denied | Turns; prior-history restore needs a real host checkpoint verifier |
| `openai.agents.api` | Provider-hosted environment, sandboxed commands and workspace writes | Managed observation detach/recovery; explicit files |
| `anthropic.managed.api` | Provider-managed environment; native tools disabled | Managed observation detach/recovery; explicit files; budget waiting |

For example, prefix the launch command with
`AMOS_RUNTIME_DRIVER=anthropic.managed.api`. All mock SDKs/services run in the
same process except Codex's authenticated loopback MCP channel. Mock managed service
state does not survive a CLI process restart. Use the dedicated
[managed restart example](../../../examples/agent-runtime-managed-restart.ts) for
real process-crash testing against an independent mock service. The local native
Agent mock can restore its saved context. Do not install a no-op SDK transcript
verifier to make an offline recovery appear supported.

The sample uses acknowledged POSIX file/directory fsync. Windows requires a custom
acknowledged control adapter as described in the canonical guide.

The host creates sibling `control`, `workspace` and `transfers` directories under
`$AMOS_DATA_DIR/agent-runtime`; its `reference.json` stays outside writable model
workspaces and transfer roots. Put upload sources in `transfers`; downloaded files
are created there. The offline allowlist is `text/plain`, maximum 1 KiB. The live
example allows `text/plain` and `application/json`, maximum 1 MiB. Library limits,
path checks, no-overwrite rules and native ownership checks still apply.

## Execute, continue and replay safely

Plain text starts a turn. To set a request ID, model, reasoning or output schema,
use explicit JSON; there is no shell evaluation:

```text
/run {"input":"Use probe and return ACK.","options":{"requestId":"demo-1","metadata":{"purpose":"tutorial"}}}
/status
/reference
```

Wait for the `result` frame before another fresh turn. The `run` frame exposes
`runId` immediately. Repeating the exact `/run` command with the same request ID
returns its original run, including after supported restoration; it cannot execute
the tool again. Reusing that ID for different input/options rejects. A fresh ID is
a new task. Input/options are captured at admission; stop signals stay live.

```text
/run {"input":"Continue: use probe again.","options":{"requestId":"demo-2"}}
/result run_REPLACE_WITH_PRINTED_ID
/observe {"runId":"run_REPLACE_WITH_PRINTED_ID","afterSequence":123}
```

`/result` reads/waits for an existing result without sending input. `/observe`
subscribes to the existing run with an optional event cursor. Expired activity emits
`activity-gap`; the saved terminal result remains available. Activity and result
frames expose available usage, errors, native finish reasons, structured output and
artifact references. Events never authorize an action or serve as approval responses.

Per-run controls are endpoint-specific. For a fresh native OneRingAI session, the
following illustrates the complete shape (the offline probe fixture answers plain
ACK; use the [run-options example](../../../examples/agent-runtime-run-options.ts)
for a deterministic schema-producing provider):

```text
/run {"input":"Return a JSON answer.","options":{"requestId":"json-1","model":"gpt-6-astra","reasoning":{"effort":"low"},"responseFormat":{"type":"json_schema","name":"answer","strict":true,"schema":{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}}}}
```

Inspect capabilities first. Claude managed model/reasoning are session-bound and
its schema output is unsupported. OpenAI managed output format is fixed by the
first turn: supply that same format on subsequent `/run` commands, or create a new
session for another format. Model names/efforts are never translated automatically.
Host-selected connector, policy, environment, tools and trusted identity cannot be
replaced through `/run` options. Workspace-file image input remains local and
requires `input.image`; it never silently uploads an image to a managed harness.

## Upload and download explicitly

For either managed mock, complete one turn first, then create `input.txt` inside
the host's `transfers` directory and enter:

```text
/upload {"path":"input.txt","mediaType":"text/plain"}
/download {"reference":"REPLACE_WITH_RESULT_ARTIFACT_REFERENCE","path":"answer.txt"}
```

The output is an `upload` or `download` frame with the acknowledged reference or
saved path/bytes/MIME. Copy artifact references from actual result frames. Arbitrary
URLs, foreign resources, traversal, symlinks and overwrites reject. These commands
never start a model turn. Parent directories must already exist. File operations,
new input and detach cannot overlap; active/uncertain native work blocks transfers.

Local drivers reject managed transfers. OpenAI requires a provisioned hosted
environment for upload. Claude mounts uploaded resources, but a native-tools-denied
profile cannot read their bytes through native filesystem tools; select authorized
native read tools in trusted host code when that is needed. File references do not
prove model visibility, business completion or that a download happened. A lost
upload response requires original-intent reconciliation/cleanup, never an automatic
second upload. Native retention and expiry still apply.

## Stop, detach, restore and clean up

- `/stop` or Ctrl-C invalidates queued text and `/run` commands, cancels pending
  admission, then requests native cancellation. A requested stop does not prove
  termination. The original run may require recovery.
- `/detach` releases supported observation/writer ownership while managed work
  continues. `/exit` or EOF after detach preserves it.
- `/resume` reattaches the remembered reference. After an attached managed observer
  fails, it detaches that failed handle and reobserves the original execution.
- `/resume {"version":1,"id":"session_REPLACE_WITH_PRINTED_ID"}` selects a locator
  only while detached. Scope/accounts/policy still come from trusted host options.
- `/delete` explicitly requests owned-session/resource/control cleanup. It can stop
  attached work. Success clears reference persistence; failure retains the reference
  and never treats uncertain effects as safe to replay. Borrowed environments survive.
- `/delete {"version":1,"id":"session_REPLACE_WITH_PRINTED_ID"}` cleans a saved
  locator while detached. An attached different session must first be detached.
- `/new` starts a fresh session while detached. It does not delete earlier resources;
  copy `/reference` before abandoning a session that still needs recovery/cleanup.
- `/exit`, EOF or SIGTERM with an attached handle requests stop and releases the
  runtime. Ctrl-C is a stop request and leaves the interactive CLI open.

The sample host atomically saves the latest locator in `reference.json` and loads
it on restart. Use the same private data directory, host-authorized accounts and
trusted owner. You can override the starting locator explicitly:

```bash
AMOS_DATA_DIR=/absolute/private/amos-data node --import tsx apps/amos/dist/index.js \
  --runtime-host apps/amos/examples/runtime-host.ts \
  --runtime-resume '{"version":1,"id":"session_REPLACE_WITH_PRINTED_ID"}'
```

`--runtime-resume` requires runtime-host mode. References grant no authentication
or workflow/ModelTask authority. A failed restore/setup retains its original locator
and keeps the CLI available for inspection, repair, `/resume` or `/delete`; it does
not submit another prompt. Native Codex/Claude history restore additionally requires
a trusted `verifyNativeCheckpoint` implementation that proves complete native state.
The sample defaults reject that restore until the host supplies a verifier. Preserve
its original data rather than probing recovery by launching a task.

## Real providers and troubleshooting

Real mode is prepared but has not been run under the project's live pause. A user
who intentionally chooses billable provider execution must set `AMOS_RUNTIME_LIVE=1`,
`ONERINGAI_ALLOW_LIVE=1`, `AMOS_RUNTIME_DRIVER` and the corresponding `OPENAI_API_KEY`
or `ANTHROPIC_API_KEY`. Keys are read only by named Connectors. ChatGPT/Claude
subscription sign-ins are not consumed. Edit the trusted host for account scopes,
reviewed model/effort profiles, native tools, checkpoint verification or other backends;
no raw SDK options or credentials are accepted from command JSON.

| Message/frame | Host/user response |
| --- | --- |
| Unsupported model/reasoning/schema capability | Inspect actual capabilities; use a supported per-run option or a fresh host-selected binding. |
| Transfer disabled/unsupported | Configure the host's transfer callback and a supporting managed profile; do not upload a workspace path as a URL. |
| `recovery-required`, unresolved input/effects | Retain the original reference/run ID, repair storage/source evidence, then resume that execution. |
| Writer already held | Detach/close its existing observer; do not remove a live lock to start another writer. |
| SDK checkpoint verifier required | Preserve native transcript data and implement trusted verification; do not resend the task. |
| `reference-save-error` | Copy `/reference`, repair host locator storage, then `/save`. After a `deleted` frame, `/save` retries clearing the locator without repeating native deletion. |
| `activity-gap` | Read `/result`; missing activity is not proof of failure or completion. |
| Native `/context`, `/routing`, `/routine`, `/helpers`, `/model` rejected | Use standard AMOS mode for native Agent internals; runtime mode preserves the external harness's ownership. |

For multi-tenant applications replace the example's single local owner with an
authenticated host principal and scoped connector registry. Keep bootstrap code,
reference storage and transfer roots outside model control. This example adds no
OS tenant sandbox or distributed lease service.
