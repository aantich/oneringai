/**
 * AgentContextNextGen - Clean, Simple Context Management
 *
 * A complete rewrite of context management with:
 * - Single system message with all context components
 * - Clear separation: system | conversation | current input
 * - Compaction happens ONCE, right before LLM call
 * - Each plugin manages its own token tracking
 * - Tool pairs always removed together
 */

// Main context manager
export { AgentContextNextGen } from './AgentContextNextGen.js';

// Types
export type {
  IContextPluginNextGen,
  ITokenEstimator,
  AuthIdentity,
  AgentContextNextGenConfig,
  ContextFeatures,
  KnownContextFeatures,
  ResolvedContextFeatures,
  KnownPluginConfigs,
  ContextBudget,
  PreparedContext,
  OversizedInputResult,
  IContextStorage,
  SerializedContextState,
  ContextEvents,
  PluginConfigs,
  // Store handler types (unified CRUD for plugins)
  IStoreHandler,
  StoreEntrySchema,
  StoreGetResult,
  StoreSetResult,
  StoreDeleteResult,
  StoreListResult,
  StoreActionResult,
  // Compaction strategy types
  ICompactionStrategy,
  CompactionContext,
  CompactionResult,
  ConsolidationResult,
} from './types.js';

export {
  DEFAULT_FEATURES,
  DEFAULT_CONFIG,
  isStoreHandler,
} from './types.js';

// Store tools manager
export { StoreToolsManager } from './store-tools.js';

// Snapshot types (for "Look Inside" UIs)
export { formatPluginDisplayName } from './snapshot.js';
export type {
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from './snapshot.js';

// Base plugin class
export { BasePluginNextGen, simpleTokenEstimator } from './BasePluginNextGen.js';

// Plugins
export {
  WorkingMemoryPluginNextGen,
  InContextMemoryPluginNextGen,
  PersistentInstructionsPluginNextGen,
  UserInfoPluginNextGen,
  ToolCatalogPluginNextGen,
  SharedWorkspacePluginNextGen,
  DelegationPluginNextGen,
} from './plugins/index.js';

export type {
  WorkingMemoryPluginConfig,
  SerializedWorkingMemoryState,
  EvictionStrategy,
  InContextMemoryConfig,
  InContextEntry,
  InContextPriority,
  SerializedInContextMemoryState,
  PersistentInstructionsConfig,
  SerializedPersistentInstructionsState,
  InstructionEntry,
  UserInfoPluginConfig,
  SerializedUserInfoState,
  ToolCatalogPluginConfig,
  SharedWorkspaceConfig,
  SharedWorkspaceEntry,
  WorkspaceLogEntry,
  SerializedSharedWorkspaceState,
  DelegationPluginConfig,
  DelegationTarget,
  DelegationTargetResolver,
} from './plugins/index.js';

// Compaction strategies
export {
  DefaultCompactionStrategy,
  type DefaultCompactionStrategyConfig,
  AlgorithmicCompactionStrategy,
  type AlgorithmicCompactionStrategyConfig,
  // Strategy Registry
  StrategyRegistry,
  type StrategyClass,
  type StrategyInfo,
  type StrategyRegistryEntry,
  type StrategyRegisterOptions,
} from './strategies/index.js';

// Plugin Registry
export {
  PluginRegistry,
  type PluginFactory,
  type PluginFactoryContext,
  type PluginRegistryEntry,
  type PluginRegisterOptions,
  type PluginRegistryInfo,
} from './PluginRegistry.js';
