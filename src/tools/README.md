# Tool Library

Pre-built tools for AI agents in `oneringai`.

## Overview

This library provides production-ready tools that agents can use. All tools are designed with clear, LLM-friendly descriptions.

## Available Tools

### 1. JSON Manipulator

**Tool**: `tools.jsonManipulator`

**Purpose**: Manipulate JSON objects using dot notation paths

**Operations**:
- `delete` - Remove fields
- `add` - Add new fields (creates intermediate objects)
- `replace` - Change existing field values

**Path Format** (Dot Notation):
- `name` - Top-level field
- `user.email` - Nested field
- `users.0.name` - Array element (0 is index)
- `settings.theme.colors.primary` - Deep nesting

**Example**:
```typescript
import { Connector, Agent, Vendor, tools } from 'oneringai';

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! }
});

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [tools.jsonManipulator]
});

await agent.run('Delete the email field from {"name": "John", "email": "j@ex.com"}');
```

**See**: `examples/json-manipulation-tool.ts`

---

### 2. Web Fetch

**Tool**: `tools.webFetch`

**Purpose**: Fetch and extract content from web pages

**Features**:
- Simple HTTP fetch with cheerio parsing
- Smart content quality detection (0-100 score)
- Detects JavaScript-rendered sites
- Detects error pages, paywalls, bot blocks
- Suggests using a scraping service connector if needed

**Use For**:
- Static websites (blogs, documentation)
- Server-rendered HTML
- Simple content extraction

**Speed**: ~1 second

**Example**:
```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [tools.webFetch]
});

await agent.run('Fetch content from https://example.com/article');
```

---

### 3. Web Search (ConnectorTools)

**Factory**: `createWebSearchTool(connector)`

**Purpose**: Search the web using a search service connector

**Providers** (via ConnectorTools):
- **Serper.dev** - Google results, 2,500 free queries
- **Brave** - Independent index, privacy-focused
- **Tavily** - AI-optimized results
- **RapidAPI** - Multiple search APIs

**Returns**: URLs, titles, snippets

**Requires**: A connector with a search service type

**Example**:
```typescript
import { Connector, Agent, Vendor, ConnectorTools, tools } from 'oneringai';

// Create a search connector
Connector.create({
  name: 'serper',
  serviceType: 'serper',
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Get search tools from the connector
const searchTools = ConnectorTools.for('serper');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [tools.webFetch, ...searchTools]
});

await agent.run('Search for TypeScript documentation and summarize it');
```

### 4. Web Scrape (ConnectorTools)

**Factory**: `createWebScrapeTool(connector)`

**Purpose**: Scrape web pages with automatic native fallback

**Providers** (via ConnectorTools):
- **ZenRows** - Full browser rendering
- **Jina Reader** - AI-optimized extraction
- **Firecrawl** - Crawling and scraping
- **ScrapingBee** - Browser-based scraping

**Requires**: A connector with a scrape service type

**Example**:
```typescript
Connector.create({
  name: 'zenrows',
  serviceType: 'zenrows',
  auth: { type: 'api_key', apiKey: process.env.ZENROWS_API_KEY! },
  baseURL: 'https://api.zenrows.com',
});

const scrapeTools = ConnectorTools.for('zenrows');
```

---

### 5. Execute JavaScript

**Tool**: `tools.executeJavaScript`

**Purpose**: Execute arbitrary JavaScript code in a secure sandbox

**Features**:
- Sandboxed VM execution (Node.js vm module)
- Access to `authenticatedFetch` (OAuth integration!)
- Access to OAuth registry info
- Console output captured
- 10-second timeout (configurable)
- No file system / process access

**Use For**:
- Complex data processing
- Multi-API integration
- Custom logic beyond pre-built tools

**Context Provided**:
- `input` - Input data
- `output` - Result variable (set this!)
- `authenticatedFetch(url, options, provider, userId?)` - OAuth-authenticated HTTP
- `fetch(url, options)` - Standard HTTP
- `console.log/error/warn` - Logging
- Standard globals: Buffer, JSON, Math, Date, etc.

**Example**:
```typescript
import { Connector, Agent, Vendor, tools } from 'oneringai';

// Register OAuth connectors first
Connector.create({
  name: 'microsoft',
  displayName: 'Microsoft Graph API',
  baseURL: 'https://graph.microsoft.com',
  auth: {
    type: 'oauth',
    flow: 'client_credentials',
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    tokenUrl: 'https://login.microsoftonline.com/.../oauth2/v2.0/token',
    scope: 'https://graph.microsoft.com/.default'
  }
});

Connector.create({
  name: 'github',
  displayName: 'GitHub API',
  baseURL: 'https://api.github.com',
  auth: {
    type: 'oauth',
    flow: 'authorization_code',
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    redirectUri: 'http://localhost:3000/callback',
    scope: 'repo user'
  }
});

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! }
});

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [tools.executeJavaScript]
});

await agent.run(`
Get users from Microsoft Graph and repos from GitHub.
Combine into a summary JSON.
`);

// Agent generates and executes JavaScript:
/*
(async () => {
  const users = await authenticatedFetch(
    'https://graph.microsoft.com/v1.0/users?$top=5',
    { method: 'GET' },
    'microsoft'
  );
  const repos = await authenticatedFetch(
    'https://api.github.com/user/repos',
    { method: 'GET' },
    'github'
  );

  output = {
    users: (await users.json()).value.length,
    repos: (await repos.json()).length
  };
})();
*/
```

**Security**: Uses Node.js vm module (sandboxed but not fully isolated)

---

## Tool Combinations

Tools work great together:

### Research Workflow
```typescript
const searchTools = ConnectorTools.for('serper');
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [
    ...searchTools,       // Find URLs (via ConnectorTools)
    tools.webFetch,       // Get content
    tools.jsonManipulator // Structure findings
  ]
});
```

### Multi-API Integration
```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [
    tools.executeJavaScript,  // Execute custom logic with OAuth
    tools.jsonManipulator     // Process results
  ]
});
```

### Complete Web Agent
```typescript
const searchTools = ConnectorTools.for('serper');
const scrapeTools = ConnectorTools.for('zenrows');
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [
    ...searchTools,            // Search via connector
    ...scrapeTools,            // Scrape via connector
    tools.webFetch,            // Simple fetch (built-in)
    tools.executeJavaScript,
    tools.jsonManipulator
  ]
});
```

---

## Tool Reference

| Tool | Purpose | Speed | OAuth | Dependencies |
|------|---------|-------|-------|--------------|
| `jsonManipulator` | Manipulate JSON | Instant | No | None |
| `webFetch` | Fetch static sites | ~1s | No | cheerio |
| `web_search` (ConnectorTools) | Search the web | ~1-3s | No | Search connector |
| `web_scrape` (ConnectorTools) | Scrape JS sites | ~2-10s | No | Scrape connector |
| `executeJavaScript` | Run JS code | Variable | **Yes** | vm (built-in) |

---

## Security Notes

### webFetch
- Fetches external content
- May be blocked by bot protection
- Rate limits apply

### executeJavaScript
- Use with caution - Executes code
- Sandboxed (no file/process access)
- 10-second timeout
- Safe for LLM-generated code in controlled environments
- For untrusted environments, consider `isolated-vm`

---

## Adding Custom Tools

### Step 1: Create Tool

```typescript
// src/tools/myCategory/myTool.ts

import { ToolFunction } from '../../domain/entities/Tool.js';

export const myTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: 'Clear description for the AI',
      parameters: {
        type: 'object',
        properties: {
          param1: { type: 'string', description: '...' }
        },
        required: ['param1']
      }
    }
  },
  execute: async (args) => {
    // Your implementation
    return { success: true, result: '...' };
  }
};
```

### Step 2: Export

```typescript
// src/tools/index.ts

export { myTool } from './myCategory/myTool.js';
```

### Step 3: Use

```typescript
import { Connector, Agent, Vendor, tools } from 'oneringai';

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! }
});

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  tools: [tools.myTool]
});
```

---

## Best Practices

### 1. Clear Descriptions

Write descriptions that explain:
- What the tool does
- How to use it (with examples)
- What it returns
- Any limitations

### 2. Structured Results

Return consistent result format:
```typescript
{
  success: boolean,
  result: any,
  error?: string
}
```

### 3. Error Handling

Always handle errors gracefully:
```typescript
try {
  const result = await doSomething();
  return { success: true, result };
} catch (error) {
  return { success: false, error: (error as Error).message };
}
```

### 4. Include Examples

Add concrete examples in tool descriptions to help LLMs understand usage patterns.

---

## Examples

**Run tool examples**:
```bash
npm run example:json-tool     # JSON manipulation
npm run example:web           # Web research
npm run example:oauth-static  # OAuth + code execution
```

---

## Tool Categories

Organize tools by category:

- **json/** - JSON manipulation
- **web/** - Web scraping, HTTP, search
- **code/** - Code execution
- **filesystem/** - File read/write/edit, glob, grep
- **shell/** - Bash command execution
- **connector/** - External API tools (generated from connectors)

---

## Tool Registry

Unified API for discovering all available tools (built-in + connector-generated).

### Usage

```typescript
import { ToolRegistry } from 'oneringai';

// Get ALL tools (built-in + connector)
const allTools = ToolRegistry.getAllTools();

// Get only built-in tools
const builtInTools = ToolRegistry.getBuiltInTools();

// Get connector tools for a specific connector
const githubTools = ToolRegistry.getConnectorTools('github');

// Get tools by service type
const slackTools = ToolRegistry.getToolsByService('slack');
```

### Type Guard

```typescript
for (const tool of ToolRegistry.getAllTools()) {
  if (ToolRegistry.isConnectorTool(tool)) {
    console.log(`Connector: ${tool.displayName} (${tool.connectorName})`);
  } else {
    console.log(`Built-in: ${tool.displayName}`);
  }
}
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getAllTools()` | `(ToolRegistryEntry \| ConnectorToolEntry)[]` | All tools (main API) |
| `getBuiltInTools()` | `ToolRegistryEntry[]` | Built-in tools only |
| `getAllConnectorTools()` | `ConnectorToolEntry[]` | All connector tools |
| `getConnectorTools(name)` | `ConnectorToolEntry[]` | Tools for specific connector |
| `getToolsByService(type)` | `ConnectorToolEntry[]` | Filter by service type |
| `getToolsByConnector(name)` | `ConnectorToolEntry[]` | Filter by connector name |
| `isConnectorTool(entry)` | `boolean` | Type guard |

---

**Version**: 0.4.2
**Total Tools**: 10 built-in (Filesystem: 6, Shell: 1, Web: 1, Code: 1, JSON: 1) + ConnectorTools (web search, web scrape, multimedia, GitHub)
**All tools**: Type-safe, well-documented, production-ready
