import { AgentContextNextGen, BasePluginNextGen, DEFAULT_FEATURES, PluginRegistry } from '@everworker/oneringai';
import type {
  AgentContextNextGenConfig, IContextSnapshot, KnownContextFeatures, KnownPluginConfigs,
  PluginConfigs, ResolvedContextFeatures, TaskStatePluginConfig,
} from '@everworker/oneringai';
import type {
  IContextSnapshot as TypeOnlySnapshot, KnownPluginConfigs as TypeOnlyKnownPluginConfigs,
  PluginConfigs as TypeOnlyPluginConfigs, ResolvedContextFeatures as TypeOnlyResolvedFeatures,
} from '@everworker/oneringai/types';

// Pin the consumer's old value. Spreading today's DEFAULT_FEATURES hides added
// required members and cannot establish backward compatibility.
const previousFeatures = {
  workingMemory: true, inContextMemory: true, persistentInstructions: false,
  userInfo: false, toolCatalog: false, sharedWorkspace: false,
  memory: false, memoryWrite: false,
};
export const legacyResolved: ResolvedContextFeatures = previousFeatures;
export const legacyTypeOnlyResolved: TypeOnlyResolvedFeatures = previousFeatures;
export const legacySnapshot: Pick<IContextSnapshot, 'features'> = { features: previousFeatures };
export const legacyTypeOnlySnapshot: Pick<TypeOnlySnapshot, 'features'> = { features: previousFeatures };
export const legacyOptionalFlag: boolean | undefined = legacyResolved.taskState;
export const normalizedFlag: boolean = DEFAULT_FEATURES.taskState;
export const newFlags: KnownContextFeatures = { taskState: true };

const previousPluginConfig = { taskState: { existingCustomOption: true } };
export const legacyPlugins: PluginConfigs = previousPluginConfig;
export const legacyKnownPlugins: KnownPluginConfigs = previousPluginConfig;
export const legacyTypeOnlyPlugins: TypeOnlyPluginConfigs = previousPluginConfig;
export const legacyTypeOnlyKnownPlugins: TypeOnlyKnownPluginConfigs = previousPluginConfig;
export const legacyContextConfig: AgentContextNextGenConfig = {
  model: 'gpt-4o-mini', features: { taskState: true }, plugins: previousPluginConfig,
};

export const builtinConfig: TaskStatePluginConfig = {
  scope: { ownerId: 'host', namespace: 'work' }, taskId: 'task', maxEntries: 100,
};
// Built-in consumers retain a strict explicit configuration type even though
// generic registry configuration must also accept external records.
// @ts-expect-error Built-in task state requires a host scope and task ID.
export const missingBuiltinScope: TaskStatePluginConfig = { maxEntries: 100 };

export function existingRegistryConsumer(): AgentContextNextGen {
  class ExistingTaskView extends BasePluginNextGen {
    readonly name = 'legacy_task_view';
    getInstructions(): string { return 'Existing custom plugin'; }
    async getContent(): Promise<string> { return 'Existing custom data'; }
    getContents(): unknown { return previousPluginConfig.taskState; }
  }
  PluginRegistry.register('legacy_task_view', () => new ExistingTaskView(), { featureKey: 'taskState' });
  try { return AgentContextNextGen.create(legacyContextConfig); }
  finally { PluginRegistry.remove('taskState'); }
}
