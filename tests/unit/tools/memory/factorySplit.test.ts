/**
 * createMemoryReadTools / createMemoryWriteTools / createMemoryTools — factory
 * split coverage.
 *
 *   - Read factory returns the 5 read tools only (no mutators)
 *   - Write factory returns the 6 write tools only (no readers, includes memory_set_agent_rule)
 *   - Combined factory returns all 11 tools, no duplicates
 *   - Each tool in each bundle has a well-formed ToolFunction.definition
 *     (so OpenAI's strict schema validator can accept them — guards against
 *     another "array missing items" regression)
 */

import { describe, it, expect } from 'vitest';
import {
  createMemoryReadTools,
  createMemoryWriteTools,
  createMemoryTools,
} from '@/tools/memory/index.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const AGENT_ID = 'a1';
const USER_ID = 'u1';

function makeMem(): MemorySystem {
  return new MemorySystem({ store: new InMemoryAdapter() });
}

const READ_NAMES = [
  'memory_find_entity',
  'memory_graph',
  'memory_list_facts',
  'memory_recall',
  'memory_search',
];

const WRITE_NAMES = [
  'memory_forget',
  'memory_link',
  'memory_remember',
  'memory_restore',
  'memory_set_agent_rule',
  'memory_upsert_entity',
];

describe('memory tool factory split', () => {
  it('createMemoryReadTools returns exactly the 5 read tools', () => {
    const mem = makeMem();
    const tools = createMemoryReadTools({ memory: mem, agentId: AGENT_ID, defaultUserId: USER_ID });
    const names = tools.map((t) => t.definition.function.name).sort();
    expect(names).toEqual(READ_NAMES);
  });

  it('createMemoryWriteTools returns exactly the 6 write tools', () => {
    const mem = makeMem();
    const tools = createMemoryWriteTools({
      memory: mem,
      agentId: AGENT_ID,
      defaultUserId: USER_ID,
    });
    const names = tools.map((t) => t.definition.function.name).sort();
    expect(names).toEqual(WRITE_NAMES);
  });

  it('createMemoryTools returns the union — 11 tools, no duplicates', () => {
    const mem = makeMem();
    const tools = createMemoryTools({ memory: mem, agentId: AGENT_ID, defaultUserId: USER_ID });
    const names = tools.map((t) => t.definition.function.name);
    expect(names.length).toBe(11);
    expect(new Set(names).size).toBe(11);
    for (const expected of [...READ_NAMES, ...WRITE_NAMES]) {
      expect(names).toContain(expected);
    }
  });

  it('every tool schema declares valid parameters (no arrays missing items)', () => {
    const mem = makeMem();
    const tools = createMemoryTools({ memory: mem, agentId: AGENT_ID, defaultUserId: USER_ID });
    for (const tool of tools) {
      const params = tool.definition.function.parameters as
        | { type?: string; properties?: Record<string, unknown> }
        | undefined;
      expect(params?.type).toBe('object');
      expect(params?.properties).toBeDefined();
      // Recurse and assert arrays have items (OpenAI strict-mode invariant).
      assertArraysHaveItems(params!.properties!, tool.definition.function.name);
    }
  });
});

/**
 * Walk a JSON-schema fragment looking for `{type: 'array', ...}` nodes without
 * an `items` subschema. OpenAI's function-parameter validator rejects these.
 */
function assertArraysHaveItems(node: unknown, toolName: string, path: string[] = []): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'array' && !('items' in n)) {
    throw new Error(
      `tool ${toolName} has an array schema missing \`items\` at path ${path.join('.')}`,
    );
  }
  for (const [k, v] of Object.entries(n)) {
    if (v && typeof v === 'object') assertArraysHaveItems(v, toolName, [...path, k]);
  }
}
