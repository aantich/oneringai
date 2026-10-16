# Bounded recovery and host completion checks

Stage 10 adds an opt-in policy to managed `Agent.run()` and `Agent.stream()`.
It is available on the `version2` development branch once the stage completion
record's validation gates pass. This document does not announce an npm release.

**Correction status:** All five [review findings](designs/STAGE_10_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-16)
are fixed, and the [second review](designs/STAGE_10_SECOND_REVIEW_AND_FIXES.md)
also fixes stale tool-principal completion checks and the recorded Google summary
repair gap. Latest validation passes 7,988 units, 136 live cases / 148 scenarios
across all three providers, and 22 offline examples. Real Google recovery from
the recorded fault is verified; prior records remain historical.
See [latest validation](evaluations/STAGE_10_SECOND_CORRECTIONS_VALIDATION.json).

The existing ToolManager still owns permissions, execution, cancellation, outcome
normalization and evidence. The policy decides whether another managed model turn
is useful, whether a repeated action must stop before execution, and whether the
host's required completion evidence is present. It neither executes a tool itself
nor routes to another model automatically.

## Configure a policy

Use a named connector, host-owned scope and an application-owned verification
source. This example assumes `openai-main` is already configured. The read sets a
local host observation; a production checker should read its authorized durable
artifact/status store and verify the required result independently.

```typescript
import { Agent, ModelTask } from '@everworker/oneringai';

let verifiedArtifact: { id: string; ready: boolean } | undefined;
const agent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-4o-mini',
  maxIterations: 6,
  tools: [{
    definition: {
      type: 'function',
      function: {
        name: 'read_artifact',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    output: { effect: 'read' },
    execute: async () => {
      verifiedArtifact = { id: 'A42', ready: true }; // Replace with authorized read.
      return verifiedArtifact;
    },
  }],
  loopPolicy: {
    maxRecoveryAttempts: 2,
    completion: context => ({
      complete: verifiedArtifact?.ready === true
        && context.observations.some(o => o.toolName === 'read_artifact'
          && o.outcome?.status === 'succeeded'),
      feedback: 'Read and verify artifact A42 before finishing.',
    }),
  },
});
const task = new ModelTask({ limits: { maxCalls: 6 } });
try {
  const response = await agent.run('Verify artifact A42.', { modelTask: task });
  console.log(response.output_text);
  console.log(response.loop); // Workflow check, separate from provider status.
} finally { agent.destroy(); }
```

`AgentConfig.loopPolicy` supplies the default host policy. `RunOptions.loopPolicy`
replaces it for that execution; `null` explicitly disables it. An omitted policy
preserves existing prompts, callbacks, hook traces, event discriminants and
stopping behavior. An empty policy `{}` enables bounded failure/repetition
tracking but does not install a workflow verifier.

Public types are exported through both the root package and `/types`:
`AgentLoopPolicy`, `AgentLoopCheckContext`, `AgentLoopCompletionResult`,
`AgentLoopDiagnostics`, `AgentLoopObservation`, and `AgentLoopReason`.
`agent.getLoopDiagnostics()` returns detached metadata for the active/latest
managed policy execution. The next unconfigured managed execution clears it.
Direct and external executions do not produce policy diagnostics; correlate a
previous managed snapshot by `executionId` rather than assuming it describes a
later direct/external call.

## Bounds and recovery

| Option | Default | Meaning |
| --- | --- | --- |
| `maxRecoveryAttempts` | 2 | Shared allowance for failed steps, stalled progress, repeated reads and unmet completion predicates. Zero permits no feedback retry. |
| `maxRepeatedResults` | 3 | Same normalized read arguments and observation before an intervention. Another identical call is blocked at admission. |
| `maxConsecutiveToolFailures` | 3 | Stop after this many consecutive failed observations. Successful actual executions reset the count. |
| `maxStalledIterations` | 3 | Unchanged `progressKey` samples after the initial sample before intervention. Used only when a key callback is configured. |
| `repeatableReadTools` | `[]` | Host allowlist for intentional repeated read polling. Other bounds still apply. |
| `callbackTimeoutMs` | 10000 | Each completion/progress callback deadline; maximum 60000 ms. |

Integer thresholds are at most 1000; all except the recovery allowance must be
positive. The allowlist has at most 100 nonempty tool names, each at most 256
characters. Invalid configuration is rejected before model or tool dispatch.

A failure, repeated read, unchanged host progress key, or false completion verdict
can append explicitly labeled host feedback for the next model turn. This preserves
the original user input and pending tool-call/result protocol. It asks the model
to choose a safe correction through normal hooks/permissions; it does not replay
the failed tool automatically. Repeated-read admission can stop even after feedback
if the model requests the same unproductive read again. A different read or a
changed argument can proceed within the remaining limits.

Arguments and results are normalized as strict JSON with sorted object keys and
SHA-256 fingerprints. Each fingerprint input is bounded to 64 KiB. Unfingerprintable
read results do not count as identical. An action whose arguments cannot be safely
fingerprinted stops before dispatch. At most 1000 admissions (including pending
async calls), distinct call signatures and actual observations/failure identities
are tracked per execution. Reaching a tracking bound stops before another managed
dispatch. This is bounded
syntactic tracking, not a semantic equivalence or distributed idempotency system.

Framework outcomes determine failure. Application data such as `{success:false}`
remains successful execution data unless the framework outcome reports failure.
Permission/argument failures count toward recovery but do not invent a tool
execution receipt. Tools should declare `output.effect: 'read'` only for actual
reads. Write and unknown effects use conservative admission: a previously
admitted identical action cannot execute again in the same policy execution,
including duplicates in one model response. A recorded `not_started` outcome can
release that admission. An absent authentic outcome or an `unknown` completion
for a write/unknown effect stops with `uncertain_effect`.

These checks do not prevent semantically equivalent actions with different
arguments, actions in another execution/process, or writes disguised as reads.
Never repeat an external action to repair evidence, task-state or policy storage.
Verify uncertain writes through host-authorized remote status/idempotency support.
Durable resumption/idempotency middleware and parallel scheduling remain deferred.

## Host completion and progress callbacks

Pending completion/progress verdicts are rejected if user/account, selected
connector accounts/identities, roles, session or connector-registry scope changes.
The checker must start again under the new host scope; old authority cannot
confirm it. This guard is internal and adds no callback/session fields.


Policy callbacks are captured once per execution and invoked with the original
host policy as their receiver. Class/prototype methods, private fields, own methods,
arrow and already-bound functions are supported. Numeric thresholds and read
allowlists are copied; changing them or replacing a callback during a run takes
effect on a later execution. Keep mutable verification state host-controlled.

`completion(context)` returns `{ complete, reason?, feedback? }`. Only a true host
verdict yields policy `status: 'completed'`. A successful model response, accepted
submission, settled tool call or plausible final text alone does not establish
workflow completion. Without a completion callback, a final answer yields
`reason: 'answer_returned'` without a workflow completion status.

The callback receives a detached, frozen packet containing:

- Execution ID, main-loop iteration count and candidate `outputText`, bounded to
  32768 characters with `outputTruncated`.
- The last 100 actual execution observations: tool name, call ID, declared effect
  and authentic outcome metadata without error details or raw tool arguments/body.
  `observedToolCalls` and `observationsTruncated` expose omission explicitly.
- The full bounded built-in task-state snapshot if enabled, including its host
  scope/revision. This snapshot is data for checking, not permission to mutate it.
- `signal`, combining execution cancellation, explicit ModelTask cancellation and
  this callback's timeout. Forward it into host reads/helpers.

The complete packet has a 1 MiB serialization bound. A result must be strict JSON,
at most 16 KiB, with only `complete`, `reason` (at most 400 characters), and `feedback`
(at most 2000 characters). Accessors/custom serialization are rejected. Callback
errors and timeouts stop with sanitized `checker_error`; they never justify an
external replay. Asynchronous callbacks that ignore cancellation may continue
running locally, but late verdicts cannot confirm this execution. JavaScript
timeouts cannot preempt a synchronously blocked event loop: callbacks must be
cooperative, read-only checks.

`progressKey(context)` returns a host state/version string, at most 4000 characters.
It is sampled after tool batches. Prefer an artifact revision or task state key.
An unchanged key is a heuristic for intervention; it does not prove failure.
The model's changing prose is not a host progress source. The same timeout,
cancellation and stale-view rules apply. Task generation (including same-revision
restore), plugin identity, owner and conversation/input identity must still match
after an awaited callback, or the verdict stops with `state_changed`.

Host callbacks own their authorization and semantic correctness. They must not
change task state, dispatch effects or accept model-provided scope as authority.
Verdicts describe the state at the check; subsequent host/backend edits require
fresh verification. A verdict is not an atomic commit with a remote system.
For evidence payloads, use an explicitly scoped host backend or the evidence
plugin's bounded retrieval. Keep backend errors and secrets out of feedback.
An optional verifier helper still requires explicit `invokeHelper` configuration
and the same explicit `modelTask` when sharing a budget. There is no automatic
helper call or implicit budget inheritance.

## Diagnostics and lifecycle

`LLMResponse.loop`, existing `response.iteration.complete` events and existing
`response.complete` events carry optional `AgentLoopDiagnostics`. Provider
`response.status`/stream status retain their existing meanings, so inspect `loop`
for host workflow status. There are no new event discriminants or task statuses.

| Reasons | Host interpretation |
| --- | --- |
| `completed` | Configured host predicate passed. |
| `answer_returned` | Turn returned an answer; no workflow predicate configured. |
| `predicate_unmet`, `tool_failures`, `repeated_results`, `no_progress` | Recovery in progress, or a bound stopped it. |
| `recovery_exhausted`, `iteration_limit`, `budget_exhausted` | Input/host intervention required within the configured limit. |
| `repeated_action`, `uncertain_effect` | Inspect/reconcile the action before another execution. |
| `pending_async`, `suspended` | Existing `waiting_external` status; no host completion assertion. |
| `checker_error`, `state_changed`, `provider_incomplete` | Check/candidate cannot establish completion. |
| `refusal`, `provider_failed`, `cancelled` | Terminal execution condition; no predicate-driven safety retry. |

`phase` distinguishes running, recovering, complete, input-needed and stopped.
Completion metadata may retain an earlier false verdict when a later bound stops
the execution. A blocked diagnostic returns existing response/event shapes; model
budget/provider/cancellation exceptions continue using their existing error path,
with latest diagnostics available from the getter. Optional diagnostics are not
a durable effect ledger or a required session field.

Existing `maxIterations`, tool deadlines, permission checks and ModelTask limits
remain in force. An opted-in policy stops at its iteration bound without an extra
unbudgeted model wrap-up. Count actual model calls from the ModelTask: empty
retries, JSON repairs and the existing suspension wrap-up are separate attempts.
Suspension keeps the existing `run()` checkpoint/correlation behavior and graceful
tool-free wrap-up; it does not invoke the completion predicate. Streaming retains
its existing SuspendSignal support boundary. Async work is not silently cancelled
or repeated: a final candidate while work is outstanding reports `pending_async`.
`continueWithAsyncResults()` starts a new configured policy execution and checks
authentic delivered outcomes; admission counters are fresh. Normal `run()` queue
injection uses the same importer before another main-model dispatch or completion
check. Authentic deliveries retain the effect selected at invocation admission,
even if that name is replaced/unregistered or an observer omits the optional
outcome from the original result. Execution identities deduplicate same-run
settlements and repeated deliveries within the receiving execution. Imported
failures respect the same failure/recovery limits. Legacy results without retained
admission metadata use receipt effect or `unknown`, never the current registration;
missing outcomes for a possible action block conservatively. This process-local
correlation does not grant persisted transcripts async delivery authority.

Run and stream share response/empty-retry decisions and opted-in before-tool
preparation, effect admission, feedback and predicate checking. **With a policy,
streaming invokes `before:tool` skip/modified-argument hooks through shared
preparation.** Unconfigured streaming retains its legacy trace, which omits that
hook. Streaming chunks remain provisional and can include an earlier rejected
candidate. Final policy metadata describes the last candidate; text chunks cannot
be retracted. Structured-output final repair remains `run()` only, and its checker
sees the actual repaired candidate. Formatting after a tool-induced stop appends
a separate final answer, preserving exact calls, arguments and results. Normal
policy stops commit settled input to conversation before returning/completion
events, without another main-model call or duplicate journal entries. This keeps
ordinary and protected results available to the next input and file checkpoint.
An early stream close before that boundary still uses the existing settled-batch
retention path. Evidence failures require storage repair/acknowledgement; none of
these paths authorizes replay of the action.

Execution leases still prohibit overlapping managed/direct/external operations.
Closing the owning `Agent.stream()` generator ends that execution; settled
unstored evidence remains protected. Detaching an AgentRuntime event observer
does not own cancellation of its runtime run. `runDirect`/`streamDirect`, direct
ToolManager calls, realtime sessions and external SDK-owned loops are outside
this text-loop policy. Their hooks/permissions and lifecycle remain unchanged.
Provider-native/remote internal effects are not individually tracked by the local
policy; use host verification rather than inferring those effects from text.

Policy callbacks and counters are process-local host/runtime configuration. They
are not stored in or restored from sessions. Loading conversation state into the
same live agent retains its configured callbacks and latest diagnostic; creating
a fresh agent requires explicitly supplying its policy. Configured task/evidence
plugins keep their own existing durable scope/checkpoint behavior. A saved model
claim or policy-like transcript text never installs a callback or confirms work.

## Examples, AMOS and validation

Build first, then run these deterministic, credential-free examples:

```bash
npm run example:feedback-agent
npm run example:loop-equivalence
npm run example:amos-loop
```

The first rejects premature prose, recovers one failed read and verifies the
artifact/receipt. The second compares semantic hook/action traces. The AMOS
example uses its real runner, `/context loop`, a blocked checkpoint and a fresh
host-supplied verifier. Each cleans up agents/connectors and temporary files.

AMOS accepts optional JSON `loopPolicy` thresholds/allowlists in configuration;
it has no default policy. Embedders can call host-only
`AgentRunner.setLoopPolicy(policy | null)` when idle. The override stays in memory
and is not saved as checker authority. `/context loop` displays phase, stopping
reason, recovery and diagnostic JSON. Stream progress uses optional `loop`
metadata on the app's existing notification surface, and final responses carry
it on existing done events. These notices are rendered separately from assistant
prose; missing evidence produces input-needed information, not a fabricated
approval request. Existing adapters may omit the optional inspector/setter.

`npm run test:loop:live` explicitly makes billable OpenAI, Anthropic and Google
calls using `.env`. Its synthetic reads exercise bounded recovery and refused
completion in both modes. Host-selected tool steps make this a functional wiring
test, not a free-planning benchmark or general quality/cost improvement claim.
See the [implementation/validation record](designs/STAGE_10_IMPLEMENTATION.md)
and [Version 2 adoption guide](VERSION_2_GUIDE.md) for current gates and limits.
