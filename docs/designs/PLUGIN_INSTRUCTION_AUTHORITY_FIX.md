# Plugin instruction authority correction

Date: 2026-11-08. Originally implemented on `codex/provider-instruction-authority`,
then explicitly merged into main. Included in `2.0.0-beta.2`; see the
[beta.2 validation/publication record](../evaluations/BETA2_RELEASE_VALIDATION_2026_11_08.json).

## Scope and authorization

The user confirmed that the existing contributor API provides the needed
instruction/data separation and requested documentation instead of another
placement API. The specific behavioral correction was explicitly authorized:

> “we need to absolutely fix the LLM vendor adapters so that system instructions
> go to system instructions!!! So openai should be a reference basically”

This approval covers preserving canonical developer instruction authority in
vendor requests. It does not authorize changing plugin defaults, adding a
placement API, changing saved sessions, or implementing another roadmap stage.

## Correction and compatibility

- OpenAI Responses remains the reference: top-level instructions and canonical
  developer messages remain in their existing channels.
- Ordinary and native Anthropic requests share extraction into `system`.
  Gemini GenerateContent and Vertex use `systemInstruction`; Gemini Interactions
  uses `system_instruction`. DeepSeek's existing system/Responses mappings remain.
- Extraction combines top-level instructions first, followed by developer text
  in input order. It does not mutate input, deduplicate text, parse user payloads,
  or lift tool results or signed continuation state into instructions.
- The affected Claude/Gemini adapters reject non-text developer blocks with
  `InvalidConfigError` before image conversion or model dispatch. Supported user multimodal
  content keeps its existing path. The base converter rejects a developer role
  that reaches conversation-role mapping rather than silently demoting it.
- **Behavioral upgrade:** legacy plugin `getContent()` on ordinary Claude,
  Gemini and Vertex gains its intended instruction authority. Consumers must
  review untrusted dynamic views and explicitly register contributors where
  appropriate. The native Anthropic path already extracted developer text.
- Public signatures, default plugin/contributor selection, shared tools,
  permission ownership, compaction contracts, and session formats are preserved.
  External SDK/managed harnesses retain their own context ownership.

Existing contributor controls are documented, not changed: omitted `instructions`
inherits plugin guidance; a string replaces it; `null` or an explicitly present
`undefined` suppresses it. Contributions replace only the legacy content prompt
view with selected JSON user data. Unregistering restores the legacy trusted
view. Protected task/evidence/instruction sources remain protected. Selection
budgets, revision tracking and host callback reattachment remain required.

## Documentation and AMOS handoff

The canonical [plugin prompt authority guide](../PLUGIN_PROMPT_AUTHORITY.md)
contains method routing, examples, exact message location, selection limits,
provider mapping and upgrade guidance. README, User Guide, AGENTS, context
assembly, examples index, generated public/full API docs, Version 2 Guide and
Unreleased notes link or describe the existing controls. Internal links are
relative.

The [offline example](../../examples/plugin-instructions-and-data.ts) exercises
legacy placement, trusted override, selected JSON data, suppression and
unregistration through public exports. It is included in `examples:offline` and
can run alone with `npm run example:plugin-authority` after building. No API key
or provider calls are needed; the context is destroyed on exit.

AMOS inherits the shared provider correction. Its existing whiteboard-selection
configuration already registers a contributor. AMOS README and User Guide now
explain this control and distinguish stable-prefix layout from authority. No new
application setting or parallel provider/tool pipeline is necessary.

## Validation

Regression coverage checks OpenAI as the reference, Claude ordinary/native,
Gemini GenerateContent/Interactions, Vertex SDK requests and DeepSeek Chat.
Tests retain user JSON containing instruction-like text, tool call/result
relationships, instruction order and input immutability. They cover unsupported
developer content, string/empty input, contributor override/inheritance/suppression,
unregister behavior, native signed state, generation/stream/batch payloads and
native token-count requests.

Two existing mock integration fixtures were corrected to inject temporary
storage explicitly instead of relying on an unused environment variable and
writing under the local agent directory. A stale one-argument instruction-store
call was corrected to the existing keyed signature. Production storage is unchanged.

Final checks on 2026-11-08:

| Check | Result |
| --- | --- |
| `npm run build` | Pass; generated registries and 33 package export files verified |
| `npm run typecheck` and `npm run lint` | Pass |
| `npm run test:unit -- --maxWorkers=4` | 9,401 tests / 428 files pass, including provider authority and AMOS coverage |
| Provider/context focused regression run | 2,321 tests / 94 files pass before the final batch test addition |
| Three mock context integration suites | 84 tests pass; persistence uses isolated temporary storage |
| `npm run examples:check` and `npm run test:agentic:compat` | Pass against the built public package |
| `npm run examples:offline` | All 28 examples pass, including the new authority example |
| `npm run example:plugin-authority` | All six routing checks are true |
| `npm run docs` and `npm run docs:full` | Both API references regenerated |
| `npm run docs:check` | Relative links/anchors, 512 TypeScript blocks and ten complete public examples pass |

The sandbox blocks local HTTP/WebSocket listeners and tsx CLI IPC. Standard build,
docs, full-unit and offline-example commands therefore used approved local access;
this did not enable live provider suites. A concurrent package rebuild temporarily
removed files needed by AMOS CLI subprocess tests; the final full-unit run above
ran after the build and passes without that race. Generated tool implementation
hashes were refreshed by the normal runtime-source registry generator; tool
definitions themselves are unchanged.

No live LLM calls, provider billing, package publication, merge or push are included
in this work.

## Review corrections — 2026-11-08

The subsequent requested review found that malformed JavaScript developer text
values could be coerced by string joining or silently skipped. The shared
extractor now rejects non-string text with `InvalidConfigError`. Seven regression
cases failed before the fix and pass afterward, covering both input/output text
block types. Provider-level tests confirm the error survives normal error mapping
without dispatching an SDK generation request on Claude, both Gemini endpoints
and Vertex. Existing valid string inputs retain their behavior.

The unsupported-content regression now places a user image before the invalid
developer image and explicitly verifies no image fetch occurs. Positive user-image
tests ensure supported multimodal data remains in conversational content. The
offline example now maintains its legacy token cache and computes/asserts all six
reported checks, including source retention. The guide gives the minimal two-call
registration and explicitly accepts plain text inside the existing JSON envelope.
The user selected retaining that envelope; no format option or new API is added.

The broader run also exposed a pre-existing AMOS task-state fixture cleanup race:
recursive removal could overlap queued session journal writes. That fixture now
tracks its created contexts and awaits pending session/journal writes after
synchronous destruction, matching the existing AMOS test teardown pattern.
Production lifecycle and storage behavior are unchanged.

Final review checks pass: build/export verification, types, lint, 9,416 unit tests
across 428 files (including the corrected AMOS fixture), the 2,329-case focused
provider/context/mock-integration run, example typechecking, built-package
compatibility, and all 28 offline examples. The expanded SDK/image boundary
checks also pass independently (118 tests across four provider files). Both API
references were regenerated. Documentation validation checks relative links and
anchors in 157 Markdown files, 512 TypeScript blocks and ten complete public
examples. No live provider calls were made.

## Current authoring documentation handoff — 2026-11-08

At the user's request, README and User Guide now teach the contributor-based
authoring pattern only. The README includes a complete small plugin and actual
Agent execution; the User Guide adds revisioned updates, state validation and
restoration, selection budgets, tools, source retention and cleanup. Both register
the same instance as plugin and contributor and leave `getContent()` returning
`null`. Duplicate content-injection tutorials and manual preparation before managed
execution were removed. Custom-store and whiteboard examples use contributors;
whiteboard manual setup disables automatic creation to avoid duplicate registration.

Deprecated plugin/store tutorials and tool-name migration were moved to
`docs/LEGACY_CONTEXT_PLUGINS.md`. Existing entry anchors remain for migration links,
but the main guides no longer teach those APIs. AGENTS, the examples index,
assembly/authority guides, Version 2 Guide and release notes point to current
authoring guidance. Runtime/defaults and public signatures are unchanged; no
AMOS runtime update is needed for this documentation-only adoption pattern.

`npm run examples:check`, `npm run example:custom-context-plugin`,
`npm run docs:check` and `git diff --check` pass. The new offline example verifies
five conditions through public APIs: trusted instructions, plain-text user context,
updates reaching managed streaming, context snapshot/plugin-state restoration,
and shared ToolManager identity. It cleans up its agent/connector and makes no
network/model calls or file writes. It is included in the offline example list.
Documentation checks validate 500 TypeScript blocks, 12 complete examples against
the built public package, and relative links/anchors in 158 Markdown files. No
additional live tests or release is claimed.
