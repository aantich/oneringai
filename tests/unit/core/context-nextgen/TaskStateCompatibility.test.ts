import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentContextNextGen, BasePluginNextGen, FileContextStorage, PluginRegistry,
  TaskStatePluginNextGen,
} from '../../../../src/index.js';
import type {
  AgentContextNextGenConfig, PluginConfigs, ResolvedContextFeatures, TaskStatePluginConfig,
} from '../../../../src/index.js';

const contexts: AgentContextNextGen[] = [];
afterEach(() => {
  contexts.splice(0).forEach(context => context.destroy());
  PluginRegistry.remove('taskState');
});
const scope = { ownerId: 'host', namespace: 'compatibility' };
const customConfig: PluginConfigs = { taskState: { existingCustomOption: 'LEGACY_TASK_DATA' } };
function create(extra: Partial<AgentContextNextGenConfig> = {}): AgentContextNextGen {
  const context = AgentContextNextGen.create({
    model: 'gpt-4o-mini', agentId: 'compatibility',
    features: { workingMemory: false, inContextMemory: false, taskState: true },
    plugins: customConfig, ...extra,
  });
  contexts.push(context);
  return context;
}
function registerExisting() {
  const destroyed = vi.fn();
  class ExistingPlugin extends BasePluginNextGen {
    readonly name = 'legacy_task_view';
    value = 'LEGACY_TASK_DATA';
    getInstructions(): string { return 'Existing external task view'; }
    async getContent(): Promise<string> { return this.value; }
    getContents(): unknown { return { value: this.value }; }
    getState(): unknown { return { value: this.value }; }
    restoreState(saved: unknown): void { this.value = (saved as { value: string }).value; }
    destroy(): void { destroyed(); }
  }
  const factory = vi.fn(() => new ExistingPlugin());
  PluginRegistry.register('legacy_task_view', factory, { featureKey: 'taskState' });
  return { factory, destroyed, ExistingPlugin };
}

describe('Stage 04 public feature and plugin compatibility', () => {
  it('normalizes an unchanged legacy feature value without enabling task state', async () => {
    const features: ResolvedContextFeatures = {
      workingMemory: false, inContextMemory: false, persistentInstructions: false,
      userInfo: false, toolCatalog: false, sharedWorkspace: false,
      memory: false, memoryWrite: false,
    };
    const context = create({ features, plugins: undefined });
    expect(context.features.taskState).toBe(false);
    expect((await context.getSnapshot()).features.taskState).toBe(false);
    expect(context.hasPlugin('task_state')).toBe(false);
    expect((await context.prepare()).tools).toEqual([]);
  });

  it.each(['omitted', 'false'] as const)('keeps a registered custom factory disabled with taskState %s', async mode => {
    const { factory } = registerExisting();
    const context = create({ features: {
      workingMemory: false, inContextMemory: false, ...(mode === 'false' ? { taskState: false } : {}),
    } });
    expect(factory).not.toHaveBeenCalled();
    const prepared = await context.prepare();
    expect(JSON.stringify(prepared.input)).not.toContain('LEGACY_TASK_DATA');
    expect(context.hasPlugin('legacy_task_view')).toBe(false);
    expect(context.hasPlugin('task_state')).toBe(false);
  });

  it('passes existing record configuration to its external factory and prepares without built-in authority', async () => {
    const { factory, destroyed } = registerExisting();
    const context = create();
    expect(factory).toHaveBeenCalledWith(customConfig.taskState,
      expect.objectContaining({ features: expect.objectContaining({ taskState: true }) }));
    expect(context.hasPlugin('task_state')).toBe(false);
    const prepared = await context.prepare();
    expect(JSON.stringify(prepared.input)).toContain('LEGACY_TASK_DATA');
    expect(() => context.validateRequestBudget({ input: prepared.input })).not.toThrow();
    expect(prepared.tools).toEqual([]);
    context.destroy(); context.destroy();
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('roundtrips custom state through file storage without applying the built-in snapshot validator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'task-state-extension-'));
    const { ExistingPlugin } = registerExisting();
    const storage = new FileContextStorage({ agentId: 'compatibility', baseDirectory: directory });
    let first: AgentContextNextGen | undefined;
    let second: AgentContextNextGen | undefined;
    try {
      first = create({ storage });
      first.getPlugin<InstanceType<typeof ExistingPlugin>>('legacy_task_view')!.value = 'RESTORED_EXTERNAL_DATA';
      await first.save('custom-task');
      first.destroy();
      second = create({ storage });
      expect(await second.load('custom-task')).toBe(true);
      expect(second.getState().pluginStates.legacy_task_view).toEqual({ value: 'RESTORED_EXTERNAL_DATA' });
      const prepared = await second.prepare();
      expect(JSON.stringify(prepared.input)).toContain('RESTORED_EXTERNAL_DATA');
      expect(() => second!.validateRequestBudget({ input: prepared.input })).not.toThrow();
    } finally {
      first?.destroy(); second?.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('propagates an external factory failure instead of falling back to the built-in', () => {
    const factory = vi.fn(() => { throw new Error('External task factory failed'); });
    PluginRegistry.register('legacy_task_view', factory, { featureKey: 'taskState' });
    expect(() => create()).toThrow('External task factory failed');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}, { taskId: 'task' }, { scope }])('still rejects missing built-in scope/task configuration: %j', config => {
    expect(() => create({ plugins: config === undefined ? undefined : { taskState: config } })).toThrow();
  });

  it('restores built-in selection after registry removal and retains its protected task view', async () => {
    const { factory } = registerExisting();
    const external = create(); external.destroy();
    expect(PluginRegistry.remove('taskState')).toBe(true);
    const config: TaskStatePluginConfig = { scope, taskId: 'task' };
    const context = create({ userId: scope.ownerId, plugins: { taskState: config } });
    const plugin = context.getPlugin<TaskStatePluginNextGen>('task_state');
    expect(plugin).toBeInstanceOf(TaskStatePluginNextGen);
    plugin!.updateHost({ notes: [{ id: 'cap', category: 'constraint', text: 'HOST_CAP_40', source: { label: 'Host' } }] }, 0);
    const prepared = await context.prepare();
    expect(JSON.stringify(prepared.input)).toContain('HOST_CAP_40');
    expect(() => context.validateRequestBudget({ input: prepared.input })).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
