# Tool outcomes and cancellation

Stage 02 adds semantic execution diagnostics and cancellation to the existing shared
`ToolManager`. Available on the `version2` branch; this does not identify a published
package release. Existing tools, raw return values, session formats, and defaults
remain supported.

## Read an outcome without changing a raw result

```typescript
import type { ToolExecutionOutcome } from '@everworker/oneringai';

// agent is an existing Agent; agent.tools === agent.context.tools.
const { result, outcome } = await agent.tools.executeWithOutcome('lookup', {}, {
  callId: 'host-call-1',
  runId: 'host-run-1',
});
console.log(result);         // Existing raw tool return value
console.log(outcome.status);

const observe = (value: ToolExecutionOutcome) => console.log(value);
agent.tools.on('tool:outcome', observe);
// Remove the listener when the host component is torn down:
agent.tools.off('tool:outcome', observe);
```

`execute(name, args, options?)` still returns the raw value. The additive
`executeWithOutcome(name, args, options?)` returns `{ result, outcome }`. Both use
the same pipeline, permissions, and breaker. The optional third argument accepts
`signal`, `timeoutMs`, `callId`, `runId`, and optional host `onOutcome` observer;
these options never come from model arguments. Observer exceptions are contained.
Thrown managed execution errors remain `ToolExecutionError`, with optional
`error.outcome`. Not-found/disabled validation errors retain their earlier behavior
and do not represent a started execution.

Every outcome has a unique `executionId`, tool name, start time, duration, status,
`executionStarted`, `completion`, and `cancellation`. Host call/run IDs are included
when supplied. Manager deadlines include their actual `timeoutMs` when they expire.
Outcomes contain no result body, arguments, user ID, token, or account ID. Treat
error text as potentially sensitive application data when forwarding diagnostics.

| Status | Meaning |
| --- | --- |
| `succeeded` | The pipeline produced a value without a framework-owned failure marker. |
| `failed` | The tool/pipeline threw, or the library normalizer produced a failure for a thrown error or missing result. |
| `denied` | The permission pipeline rejected execution. |
| `timed_out` | A manager deadline expired, or the library normalized a `ToolTimeoutError`. |
| `cancelled` | The host/context signal stopped this invocation's wait. |

An arbitrary application object containing `success: false`, `error`, or another
false-valued field is **not** automatically an execution failure. For example,
`{ success: false, value: 'a business decision' }` remains successful domain data.
Tools that want to report an execution failure should throw a meaningful error.
The built-in normalizer still returns its existing `{ success: false, error, ... }`
shape for exceptions and missing results. Its failure provenance is held separately
from the returned object, so it cannot be mistaken for an application payload.
Removing the normalizer retains throwing behavior; custom plugin recovery and
short-circuit return contracts remain supported.

## Cancellation is local evidence

A tool can use its existing optional `ToolContext.signal`:

```typescript
import type { ToolFunction } from '@everworker/oneringai';

const read: ToolFunction = {
  definition: {
    type: 'function',
    function: { name: 'read', parameters: { type: 'object', properties: {} } },
  },
  execute: async (_args, context) => {
    context?.signal?.throwIfAborted();
    const response = await serviceConnector.fetch('/resource', {
      signal: context?.signal,
      timeoutScope: 'operation',
      timeout: 15_000,
      retryPolicy: 'safe',
    }, context?.userId, context?.accountId);
    return response.json();
  },
};
```

`serviceConnector` is a named connector created by the host. No new tool parameter
is mandatory. Agent retains the existing `ToolManager.execute()` extension point.
A legacy override that bypasses the framework pipeline keeps its raw behavior;
the Agent does not invent semantic metadata for it. Each managed invocation
snapshots trusted user/account bindings,
roles, identities, and the connectors accessible through its registry before awaiting
plugins. Registry reads inside the tool stay bound to the original resolved connector
instances even if the host changes user, account bindings, registry, or ambient tenant.
The host registry stays live for later admissions, including bindings installed after
Agent construction. Custom synchronous registries must enumerate accessible names
correctly after their normal warmup; capture resolves those names without copying
credentials. Missing connectors remain hidden; authentication/configuration errors
retain their original errors. ID lookup remains optional and resolves captured instances.
Newly registered connectors become available to future invocations.
It receives a distinct composed signal; the manager never installs a per-call
signal into shared context. Pre-aborted calls cannot start the tool. Listener and
deadline resources are disposed when the caller's wait finishes.

`timeoutMs: 0` disables the additional per-call deadline. An existing positive
`toolExecutionTimeout` safety net still applies. When both are positive, the earlier
deadline wins. Without either, no manager deadline is added. No automatic tool
retry is introduced.

`completion` describes **local execution**:

- `not_started`: the tool function was never entered. This does not describe side
  effects performed independently by a custom plugin or external service.
- `unknown`: the caller stopped waiting while the execution remained unsettled.
- `settled`: the local pipeline has resolved or rejected.

`cancellation: requested` means the signal was aborted. `acknowledged` means the
settled tool/pipeline rejected with that reason or an `AbortError` while aborted.
It confirms local acknowledgment, never remote rollback or prevention of a write.
A timeout, aborted HTTP request, or locally settled rejection cannot establish
whether a remote write happened. Check external state before retrying an uncertain
operation. Tools that ignore signals can continue running; JavaScript promises
cannot be forcibly terminated by this manager.

`tool:outcome` fires once for the caller-visible execution outcome. If an abandoned
execution settles later, `tool:late-complete` reports the original IDs and eventual
local classification. It does not return the late body, inject it into conversation,
retry it, or increment execution counters again. Late diagnostics are suppressed
after manager destruction. The new diagnostic listeners cannot turn a successful
operation into a failure by throwing.

## Agent integration and accounting

Managed `run()`, `stream()`, and externally driven Agent tool calls supply call/run
IDs automatically. `agent.cancel()` now requests cancellation of active tools in
that execution. It remains cooperative and does not guarantee interruption of an
already-running model request or hosted provider tool. `cancelAsyncTool()` and
`cancelAllAsyncTools()` also signal the corresponding background invocations.

`ToolResult.outcome` and `ToolExecutionDoneEvent.outcome` are optional, additive
fields. Normalized execution failures retain raw content but are reported as failed
results; streaming events include their semantic error. Application `success:false`
data remains completed data. `tool:complete` means the pipeline returned; inspect
its result state/outcome rather than assuming that event name means success.

`ToolResult.pending` marks an async acceptance placeholder. Its existing content
and state remain compatible, but it no longer counts as successful completion.
Final background results update their originating execution counters once. Results
are dropped before delivery if the tracked invocation was cancelled/replaced or its
trusted user/account/registry scope changed. A subsequent run cannot rebind a
pending or already-settled queued call. Internal queue delivery checks scope again
before mid-loop injection, manual continuation, and automatic continuation. A reentrant
continuation/injection listener can invalidate that delivery; an invalidated continuation
throws before sending the body to the model. Injection notifications retain their
existing ordering and input visibility; invalid pending input is cleared after
reentrant callbacks, including callbacks that throw. Explicit `continueWithAsyncResults(results)` remains
trusted host input. Hosts must continue to scope agents, memory backends, and external
identities correctly; arbitrary code inside a noncooperative tool remains the
host's responsibility.

Each invocation also retains its selected implementation, definition, and permission
metadata through plugin/approval waits. Re-registering the same name affects future
calls. Its existing cumulative registration counters include admitted old and subsequent
new calls; unregister/reinsert creates a new counter record. No second permission
pipeline is introduced.

Tool usage, success/failure metrics, and Agent run/stream counters reflect semantic
outcomes. Stream settlement is counted before its completion event, including fail mode
and early consumer return. Unprocessed calls in a partially consumed batch are not
counted, and conversation call/result groups are appended only when the batch finishes.
Timeouts retain their separate Agent timeout counter. Throwing async completion/error/
timeout observers are logged and contained; they cannot replace the original result,
count it twice, or strand continuation. **Circuit-breaker policy is unchanged**: it still observes legacy promise
settlement, including normalizer recovery and eventual settlement after the caller
stopped waiting. Correcting diagnostics does not silently make normalized failures
trip a breaker. Async deadlines keep the earlier manager safety net as well as the
existing per-tool/async deadline. Async delivery still uses the existing follow-up
message mechanism.

Signals, active controllers, execution provenance, and late diagnostics are
process-local. No new durable outcome store, resumable effect ledger, or session
migration is introduced. Saved context/configuration continues to load; resuming
it does not resume an old JavaScript operation or reconstruct an outcome journal.

## Connector deadlines and retry boundaries

`Connector.fetch()` and `fetchJSON()` honor `RequestInit.signal` alongside connector
timeouts. Host cancellation remains effective after headers during native body
reads and interrupts token waits and retry backoff. Shared OAuth refresh work is
not forcibly aborted, but a cancelled caller cannot send a request after its token
wait finishes. Caller-supplied user/account arguments remain bound to the request.

| Option | Default | Behavior |
| --- | --- | --- |
| `timeoutScope` | `headers` | Existing per-attempt header timeout; token resolution, retry delays, and later body reads are outside that timeout. Caller cancellation still applies. |
| `timeoutScope: 'operation'` | Opt in | One deadline through token waiting, retries/backoff, and body consumption/cancellation. Consume or cancel the response body. |
| `retryPolicy` | `legacy` | Existing retry configuration for network errors/statuses. |
| `retryPolicy: 'safe'` | Opt in | Retry eligible GET/HEAD/OPTIONS only; never replay POST/PUT/PATCH/DELETE after an uncertain failure/status. |
| `skipRetry: true` | Opt in | Skip both network-error and retryable-status retries, as the existing option documents. |

Whole-operation responses retain status, headers, URL/type/redirect metadata and
standard body readers/streaming/clone behavior, including chained clone metadata and
native consumed/locked-body checks. Cloned branches share the operation deadline.
Safe retry cleanup observes caller cancellation and the operation deadline even when
body cancellation waits on another tee branch; an abort cannot dispatch another attempt. Their deadline is disposed when
body reading finishes, fails, or is cancelled; an unread body remains subject to
its deadline. Connector success/breaker counters still describe the header-level
fetch result. A later body failure is observed by its reader/tool; it does not
retroactively change those legacy counters.

Generic connector API tools forward `ToolContext.signal`. Specialized tools, MCP
transports, subprocesses, and application tools cancel underlying work only where
their implementation forwards/observes that signal. Provider-hosted tools and
external agent drivers have independent lifecycle controls. Do not infer universal
remote cancellation from this local capability. Connector origin/redirect policy,
durable evidence, and effect recovery remain separately scoped later work.

## Run the demonstrations and validation

After `npm run build`:

```bash
npm run example:tool-outcomes
npm run example:amos-tool-outcomes
```

Both are offline and need no credentials. The library example uses an ephemeral
loopback server; no external write is made. It shows unchanged domain/failure
payloads, cooperative and noncooperative deadlines, correctly correlated late
completion, and cancellation while reading an HTTP body. Managers, connectors,
and the loopback server are cleaned up. The AMOS example uses the same real local
outcomes and renders explicit uncertainty. Its recorded
[offline output](./evaluations/STAGE_02_AMOS_OFFLINE.txt) shows the exact messages.
AMOS displays semantic failures in both
run modes, and its cancellation notice does not claim a remote write was prevented.

`npm run test:tools:live` is explicitly opt-in and billable. It uses `.env` OpenAI,
Anthropic, and Google keys with local deterministic tools. Missing/rejected keys
fail validation rather than silently passing. Existing Stage 00/01 compatibility
and live suites remain separate. See the
[corrective validation record](./evaluations/STAGE_02_CORRECTIONS_VALIDATION.json)
for the earlier corrective checks and limitations. The
[original validation](./evaluations/STAGE_02_VALIDATION.json) remains historical.

### Explicit Anthropic tool selection

For an explicit named local-function choice, Anthropic requests advertise that
function and retain any configured native tools. Other registered local functions
remain available to later `auto`/`required` calls. Existing messages, tool metadata,
caller definitions, and the shared ToolManager are preserved. This works around
an observed API response that selected a different advertised tool despite a
named choice. [Anthropic documents named tool choice](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#forcing-tool-use)
as selecting a specific tool; supported models/settings still apply.

The provider checks local tool names in both generated and streamed responses.
A mismatched call raises the existing `ProviderError` before it reaches local
execution, with the selected and returned names in the message. No automatic
retry, call renaming, execution of the unexpected tool, or model switch is added.
Earlier completed iterations and already emitted stream text are not rolled back.
This does not add deduplication or a guarantee about provider-hosted side effects;
batch result consumption retains its existing caller-owned execution boundary.
Ordinary `auto`/`required` choice, native-tool configuration, refusal handling,
and the existing unsupported-setting and on-demand compaction behavior remain.

To select successive tools in both managed modes, mutate `context.options` inside
`before:llm` and return `{}`. Streaming retains its existing hook return semantics.
After building, set `ANTHROPIC_API_KEY` in `.env` and opt in to the billable example:

```bash
npm run example:tool-outcomes -- --live-anthropic
```

It runs the offline examples first, then real `run()` and `stream()` calls through
a named connector. Each mode must report exactly `domain_probe=succeeded` and
`failure_probe=failed`, and recover both markers. All agents and the example-owned
connector are cleaned up. The domain probe's `success: false` remains valid data.
