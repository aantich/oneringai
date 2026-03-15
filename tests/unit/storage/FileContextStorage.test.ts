/**
 * Tests for FileContextStorage - file-based session persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  FileContextStorage,
  createFileContextStorage,
} from '../../../src/infrastructure/storage/FileContextStorage.js';
import type {
  SerializedContextState,
  StoredContextSession,
  ContextSessionMetadata,
} from '../../../src/domain/interfaces/IContextStorage.js';
import { CONTEXT_SESSION_FORMAT_VERSION } from '../../../src/domain/interfaces/IContextStorage.js';

/**
 * Build a minimal SerializedContextState for testing
 */
function makeState(overrides?: Partial<SerializedContextState>): SerializedContextState {
  return {
    conversation: [],
    pluginStates: {},
    systemPrompt: 'You are a test assistant.',
    metadata: {
      savedAt: Date.now(),
      model: 'gpt-4',
      agentId: 'test-agent',
    },
    ...overrides,
  };
}

describe('FileContextStorage', () => {
  let storage: FileContextStorage;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fcs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storage = new FileContextStorage({
      agentId: 'test-agent',
      baseDirectory: testDir,
      prettyPrint: false,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // =========================================================================
  // 1. Basic save / load / delete / exists / list cycle
  // =========================================================================

  it('should save, load, and round-trip a session', async () => {
    const state = makeState();
    const meta: ContextSessionMetadata = { title: 'Hello Session', tags: ['a'] };

    await storage.save('s1', state, meta);

    const loaded = await storage.load('s1');
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('s1');
    expect(loaded!.version).toBe(CONTEXT_SESSION_FORMAT_VERSION);
    expect(loaded!.state.systemPrompt).toBe('You are a test assistant.');
    expect(loaded!.metadata.title).toBe('Hello Session');
    expect(loaded!.metadata.tags).toEqual(['a']);
  });

  it('should delete a session', async () => {
    await storage.save('s1', makeState());
    expect(await storage.exists('s1')).toBe(true);

    await storage.delete('s1');
    expect(await storage.exists('s1')).toBe(false);

    const loaded = await storage.load('s1');
    expect(loaded).toBeNull();
  });

  it('should list sessions after saving multiple', async () => {
    await storage.save('a', makeState(), { title: 'A' });
    await storage.save('b', makeState(), { title: 'B' });
    await storage.save('c', makeState(), { title: 'C' });

    const list = await storage.list();
    expect(list).toHaveLength(3);
    // Sorted by lastSavedAt descending
    const ids = list.map(s => s.sessionId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  // =========================================================================
  // 2. Atomic write: verify file exists after save (temp+rename)
  // =========================================================================

  it('should write session file atomically (no leftover .tmp)', async () => {
    await storage.save('atomic-test', makeState());

    const sessionsDir = storage.getPath();
    const files = await fs.readdir(sessionsDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);

    // The actual JSON file should exist
    const jsonFiles = files.filter(f => f === 'atomic-test.json');
    expect(jsonFiles).toHaveLength(1);
  });

  // =========================================================================
  // 3. updateMetadata uses atomic write (temp+rename)
  // =========================================================================

  it('should update metadata atomically without leftover .tmp files', async () => {
    await storage.save('meta-test', makeState(), { title: 'Original' });
    await storage.updateMetadata('meta-test', { title: 'Updated', tags: ['new'] });

    const sessionsDir = storage.getPath();
    const files = await fs.readdir(sessionsDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);

    const loaded = await storage.load('meta-test');
    expect(loaded!.metadata.title).toBe('Updated');
    expect(loaded!.metadata.tags).toEqual(['new']);
  });

  // =========================================================================
  // 4. updateMetadata on non-existent session throws
  // =========================================================================

  it('should throw when updating metadata on non-existent session', async () => {
    await expect(
      storage.updateMetadata('no-such-session', { title: 'X' })
    ).rejects.toThrow(/not found/i);
  });

  // =========================================================================
  // 5. Index management: save multiple sessions, list returns all
  // =========================================================================

  it('should maintain index across saves and deletes', async () => {
    await storage.save('x1', makeState(), { title: 'X1' });
    await storage.save('x2', makeState(), { title: 'X2' });
    await storage.save('x3', makeState(), { title: 'X3' });

    let list = await storage.list();
    expect(list).toHaveLength(3);

    await storage.delete('x2');
    list = await storage.list();
    expect(list).toHaveLength(2);
    expect(list.find(s => s.sessionId === 'x2')).toBeUndefined();
  });

  // =========================================================================
  // 6. loadRaw with corrupted JSON returns null
  // =========================================================================

  it('should return null for corrupted JSON session file', async () => {
    // First save a valid session to ensure directory exists
    await storage.save('good', makeState());

    // Write corrupted data directly to a session file
    const sessionsDir = storage.getPath();
    const corruptedPath = join(sessionsDir, 'corrupted.json');
    await fs.writeFile(corruptedPath, '{ invalid json !!!', 'utf-8');

    // load() calls loadRaw internally with sanitized ID
    const loaded = await storage.load('corrupted');
    expect(loaded).toBeNull();
  });

  // =========================================================================
  // 7. list() with filter combinations
  // =========================================================================

  it('should filter list by tags', async () => {
    await storage.save('t1', makeState(), { tags: ['alpha', 'beta'] });
    await storage.save('t2', makeState(), { tags: ['beta'] });
    await storage.save('t3', makeState(), { tags: ['gamma'] });

    const filtered = await storage.list({ tags: ['alpha'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sessionId).toBe('t1');
  });

  it('should filter list by createdAfter and createdBefore', async () => {
    await storage.save('old', makeState());
    // Small delay to separate timestamps
    await new Promise(r => setTimeout(r, 50));
    const midpoint = new Date();
    await new Promise(r => setTimeout(r, 50));
    await storage.save('new', makeState());

    const afterMid = await storage.list({ createdAfter: midpoint });
    expect(afterMid).toHaveLength(1);
    expect(afterMid[0].sessionId).toBe('new');

    const beforeMid = await storage.list({ createdBefore: midpoint });
    expect(beforeMid).toHaveLength(1);
    expect(beforeMid[0].sessionId).toBe('old');
  });

  it('should filter list by savedAfter and savedBefore', async () => {
    await storage.save('first', makeState());
    await new Promise(r => setTimeout(r, 50));
    const midpoint = new Date();
    await new Promise(r => setTimeout(r, 50));
    await storage.save('second', makeState());

    const afterMid = await storage.list({ savedAfter: midpoint });
    expect(afterMid).toHaveLength(1);
    expect(afterMid[0].sessionId).toBe('second');
  });

  // =========================================================================
  // 8. sanitizeId edge cases
  // =========================================================================

  it('should handle special characters in session ID via sanitization', async () => {
    // Characters like /, \, spaces, dots get sanitized
    await storage.save('my session/test\\v2.0', makeState(), { title: 'Special' });

    // Load using the same ID (sanitization happens internally)
    const loaded = await storage.load('my session/test\\v2.0');
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('my session/test\\v2.0');
    expect(loaded!.metadata.title).toBe('Special');
  });

  it('should sanitize an ID that is all special characters to "default"', async () => {
    await storage.save('///...', makeState(), { title: 'Fallback' });
    const loaded = await storage.load('///...');
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.title).toBe('Fallback');
  });

  // =========================================================================
  // 9. delete() on non-existent session — no error
  // =========================================================================

  it('should not throw when deleting a non-existent session', async () => {
    await expect(storage.delete('does-not-exist')).resolves.not.toThrow();
  });

  // =========================================================================
  // 10. Large session data — save and load succeed
  // =========================================================================

  it('should handle large session data', async () => {
    const largeConversation = Array.from({ length: 500 }, (_, i) => ({
      type: 'message' as const,
      role: 'user' as const,
      content: `Message ${i}: ${'x'.repeat(1000)}`,
    }));

    const state = makeState({ conversation: largeConversation });
    await storage.save('large', state);

    const loaded = await storage.load('large');
    expect(loaded).not.toBeNull();
    expect(loaded!.state.conversation).toHaveLength(500);
    expect(loaded!.state.conversation[499].content).toContain('Message 499');
  });

  // =========================================================================
  // 11. exists() for existing and non-existing sessions
  // =========================================================================

  it('should return true for existing session and false for non-existing', async () => {
    expect(await storage.exists('nope')).toBe(false);

    await storage.save('yep', makeState());
    expect(await storage.exists('yep')).toBe(true);
  });

  // =========================================================================
  // 12. Save overwrites existing session (preserves createdAt)
  // =========================================================================

  it('should preserve createdAt when overwriting an existing session', async () => {
    await storage.save('overwrite', makeState(), { title: 'V1' });
    const first = await storage.load('overwrite');
    const originalCreatedAt = first!.createdAt;

    await new Promise(r => setTimeout(r, 50));

    await storage.save('overwrite', makeState(), { title: 'V2' });
    const second = await storage.load('overwrite');

    expect(second!.createdAt).toBe(originalCreatedAt);
    expect(second!.metadata.title).toBe('V2');
    expect(new Date(second!.lastSavedAt).getTime()).toBeGreaterThan(
      new Date(first!.lastSavedAt).getTime()
    );
  });

  // =========================================================================
  // 13. List with pagination (limit + offset)
  // =========================================================================

  it('should support limit in list()', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.save(`p${i}`, makeState(), { title: `P${i}` });
      await new Promise(r => setTimeout(r, 10)); // ensure distinct timestamps
    }

    const page = await storage.list({ limit: 2 });
    expect(page).toHaveLength(2);
  });

  it('should support offset + limit in list()', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.save(`p${i}`, makeState(), { title: `P${i}` });
      await new Promise(r => setTimeout(r, 10));
    }

    const all = await storage.list();
    expect(all).toHaveLength(5);

    const page2 = await storage.list({ offset: 2, limit: 2 });
    expect(page2).toHaveLength(2);
    expect(page2[0].sessionId).toBe(all[2].sessionId);
    expect(page2[1].sessionId).toBe(all[3].sessionId);
  });

  // =========================================================================
  // 14. getPath() returns expected directory
  // =========================================================================

  it('should return sessions directory from getPath()', () => {
    const path = storage.getPath();
    expect(path).toContain('test-agent');
    expect(path).toContain('sessions');
    expect(path.startsWith(testDir)).toBe(true);
  });

  it('should return same value from getLocation()', () => {
    expect(storage.getLocation()).toBe(storage.getPath());
  });

  // =========================================================================
  // 15. getAgentId() returns original agent ID
  // =========================================================================

  it('should return the original agentId', () => {
    expect(storage.getAgentId()).toBe('test-agent');
  });

  // =========================================================================
  // 16. createFileContextStorage helper
  // =========================================================================

  it('should create storage via createFileContextStorage helper', async () => {
    const helper = createFileContextStorage('helper-agent', { baseDirectory: testDir });
    await helper.save('hs1', makeState());
    const loaded = await helper.load('hs1');
    expect(loaded).not.toBeNull();
    expect(helper.getAgentId()).toBe('helper-agent');
  });

  // =========================================================================
  // 17. rebuildIndex recovers from missing index
  // =========================================================================

  it('should rebuild index from session files on disk', async () => {
    await storage.save('r1', makeState(), { title: 'R1' });
    await storage.save('r2', makeState(), { title: 'R2' });

    // Delete the index file manually
    const indexPath = join(storage.getPath(), '_index.json');
    await fs.unlink(indexPath);

    // Create a fresh storage instance (clears cached index)
    const fresh = new FileContextStorage({
      agentId: 'test-agent',
      baseDirectory: testDir,
    });

    await fresh.rebuildIndex();

    const list = await fresh.list();
    expect(list).toHaveLength(2);
    const ids = list.map(s => s.sessionId);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
  });

  // =========================================================================
  // 18. Index tracks messageCount and memoryEntryCount
  // =========================================================================

  it('should track messageCount and memoryEntryCount in index', async () => {
    const state = makeState({
      conversation: [
        { type: 'message', role: 'user', content: 'Hi' },
        { type: 'message', role: 'assistant', content: 'Hello' },
      ],
      pluginStates: {
        workingMemory: {
          entries: [{ key: 'k1' }, { key: 'k2' }, { key: 'k3' }],
        },
      },
    });

    await storage.save('counts', state);
    const list = await storage.list();
    const session = list.find(s => s.sessionId === 'counts');

    expect(session).toBeDefined();
    expect(session!.messageCount).toBe(2);
    expect(session!.memoryEntryCount).toBe(3);
  });

  // =========================================================================
  // 19. updateMetadata merges (does not overwrite unrelated keys)
  // =========================================================================

  it('should merge metadata without losing unrelated keys', async () => {
    await storage.save('merge', makeState(), { title: 'Original', tags: ['keep'], description: 'desc' });
    await storage.updateMetadata('merge', { title: 'Changed' });

    const loaded = await storage.load('merge');
    expect(loaded!.metadata.title).toBe('Changed');
    expect(loaded!.metadata.tags).toEqual(['keep']);
    expect(loaded!.metadata.description).toBe('desc');
  });

  // =========================================================================
  // 20. Concurrent saves do not corrupt index
  // =========================================================================

  it('should handle concurrent saves without corrupting index', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      storage.save(`concurrent-${i}`, makeState(), { title: `C${i}` })
    );

    await Promise.all(promises);

    const list = await storage.list();
    expect(list).toHaveLength(10);
    const ids = new Set(list.map(s => s.sessionId));
    for (let i = 0; i < 10; i++) {
      expect(ids.has(`concurrent-${i}`)).toBe(true);
    }
  });
});
