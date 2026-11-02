# MCP integration

OneRingAI's `MCPRegistry` and `MCPClient` connect to local stdio or remote
HTTP/HTTPS MCP servers. Discovered functions become ordinary tools on the Agent's
shared ToolManager. This is distinct from provider-hosted MCP configured through
`nativeTools`; those requests use provider/data-handling controls.

See the [User Guide](USER_GUIDE.md#mcp-model-context-protocol) for the extended
client API and the [tool permissions chapter](USER_GUIDE.md#tool-permissions) for
current policy precedence. Import from `oneringai`.

## Connect, register, and clean up

The library installs its MCP client dependencies. Install or provision the server
separately; the example uses `npx` to launch a selected filesystem server and may
need network access to obtain it. Restrict the directory to the intended workspace.

```typescript
import { Agent, Connector, MCPRegistry, Vendor } from 'oneringai';

Connector.create({
  name: 'openai-main', vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});
const client = MCPRegistry.create({
  name: 'workspace', transport: 'stdio',
  transportConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  },
});
const agent = Agent.create({
  connector: 'openai-main', model: 'gpt-4.1',
  permissions: {
    // Supply your application's actual approval dialog here.
    onApprovalRequired: request => promptForToolApproval(request),
  },
});
try {
  await client.connect();
  client.registerTools(agent.tools);
  console.log((await agent.run('List the workspace files.')).output_text);
} finally {
  client.unregisterTools(agent.tools);
  await client.disconnect();
  agent.destroy();
}
```

`promptForToolApproval` is host code returning an `ApprovalDecision`. It must
make an actual authorization decision; rendering an activity event is not approval.
Tool names are sanitized for provider compatibility: the default namespace
`mcp:workspace:read_file` becomes `mcp_workspace_read_file`. A custom
`toolNamespace` changes that prefix. Inspect the actual registered names rather
than guessing them in permission rules.

Keep each client alive while its tools may execute. `client.callTool()` accesses
the MCP client directly and does not run the Agent ToolManager pipeline. Use
`agent.tools.execute()` for manager enforcement; raw tool execution has the same
bypass distinction as other ToolFunctions.

## Remote servers

```typescript
const remote = MCPRegistry.create({
  name: 'crm', transport: 'https',
  transportConfig: {
    url: 'https://mcp.example.com/api',
    token: process.env.MCP_TOKEN,
    timeoutMs: 30_000,
    reconnection: {
      maxRetries: 5,
      initialReconnectionDelay: 1_000,
      maxReconnectionDelay: 30_000,
    },
  },
});
await remote.connect();
remote.registerTools(agent.tools);
// Later, after active tool work has settled:
remote.unregisterTools(agent.tools);
await remote.disconnect();
```

Keep credentials in trusted host configuration and out of prompts. For this
client's HTTP abort timeout use `transportConfig.timeoutMs`; the top-level
`requestTimeoutMs` option is not currently applied to requests. Reconnection
restores a transport, not proof that a previous remote action failed. Do not
blindly repeat a write after a timeout/disconnect.

## Configuration files and registry lifecycle

```json
{
  "version": "1.0",
  "mcp": {
    "servers": [{
      "name": "workspace",
      "transport": "stdio",
      "transportConfig": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
      },
      "autoConnect": true,
      "permissions": { "defaultScope": "session", "defaultRiskLevel": "medium" }
    }]
  }
}
```

```typescript
const clients = await MCPRegistry.loadFromConfigFile('./oneringai.config.json');
// Select clients according to your host policy; load does not connect them.
for (const client of clients) {
  await client.connect();
  client.registerTools(agent.tools);
}
// Application shutdown, after agent/tool work has settled:
await MCPRegistry.disconnectAll();
MCPRegistry.destroyAll();
```

`loadFromConfigFile()` interpolates environment values and creates clients.
`connectAll()` connects every disconnected registered client; it does not filter
on `autoConnect`. Connect individually when that flag matters to your host.
The registry also provides `get`, `has`, `list`, `getInfo`, and `getAllInfo`.

## Discovery and observation

- Tools: `listTools()`, `callTool()`, `registerTools()`, `unregisterTools()`.
- Resources: `listResources()` and `readResource()`.
- Prompts: `listPrompts()` and `getPrompt(name, args)`.
- Health/lifecycle: `connect()`, `disconnect()`, `reconnect()`, `isConnected()`, `ping()`.
- Events: `connected`, `disconnected`, `reconnecting`, `failed`, `error`,
  `tool:called`, and `tool:result`. Sanitize sensitive arguments/results before logging.

Resource subscriptions are currently unavailable: the client does not populate
negotiated resource-subscription capability or wire the SDK resource-update
notification. Do not promise `subscribeResource()` or `resource:updated` works.

`getState()` returns local diagnostic/subscription metadata. `loadState()` restores
the local subscription URI set and connection-attempt counter; it does not
restore a live transport, negotiated capabilities, tools, or server session, and
`connect()` does not replay subscription requests.

The public transport union is `stdio | http | https`. A custom MCP SDK transport
cannot currently be injected merely by implementing its interface; it needs a
separately implemented library adapter or direct SDK integration.

## Choosing servers and examples

Use the [MCP Registry](https://registry.modelcontextprotocol.io/) and a server's
own documentation for installation, authentication, permissions, and maintenance.
The [reference servers](https://github.com/modelcontextprotocol/servers) are
protocol examples, not a blanket production endorsement. Legacy reference
packages should not be assumed to be actively maintained official integrations.

The [examples index](examples/README.md) documents the repository's MCP examples
and exact commands. The [complete User Guide](USER_GUIDE.md#mcp-model-context-protocol)
contains multi-server, error-handling, configuration, and event recipes.
