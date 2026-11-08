# Plugin instructions and context data

**Creating a new plugin?** Follow [the authoring walkthrough](../USER_GUIDE.md#creating-context-plugins)
and [offline example](../examples/custom-context-plugin.ts). They implement a plugin
and contributor on the same class, return `null` from `getContent()`, and register
both roles on `agent.context`. The routing and compatibility details below explain
the full existing contract.

The existing contributor API already separates plugin instructions from data.
No placement option or new plugin interface is required. **Ordinary plugin
content remains instruction content unless the host explicitly registers a
context contributor for that plugin.** Review that distinction before putting
retrieved documents, profiles, model-written notes, or user input in a plugin.

## Which output goes where

| Source | Canonical destination | Meaning |
| --- | --- | --- |
| Agent `instructions` / context `systemPrompt` | Instruction channel | Host-selected application guidance |
| Plugin `getInstructions()` | `developer` message | Trusted usage guidance; never put untrusted source strings here |
| Plugin `getContent()`, without a contributor | `developer` message | Legacy prompt view, including dynamic plugin data |
| Registered `ContextContributor.contribute()` blocks | Separate JSON `user` message | Selected observations; never instructions or authorization |
| Contributor with no `instructions` property | Plugin's `getInstructions()` remains in `developer` | Keep existing trusted usage guidance |
| Contributor `instructions: '...'` | Replaces that plugin's usage guidance in `developer` | Explicit trusted host override |
| Contributor `instructions: null` | No usage guidance from this plugin | Does not remove framework guidance, tools, or tool descriptions |
| Actual tool results | Their existing result messages/blocks | External observations; never lifted into the instruction channel |

The override is presence-based: **omit** the `instructions` property to inherit.
An explicitly present `undefined` value also supplies no usage text; use `null`
for intentional suppression. A returned `ContextBlock` cannot choose a role or
provide host instructions. The host registration owns that decision.

Only `getContent()` is replaced by contribution. Plugin state, tools, permissions,
compaction, and persistence keep their existing contracts. Source methods such as
`getContents()` and `getState()` are not automatically rendered. Calling
`unregisterContextContributor(name)` restores the legacy `getContent()` view
**and its instruction placement**; it is not a way to keep content as user data.

## Use the existing API

For an existing whiteboard:

```typescript
import {
  AgentContextNextGen,
  createInContextMemoryContributor,
  type InContextMemoryPluginNextGen,
} from 'oneringai';

const context = AgentContextNextGen.create({
  model: 'gpt-4o-mini',
  features: { workingMemory: false, inContextMemory: true },
});
try {
  const whiteboard = context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
  whiteboard.set('source', 'Retrieved observation', 'Source text is data.');
  context.registerContextContributor(
    whiteboard.name,
    createInContextMemoryContributor(whiteboard),
  );
  context.addUserMessage('Summarize the observation.');
  const prepared = await context.prepare();
  console.log(prepared.input, context.lastPreparation?.selection);
} finally {
  context.destroy();
}
```

For a custom plugin, register an explicit companion with `getRevision()` and
`contribute(request)`. Given an existing agent and plugin, these two calls keep
the plugin's `getInstructions()` as instructions and send its contribution as
user-context data:

```typescript
agent.context.registerPlugin(plugin);
agent.context.registerContextContributor(plugin.name, {
  getRevision: () => 1, // Change the revision when the source data changes.
  contribute: () => [
    { id: 'customer', text: 'Customer: Alice\nPlan: Pro' },
  ],
});
```

`text` accepts ordinary prose, Markdown, or code. Pass text directly; call
`JSON.stringify()` only when converting an object to text. The framework adds
the outer JSON envelope containing source IDs and text strings. No new format
option is required, and plugin usage instructions remain inherited because the
companion above omits `instructions`.

The [offline custom-plugin example](../examples/plugin-instructions-and-data.ts)
demonstrates the legacy view, trusted instruction replacement, JSON data,
instruction suppression, and unregister behavior:

```bash
npm run build
npm run example:plugin-authority
```

Expected output contains six `true` checks. No credentials, network requests, or
model calls are used; resources are destroyed on completion. In an application,
register the companion on `agent.context` between executions, then use `run()` or
`stream()` normally. Do not manually prepare the same managed turn first.

Registration uses the enabled plugin's `name`, such as `in_context_memory`, not
its feature key (`inContextMemory`). `assembly.contributors` configures the same
companions at context creation. A similarly named method on a plugin is never
automatically invoked. Read [selective context assembly](CONTEXT_ASSEMBLY.md) for
the complete configuration and lifecycle contract.

## Message location, encoding, and limits

Selected blocks use the existing envelope:

```json
{
  "type": "context_data",
  "authority": "data_only",
  "blocks": [{ "id": "research_context/document", "text": "Source observation" }]
}
```

The data message follows the instruction prefix and precedes conversation/history
and current input. It is **not** prepended to the last user message. The original
user message and attachments are not rewritten, and the selected view is not
added to saved conversation history. `layout: 'stable-prefix'` changes prompt
ordering for cache-aware layout; it does not demote unregistered plugin content.

Selection is bounded: `maxDataTokens` defaults to 2048, including the envelope.
Optional blocks may be omitted/projected; a mandatory protected closure that
cannot fit fails explicitly. This is not an unconditional move of every byte
from `getContent()` to a user message. Supply an appropriate budget, expose
retrieval for omitted sources, and inspect `lastPreparation.selection`.

Revisions must track content, scope, permission, and selection-policy changes.
Contributor callbacks and host policy are not restored from session JSON;
reattach them when recreating/loading plugins. Names `task_state`, `evidence`,
and `persistent_instructions` remain protected from contributor replacement.
Registration does not bypass those safeguards or any ToolManager permission.

JSON keeps source strings structurally separate from surrounding metadata. It
does not prove their truth, prevent semantic prompt injection, or grant action
authority. Keep real tool results in their real protocol blocks; never invent a
tool call to carry plugin data. XML tag names do not change message authority.

This also applies to built-in plugin views. For example, the memory plugin wraps
profiles, facts and remembered behavior rules in a data-marked XML block, but its
legacy `getContent()` still enters the developer message. The delimiter is a
prompt cue, not a lower-authority channel. A host that needs role separation can
register a custom companion and keep only host-approved guidance in its trusted
`instructions`. Do not promote retrieved rules merely because a source labels
them as rules.

## Provider instruction mapping

Canonical `MessageRole.DEVELOPER` is OneRingAI's provider-neutral instruction role.
It does not mean an ordinary user message on providers without that literal role.

| Provider / endpoint | Instruction representation |
| --- | --- |
| OpenAI Responses, and providers using its converter | Top-level `instructions` plus original `developer` messages |
| Anthropic Messages, including native compaction | Top-level `system` |
| Gemini GenerateContent and Vertex AI | `systemInstruction` |
| Gemini Interactions | `system_instruction` |
| DeepSeek Chat | `system` messages |
| DeepSeek Responses | Responses-style `instructions` and `developer` messages |

For adapters that combine instructions into one field, top-level `instructions`
come first, followed by canonical developer text in input order. Those developer
messages are removed from conversational input. User data, tool results, and
opaque continuation state are not promoted. Claude/Gemini instruction fields
accept text through this adapter; non-text developer blocks fail with
`InvalidConfigError` instead of being silently discarded or demoted. Supported
user multimodal content is unaffected. Malformed developer text values also fail
with `InvalidConfigError` instead of being coerced or omitted. No instruction
deduplication is performed.

**Unreleased correction (2026-11-08):** ordinary Claude, Gemini, and Gemini
Interactions previously downgraded canonical developer messages to user input;
Vertex inherited the Gemini behavior. The adapter correction preserves the
intended instruction role, using OpenAI as the reference. Existing legacy plugin
data therefore gains its intended instruction authority on these paths. Review
untrusted `getContent()` views and select contributors where appropriate before
upgrading. OpenAI behavior, plugin signatures/defaults, contributor placement,
tool execution, and session formats are unchanged. This is a behavioral fix,
not another verified npm release.

The mapping applies to managed and direct calls through these providers; direct
calls do not run context plugins automatically. AMOS uses the shared providers.
External Codex/Claude SDK or managed harnesses retain their own context ownership
and do not implicitly run OneRingAI contributors. Signed provider continuation
state is never rewritten to repair an instruction mismatch; follow
[native recovery](NATIVE_CONTEXT_COMPACTION.md) if a provider rejects an old binding.

Provider references: [OpenAI instruction roles](https://developers.openai.com/api/docs/guides/text#message-roles-and-instruction-following),
[Claude system field](https://platform.claude.com/docs/en/api/messages/create),
[Gemini system instructions](https://ai.google.dev/gemini-api/docs/text-generation#system-instructions).
