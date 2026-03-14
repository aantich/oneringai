/**
 * Preload script - exposes safe IPC methods to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IContextSnapshot, IViewContextData, RoutineDefinition, RoutineDefinitionInput } from '@everworker/oneringai';

/**
 * Ollama types (mirrored from OllamaService to avoid cross-module imports)
 */
export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

export type OllamaStatus =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

export interface OllamaState {
  status: OllamaStatus;
  isExternalInstance: boolean;
  externalBinaryPath?: string;
  version: string;
  autoStart: boolean;
  models: OllamaModel[];
  error?: string;
  downloadProgress?: { percent: number; downloaded: number; total: number };
  pullProgress?: { model: string; percent: number; status: string };
  systemInfo: {
    totalRAMGB: number;
    platform: string;
    arch: string;
    recommendedModel: string;
    recommendedModelReason: string;
  };
}

/**
 * Everworker Backend Profile
 */
export interface EverworkerProfile {
  id: string;
  name: string;
  url: string;
  token: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt?: number;
  lastSyncConnectorCount?: number;
  /** Unix ms — when the JWT token expires */
  tokenExpiresAt?: number;
  /** Unix ms — when the JWT token was issued */
  tokenIssuedAt?: number;
  /** Display name of the authenticated EW user */
  userName?: string;
  /** EW user ID */
  userId?: string;
  /** How the token was obtained */
  authMethod?: 'manual' | 'browser-auth';
}

export interface EverworkerProfilesConfig {
  version: 2;
  activeProfileId: string | null;
  profiles: EverworkerProfile[];
}

/**
 * Task interface for plan display (matches core library Task interface)
 */
export interface PlanTask {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'blocked' | 'in_progress' | 'waiting_external' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  dependsOn: string[];
  validation?: {
    completionCriteria?: string[];
  };
  result?: {
    success: boolean;
    output?: unknown;
    error?: string;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Plan interface for plan display (matches core library Plan interface)
 */
export interface Plan {
  id: string;
  goal: string;
  context?: string;
  tasks: PlanTask[];
  status: 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Dynamic UI element types for agent-provided UI
 */
export interface DynamicUIElement {
  type: 'text' | 'heading' | 'input' | 'button' | 'select' | 'progress' | 'alert' | 'code' | 'divider' | 'spacer' | 'image' | 'list' | 'table' | 'link' | 'badge' | 'card' | 'browser';
  id?: string;
  label?: string;
  value?: unknown;
  action?: string;
  variant?: string;
  // Text/Heading
  level?: number;
  // Input
  inputType?: string;
  placeholder?: string;
  helpText?: string;
  disabled?: boolean;
  rows?: number;
  // Select
  options?: Array<{ value: string; label: string }>;
  // Progress
  max?: number;
  animated?: boolean;
  striped?: boolean;
  // Button
  size?: string;
  loadingText?: string;
  // Code
  language?: string;
  // Image
  src?: string;
  alt?: string;
  // Link
  href?: string;
  external?: boolean;
  // List
  items?: string[];
  ordered?: boolean;
  // Table
  headers?: string[];
  tableRows?: string[][];
  // Card
  children?: DynamicUIElement[];
  // Browser
  instanceId?: string;
  showUrlBar?: boolean;
  showNavButtons?: boolean;
  currentUrl?: string;
  pageTitle?: string;
  isLoading?: boolean;
}

/**
 * Dynamic UI content schema for rendering in the sidebar
 */
export interface DynamicUIContent {
  type: 'form' | 'display' | 'chart' | 'table' | 'custom';
  title?: string;
  elements: DynamicUIElement[];
}

/**
 * In-context memory entry for UI display
 */
export interface ContextEntryForUI {
  key: string;
  description: string;
  value: unknown;
  priority: 'low' | 'normal' | 'high' | 'critical';
  showInUI?: boolean;
  updatedAt: number;
}

/**
 * Stream chunk types for IPC communication
 */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'thinking_done'; content: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown>; description: string }
  | { type: 'tool_end'; tool: string; durationMs?: number; result?: unknown }
  | { type: 'tool_error'; tool: string; error: string; result?: unknown }
  | { type: 'done' }
  | { type: 'error'; content: string }
  // Plan events
  | { type: 'plan:created'; plan: Plan }
  | { type: 'plan:awaiting_approval'; plan: Plan }
  | { type: 'plan:approved'; plan: Plan }
  | { type: 'plan:analyzing'; goal: string }
  | { type: 'mode:changed'; from: string; to: string; reason: string }
  // Task events
  | { type: 'task:started'; task: PlanTask }
  | { type: 'task:progress'; task: PlanTask; status: string }
  | { type: 'task:completed'; task: PlanTask; result: unknown }
  | { type: 'task:failed'; task: PlanTask; error: string }
  // Execution events
  | { type: 'execution:done'; result: { status: string; completedTasks: number; totalTasks: number; failedTasks: number; skippedTasks: number } }
  | { type: 'execution:paused'; reason: string }
  | { type: 'needs:approval'; plan: Plan }
  // UI control events (for Dynamic UI)
  | { type: 'ui:show_sidebar'; tab?: 'look_inside' | 'dynamic_ui' }
  | { type: 'ui:hide_sidebar' }
  | { type: 'ui:set_dynamic_content'; content: DynamicUIContent }
  | { type: 'ui:clear_dynamic_content' }
  // In-context memory entries for UI display
  | { type: 'ui:context_entries'; entries: ContextEntryForUI[]; pinnedKeys: string[] }
  // Browser automation events (for Dynamic UI)
  | { type: 'browser:show'; instanceId: string }
  | { type: 'browser:hide' }
  | { type: 'browser:state-update'; state: BrowserStateInfo }
  // Proactive overlay detection (popup/modal appeared)
  | { type: 'overlay_detected'; overlay: DetectedOverlay; hint: string }
  // Routine execution events (live, in-memory only — not persisted)
  | { type: 'routine:started'; executionId: string; routineName: string; taskCount: number }
  | { type: 'routine:task_started'; executionId: string; taskId: string; taskName: string }
  | { type: 'routine:task_completed'; executionId: string; taskId: string; taskName: string; progress: number; output?: string; validationScore?: number }
  | { type: 'routine:task_failed'; executionId: string; taskId: string; taskName: string; progress: number; error: string }
  | { type: 'routine:step'; executionId: string; step: { timestamp: number; taskName: string; type: string; data?: Record<string, unknown> } }
  | { type: 'routine:completed'; executionId: string; progress: number }
  | { type: 'routine:failed'; executionId: string; error: string }
  // Browser user control handoff events
  | { type: 'browser:user_has_control'; reason?: string }
  | { type: 'browser:agent_has_control' }
  // Voice pseudo-streaming events
  // Voice pseudo-streaming events
  | { type: 'voice:chunk'; chunkIndex: number; subIndex?: number; audioBase64: string; format: string; durationSeconds?: number; text: string }
  | { type: 'voice:error'; chunkIndex: number; error: string; text: string }
  | { type: 'voice:complete'; totalChunks: number; totalDurationSeconds?: number }
  // Stream status events (retry, incomplete, failed)
  | { type: 'retry'; attempt: number; maxAttempts: number; reason: string; delayMs: number }
  | { type: 'status'; status: 'completed' | 'incomplete' | 'failed'; stopReason?: string };

/**
 * Browser state info for IPC
 */
export interface BrowserStateInfo {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
  hasOverlay?: boolean;
  overlay?: DetectedOverlay;
}

/**
 * Detected overlay/popup information
 */
export interface DetectedOverlay {
  type: 'modal' | 'popup' | 'cookie_consent' | 'notification' | 'unknown';
  selector: string;
  title?: string;
  text?: string;
  buttons: string[];
  position?: { x: number; y: number; width: number; height: number };
}

/**
 * Browser instance info for IPC
 */
export interface BrowserInstanceInfo {
  instanceId: string;
  currentUrl: string;
  currentTitle: string;
  isAttached: boolean;
  createdAt: number;
}

/**
 * Rectangle bounds for browser view positioning
 */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Types for the exposed API
export interface HoseaAPI {
  // Service readiness (non-blocking startup)
  service: {
    isReady: () => Promise<boolean>;
    onReady: (callback: () => void) => void;
    removeReadyListener: () => void;
  };

  // Agent
  agent: {
    // Legacy single-agent methods (for backwards compatibility)
    initialize: (connectorName: string, model: string) => Promise<{ success: boolean; error?: string }>;
    send: (message: string) => Promise<{ success: boolean; response?: string; error?: string }>;
    stream: (message: string) => Promise<{ success: boolean }>;
    cancel: () => Promise<{ success: boolean }>;
    status: () => Promise<{
      initialized: boolean;
      connector: string | null;
      model: string | null;
      mode: string | null;
    }>;
    onStreamChunk: (callback: (chunk: StreamChunk) => void) => void;
    onStreamEnd: (callback: () => void) => void;
    removeStreamListeners: () => void;
    // Plan approval/rejection
    approvePlan: (planId: string) => Promise<{ success: boolean; error?: string }>;
    rejectPlan: (planId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;

    // Multi-tab instance methods
    createInstance: (agentConfigId: string) => Promise<{ success: boolean; instanceId?: string; error?: string }>;
    destroyInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    streamInstance: (instanceId: string, message: string) => Promise<{ success: boolean }>;
    cancelInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    // Browser user control handoff
    takeUserControl: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    handBackToAgent: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    statusInstance: (instanceId: string) => Promise<{
      found: boolean;
      initialized: boolean;
      connector: string | null;
      model: string | null;
      mode: string | null;
      agentConfigId: string | null;
    }>;
    listInstances: () => Promise<Array<{ instanceId: string; agentConfigId: string; createdAt: number }>>;
    // Session saving
    setSessionSave: (instanceId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    // Voice pseudo-streaming
    setVoiceover: (instanceId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    getVoiceConfig: (agentConfigId: string) => Promise<{
      voiceEnabled: boolean;
      voiceConnector?: string;
      voiceModel?: string;
      voiceVoice?: string;
      voiceFormat?: string;
      voiceSpeed?: number;
    } | null>;
    // Instance-aware streaming listeners
    onStreamChunkInstance: (callback: (instanceId: string, chunk: StreamChunk) => void) => void;
    onStreamEndInstance: (callback: (instanceId: string) => void) => void;
    removeStreamInstanceListeners: () => void;
    // Context entry pinning (for "Current Context" UI display)
    pinContextKey: (agentConfigId: string, key: string, pinned: boolean) => Promise<{ success: boolean; error?: string }>;
    getPinnedContextKeys: (agentConfigId: string) => Promise<string[]>;
  };

  // Connectors
  connector: {
    list: () => Promise<Array<{
      name: string;
      vendor: string;
      source?: 'local' | 'everworker' | 'built-in';
      models?: string[];
      createdAt: number;
    }>>;
    add: (config: unknown) => Promise<{ success: boolean; error?: string }>;
    delete: (name: string) => Promise<{ success: boolean; error?: string }>;
    update: (name: string, updates: { apiKey?: string; baseURL?: string }) => Promise<{ success: boolean; error?: string }>;
    fetchModels: (vendor: string, apiKey?: string, baseURL?: string, existingConnectorName?: string) => Promise<{ success: boolean; models?: string[]; error?: string }>;
  };

  // Built-in OAuth (Connections page — zero-config vendor auth)
  builtInOAuth: {
    list: () => Promise<Array<{
      vendorId: string;
      displayName: string;
      clientId: string;
      authTemplateId: string;
      scopes: string[];
    }>>;
    authorize: (vendorId: string) => Promise<{ success: boolean; error?: string }>;
    getStatus: (vendorId: string) => Promise<{ connected: boolean; connectorName?: string }>;
    disconnect: (vendorId: string) => Promise<{ success: boolean; error?: string }>;
    getDefaultEWUrl: () => Promise<string>;
  };

  // Everworker Backend
  everworker: {
    getConfig: () => Promise<{
      url: string;
      token: string;
      enabled: boolean;
    } | null>;
    setConfig: (config: {
      url: string;
      token: string;
      enabled: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    testConnection: () => Promise<{ success: boolean; connectorCount?: number; error?: string }>;
    syncConnectors: () => Promise<{ success: boolean; added: number; updated: number; removed: number; error?: string }>;

    // Multi-profile API
    getProfiles: () => Promise<EverworkerProfilesConfig>;
    addProfile: (data: {
      name: string;
      url: string;
      token: string;
      tokenExpiresAt?: number;
      tokenIssuedAt?: number;
      userName?: string;
      userId?: string;
      authMethod?: 'manual' | 'browser-auth';
    }) => Promise<{ success: boolean; id?: string; error?: string }>;
    updateProfile: (id: string, updates: {
      name?: string;
      url?: string;
      token?: string;
      tokenExpiresAt?: number;
      tokenIssuedAt?: number;
      userName?: string;
      userId?: string;
      authMethod?: 'manual' | 'browser-auth';
    }) => Promise<{ success: boolean; error?: string }>;
    deleteProfile: (id: string) => Promise<{ success: boolean; error?: string }>;
    switchProfile: (id: string | null) => Promise<{ success: boolean; added?: number; removed?: number; error?: string }>;
    testProfile: (id: string) => Promise<{ success: boolean; connectorCount?: number; error?: string }>;
    syncActive: () => Promise<{ success: boolean; added?: number; updated?: number; removed?: number; error?: string }>;

    // Browser-based auth flow
    checkAuthSupport: (url: string) => Promise<{ supported: boolean; version?: number; error?: string }>;
    startAuth: (url: string) => Promise<{
      success: boolean;
      token?: string;
      expiresAt?: number;
      userName?: string;
      userId?: string;
      error?: string;
    }>;
    cancelAuth: () => Promise<void>;
    getTokenStatus: (profileId?: string) => Promise<{
      status: 'valid' | 'expiring_soon' | 'expired' | 'unknown';
      expiresAt?: number;
      daysRemaining?: number;
    }>;

    // Push event from main process
    onConnectorsChanged: (callback: (data: { profileId: string | null; added: number; removed: number }) => void) => void;
    removeConnectorsChangedListener: () => void;
    onTokenExpiry: (callback: (data: { profileId: string; status: string; daysRemaining?: number }) => void) => void;
    removeTokenExpiryListener: () => void;
  };

  // Telemetry
  telemetry: {
    getStatus: () => Promise<{ enabled: boolean; installationId: string | null }>;
    setEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
  };

  // App info
  app: {
    getVersion: () => Promise<string>;
    getIsDev: () => Promise<boolean>;
  };

  // What's New
  whatsnew: {
    getLastSeen: () => Promise<string | null>;
    markSeen: (version: string) => Promise<{ success: boolean }>;
  };

  // License
  license: {
    getStatus: () => Promise<{ accepted: boolean; acceptedVersion: string | null; acceptedAt: number | null }>;
    accept: () => Promise<{ success: boolean }>;
  };

  // Models
  model: {
    list: () => Promise<Array<{
      vendor: string;
      models: Array<{ id: string; name: string; description?: string; contextWindow: number }>;
    }>>;
    details: (modelId: string) => Promise<{
      name: string;
      provider: string;
      description?: string;
      isActive: boolean;
      features: {
        input: { tokens: number };
        output: { tokens: number };
        reasoning?: boolean;
        streaming: boolean;
        functionCalling?: boolean;
        vision?: boolean;
      };
    } | null>;
    vendors: () => Promise<string[]>;
  };

  // Strategies (compaction strategies)
  strategy: {
    list: () => Promise<Array<{
      name: string;
      displayName: string;
      description: string;
      threshold: number;
      isBuiltIn: boolean;
    }>>;
  };

  // Sessions (legacy single-agent)
  session: {
    save: () => Promise<{ success: boolean; sessionId?: string; error?: string }>;
    load: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    list: () => Promise<Array<{ id: string; createdAt: number }>>;
    new: () => Promise<{ success: boolean }>;
  };

  // Session History (multi-agent, scans inst_* dirs)
  history: {
    listAll: () => Promise<Array<{
      agentConfigId: string;
      agentName: string;
      sessions: Array<{
        sessionId: string;
        instanceId: string;
        title: string;
        createdAt: number;
        lastSavedAt: number;
        messageCount: number;
        model?: string;
      }>;
    }>>;
    resume: (agentConfigId: string, sessionId: string, oldInstanceId: string) => Promise<{
      success: boolean;
      instanceId?: string;
      messages?: Array<{ id: string; role: string; content: string; timestamp: number }>;
      error?: string;
    }>;
    delete: (instanceId: string, sessionId: string) => Promise<{ success: boolean; error?: string }>;
  };

  // Tools
  tool: {
    list: () => Promise<Array<{ name: string; enabled: boolean; description: string }>>;
    toggle: (toolName: string, enabled: boolean) => Promise<{ success: boolean }>;
    registry: () => Promise<Array<{
      name: string;
      displayName: string;
      category: string;
      categoryDisplayName: string;
      description: string;
      safeByDefault: boolean;
      requiresConnector: boolean;
      connectorServiceTypes?: string[];
      source: 'oneringai' | 'hosea' | 'custom';
    }>>;
    categories: () => Promise<Array<{ id: string; displayName: string; count: number }>>;
    getSchema: (toolName: string) => Promise<Record<string, unknown> | null>;
  };

  // Config
  config: {
    get: () => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<{ success: boolean }>;
  };

  // Logging
  log: {
    getLevel: () => Promise<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent'>;
    setLevel: (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent') => Promise<{ success: boolean }>;
  };

  // Dialog
  dialog: {
    showOpenDialog: (options: {
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };

  // Agent configurations (saved agent presets)
  agentConfig: {
    list: () => Promise<Array<{
      id: string;
      name: string;
      connector: string;
      model: string;
      agentType: 'basic';
      instructions: string;
      temperature: number;
      maxIterations: number;
      contextStrategy: string;
      maxContextTokens: number;
      responseReserve: number;
      workingMemoryEnabled: boolean;
      maxMemorySizeBytes: number;
      maxMemoryIndexEntries: number;
      memorySoftLimitPercent: number;
      contextAllocationPercent: number;
      inContextMemoryEnabled: boolean;
      maxInContextEntries: number;
      maxInContextTokens: number;
      persistentInstructionsEnabled: boolean;
      userInfoEnabled: boolean;
      // @deprecated - not used in NextGen context
      historyEnabled: boolean;
      maxHistoryMessages: number;
      preserveRecent: number;
      // @deprecated - not used in NextGen context
      cacheEnabled: boolean;
      cacheTtlMs: number;
      cacheMaxEntries: number;
      permissionsEnabled: boolean;
      tools: string[];
      toolCatalogEnabled: boolean;
      pinnedCategories: string[];
      toolCategoryScope: string[];
      mcpServers?: Array<{ serverName: string; selectedTools?: string[] }>;
      // Voice/TTS settings
      voiceEnabled?: boolean;
      voiceConnector?: string;
      voiceModel?: string;
      voiceVoice?: string;
      voiceFormat?: string;
      voiceSpeed?: number;
      createdAt: number;
      updatedAt: number;
      lastUsedAt?: number;
      isActive: boolean;
    }>>;
    get: (id: string) => Promise<{
      id: string;
      name: string;
      connector: string;
      model: string;
      agentType: 'basic';
      instructions: string;
      temperature: number;
      maxIterations: number;
      contextStrategy: string;
      maxContextTokens: number;
      responseReserve: number;
      workingMemoryEnabled: boolean;
      maxMemorySizeBytes: number;
      maxMemoryIndexEntries: number;
      memorySoftLimitPercent: number;
      contextAllocationPercent: number;
      inContextMemoryEnabled: boolean;
      maxInContextEntries: number;
      maxInContextTokens: number;
      persistentInstructionsEnabled: boolean;
      userInfoEnabled: boolean;
      // @deprecated - not used in NextGen context
      historyEnabled: boolean;
      maxHistoryMessages: number;
      preserveRecent: number;
      // @deprecated - not used in NextGen context
      cacheEnabled: boolean;
      cacheTtlMs: number;
      cacheMaxEntries: number;
      permissionsEnabled: boolean;
      tools: string[];
      toolCatalogEnabled: boolean;
      pinnedCategories: string[];
      toolCategoryScope: string[];
      mcpServers?: Array<{ serverName: string; selectedTools?: string[] }>;
      // Voice/TTS settings
      voiceEnabled?: boolean;
      voiceConnector?: string;
      voiceModel?: string;
      voiceVoice?: string;
      voiceFormat?: string;
      voiceSpeed?: number;
      createdAt: number;
      updatedAt: number;
      lastUsedAt?: number;
      isActive: boolean;
    } | null>;
    create: (config: unknown) => Promise<{ success: boolean; id?: string; error?: string }>;
    update: (id: string, updates: unknown) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    setActive: (id: string) => Promise<{ success: boolean; error?: string }>;
    getActive: () => Promise<{
      id: string;
      name: string;
      connector: string;
      model: string;
      agentType: 'basic';
      isActive: boolean;
    } | null>;
    createDefault: (connectorName: string, model: string) => Promise<{ success: boolean; id?: string; error?: string }>;
  };

  // Internals monitoring (Look Inside)
  // Returns IContextSnapshot from @everworker/oneringai core library
  internals: {
    /** Get snapshot for legacy single agent */
    getAll: () => Promise<IContextSnapshot>;
    getContextStats: () => Promise<{
      available: boolean;
      totalTokens: number;
      maxTokens: number;
      utilizationPercent: number;
      messagesCount: number;
      toolCallsCount: number;
      strategy: string;
    } | null>;
    getMemoryEntries: () => Promise<Array<{
      key: string;
      description: string;
      scope: string;
      priority: string;
      sizeBytes: number;
      updatedAt: number;
      value?: unknown;
    }>>;
    /** Get prepared context (IViewContextData) */
    getPreparedContext: (instanceId?: string) => Promise<IViewContextData>;
    getMemoryValue: (key: string) => Promise<unknown>;
    forceCompact: () => Promise<{ success: boolean; tokensFreed: number; error?: string }>;
    /** Instance-aware methods */
    getAllForInstance: (instanceId: string | null) => Promise<IContextSnapshot>;
    getMemoryValueForInstance: (instanceId: string | null, key: string) => Promise<unknown>;
    forceCompactForInstance: (instanceId: string | null) => Promise<{ success: boolean; tokensFreed: number; error?: string }>;
  };

  // Universal Connectors (vendor templates)
  universalConnector: {
    // Vendor template access (read-only from library)
    listVendors: () => Promise<Array<{
      id: string;
      name: string;
      category: string;
      docsURL?: string;
      credentialsSetupURL?: string;
      authMethods: Array<{
        id: string;
        name: string;
        type: string;
        description: string;
        requiredFields: string[];
        scopes?: string[];
        scopeDescriptions?: Record<string, string>;
      }>;
    }>>;
    getVendor: (vendorId: string) => Promise<{
      id: string;
      name: string;
      category: string;
      docsURL?: string;
      credentialsSetupURL?: string;
      authMethods: Array<{
        id: string;
        name: string;
        type: string;
        description: string;
        requiredFields: string[];
        scopes?: string[];
        scopeDescriptions?: Record<string, string>;
      }>;
    } | null>;
    getVendorTemplate: (vendorId: string) => Promise<{
      id: string;
      name: string;
      serviceType: string;
      baseURL: string;
      docsURL?: string;
      credentialsSetupURL?: string;
      authTemplates: Array<{
        id: string;
        name: string;
        type: 'api_key' | 'oauth';
        flow?: 'authorization_code' | 'client_credentials' | 'jwt_bearer';
        description: string;
        requiredFields: string[];
        optionalFields?: string[];
        scopes?: string[];
        scopeDescriptions?: Record<string, string>;
      }>;
      category: string;
      notes?: string;
    } | null>;
    getVendorLogo: (vendorId: string) => Promise<{
      vendorId: string;
      svg: string;
      hex: string;
      isPlaceholder: boolean;
      simpleIconsSlug?: string;
    } | null>;
    getCategories: () => Promise<string[]>;
    listVendorsByCategory: (category: string) => Promise<Array<{
      id: string;
      name: string;
      category: string;
      docsURL?: string;
      credentialsSetupURL?: string;
      authMethods: Array<{
        id: string;
        name: string;
        type: string;
        description: string;
        requiredFields: string[];
        scopes?: string[];
        scopeDescriptions?: Record<string, string>;
      }>;
    }>>;

    // Connector CRUD operations
    list: () => Promise<Array<{
      name: string;
      vendorId: string;
      vendorName: string;
      authMethodId: string;
      authMethodName: string;
      credentials: Record<string, string>;
      displayName?: string;
      baseURL?: string;
      createdAt: number;
      updatedAt: number;
      lastTestedAt?: number;
      status: 'active' | 'error' | 'untested';
      legacyServiceType?: string;
      source?: 'local' | 'everworker' | 'built-in';
    }>>;
    get: (name: string) => Promise<{
      name: string;
      vendorId: string;
      vendorName: string;
      authMethodId: string;
      authMethodName: string;
      credentials: Record<string, string>;
      displayName?: string;
      baseURL?: string;
      createdAt: number;
      updatedAt: number;
      lastTestedAt?: number;
      status: 'active' | 'error' | 'untested';
      legacyServiceType?: string;
      source?: 'local' | 'everworker' | 'built-in';
    } | null>;
    create: (config: {
      name: string;
      vendorId: string;
      authMethodId: string;
      credentials: Record<string, string>;
      displayName?: string;
      baseURL?: string;
    }) => Promise<{ success: boolean; error?: string; needsAuth?: boolean; flow?: string }>;
    update: (name: string, updates: {
      credentials?: Record<string, string>;
      displayName?: string;
      baseURL?: string;
      status?: 'active' | 'error' | 'untested';
    }) => Promise<{ success: boolean; error?: string }>;
    delete: (name: string) => Promise<{ success: boolean; error?: string }>;
    testConnection: (name: string) => Promise<{ success: boolean; error?: string; needsAuth?: boolean; flow?: string }>;
  };

  // OAuth flow management
  oauth: {
    /** Start OAuth authorization flow for a connector */
    startFlow: (connectorName: string) => Promise<{ success: boolean; error?: string }>;
    /** Cancel any in-progress OAuth flow */
    cancelFlow: () => Promise<void>;
    /** Get token status for an OAuth connector */
    getTokenStatus: (connectorName: string) => Promise<{
      hasToken: boolean;
      isValid: boolean;
      needsAuth: boolean;
      flow?: string;
      error?: string;
    }>;
    /** Get the redirect URI to register with OAuth providers */
    getRedirectUri: () => Promise<string>;
  };

  // MCP Servers (Model Context Protocol)
  mcpServer: {
    /** List all configured MCP servers */
    list: () => Promise<Array<{
      name: string;
      displayName?: string;
      description?: string;
      transport: 'stdio' | 'http' | 'https';
      transportConfig: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        url?: string;
        token?: string;
        headers?: Record<string, string>;
        timeoutMs?: number;
      };
      toolNamespace?: string;
      connectorBindings?: Record<string, string>;
      status: 'connected' | 'disconnected' | 'error' | 'connecting';
      lastError?: string;
      toolCount?: number;
      availableTools?: string[];
      createdAt: number;
      updatedAt: number;
      lastConnectedAt?: number;
    }>>;
    /** Get a specific MCP server configuration */
    get: (name: string) => Promise<{
      name: string;
      displayName?: string;
      description?: string;
      transport: 'stdio' | 'http' | 'https';
      transportConfig: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        url?: string;
        token?: string;
        headers?: Record<string, string>;
        timeoutMs?: number;
      };
      toolNamespace?: string;
      connectorBindings?: Record<string, string>;
      status: 'connected' | 'disconnected' | 'error' | 'connecting';
      lastError?: string;
      toolCount?: number;
      availableTools?: string[];
      createdAt: number;
      updatedAt: number;
      lastConnectedAt?: number;
    } | null>;
    /** Create a new MCP server configuration */
    create: (config: {
      name: string;
      displayName?: string;
      description?: string;
      transport: 'stdio' | 'http' | 'https';
      transportConfig: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        url?: string;
        token?: string;
        headers?: Record<string, string>;
        timeoutMs?: number;
      };
      toolNamespace?: string;
      connectorBindings?: Record<string, string>;
    }) => Promise<{ success: boolean; error?: string }>;
    /** Update an existing MCP server configuration */
    update: (name: string, updates: {
      displayName?: string;
      description?: string;
      transport?: 'stdio' | 'http' | 'https';
      transportConfig?: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        url?: string;
        token?: string;
        headers?: Record<string, string>;
        timeoutMs?: number;
      };
      toolNamespace?: string;
      connectorBindings?: Record<string, string>;
    }) => Promise<{ success: boolean; error?: string }>;
    /** Delete an MCP server configuration */
    delete: (name: string) => Promise<{ success: boolean; error?: string }>;
    /** Connect to an MCP server */
    connect: (name: string) => Promise<{ success: boolean; tools?: string[]; error?: string }>;
    /** Disconnect from an MCP server */
    disconnect: (name: string) => Promise<{ success: boolean; error?: string }>;
    /** Get tools available from an MCP server */
    getTools: (name: string) => Promise<Array<{ name: string; description?: string }>>;
    /** Refresh tools list from a connected MCP server */
    refreshTools: (name: string) => Promise<{ success: boolean; tools?: string[]; error?: string }>;
  };

  // Multimedia - Image, Video, Audio generation
  multimedia: {
    // Image generation
    getAvailableImageModels: (connectorName?: string) => Promise<Array<{
      name: string;
      displayName: string;
      vendor: string;
      description?: string;
      deprecationDate?: string;
      maxPromptLength: number;
      maxImagesPerRequest: number;
      pricing?: {
        perImage?: number;
        perImageStandard?: number;
        perImageHD?: number;
      };
    }>>;
    getImageModelCapabilities: (modelName: string) => Promise<{
      sizes: readonly string[];
      aspectRatios?: readonly string[];
      maxImagesPerRequest: number;
      outputFormats: readonly string[];
      features: {
        generation: boolean;
        editing: boolean;
        variations: boolean;
        styleControl: boolean;
        qualityControl: boolean;
        transparency: boolean;
        promptRevision: boolean;
      };
      limits: {
        maxPromptLength: number;
        maxRequestsPerMinute?: number;
      };
      vendorOptions?: Record<string, unknown>;
    } | null>;
    calculateImageCost: (modelName: string, imageCount: number, quality: string) => Promise<number | null>;
    generateImage: (options: {
      model: string;
      prompt: string;
      connector?: string;
      size?: string;
      quality?: string;
      style?: string;
      n?: number;
      [key: string]: unknown;
    }) => Promise<{
      success: boolean;
      data?: {
        images: Array<{
          b64_json?: string;
          url?: string;
          revisedPrompt?: string;
        }>;
      };
      error?: string;
    }>;
    // Video generation
    getAvailableVideoModels: (connectorName?: string) => Promise<Array<{
      name: string;
      displayName: string;
      vendor: string;
      description?: string;
      durations: number[];
      resolutions: string[];
      maxFps: number;
      audio: boolean;
      imageToVideo: boolean;
      pricing?: {
        perSecond: number;
        currency: string;
      };
    }>>;
    getVideoModelCapabilities: (modelName: string) => Promise<{
      durations: number[];
      resolutions: string[];
      aspectRatios?: string[];
      maxFps: number;
      audio: boolean;
      imageToVideo: boolean;
      videoExtension: boolean;
      frameControl: boolean;
      features: {
        upscaling: boolean;
        styleControl: boolean;
        negativePrompt: boolean;
        seed: boolean;
      };
      pricing?: {
        perSecond: number;
        currency: string;
      };
    } | null>;
    calculateVideoCost: (modelName: string, durationSeconds: number) => Promise<number | null>;
    generateVideo: (options: {
      model: string;
      prompt: string;
      connector?: string;
      duration?: number;
      resolution?: string;
      aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      image?: string;
      seed?: number;
      vendorOptions?: Record<string, unknown>;
    }) => Promise<{
      success: boolean;
      jobId?: string;
      error?: string;
    }>;
    getVideoStatus: (jobId: string) => Promise<{
      success: boolean;
      status?: 'pending' | 'processing' | 'completed' | 'failed';
      progress?: number;
      video?: {
        url?: string;
        duration?: number;
      };
      error?: string;
    }>;
    downloadVideo: (jobId: string) => Promise<{
      success: boolean;
      data?: string;
      mimeType?: string;
      error?: string;
    }>;
    cancelVideoJob: (jobId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    // TTS
    getAvailableTTSModels: (connectorName?: string) => Promise<Array<{
      name: string;
      displayName: string;
      vendor: string;
      connector: string;
      description?: string;
      maxInputLength: number;
      voiceCount: number;
      pricing?: {
        per1kCharacters: number;
        currency: string;
      };
    }>>;
    getTTSModelCapabilities: (modelName: string) => Promise<{
      voices: Array<{
        id: string;
        name: string;
        language: string;
        gender: 'male' | 'female' | 'neutral';
        style?: string;
        previewUrl?: string;
        isDefault?: boolean;
        accent?: string;
        age?: 'child' | 'young' | 'adult' | 'senior';
      }>;
      formats: string[];
      languages: string[];
      speed: {
        supported: boolean;
        min?: number;
        max?: number;
        default?: number;
      };
      features: {
        streaming: boolean;
        ssml: boolean;
        emotions: boolean;
        voiceCloning: boolean;
        wordTimestamps: boolean;
        instructionSteering?: boolean;
      };
      limits: {
        maxInputLength: number;
        maxRequestsPerMinute?: number;
      };
      vendorOptions?: Record<string, unknown>;
    } | null>;
    calculateTTSCost: (modelName: string, charCount: number) => Promise<number | null>;
    synthesizeSpeech: (options: {
      model: string;
      text: string;
      voice: string;
      connector?: string;
      format?: string;
      speed?: number;
      vendorOptions?: Record<string, unknown>;
    }) => Promise<{
      success: boolean;
      data?: {
        audio: string;
        format: string;
      };
      error?: string;
    }>;
  };

  // Shell
  shell: {
    openExternal: (url: string) => Promise<void>;
  };

  // Auto-updater
  updater: {
    check: () => Promise<{ success: boolean; updateInfo?: unknown; error?: string }>;
    download: () => Promise<{ success: boolean; error?: string }>;
    install: () => void;
    getVersion: () => Promise<string>;
    onStatus: (callback: (status: {
      status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
      version?: string;
      releaseDate?: string;
      releaseNotes?: string | null;
      percent?: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
      message?: string;
    }) => void) => void;
    removeStatusListener: () => void;
  };

  // Browser Automation
  browser: {
    /** Create a browser instance for an agent instance */
    create: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    /** Destroy a browser instance */
    destroy: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    /** Navigate to a URL */
    navigate: (instanceId: string, url: string, options?: {
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      timeout?: number;
    }) => Promise<{
      success: boolean;
      url: string;
      title: string;
      loadTime: number;
      error?: string;
    }>;
    /** Get current browser state */
    getState: (instanceId: string) => Promise<{
      success: boolean;
      url: string;
      title: string;
      isLoading: boolean;
      canGoBack: boolean;
      canGoForward: boolean;
      viewport: { width: number; height: number };
      error?: string;
    }>;
    /** Navigate back */
    goBack: (instanceId: string) => Promise<{ success: boolean; url: string; title: string; error?: string }>;
    /** Navigate forward */
    goForward: (instanceId: string) => Promise<{ success: boolean; url: string; title: string; error?: string }>;
    /** Reload the page */
    reload: (instanceId: string) => Promise<{ success: boolean; url: string; title: string; error?: string }>;
    /** Attach browser view to window for display */
    attach: (instanceId: string, bounds: BrowserBounds) => Promise<{ success: boolean; error?: string }>;
    /** Detach browser view from window */
    detach: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    /** Update browser view bounds */
    updateBounds: (instanceId: string, bounds: BrowserBounds) => Promise<{ success: boolean; error?: string }>;
    /** Get browser instance info */
    getInstanceInfo: (instanceId: string) => Promise<BrowserInstanceInfo | null>;
    /** List all browser instances */
    listInstances: () => Promise<BrowserInstanceInfo[]>;
    /** Check if browser instance exists */
    hasBrowser: (instanceId: string) => Promise<boolean>;
    /** Listen for browser state changes */
    onStateChange: (callback: (instanceId: string, state: BrowserStateInfo) => void) => void;
    /** Listen for browser navigation */
    onNavigate: (callback: (instanceId: string, url: string) => void) => void;
    /** Listen for browser loading status */
    onLoading: (callback: (instanceId: string, isLoading: boolean) => void) => void;
    /** Listen for browser errors */
    onError: (callback: (instanceId: string, error: { errorCode: number; errorDescription: string; url: string }) => void) => void;
    /** Remove all browser listeners */
    removeListeners: () => void;
  };

  // Routines
  routine: {
    list: (options?: { tags?: string[]; search?: string }) => Promise<RoutineDefinition[]>;
    get: (id: string) => Promise<RoutineDefinition | null>;
    save: (input: RoutineDefinitionInput) => Promise<{ id: string }>;
    delete: (id: string) => Promise<void>;
    duplicate: (id: string) => Promise<{ id: string }>;
    validate: (input: RoutineDefinitionInput) => Promise<{ valid: boolean; error?: string }>;
    execute: (instanceId: string, routineId: string) => Promise<{ executionId: string }>;
    cancelExecution: (instanceId: string) => Promise<void>;
  };

  // Ollama (Local AI)
  ollama: {
    getState: () => Promise<OllamaState>;
    detect: () => Promise<OllamaState>;
    download: () => Promise<{ success: boolean; error?: string }>;
    start: () => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    listModels: () => Promise<OllamaModel[]>;
    pullModel: (name: string) => Promise<{ success: boolean; error?: string }>;
    deleteModel: (name: string) => Promise<{ success: boolean; error?: string }>;
    setAutoStart: (enabled: boolean) => Promise<{ success: boolean }>;
    ensureConnector: () => Promise<{ success: boolean; error?: string }>;
    /** DEV ONLY: Reset state to not_installed for testing download flow */
    resetForTesting: () => Promise<{ success: boolean }>;
    // Push event listeners
    onStateChanged: (callback: (state: OllamaState) => void) => void;
    onDownloadProgress: (callback: (progress: { percent: number; downloaded: number; total: number }) => void) => void;
    onPullProgress: (callback: (progress: { model: string; percent: number; status: string }) => void) => void;
    removeListeners: () => void;
  };
}

// Expose to renderer
const api: HoseaAPI = {
  service: {
    isReady: () => ipcRenderer.invoke('service:is-ready'),
    onReady: (callback) => {
      ipcRenderer.removeAllListeners('service:ready');
      ipcRenderer.on('service:ready', () => callback());
    },
    removeReadyListener: () => {
      ipcRenderer.removeAllListeners('service:ready');
    },
  },

  agent: {
    // Legacy single-agent methods
    initialize: (connectorName, model) => ipcRenderer.invoke('agent:initialize', connectorName, model),
    send: (message) => ipcRenderer.invoke('agent:send', message),
    stream: (message) => ipcRenderer.invoke('agent:stream', message),
    cancel: () => ipcRenderer.invoke('agent:cancel'),
    status: () => ipcRenderer.invoke('agent:status'),
    onStreamChunk: (callback) => {
      // Remove any existing listeners first to prevent duplicates
      ipcRenderer.removeAllListeners('agent:stream-chunk');
      ipcRenderer.on('agent:stream-chunk', (_event, chunk) => callback(chunk));
    },
    onStreamEnd: (callback) => {
      // Remove any existing listeners first to prevent duplicates
      ipcRenderer.removeAllListeners('agent:stream-end');
      ipcRenderer.on('agent:stream-end', () => callback());
    },
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('agent:stream-chunk');
      ipcRenderer.removeAllListeners('agent:stream-end');
    },
    approvePlan: (planId) => ipcRenderer.invoke('agent:approve-plan', planId),
    rejectPlan: (planId, reason) => ipcRenderer.invoke('agent:reject-plan', planId, reason),

    // Multi-tab instance methods
    createInstance: (agentConfigId) => ipcRenderer.invoke('agent:create-instance', agentConfigId),
    destroyInstance: (instanceId) => ipcRenderer.invoke('agent:destroy-instance', instanceId),
    streamInstance: (instanceId, message) => ipcRenderer.invoke('agent:stream-instance', instanceId, message),
    cancelInstance: (instanceId) => ipcRenderer.invoke('agent:cancel-instance', instanceId),
    takeUserControl: (instanceId) => ipcRenderer.invoke('agent:take-user-control', instanceId),
    handBackToAgent: (instanceId) => ipcRenderer.invoke('agent:hand-back-to-agent', instanceId),
    statusInstance: (instanceId) => ipcRenderer.invoke('agent:status-instance', instanceId),
    listInstances: () => ipcRenderer.invoke('agent:list-instances'),
    // Session saving
    setSessionSave: (instanceId, enabled) => ipcRenderer.invoke('agent:set-session-save', instanceId, enabled),
    // Voice pseudo-streaming
    setVoiceover: (instanceId, enabled) => ipcRenderer.invoke('agent:set-voiceover', instanceId, enabled),
    getVoiceConfig: (agentConfigId) => ipcRenderer.invoke('agent:get-voice-config', agentConfigId),
    // Instance-aware streaming listeners (include instanceId in callback)
    onStreamChunkInstance: (callback) => {
      ipcRenderer.removeAllListeners('agent:stream-chunk');
      ipcRenderer.on('agent:stream-chunk', (_event, instanceId, chunk) => callback(instanceId, chunk));
    },
    onStreamEndInstance: (callback) => {
      ipcRenderer.removeAllListeners('agent:stream-end');
      ipcRenderer.on('agent:stream-end', (_event, instanceId) => callback(instanceId));
    },
    removeStreamInstanceListeners: () => {
      ipcRenderer.removeAllListeners('agent:stream-chunk');
      ipcRenderer.removeAllListeners('agent:stream-end');
    },
    // Context entry pinning
    pinContextKey: (agentConfigId, key, pinned) => ipcRenderer.invoke('agent:pin-context-key', agentConfigId, key, pinned),
    getPinnedContextKeys: (agentConfigId) => ipcRenderer.invoke('agent:get-pinned-context-keys', agentConfigId),
  },

  connector: {
    list: () => ipcRenderer.invoke('connector:list'),
    add: (config) => ipcRenderer.invoke('connector:add', config),
    delete: (name) => ipcRenderer.invoke('connector:delete', name),
    update: (name, updates) => ipcRenderer.invoke('connector:update', name, updates),
    fetchModels: (vendor, apiKey?, baseURL?, existingConnectorName?) => ipcRenderer.invoke('connector:fetch-models', vendor, apiKey, baseURL, existingConnectorName),
  },

  builtInOAuth: {
    list: () => ipcRenderer.invoke('built-in-oauth:list'),
    authorize: (vendorId) => ipcRenderer.invoke('built-in-oauth:authorize', vendorId),
    getStatus: (vendorId) => ipcRenderer.invoke('built-in-oauth:get-status', vendorId),
    disconnect: (vendorId) => ipcRenderer.invoke('built-in-oauth:disconnect', vendorId),
    getDefaultEWUrl: () => ipcRenderer.invoke('built-in-oauth:get-default-ew-url'),
  },

  everworker: {
    getConfig: () => ipcRenderer.invoke('everworker:get-config'),
    setConfig: (config) => ipcRenderer.invoke('everworker:set-config', config),
    testConnection: () => ipcRenderer.invoke('everworker:test-connection'),
    syncConnectors: () => ipcRenderer.invoke('everworker:sync-connectors'),

    // Multi-profile API
    getProfiles: () => ipcRenderer.invoke('everworker:get-profiles'),
    addProfile: (data) => ipcRenderer.invoke('everworker:add-profile', data),
    updateProfile: (id, updates) => ipcRenderer.invoke('everworker:update-profile', id, updates),
    deleteProfile: (id) => ipcRenderer.invoke('everworker:delete-profile', id),
    switchProfile: (id) => ipcRenderer.invoke('everworker:switch-profile', id),
    testProfile: (id) => ipcRenderer.invoke('everworker:test-profile', id),
    syncActive: () => ipcRenderer.invoke('everworker:sync-active'),

    // Browser-based auth flow
    checkAuthSupport: (url) => ipcRenderer.invoke('everworker:check-auth-support', url),
    startAuth: (url) => ipcRenderer.invoke('everworker:start-auth', url),
    cancelAuth: () => ipcRenderer.invoke('everworker:cancel-auth'),
    getTokenStatus: (profileId) => ipcRenderer.invoke('everworker:token-status', profileId),

    // Push event from main process
    onConnectorsChanged: (callback) => {
      ipcRenderer.removeAllListeners('everworker:connectors-changed');
      ipcRenderer.on('everworker:connectors-changed', (_event, data) => callback(data));
    },
    removeConnectorsChangedListener: () => {
      ipcRenderer.removeAllListeners('everworker:connectors-changed');
    },
    onTokenExpiry: (callback) => {
      ipcRenderer.removeAllListeners('everworker:token-expiry');
      ipcRenderer.on('everworker:token-expiry', (_event, data) => callback(data));
    },
    removeTokenExpiryListener: () => {
      ipcRenderer.removeAllListeners('everworker:token-expiry');
    },
  },

  // Telemetry
  telemetry: {
    getStatus: () => ipcRenderer.invoke('telemetry:get-status'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:set-enabled', enabled),
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getIsDev: () => ipcRenderer.invoke('app:get-is-dev'),
  },

  // What's New
  whatsnew: {
    getLastSeen: () => ipcRenderer.invoke('whatsnew:get-last-seen'),
    markSeen: (version: string) => ipcRenderer.invoke('whatsnew:mark-seen', version),
  },

  // License
  license: {
    getStatus: () => ipcRenderer.invoke('license:get-status'),
    accept: () => ipcRenderer.invoke('license:accept'),
  },

  model: {
    list: () => ipcRenderer.invoke('model:list'),
    details: (modelId) => ipcRenderer.invoke('model:details', modelId),
    vendors: () => ipcRenderer.invoke('model:vendors'),
  },

  strategy: {
    list: () => ipcRenderer.invoke('strategy:list'),
  },

  session: {
    save: () => ipcRenderer.invoke('session:save'),
    load: (sessionId) => ipcRenderer.invoke('session:load', sessionId),
    list: () => ipcRenderer.invoke('session:list'),
    new: () => ipcRenderer.invoke('session:new'),
  },

  history: {
    listAll: () => ipcRenderer.invoke('history:list-all'),
    resume: (agentConfigId: string, sessionId: string, oldInstanceId: string) => ipcRenderer.invoke('history:resume', agentConfigId, sessionId, oldInstanceId),
    delete: (instanceId: string, sessionId: string) => ipcRenderer.invoke('history:delete', instanceId, sessionId),
  },

  tool: {
    list: () => ipcRenderer.invoke('tool:list'),
    toggle: (toolName, enabled) => ipcRenderer.invoke('tool:toggle', toolName, enabled),
    registry: () => ipcRenderer.invoke('tool:registry'),
    categories: () => ipcRenderer.invoke('tool:categories'),
    getSchema: (toolName) => ipcRenderer.invoke('tool:getSchema', toolName),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },

  agentConfig: {
    list: () => ipcRenderer.invoke('agent-config:list'),
    get: (id) => ipcRenderer.invoke('agent-config:get', id),
    create: (config) => ipcRenderer.invoke('agent-config:create', config),
    update: (id, updates) => ipcRenderer.invoke('agent-config:update', id, updates),
    delete: (id) => ipcRenderer.invoke('agent-config:delete', id),
    setActive: (id) => ipcRenderer.invoke('agent-config:set-active', id),
    getActive: () => ipcRenderer.invoke('agent-config:get-active'),
    createDefault: (connectorName, model) => ipcRenderer.invoke('agent-config:create-default', connectorName, model),
  },

  universalConnector: {
    // Vendor template access
    listVendors: () => ipcRenderer.invoke('universal-connector:list-vendors'),
    getVendor: (vendorId) => ipcRenderer.invoke('universal-connector:get-vendor', vendorId),
    getVendorTemplate: (vendorId) => ipcRenderer.invoke('universal-connector:get-vendor-template', vendorId),
    getVendorLogo: (vendorId) => ipcRenderer.invoke('universal-connector:get-vendor-logo', vendorId),
    getCategories: () => ipcRenderer.invoke('universal-connector:get-categories'),
    listVendorsByCategory: (category) => ipcRenderer.invoke('universal-connector:list-vendors-by-category', category),
    // Connector CRUD
    list: () => ipcRenderer.invoke('universal-connector:list'),
    get: (name) => ipcRenderer.invoke('universal-connector:get', name),
    create: (config) => ipcRenderer.invoke('universal-connector:create', config),
    update: (name, updates) => ipcRenderer.invoke('universal-connector:update', name, updates),
    delete: (name) => ipcRenderer.invoke('universal-connector:delete', name),
    testConnection: (name) => ipcRenderer.invoke('universal-connector:test-connection', name),
  },

  oauth: {
    startFlow: (connectorName: string) => ipcRenderer.invoke('oauth:start-flow', connectorName),
    cancelFlow: () => ipcRenderer.invoke('oauth:cancel-flow'),
    getTokenStatus: (connectorName: string) => ipcRenderer.invoke('oauth:token-status', connectorName),
    getRedirectUri: () => ipcRenderer.invoke('oauth:get-redirect-uri') as Promise<string>,
  },

  mcpServer: {
    list: () => ipcRenderer.invoke('mcp-server:list'),
    get: (name) => ipcRenderer.invoke('mcp-server:get', name),
    create: (config) => ipcRenderer.invoke('mcp-server:create', config),
    update: (name, updates) => ipcRenderer.invoke('mcp-server:update', name, updates),
    delete: (name) => ipcRenderer.invoke('mcp-server:delete', name),
    connect: (name) => ipcRenderer.invoke('mcp-server:connect', name),
    disconnect: (name) => ipcRenderer.invoke('mcp-server:disconnect', name),
    getTools: (name) => ipcRenderer.invoke('mcp-server:get-tools', name),
    refreshTools: (name) => ipcRenderer.invoke('mcp-server:refresh-tools', name),
  },

  multimedia: {
    // Image generation
    getAvailableImageModels: (connectorName?) => ipcRenderer.invoke('multimedia:get-available-image-models', connectorName),
    getImageModelCapabilities: (modelName) => ipcRenderer.invoke('multimedia:get-image-model-capabilities', modelName),
    calculateImageCost: (modelName, imageCount, quality) => ipcRenderer.invoke('multimedia:calculate-image-cost', modelName, imageCount, quality),
    generateImage: (options) => ipcRenderer.invoke('multimedia:generate-image', options),
    // Video generation
    getAvailableVideoModels: (connectorName?) => ipcRenderer.invoke('multimedia:get-available-video-models', connectorName),
    getVideoModelCapabilities: (modelName) => ipcRenderer.invoke('multimedia:get-video-model-capabilities', modelName),
    calculateVideoCost: (modelName, durationSeconds) => ipcRenderer.invoke('multimedia:calculate-video-cost', modelName, durationSeconds),
    generateVideo: (options) => ipcRenderer.invoke('multimedia:generate-video', options),
    getVideoStatus: (jobId) => ipcRenderer.invoke('multimedia:get-video-status', jobId),
    downloadVideo: (jobId) => ipcRenderer.invoke('multimedia:download-video', jobId),
    cancelVideoJob: (jobId) => ipcRenderer.invoke('multimedia:cancel-video-job', jobId),
    // TTS
    getAvailableTTSModels: (connectorName?) => ipcRenderer.invoke('multimedia:get-available-tts-models', connectorName),
    getTTSModelCapabilities: (modelName) => ipcRenderer.invoke('multimedia:get-tts-model-capabilities', modelName),
    calculateTTSCost: (modelName, charCount) => ipcRenderer.invoke('multimedia:calculate-tts-cost', modelName, charCount),
    synthesizeSpeech: (options) => ipcRenderer.invoke('multimedia:synthesize-speech', options),
  },

  internals: {
    // Legacy methods (use single agent)
    getAll: () => ipcRenderer.invoke('internals:get-all'),
    getContextStats: () => ipcRenderer.invoke('internals:get-context-stats'),
    getMemoryEntries: () => ipcRenderer.invoke('internals:get-memory-entries'),
    getPreparedContext: (instanceId?: string) => ipcRenderer.invoke('internals:get-prepared-context', instanceId),
    getMemoryValue: (key: string) => ipcRenderer.invoke('internals:get-memory-value', key),
    forceCompact: () => ipcRenderer.invoke('internals:force-compact'),
    // Instance-aware methods
    getAllForInstance: (instanceId: string | null) => ipcRenderer.invoke('internals:get-all', instanceId),
    getMemoryValueForInstance: (instanceId: string | null, key: string) => ipcRenderer.invoke('internals:get-memory-value', instanceId, key),
    forceCompactForInstance: (instanceId: string | null) => ipcRenderer.invoke('internals:force-compact', instanceId),
  },

  log: {
    getLevel: () => ipcRenderer.invoke('log:get-level'),
    setLevel: (level) => ipcRenderer.invoke('log:set-level', level),
  },

  dialog: {
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:show-open-dialog', options),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getVersion: () => ipcRenderer.invoke('updater:get-version'),
    onStatus: (callback) => {
      ipcRenderer.removeAllListeners('updater:status');
      ipcRenderer.on('updater:status', (_event, status) => callback(status));
    },
    removeStatusListener: () => {
      ipcRenderer.removeAllListeners('updater:status');
    },
  },

  browser: {
    create: (instanceId) => ipcRenderer.invoke('browser:create', instanceId),
    destroy: (instanceId) => ipcRenderer.invoke('browser:destroy', instanceId),
    navigate: (instanceId, url, options) => ipcRenderer.invoke('browser:navigate', instanceId, url, options),
    getState: (instanceId) => ipcRenderer.invoke('browser:get-state', instanceId),
    goBack: (instanceId) => ipcRenderer.invoke('browser:go-back', instanceId),
    goForward: (instanceId) => ipcRenderer.invoke('browser:go-forward', instanceId),
    reload: (instanceId) => ipcRenderer.invoke('browser:reload', instanceId),
    attach: (instanceId, bounds) => ipcRenderer.invoke('browser:attach', instanceId, bounds),
    detach: (instanceId) => ipcRenderer.invoke('browser:detach', instanceId),
    updateBounds: (instanceId, bounds) => ipcRenderer.invoke('browser:update-bounds', instanceId, bounds),
    getInstanceInfo: (instanceId) => ipcRenderer.invoke('browser:get-instance-info', instanceId),
    listInstances: () => ipcRenderer.invoke('browser:list-instances'),
    hasBrowser: (instanceId) => ipcRenderer.invoke('browser:has-browser', instanceId),
    onStateChange: (callback) => {
      ipcRenderer.removeAllListeners('browser:state-change');
      ipcRenderer.on('browser:state-change', (_event, instanceId, state) => callback(instanceId, state));
    },
    onNavigate: (callback) => {
      ipcRenderer.removeAllListeners('browser:navigate');
      ipcRenderer.on('browser:navigate', (_event, instanceId, url) => callback(instanceId, url));
    },
    onLoading: (callback) => {
      ipcRenderer.removeAllListeners('browser:loading');
      ipcRenderer.on('browser:loading', (_event, instanceId, isLoading) => callback(instanceId, isLoading));
    },
    onError: (callback) => {
      ipcRenderer.removeAllListeners('browser:error');
      ipcRenderer.on('browser:error', (_event, instanceId, error) => callback(instanceId, error));
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('browser:state-change');
      ipcRenderer.removeAllListeners('browser:navigate');
      ipcRenderer.removeAllListeners('browser:loading');
      ipcRenderer.removeAllListeners('browser:error');
    },
  },

  routine: {
    list: (options?) => ipcRenderer.invoke('routine:list', options),
    get: (id) => ipcRenderer.invoke('routine:get', id),
    save: (input) => ipcRenderer.invoke('routine:save', input),
    delete: (id) => ipcRenderer.invoke('routine:delete', id),
    duplicate: (id) => ipcRenderer.invoke('routine:duplicate', id),
    validate: (input) => ipcRenderer.invoke('routine:validate', input),
    execute: (instanceId, routineId) => ipcRenderer.invoke('routine:execute', instanceId, routineId),
    cancelExecution: (instanceId) => ipcRenderer.invoke('routine:cancel-execution', instanceId),
  },

  ollama: {
    getState: () => ipcRenderer.invoke('ollama:get-state'),
    detect: () => ipcRenderer.invoke('ollama:detect'),
    download: () => ipcRenderer.invoke('ollama:download'),
    start: () => ipcRenderer.invoke('ollama:start'),
    stop: () => ipcRenderer.invoke('ollama:stop'),
    listModels: () => ipcRenderer.invoke('ollama:list-models'),
    pullModel: (name) => ipcRenderer.invoke('ollama:pull-model', name),
    deleteModel: (name) => ipcRenderer.invoke('ollama:delete-model', name),
    setAutoStart: (enabled) => ipcRenderer.invoke('ollama:set-auto-start', enabled),
    ensureConnector: () => ipcRenderer.invoke('ollama:ensure-connector'),
    resetForTesting: () => ipcRenderer.invoke('ollama:reset-for-testing'),
    onStateChanged: (callback) => {
      ipcRenderer.removeAllListeners('ollama:state-changed');
      ipcRenderer.on('ollama:state-changed', (_event, state) => callback(state));
    },
    onDownloadProgress: (callback) => {
      ipcRenderer.removeAllListeners('ollama:download-progress');
      ipcRenderer.on('ollama:download-progress', (_event, progress) => callback(progress));
    },
    onPullProgress: (callback) => {
      ipcRenderer.removeAllListeners('ollama:pull-progress');
      ipcRenderer.on('ollama:pull-progress', (_event, progress) => callback(progress));
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('ollama:state-changed');
      ipcRenderer.removeAllListeners('ollama:download-progress');
      ipcRenderer.removeAllListeners('ollama:pull-progress');
    },
  },
};

contextBridge.exposeInMainWorld('hosea', api);

// Type declaration for renderer
declare global {
  interface Window {
    hosea: HoseaAPI;
  }
}
