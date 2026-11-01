/**
 * Multi-User authenticatedFetch Example
 *
 * Demonstrates using authenticatedFetch with multiple users
 * Each user's OAuth tokens are automatically managed and refreshed
 */

import 'dotenv/config';
import {
  Connector,
  createAuthenticatedFetch,
  FileStorage,
  generateEncryptionKey,
} from '../src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tokenDirectory = mkdtempSync(join(tmpdir(), 'oneringai-auth-fetch-'));
process.once('exit', () => rmSync(tokenDirectory, { recursive: true, force: true }));
const encryptionKey = process.env.OAUTH_ENCRYPTION_KEY || generateEncryptionKey();
process.env.OAUTH_ENCRYPTION_KEY ||= encryptionKey;

// Simulated users (in a real app, these come from your database)
const users = [
  { id: 'alice_123', name: 'Alice', email: 'alice@example.com' },
  { id: 'bob_456', name: 'Bob', email: 'bob@example.com' },
  { id: 'charlie_789', name: 'Charlie', email: 'charlie@example.com' },
];

async function main() {
  console.log('🌐 Multi-User authenticatedFetch Example\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Set default storage for all connectors
  Connector.setDefaultStorage(new FileStorage({
    directory: tokenDirectory,
    encryptionKey,
  }));

  // ==================== Setup: Register OAuth Connector ====================
  console.log('Step 1: Register GitHub OAuth Connector');
  console.log('────────────────────────────────────────────────────────────\n');

  Connector.create({
    name: 'github',
    displayName: 'GitHub API',
    description: 'Access GitHub repositories, issues, and user data',
    baseURL: 'https://api.github.com',
    auth: {
      type: 'oauth',
      flow: 'authorization_code',
      clientId: process.env.GITHUB_CLIENT_ID || 'your-client-id',
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      redirectUri: 'http://localhost:3000/callback',
      scope: 'user:email repo',
      storageKey: 'github',
    },
  });

  console.log('✅ Connector registered: github');
  console.log('   All users will use this connector with separate tokens\n');

  // ==================== Pattern 1: Direct authenticatedFetch ====================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Pattern 1: Direct authenticatedFetch() with userId');
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('Use this pattern when you want maximum flexibility:\n');
  console.log('```typescript');
  console.log('// Fetch data for Alice');
  console.log('const aliceRepos = await authenticatedFetch(');
  console.log('  "https://api.github.com/user/repos",');
  console.log('  { method: "GET" },');
  console.log('  "github",');
  console.log('  "alice_123"  // Alice\'s userId');
  console.log(');\n');
  console.log('// Fetch data for Bob (different token!)');
  console.log('const bobRepos = await authenticatedFetch(');
  console.log('  "https://api.github.com/user/repos",');
  console.log('  { method: "GET" },');
  console.log('  "github",');
  console.log('  "bob_456"  // Bob\'s userId');
  console.log(');');
  console.log('```\n');

  console.log('✅ Each user gets their own isolated token');
  console.log('✅ Tokens auto-refresh when expired');
  console.log('✅ Simple, explicit userId on each call');

  // ==================== Pattern 2: Per-User Fetch Functions ====================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Pattern 2: Create per-user fetch functions');
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('Create reusable fetch functions bound to specific users:\n');
  console.log('```typescript');
  console.log('// Create fetch function for Alice');
  console.log('const aliceFetch = createAuthenticatedFetch("github", "alice_123");\n');
  console.log('// Create fetch function for Bob');
  console.log('const bobFetch = createAuthenticatedFetch("github", "bob_456");\n');
  console.log('// Now use them like normal fetch (userId is implicit!)');
  console.log('const aliceRepos = await aliceFetch("https://api.github.com/user/repos");');
  console.log('const aliceIssues = await aliceFetch("https://api.github.com/user/issues");\n');
  console.log('const bobRepos = await bobFetch("https://api.github.com/user/repos");');
  console.log('const bobIssues = await bobFetch("https://api.github.com/user/issues");');
  console.log('```\n');

  console.log('✅ Cleaner code: userId is implicit');
  console.log('✅ Perfect for long request chains');
  console.log('✅ Can\'t accidentally mix users');

  // Simulate this pattern
  for (const user of users) {
    console.log(`\n📋 Creating fetch function for ${user.name}...`);
    const userFetch = createAuthenticatedFetch('github', user.id);
    console.log(`   ✅ ${user.name}Fetch ready (${typeof userFetch}): userFetch("url") → auto-authenticated`);
  }

  // ==================== Pattern 3: Web Application ====================
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Pattern 3: Web Application (Express.js)');
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('```typescript');
  console.log('// Auth middleware extracts userId from session/JWT');
  console.log('app.use((req, res, next) => {');
  console.log('  req.userId = req.session?.userId || jwt.verify(req.token).sub;');
  console.log('  next();');
  console.log('});\n');
  console.log('// API endpoint: fetch user\'s GitHub repos');
  console.log('app.get("/api/repos", async (req, res) => {');
  console.log('  try {');
  console.log('    // Get repos using user-specific token');
  console.log('    const response = await authenticatedFetch(');
  console.log('      "https://api.github.com/user/repos",');
  console.log('      { method: "GET" },');
  console.log('      "github",');
  console.log('      req.userId  // Automatically uses this user\'s token!');
  console.log('    );\n');
  console.log('    const repos = await response.json();');
  console.log('    res.json(repos);');
  console.log('  } catch (error) {');
  console.log('    if (error.message.includes("No token")) {');
  console.log('      // User needs to reconnect GitHub');
  console.log('      res.status(401).json({ error: "GitHub not connected" });');
  console.log('    } else {');
  console.log('      res.status(500).json({ error: error.message });');
  console.log('    }');
  console.log('  }');
  console.log('});');
  console.log('```\n');

  console.log('✅ Works with session-based or JWT-based auth');
  console.log('✅ Automatic per-user token management');
  console.log('✅ Easy error handling for expired tokens');

  // ==================== Pattern 4: Background Jobs ====================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Pattern 4: Background Jobs / Cron Tasks');
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('```typescript');
  console.log('// Cron job: sync GitHub data for all users');
  console.log('async function syncAllUsers() {');
  console.log('  const users = await db.users.find({ githubConnected: true });\n');
  console.log('  for (const user of users) {');
  console.log('    try {');
  console.log('      console.log(`Syncing ${user.name}...`);\n');
  console.log('      // Fetch repos for this user');
  console.log('      const repos = await authenticatedFetch(');
  console.log('        "https://api.github.com/user/repos",');
  console.log('        { method: "GET" },');
  console.log('        "github",');
  console.log('        user.id');
  console.log('      );\n');
  console.log('      // Store in database');
  console.log('      await db.repos.updateMany(');
  console.log('        { userId: user.id },');
  console.log('        { $set: { repos: await repos.json() } }');
  console.log('      );\n');
  console.log('      console.log(`✅ ${user.name} synced`);');
  console.log('    } catch (error) {');
  console.log('      if (error.message.includes("No token")) {');
  console.log('        // Token expired or revoked');
  console.log('        await notifyUserToReconnect(user);');
  console.log('      }');
  console.log('    }');
  console.log('  }');
  console.log('}');
  console.log('```\n');

  console.log('✅ Process multiple users in parallel');
  console.log('✅ Automatic per-user authentication');
  console.log('✅ Graceful handling of token issues');

  // ==================== Pattern 5: Agent with Multi-User ====================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Pattern 5: AI Agent with Multi-User OAuth');
  console.log('────────────────────────────────────────────────────────────\n');

  console.log('```typescript');
  console.log('import { Connector, Agent, Vendor, createExecuteJavaScriptTool } from "oneringai";\n');
  console.log('// Create agent with JavaScript execution tool');
  console.log('const jsTool = createExecuteJavaScriptTool();\n');
  console.log('Connector.create({');
  console.log('  name: "openai",');
  console.log('  vendor: Vendor.OpenAI,');
  console.log('  auth: { type: "api_key", apiKey: process.env.OPENAI_API_KEY }');
  console.log('});\n');
  console.log('const agent = Agent.create({');
  console.log('  connector: "openai",');
  console.log('  model: "gpt-4.1-mini",');
  console.log('  tools: [jsTool],');
  console.log('  instructions: `You can access GitHub API using authenticatedFetch.');
  console.log('    For multi-user apps, pass userId as 4th parameter.`');
  console.log('});\n');
  console.log('// Agent can now make user-specific API calls!');
  console.log('const response = await agent.run(`');
  console.log('  Use GitHub API to list repos for user alice_123.');
  console.log('  In your code, use:');
  console.log('  authenticatedFetch(url, options, "github", "alice_123")');
  console.log('`);\n');
  console.log('// The agent will execute code like:');
  console.log('// (async () => {');
  console.log('//   const response = await authenticatedFetch(');
  console.log('//     "https://api.github.com/user/repos",');
  console.log('//     { method: "GET" },');
  console.log('//     "github",');
  console.log('//     "alice_123"  // Uses Alice\'s token!');
  console.log('//   );');
  console.log('//   output = await response.json();');
  console.log('// })();');
  console.log('```\n');

  console.log('✅ AI agent can access user-specific data');
  console.log('✅ Pass userId from your app context');
  console.log('✅ Perfect for user-scoped AI assistants');

  // ==================== Summary ====================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📚 API Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('authenticatedFetch(url, options, connector, userId?)');
  console.log('  • Direct function for making authenticated requests');
  console.log('  • userId is optional (defaults to single-user mode)');
  console.log('  • Auto-refreshes tokens');
  console.log('  • Returns: Promise<Response>\n');

  console.log('createAuthenticatedFetch(connector, userId?)');
  console.log('  • Creates reusable fetch function');
  console.log('  • Can bind to specific user');
  console.log('  • Returns: (url, options) => Promise<Response>\n');

  console.log('🔑 Key Benefits:');
  console.log('  ✅ Zero configuration per-user');
  console.log('  ✅ Automatic token refresh');
  console.log('  ✅ Isolated token storage');
  console.log('  ✅ Backward compatible (userId optional)');
  console.log('  ✅ Works with any OAuth connector');
  console.log('  ✅ Clean Architecture (pluggable storage)');

  console.log('\n🚀 Production Checklist:');
  console.log('  [ ] Set OAUTH_ENCRYPTION_KEY in environment');
  console.log('  [ ] Choose storage backend (File, MongoDB, Redis)');
  console.log('  [ ] Handle token expiry errors gracefully');
  console.log('  [ ] Notify users when reauth needed');
  console.log('  [ ] Test with multiple concurrent users');
  console.log('  [ ] Monitor token refresh rates');

  console.log('\n✨ Your OAuth system is now multi-user ready!');

  // Cleanup
  Connector.clear();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
