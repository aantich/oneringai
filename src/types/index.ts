/**
 * @everworker/oneringai/types
 *
 * Lightweight subpath export: pure types, enums, constants, and model registries.
 * Zero Node.js / SDK dependencies — safe for browsers, Electron renderers,
 * Cloudflare Workers, Deno, and any non-Node environment.
 *
 * Usage:
 *   import type { AgentConfig, InContextEntry } from '@everworker/oneringai/types';
 *   import { Vendor, getModelInfo } from '@everworker/oneringai/types';
 */

// ============ Vendor (zero imports) ============
export { Vendor, VENDORS, isVendor } from '../core/Vendor.js';
export type { Vendor as VendorType } from '../core/Vendor.js';

// ============ Constants (zero imports) ============
export {
  TASK_DEFAULTS,
  CONTEXT_DEFAULTS,
  MEMORY_DEFAULTS,
  SESSION_DEFAULTS,
  AGENT_DEFAULTS,
  CIRCUIT_BREAKER_DEFAULTS,
} from '../core/constants.js';

// ============ Agent Config (from heavy Agent.ts — type-only, erased at compile) ============
export type { AgentConfig, AgentSessionConfig, RunOptions } from '../core/Agent.js';
export type { BaseAgentConfig, BaseSessionConfig, DirectCallOptions } from '../core/BaseAgent.js';

// ============ Context NextGen Types (type-only from heavy files) ============
export type {
  AgentContextNextGenConfig,
  ContextFeatures,
  KnownContextFeatures,
  ResolvedContextFeatures,
  KnownPluginConfigs,
  ContextEvents,
  SerializedContextState,
  IContextPluginNextGen,
  ITokenEstimator,
  ContextBudget,
  PreparedContext,
  OversizedInputResult,
  PluginConfigs,
  AuthIdentity,
  // Compaction strategy types
  ICompactionStrategy,
  CompactionContext,
  CompactionResult,
  ConsolidationResult,
  // Store handler types
  IStoreHandler,
  StoreEntrySchema,
  StoreGetResult,
  StoreSetResult,
  StoreDeleteResult,
  StoreListResult,
  StoreActionResult,
} from '../core/context-nextgen/types.js';

// Plugin Registry types
export type {
  PluginFactory,
  PluginFactoryContext,
  PluginRegistryEntry,
  PluginRegisterOptions,
  PluginRegistryInfo,
} from '../core/context-nextgen/PluginRegistry.js';

// Compaction Strategy types
export type { DefaultCompactionStrategyConfig } from '../core/context-nextgen/strategies/DefaultCompactionStrategy.js';
export type { StrategyInfo, StrategyRegistryEntry } from '../core/context-nextgen/strategies/StrategyRegistry.js';

// ============ Snapshot Types (for "Look Inside" UIs) ============
export type {
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from '../core/context-nextgen/snapshot.js';

// ============ Plugin Config Types (type-only from plugin files) ============
export type {
  InContextEntry,
  InContextPriority,
  InContextMemoryConfig,
  SerializedInContextMemoryState,
} from '../core/context-nextgen/plugins/InContextMemoryPluginNextGen.js';

export type {
  WorkingMemoryPluginConfig,
  SerializedWorkingMemoryState,
} from '../core/context-nextgen/plugins/WorkingMemoryPluginNextGen.js';

export type {
  PersistentInstructionsConfig,
  SerializedPersistentInstructionsState,
} from '../core/context-nextgen/plugins/PersistentInstructionsPluginNextGen.js';

export type {
  UserInfoPluginConfig,
  SerializedUserInfoState,
} from '../core/context-nextgen/plugins/UserInfoPluginNextGen.js';

export type {
  ToolCatalogPluginConfig,
} from '../core/context-nextgen/plugins/ToolCatalogPluginNextGen.js';

export type {
  SharedWorkspaceConfig,
  SharedWorkspaceEntry,
  WorkspaceLogEntry,
  SerializedSharedWorkspaceState,
} from '../core/context-nextgen/plugins/SharedWorkspacePluginNextGen.js';

// ============ Tool Catalog Types (type-only from heavy ToolCatalogRegistry) ============
export type {
  ToolCategoryScope,
  ToolCategoryDefinition,
  CatalogToolEntry,
  ConnectorCategoryInfo,
  ToolRegistryEntry as CatalogRegistryEntry,
} from '../core/ToolCatalogRegistry.js';

// ============ Domain Entities — ALL pure (zero Node/SDK deps) ============

// Content
export { ContentType } from '../domain/entities/Content.js';
export type {
  Content,
  InputTextContent,
  InputImageContent,
  OutputTextContent,
  ToolUseContent,
  ToolResultContent,
  ThinkingContent,
} from '../domain/entities/Content.js';

// Messages
export { MessageRole } from '../domain/entities/Message.js';
export type {
  Message,
  InputItem,
  OutputItem,
  CompactionItem,
  ReasoningItem,
} from '../domain/entities/Message.js';

// Tools
export { ToolCallState, defaultDescribeCall, getToolCallDescription } from '../domain/entities/Tool.js';
export type {
  Tool,
  FunctionToolDefinition,
  BuiltInTool,
  ToolFunction,
  ToolCall,
  ToolResult,
  ToolExecutionContext,
  JSONSchema,
  AsyncToolConfig,
  PendingAsyncTool,
  PendingAsyncToolStatus,
} from '../domain/entities/Tool.js';

// Response
export type { LLMResponse, AgentResponse } from '../domain/entities/Response.js';

// Connector config types
export type {
  ConnectorConfig,
  ConnectorAuth,
  OAuthConnectorAuth,
  APIKeyConnectorAuth,
  JWTConnectorAuth,
} from '../domain/entities/Connector.js';

// Task & Plan
export type {
  Task,
  TaskInput,
  TaskStatus,
  TaskCondition,
  TaskExecution,
  TaskValidation,
  TaskValidationResult,
  ExternalDependency,
  Plan,
  PlanInput,
  PlanStatus,
  PlanConcurrency,
  TaskControlFlow,
  TaskMapFlow,
  TaskFoldFlow,
  TaskUntilFlow,
  TaskSourceRef,
  ControlFlowSource,
  SubRoutineSpec,
} from '../domain/entities/Task.js';

export {
  createTask,
  createPlan,
  detectDependencyCycle,
  canTaskExecute,
  getNextExecutableTasks,
  evaluateCondition,
  updateTaskStatus,
  isTaskBlocked,
  getTaskDependencies,
  resolveDependencies,
  isTerminalStatus,
  TERMINAL_TASK_STATUSES,
} from '../domain/entities/Task.js';

// Memory
export type {
  MemoryEntry,
  MemoryEntryInput,
  MemoryIndex,
  MemoryIndexEntry,
  MemoryScope,
  MemoryPriority,
  TaskAwareScope,
  SimpleScope,
  TaskStatusForMemory,
  WorkingMemoryConfig,
} from '../domain/entities/Memory.js';

export {
  DEFAULT_MEMORY_CONFIG,
  forTasks,
  forPlan,
  scopeEquals,
  scopeMatches,
  isSimpleScope,
  isTaskAwareScope,
  isTerminalMemoryStatus,
  calculateEntrySize,
  MEMORY_PRIORITY_VALUES,
} from '../domain/entities/Memory.js';

// Agent State
export type {
  AgentState,
  AgentStatus,
  AgentConfig as TaskAgentStateConfig,
  ConversationMessage,
  AgentMetrics,
} from '../domain/entities/AgentState.js';

// Routines
export type {
  RoutineDefinition,
  RoutineDefinitionInput,
  RoutineSummary,
  RoutineExecutionStatus,
  RoutineExecution,
  RoutineParameter,
} from '../domain/entities/Routine.js';

export {
  createRoutineDefinition,
  createRoutineExecution,
  getRoutineProgress,
} from '../domain/entities/Routine.js';

// Routine Execution Records
export type {
  RoutineStepType,
  RoutineExecutionStep,
  RoutineTaskResult,
  RoutineTaskSnapshot,
  RoutineExecutionRecord,
} from '../domain/entities/RoutineExecutionRecord.js';

export {
  createRoutineExecutionRecord,
  createTaskSnapshots,
} from '../domain/entities/RoutineExecutionRecord.js';

// Custom Tool Definition
export type {
  CustomToolDefinition,
  CustomToolSummary,
  CustomToolTestCase,
  CustomToolMetadata,
} from '../domain/entities/CustomToolDefinition.js';

// ============ Model Registries (pure data, zero Node deps) ============

// LLM Models
export type { ILLMDescription } from '../domain/entities/Model.js';
export {
  LLM_MODELS,
  MODEL_REGISTRY,
  getModelInfo,
  getModelsByVendor,
  getActiveModels,
  calculateCost,
} from '../domain/entities/Model.js';

// TTS Models
export type { ITTSModelDescription, TTSModelCapabilities } from '../domain/entities/TTSModel.js';
export type { IVoiceInfo } from '../domain/entities/SharedVoices.js';
export {
  TTS_MODELS,
  TTS_MODEL_REGISTRY,
  getTTSModelInfo,
  getTTSModelsByVendor,
  getActiveTTSModels,
  getTTSModelsWithFeature,
  calculateTTSCost,
} from '../domain/entities/TTSModel.js';

// STT Models
export type { ISTTModelDescription, STTModelCapabilities } from '../domain/entities/STTModel.js';
export {
  STT_MODELS,
  STT_MODEL_REGISTRY,
  getSTTModelInfo,
  getSTTModelsByVendor,
  getActiveSTTModels,
  getSTTModelsWithFeature,
  calculateSTTCost,
} from '../domain/entities/STTModel.js';

// Image Models
export type { IImageModelDescription, ImageModelCapabilities, ImageModelPricing } from '../domain/entities/ImageModel.js';
export {
  IMAGE_MODELS,
  IMAGE_MODEL_REGISTRY,
  getImageModelInfo,
  getImageModelsByVendor,
  getActiveImageModels,
  getImageModelsWithFeature,
  calculateImageCost,
} from '../domain/entities/ImageModel.js';

// Video Models
export type { IVideoModelDescription, VideoModelCapabilities, VideoModelPricing } from '../domain/entities/VideoModel.js';
export {
  VIDEO_MODELS,
  VIDEO_MODEL_REGISTRY,
  getVideoModelInfo,
  getVideoModelsByVendor,
  getActiveVideoModels,
  getVideoModelsWithFeature,
  getVideoModelsWithAudio,
  calculateVideoCost,
} from '../domain/entities/VideoModel.js';

// Embedding Models
export type { IEmbeddingModelDescription, EmbeddingModelCapabilities, EmbeddingModelPricing } from '../domain/entities/EmbeddingModel.js';
export {
  EMBEDDING_MODELS,
  EMBEDDING_MODEL_REGISTRY,
  getEmbeddingModelInfo,
  getEmbeddingModelsByVendor,
  getActiveEmbeddingModels,
  getEmbeddingModelsWithFeature,
  calculateEmbeddingCost,
} from '../domain/entities/EmbeddingModel.js';

// ============ Services (zero imports) ============
export {
  Services,
  SERVICE_DEFINITIONS,
  SERVICE_URL_PATTERNS,
  SERVICE_INFO,
  detectServiceFromURL,
  getServiceInfo,
  getServiceDefinition,
  getServicesByCategory,
  getAllServiceIds,
  isKnownService,
} from '../domain/entities/Services.js';
export type { ServiceType, ServiceInfo, ServiceDefinition, ServiceCategory } from '../domain/entities/Services.js';

// ============ Streaming (pure) ============
export { StreamEventType } from '../domain/entities/StreamEvent.js';
export type {
  StreamEvent,
  ResponseCreatedEvent,
  ResponseInProgressEvent,
  OutputTextDeltaEvent,
  OutputTextDoneEvent,
  ReasoningDeltaEvent,
  ReasoningDoneEvent,
  ToolCallStartEvent,
  ToolCallArgumentsDeltaEvent,
  ToolCallArgumentsDoneEvent,
  ToolExecutionStartEvent,
  ToolExecutionDoneEvent,
  IterationCompleteEvent,
  ResponseCompleteEvent,
  ErrorEvent,
  AudioChunkReadyEvent,
  AudioChunkErrorEvent,
  AudioStreamCompleteEvent,
} from '../domain/entities/StreamEvent.js';
export {
  isStreamEvent,
  isOutputTextDelta,
  isReasoningDelta,
  isReasoningDone,
  isToolCallStart,
  isToolCallArgumentsDelta,
  isToolCallArgumentsDone,
  isResponseComplete,
  isErrorEvent,
  isAudioChunkReady,
  isAudioChunkError,
  isAudioStreamComplete,
} from '../domain/entities/StreamEvent.js';

// ============ Shared Types (pure) ============
export type {
  AspectRatio,
  QualityLevel,
  AudioFormat,
  OutputFormat,
  ISourceLinks,
  VendorOptionSchema,
  IBaseModelDescription,
} from '../domain/types/SharedTypes.js';

// ============ Errors (zero imports) ============
export {
  AIError,
  ProviderNotFoundError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolNotFoundError,
  ModelNotSupportedError,
  InvalidConfigError,
  InvalidToolArgumentsError,
  ProviderError,
  DependencyCycleError,
  TaskTimeoutError,
  TaskValidationError,
  ParallelTasksError,
  ContextOverflowError,
} from '../domain/errors/AIErrors.js';
export type { TaskFailure, ContextOverflowBudget } from '../domain/errors/AIErrors.js';

// ============ Vendor Templates (type-only from heavy files) ============
export type {
  VendorTemplate,
  AuthTemplate,
  AuthTemplateField,
  VendorRegistryEntry,
  TemplateCredentials,
  CreateConnectorOptions,
} from '../connectors/vendors/types.js';

export type { VendorInfo } from '../connectors/vendors/helpers.js';
export type { VendorLogo, SimpleIcon } from '../connectors/vendors/logos.js';

// ============ Storage Interfaces (pure contracts) ============
export type {
  IContextStorage,
  StoredContextSession,
  ContextSessionSummary,
  ContextSessionMetadata,
  ContextStorageListOptions,
} from '../domain/interfaces/IContextStorage.js';
export { CONTEXT_SESSION_FORMAT_VERSION } from '../domain/interfaces/IContextStorage.js';

export type {
  IAgentDefinitionStorage,
  StoredAgentDefinition,
  StoredAgentType,
  AgentDefinitionMetadata,
  AgentDefinitionSummary,
  AgentDefinitionListOptions,
} from '../domain/interfaces/IAgentDefinitionStorage.js';
export { AGENT_DEFINITION_FORMAT_VERSION } from '../domain/interfaces/IAgentDefinitionStorage.js';

export type {
  IMediaStorage,
  MediaStorageMetadata,
  MediaStorageResult,
  MediaStorageEntry,
  MediaStorageListOptions,
} from '../domain/interfaces/IMediaStorage.js';

export type {
  ICorrelationStorage,
  SessionRef,
  CorrelationSummary,
  CorrelationListOptions,
} from '../domain/interfaces/ICorrelationStorage.js';

export type { IMemoryStorage } from '../domain/interfaces/IMemoryStorage.js';
export type { IPlanStorage } from '../domain/interfaces/IPlanStorage.js';
export type { IAgentStateStorage } from '../domain/interfaces/IAgentStateStorage.js';

export type {
  ICustomToolStorage,
  CustomToolListOptions,
} from '../domain/interfaces/ICustomToolStorage.js';
export { CUSTOM_TOOL_DEFINITION_VERSION } from '../domain/entities/CustomToolDefinition.js';

export type { IPersistentInstructionsStorage } from '../domain/interfaces/IPersistentInstructionsStorage.js';
export type { InstructionEntry } from '../core/context-nextgen/plugins/PersistentInstructionsPluginNextGen.js';

export type { IUserInfoStorage, UserInfoEntry } from '../domain/interfaces/IUserInfoStorage.js';

export type { IRoutineDefinitionStorage } from '../domain/interfaces/IRoutineDefinitionStorage.js';
export type { IRoutineExecutionStorage } from '../domain/interfaces/IRoutineExecutionStorage.js';
export type { StorageUserContext, StorageUserContextInput } from '../domain/interfaces/StorageContext.js';
export { resolveStorageUserContext } from '../domain/interfaces/StorageContext.js';
export type { IUserPermissionRulesStorage } from '../domain/interfaces/IUserPermissionRulesStorage.js';

export type {
  IHistoryJournal,
  HistoryEntry,
  HistoryEntryType,
  HistoryReadOptions,
} from '../domain/interfaces/IHistoryJournal.js';

// ============ Event & Hook Types (type-only) ============
export type {
  AgentEvents,
  AgentEventName,
  ExecutionConfig,
  AgenticLoopEvents,
  AgenticLoopEventName,
  ExecutionStartEvent,
  ExecutionCompleteEvent,
} from '../capabilities/agents/types/EventTypes.js';

export type {
  HookConfig,
  HookName,
  Hook,
  ModifyingHook,
  BeforeToolContext,
  AfterToolContext,
  ApproveToolContext,
  ToolModification,
  ApprovalResult,
} from '../capabilities/agents/types/HookTypes.js';

export type {
  HistoryMode,
  ExecutionMetrics,
  AuditEntry,
} from '../capabilities/agents/ExecutionContext.js';

// ============ Permission Types (type-only) ============
export type {
  PermissionScope,
  RiskLevel,
  ToolPermissionConfig,
  ApprovalCacheEntry,
  SerializedApprovalState,
  SerializedApprovalEntry,
  PermissionCheckResult,
  ApprovalDecision,
  ApprovalRequestContext,
  AgentPermissionsConfig,
  AgentPolicyConfig,
  PermissionCheckContext,
  PermissionManagerEvent,
  IPermissionPolicy,
  PolicyContext,
  PolicyDecision,
  PolicyCheckResult,
  PolicyChainConfig,
  PermissionAuditEntry,
  UserPermissionRule,
} from '../core/permissions/types.js';
export { APPROVAL_STATE_VERSION, DEFAULT_PERMISSION_CONFIG, DEFAULT_ALLOWLIST } from '../core/permissions/types.js';
export type { DefaultAllowlistedTool } from '../core/permissions/types.js';

// ============ Tool Context (pure interface) ============
export type { ToolContext as TaskToolContext, WorkingMemoryAccess } from '../domain/interfaces/IToolContext.js';

// ============ Connector Resilience Defaults (duplicated to avoid importing heavy Connector.ts) ============
export const DEFAULT_CONNECTOR_TIMEOUT = 30000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

// ============ Provider Interfaces (pure contracts) ============
export type { IProvider, ProviderCapabilities } from '../domain/interfaces/IProvider.js';
export type { ITextProvider, TextGenerateOptions, ModelCapabilities } from '../domain/interfaces/ITextProvider.js';
export type { IToolExecutor } from '../domain/interfaces/IToolExecutor.js';
export type { IDisposable, IAsyncDisposable } from '../domain/interfaces/IDisposable.js';
export type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
export type { IConnectorAccessPolicy, ConnectorAccessContext } from '../domain/interfaces/IConnectorAccessPolicy.js';
export type { IEmbeddingProvider, EmbeddingOptions, EmbeddingResponse } from '../domain/interfaces/IEmbeddingProvider.js';

// Audio Interfaces
export type {
  ITextToSpeechProvider,
  IStreamingTextToSpeechProvider,
  ISpeechToTextProvider,
  TTSOptions,
  TTSResponse,
  TTSStreamChunk,
  STTOptions,
  STTResponse,
  STTOutputFormat,
  WordTimestamp,
  SegmentTimestamp,
} from '../domain/interfaces/IAudioProvider.js';

// Image Interfaces
export type {
  IImageProvider,
  ImageGenerateOptions,
  ImageEditOptions,
  ImageVariationOptions,
  ImageResponse,
} from '../domain/interfaces/IImageProvider.js';

// Video Interfaces
export type {
  IVideoProvider,
  VideoGenerateOptions,
  VideoExtendOptions,
  VideoRemixOptions,
  VideoEditOptions,
  CreateCharacterOptions,
  CharacterRef,
  VideoResponse,
  VideoJob,
  VideoStatus,
} from '../domain/interfaces/IVideoProvider.js';

// ============ MCP Types (type-only) ============
export type {
  IMCPClient,
  MCPClientConnectionState,
  MCPTool,
  MCPToolResult,
  MCPResource,
  MCPResourceContent,
  MCPPrompt,
  MCPPromptResult,
  MCPServerCapabilities,
  MCPClientState,
  MCPServerConfig,
  MCPConfiguration,
  MCPTransportType,
  StdioTransportConfig,
  HTTPTransportConfig,
  TransportConfig,
} from '../core/mcp/index.js';

// ============ Orchestrator Types (type-only) ============
export type {
  OrchestratorConfig,
  AgentTypeConfig,
  OrchestrationToolsContext,
} from '../core/orchestrator/index.js';

// Agent Registry types
export type {
  AgentStatus as RegistryAgentStatus,
  AgentInfo,
  AgentInspection,
  AgentFilter,
  AgentRegistryStats,
  AgentRegistryEvents,
  AgentEventListener,
} from '../core/AgentRegistry.js';

// ============ Scheduling Types (type-only) ============
export type { IScheduler, ScheduleHandle, ScheduleSpec } from '../domain/interfaces/IScheduler.js';

// ============ Tool Manager Types (type-only) ============
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
} from '../core/ToolManager.js';

// ============ Tool Execution Plugin Types (type-only) ============
export type {
  PluginExecutionContext,
  BeforeExecuteResult,
  IToolExecutionPlugin,
  IToolExecutionPipeline,
  ToolExecutionPipelineOptions,
} from '../core/tool-execution/types.js';

export type { LoggingPluginOptions } from '../core/tool-execution/plugins/LoggingPlugin.js';

// ============ Context Legacy Types (type-only) ============
export type {
  IContextComponent,
  ContextManagerConfig,
  IContextCompactor,
  IContextStrategy,
  TokenContentType,
} from '../core/context/types.js';

// ============ History Types (type-only) ============
export type {
  IHistoryManager,
  IHistoryStorage,
  HistoryMessage,
  IHistoryManagerConfig,
  HistoryManagerEvents,
  SerializedHistoryState,
} from '../domain/interfaces/IHistoryManager.js';
