/**
 * Tests for history journal integration with AgentContextNextGen.
 *
 * Verifies that:
 * - Messages are journaled on add
 * - Buffering works before sessionId is set
 * - Buffer is flushed on first save
 * - Compaction doesn't affect the journal
 * - Turn index is restored on load
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentContextNextGen } from '../../../../src/core/context-nextgen/AgentContextNextGen.js';
import { FileContextStorage } from '../../../../src/infrastructure/storage/FileContextStorage.js';
import { MessageRole } from '../../../../src/domain/entities/Message.js';
import { ContentType } from '../../../../src/domain/entities/Content.js';
import type { Message, OutputItem } from '../../../../src/domain/entities/Message.js';

function makeAssistantOutput(text: string): OutputItem[] {
  return [{
    type: 'message',
    role: MessageRole.ASSISTANT,
    content: [{ type: ContentType.OUTPUT_TEXT, text }],
  } as Message];
}

describe('AgentContextNextGen - History Journal Integration', () => {
  let testDir: string;
  let storage: FileContextStorage;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ctx-journal-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new FileContextStorage({ agentId: 'test-agent', baseDirectory: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should expose journal from storage', () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
    });

    expect(ctx.journal).not.toBeNull();
    ctx.destroy();
  });

  it('should return null journal when no storage', () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
    });

    expect(ctx.journal).toBeNull();
    ctx.destroy();
  });

  it('should buffer entries before save and flush on first save', async () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    // Add messages without saving (no sessionId yet)
    ctx.addUserMessage('Hello');
    ctx.addAssistantResponse(makeAssistantOutput('Hi there!'));
    ctx.addUserMessage('How are you?');
    ctx.addAssistantResponse(makeAssistantOutput('Great, thanks!'));

    // Journal should have nothing yet (no sessionId)
    // But internal buffer should have 4 entries

    // Now save — this establishes sessionId and flushes buffer
    await ctx.save('test-session-1');

    // Read from journal
    const journal = ctx.journal!;
    const entries = await journal.read('test-session-1');

    expect(entries).toHaveLength(4);
    expect(entries[0]!.type).toBe('user');
    expect(entries[1]!.type).toBe('assistant');
    expect(entries[2]!.type).toBe('user');
    expect(entries[3]!.type).toBe('assistant');

    // Turn indices should increment on user messages
    expect(entries[0]!.turnIndex).toBe(1); // First user message = turn 1
    expect(entries[1]!.turnIndex).toBe(1); // Assistant response = same turn
    expect(entries[2]!.turnIndex).toBe(2); // Second user message = turn 2
    expect(entries[3]!.turnIndex).toBe(2); // Assistant response = same turn

    ctx.destroy();
  });

  it('should append directly after sessionId is established', async () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    // Save first to establish sessionId
    await ctx.save('test-session-2');

    // Now add messages — should go directly to journal
    ctx.addUserMessage('Hello');
    ctx.addAssistantResponse(makeAssistantOutput('Hi!'));

    // Small delay for fire-and-forget append to complete
    await new Promise(r => setTimeout(r, 50));

    const entries = await ctx.journal!.read('test-session-2');
    expect(entries).toHaveLength(2);

    ctx.destroy();
  });

  it('should journal tool results', async () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    await ctx.save('test-session-3');

    ctx.addUserMessage('Search for cats');
    // Simulate assistant with tool_use
    ctx.addAssistantResponse([{
      type: 'message',
      role: MessageRole.ASSISTANT,
      content: [{
        type: ContentType.TOOL_USE,
        id: 'call_123',
        name: 'web_search',
        input: { query: 'cats' },
      }],
    } as Message]);
    // Add tool results
    ctx.addToolResults([{
      tool_use_id: 'call_123',
      content: { results: ['cat1', 'cat2'] },
    }]);

    await new Promise(r => setTimeout(r, 50));

    const entries = await ctx.journal!.read('test-session-3');
    expect(entries).toHaveLength(3);
    expect(entries[0]!.type).toBe('user');
    expect(entries[1]!.type).toBe('tool_result');
    expect(entries[2]!.type).toBe('assistant');

    ctx.destroy();
  });

  it('should preserve journal across compaction', async () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    await ctx.save('test-session-4');

    // Add several turns
    for (let i = 0; i < 5; i++) {
      ctx.addUserMessage(`Question ${i}`);
      ctx.addAssistantResponse(makeAssistantOutput(`Answer ${i}`));
    }

    await new Promise(r => setTimeout(r, 50));

    // Journal should have all 10 entries
    const beforeCompaction = await ctx.journal!.read('test-session-4');
    expect(beforeCompaction).toHaveLength(10);

    // Even if we clear the conversation (simulating compaction effect)
    ctx.clearConversation();

    // Journal remains intact
    const afterClear = await ctx.journal!.read('test-session-4');
    expect(afterClear).toHaveLength(10);

    ctx.destroy();
  });

  it('should restore turn index on load', async () => {
    // Create and populate a session
    const ctx1 = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    await ctx1.save('test-session-5');

    ctx1.addUserMessage('Q1');
    ctx1.addAssistantResponse(makeAssistantOutput('A1'));
    ctx1.addUserMessage('Q2');
    ctx1.addAssistantResponse(makeAssistantOutput('A2'));

    await new Promise(r => setTimeout(r, 50));
    await ctx1.save('test-session-5');
    ctx1.destroy();

    // Load the session in a new context
    const ctx2 = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    await ctx2.load('test-session-5');

    // Add more messages — turn index should continue from where it left off
    ctx2.addUserMessage('Q3');
    ctx2.addAssistantResponse(makeAssistantOutput('A3'));

    await new Promise(r => setTimeout(r, 50));

    const entries = await ctx2.journal!.read('test-session-5');

    // Should have all 6 entries (4 from first context + 2 new)
    expect(entries).toHaveLength(6);

    // New entries should have higher turn indices than old ones
    const lastOldTurn = entries[3]!.turnIndex;
    const firstNewTurn = entries[4]!.turnIndex;
    expect(firstNewTurn).toBeGreaterThan(lastOldTurn);

    ctx2.destroy();
  });

  it('should not journal when no storage configured', () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      features: { workingMemory: false, inContextMemory: false },
    });

    // Should not throw
    ctx.addUserMessage('Hello');
    ctx.addAssistantResponse(makeAssistantOutput('Hi'));

    expect(ctx.journal).toBeNull();
    ctx.destroy();
  });

  it('should filter journal entries by type', async () => {
    const ctx = AgentContextNextGen.create({
      model: 'gpt-4',
      storage,
      features: { workingMemory: false, inContextMemory: false },
    });

    await ctx.save('test-session-6');

    ctx.addUserMessage('Q1');
    ctx.addAssistantResponse(makeAssistantOutput('A1'));
    ctx.addUserMessage('Q2');
    ctx.addAssistantResponse(makeAssistantOutput('A2'));

    await new Promise(r => setTimeout(r, 50));

    const userOnly = await ctx.journal!.read('test-session-6', { types: ['user'] });
    expect(userOnly).toHaveLength(2);
    expect(userOnly.every(e => e.type === 'user')).toBe(true);

    ctx.destroy();
  });
});
