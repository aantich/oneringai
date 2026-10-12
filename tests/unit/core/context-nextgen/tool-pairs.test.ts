import { describe, expect, it } from 'vitest';
import { removableToolGroups, sanitizeToolPairs } from '@/core/context-nextgen/tool-pairs.js';
import type { Content } from '@/domain/entities/Content.js';
import type { Message } from '@/domain/entities/Message.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';

const message = (...content: Content[]): Message => ({ type: 'message', role: MessageRole.USER, content });
const call = (id: string, async = false): Content => ({ type: ContentType.TOOL_USE, id, name: 'lookup', arguments: '{}', async });
const result = (id: string): Content => ({ type: ContentType.TOOL_RESULT, tool_use_id: id, content: 'evidence' });
const text: Content = { type: ContentType.INPUT_TEXT, text: 'exact text' };

describe('tool protocol groups', () => {
  it('keeps multiple distinct calls and results in shared messages', () => {
    const items = [message(call('a'), call('b')), message(result('a'), result('b'))];
    expect(sanitizeToolPairs(items)).toEqual(items);
    expect([...removableToolGroups(items, [], [1])].sort()).toEqual([0, 1]);
  });
  it('preserves native async calls without final results and protects them from eviction', () => {
    const items = [message(call('pending', true)), message(text)];
    expect(sanitizeToolPairs(items)).toEqual(items);
    expect([...removableToolGroups(items, [], [0, 1])]).toEqual([1]);
  });
  it('protects a whole component when one asynchronous call is outstanding', () => {
    const items = [message(call('done'), call('pending', true)), message(result('done'))];
    expect([...removableToolGroups(items, [], [1])]).toEqual([]);
  });
  it('allows eviction after an asynchronous call receives its result', () => {
    const items = [message(call('done', true)), message(text), message(result('done'))];
    expect([...removableToolGroups(items, [], [2])].sort()).toEqual([0, 2]);
  });
  it('does not mistake duplicate final results for parallel calls', () => {
    expect(() => sanitizeToolPairs([message(call('a')), message(result('a'), result('a'))])).toThrow('Duplicate final tool result');
  });
  it('rejects duplicate final outputs across message and native formats', () => {
    expect(() => sanitizeToolPairs([message(call('a')), message(result('a')),
      { type: 'function_call_output', call_id: 'a', output: 'duplicate' }])).toThrow('Duplicate final tool result');
  });
  it('rejects duplicate calls without dropping their results arbitrarily', () => {
    expect(() => sanitizeToolPairs([message(call('a'), call('a')), message(result('a'))])).toThrow('Duplicate tool call ID');
  });
  it('keeps custom asynchronous calls intact', () => {
    const items = [message({ type: ContentType.CUSTOM_TOOL_USE, id: 'custom', name: 'shell', input: 'work', async: true })];
    expect(sanitizeToolPairs(items)).toEqual(items);
    expect([...removableToolGroups(items, [], [0])]).toEqual([]);
  });
  it('sanitizes only unmatched blocks in mixed messages', () => {
    const original = message(call('missing'), text, result('orphan'));
    expect(sanitizeToolPairs([original])).toEqual([message(text)]);
    expect(original.content).toHaveLength(3);
  });
  it('drops empty orphan messages and preserves provider-opaque continuation state', () => {
    const opaque = { type: 'compaction' as const, id: 'opaque', encrypted_content: 'exact ciphertext' };
    expect(sanitizeToolPairs([message(call('missing')), opaque])).toEqual([opaque]);
  });
  it('links a native output to a message call for removal', () => {
    const items = [message(call('native')), { type: 'function_call_output' as const, call_id: 'native', output: 'done' }];
    expect(sanitizeToolPairs(items)).toEqual(items);
    expect([...removableToolGroups(items, [], [1])].sort()).toEqual([0, 1]);
    expect([...removableToolGroups(items.slice(0, 1), items.slice(1), [0])]).toEqual([]);
  });
  it('ignores invalid indices and deduplicates connected proposals', () => {
    const items = [message(call('a')), message(result('a')), message(text)];
    expect([...removableToolGroups(items, [], [-1, 9, 1.5, 0, 0, 1])].sort()).toEqual([0, 1]);
  });
});
