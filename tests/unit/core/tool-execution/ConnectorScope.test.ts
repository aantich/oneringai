import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { ToolManager } from '@/core/ToolManager.js';
import { captureConnectorScope, sameConnectorScope } from '@/core/tool-execution/connectorScope.js';
import type { IConnectorRegistry } from '@/domain/interfaces/IConnectorRegistry.js';
import { ConnectorNotFoundError } from '@/domain/errors/AIErrors.js';
const managers: ToolManager[] = [];
afterEach(() => { managers.splice(0).forEach(m => m.destroy()); Connector.setRegistry(null); Connector.setAccessPolicy(null); Connector.clear(); });
function ambientRegistry() {
  const alice = Connector.create({ name: 'alice', auth: { type: 'none' } });
  const bob = Connector.create({ name: 'bob', auth: { type: 'none' } });
  let tenant = alice;
  const registry: IConnectorRegistry = {
    get: name => { if (name !== tenant.name) throw new ConnectorNotFoundError('hidden'); return tenant; },
    has: name => tenant.name === name, list: () => [tenant.name], listAll: () => [tenant], size: () => 1,
    getDescriptionsForTools: () => tenant.name, getInfo: () => ({}),
    getById: id => { if (id !== tenant.id) throw new ConnectorNotFoundError('hidden'); return tenant; },
  };
  return { alice, bob, registry, rebind: () => { tenant = bob; } };
}
describe('invocation connector authority', () => {
  it('captures an ambient tenant registry while keeping new executions live', async () => {
    const { alice, bob, registry, rebind } = ambientRegistry(); let ready!: () => void; let resume!: () => void;
    const admitted = new Promise<void>(r => { ready = r; }); const gate = new Promise<void>(r => { resume = r; });
    const manager = new ToolManager(); managers.push(manager); manager.setToolContext({ userId: 'alice', connectorRegistry: registry });
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: async (_args, ctx) => {
      ready(); await gate; const captured = ctx!.connectorRegistry!;
      return { names: captured.list(), alice: captured.has('alice'), bob: captured.has('bob'), instance: captured.get('alice'), byId: captured.getById!(alice.id) };
    } });
    const first = manager.execute('probe', {}); await admitted; rebind(); manager.mergeToolContext({ userId: 'bob' }); resume();
    expect(await first).toEqual({ names: ['alice'], alice: true, bob: false, instance: alice, byId: alice });
    manager.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: async (_args, ctx) => ctx!.connectorRegistry!.get('bob') });
    expect(await manager.execute('probe', {})).toBe(bob);
  });
  it('detects rebinding even when the source registry object stays identical', () => {
    const { registry, rebind, bob } = ambientRegistry(); const captured = captureConnectorScope(registry);
    expect(sameConnectorScope(captured, registry)).toBe(true); rebind(); expect(sameConnectorScope(captured, registry)).toBe(false);
    expect(() => captured.get('bob')).toThrow(ConnectorNotFoundError); expect(() => captured.getById!(bob.id)).toThrow(ConnectorNotFoundError);
    expect(captured.list()).toEqual(['alice']); expect(captured.size()).toBe(1);
    expect(captured.getDescriptionsForTools()).toContain('alice'); expect(captured.getInfo()).toHaveProperty('alice');
  });
  it('retains configuration/authentication errors without treating them as missing connectors', () => {
    const { registry } = ambientRegistry(); const error = new Error('authentication failed');
    registry.get = () => { throw error; }; const captured = captureConnectorScope(registry);
    expect(captured.has('alice')).toBe(true); expect(() => captured.get('alice')).toThrow(error);
    expect(() => captured.listAll()).toThrow(error); expect(() => captured.get('hidden')).toThrow(ConnectorNotFoundError);
  });
  it('keeps not-found failures private and has false, with optional ID lookup remaining optional', () => {
    const { registry } = ambientRegistry(); registry.get = () => { throw new ConnectorNotFoundError('unavailable'); }; delete registry.getById;
    const captured = captureConnectorScope(registry); expect(captured.has('alice')).toBe(false); expect(() => captured.get('alice')).toThrow('unavailable');
    expect(captured.getById).toBeUndefined(); expect(sameConnectorScope(undefined, undefined)).toBe(true); expect(sameConnectorScope(captured, undefined)).toBe(false);
  });
  it('does not retain host registry listeners or await work after capture', () => {
    const { registry, rebind } = ambientRegistry(); const get = vi.spyOn(registry, 'get'); const captured = captureConnectorScope(registry); get.mockClear(); rebind();
    captured.get('alice'); captured.has('alice'); captured.listAll(); captured.getById!(captured.get('alice').id);
    expect(get).not.toHaveBeenCalled();
  });
});
