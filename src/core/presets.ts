import type { AgentConfig } from './Agent.js';
import { AgentContextNextGen } from './context-nextgen/AgentContextNextGen.js';
import type { AgentContextNextGenConfig, ResolvedContextFeatures } from './context-nextgen/types.js';
import { DEFAULT_FEATURES } from './context-nextgen/types.js';
import { PluginRegistry } from './context-nextgen/PluginRegistry.js';
import { StrategyRegistry } from './context-nextgen/strategies/StrategyRegistry.js';
import type { EvidencePluginConfig } from './context-nextgen/plugins/EvidencePluginNextGen.js';
import type { TaskStatePluginConfig } from './context-nextgen/plugins/TaskStatePluginNextGen.js';
import type { EvidenceDurability, EvidenceScope } from '../domain/interfaces/IEvidenceStorage.js';
import type { ModelCapabilities } from '../domain/interfaces/ITextProvider.js';
import type { AdvancedTextCapabilities } from '../domain/interfaces/IAdvancedInference.js';
import type { HelperRole } from './model-execution/types.js';
import { InvalidConfigError } from '../domain/errors/AIErrors.js';
import { validateScope } from './evidence/validation.js';
import { PRESET_REQUIRED_PLUGINS, type PresetPluginRequirements } from './context-nextgen/presetRequirements.js';

/** Explicit compositions of delivered managed-Agent features. Plain Agent remains unchanged. */
export type AgentPresetName = 'research' | 'workflow';

/** Existing Agent options; the factory supplies context.model from the main model. */
export type AgentPresetConfig = Omit<AgentConfig, 'context'> & {
  context?: Partial<AgentContextNextGenConfig>;
};

/** Metadata only: no credentials, instructions, tool arguments or stored content. */
export interface AgentCapabilityInspection {
  runtime: 'managed-agent';
  connector: string;
  model: string;
  registry: { known: boolean; vendorMatches: boolean | null; active: boolean | null };
  provider: ModelCapabilities;
  advanced?: AdvancedTextCapabilities;
  context: {
    features: ResolvedContextFeatures;
    plugins: string[];
    strategy: string;
    composition?: { config: Readonly<import('./context-nextgen/compaction/types.js').ContextCompactionStrategyConfig>;
      last?: import('./context-nextgen/compaction/types.js').ContextCompactionReport; activeNative: boolean };
    maxContextTokens: number;
    responseReserve: number;
    evidenceDurability?: EvidenceDurability;
  };
  loop: { enabled: boolean; hostCompletionCheck: boolean; maxIterations: number };
  helpers: Partial<Record<HelperRole, { connector: string; model: string; allowContextTransfer: boolean }>>;
  /** This is configuration inspection, not authentication, semantic quality or host-completion validation. */
  notices: string[];
}

function sameScope(a: EvidenceScope, b: EvidenceScope): boolean {
  return a.ownerId === b.ownerId && a.namespace === b.namespace && a.tenantId === b.tenantId;
}

function copyPluginConfig<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  // Accessors and opaque instances may rely on their original receiver/identity.
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) return value;
  return Object.defineProperties(Object.create(prototype), Object.getOwnPropertyDescriptors(value)) as T;
}

/**
 * Compose an ordinary AgentConfig without creating an Agent, accessing credentials,
 * doing storage IO or calling a model. Explicit values override preset defaults;
 * nested feature/plugin maps merge by key. Opaque host objects remain host-owned.
 * Evidence requires a host-selected scope, backend and matching userId. Workflow
 * also requires host-selected task state. No helper, permission or verifier is invented.
 */
export function createAgentPreset(name: AgentPresetName, config: AgentPresetConfig): AgentConfig {
  if (name !== 'research' && name !== 'workflow') throw new InvalidConfigError('Unknown agent preset. Choose research or workflow.');
  if (config.context instanceof AgentContextNextGen) throw new InvalidConfigError('Presets require context configuration, not a live context instance.');
  const input = config.context ?? {};
  for (const value of Object.values(input.features ?? {})) {
    if (value !== undefined && typeof value !== 'boolean') throw new InvalidConfigError('Preset feature values must be booleans.');
  }
  if (input.model !== undefined && input.model !== config.model) throw new InvalidConfigError('Preset context.model must match the main model.');
  if (input.userId !== undefined && input.userId !== config.userId) throw new InvalidConfigError('Preset context.userId must match the host userId.');
  const context: AgentContextNextGenConfig & PresetPluginRequirements = {
    // Undefined context values must not erase inherited host identity/configuration.
    ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    model: config.model,
    userId: config.userId,
    strategy: input.strategy ?? (name === 'research' ? 'observation-masking' : 'algorithmic'),
    features: { evidence: true, ...(name === 'workflow' ? { taskState: true } : {}), ...Object.fromEntries(Object.entries(input.features ?? {}).filter(([, value]) => value !== undefined)) },
    plugins: Object.fromEntries(Object.entries(input.plugins ?? {}).map(([key, value]) => [key, copyPluginConfig(value)])),
  };
  if (!context.compactionStrategy && !StrategyRegistry.has(context.strategy!)) throw new InvalidConfigError('Unknown preset context strategy. Register custom strategies explicitly.');
  // Configuration assembly must not instantiate a registered custom strategy.
  const strategy = context.compactionStrategy;
  const strategyName = strategy?.name ?? context.strategy!;
  for (const [feature, enabled] of Object.entries(context.features!)) {
    if (enabled && feature !== 'evidence' && !Object.hasOwn(DEFAULT_FEATURES, feature) && !PluginRegistry.has(feature)) {
      throw new InvalidConfigError(`Preset feature ${feature} is unavailable; register its plugin explicitly first.`);
    }
  }
  if ((strategy?.requiredPlugins?.includes('evidence') || strategyName === 'observation-masking' || strategyName === 'structured-summary') && !context.features?.evidence) throw new InvalidConfigError('Preset strategy requires enabled evidence.');
  if (strategyName === 'structured-summary' && !config.modelExecution?.helpers?.compactor) {
    throw new InvalidConfigError('Structured summaries require an explicitly configured compactor helper.');
  }
  let evidenceScope: EvidenceScope | undefined;
  let taskScope: EvidenceScope | undefined;
  if (context.features?.evidence) {
    const evidence = context.plugins?.evidence as EvidencePluginConfig | undefined;
    if (!evidence?.scope || !evidence.storage) throw new InvalidConfigError('Presets require explicit evidence scope and storage.');
    const scope = evidenceScope = validateScope(evidence.scope);
    if (config.userId !== scope.ownerId || !sameScope(scope, validateScope(evidence.storage.scope))) {
      throw new InvalidConfigError('Preset evidence scope, storage scope and host userId must match.');
    }
  }
  if (context.features?.taskState) {
    const task = context.plugins?.taskState as TaskStatePluginConfig | undefined;
    if (typeof task?.taskId !== 'string' || !task.taskId.trim() || !task.scope) throw new InvalidConfigError('Presets require explicit taskState taskId and scope.');
    const scope = taskScope = validateScope(task.scope);
    if (config.userId !== scope.ownerId) throw new InvalidConfigError('Preset task scope must match the host userId.');
    if (context.features.evidence && !sameScope(scope, evidenceScope!)) throw new InvalidConfigError('Preset task and evidence scopes must match.');
  }
  if (config.maxIterations !== undefined && (!Number.isSafeInteger(config.maxIterations) || config.maxIterations < 1)) {
    throw new InvalidConfigError('Preset maxIterations must be a positive integer.');
  }
  const evidence = context.plugins?.evidence as EvidencePluginConfig | undefined;
  const task = context.plugins?.taskState as TaskStatePluginConfig | undefined;
  context[PRESET_REQUIRED_PLUGINS] = Object.freeze({
    ...(context.features?.evidence ? { evidence: Object.freeze({ scope: evidenceScope!, storage: evidence!.storage! }) } : {}),
    ...(context.features?.taskState ? { taskState: Object.freeze({ scope: taskScope!, taskId: task!.taskId, association: task!.association }) } : {}),
  });
  return {
    ...config,
    maxIterations: config.maxIterations ?? (name === 'research' ? 12 : 8),
    loopPolicy: config.loopPolicy === undefined ? { maxRecoveryAttempts: 2 } : config.loopPolicy,
    context,
  };
}
