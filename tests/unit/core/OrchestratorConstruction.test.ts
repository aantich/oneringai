import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, ConnectorTools, SharedWorkspacePluginNextGen } from '@/index.js';
import type { AgentContextNextGenConfig, IConnectorRegistry } from '@/index.js';
import { PluginRegistry } from '@/core/context-nextgen/PluginRegistry.js';
import { BasePluginNextGen } from '@/core/context-nextgen/BasePluginNextGen.js';
import { markOrchestratorConstruction } from '@/core/orchestrator/construction.js';
import { fixture } from './routing/fixture.js';
const agents: Agent[] = [], boards: SharedWorkspacePluginNextGen[] = [];
class Probe extends BasePluginNextGen {
  readonly name = 'construction_probe';
  constructor(private toolName = 'probe', private observe = () => {}) { super(); }
  getInstructions() { return 'Probe'; }
  async getContent() { return null; }
  getContents() { return {}; }
  getTools() { this.observe(); return [{ definition: { type: 'function' as const, function: { name: this.toolName } }, execute: async () => 'probe' }]; }
}
function marked(workspace: SharedWorkspacePluginNextGen, worker = false, extra: Partial<AgentContextNextGenConfig> = {}, registry?: IConnectorRegistry): AgentContextNextGenConfig {
  const context = { model: 'main', ...extra, features: { workingMemory: false, inContextMemory: false, ...extra.features } };
  markOrchestratorConstruction(context, { version: 1, workspace, worker, registry }); return context;
}
afterEach(() => { PluginRegistry.remove('constructionProbe'); agents.splice(0).forEach(a => a.destroy()); boards.splice(0).forEach(b => b.destroy()); ConnectorTools.unregisterService('construction-custom'); Connector.setRegistry(null); Connector.clear(); vi.restoreAllMocks(); });
describe('selected orchestrator construction integration', () => {
  it('installs exactly one owned board before dynamic plugin tools and honors an explicit workspace flag', () => {
    const f = fixture(); agents.push(f.agent); const board = new SharedWorkspacePluginNextGen(); boards.push(board); let initialized = false, observed = false;
    const get = board.getTools.bind(board); vi.spyOn(board, 'getTools').mockImplementation(() => { initialized = true; return get(); });
    PluginRegistry.register('construction_probe', () => new Probe('probe', () => { observed = initialized; }), { featureKey: 'constructionProbe' });
    const agent = Agent.create({ connector: f.name, model: 'main', context: marked(board, false, { features: { sharedWorkspace: true, constructionProbe: true }, responseReserve: 0 }) }); agents.push(agent);
    expect(observed).toBe(true); expect(agent.context.getPlugin('shared_workspace')).toBe(board); expect(agent.context.getPlugins().filter(p => p.name === 'shared_workspace')).toHaveLength(1); expect(agent.tools.list()).toContain('store_get'); expect(agent.tools.list()).toContain('probe');
    // The construction-only collision guard ends when Agent.create succeeds.
    expect(() => agent.tools.register({ definition: { type: 'function', function: { name: 'probe' } }, execute: async () => 'new host implementation' })).not.toThrow();
  });
  it.each([true, false])('rolls back a dynamic collision and preserves board ownership (worker=%s)', worker => {
    const f = fixture(); agents.push(f.agent); const board = new SharedWorkspacePluginNextGen(); boards.push(board); const destroy = vi.spyOn(board, 'destroy'); const plugin = new Probe('store_get'), cleanup = vi.spyOn(plugin, 'destroy');
    PluginRegistry.register('construction_probe', () => plugin, { featureKey: 'constructionProbe' });
    expect(() => Agent.create({ connector: f.name, model: 'main', context: marked(board, worker, { features: { constructionProbe: true } }) })).toThrow(/tool collision/);
    expect(cleanup).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalledTimes(worker ? 0 : 1);
  });
  it('uses the host registry for actual tool execution when the global registry cannot see that connector', async () => {
    const f = fixture(); agents.push(f.agent); const model = Connector.get(f.name), authorized = Connector.create({ name: 'authorized', serviceType: 'custom', auth: { type: 'none' } });
    const registry = { get: (name: string) => { if (name === 'authorized') return authorized; if (name === f.name) return model; throw new Error('Host scope denied'); }, list: () => ['authorized', f.name], has: (name: string) => name === 'authorized' || name === f.name } as IConnectorRegistry;
    Connector.setRegistry({ get: () => { throw new Error('Global scope denied'); }, list: () => [], has: () => false } as never);
    const board = new SharedWorkspacePluginNextGen(); boards.push(board);
    const agent = Agent.create({ connector: model, model: 'main', registry, permissions: { autoApproveAll: true }, context: marked(board, false, {}, registry),
      tools: [{ definition: { type: 'function', function: { name: 'host_scoped_read' } }, execute: async (_args, context) => context?.connectorRegistry?.get('authorized').id }] }); agents.push(agent);
    expect(await agent.tools.execute('host_scoped_read', {})).toBe(authorized.id); expect(() => Connector.get('authorized')).toThrow(/Global scope/);
  });
  it('does not swallow a dynamic identity-tool collision on the selected path', () => {
    const f = fixture(); agents.push(f.agent); Connector.create({ name: 'identity', serviceType: 'construction-custom', auth: { type: 'none' } });
    ConnectorTools.registerService('construction-custom', () => [{ definition: { type: 'function', function: { name: 'read' } }, execute: async () => 'identity' }]);
    const board = new SharedWorkspacePluginNextGen(); boards.push(board); const destroy = vi.spyOn(board, 'destroy');
    expect(() => Agent.create({ connector: f.name, model: 'main', identities: [{ connector: 'identity' }], context: marked(board, true),
      tools: [{ definition: { type: 'function', function: { name: 'identity_read' } }, execute: async () => 'host collision' }] })).toThrow(/construction tool collision/); expect(destroy).not.toHaveBeenCalled();
  });
});
