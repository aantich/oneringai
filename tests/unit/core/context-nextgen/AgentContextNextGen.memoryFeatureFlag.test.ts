/**
 * Feature-flag auto-init wiring for the memory read + write plugins.
 *
 * Coverage:
 *   - `memory: true` auto-registers MemoryPluginNextGen (read-only tools)
 *   - `memory: true` without a MemorySystem throws
 *   - `memoryWrite: true` without `memory: true` throws (write plugin depends
 *     on read plugin's bootstrap + profile injection)
 *   - `memory: true, memoryWrite: true` auto-registers both plugins, and the
 *     write plugin shares the read plugin's bootstrapped entity ids via its
 *     getOwnSubjectIds callback
 *   - `memoryWrite: true` can inherit the MemorySystem from plugins.memory.memory
 */

import { describe, it, expect } from 'vitest';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { MemoryPluginNextGen } from '@/core/context-nextgen/plugins/MemoryPluginNextGen.js';
import { MemoryWritePluginNextGen } from '@/core/context-nextgen/plugins/MemoryWritePluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER_ID = 'u1';
const AGENT_ID = 'agent-1';
const MODEL = 'gpt-4';

function makeMem(): MemorySystem {
  return new MemorySystem({ store: new InMemoryAdapter() });
}

describe('AgentContextNextGen feature-flag auto-init — memory / memoryWrite', () => {
  it('memory: true auto-registers MemoryPluginNextGen (reads only — 5 tools)', () => {
    const mem = makeMem();
    const ctx = AgentContextNextGen.create({
      model: MODEL,
      agentId: AGENT_ID,
      userId: USER_ID,
      features: { memory: true },
      plugins: { memory: { memory: mem } },
    });
    const plugin = ctx.getPlugin<MemoryPluginNextGen>('memory');
    expect(plugin).toBeInstanceOf(MemoryPluginNextGen);
    expect(plugin!.getTools().length).toBe(5);
    // No write plugin unless asked.
    expect(ctx.getPlugin('memory_write') ?? null).toBeNull();
    ctx.destroy();
  });

  it('memory: true without a MemorySystem throws', () => {
    expect(() =>
      AgentContextNextGen.create({
        model: MODEL,
        agentId: AGENT_ID,
        userId: USER_ID,
        features: { memory: true },
      }),
    ).toThrow(/MemorySystem/i);
  });

  it('memoryWrite: true without memory: true throws', () => {
    const mem = makeMem();
    expect(() =>
      AgentContextNextGen.create({
        model: MODEL,
        agentId: AGENT_ID,
        userId: USER_ID,
        features: { memoryWrite: true },
        plugins: { memoryWrite: { memory: mem } },
      }),
    ).toThrow(/requires the 'memory' feature/);
  });

  it('memory + memoryWrite registers both and shares getOwnSubjectIds', async () => {
    const mem = makeMem();
    const ctx = AgentContextNextGen.create({
      model: MODEL,
      agentId: AGENT_ID,
      userId: USER_ID,
      features: { memory: true, memoryWrite: true },
      plugins: { memory: { memory: mem } },
    });

    const readPlugin = ctx.getPlugin<MemoryPluginNextGen>('memory');
    const writePlugin = ctx.getPlugin<MemoryWritePluginNextGen>('memory_write');
    expect(readPlugin).toBeInstanceOf(MemoryPluginNextGen);
    expect(writePlugin).toBeInstanceOf(MemoryWritePluginNextGen);

    // Trigger read-plugin bootstrap so ids exist.
    await readPlugin!.getContent();
    const ids = readPlugin!.getBootstrappedIds();
    expect(ids.userEntityId).toBeDefined();
    expect(ids.agentEntityId).toBeDefined();

    // memory_remember on "me" via the write plugin should route to the
    // read plugin's bootstrapped user entity.
    const remember = writePlugin!
      .getTools()
      .find((t) => t.definition.function.name === 'memory_remember')!;
    const result: any = await remember.execute(
      { subject: 'me', predicate: 'favourite_color', value: 'teal' },
      { userId: USER_ID },
    );
    expect(result.error).toBeUndefined();
    expect(result.fact.subjectId).toBe(ids.userEntityId);

    ctx.destroy();
  });

  it('memoryWrite inherits MemorySystem from plugins.memory when plugins.memoryWrite.memory unset', () => {
    const mem = makeMem();
    const ctx = AgentContextNextGen.create({
      model: MODEL,
      agentId: AGENT_ID,
      userId: USER_ID,
      features: { memory: true, memoryWrite: true },
      plugins: { memory: { memory: mem } }, // no memoryWrite config
    });
    const writePlugin = ctx.getPlugin<MemoryWritePluginNextGen>('memory_write');
    expect(writePlugin).toBeInstanceOf(MemoryWritePluginNextGen);
    // The write plugin's tools should be usable.
    expect(writePlugin!.getTools().length).toBe(5);
    ctx.destroy();
  });

  it('total tools across plugins equals 10 when both features enabled', () => {
    const mem = makeMem();
    const ctx = AgentContextNextGen.create({
      model: MODEL,
      agentId: AGENT_ID,
      userId: USER_ID,
      features: { memory: true, memoryWrite: true, workingMemory: false, inContextMemory: false },
      plugins: { memory: { memory: mem } },
    });
    const read = ctx.getPlugin<MemoryPluginNextGen>('memory')!.getTools();
    const write = ctx.getPlugin<MemoryWritePluginNextGen>('memory_write')!.getTools();
    const names = new Set([...read, ...write].map((t) => t.definition.function.name));
    expect(names.size).toBe(10);
    ctx.destroy();
  });
});
