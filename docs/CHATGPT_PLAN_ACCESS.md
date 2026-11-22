# ChatGPT plan access

Beta.4 adds opt-in ChatGPT plan access to the existing OpenAI text provider.
Version `2.0.1-beta.0` adds a Node.js sign-in module at `oneringai/auth/openai`.
Production OAuth admission and
account eligibility still require live verification with an eligible account.

## Hosea: authorize once for every OpenAI agent

Choose **Continue with ChatGPT** in first-run setup or in
**Connections → Manage models**. Authorize Hosea and enable ChatGPT plan usage in
the browser. First-run setup loads the selected account's model catalog before
creating the default agent. This is one registration for
Hosea's selected account/workspace, not a registration for every Agent instance.
All OpenAI model agents use the selected account, including existing saved agent
configurations, new conversations and orchestrated workers. Other vendors retain
their own credentials.

Hosea provides a `hosea-chatgpt` model connection (with a suffix if that name is already in use) when no API key is configured.
Existing OpenAI connection names continue working; their saved API keys remain
available for an explicit switch back to API-key billing. ChatGPT plan access
always uses the public OpenAI endpoint, independent of a connection's API-mode
base URL. Model discovery uses the selected account's current catalog.

Idle open chats checkpoint and rebuild against the selected account on their next
turn, registering plugins before loading their state. Conversation/plugin state
and the tab identity are retained. Active, paused and pending asynchronous work
must settle before changing accounts. Provider-bound opaque history can prevent
transfer: its checkpoint is preserved and the host must use its original account
or start a fresh chat. An account change never authorizes replay of a tool action.

Use the account picker to switch registrations or add another account/workspace.
The registrations stay separate even when their email addresses match. Use
**Continue with ChatGPT** on a disconnected registration to reconnect it without
creating a new client. **Sign out** revokes and clears that registration's tokens,
but retains its client mapping and installation identity. Failed remote revocation
is reported with a link to ChatGPT's controls.

Signing out, revocation, missing consent and usage limits do **not** switch agents
to API-key billing. **Use configured API keys** is a separate user action.
**Manage usage** opens <https://chatgpt.com/settings/usage>. Subscription allowances
and available credits are controlled by OpenAI; API price estimates do not describe
the user's subscription charge.

Media/voice operations use their explicitly configured API-key connectors, even
while model agents use the plan. A ChatGPT-only connection is excluded from those
selectors. It does not supply image/video generation, TTS, transcription, realtime
voice or embeddings credentials.

## Library integration

`ChatGPTPlanAuth` runs OpenAI's public-client flow for eligible local open-source
apps. Give it your app's name, a system-browser opener and an app-owned protected
store. It starts a loopback listener, registers the client, verifies the signed
identity and granted permissions, renews credentials, and creates an ordinary
OpenAI connector bound to a specific registration. Check OpenAI's [eligibility
and integration options](https://developers.openai.com/siwc/quickstart) for other
app types.

```typescript
// Documentation check: complete example
import { Agent } from 'oneringai';
import { ChatGPTPlanAuth, type OAuthSessionStorage } from 'oneringai/auth/openai';

export async function initializeChatGPT(
  storage: OAuthSessionStorage,
  openBrowser: (url: string) => Promise<void>,
) {
  const auth = new ChatGPTPlanAuth({ applicationName: 'My App', storage, openBrowser });
  await auth.initialize();
  return auth;
}

export async function connectChatGPT(
  auth: ChatGPTPlanAuth,
  connectorName: string,
  model: string,
  savedAccountId?: string,
) {
  // Call signIn in response to the user choosing Continue with ChatGPT.
  const account = await auth.signIn({ accountId: savedAccountId });
  if (!account.planEnabled) return { account };
  const connector = auth.createConnector(connectorName, account.id);
  const agent = Agent.create({ connector: connector.name, model });
  return { account, connector, agent };
}
```

On restart, read `auth.status().accounts` after `initialize()` and bind a
known account directly with `createConnector`. Each connector captures its
account ID, so multiple registrations can serve independent agents. To restrict
your app to a single active account, call `selectAccount()` or pass `select: true`
when signing in, then create connectors with `{ requireSelected: true }`. A
change to that selection blocks credential use by stale guarded connectors.
For app-wide billing changes, use `assertCanChange` to check that agents are idle
and have the app hold new model work until the change settles.
Destroy agents and remove owned connectors when finished. `cancel()` or a sign-in
`signal` cancels pending authorization before the credential commit.

Implement `OAuthSessionStorage.load()` and `save()` on the trusted host. Treat the
snapshot as opaque secret material containing account and installation state.
Use a protected store with atomic replacement and a single owner process and
manager per snapshot. Return `null` for a fresh installation and report read or
write errors to the manager. OneRingAI waits for storage acknowledgment before
using rotated credentials. It serializes refreshes for each account and blocks
credential dispatch after a persistence failure. The app owns its UI, account
selection, storage backend and billing choice. `signOut(accountId)` revokes and
clears that account's tokens, retains its registration for later sign-in, and
returns a warning when remote revocation could not be confirmed.
After a storage failure, repair the store and recreate the manager to reload it.

Build from the repository and run `npm run example:chatgpt-plan -- --live` to
authorize and run a single prompt in a [standalone Node CLI](../examples/chatgpt-plan-cli.ts).
The example uses an ephemeral in-memory store and signs out on exit. Pass a model
and prompt after `--live` to override the defaults. The live example uses the
selected account's plan allowance or available credits.

### Host-managed credentials

An application supplies its own validated OAuth registration and rotating access
token when it already has an authorization implementation or runs its Agent in a
browser build. Select the narrower request contract explicitly on the OpenAI
connector.

```typescript
// Documentation check: complete example
import { Agent, Connector, Vendor } from 'oneringai';

export function createAssistants(
  profileId: string,
  getAccessToken: () => Promise<string>,
  model: string,
) {
  Connector.create({
    name: 'chatgpt-shared',
    vendor: Vendor.OpenAI,
    auth: { type: 'api_key_provider', getApiKey: getAccessToken },
    options: { openaiAuthMode: 'chatgpt-plan', openaiAccountId: profileId },
  });
  return [
    Agent.create({ connector: 'chatgpt-shared', model, instructions: 'Research the topic.' }),
    Agent.create({ connector: 'chatgpt-shared', model, instructions: 'Review the findings.' }),
  ];
}
```

Both agents share credentials; each retains its own context, tools and lifecycle.
The callback must remain bound to this registration. Refreshing credentials for the
same registration is allowed; replacing its account underneath an Agent is not.
`openaiAccountId` is secret-free host identity, not an authorization claim from the
model. Recreate agents with compatible checkpoints after account changes. Destroy
agents during teardown. The library does not automatically apply this connection
to unrelated applications or connectors; the global selection is Hosea's host policy.

For this lower-level integration, the host owns OIDC signature/issuer/audience/nonce verification, granted scopes,
protected storage, serialized rotating refreshes, logout and permission revocation.
A valid identity alone does not grant `chatgpt.tokens.use.direct`. Never copy Codex
CLI credentials or use a ChatGPT `backend-api` endpoint for this flow.

## Request and capability boundaries

The profile uses `POST https://api.openai.com/v1/responses` with `store: false`,
`stream: true` and complete required context. `agent.run()` collects that HTTP
stream internally; `agent.stream()` preserves the ordinary events. Explicit
incomplete results remain incomplete. Truncated streams and late error events do
not become successful answers. Function/custom tools use one provider namespace
without changing their application names, shared ToolManager or permissions.

Unsupported explicit options fail before dispatch, including temperature,
`max_output_tokens`, metadata, background mode and `previous_response_id`.
Hosea omits its saved API-mode temperature setting while the plan is selected;
it does not delete that setting. An explicit hard output cap or bounded helper
configuration is incompatible: use a separate API-key connector for that helper.
Task deadlines/call admission remain available; no per-request output cap or
subscription monetary ceiling is invented. Missing usage remains unverified.

Local tools, MCP clients, context plugins, working memory, task logic and local
orchestration retain their ordinary APIs. Hosted tool search, hosted MCP, Code
Interpreter, file search, native computer use and image generation are unsupported.
Account/model policy still controls web search. Native compaction, batch APIs,
realtime/other OpenAI APIs and external runtime harnesses require separate
compatible credentials. File IDs from the Files API and audio/video inputs are not
accepted; hosts can supply document contents through their local tools/readers.

## Storage and validation

Hosea uses `ChatGPTPlanAuth` with its existing protected storage and applies the
selection to all of its OpenAI agents. It keeps the host ID, per-registration identity and tokens in an atomic,
OS-encrypted `chatgpt/accounts.enc` record under `HOSEA_DATA_DIR` (default
`~/.hosea`). ChatGPT tokens never enter the renderer, connector JSON, session
checkpoints, logs or analytics. Unavailable OS encryption, Linux's `basic_text`
backend, unreadable credentials and failed persistence fail closed. A single
Electron instance owns each app profile to avoid refresh-token races. Design
preview uses its isolated data directory and disables real sign-in.

Run the focused app tests with `npm --prefix apps/hosea run test:design`.
After building the library and app, `npm --prefix apps/hosea run test:chatgpt:electron`
runs the real Electron/main/preload/Agent paths against an isolated offline mock:
signed fixture identities, fake OS encryption and synthetic Responses streams.
It never uses real credentials or inference. Actual eligibility, production OAuth
admission and live model/tool support still need an authorized account smoke test.

## OpenAI references

- [Availability and integration choices](https://developers.openai.com/siwc/quickstart)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts, refresh and logout](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Current preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

The published flow supports eligible open-source/local applications and selected
private clients. Paid or remotely hosted products require separate OpenAI access.
Hosea's local integration does not grant access to a user's ChatGPT conversations.
