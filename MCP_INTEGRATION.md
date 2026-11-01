# MCP (Model Context Protocol) Integration

## Overview

The `oneringai` library now includes seamless integration with the [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol), enabling automatic discovery and registration of external tools from MCP servers.

## Architecture

The integration uses the official `@modelcontextprotocol/sdk` package and provides:

- **MCPRegistry**: Static registry for managing MCP client connections (similar to Connector pattern)
- **MCPClient**: High-level wrapper around the SDK's Client class
- **MCPToolAdapter**: Automatic conversion of MCP tools to ToolFunction interface
- **Config**: Global configuration system for declaring MCP servers
- **Auto-reconnect**: Exponential backoff retry with health monitoring
- **Namespacing**: Tools prefixed with `mcp:{server}:{tool}` to prevent conflicts
- **Permission Integration**: All MCP tools go through the permission approval flow

## Quick Start

### 1. Install Dependencies

```bash
npm install @modelcontextprotocol/sdk zod
```

### 2. Basic Usage

```typescript
import { Connector, Agent, Vendor, MCPRegistry } from 'oneringai';

// Setup LLM connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create MCP client
const client = MCPRegistry.create({
  name: 'filesystem',
  transport: 'stdio',
  transportConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  },
});

// Connect to MCP server
await client.connect();

// Create agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
});

// Register MCP tools with agent
client.registerTools(agent.tools);

// Use the agent (MCP tools are now available)
const response = await agent.run('List files in the current directory');
```

### 3. Configuration File

Create `oneringai.config.json`:

```json
{
  "version": "1.0",
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "displayName": "Filesystem Server",
        "transport": "stdio",
        "transportConfig": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
        },
        "autoConnect": true,
        "toolNamespace": "mcp:fs",
        "permissions": {
          "defaultScope": "session",
          "defaultRiskLevel": "medium"
        }
      }
    ]
  }
}
```

Load configuration:

```typescript
import { Config, MCPRegistry, Agent } from 'oneringai';

// Load config
await Config.load('./oneringai.config.json');

// Create all MCP clients
const clients = MCPRegistry.createFromConfig(Config.getSection('mcp')!);

// Connect all with autoConnect enabled
await MCPRegistry.connectAll();

// Create agent and register tools
const agent = Agent.create({ connector: 'openai', model: 'gpt-4' });

for (const client of clients) {
  if (client.isConnected()) {
    client.registerTools(agent.tools);
  }
}
```

## Features

### Tool Discovery

MCP tools are automatically discovered when connecting to a server:

```typescript
await client.connect();

console.log(`Available tools (${client.tools.length}):`);
client.tools.forEach((tool) => {
  console.log(`  - ${tool.name}: ${tool.description}`);
});
```

### Tool Namespacing

Tools are namespaced to prevent conflicts:

```typescript
// Default namespace: mcp:{server-name}:{tool-name}
// Example: mcp:filesystem:read_file

// Custom namespace
MCPRegistry.create({
  name: 'fs',
  toolNamespace: 'files',
  // ...
});
// Tools will be: files:read_file, files:write_file, etc.
```

### Auto-Reconnect

Automatic reconnection with exponential backoff:

```typescript
const client = MCPRegistry.create({
  name: 'filesystem',
  transport: 'stdio',
  transportConfig: { /* ... */ },
  autoReconnect: true,              // Enable auto-reconnect (default: true)
  reconnectIntervalMs: 5000,        // Initial delay: 5s (default)
  maxReconnectAttempts: 10,         // Max attempts (default: 10)
  healthCheckIntervalMs: 60000,     // Health check every 60s (default)
});
```

### Event Monitoring

Monitor connection and tool execution:

```typescript
client.on('connected', () => console.log('Connected to MCP server'));
client.on('disconnected', () => console.log('Disconnected'));
client.on('reconnecting', (attempt) => console.log(`Reconnecting (${attempt})...`));
client.on('failed', (error) => console.error('Connection failed:', error));

client.on('tool:called', (name, args) => {
  console.log(`Tool called: ${name}`, args);
});

client.on('tool:result', (name, result) => {
  console.log(`Tool result: ${name}`, result);
});

client.on('error', (error) => console.error('MCP error:', error));
```

### Resources

Access server resources:

```typescript
// List available resources
const resources = await client.listResources();

// Read a resource
const content = await client.readResource('file:///path/to/file');
console.log(content.text);

// Subscribe to resource updates (if supported)
if (client.capabilities?.resources?.subscribe) {
  client.on('resource:updated', (uri) => {
    console.log(`Resource updated: ${uri}`);
  });

  await client.subscribeResource('file:///watch/this/file');
}
```

### Prompts

Use server-defined prompts:

```typescript
// List available prompts
const prompts = await client.listPrompts();

// Get a prompt
const promptResult = await client.getPrompt('summarize', {
  length: 'short',
});

console.log(promptResult.messages);
```

## Available MCP Servers

Official MCP servers from `@modelcontextprotocol`:

- **@modelcontextprotocol/server-filesystem** - File system access
- **@modelcontextprotocol/server-github** - GitHub API integration
- **@modelcontextprotocol/server-google-drive** - Google Drive access
- **@modelcontextprotocol/server-slack** - Slack workspace integration
- **@modelcontextprotocol/server-postgres** - PostgreSQL database access
- And many more...

See https://github.com/modelcontextprotocol for the full list.

## Configuration Reference

### MCPServerConfig

```typescript
interface MCPServerConfig {
  name: string;                    // Unique identifier
  displayName?: string;            // Human-readable name
  description?: string;            // Server description
  transport: 'stdio' | 'http' | 'https';     // Transport type
  transportConfig: TransportConfig;
  autoConnect?: boolean;           // Connect on startup (default: false)
  autoReconnect?: boolean;         // Reconnect on failure (default: true)
  reconnectIntervalMs?: number;    // Reconnect delay (default: 5000)
  maxReconnectAttempts?: number;   // Max attempts (default: 10)
  requestTimeoutMs?: number;       // Request timeout (default: 30000)
  healthCheckIntervalMs?: number;  // Health check interval (default: 60000)
  toolNamespace?: string;          // Tool prefix (default: 'mcp:{name}')
  permissions?: {
    defaultScope?: 'once' | 'session' | 'always' | 'never';
    defaultRiskLevel?: 'low' | 'medium' | 'high' | 'critical';
  };
}
```

### Stdio Transport Config

```typescript
interface StdioTransportConfig {
  command: string;                 // Command to execute (e.g., 'npx', 'node', 'python')
  args?: string[];                 // Command arguments
  env?: Record<string, string>;    // Environment variables
  cwd?: string;                    // Working directory
}
```

### HTTP/HTTPS Transport Config

```typescript
interface HTTPTransportConfig {
  url: string;                     // HTTP(S) endpoint URL
  token?: string;                  // Bearer token (supports ${ENV_VAR})
  headers?: Record<string, string>; // Additional HTTP headers
  timeoutMs?: number;              // Request timeout (default: 30000)
  sessionId?: string;              // Session ID for reconnection
  reconnection?: {
    maxReconnectionDelay?: number;         // Max delay (default: 30000)
    initialReconnectionDelay?: number;     // Initial delay (default: 1000)
    reconnectionDelayGrowFactor?: number;  // Growth factor (default: 1.5)
    maxRetries?: number;                   // Max retries (default: 2)
  };
}
```

## API Reference

### MCPRegistry

Static registry for managing MCP clients:

```typescript
// Create a client
const client = MCPRegistry.create(config);

// Get a client
const client = MCPRegistry.get('filesystem');

// Check if exists
if (MCPRegistry.has('filesystem')) { ... }

// List all
const names = MCPRegistry.list();

// Get server info
const info = MCPRegistry.getInfo('filesystem');
const allInfo = MCPRegistry.getAllInfo();

// Load from config file
const clients = await MCPRegistry.loadFromConfigFile('./config.json');

// Lifecycle
await MCPRegistry.connectAll();
await MCPRegistry.disconnectAll();
MCPRegistry.destroyAll();
```

### MCPClient

High-level MCP client wrapper:

```typescript
// Lifecycle
await client.connect();
await client.disconnect();
await client.reconnect();
const isConnected = client.isConnected();
const alive = await client.ping();

// Tools
const tools = await client.listTools();
const result = await client.callTool('read_file', { path: './README.md' });
client.registerTools(agent.tools);
client.unregisterTools(agent.tools);

// Resources
const resources = await client.listResources();
const content = await client.readResource('file:///path');
await client.subscribeResource('file:///path');
await client.unsubscribeResource('file:///path');

// Prompts
const prompts = await client.listPrompts();
const prompt = await client.getPrompt('name', { args });

// State
const state = client.getState();
client.loadState(state);

// Cleanup
client.destroy();
```

## Examples

See `examples/mcp/` directory for complete examples:

- **basic-client.ts** - Basic MCP client usage (stdio transport)
- **http-client.ts** - HTTP/HTTPS remote server example
- **multi-server.ts** - Multi-server configuration
- **resources.ts** - Resource subscriptions and prompts

## Error Handling

```typescript
import {
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPProtocolError,
  MCPToolError,
  MCPResourceError,
} from 'oneringai';

try {
  await client.connect();
} catch (error) {
  if (error instanceof MCPConnectionError) {
    console.error('Connection failed:', error.message);
  } else if (error instanceof MCPToolError) {
    console.error('Tool execution failed:', error.toolName);
  }
}
```

## Transport Support

### Available Transports

1. **Stdio** - Process spawning for local MCP servers
   - Best for: Local development, filesystem access, local tools
   - Example: `@modelcontextprotocol/server-filesystem`

2. **HTTP/HTTPS** - StreamableHTTP for remote MCP servers
   - Best for: Remote services, cloud-hosted servers, production deployments
   - Features: Built-in reconnection, session management, OAuth support
   - Uses Server-Sent Events (SSE) for receiving messages, HTTP POST for sending

### HTTP/HTTPS Transport Example

```typescript
const client = MCPRegistry.create({
  name: 'remote-server',
  transport: 'https',
  transportConfig: {
    url: 'https://mcp.example.com/api',
    token: process.env.MCP_TOKEN,  // Optional: Bearer token
    headers: {
      'X-Client-Version': '1.0.0',
    },
    timeoutMs: 30000,
    reconnection: {
      maxReconnectionDelay: 30000,
      initialReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 5,
    },
  },
});
```

## Current Limitations

1. **Session Persistence**: MCP connection state is not yet persisted in sessions. This is planned for a future release.

## Contributing

To add support for SSE or WebSocket transports, implement the transport in:
- `src/infrastructure/mcp/transports/SSETransport.ts`
- `src/infrastructure/mcp/transports/WebSocketTransport.ts`

Update `createTransport()` in `src/core/mcp/MCPClient.ts` to use the new transport.
