# Invocation-owned tool failures

`createOutcomeTool()` is an opt-in helper for tools that catch an operational error
and still return an application-specific value. It returns an ordinary ToolFunction
for the existing shared ToolManager. Existing tools, defaults, callbacks, events
and raw result shapes retain their behavior.

```typescript
import { createOutcomeTool } from '@everworker/oneringai';

const lookup = createOutcomeTool<{ id: string }, { success: boolean; record: unknown }>({
  definition: {
    type: 'function',
    function: {
      name: 'lookup_record',
      description: 'Read a record by ID.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  output: { effect: 'read' },
  execute: async ({ id }, invocation) => {
    try {
      const record = await hostLookup(id, invocation.context?.signal);
      return { success: true, record };
    } catch {
      invocation.reportFailure(new Error('Record lookup is unavailable'));
      return { success: false, record: null };
    }
  },
});
agent.tools.register(lookup);
const report = await agent.tools.executeWithOutcome('lookup_record', { id: '17' });
console.log(report.result); // Original application result.
console.log(report.outcome.status); // failed when the callback reported failure.
```

`hostLookup` and `agent` above are host-owned integration values. Keep authentication
in a named Connector and forward the invocation signal to its requests. A valid
business decline should simply return its data without calling `reportFailure`.
An application field named `success: false` or `error` never opts into this helper.

## Callback and invocation contract

- `OutcomeToolOptions<TArgs, TResult>` preserves normal ToolFunction metadata and
  replaces only the helper's input callback signature. The returned tool still has
  the standard `(args, context?) => Promise<TResult>` execute method.
- `OutcomeInvocation` supplies the existing optional ToolContext through `context`
  and `reportFailure(error: Error): void`. No field is added to ToolContext, tool
  definitions, raw values, or serialized messages. Use a public-safe error message;
  do not include credentials or private transport dumps. Outcomes expose its message,
  without serializing the error object/stack/cause into the model's tool result.
- The first valid report wins for this invocation. Its message is captured when
  reported. A later throw/normalization error remains available as causal pipeline
  diagnostics; the existing thrown/normalized raw contract stays intact.
- Reports become inert once the callback settles, including calls retained by a
  host observer. Invalid JavaScript report input is recorded as an operational
  configuration failure without throwing after an action. Reports do not retry work.
- The manager captures the selected callback before asynchronous admission hooks.
  Re-registration/replacement affects future calls. Identity and account snapshots
  retain the existing admission rules. Normal permission denial runs before the
  callback; reporting an error cannot waive permission or claim an action never ran.
- Calling `tool.execute()` directly runs the callback and returns raw data, without
  a framework outcome to report into. Use the shared manager's executeWithOutcome
  or a standalone ToolExecutionPipeline with onOutcome for semantic diagnostics.

## Results, cancellation and evidence

`execute()` preserves the manager's normal raw return. `executeWithOutcome()` exposes
the same value plus the existing ToolExecutionOutcome. Managed run/stream, background
tools, metrics and AMOS use the existing semantic status. A reported operational
error is `failed`; a business decline with no report remains a succeeded execution.
Neither state proves business completion. Existing normalizers/result plugins keep
their supported transformations; reporting does not bypass them.

Caller cancellation/timeouts retain precedence. An unfinished callback may report
later, but only its original invocation's late diagnostics are updated. A late
failure never changes the caller's frozen initial outcome, enters a later Agent
turn, or increments counters a second time. Cancellation is not rollback.

Existing circuit breakers still observe promise settlement, including recovered
errors; selecting this helper does not change global retry/breaker behavior. Evidence
is separately opt-in. When enabled, its record stores the allowed raw result and
reported semantic status through the existing middleware. Storage/projection failure
does not repeat the source action. See [tool outcomes](TOOL_OUTCOMES_AND_CANCELLATION.md)
and [durable evidence](DURABLE_EVIDENCE.md) for recovery and protection rules.

## Composition and support boundaries

Library ConnectorTools account wrappers preserve the binding and account precedence
for tools created with this helper. Register connector tools through
`agent.tools.registerConnectorTools()` so identity/source filtering remains available.
Returning a helper from an existing registered service factory is supported; C1
does not replace or reclassify the bundled legacy connector tools.

An ordinary object spread retaining the execute function preserves this contract.
Arbitrary decorators that replace execute and call the old method directly are not
certified outcome bridges. Compose logging/error behavior inside the helper callback
or create a new outcome-aware callback explicitly. Private bridge metadata is not
a public extension API or a model-controlled result marker. ESM/CJS and duplicate
package bundles in one process are covered by public-runtime controls.

Legacy portable protocol v2 keeps its old success/error messages and business-result
classifier. A server-observed local failure maps to its existing generic tool_failed
error; it does not send the rich local outcome or raw failed result. This is **not remote outcome
parity**; negotiated remote receipts/evidence remain C7. No new helper changes old
wire keys, status unions, saved sessions, connector auth, or completion verification.
No failure reporter/authority is restored from JSON. Recreate tools from host code
on session load as usual.

## Runnable examples and validation

Build, then run `npm run example:outcome-aware-tools`. It needs no credentials and
returns the same frozen raw payload for a valid decline and an operational failure,
with statuses `succeeded` and `failed`. The manager is destroyed in finally.
`npm run example:amos-outcome-tools` displays those actual outcomes with AMOS's
existing renderer; no command/configuration change is required.

`npm run test:outcome-tools:live` explicitly runs billable, bounded OpenAI, Anthropic
and Google run/stream probes using their `.env` keys. Tools are synthetic local
functions with no external writes. A missing requested provider fails rather than
silently counting a skip as validation. These functional checks establish transport
behavior, not general quality/cost improvements. Full C1 validation is recorded in
the [delivery record](designs/CONSUMER_C1_DELIVERY.md).
