/**
 * Core module - main public API
 *
 * This is the primary entry point for the library.
 *
 * @example
 * ```typescript
 * import { Connector, Agent, Vendor } from '@everworker/oneringai';
 *
 * // Create a connector
 * Connector.create({
 *   name: 'openai',
 *   vendor: Vendor.OpenAI,
 *   auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! }
 * });
 *
 * // Create an agent
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4'
 * });
 *
 * // Run the agent
 * const response = await agent.run('Hello!');
 * ```
 */

export { Connector } from './Connector.js';
export { ScopedConnectorRegistry } from './ScopedConnectorRegistry.js';
export { StorageRegistry } from './StorageRegistry.js';
export type { StorageConfig, StorageContext } from './StorageRegistry.js';
export { ToolCatalogRegistry } from './ToolCatalogRegistry.js';
export type { ToolCategoryDefinition, CatalogToolEntry, ToolCategoryScope, ConnectorCategoryInfo, ToolRegistryEntry as CatalogRegistryEntry } from './ToolCatalogRegistry.js';
export { Agent } from './Agent.js';
export type { AgentConfig, AgentSessionConfig } from './Agent.js';
export { AgentRegistry } from './AgentRegistry.js';
export type {
  AgentStatus,
  AgentInfo,
  AgentFilter,
  AgentRegistryStats,
  AggregateMetrics,
  AgentTreeNode,
  AgentInspection,
  AgentRegistryEvents,
  AgentEventListener,
  IRegistrableAgent,
} from './AgentRegistry.js';
export { SuspendSignal } from './SuspendSignal.js';
export type { SuspendSignalOptions } from './SuspendSignal.js';

// Routine Runner
export { executeRoutine } from './routineRunner.js';
export type { ExecuteRoutineOptions, ValidationContext } from './routineRunner.js';

// Execution Recorder
export { createExecutionRecorder } from './createExecutionRecorder.js';
export type { ExecutionRecorderOptions, ExecutionRecorder } from './createExecutionRecorder.js';

// ============================================================================
// AgentContextNextGen - Clean, Simple Context Management
// ============================================================================
export {
  AgentContextNextGen,
  DEFAULT_FEATURES,
  DEFAULT_CONFIG,
  BasePluginNextGen,
  simpleTokenEstimator,
  WorkingMemoryPluginNextGen,
  InContextMemoryPluginNextGen,
  PersistentInstructionsPluginNextGen,
  UserInfoPluginNextGen,
  ToolCatalogPluginNextGen,
  // Compaction strategies
  DefaultCompactionStrategy,
  // Strategy Registry
  StrategyRegistry,
  // Plugin Registry
  PluginRegistry,
  // Unified store tools
  StoreToolsManager,
  isStoreHandler,
  SharedWorkspacePluginNextGen,
  DelegationPluginNextGen,
} from './context-nextgen/index.js';
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
  // Store handler types
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
  DefaultCompactionStrategyConfig,
  // Strategy Registry types
  StrategyInfo,
  StrategyRegistryEntry,
  // Plugin Registry types
  PluginFactory,
  PluginFactoryContext,
  PluginRegistryEntry,
  PluginRegisterOptions,
  PluginRegistryInfo,
  // Snapshot types
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from './context-nextgen/index.js';
export { formatPluginDisplayName } from './context-nextgen/index.js';

// Lifecycle hooks and direct call types (from BaseAgent)
export type {
  AgentLifecycleHooks,
  ToolExecutionHookContext,
  ToolExecutionResult,
  DirectCallOptions,
} from './BaseAgent.js';
export { Vendor, VENDORS, isVendor } from './Vendor.js';
export { createProvider, createProviderAsync, getVendorDefaultBaseURL } from './createProvider.js';

// Orchestrator
export { createOrchestrator } from './orchestrator/index.js';
export type { OrchestratorConfig, AgentTypeConfig } from './orchestrator/index.js';
export { buildOrchestrationTools, buildWorkspaceDelta } from './orchestrator/index.js';
export type { OrchestrationToolsContext } from './orchestrator/index.js';

// Centralized constants
export {
  TASK_DEFAULTS,
  CONTEXT_DEFAULTS,
  MEMORY_DEFAULTS,
  SESSION_DEFAULTS,
  AGENT_DEFAULTS,
  CIRCUIT_BREAKER_DEFAULTS,
  HISTORY_DEFAULTS,
  TOKEN_ESTIMATION,
  TOOL_RESULT_EVICTION_DEFAULTS,
  DEFAULT_TOOL_RETENTION,
  SAFETY_CAPS,
  TOOL_RETENTION_MULTIPLIERS,
  STRATEGY_THRESHOLDS,
  DOCUMENT_DEFAULTS,
} from './constants.js';
export type { StrategyName } from './constants.js';

// Global configuration
export { Config } from './Config.js';
export type { OneRingAIConfig, MCPConfiguration } from '../domain/entities/MCPConfig.js';

// MCP (Model Context Protocol)
export * from './mcp/index.js';

// Audio capabilities
export { TextToSpeech } from './TextToSpeech.js';
export type { TextToSpeechConfig } from './TextToSpeech.js';
export { SpeechToText } from './SpeechToText.js';
export type { SpeechToTextConfig } from './SpeechToText.js';

// Image capabilities
export { createImageProvider } from './createImageProvider.js';

// Tool management (unified - handles registration, execution, and circuit breakers)
export { ToolManager } from './ToolManager.js';
export type {
  ToolOptions,
  ToolCondition,
  ToolSelectionContext,
  ToolRegistration,
  ToolMetadata,
  ToolManagerStats,
  ToolManagerConfig,
  SerializedToolState,
  ToolManagerEvent,
  ToolSource,
} from './ToolManager.js';
// Note: CircuitBreakerConfig, CircuitState are re-exported from ToolManager but
// canonically exported from infrastructure/resilience/index.js

// Tool Execution Plugin System
export {
  ToolExecutionPipeline,
  LoggingPlugin,
  ResultNormalizerPlugin,
} from './tool-execution/index.js';
export type {
  PluginExecutionContext,
  BeforeExecuteResult,
  IToolExecutionPlugin,
  IToolExecutionPipeline,
  ToolExecutionPipelineOptions,
  LoggingPluginOptions,
  ResultNormalizerPluginOptions,
  NormalizedErrorResult,
} from './tool-execution/index.js';

// Tool permission management
export { ToolPermissionManager } from './permissions/ToolPermissionManager.js';
export type {
  PermissionScope,
  RiskLevel,
  ToolPermissionConfig,
  ApprovalCacheEntry,
  SerializedApprovalState,
  SerializedApprovalEntry,
  PermissionCheckResult,
  ApprovalDecision,
  AgentPermissionsConfig,
  PermissionCheckContext,
  PermissionManagerEvent,
} from './permissions/types.js';
export { APPROVAL_STATE_VERSION, DEFAULT_PERMISSION_CONFIG } from './permissions/types.js';

// Error Handling
export { ErrorHandler, globalErrorHandler } from './ErrorHandler.js';
export type {
  ErrorContext,
  ErrorHandlerConfig,
  ErrorHandlerEvents,
} from './ErrorHandler.js';
