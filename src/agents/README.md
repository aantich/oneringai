# Built-in AI Agents

Pre-built AI agents for common tasks. These agents use AI under the hood to automate complex workflows.

## Available Agents

### ProviderConfigAgent

AI-powered assistant that helps you configure OAuth providers through interactive conversation.

**What it does**:
- Asks which system you want to connect to
- Determines the right OAuth flow (user auth, app token, static key)
- Guides you through credential setup
- Generates ready-to-use JSON configuration
- Provides setup instructions and environment variables

**Usage**:

```typescript
import { Connector, Vendor, ProviderConfigAgent } from 'oneringai';

// Create connector for the AI
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! }
});

// Create the config agent using the connector
const configAgent = new ProviderConfigAgent('openai');

// Start interactive session
const result = await configAgent.run('I want to connect to GitHub');

// Get generated config
console.log(result.config);
console.log(result.setupInstructions);
console.log(result.envVariables);

// Use the config
Connector.create({ name: result.name, ...result.config });
```

**Interactive Example**:

```bash
npm run example:provider-config
```

**How it works**:
- Uses AI (GPT-4 or Claude) to understand your requirements
- No hardcoded templates - AI generates configs on the fly
- Knows about major OAuth providers (GitHub, Google, Microsoft, Slack, etc.)
- Adapts to your specific needs through conversation

**Output Format**:

```typescript
interface ProviderConfigResult {
  providerName: string;           // e.g., "github"
  config: {
    displayName: string;          // e.g., "GitHub API"
    description: string;          // What this provider does
    baseURL: string;              // API base URL
    auth: {
      type: 'oauth';
      flow: 'authorization_code' | 'client_credentials' | 'jwt_bearer' | 'static_token';
      clientId?: string;          // Uses ENV:VARIABLE_NAME format
      clientSecret?: string;      // Uses ENV:VARIABLE_NAME format
      authorizationUrl?: string;
      tokenUrl?: string;
      redirectUri?: string;
      scope?: string;
      staticToken?: string;
    };
  };
  setupInstructions: string;      // Step-by-step setup guide
  envVariables: string[];         // List of required env vars
}
```

## Future Agents

More built-in agents coming soon:
- **SchemaGeneratorAgent** - Generate TypeScript types from API responses
- **DocumentationAgent** - Generate API documentation from code
- **TestGeneratorAgent** - Generate test cases for your code
- **MigrationAgent** - Help migrate between OAuth flows

---

**Philosophy**: Keep agents simple, leverage AI's knowledge, avoid hardcoded templates.
