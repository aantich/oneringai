import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileCorrelationStorage } from '../../../../src/infrastructure/storage/FileCorrelationStorage.js';
import type { SessionRef } from '../../../../src/domain/interfaces/ICorrelationStorage.js';

describe('FileCorrelationStorage', () => {
  let storage: FileCorrelationStorage;
  let testDir: string;

  const makeRef = (overrides?: Partial<SessionRef>): SessionRef => ({
    agentId: 'test-agent',
    sessionId: 'session-001',
    suspendedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    resumeAs: 'user_message',
    ...overrides,
  });

  beforeEach(async () => {
    testDir = join(tmpdir(), `correlation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storage = new FileCorrelationStorage({ baseDirectory: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('save() and resolve()', () => {
    it('should save and resolve a correlation', async () => {
      const ref = makeRef();
      await storage.save('email:msg_123', ref);

      const resolved = await storage.resolve('email:msg_123');
      expect(resolved).toEqual(ref);
    });

    it('should return null for non-existent correlation', async () => {
      const resolved = await storage.resolve('nonexistent');
      expect(resolved).toBeNull();
    });

    it('should overwrite existing correlation', async () => {
      const ref1 = makeRef({ sessionId: 'session-001' });
      const ref2 = makeRef({ sessionId: 'session-002' });

      await storage.save('email:msg_123', ref1);
      await storage.save('email:msg_123', ref2);

      const resolved = await storage.resolve('email:msg_123');
      expect(resolved?.sessionId).toBe('session-002');
    });

    it('should return null for expired correlation', async () => {
      const ref = makeRef({
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
      });
      await storage.save('email:expired', ref);

      const resolved = await storage.resolve('email:expired');
      expect(resolved).toBeNull();
    });

    it('should handle correlation IDs with special characters', async () => {
      const ref = makeRef();
      await storage.save('webhook:https://example.com/callback?id=123&token=abc', ref);

      const resolved = await storage.resolve('webhook:https://example.com/callback?id=123&token=abc');
      expect(resolved).toEqual(ref);
    });
  });

  describe('delete()', () => {
    it('should delete an existing correlation', async () => {
      await storage.save('email:msg_123', makeRef());
      await storage.delete('email:msg_123');

      const resolved = await storage.resolve('email:msg_123');
      expect(resolved).toBeNull();
    });

    it('should not throw when deleting non-existent correlation', async () => {
      await expect(storage.delete('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('exists()', () => {
    it('should return true for existing non-expired correlation', async () => {
      await storage.save('email:msg_123', makeRef());
      expect(await storage.exists('email:msg_123')).toBe(true);
    });

    it('should return false for non-existent correlation', async () => {
      expect(await storage.exists('nonexistent')).toBe(false);
    });

    it('should return false for expired correlation', async () => {
      await storage.save('email:expired', makeRef({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }));
      expect(await storage.exists('email:expired')).toBe(false);
    });
  });

  describe('listBySession()', () => {
    it('should list all correlations for a session', async () => {
      await storage.save('email:msg_1', makeRef({ sessionId: 'session-A' }));
      await storage.save('email:msg_2', makeRef({ sessionId: 'session-A' }));
      await storage.save('email:msg_3', makeRef({ sessionId: 'session-B' }));

      const ids = await storage.listBySession('session-A');
      expect(ids.sort()).toEqual(['email:msg_1', 'email:msg_2']);
    });

    it('should return empty array for unknown session', async () => {
      const ids = await storage.listBySession('unknown');
      expect(ids).toEqual([]);
    });
  });

  describe('listByAgent()', () => {
    it('should list all correlations for an agent', async () => {
      await storage.save('email:msg_1', makeRef({ agentId: 'agent-A', sessionId: 'sess-1' }));
      await storage.save('email:msg_2', makeRef({ agentId: 'agent-A', sessionId: 'sess-2' }));
      await storage.save('email:msg_3', makeRef({ agentId: 'agent-B', sessionId: 'sess-3' }));

      const summaries = await storage.listByAgent('agent-A');
      expect(summaries).toHaveLength(2);
      expect(summaries.map(s => s.correlationId).sort()).toEqual(['email:msg_1', 'email:msg_2']);
    });

    it('should correctly report expired status', async () => {
      await storage.save('email:active', makeRef({ agentId: 'agent-A' }));
      await storage.save('email:expired', makeRef({
        agentId: 'agent-A',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }));

      const summaries = await storage.listByAgent('agent-A');
      const active = summaries.find(s => s.correlationId === 'email:active');
      const expired = summaries.find(s => s.correlationId === 'email:expired');

      expect(active?.isExpired).toBe(false);
      expect(expired?.isExpired).toBe(true);
    });
  });

  describe('pruneExpired()', () => {
    it('should remove expired correlations', async () => {
      await storage.save('email:active', makeRef());
      await storage.save('email:expired1', makeRef({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }));
      await storage.save('email:expired2', makeRef({
        expiresAt: new Date(Date.now() - 2000).toISOString(),
      }));

      const pruned = await storage.pruneExpired();
      expect(pruned).toBe(2);

      // Active one should still exist
      expect(await storage.exists('email:active')).toBe(true);
    });

    it('should return 0 when nothing to prune', async () => {
      await storage.save('email:active', makeRef());
      const pruned = await storage.pruneExpired();
      expect(pruned).toBe(0);
    });
  });

  describe('getPath()', () => {
    it('should return the base directory', () => {
      expect(storage.getPath()).toBe(testDir);
    });
  });
});
