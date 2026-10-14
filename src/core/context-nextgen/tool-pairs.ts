import { AIError } from '../../domain/errors/AIErrors.js';
import type { InputItem } from '../../domain/entities/Message.js';
import type { Content } from '../../domain/entities/Content.js';
import { ContentType } from '../../domain/entities/Content.js';

/** Function and custom calls have separate ID namespaces. */
function contentKey(content: Content): { key: string; result: boolean } | undefined {
  switch (content.type) {
    case ContentType.TOOL_USE: return { key: `function:${content.id}`, result: false };
    case ContentType.CUSTOM_TOOL_USE: return { key: `custom:${content.id}`, result: false };
    case ContentType.TOOL_RESULT: return { key: `function:${content.tool_use_id}`, result: true };
    case ContentType.CUSTOM_TOOL_RESULT: return { key: `custom:${content.tool_use_id}`, result: true };
    default: return undefined;
  }
}

export function toolProtocolKeys(item: InputItem): string[] {
  if (item.type === 'message' && Array.isArray(item.content)) return item.content.flatMap(content => {
    const entry = contentKey(content);
    return entry ? [entry.key] : [];
  });
  if (item.type === 'function_call_output') return [`function:${item.call_id}`];
  if (item.type === 'custom_tool_call_output') return [`custom:${item.call_id}`];
  return [];
}

/** Native async calls may remain unresolved across subsequent model requests. */
function unresolvedAsyncKeys(items: readonly InputItem[]): Set<string> {
  const asynchronous = new Set<string>();
  const results = new Set<string>();
  for (const item of items) {
    if (item.type === 'message' && Array.isArray(item.content)) item.content.forEach(content => {
      const entry = contentKey(content);
      if (!entry) return;
      if (entry.result) results.add(entry.key);
      else if ((content.type === ContentType.TOOL_USE || content.type === ContentType.CUSTOM_TOOL_USE) && content.async) asynchronous.add(entry.key);
    });
    else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') toolProtocolKeys(item).forEach(key => results.add(key));
  }
  results.forEach(key => asynchronous.delete(key));
  return asynchronous;
}

/** Unacknowledged observations cannot lose their raw copy through context reduction. */
export function hasUnacknowledgedEvidence(item: InputItem): boolean {
  return item.type === 'message' && Array.isArray(item.content) && item.content.some(content =>
    (content.type === ContentType.TOOL_RESULT || content.type === ContentType.CUSTOM_TOOL_RESULT)
    && content.evidence?.version === 1 && content.evidence.status === 'storage_failed');
}

/** All removable connected components, ordered by their oldest history item. */
export function removableMessageGroups(history: readonly InputItem[], pending: readonly InputItem[]): number[][] {
  const entries = history.map(toolProtocolKeys);
  const protectedKeys = new Set([...pending.flatMap(toolProtocolKeys), ...unresolvedAsyncKeys([...history, ...pending])]);
  const byKey = new Map<string, number[]>();
  entries.forEach((ids, index) => ids.forEach(id => {
    const group = byKey.get(id) ?? [];
    group.push(index);
    byKey.set(id, group);
  }));
  const visited = new Set<number>();
  const result: number[][] = [];
  for (let index = 0; index < history.length; index++) {
    if (visited.has(index)) continue;
    const component = new Set<number>([index]);
    let protectedComponent = false;
    for (const member of component) {
      visited.add(member);
      if (hasUnacknowledgedEvidence(history[member]!)) protectedComponent = true;
      for (const key of entries[member]!) {
        if (protectedKeys.has(key)) protectedComponent = true;
        for (const related of byKey.get(key) ?? []) component.add(related);
      }
    }
    if (!protectedComponent) result.push([...component]);
  }
  return result;
}

/** Expand proposals to whole groups; dependencies on pending input protect the group. */
export function removableToolGroups(history: readonly InputItem[], pending: readonly InputItem[], indices: number[]): Set<number> {
  const requested = new Set(indices.filter(Number.isInteger));
  return new Set(removableMessageGroups(history, pending)
    .filter(group => group.some(index => requested.has(index))).flat());
}

/** Preserve native async calls and opaque continuation items; remove unmatched message blocks. */
export function sanitizeToolPairsWithOrigins(items: InputItem[]): Array<{ original: InputItem; item: InputItem }> {
  const calls = new Set<string>();
  const results = new Set<string>();
  const asyncKeys = unresolvedAsyncKeys(items);
  const addResult = (key: string) => {
    if (results.has(key)) throw new AIError(`Duplicate final tool result for ${key}. Return one final result per call; deliver later updates as messages.`, 'INVALID_TOOL_PROTOCOL', 400);
    results.add(key);
  };
  for (const item of items) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      item.content.forEach(content => {
        const entry = contentKey(content);
        if (entry) {
          if (entry.result) addResult(entry.key);
          else if (calls.has(entry.key)) throw new AIError(`Duplicate tool call ID: ${entry.key}`, 'INVALID_TOOL_PROTOCOL', 400);
          else calls.add(entry.key);
        }
      });
    } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      toolProtocolKeys(item).forEach(addResult);
    }
  }
  return items.flatMap<{ original: InputItem; item: InputItem }>(item => {
    if (item.type !== 'message' || !Array.isArray(item.content)) return [{ original: item, item }];
    const content = item.content.filter(block => {
      const entry = contentKey(block);
      return !entry || (entry.result ? calls.has(entry.key) : results.has(entry.key) || asyncKeys.has(entry.key));
    });
    if (content.length === item.content.length) return [{ original: item, item }];
    return content.length ? [{ original: item, item: { ...item, content } }] : [];
  });
}

export function sanitizeToolPairs(items: InputItem[]): InputItem[] {
  return sanitizeToolPairsWithOrigins(items).map(entry => entry.item);
}
