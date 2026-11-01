# Version 2 review — 2026-11-01

Status: **all six findings corrected on branch** after the user's “fix all” instruction.
The findings and initial observations below are historical. The correction record
at the end owns the current behavior and validation; no release is implied.

Reviewed branch: `version2`, HEAD `fed745a0ec58e348c791723884a516958cf3a13d`, including the pre-existing uncommitted Codex bridge/configuration fixes and tests. Comparison baseline: local `main` at `6b0654200abee38b81b7850a2953fd985b017980`. This was a review, not an implementation pass. No production files were edited, merged, committed, pushed, or published.

The review concentrated on the new harness-neutral definition/session APIs, all five runtime adapters, host tool authorization, durable control and recovery, file transfers, event handling, and AMOS runtime integration. Shared model-task, routine, evidence, and remote-outcome integration points were also inspected. This is not a claim that every change across the entire Version 2 branch has been exhaustively verified.

## Findings

### R1 — P1: OneRingAI definition sessions silently ignore resolver permission policies

Locations: `src/agent-runtime/drivers/OneRingAIDriver.ts:166–183`; `src/agent-runtime/RuntimeHostTools.ts:85–89,220–229`.

The public `resolveTools` contract accepts a `permissionManager`. The fresh bridge-manager path installs it, but native definition materialization passes only the tool functions into `Agent.create()` and then calls `attachNative()`. That method adopts `agent.tools` without installing the resolver's permission manager. Later `getManager()` returns that existing manager immediately. The native Agent executes the tool through its own manager, so the resolver's blocklist is never evaluated.

**Reproduction:** supply a real `PermissionPolicyManager.fromConfig({ blocklist: ['probe'] })` through `resolveTools`, open an `oneringai.agent` definition session, and use an entirely scripted provider that requests `probe`. The tool executes once and the run completes. The existing authenticated MCP denial test passes, demonstrating that bridge denial does not cover this native materialization path.

**Impact:** switching a logical agent to the native harness can remove a host-provided tool denial silently. `trustAgentPolicy` is an explicit host attestation, but silently discarding the permission manager supplied through the documented resolver is still unsafe. This finding concerns resolver-supplied policies; it does not assert that a separately configured Agent permission policy is bypassed.

**Recommended correction:** enforce the resolver policy through the Agent's existing shared ToolManager, or reject the unsupported combination explicitly before execution. Preserve the single-manager invariant and define precedence if `configureAgent` also supplies a policy. Audit the similarly ignored resolver `toolContext` in this path; only the permission failure was reproduced here.

**Regression gate:** the same resolver blocklist must prevent the side effect for every supported harness. Verify native/context manager identity and preservation of host policy precedence.

### R2 — P1: Claude SDK output redaction misses parsed output and split streaming text

Locations: `src/agent-runtime/drivers/ClaudeAgentSdkDriver.ts:140–143,153–164`.

The driver redacts a complete credential from final `outputText`, but parses `terminal.structured_output` (or the raw `terminal.result` fallback) directly into `outputParsed`. It also redacts each text/thinking delta independently. A credential divided between adjacent chunks does not occur in either individual chunk and is emitted intact when the consumer joins them.

**Reproduction:** a synthetic SDK query emits a dummy connector credential in two adjacent text chunks and in a valid structured result. The run completes; final text is redacted, while both `outputParsed.answer` and the concatenated text deltas contain the complete dummy credential. No actual credential was read or exposed in the probe.

**Impact:** a native output containing the credential can reach application/UI consumers, logs, and persisted control results through surfaces that bypass the driver's existing redaction. This does not imply that the model normally receives the API key; it demonstrates a failure if native output contains it.

**Recommended correction:** use stateful streaming redaction, and sanitize or reject sensitive structured output before publication/persistence. Preserve valid JSON and local schema validation; do not silently corrupt a JSON document or alter unrelated raw tool evidence. The Codex driver's split-update redaction is an existing reference implementation.

**Regression gate:** full and arbitrarily split credential occurrences in message/reasoning events, structured output and raw-result fallback; verify sanitized output remains valid against the requested schema or fails explicitly.

### R3 — P1: OpenAI managed recovery accepts expanded native resource access

Location: `src/agent-runtime/drivers/OpenAIManagedDriver.ts:329–342`.

`assertOwner()` checks ownership metadata, instructions, delegation, environment placement, network access, plugins/skills and tool names. It never checks `session.vault_ids` or hosted desktop enablement. Creation explicitly disables desktop access and exposes no public configuration for selecting vaults, but later restore/continuation accepts both additions as long as the checked metadata and fields still match.

**Reproduction:** use the actual OpenAI SDK against the existing synthetic HTTP fixture. Complete a turn, detach, then make canonical session retrieval return an unselected vault and `environment.desktop.enabled: true`, retaining all ownership metadata. `resumeSession()` succeeds and a second native input/tool execution completes. Six canonical responses with expanded configuration were accepted; there were two inputs and two host tool executions.

**Impact:** an out-of-band native configuration change can broaden the restored session's resource access without host authorization. Ownership metadata alone does not establish that the native configuration still matches the approved profile. This probe establishes acceptance of configuration drift, not that a real provider actually disclosed vault contents or used desktop tools.

**Recommended correction:** verify the complete authorization-relevant native profile on creation, reconciliation and before continuation. At minimum reject unselected vaults and enabled desktop access. Keep optional/omitted native fields compatible with the documented API defaults. Audit schema/resource changes too, rather than assuming matching tool names prove identical configuration.

**Regression gate:** tamper with each authorization-relevant field independently; restore and new input must fail before a host action or additional input is dispatched. Include harmless provider-normalized defaults so validation does not reject equivalent configurations.

### R4 — P2: A committed write with a lost acknowledgement permanently stalls the control writer

Locations: `src/agent-runtime/RuntimeSessionStorage.ts:132–138`; actual file-adapter ambiguity at `:114–117`; affected retry path in `src/agent-runtime/DefinitionSession.ts:120–145`.

`RuntimeControl.update()` advances its cached record only when `lease.write()` returns successfully. If storage commits revision N+1 and then throws, the cache remains at N. Subsequent updates all use N and fail optimistic revision checks, even after the storage failure has been repaired. The bundled file adapter has a concrete ambiguity window: it renames the new record into place before opening/fsyncing/closing the parent directory.

**Reproduction:** wrap the real in-memory lease so its first write commits normally and then throws, modeling that post-commit failure. Storage is at revision 2/value 1 while the control cache still has value 0. Both subsequent writes fail with `Runtime session revision conflict` after the wrapper has returned to normal operation.

**Impact:** the documented in-process “retry getRun after storage repair” path cannot persist retained results through this writer. Checkpoints/outbox updates using the same control object also remain blocked. A new observer/process may recover by reacquiring storage; this finding does not claim all recovery is impossible or that the framework automatically repeats the external action.

**Recommended correction:** reconcile ambiguous write failures under the exclusive lease and recover the cached revision without overwriting a different record or treating an unacknowledged fsync as durable success. Retry persistence of retained observations, never the external action that produced them.

**Regression gate:** failures before commit and after commit, including terminal result/outbox settlement; repaired persistence must succeed in process, retain the original run/call identity, and execute the external action exactly once.

### R5 — P2: A recovery result arriving after runtime destruction escapes cleanup

Location: `src/agent-runtime/AgentRuntime.ts:87–91`.

`resumeSession()` checks runtime activity only before awaiting the backend. It then tracks and returns the recovered session even if `destroy()` completed during that await. The corresponding open-session paths have a post-await destruction guard. Because `destroy()` is idempotent and already cleared its session set, a second call does not clean up this late session.

**Reproduction:** use a supported borrowed/custom backend whose resume waits on a gate. Start resume, destroy the runtime, then release the gate. Resume returns a session from an already destroyed runtime; neither the first nor second runtime destruction calls its cleanup. The probe then explicitly cleans up that returned handle.

**Impact:** late recovered observers can outlive runtime/AMOS shutdown, retaining resources or writer leases. This specifically affects asynchronous custom/borrowed backends; the built-in local backend has additional internal activity checks that reduce exposure in its ordinary path.

**Recommended correction:** add a post-await lifecycle guard and safe cleanup of the late observer. Preserve the existing recovery rule that cleanup of a failed observation must not cancel independent remote execution or resubmit input.

**Regression gate:** owned and borrowed backends; destruction before/after resume settles; exactly-once observer cleanup, rejected late recovery, no remote cancellation or input replay.

### R6 — P2: Definition-session shutdown waits indefinitely for stalled admission inspection

Locations: `src/agent-runtime/DefinitionSession.ts:90–91,174–183`.

Admission awaits native `inspectState()` directly. `destroy()` marks the session closed but does not abort the admission controller; it waits for the admission promise before reaching cancellation/cleanup. Even explicit admission cancellation cannot interrupt the pending inspection because the await is not raced with the signal. A never-settling inspection therefore prevents destruction and lease release indefinitely.

**Reproduction:** a synthetic driver's read-only inspection waits on a gate. Start a run, wait for inspection to begin, then destroy the definition session. Destruction remains pending and cancellation has not been invoked until the gate is manually released. Source inspection shows no timeout/abort branch that can otherwise settle it. The probe releases the gate afterward to avoid leaking its own work.

**Impact:** a stalled custom/native state inspection can hang runtime shutdown and therefore AMOS exit. Built-in managed HTTP requests have their own timeout, so this is not a claim that every ordinary provider read hangs indefinitely; it is an unbounded wrapper path for slow or non-cooperative drivers.

**Recommended correction:** abort admission on destruction and make the read-only admission inspection abortable/bounded. Handle its eventual late settlement safely. Keep already accepted native actions under the existing explicit reconciliation rules.

**Regression gate:** stop, destroy and AMOS exit while inspection never settles; bounded observer cleanup and no dispatch of the queued input, including after inspection eventually returns.

## Reproduction and validation

Executable probes: [`v2-review-2026-11-01/probes.ts`](v2-review-2026-11-01/probes.ts).

Captured observations: [`v2-review-2026-11-01/results.json`](v2-review-2026-11-01/results.json).

Run from the repository root with installed dependencies and a current package build:

```bash
node --import tsx docs/evaluations/v2-review-2026-11-01/probes.ts
```

Without a flag the probes retain their original defect assertions; that historical
mode is expected to fail on corrected code. Pass `--expect-fixed` to verify the
corrections and cross-harness permission denial. This writes `fixed-results.json`
without replacing the historical `results.json`. Both modes use dummy credentials,
scripted provider/SDK messages and synthetic managed HTTP transports; neither loads
`.env` or makes provider calls. Public adapter probes use the built public package;
direct control/session probes exercise source implementations. Normal regression
tests now assert the desired behavior in the unit suite.

Validation during this review:

- Runtime adapters and AMOS runtime tests: **166 distinct cases passed**. Initial sandbox execution passed 163; three loopback MCP cases were blocked by `listen EPERM`. The two affected files were rerun with loopback access and all 20 cases in those files passed. This was an environment restriction, not a product test failure.
- Six additional offline probes reproduced all six findings above.
- Additional AMOS integration tests: **173 passed across 21 files** (the three runtime files above were excluded to avoid double-counting). Combined total: **339 distinct existing tests passed across 40 files**.
- `npm run test:agentic:compat`: **passed** against the existing built public package.

No live/billable tests were run during this review. Prior live evidence is in [`LIVE_VALIDATION_2026_11_01.md`](LIVE_VALIDATION_2026_11_01.md). That evidence does not establish live account entitlement or complete production validation for the two managed APIs or Claude SDK. The Codex subscription experiment used a test-only login bootstrap/current-CLI override; it is not a production subscription-auth feature in the API-key-only driver.

## Recommended implementation order

1. R1–R3: close the authorization/redaction gaps, with cross-driver tests.
2. R4: repair ambiguous persistence recovery while proving no repeated external effects.
3. R5–R6: harden late recovery and admission shutdown; exercise AMOS lifecycle commands.

The corrections can be made within the existing manager, storage, driver and lifecycle abstractions. These findings do not justify a new orchestration layer, mandatory consumer migration, or changes to the preserved legacy APIs.

## Correction record

The user authorized all six corrections by replying “fix all”. Public signatures,
saved formats, default harness selection and the single-ToolManager invariant remain.

| Finding | Delivered correction | Evidence |
| --- | --- | --- |
| R1 | Native selected tools evaluate both resolver and Agent policies on the same pipeline. Resolver permissions stay borrowed; native plugin tools keep their own policy. Roles/accounts merge without replacing the native principal, memory or cancellation. | Three native policy/precedence/context regressions; authenticated MCP denial; all-five-harness denial probe. |
| R2 | Codex/Claude share one internal streaming redactor. Claude buffers possible credential prefixes per text/thinking block and sanitizes decoded structured strings/keys before validation, including raw-result fallback. | Character-by-character interleaving, block completion/reuse, escaped JSON values/keys, schema-conflict failure; existing Codex redaction/structured tests. |
| R3 | Creation explicitly selects no vaults. Canonical OpenAI state rejects vault/desktop additions and changed selected function schemas, descriptions or loading configuration before execution/restore. Cleanup still does not materialize executable tools. | Twelve field/phase tamper regressions plus omitted/disabled desktop and reordered-schema compatibility; file/deletion/recovery regressions. |
| R4 | A failed control write retains its exact intent. A later serialized operation checks the exclusive lease, rejects conflicts and obtains a fresh acknowledged write before advancing the cache. Pre-commit failures do not retroactively admit actions. | Before/after-commit outbox and terminal-result failures; repeated acknowledgement loss, conflict protection, restored results and exactly-once side effects. |
| R5 | Late recovery after runtime destruction detaches its observer and rejects; cleanup failure carries the original locator without destructive rollback. | Owned/borrowed backend races and detach failure; independent managed restoration regressions. |
| R6 | Destruction aborts admission; stop/destruction interrupt read-only inspection while observing late rejections. Accepted/mutating operations retain existing reconciliation semantics. | Stop/destroy with stalled inspection and late completion; storage ownership reacquisition; actual AMOS controller exit regression. |

The existing full unit suite plus **33 new cases passed: 9,360 tests in 424 files**.
The rebuilt-package [fixed probes](v2-review-2026-11-01/fixed-results.json) confirm
all six corrections and zero blocked-tool executions through all five adapters.
Build/export identity, source types/lint, public compatibility, example types,
AMOS types/build and generated public API passed. All ten runtime/AMOS examples and
the four-scenario Stage 00 baseline passed. The packed safety, five-harness and AMOS
examples also passed using checkout dependencies; no fresh network install is claimed.
The [validation summary](v2-review-2026-11-01/validation.json),
[example results](v2-review-2026-11-01/examples.json) and
[package check](v2-review-2026-11-01/package-check.json) retain the evidence.
No live/billable calls ran.

Run the correction probes after building:

```bash
node --import tsx docs/evaluations/v2-review-2026-11-01/probes.ts --expect-fixed
npm run example:agent-runtime-safety
```

The direct repository-wide `tsconfig.test.json` command inherits a `src` rootDir
while including all tests and does not pass as configured. A separate focused
test-type probe also encounters existing legacy mock signatures and source/built
private-type identity diagnostics. These are not reported as passing gates; source,
consumer/example/app typechecks and executable regressions are the verified gates.
