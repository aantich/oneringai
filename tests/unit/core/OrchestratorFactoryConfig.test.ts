import { describe, expect, it } from 'vitest';
import { checkFactoryConfig, detachFactoryConfig } from '@/core/orchestrator/factoryConfig.js';
import { AgentContextNextGen } from '@/index.js';

const reserved = new Set(['assign_turn', 'store_get']);
const tool = (name: string) => ({ definition: { type: 'function' as const, function: { name } }, execute: async function() { return 'owned host receiver'; } });
describe('new orchestrator configuration admission', () => {
  it('detaches mutable inference/context/plugin/identity containers and retains executable/backend identities', () => {
    const storage = { save: async () => {} }, callback = () => {}, executable = tool('host_tool');
    const policy = { name: 'host-policy', evaluate: async () => ({ verdict: 'allow' }) };
    const original = { connector: 'main', model: 'model', temperature: 0, asyncTools: { autoContinue: false }, hooks: { 'before:llm': callback }, tools: [executable], permissions: { policies: [policy] },
      identities: [{ connector: 'service', accountId: 'work', toolFilter: ['read'] }], context: { responseReserve: 0, storage, features: { memory: true }, plugins: { memory: { maxResults: 3 } } } };
    const snapshot = detachFactoryConfig(original); snapshot.identities[0]!.toolFilter.push('changed'); snapshot.context.plugins.memory.maxResults = 9; snapshot.asyncTools.autoContinue = true;
    expect(original.identities[0]!.toolFilter).toEqual(['read']); expect(original.context.plugins.memory.maxResults).toBe(3); expect(original.asyncTools.autoContinue).toBe(false);
    expect(snapshot.context.storage).toBe(storage); expect(snapshot.hooks['before:llm']).toBe(callback); expect(snapshot.tools[0]).toBe(executable); expect(snapshot.tools).not.toBe(original.tools); expect(snapshot.temperature).toBe(0); expect(snapshot.context.responseReserve).toBe(0);
    expect(snapshot.permissions.policies).not.toBe(original.permissions.policies); expect(snapshot.permissions.policies[0]).toBe(policy);
  });
  it.each(['name', 'parentAgentId', 'toolManager'])('rejects a forbidden own %s even when undefined and supplied through a variable', key => {
    const config = { connector: 'main', model: 'model', [key]: undefined }; expect(() => checkFactoryConfig(config, reserved)).toThrow(/library-owned/);
  });
  it('rejects live context objects and conflicting authority channels without affecting ordinary contexts', () => {
    const context = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { workingMemory: false, inContextMemory: false } });
    try { expect(() => checkFactoryConfig({ connector: 'main', model: 'model', context }, reserved)).toThrow(/plain configuration/); expect(context.isDestroyed).toBe(false); } finally { context.destroy(); }
    expect(() => checkFactoryConfig({ connector: 'main', model: 'model', userId: 'host', context: { userId: 'other' } }, reserved)).toThrow(/userId authority/);
    expect(() => checkFactoryConfig({ connector: 'main', model: 'model', identities: [{ connector: 'one' }], context: { identities: [{ connector: 'two' }] } }, reserved)).toThrow(/identities/);
    expect(() => checkFactoryConfig({ connector: 'main', model: 'model', context: { identities: [] } }, reserved)).toThrow(/identities/);
  });
  it('accepts equivalent identity ordering while preserving explicit values and omission', () => {
    const result = checkFactoryConfig({ connector: 'main', model: 'model', userId: 'host', temperature: 0,
      identities: [{ connector: 'one', toolFilter: ['b', 'a'] }, { connector: 'two' }],
      context: { userId: 'host', identities: [{ connector: 'two' }, { connector: 'one', toolFilter: ['a', 'b'] }], responseReserve: 0, features: { sharedWorkspace: false, workingMemory: false } }, asyncTools: { autoContinue: false } }, reserved);
    expect(result.temperature).toBe(0); expect(result.context?.responseReserve).toBe(0); expect(result.context?.features?.workingMemory).toBe(false); expect(result.asyncTools?.autoContinue).toBe(false); expect(Object.hasOwn(result, 'thinking')).toBe(false);
  });
  it.each([
    { tools: [tool('assign_turn')] }, { tools: [tool('host')], context: { tools: [tool('host')] } },
    { context: { plugins: { sharedWorkspace: {} } } },
  ])('rejects reserved/duplicate tool and workspace ownership before construction (%#)', input => {
    expect(() => checkFactoryConfig({ connector: 'main', model: 'model', ...input }, reserved)).toThrow(/collision|library-owned/);
  });
  it('retains an explicit workspace feature flag while reserving the actual shared board for library ownership', () => {
    expect(checkFactoryConfig({ connector: 'main', model: 'model', context: { features: { sharedWorkspace: true } } }, reserved).context?.features?.sharedWorkspace).toBe(true);
  });
});
