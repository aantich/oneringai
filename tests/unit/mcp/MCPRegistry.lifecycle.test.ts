/**
 * MCPRegistry Lifecycle Tests
 *
 * Tests for destroy, remove, and lifecycle management of MCP clients.
 * Mocks the MCP SDK modules to avoid real connections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue({ tools: [], resources: [], prompts: [] }),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

import { MCPRegistry } from '../../../src/core/mcp/MCPRegistry.js';
import { MCPError } from '../../../src/domain/errors/MCPError.js';

function createTestServer(name: string) {
  return MCPRegistry.create({
    name,
    transport: 'stdio',
    transportConfig: { command: 'echo', args: ['test'] },
  });
}

describe('MCPRegistry Lifecycle', () => {
  beforeEach(() => {
    MCPRegistry.clear();
  });

  afterEach(() => {
    MCPRegistry.clear();
  });

  describe('destroyAll()', () => {
    it('should destroy all clients and empty the registry', () => {
      createTestServer('server-a');
      createTestServer('server-b');
      createTestServer('server-c');

      expect(MCPRegistry.list()).toHaveLength(3);

      MCPRegistry.destroyAll();

      expect(MCPRegistry.list()).toHaveLength(0);
      expect(MCPRegistry.has('server-a')).toBe(false);
      expect(MCPRegistry.has('server-b')).toBe(false);
      expect(MCPRegistry.has('server-c')).toBe(false);
    });

    it('should be safe to call destroyAll() on empty registry', () => {
      expect(() => MCPRegistry.destroyAll()).not.toThrow();
      expect(MCPRegistry.list()).toHaveLength(0);
    });
  });

  describe('remove()', () => {
    it('should disconnect and remove a single client', () => {
      const client = createTestServer('removable');

      expect(MCPRegistry.has('removable')).toBe(true);

      const removed = MCPRegistry.remove('removable');
      expect(removed).toBe(true);
      expect(MCPRegistry.has('removable')).toBe(false);
    });

    it('should return false when removing non-existent client', () => {
      const removed = MCPRegistry.remove('ghost');
      expect(removed).toBe(false);
    });

    it('should not affect other clients when removing one', () => {
      createTestServer('keep-me');
      createTestServer('remove-me');

      MCPRegistry.remove('remove-me');

      expect(MCPRegistry.has('keep-me')).toBe(true);
      expect(MCPRegistry.has('remove-me')).toBe(false);
      expect(MCPRegistry.list()).toHaveLength(1);
    });
  });

  describe('create() duplicate name', () => {
    it('should throw MCPError when registering duplicate name', () => {
      createTestServer('dup');

      expect(() => createTestServer('dup')).toThrow(MCPError);
      expect(() => createTestServer('dup')).toThrow(/already registered/);
    });
  });

  describe('get() non-existent', () => {
    it('should throw MCPError for non-existent server', () => {
      expect(() => MCPRegistry.get('missing')).toThrow(MCPError);
      expect(() => MCPRegistry.get('missing')).toThrow(/not found/);
    });
  });

  describe('after destroyAll(), registry is empty', () => {
    it('should not find any previously registered clients', () => {
      createTestServer('alpha');
      createTestServer('beta');

      MCPRegistry.destroyAll();

      expect(MCPRegistry.list()).toEqual([]);
      expect(MCPRegistry.has('alpha')).toBe(false);
      expect(MCPRegistry.has('beta')).toBe(false);
      expect(() => MCPRegistry.get('alpha')).toThrow(MCPError);
    });

    it('should allow creating new clients after destroyAll()', () => {
      createTestServer('old');
      MCPRegistry.destroyAll();

      const newClient = createTestServer('new');
      expect(newClient.name).toBe('new');
      expect(MCPRegistry.has('new')).toBe(true);
      expect(MCPRegistry.list()).toHaveLength(1);
    });
  });

  describe('list()', () => {
    it('should return all registered client names', () => {
      createTestServer('x');
      createTestServer('y');
      createTestServer('z');

      const names = MCPRegistry.list();
      expect(names).toHaveLength(3);
      expect(names).toContain('x');
      expect(names).toContain('y');
      expect(names).toContain('z');
    });

    it('should return empty array when no clients registered', () => {
      expect(MCPRegistry.list()).toEqual([]);
    });
  });

  describe('has()', () => {
    it('should return true for registered client', () => {
      createTestServer('present');
      expect(MCPRegistry.has('present')).toBe(true);
    });

    it('should return false for unregistered name', () => {
      expect(MCPRegistry.has('absent')).toBe(false);
    });

    it('should return false after client is removed', () => {
      createTestServer('temp');
      MCPRegistry.remove('temp');
      expect(MCPRegistry.has('temp')).toBe(false);
    });
  });
});
