/**
 * @everworker/oneringai - Unified AI agent library
 *
 * Connector-First Architecture: Simple, DRY, Powerful
 *
 * @example
 * ```typescript
 * import { Connector, Agent, Vendor } from '@everworker/oneringai';
 *
 * // Create connector (can have multiple per vendor!)
 * Connector.create({
 *   name: 'openai-main',
 *   vendor: Vendor.OpenAI,
 *   auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! }
 * });
 *
 * // Create agent from connector
 * const agent = Agent.create({
 *   connector: 'openai-main',
 *   model: 'gpt-4',
 *   tools: [myTool]
 * });
 *
 * // Run the agent
 * const response = await agent.run('Hello!');
 * ```
 */

// ============ Core API (Primary) ============
export { Connector, ScopedConnectorRegistry, StorageRegistry, ToolCatalogRegistry, Agent, AgentRegistry, Vendor, VENDORS, isVendor, createProvider, getVendorDefaultBaseURL, SuspendSignal, createOrchestrator, buildOrchestrationTools, buildWorkspaceDelta } from './core/index.js';
export type { StorageConfig, StorageContext, ToolCategoryDefinition, CatalogToolEntry, ToolCategoryScope, ConnectorCategoryInfo, CatalogRegistryEntry, SuspendSignalOptions, OrchestratorConfig, AgentTypeConfig, OrchestrationToolsContext, AgentInfo, AgentInspection, AgentFilter, AgentRegistryStats, AgentRegistryEvents, AgentEventListener } from './core/index.js';
export type { AgentStatus as RegistryAgentStatus } from './core/index.js';
export type { AgentConfig, AgentSessionConfig } from './core/index.js';

// AgentContextNextGen - Clean, Simple Context Management
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
  SharedWorkspacePluginNextGen,
  // Compaction strategies
  DefaultCompactionStrategy,
  // Strategy Registry
  StrategyRegistry,
  // Plugin Registry
  PluginRegistry,
  // Unified store tools
  StoreToolsManager,
  isStoreHandler,
} from './core/index.js';
export type {
  AuthIdentity,
  AgentContextNextGenConfig,
  ContextFeatures,
  KnownContextFeatures,
  ResolvedContextFeatures,
  KnownPluginConfigs,
  ContextEvents,
  SerializedContextState,
  DirectCallOptions,
  IContextPluginNextGen,
  ITokenEstimator,
  ContextBudget,
  PreparedContext,
  OversizedInputResult,
  PluginConfigs,
  PluginFactory,
  PluginFactoryContext,
  PluginRegistryEntry,
  PluginRegisterOptions,
  PluginRegistryInfo,
  // IContextStorage exported from domain/interfaces below
  WorkingMemoryPluginConfig,
  SerializedWorkingMemoryState,
  EvictionStrategy as NextGenEvictionStrategy,
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
  // Snapshot types (for "Look Inside" UIs)
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from './core/index.js';
export { formatPluginDisplayName } from './core/index.js';

// Audio Capabilities
export { TextToSpeech, SpeechToText } from './core/index.js';
export type { TextToSpeechConfig, SpeechToTextConfig } from './core/index.js';

// Image Capabilities
export { ImageGeneration } from './capabilities/images/index.js';
export type { ImageGenerationCreateOptions, SimpleGenerateOptions } from './capabilities/images/index.js';
export { createImageProvider } from './core/index.js';

// Video Capabilities
export { VideoGeneration } from './capabilities/video/index.js';
export type {
  VideoGenerationCreateOptions,
  SimpleVideoGenerateOptions,
} from './capabilities/video/index.js';
export { createVideoProvider } from './core/createVideoProvider.js';

// Speech Capabilities (Voice pseudo-streaming)
export { VoiceStream, SentenceChunkingStrategy, AudioPlaybackQueue } from './capabilities/speech/index.js';
export type {
  IChunkingStrategy,
  ChunkingOptions,
  VoiceStreamConfig,
  VoiceStreamEvents,
  AudioChunkPlaybackCallback,
} from './capabilities/speech/index.js';

// Voice Calling Capabilities (Twilio, telephony)
export { VoiceBridge, VoiceSession, TextPipeline, RealtimePipeline, EnergyVAD, TwilioAdapter } from './capabilities/voice/index.js';
export { mulawToPcm, pcmToMulaw, resamplePcm, twilioToStt, sttToTwilio } from './capabilities/voice/index.js';
export type {
  AudioFrame,
  AudioEncoding,
  VADEvent,
  IVoiceActivityDetector,
  EnergyVADConfig,
  CallDirection,
  SessionState,
  VoiceSessionInfo,
  CallEndReason,
  CallSummary,
  VoiceBridgeConfig,
  TextPipelineConfig,
  RealtimePipelineConfig,
  PipelineConfig,
  TranscriptMessage,
  VoiceHooks,
  IVoicePipeline,
  VoicePipelineEvents,
  ITelephonyAdapter,
  TelephonyAdapterEvents,
  IncomingCallInfo,
  OutboundCallConfig,
  TwilioAdapterConfig,
} from './capabilities/voice/index.js';
export type { VoiceBridgeEvents } from './capabilities/voice/index.js';
export type { VoiceSessionEvents } from './capabilities/voice/index.js';

// Search Capabilities (NEW - Connector-based web search)
export { SearchProvider } from './capabilities/search/index.js';
export type {
  ISearchProvider,
  SearchResult,
  SearchOptions,
  SearchResponse,
  SearchProviderConfig,
} from './capabilities/search/index.js';
export { SerperProvider, BraveProvider, TavilyProvider, RapidAPIProvider } from './capabilities/search/index.js';

// Scrape Capabilities (Connector-based web scraping)
export { ScrapeProvider, registerScrapeProvider, getRegisteredScrapeProviders } from './capabilities/scrape/index.js';
export type {
  IScrapeProvider,
  ScrapeResult,
  ScrapeOptions,
  ScrapeResponse,
  ScrapeFeature,
  ScrapeProviderConfig,
  ScrapeProviderFallbackConfig,
} from './capabilities/scrape/index.js';

// Document Reader Capability
export { DocumentReader, FormatDetector, mergeTextPieces } from './capabilities/documents/index.js';
export type {
  DocumentFormat,
  DocumentFamily,
  DocumentPiece,
  DocumentTextPiece,
  DocumentImagePiece,
  PieceMetadata,
  DocumentResult,
  DocumentMetadata,
  DocumentSource,
  DocumentReadOptions,
  DocumentReaderConfig,
  ImageFilterOptions,
  IDocumentTransformer,
  IFormatHandler,
  FormatDetectionResult,
  DocumentToContentOptions,
} from './capabilities/documents/index.js';
export { documentToContent, readDocumentAsContent } from './utils/documentContentBridge.js';

// Shared Capability Utilities
export {
  buildQueryString,
  toConnectorOptions,
  buildEndpointWithQuery,
  resolveConnector,
  // Service type auto-detection (for external API-dependent tools)
  findConnectorByServiceTypes,
  listConnectorsByServiceTypes,
  type BaseProviderConfig,
  type BaseProviderResponse,
  type ICapabilityProvider,
  type ExtendedFetchOptions,
} from './capabilities/shared/index.js';

// Tool Management (Unified - handles registration, execution, and circuit breakers)
export { ToolManager } from './core/index.js';
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
} from './core/index.js';
// Note: CircuitBreakerConfig, CircuitState are exported from infrastructure/resilience

// Tool Execution Plugin System
export {
  ToolExecutionPipeline,
  LoggingPlugin,
} from './core/index.js';
export type {
  PluginExecutionContext,
  BeforeExecuteResult,
  IToolExecutionPlugin,
  IToolExecutionPipeline,
  ToolExecutionPipelineOptions,
  LoggingPluginOptions,
} from './core/index.js';

// Tool Permissions
export { ToolPermissionManager } from './core/permissions/index.js';
export { PermissionPolicyManager } from './core/permissions/index.js';
export type { PermissionPolicyManagerConfig, PolicyManagerEvents } from './core/permissions/index.js';
export { UserPermissionRulesEngine } from './core/permissions/index.js';
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
} from './core/permissions/index.js';
export { APPROVAL_STATE_VERSION, DEFAULT_PERMISSION_CONFIG, DEFAULT_ALLOWLIST } from './core/permissions/index.js';
export type { DefaultAllowlistedTool } from './core/permissions/index.js';
export { FileUserPermissionRulesStorage } from './infrastructure/storage/FileUserPermissionRulesStorage.js';
export type { IUserPermissionRulesStorage } from './domain/interfaces/IUserPermissionRulesStorage.js';

// Context Storage (Session Persistence via AgentContext)
export type {
  IContextStorage,
  StoredContextSession,
  ContextSessionSummary,
  ContextSessionMetadata,
  ContextStorageListOptions,
} from './domain/interfaces/IContextStorage.js';
export { CONTEXT_SESSION_FORMAT_VERSION } from './domain/interfaces/IContextStorage.js';

// History Journal (Append-Only Conversation Log)
export type {
  IHistoryJournal,
  HistoryEntry,
  HistoryEntryType,
  HistoryReadOptions,
} from './domain/interfaces/IHistoryJournal.js';
export { FileHistoryJournal } from './infrastructure/storage/index.js';

// Agent Definition Storage (Agent Configuration Persistence)
export type {
  IAgentDefinitionStorage,
  StoredAgentDefinition,
  StoredAgentType,
  AgentDefinitionMetadata,
  AgentDefinitionSummary,
  AgentDefinitionListOptions,
} from './domain/interfaces/IAgentDefinitionStorage.js';
export { AGENT_DEFINITION_FORMAT_VERSION } from './domain/interfaces/IAgentDefinitionStorage.js';

// Media Storage (Multimedia Tool Outputs)
export type {
  IMediaStorage,
  MediaStorageMetadata,
  MediaStorageResult,
  MediaStorageEntry,
  MediaStorageListOptions,
} from './domain/interfaces/IMediaStorage.js';

// Correlation Storage (Suspend/Resume Session Mapping)
export type {
  ICorrelationStorage,
  SessionRef,
  CorrelationSummary,
  CorrelationListOptions,
} from './domain/interfaces/ICorrelationStorage.js';

// ============ Error Handling ============
export { ErrorHandler, globalErrorHandler } from './core/index.js';
export type {
  ErrorContext,
  ErrorHandlerConfig,
  ErrorHandlerEvents,
} from './core/index.js';

// ============ TaskAgent Utilities (TaskAgent class removed) ============
export {
  WorkingMemory,
  ExternalDependencyHandler,
  CheckpointManager,
  PlanningAgent,
  generateSimplePlan,
  DEFAULT_CHECKPOINT_STRATEGY,
} from './capabilities/taskAgent/index.js';
export type {
  WorkingMemoryEvents,
  EvictionStrategy,
  ExternalDependencyEvents,
  CheckpointStrategy,
  PlanningAgentConfig,
  GeneratedPlan,
} from './capabilities/taskAgent/index.js';

// ============ Research Types (ResearchAgent class removed) ============
export type {
  IResearchSource,
  SourceResult,
  SearchResponse as ResearchSearchResponse,
  FetchedContent,
  SearchOptions as ResearchSearchOptions,
  FetchOptions as ResearchFetchOptions,
  SourceCapabilities,
  ResearchFinding,
  ResearchPlan,
  ResearchQuery,
  ResearchResult,
  ResearchProgress,
} from './capabilities/researchAgent/index.js';

// ============ Context Management (Legacy types for strategy compatibility) ============
// Note: ContextManager class deleted - AgentContext is THE ONLY context manager
// ContextBudget, PreparedContext, ITokenEstimator exported above from NextGen
export type {
  IContextComponent,
  ContextManagerConfig,
  IContextCompactor,
  IContextStrategy,
  TokenContentType,
} from './core/context/types.js';
export { DEFAULT_CONTEXT_CONFIG } from './core/context/types.js';

// Context Infrastructure
export {
  TruncateCompactor,
  SummarizeCompactor,
  MemoryEvictionCompactor,
  ApproximateTokenEstimator,
  createEstimator,
} from './infrastructure/context/index.js';

// ============ Conversation History Management ============
// Note: ConversationHistoryManager class deleted - AgentContext manages history directly
export type {
  IHistoryManager,
  IHistoryStorage,
  HistoryMessage,
  IHistoryManagerConfig,
  HistoryManagerEvents,
  SerializedHistoryState,
} from './core/history/index.js';
export { DEFAULT_HISTORY_MANAGER_CONFIG } from './core/history/index.js';
export { InMemoryHistoryStorage } from './infrastructure/storage/InMemoryHistoryStorage.js';

// Task & Plan Entities
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
} from './domain/entities/Task.js';

// Task & Plan Utilities
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
} from './domain/entities/Task.js';

// Routine Entities
export type {
  RoutineDefinition,
  RoutineDefinitionInput,
  RoutineExecutionStatus,
  RoutineExecution,
  RoutineParameter,
} from './domain/entities/Routine.js';

export {
  createRoutineDefinition,
  createRoutineExecution,
  getRoutineProgress,
} from './domain/entities/Routine.js';

// Routine Execution Records (persisted history)
export type {
  RoutineStepType,
  RoutineExecutionStep,
  RoutineTaskResult,
  RoutineTaskSnapshot,
  RoutineExecutionRecord,
} from './domain/entities/RoutineExecutionRecord.js';

export {
  createRoutineExecutionRecord,
  createTaskSnapshots,
} from './domain/entities/RoutineExecutionRecord.js';

// Routine Runner
export { executeRoutine } from './core/routineRunner.js';
export type { ExecuteRoutineOptions, ValidationContext } from './core/routineRunner.js';

// Execution Recorder
export { createExecutionRecorder } from './core/createExecutionRecorder.js';
export type { ExecutionRecorderOptions, ExecutionRecorder } from './core/createExecutionRecorder.js';

// Routine Control Flow
export { resolveTemplates, ROUTINE_KEYS, resolveFlowSource } from './core/routineControlFlow.js';
export type { ControlFlowResult } from './core/routineControlFlow.js';

// Memory Entities
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
} from './domain/entities/Memory.js';
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
} from './domain/entities/Memory.js';

// Agent State
export type {
  AgentState,
  AgentStatus,
  AgentConfig as TaskAgentStateConfig,
  ConversationMessage,
  AgentMetrics,
} from './domain/entities/AgentState.js';

// Storage Interfaces
export type { IMemoryStorage } from './domain/interfaces/IMemoryStorage.js';
export type { IPlanStorage } from './domain/interfaces/IPlanStorage.js';
export type { IAgentStateStorage } from './domain/interfaces/IAgentStateStorage.js';
export { createAgentStorage } from './infrastructure/storage/index.js';
export type { IAgentStorage } from './infrastructure/storage/InMemoryStorage.js';
export { InMemoryStorage, InMemoryPlanStorage, InMemoryAgentStateStorage } from './infrastructure/storage/index.js';

// Context Storage Implementations (for AgentContext session persistence)
export { FileContextStorage, createFileContextStorage } from './infrastructure/storage/index.js';
export type { FileContextStorageConfig } from './infrastructure/storage/index.js';

// Agent Definition Storage Implementations (for agent configuration persistence)
export { FileAgentDefinitionStorage, createFileAgentDefinitionStorage } from './infrastructure/storage/index.js';
export type { FileAgentDefinitionStorageConfig } from './infrastructure/storage/index.js';

// Custom Tool Storage
export type {
  ICustomToolStorage,
  CustomToolListOptions,
} from './domain/interfaces/ICustomToolStorage.js';
export { CUSTOM_TOOL_DEFINITION_VERSION } from './domain/entities/CustomToolDefinition.js';
export type {
  CustomToolDefinition,
  CustomToolSummary,
  CustomToolTestCase,
  CustomToolMetadata,
} from './domain/entities/CustomToolDefinition.js';
export { FileCustomToolStorage, createFileCustomToolStorage } from './infrastructure/storage/index.js';
export type { FileCustomToolStorageConfig } from './infrastructure/storage/index.js';

// Correlation Storage Implementations (for suspend/resume session mapping)
export { FileCorrelationStorage, createFileCorrelationStorage } from './infrastructure/storage/index.js';
export type { FileCorrelationStorageConfig } from './infrastructure/storage/index.js';

// Tool Context (ToolContext is the canonical interface for tool execution context)
export type { ToolContext, ToolContext as TaskToolContext, WorkingMemoryAccess } from './domain/interfaces/IToolContext.js';

// ============ Domain Types ============

// Content
export { ContentType } from './domain/entities/Content.js';
export type {
  Content,
  InputTextContent,
  InputImageContent,
  OutputTextContent,
  ToolUseContent,
  ToolResultContent,
  ThinkingContent,
} from './domain/entities/Content.js';

// Messages
export { MessageRole } from './domain/entities/Message.js';
export type {
  Message,
  InputItem,
  OutputItem,
  CompactionItem,
  ReasoningItem,
} from './domain/entities/Message.js';

// Tools
export {
  ToolCallState,
  defaultDescribeCall,
  getToolCallDescription,
} from './domain/entities/Tool.js';
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
} from './domain/entities/Tool.js';

// Response
export type { LLMResponse, AgentResponse } from './domain/entities/Response.js';

// Connector types
export type {
  ConnectorConfig,
  ConnectorAuth,
  OAuthConnectorAuth,
  APIKeyConnectorAuth,
  JWTConnectorAuth,
} from './domain/entities/Connector.js';

// Model Registry
export type { ILLMDescription } from './domain/entities/Model.js';
export {
  LLM_MODELS,
  MODEL_REGISTRY,
  getModelInfo,
  getModelsByVendor,
  getActiveModels,
  calculateCost,
} from './domain/entities/Model.js';

// Audio Model Registries
export type { ITTSModelDescription, TTSModelCapabilities } from './domain/entities/TTSModel.js';
export type { ISTTModelDescription, STTModelCapabilities } from './domain/entities/STTModel.js';
export type { IVoiceInfo } from './domain/entities/SharedVoices.js';
export {
  TTS_MODELS,
  TTS_MODEL_REGISTRY,
  getTTSModelInfo,
  getTTSModelsByVendor,
  getActiveTTSModels,
  getTTSModelsWithFeature,
  calculateTTSCost,
} from './domain/entities/TTSModel.js';
export {
  STT_MODELS,
  STT_MODEL_REGISTRY,
  getSTTModelInfo,
  getSTTModelsByVendor,
  getActiveSTTModels,
  getSTTModelsWithFeature,
  calculateSTTCost,
} from './domain/entities/STTModel.js';

// Image Model Registry
export type { IImageModelDescription, ImageModelCapabilities, ImageModelPricing } from './domain/entities/ImageModel.js';
export {
  IMAGE_MODELS,
  IMAGE_MODEL_REGISTRY,
  getImageModelInfo,
  getImageModelsByVendor,
  getActiveImageModels,
  getImageModelsWithFeature,
  calculateImageCost,
} from './domain/entities/ImageModel.js';

// Video Model Registry
export type { IVideoModelDescription, VideoModelCapabilities, VideoModelPricing } from './domain/entities/VideoModel.js';
export {
  VIDEO_MODELS,
  VIDEO_MODEL_REGISTRY,
  getVideoModelInfo,
  getVideoModelsByVendor,
  getActiveVideoModels,
  getVideoModelsWithFeature,
  getVideoModelsWithAudio,
  calculateVideoCost,
} from './domain/entities/VideoModel.js';

// ============ Streaming ============
export { StreamEventType } from './domain/entities/StreamEvent.js';
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
} from './domain/entities/StreamEvent.js';
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
} from './domain/entities/StreamEvent.js';
export { StreamState } from './domain/entities/StreamState.js';
export { StreamHelpers } from './capabilities/agents/StreamHelpers.js';

// ============ Hooks & Events (Enterprise) ============
export { ExecutionContext, HookManager } from './capabilities/agents/index.js';
export type {
  // New canonical names
  AgentEvents,
  AgentEventName,
  ExecutionConfig,
  // Legacy names for backward compatibility
  AgenticLoopEvents,
  AgenticLoopEventName,
  // Hook types
  HookConfig,
  HookName,
  Hook,
  ModifyingHook,
  BeforeToolContext,
  AfterToolContext,
  ApproveToolContext,
  ToolModification,
  ApprovalResult,
  HistoryMode,
  ExecutionMetrics,
  AuditEntry,
} from './capabilities/agents/index.js';

// ============ Errors ============
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
  // TaskAgent errors
  DependencyCycleError,
  TaskTimeoutError,
  TaskValidationError,
  ParallelTasksError,
  // Context management errors
  ContextOverflowError,
} from './domain/errors/AIErrors.js';
export type { TaskFailure, ContextOverflowBudget } from './domain/errors/AIErrors.js';

// ============ Interfaces (for extensibility) ============
export type { IProvider, ProviderCapabilities } from './domain/interfaces/IProvider.js';
export type { ITextProvider, TextGenerateOptions, ModelCapabilities } from './domain/interfaces/ITextProvider.js';
export type { IToolExecutor } from './domain/interfaces/IToolExecutor.js';
export type { IDisposable, IAsyncDisposable } from './domain/interfaces/IDisposable.js';
export { assertNotDestroyed } from './domain/interfaces/IDisposable.js';

// Connector Registry & Access Control
export type { IConnectorRegistry } from './domain/interfaces/IConnectorRegistry.js';
export type { IConnectorAccessPolicy, ConnectorAccessContext } from './domain/interfaces/IConnectorAccessPolicy.js';

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
} from './domain/interfaces/IAudioProvider.js';

// Image Interfaces
export type {
  IImageProvider,
  ImageGenerateOptions,
  ImageEditOptions,
  ImageVariationOptions,
  ImageResponse,
} from './domain/interfaces/IImageProvider.js';

// Video Interfaces
export type {
  IVideoProvider,
  VideoGenerateOptions,
  VideoExtendOptions,
  VideoResponse,
  VideoJob,
  VideoStatus,
} from './domain/interfaces/IVideoProvider.js';

// Base classes for custom providers
export { BaseProvider } from './infrastructure/providers/base/BaseProvider.js';
export { BaseTextProvider } from './infrastructure/providers/base/BaseTextProvider.js';
export { BaseMediaProvider } from './infrastructure/providers/base/BaseMediaProvider.js';
export { ProviderErrorMapper } from './infrastructure/providers/base/ProviderErrorMapper.js';
export { resolveModelCapabilities, resolveMaxContextTokens } from './infrastructure/providers/base/ModelCapabilityResolver.js';

// Shared types for multi-modal
export type {
  AspectRatio,
  QualityLevel,
  AudioFormat,
  OutputFormat,
  ISourceLinks,
  VendorOptionSchema,
  IBaseModelDescription,
} from './domain/types/SharedTypes.js';

// ============ External Services & Connector Tools ============
// Services constants for well-known external services
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
} from './domain/entities/Services.js';
export type { ServiceType, ServiceInfo, ServiceDefinition, ServiceCategory } from './domain/entities/Services.js';

// Connector resilience defaults
export {
  DEFAULT_CONNECTOR_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRYABLE_STATUSES,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
} from './core/Connector.js';
export type { ConnectorFetchOptions } from './core/Connector.js';

// ConnectorTools framework for vendor-dependent tools
export {
  ConnectorTools,
} from './tools/connector/index.js';
export type {
  ServiceToolFactory,
  GenericAPIToolOptions,
  GenericAPICallArgs,
  GenericAPICallResult,
  ConnectorToolsOptions,
} from './tools/connector/index.js';

// ============ OAuth & Storage (for external APIs) ============
export { OAuthManager, MemoryStorage, FileStorage } from './connectors/index.js';
export { generateEncryptionKey, authenticatedFetch, createAuthenticatedFetch, generateWebAPITool } from './connectors/index.js';
export type { OAuthConfig, OAuthFlow, ITokenStorage, FileStorageConfig, StoredToken } from './connectors/index.js';

// ConnectorConfig storage (persistent connector configs with encryption)
export {
  ConnectorConfigStore,
  MemoryConnectorStorage,
  FileConnectorStorage,
  CONNECTOR_CONFIG_VERSION,
} from './connectors/index.js';
export type {
  IConnectorConfigStorage,
  StoredConnectorConfig,
  FileConnectorStorageConfig,
} from './connectors/index.js';

// ============ Vendor Templates (Pre-configured auth for 40+ services) ============
export {
  // Helpers
  createConnectorFromTemplate,
  getConnectorTools,
  getVendorTemplate,
  getVendorAuthTemplate,
  getAllVendorTemplates,
  listVendorIds,
  listVendors,
  listVendorsByCategory,
  listVendorsByAuthType,
  getVendorInfo,
  getCredentialsSetupURL,
  getDocsURL,
  buildAuthConfig,
  // All templates array
  allVendorTemplates,
  // Logo utilities
  getVendorLogo,
  getVendorLogoSvg,
  getVendorColor,
  getVendorLogoCdnUrl,
  hasVendorLogo,
  getAllVendorLogos,
  listVendorsWithLogos,
  VENDOR_ICON_MAP,
  SIMPLE_ICONS_CDN,
} from './connectors/index.js';

export type {
  VendorTemplate,
  AuthTemplate,
  AuthTemplateField,
  VendorRegistryEntry,
  TemplateCredentials,
  CreateConnectorOptions,
  VendorInfo,
  VendorLogo,
  SimpleIcon,
} from './connectors/index.js';

// ============ Resilience & Observability (Phase 3) ============
export { CircuitBreaker, CircuitOpenError } from './infrastructure/resilience/index.js';
export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerMetrics,
  CircuitBreakerEvents,
} from './infrastructure/resilience/index.js';
export { DEFAULT_CIRCUIT_BREAKER_CONFIG } from './infrastructure/resilience/index.js';

export {
  calculateBackoff,
  addJitter,
  backoffWait,
  backoffSequence,
  retryWithBackoff,
} from './infrastructure/resilience/index.js';
export type { BackoffConfig, BackoffStrategyType } from './infrastructure/resilience/index.js';
export { DEFAULT_BACKOFF_CONFIG } from './infrastructure/resilience/index.js';

export { TokenBucketRateLimiter, RateLimitError } from './infrastructure/resilience/index.js';
export type { RateLimiterConfig, RateLimiterMetrics } from './infrastructure/resilience/index.js';
export { DEFAULT_RATE_LIMITER_CONFIG } from './infrastructure/resilience/index.js';

export { FrameworkLogger, logger } from './infrastructure/observability/index.js';
export type { LogLevel, LoggerConfig, LogEntry } from './infrastructure/observability/index.js';

export {
  NoOpMetrics,
  ConsoleMetrics,
  InMemoryMetrics,
  createMetricsCollector,
  metrics,
  setMetricsCollector,
} from './infrastructure/observability/index.js';
export type { MetricsCollector, MetricTags, MetricsCollectorType } from './infrastructure/observability/index.js';

// ============ Utilities ============
export { MessageBuilder, createTextMessage, createMessageWithImages } from './utils/messageBuilder.js';
export { readClipboardImage, hasClipboardImage } from './utils/clipboardImage.js';
export type { ClipboardImageResult } from './utils/clipboardImage.js';
export { extractJSON, extractJSONField, extractNumber } from './utils/jsonExtractor.js';
export type { JSONExtractionResult } from './utils/jsonExtractor.js';
export { sanitizeToolName } from './utils/sanitize.js';

// ============ Pre-built Tools ============
export * as tools from './tools/index.js';
export { createExecuteJavaScriptTool } from './tools/code/executeJavaScript.js';

// Custom tool generation system (meta-tools + hydration)
export {
  // Default instances (auto-registered via tool registry)
  customToolDraft,
  customToolTest,
  customToolSave,
  customToolList,
  customToolLoad,
  customToolDelete,
  // Factory functions (for custom storage backends)
  createCustomToolMetaTools,
  createCustomToolDraft,
  createCustomToolTest,
  createCustomToolSave,
  createCustomToolList,
  createCustomToolLoad,
  createCustomToolDelete,
  // Hydration
  hydrateCustomTool,
} from './tools/custom-tools/index.js';

export type {
  CustomToolMetaToolsOptions,
  HydrateOptions,
} from './tools/custom-tools/index.js';

// Filesystem tools (factory functions and types)
export {
  readFile,
  writeFile,
  editFile,
  glob,
  grep,
  listDirectory,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createGlobTool,
  createGrepTool,
  createListDirectoryTool,
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
  isExcludedExtension,
  developerTools,
} from './tools/index.js';

export type {
  FilesystemToolConfig,
  ReadFileResult,
  WriteFileResult,
  EditFileResult,
  GlobResult,
  GrepResult,
  GrepMatch,
} from './tools/index.js';

// Shell tools (factory functions and types)
export {
  bash,
  createBashTool,
  getBackgroundOutput,
  killBackgroundProcess,
  DEFAULT_SHELL_CONFIG,
  isBlockedCommand,
} from './tools/index.js';

export type {
  ShellToolConfig,
  BashResult,
} from './tools/index.js';

// Tool Registry (auto-generated)
export {
  toolRegistry,
  getAllBuiltInTools,
  getToolRegistry,
  getToolsByCategory,
  getToolByName,
  getToolsRequiringConnector,
  getToolCategories,
} from './tools/index.js';

export type {
  ToolCategory,
  ToolRegistryEntry,
} from './tools/index.js';

// Unified Tool Registry (built-in + connector tools)
export { ToolRegistry, type ConnectorToolEntry } from './tools/index.js';

// Multimedia tools (auto-registered with ConnectorTools for AI vendors)
export {
  setMediaStorage,
  getMediaStorage,
  createImageGenerationTool,
  createVideoTools,
  createTextToSpeechTool,
  createSpeechToTextTool,
} from './tools/index.js';

// Media storage infrastructure
export { FileMediaStorage, createFileMediaStorage } from './infrastructure/storage/index.js';
export type { FileMediaStorageConfig } from './infrastructure/storage/index.js';

// Deprecated multimedia aliases (backward compat - remove in next major version)
export {
  FileMediaOutputHandler,
  setMediaOutputHandler,
  getMediaOutputHandler,
} from './tools/index.js';

export type {
  IMediaOutputHandler,
  MediaOutputMetadata,
  MediaOutputResult,
} from './tools/index.js';

// GitHub connector tools (auto-registered with ConnectorTools for GitHub service)
export {
  createSearchFilesTool,
  createSearchCodeTool,
  createGitHubReadFileTool,
  createGetPRTool,
  createPRFilesTool,
  createPRCommentsTool,
  createCreatePRTool,
  createListBranchesTool,
  parseRepository,
  resolveRepository,
} from './tools/index.js';

export type {
  GitHubRepository,
  GitHubSearchFilesResult,
  GitHubSearchCodeResult,
  GitHubReadFileResult,
  GitHubGetPRResult,
  GitHubPRFilesResult,
  GitHubPRCommentsResult,
  GitHubPRCommentEntry,
  GitHubCreatePRResult,
  GitHubListBranchesResult,
  GitHubBranchEntry,
} from './tools/index.js';

// Microsoft Graph connector tools (auto-registered with ConnectorTools for Microsoft service)
export {
  createDraftEmailTool,
  createSendEmailTool,
  createMeetingTool,
  createEditMeetingTool,
  createGetMeetingTranscriptTool,
  createFindMeetingSlotsTool,
  createMicrosoftReadFileTool,
  createMicrosoftListFilesTool,
  createMicrosoftSearchFilesTool,
  getUserPathPrefix,
  microsoftFetch,
  formatRecipients,
  formatAttendees,
  normalizeEmails,
  isTeamsMeetingUrl,
  resolveMeetingId,
  encodeSharingUrl,
  isWebUrl,
  isMicrosoftFileUrl,
  getDrivePrefix,
  resolveFileEndpoints,
  formatFileSize,
} from './tools/index.js';

export type {
  MicrosoftDraftEmailResult,
  MicrosoftSendEmailResult,
  MicrosoftCreateMeetingResult,
  MicrosoftEditMeetingResult,
  MicrosoftGetTranscriptResult,
  MicrosoftFindSlotsResult,
  MeetingSlotSuggestion,
  MicrosoftReadFileResult,
  MicrosoftListFilesResult,
  MicrosoftSearchFilesResult,
  GraphDriveItem,
} from './tools/index.js';

// Desktop automation tools (requires @nut-tree-fork/nut-js peer dependency)
export {
  desktopScreenshot,
  desktopMouseMove,
  desktopMouseClick,
  desktopMouseDrag,
  desktopMouseScroll,
  desktopGetCursor,
  desktopKeyboardType,
  desktopKeyboardKey,
  desktopGetScreenSize,
  desktopWindowList,
  desktopWindowFocus,
  desktopTools,
  createDesktopScreenshotTool,
  createDesktopMouseMoveTool,
  createDesktopMouseClickTool,
  createDesktopMouseDragTool,
  createDesktopMouseScrollTool,
  createDesktopGetCursorTool,
  createDesktopKeyboardTypeTool,
  createDesktopKeyboardKeyTool,
  createDesktopGetScreenSizeTool,
  createDesktopWindowListTool,
  createDesktopWindowFocusTool,
  NutTreeDriver,
  parseKeyCombo,
  getDesktopDriver,
  resetDefaultDriver,
  DEFAULT_DESKTOP_CONFIG,
  DESKTOP_TOOL_NAMES,
} from './tools/index.js';

export type {
  IDesktopDriver,
  DesktopToolConfig,
  DesktopPoint,
  DesktopScreenSize,
  DesktopScreenshot,
  DesktopWindow,
  MouseButton,
  DesktopToolName,
  DesktopScreenshotArgs,
  DesktopScreenshotResult,
  DesktopMouseMoveArgs,
  DesktopMouseMoveResult,
  DesktopMouseClickArgs,
  DesktopMouseClickResult,
  DesktopMouseDragArgs,
  DesktopMouseDragResult,
  DesktopMouseScrollArgs,
  DesktopMouseScrollResult,
  DesktopGetCursorResult,
  DesktopKeyboardTypeArgs,
  DesktopKeyboardTypeResult,
  DesktopKeyboardKeyArgs,
  DesktopKeyboardKeyResult,
  DesktopGetScreenSizeResult,
  DesktopWindowListResult,
  DesktopWindowFocusArgs,
  DesktopWindowFocusResult,
} from './tools/index.js';

// ============ Built-in Agents ============
export { ProviderConfigAgent } from './agents/index.js';
export type { ConnectorConfigResult } from './agents/index.js';


// ============ MCP (Model Context Protocol) ============
export { MCPClient, MCPRegistry } from './core/mcp/index.js';
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
} from './core/mcp/index.js';
export {
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPProtocolError,
  MCPToolError,
  MCPResourceError,
} from './core/mcp/index.js';

// PersistentInstructions Storage
export { FilePersistentInstructionsStorage } from './infrastructure/storage/index.js';
export type { FilePersistentInstructionsStorageConfig } from './infrastructure/storage/index.js';
export type { IPersistentInstructionsStorage } from './domain/interfaces/IPersistentInstructionsStorage.js';

// UserInfo Storage
export { FileUserInfoStorage } from './infrastructure/storage/index.js';
export type { FileUserInfoStorageConfig } from './infrastructure/storage/index.js';
export type { IUserInfoStorage, UserInfoEntry } from './domain/interfaces/IUserInfoStorage.js';

// RoutineDefinition Storage
export type { IRoutineDefinitionStorage } from './domain/interfaces/IRoutineDefinitionStorage.js';
export { FileRoutineDefinitionStorage, createFileRoutineDefinitionStorage } from './infrastructure/storage/index.js';
export type { FileRoutineDefinitionStorageConfig } from './infrastructure/storage/index.js';

// RoutineExecution Storage
export type { IRoutineExecutionStorage } from './domain/interfaces/IRoutineExecutionStorage.js';
export { FileRoutineExecutionStorage, createFileRoutineExecutionStorage } from './infrastructure/storage/index.js';
export type { FileRoutineExecutionStorageConfig } from './infrastructure/storage/index.js';

// Scheduling & Triggers
export type { IScheduler, ScheduleHandle, ScheduleSpec } from './domain/interfaces/IScheduler.js';
export { SimpleScheduler } from './infrastructure/scheduling/SimpleScheduler.js';
export { EventEmitterTrigger } from './infrastructure/triggers/EventEmitterTrigger.js';

