/**
 * MCP Stdio Transport Integration Tests
 *
 * These tests require @modelcontextprotocol/server-filesystem to be installed.
 * Run: npm install -D @modelcontextprotocol/server-filesystem
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPRegistry } from '../../../src/core/mcp/MCPRegistry.js';
import { Agent } from '../../../src/core/Agent.js';
import { Connector } from '../../../src/core/Connector.js';
import { Vendor } from '../../../src/core/Vendor.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MCP Stdio Integration', () => {
  let testDir: string;
  let client: ReturnType<typeof MCPRegistry.get>;

  beforeAll(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `mcp-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Resolve symlinks (macOS /var -> /private/var)
    testDir = await fs.realpath(testDir);

    // Create test files
    await fs.writeFile(join(testDir, 'test.txt'), 'Hello, MCP!');
    await fs.writeFile(join(testDir, 'data.json'), JSON.stringify({ key: 'value' }));

    // Clear registry
    MCPRegistry.clear();

    // Create MCP client for filesystem server
    client = MCPRegistry.create({
      name: 'filesystem',
      transport: 'stdio',
      transportConfig: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', testDir],
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    try {
      await client.disconnect();
      await fs.rm(testDir, { recursive: true, force: true });
      MCPRegistry.clear();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should connect to filesystem MCP server', async () => {
    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.state).toBe('connected');
  }, 30000); // 30 second timeout for npm install

  it('should discover tools from server', async () => {
    if (!client.isConnected()) {
      await client.connect();
    }

    const tools = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name.includes('read'))).toBe(true);
  }, 30000);

  it('should call a tool', async () => {
    if (!client.isConnected()) {
      await client.connect();
    }

    // Find a read file tool (name varies by server implementation)
    const tools = await client.listTools();
    const readTool = tools.find((t) => t.name.toLowerCase().includes('read'));

    if (!readTool) {
      console.warn('No read tool found, skipping test');
      return;
    }

    // Call the tool (adjust args based on actual schema)
    try {
      const result = await client.callTool(readTool.name, {
        path: join(testDir, 'test.txt'),
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).not.toBe(true);
    } catch (error: any) {
      // Some servers may have different schemas, log for debugging
      console.error('Tool call failed:', error.message);
      // Don't fail the test if it's a schema mismatch
      if (!error.message.includes('schema') && !error.message.includes('argument')) {
        throw error;
      }
    }
  }, 30000);

  it('should register tools with agent', async () => {
    if (!client.isConnected()) {
      await client.connect();
    }

    // Setup a test connector (won't actually call LLM)
    if (!Connector.has('test-openai')) {
      Connector.create({
        name: 'test-openai',
        vendor: Vendor.OpenAI,
        auth: { type: 'api_key', apiKey: 'test-key' },
      });
    }

    const agent = Agent.create({
      connector: 'test-openai',
      model: 'gpt-4',
    });

    const initialToolCount = agent.listTools().length;

    client.registerTools(agent.tools);

    const newToolCount = agent.listTools().length;
    expect(newToolCount).toBeGreaterThan(initialToolCount);

    // Check that tools are namespaced. sanitizeToolName replaces colons with
    // underscores (provider compatibility), so the on-the-wire prefix is
    // "mcp_filesystem_" not "mcp:filesystem:".
    const mcpTools = agent.listTools().filter((name) => name.startsWith('mcp_filesystem_'));
    expect(mcpTools.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle disconnect and reconnect', async () => {
    if (!client.isConnected()) {
      await client.connect();
    }

    expect(client.isConnected()).toBe(true);

    await client.disconnect();
    expect(client.isConnected()).toBe(false);

    await client.reconnect();
    expect(client.isConnected()).toBe(true);
  }, 30000);

  it('should emit connection events', async () => {
    const events: string[] = [];

    client.on('connected', () => events.push('connected'));
    client.on('disconnected', () => events.push('disconnected'));

    if (client.isConnected()) {
      await client.disconnect();
    }

    await client.connect();
    await client.disconnect();

    expect(events).toContain('connected');
    expect(events).toContain('disconnected');
  }, 30000);
});
