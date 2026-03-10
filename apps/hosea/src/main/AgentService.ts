/**
 * AgentService - Manages the @everworker/oneringai integration
 *
 * This service bridges Electron IPC with the agent library.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  Connector,
  Vendor,
  isVendor,
  Agent,
  // NextGen context (replaces old AgentContext)
  AgentContextNextGen,
  // NextGen plugins for inspector
  InContextMemoryPluginNextGen,
  ImageGeneration,
  VideoGeneration,
  getModelsByVendor,
  getModelInfo,
  FileContextStorage,
  FileAgentDefinitionStorage,
  StorageRegistry,
  logger,
  defaultDescribeCall,
  getImageModelInfo,
  getActiveImageModels,
  calculateImageCost,
  getVideoModelInfo,
  getActiveVideoModels,
  calculateVideoCost,
  TextToSpeech,
  VoiceStream,
  getTTSModelInfo,
  getActiveTTSModels,
  calculateTTSCost,
  // Vendor templates
  listVendors as listVendorTemplates,
  listVendorsByCategory,
  getVendorTemplate,
  getVendorInfo,
  getVendorLogo,
  getVendorAuthTemplate,
  createConnectorFromTemplate,
  // MCP
  MCPRegistry,
  // Strategy Registry
  StrategyRegistry,
  type MCPServerConfig,
  type IMCPClient,
  type VendorInfo,
  type VendorTemplate,
  type VendorLogo,
  type AuthTemplate,
  type ITTSModelDescription,
  type IVoiceInfo,
  type ToolFunction,
  type IContextStorage,
  type IAgentDefinitionStorage,
  type StoredAgentDefinition,
  type ILLMDescription,
  type LogLevel,
  type IImageModelDescription,
  type IVideoModelDescription,
  type AgentConfig,
  type ContextFeatures,
  type ContextBudget,
  type AgentContextNextGenConfig,
  type StrategyInfo,
  type IContextSnapshot,
  type IViewContextData,
  ConnectorTools,
  ToolRegistry,
  FileStorage,
  createProvider,
  // Routines
  FileRoutineDefinitionStorage,
  createRoutineDefinition,
  executeRoutine,
  type RoutineDefinition,
  type RoutineDefinitionInput,
} from '@everworker/oneringai';
import type { BrowserService } from './BrowserService.js';
import { ToolCatalogRegistry } from '@everworker/oneringai';
import type { CatalogToolEntry } from '@everworker/oneringai';
import { registerHoseaTools, updateBrowserService, invalidateHoseaTools } from './tools/index.js';
import { HoseaUIPlugin, type DynamicUIContent } from './plugins/index.js';
import { VendorOAuthService } from './VendorOAuthService.js';
import { OAuthCallbackServer } from './OAuthCallbackServer.js';
import { OAuthCallbackServerHttps } from './OAuthCallbackServerHttps.js';
import { loadBuiltInOAuthApps, type BuiltInOAuthApp } from './built-in-oauth-apps.js';

interface StoredConnectorConfig {
  name: string;
  vendor: string;
  auth: { type: 'api_key'; apiKey: string } | { type: 'none' };
  baseURL?: string;
  models?: string[];
  /** Where this connector comes from: 'local' (user-configured) or 'everworker' (synced from EW backend) */
  source?: 'local' | 'everworker';
  createdAt: number;
  updatedAt: number;
}

/**
 * Everworker Backend configuration for proxy mode (LEGACY).
 * Stored at ~/.everworker/hosea/everworker-backend.json
 * @deprecated Use EverworkerProfilesConfig instead
 */
export interface EverworkerBackendConfig {
  /** EW backend URL (e.g., 'https://ew.company.com') */
  url: string;
  /** JWT token with llm:proxy scope */
  token: string;
  /** Whether EW integration is enabled */
  enabled: boolean;
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

export interface TokenStatus {
  status: 'valid' | 'expiring_soon' | 'expired' | 'unknown';
  expiresAt?: number;
  daysRemaining?: number;
}

/**
 * Multi-profile Everworker configuration.
 * Stored at ~/.everworker/hosea/everworker-profiles.json
 */
export interface EverworkerProfilesConfig {
  version: 2;
  activeProfileId: string | null;
  profiles: EverworkerProfile[];
}

/** Connector info returned by EW discovery endpoint */
interface EWRemoteConnector {
  name: string;
  vendor: string;
  type?: 'llm' | 'universal';
  serviceType?: string;
  models?: string[];
}

/**
 * Validate strategy exists in StrategyRegistry.
 * Returns the strategy name if valid, or 'algorithmic' if not found.
 */
function validateStrategy(strategyName: string): { strategy: string; isValid: boolean } {
  if (StrategyRegistry.has(strategyName)) {
    return { strategy: strategyName, isValid: true };
  }
  return { strategy: 'algorithmic', isValid: false };
}

/**
 * Stored Agent Configuration
 *
 * Note: As of NextGen migration, only 'basic' agent type is supported.
 * TaskAgent, UniversalAgent, ResearchAgent are deprecated.
 */
export interface StoredAgentConfig {
  id: string;
  name: string;
  connector: string;
  model: string;
  agentType: 'basic'; // Only 'basic' supported in NextGen
  instructions: string;
  temperature: number;
  // Execution settings
  maxIterations: number;
  // Context settings
  contextStrategy: string;
  maxContextTokens: number;
  responseReserve: number;
  // Working Memory settings (renamed from 'memory' for NextGen clarity)
  workingMemoryEnabled: boolean;
  maxMemorySizeBytes: number;
  maxMemoryIndexEntries: number;
  memorySoftLimitPercent: number;
  contextAllocationPercent: number;
  // In-context memory
  inContextMemoryEnabled: boolean;
  maxInContextEntries: number;
  maxInContextTokens: number;
  // Persistent instructions
  persistentInstructionsEnabled: boolean;
  // Tool permissions
  permissionsEnabled: boolean;
  // Selected tools
  tools: string[];
  // Tool catalog
  toolCatalogEnabled: boolean;
  pinnedCategories: string[];
  toolCategoryScope: string[];   // empty = all built-in categories
  // MCP servers (optional)
  mcpServers?: AgentMCPServerRef[];
  // Voice/TTS settings
  voiceEnabled: boolean;
  voiceConnector?: string;    // TTS connector name (may differ from LLM connector)
  voiceModel?: string;        // e.g. 'tts-1-hd'
  voiceVoice?: string;        // e.g. 'nova'
  voiceFormat?: string;       // audio format, default 'mp3'
  voiceSpeed?: number;        // speech speed, default 1.0
  // Metadata
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  isActive: boolean;

  // DEPRECATED - kept for backward compatibility with old stored configs
  /** @deprecated Not used in NextGen */
  historyEnabled?: boolean;
  /** @deprecated Not used in NextGen */
  maxHistoryMessages?: number;
  /** @deprecated Not used in NextGen */
  preserveRecent?: number;
  /** @deprecated Not used in NextGen - use ToolManager cache instead */
  cacheEnabled?: boolean;
  /** @deprecated Not used in NextGen */
  cacheTtlMs?: number;
  /** @deprecated Not used in NextGen */
  cacheMaxEntries?: number;
}

/**
 * Universal Connector - connector created from vendor template
 */
export interface StoredUniversalConnector {
  /** User-chosen connector name (e.g., 'my-github') */
  name: string;
  /** Vendor template ID (e.g., 'github') */
  vendorId: string;
  /** Vendor display name (e.g., 'GitHub') */
  vendorName: string;
  /** Auth method ID from template (e.g., 'pat') */
  authMethodId: string;
  /** Auth method display name (e.g., 'Personal Access Token') */
  authMethodName: string;
  /** Stored credentials (keys match AuthTemplate.requiredFields) */
  credentials: Record<string, string>;
  /** User's custom display name */
  displayName?: string;
  /** Override base URL if needed */
  baseURL?: string;
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  lastTestedAt?: number;
  /** Connection status */
  status: 'active' | 'error' | 'untested';
  /** For migrated connectors - original serviceType for tool compatibility */
  legacyServiceType?: string;
  /** Where this connector comes from: 'local' (user-configured), 'everworker' (synced from EW backend), or 'built-in' (one-click from Connections page) */
  source?: 'local' | 'everworker' | 'built-in';
}

/**
 * Input for creating a universal connector
 */
export interface CreateUniversalConnectorInput {
  name: string;
  vendorId: string;
  authMethodId: string;
  credentials: Record<string, string>;
  displayName?: string;
  baseURL?: string;
}

// ============ MCP Server Types ============

/**
 * Stored MCP Server Configuration
 */
export interface StoredMCPServerConfig {
  /** Unique server name (used as registry key) */
  name: string;
  /** User-friendly display name */
  displayName?: string;
  /** Server description */
  description?: string;
  /** Transport type */
  transport: 'stdio' | 'http' | 'https';
  /** Transport-specific configuration */
  transportConfig: {
    // Stdio transport
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    // HTTP transport
    url?: string;
    token?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  };
  /** Tool namespace prefix (default: 'mcp:{name}') */
  toolNamespace?: string;
  /**
   * Map environment variable keys to connector names for runtime auth resolution.
   * When connecting, the connector's token will be injected into the env var.
   * Example: { 'GITHUB_PERSONAL_ACCESS_TOKEN': 'my-github-connector' }
   */
  connectorBindings?: Record<string, string>;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  /** Last error message if status is 'error' */
  lastError?: string;
  /** Number of tools available (when connected) */
  toolCount?: number;
  /** List of available tools (when connected) */
  availableTools?: string[];
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  lastConnectedAt?: number;
}

/**
 * MCP server reference for agent configuration
 */
export interface AgentMCPServerRef {
  /** Server name (references StoredMCPServerConfig.name) */
  serverName: string;
  /** Optional: only use these tools from the server (if not specified, all tools are used) */
  selectedTools?: string[];
}

/**
 * Input for creating an MCP server configuration
 */
export interface CreateMCPServerInput {
  name: string;
  displayName?: string;
  description?: string;
  transport: 'stdio' | 'http' | 'https';
  transportConfig: StoredMCPServerConfig['transportConfig'];
  toolNamespace?: string;
  /** Map environment variable keys to connector names for runtime auth resolution */
  connectorBindings?: Record<string, string>;
}

interface HoseaConfig {
  activeConnector: string | null;
  activeModel: string | null;
  logLevel: LogLevel;
  ui: {
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
    streamResponses: boolean;
  };
}

/**
 * Task interface for plan display
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
 * Plan interface for plan display
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
  // Dynamic UI events (from tool execution plugins)
  | { type: 'ui:set_dynamic_content'; content: DynamicUIContent }
  // In-context memory entries for UI display
  | { type: 'ui:context_entries'; entries: Array<{ key: string; description: string; value: unknown; priority: string; showInUI: boolean; updatedAt: number }>; pinnedKeys: string[] }
  // Routine execution events
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
  | { type: 'voice:chunk'; chunkIndex: number; audioBase64: string; format: string; durationSeconds?: number; text: string }
  | { type: 'voice:error'; chunkIndex: number; error: string; text: string }
  | { type: 'voice:complete'; totalChunks: number; totalDurationSeconds?: number };

/**
 * HOSEA UI Capabilities System Prompt
 *
 * This is automatically prepended to all agent instructions to inform them
 * about the rich markdown rendering capabilities available in the UI.
 */
const HOSEA_UI_CAPABILITIES_PROMPT = `
## HOSEA UI Rendering Capabilities

You are running inside HOSEA, a desktop chat interface with advanced markdown rendering. Your responses will be displayed with rich formatting. Use these capabilities to provide better, more visual responses:

### Basic Markdown
- **Bold**, *italic*, ~~strikethrough~~, \`inline code\`
- Headers (# ## ###), lists, blockquotes, links, images
- Tables (GitHub Flavored Markdown)

### Code Blocks
Use fenced code blocks with language identifiers for syntax highlighting:
\`\`\`python
def hello():
    print("Hello!")
\`\`\`

### Mathematical Formulas (LaTeX/KaTeX)
- Inline math: $E = mc^2$
- Block math:
$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

### Mermaid Diagrams
Create flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, and more:
\`\`\`mermaid
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
\`\`\`

### Vega-Lite Charts
Create interactive data visualizations (bar charts, line charts, scatter plots, etc.):
\`\`\`vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "A simple bar chart",
  "data": {
    "values": [
      {"category": "A", "value": 28},
      {"category": "B", "value": 55},
      {"category": "C", "value": 43}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal"},
    "y": {"field": "value", "type": "quantitative"}
  }
}
\`\`\`

### Mindmaps (Markmap)
Create interactive mindmaps from markdown hierarchies:
\`\`\`markmap
# Central Topic
## Branch 1
### Sub-item 1.1
### Sub-item 1.2
## Branch 2
### Sub-item 2.1
## Branch 3
\`\`\`

### Displaying Generated Media (Images, Video, Audio)
When a media generation tool returns a result with a \`location\` field containing a local file path, display it immediately. Use the **raw file path** (no file:// prefix). HOSEA's renderer automatically handles local paths.

**Images** — use markdown image syntax:
\`\`\`
![description](/path/to/media/image.png)
\`\`\`

**Audio** (text_to_speech results) — use a markdown link:
\`\`\`
[Play: description](/path/to/media/audio.mp3)
\`\`\`

**Video** — use a markdown link:
\`\`\`
[Play: description](/path/to/media/video.mp4)
\`\`\`

HOSEA renders audio/video links as inline players automatically. Do NOT use image syntax (\`![]()\`) for audio or video files.

### Best Practices
1. Use diagrams and charts when explaining complex concepts, processes, or data
2. Use tables for comparing options or presenting structured data
3. Use code blocks with proper language tags for any code
4. Use math notation for formulas and equations
5. Use mindmaps for brainstorming or showing hierarchical relationships
6. Keep visualizations simple and focused on the key message

---
`;

const DEFAULT_CONFIG: HoseaConfig = {
  activeConnector: null,
  activeModel: null,
  logLevel: 'info',
  ui: {
    theme: 'system',
    fontSize: 14,
    streamResponses: true,
  },
};

/**
 * Agent instance for multi-tab support
 * Each tab has its own agent instance with independent state
 */
export interface AgentInstance {
  instanceId: string;
  agentConfigId: string;
  agent: Agent; // Only Agent type in NextGen
  sessionStorage: IContextStorage;
  createdAt: number;
  // Voice pseudo-streaming
  voiceStream?: VoiceStream;
  voiceoverEnabled: boolean;
}

/** Maximum concurrent agent instances (memory limit) */
const MAX_INSTANCES = 10;

export class AgentService {
  private dataDir: string;
  private isDev: boolean;
  private agent: Agent | null = null;
  private config: HoseaConfig = DEFAULT_CONFIG;
  private connectors: Map<string, StoredConnectorConfig> = new Map();
  private universalConnectors: Map<string, StoredUniversalConnector> = new Map();
  private agents: Map<string, StoredAgentConfig> = new Map();
  private sessionStorage: IContextStorage | null = null;
  private agentDefinitionStorage: IAgentDefinitionStorage;
  // Active video generation jobs (jobId -> { connectorName, videoGen })
  private activeVideoJobs: Map<string, { connectorName: string; videoGen: VideoGeneration }> = new Map();
  // MCP servers storage
  private mcpServers: Map<string, StoredMCPServerConfig> = new Map();
  // Multi-tab agent instances (instanceId -> AgentInstance)
  private instances: Map<string, AgentInstance> = new Map();
  // Routine definition storage
  private routineStorage = new FileRoutineDefinitionStorage();
  // Browser service reference (set by main process)
  private browserService: BrowserService | null = null;
  // Ollama service reference (set by main process)
  private ollamaService: import('./OllamaService.js').OllamaService | null = null;
  // Vendor OAuth service for authorization_code and client_credentials flows
  private vendorOAuthService = new VendorOAuthService();
  // Tool catalog uses ToolCatalogRegistry (static global)
  // Stream emitter for sending chunks to renderer (set by main process)
  private streamEmitter: ((instanceId: string, chunk: StreamChunk) => void) | null = null;
  // Compaction event log (last N events for each instance/agent)
  private compactionLogs: Map<string, Array<{ timestamp: number; tokensToFree: number; message: string }>> = new Map();
  private readonly MAX_COMPACTION_LOG_ENTRIES = 20;
  // Everworker backend profiles (multi-profile support)
  private ewProfiles: EverworkerProfilesConfig = { version: 2, activeProfileId: null, profiles: [] };
  // Main window sender for push events to renderer
  private mainWindowSender: ((channel: string, ...args: unknown[]) => void) | null = null;
  // Readiness tracking for non-blocking startup
  private _isReady = false;
  private _readyPromise: Promise<void>;
  private _readyResolve!: () => void;

  // ============ Conversion Helpers ============

  /**
   * Convert Hosea's StoredAgentConfig to library's StoredAgentDefinition
   */
  private toStoredDefinition(config: StoredAgentConfig): StoredAgentDefinition {
    return {
      version: 1,
      agentId: config.id,
      name: config.name,
      agentType: 'agent', // Always 'agent' in NextGen (no other types)
      createdAt: new Date(config.createdAt).toISOString(),
      updatedAt: new Date(config.updatedAt).toISOString(),
      connector: {
        name: config.connector,
        model: config.model,
      },
      instructions: config.instructions,
      features: {
        workingMemory: config.workingMemoryEnabled,
        inContextMemory: config.inContextMemoryEnabled,
        persistentInstructions: config.persistentInstructionsEnabled,
        toolCatalog: config.toolCatalogEnabled,
        // Note: history and permissions are Hosea-specific, not part of NextGen ContextFeatures
        // They are stored in typeConfig instead
      },
      // Store all Hosea-specific settings in typeConfig
      typeConfig: {
        temperature: config.temperature,
        contextStrategy: config.contextStrategy,
        maxContextTokens: config.maxContextTokens,
        responseReserve: config.responseReserve,
        maxMemorySizeBytes: config.maxMemorySizeBytes,
        maxMemoryIndexEntries: config.maxMemoryIndexEntries,
        memorySoftLimitPercent: config.memorySoftLimitPercent,
        contextAllocationPercent: config.contextAllocationPercent,
        maxInContextEntries: config.maxInContextEntries,
        maxInContextTokens: config.maxInContextTokens,
        // History and permissions are Hosea-specific features (not in NextGen)
        historyEnabled: config.historyEnabled,
        permissionsEnabled: config.permissionsEnabled,
        maxHistoryMessages: config.maxHistoryMessages,
        preserveRecent: config.preserveRecent,
        cacheTtlMs: config.cacheTtlMs,
        cacheMaxEntries: config.cacheMaxEntries,
        cacheEnabled: config.cacheEnabled,
        tools: config.tools,
        pinnedCategories: config.pinnedCategories,
        toolCategoryScope: config.toolCategoryScope,
        lastUsedAt: config.lastUsedAt,
        isActive: config.isActive,
        // Voice/TTS
        voiceEnabled: config.voiceEnabled,
        voiceConnector: config.voiceConnector,
        voiceModel: config.voiceModel,
        voiceVoice: config.voiceVoice,
        voiceFormat: config.voiceFormat,
        voiceSpeed: config.voiceSpeed,
      },
    };
  }

  /**
   * Convert library's StoredAgentDefinition to Hosea's StoredAgentConfig
   */
  private fromStoredDefinition(definition: StoredAgentDefinition): StoredAgentConfig {
    const typeConfig = definition.typeConfig ?? {};
    const features = definition.features ?? {};

    // Always convert to 'basic' type - all other agent types are deprecated in NextGen
    const agentType: StoredAgentConfig['agentType'] = 'basic';

    // Use stored strategy directly - validation happens at initialization time
    const contextStrategy = (typeConfig.contextStrategy as string) ?? 'algorithmic';

    // Handle backward compatibility for feature names:
    // Old stored definitions use 'memory', new ones use 'workingMemory'
    const workingMemoryEnabled = Boolean(features.workingMemory ?? (features as Record<string, unknown>).memory ?? true);

    return {
      id: definition.agentId,
      name: definition.name,
      connector: definition.connector.name,
      model: definition.connector.model,
      agentType,
      instructions: definition.instructions ?? '',
      temperature: (typeConfig.temperature as number) ?? 0.7,
      maxIterations: (typeConfig.maxIterations as number) ?? 50,
      contextStrategy,
      maxContextTokens: (typeConfig.maxContextTokens as number) ?? 128000,
      responseReserve: (typeConfig.responseReserve as number) ?? 4096,
      workingMemoryEnabled,
      maxMemorySizeBytes: (typeConfig.maxMemorySizeBytes as number) ?? 25 * 1024 * 1024,
      maxMemoryIndexEntries: (typeConfig.maxMemoryIndexEntries as number) ?? 30,
      memorySoftLimitPercent: (typeConfig.memorySoftLimitPercent as number) ?? 80,
      contextAllocationPercent: (typeConfig.contextAllocationPercent as number) ?? 10,
      inContextMemoryEnabled: features.inContextMemory ?? false,
      maxInContextEntries: (typeConfig.maxInContextEntries as number) ?? 20,
      maxInContextTokens: (typeConfig.maxInContextTokens as number) ?? 4000,
      persistentInstructionsEnabled: features.persistentInstructions ?? false,
      toolCatalogEnabled: features.toolCatalog ?? false,
      pinnedCategories: (typeConfig.pinnedCategories as string[]) ?? [],
      toolCategoryScope: (typeConfig.toolCategoryScope as string[]) ?? [],
      permissionsEnabled: (typeConfig.permissionsEnabled as boolean) ?? true,
      tools: (typeConfig.tools as string[]) ?? [],
      createdAt: new Date(definition.createdAt).getTime(),
      updatedAt: new Date(definition.updatedAt).getTime(),
      lastUsedAt: typeConfig.lastUsedAt as number | undefined,
      isActive: (typeConfig.isActive as boolean) ?? false,
      // Voice/TTS
      voiceEnabled: Boolean(typeConfig.voiceEnabled ?? false),
      voiceConnector: typeConfig.voiceConnector as string | undefined,
      voiceModel: typeConfig.voiceModel as string | undefined,
      voiceVoice: typeConfig.voiceVoice as string | undefined,
      voiceFormat: (typeConfig.voiceFormat as string | undefined) ?? 'mp3',
      voiceSpeed: (typeConfig.voiceSpeed as number | undefined) ?? 1.0,
    };
  }

  /**
   * Private constructor - use AgentService.create() instead
   */
  private constructor(dataDir: string, isDev: boolean = false) {
    this.dataDir = dataDir;
    this.isDev = isDev;

    // Initialize centralized storage via StorageRegistry.
    // All subsystems (sessions, agent definitions, OAuth tokens, custom tools, etc.)
    // resolve their storage from the registry at execution time.
    this.initializeStorageRegistry();

    this.agentDefinitionStorage = StorageRegistry.resolve(
      'agentDefinitions',
      () => new FileAgentDefinitionStorage({ baseDirectory: this.dataDir }),
    );

    // Register Hosea-specific tool categories (browser, desktop) with core ToolCatalogRegistry
    registerHoseaTools();

    // Create the ready promise for deferred initialization
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /**
   * Configure the centralized StorageRegistry.
   *
   * Sets per-agent factory for session storage so all agents (default, custom, instances)
   * resolve their FileContextStorage from the registry automatically.
   * OAuth token storage is configured later in initializeTokenStorage() once the
   * encryption key is available.
   */
  private initializeStorageRegistry(): void {
    const baseDirectory = join(this.dataDir, '..');

    StorageRegistry.configure({
      // Per-agent session storage factory — all agents use the same base directory
      sessions: (agentId: string) => new FileContextStorage({
        agentId,
        baseDirectory,
      }),
    });
  }

  /**
   * Create session storage for a given agent ID using the StorageRegistry factory.
   */
  private createSessionStorage(agentId: string): IContextStorage {
    const factory = StorageRegistry.get('sessions');
    if (factory) {
      return factory(agentId);
    }
    // Fallback (should never happen since initializeStorageRegistry runs in constructor)
    return new FileContextStorage({
      agentId,
      baseDirectory: join(this.dataDir, '..'),
    });
  }

  /** Whether heavy (Phase 2) initialization is complete */
  get isReady(): boolean {
    return this._isReady;
  }

  /** Promise that resolves when heavy initialization completes */
  whenReady(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * Factory method to create and initialize AgentService (full blocking init)
   * This ensures all async initialization completes before the service is used
   */
  static async create(dataDir: string, isDev: boolean = false): Promise<AgentService> {
    const service = new AgentService(dataDir, isDev);
    await service.initializeService();
    return service;
  }

  /**
   * Factory method for non-blocking initialization.
   * Returns immediately after Phase 1 (essential init: dirs, config, log level).
   * Call initializeHeavy() separately to complete Phase 2.
   */
  static async createFast(dataDir: string, isDev: boolean = false): Promise<AgentService> {
    const service = new AgentService(dataDir, isDev);
    await service.initializeEssentials();
    return service;
  }

  /**
   * Full initialization (blocking) - used by AgentService.create()
   */
  private async initializeService(): Promise<void> {
    await this.initializeEssentials();
    await this.initializeHeavy();
  }

  /**
   * Phase 1: Essential initialization (fast, ~100ms)
   * Only does what's needed before the window can appear.
   */
  private async initializeEssentials(): Promise<void> {
    await this.ensureDirectories();
    await this.loadConfig();
    this.initializeLogLevel();
    await this.initializeTokenStorage();
  }

  /**
   * Configure persistent token storage for OAuth connectors.
   * Generates an encryption key on first run and stores it locally.
   * Must run before any connectors are loaded so all OAuth connectors get FileStorage.
   */
  private async initializeTokenStorage(): Promise<void> {
    try {
      const tokenDir = join(this.dataDir, 'oauth-tokens');
      const keyFile = join(this.dataDir, '.encryption-key');

      // Load or generate encryption key
      let encryptionKey: string;
      try {
        encryptionKey = (await readFile(keyFile, 'utf-8')).trim();
      } catch {
        // First run: generate and persist key
        const { randomBytes } = await import('node:crypto');
        encryptionKey = randomBytes(32).toString('hex');
        await writeFile(keyFile, encryptionKey, { mode: 0o600 });
      }

      const storage = new FileStorage({ directory: tokenDir, encryptionKey });
      StorageRegistry.set('oauthTokens', storage);
      logger.debug('[initializeTokenStorage] Persistent OAuth token storage configured via StorageRegistry');
    } catch (error) {
      logger.warn('[initializeTokenStorage] Failed to configure persistent token storage, using in-memory:', String(error));
      // Fall back to default MemoryStorage — tokens won't persist across restarts
    }
  }

  /**
   * Phase 2: Heavy initialization (slow, ~20s)
   * Loads connectors, discovers tools, syncs profiles, loads agents.
   * Can be called after the window is visible.
   */
  async initializeHeavy(): Promise<void> {
    try {
      await this.loadConnectors();
      await this.loadUniversalConnectors();
      await this.migrateAPIConnectorsToUniversal();

      // Refresh tool catalog now that all connectors are registered with the library.
      logger.debug('[initializeHeavy] Invalidating tool caches after connector loading...');
      logger.debug(`[initializeHeavy] Connector.list() = ${JSON.stringify(Connector.list())}`);

      const discoveredBefore = ConnectorTools.discoverAll();
      logger.debug(`[initializeHeavy] ConnectorTools.discoverAll() BEFORE invalidation: ${discoveredBefore.size} connectors`);
      for (const [name, tools] of discoveredBefore) {
        logger.debug(`  connector=${name}: ${tools.length} tools [${tools.map(t => t.definition.function.name).join(', ')}]`);
      }

      ToolCatalogRegistry.reset();
      invalidateHoseaTools();

      const allTools = ToolRegistry.getAllTools();
      const connectorTools = allTools.filter(t => 'connectorName' in t);
      logger.info(`[initializeHeavy] After cache invalidation: ToolRegistry has ${allTools.length} total tools (${connectorTools.length} connector tools)`);
      for (const t of connectorTools) {
        logger.debug(`  tool=${t.name}, category=${t.category}, connectorServiceTypes=${JSON.stringify(t.connectorServiceTypes)}`);
      }

      await this.loadEWProfiles();
      this.checkTokenExpiry();

      // EW profile sync is non-critical — don't let it block startup.
      // Fire in background so agents, MCP servers, etc. load immediately.
      this.syncActiveEWProfile().catch(err => {
        logger.warn(`[initializeHeavy] EW profile sync failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      });

      await this.loadAgents();
      await this.migrateAgentsToNextGen();
      await this.loadMCPServers();

      // Initialize Ollama auto-detect + auto-start (non-blocking)
      if (this.ollamaService) {
        this.ollamaService.initialize().catch(err => {
          logger.warn(`[initializeHeavy] Ollama initialization failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      this._isReady = true;
      this._readyResolve();
      logger.info('[AgentService] Heavy initialization complete - service is ready');
    } catch (error) {
      // Still resolve the promise to prevent callers from hanging forever
      this._isReady = true;
      this._readyResolve();
      logger.error(`[AgentService] Heavy initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize log level based on config or dev mode
   */
  private initializeLogLevel(): void {
    // In dev mode, default to debug unless explicitly set otherwise
    const effectiveLevel = this.isDev && this.config.logLevel === 'info'
      ? 'debug'
      : this.config.logLevel;

    logger.updateConfig({ level: effectiveLevel });
    console.log(`Log level set to: ${effectiveLevel}${this.isDev ? ' (dev mode)' : ''}`);
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = ['connectors', 'api-connectors', 'universal-connectors', 'agents', 'sessions', 'logs', 'mcp-servers', 'oauth-tokens'];
    for (const dir of dirs) {
      const path = join(this.dataDir, dir);
      if (!existsSync(path)) {
        await mkdir(path, { recursive: true });
      }
    }
  }

  private async loadConfig(): Promise<void> {
    const configPath = join(this.dataDir, 'config.json');
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
      } catch {
        // Use defaults
      }
    }
  }

  private async saveConfigFile(): Promise<void> {
    const configPath = join(this.dataDir, 'config.json');
    await writeFile(configPath, JSON.stringify(this.config, null, 2));
  }

  private async loadConnectors(): Promise<void> {
    const connectorsDir = join(this.dataDir, 'connectors');
    logger.debug('[loadConnectors] Looking for connectors in:', connectorsDir);
    if (!existsSync(connectorsDir)) {
      logger.debug('[loadConnectors] Directory does not exist, skipping');
      return;
    }

    try {
      const files = await readdir(connectorsDir);
      logger.debug(`[loadConnectors] Found files: ${JSON.stringify(files)}`);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(join(connectorsDir, file), 'utf-8');
          const config = JSON.parse(content) as StoredConnectorConfig;
          this.connectors.set(config.name, config);
          logger.debug(`[loadConnectors] Loaded connector: name=${config.name}, vendor=${config.vendor}`);

          // Register with the library so ConnectorTools can discover vendor-based tools
          if (!Connector.has(config.name)) {
            Connector.create({
              name: config.name,
              vendor: config.vendor as Vendor,
              auth: config.auth,
              baseURL: config.baseURL,
            });
            logger.debug(`[loadConnectors] Registered with Connector library: ${config.name}`);
          } else {
            logger.debug(`[loadConnectors] Already registered in library: ${config.name}`);
          }
        }
      }
      logger.info(`[loadConnectors] Loaded ${this.connectors.size} LLM connectors. Library has ${Connector.list().length} total connectors: ${Connector.list().join(', ')}`);
    } catch (err) {
      logger.error(`[loadConnectors] Error loading connectors: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============ Everworker Backend Integration (Multi-Profile) ============

  /**
   * Set the main window sender for push events to the renderer
   */
  setMainWindowSender(sender: (channel: string, ...args: unknown[]) => void): void {
    this.mainWindowSender = sender;
  }

  private notifyRenderer(channel: string, ...args: unknown[]): void {
    if (this.mainWindowSender) {
      this.mainWindowSender(channel, ...args);
    }
  }

  /**
   * Load EW profiles with auto-migration from old format
   */
  private async loadEWProfiles(): Promise<void> {
    const newPath = join(this.dataDir, 'everworker-profiles.json');
    const oldPath = join(this.dataDir, 'everworker-backend.json');

    // 1. Try new format first
    if (existsSync(newPath)) {
      try {
        const content = await readFile(newPath, 'utf-8');
        this.ewProfiles = JSON.parse(content) as EverworkerProfilesConfig;
        logger.info(`[loadEWProfiles] Loaded ${this.ewProfiles.profiles.length} profiles (active: ${this.ewProfiles.activeProfileId})`);
        return;
      } catch (err) {
        logger.error(`[loadEWProfiles] Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Auto-migrate from old format
    if (existsSync(oldPath)) {
      try {
        const content = await readFile(oldPath, 'utf-8');
        const oldConfig = JSON.parse(content) as EverworkerBackendConfig;
        const profileId = `profile_${Date.now()}`;
        const profile: EverworkerProfile = {
          id: profileId,
          name: 'Default',
          url: oldConfig.url,
          token: oldConfig.token,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.ewProfiles = {
          version: 2,
          activeProfileId: oldConfig.enabled ? profileId : null,
          profiles: [profile],
        };
        await this.saveEWProfiles();

        // Rename old file
        const { rename } = await import('node:fs/promises');
        await rename(oldPath, `${oldPath}.migrated`);
        logger.info(`[loadEWProfiles] Migrated old config to profile "Default" (active: ${oldConfig.enabled})`);
        return;
      } catch (err) {
        logger.error(`[loadEWProfiles] Migration failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Initialize empty
    this.ewProfiles = { version: 2, activeProfileId: null, profiles: [] };
  }

  private async saveEWProfiles(): Promise<void> {
    const configPath = join(this.dataDir, 'everworker-profiles.json');
    await writeFile(configPath, JSON.stringify(this.ewProfiles, null, 2));
  }

  /**
   * Get the active EW profile, or null if disconnected
   */
  private getActiveEWProfile(): EverworkerProfile | null {
    if (!this.ewProfiles.activeProfileId) return null;
    return this.ewProfiles.profiles.find(p => p.id === this.ewProfiles.activeProfileId) ?? null;
  }

  // ---- Token Status ----

  /**
   * Check if a profile's token is expired or expiring soon.
   */
  getTokenStatus(profileId?: string): TokenStatus {
    const profile = profileId
      ? this.ewProfiles.profiles.find(p => p.id === profileId)
      : this.getActiveEWProfile();

    if (!profile) return { status: 'unknown' };
    if (!profile.tokenExpiresAt) return { status: 'unknown' }; // Manual token

    const now = Date.now();
    const msRemaining = profile.tokenExpiresAt - now;
    const daysRemaining = Math.max(0, Math.floor(msRemaining / (24 * 60 * 60 * 1000)));

    if (msRemaining <= 0) {
      return { status: 'expired', expiresAt: profile.tokenExpiresAt, daysRemaining: 0 };
    }
    if (daysRemaining <= 3) {
      return { status: 'expiring_soon', expiresAt: profile.tokenExpiresAt, daysRemaining };
    }
    return { status: 'valid', expiresAt: profile.tokenExpiresAt, daysRemaining };
  }

  /**
   * Check active profile token expiry and notify renderer if expiring/expired.
   */
  private checkTokenExpiry(): void {
    const active = this.getActiveEWProfile();
    if (!active?.tokenExpiresAt) return;

    const status = this.getTokenStatus();
    if (status.status === 'expiring_soon' || status.status === 'expired') {
      logger.warn(`[checkTokenExpiry] Active profile "${active.name}" token ${status.status} (${status.daysRemaining}d remaining)`);
      this.notifyRenderer('everworker:token-expiry', {
        profileId: active.id,
        status: status.status,
        daysRemaining: status.daysRemaining,
      });
    }
  }

  // ---- Profile CRUD ----

  getEWProfiles(): EverworkerProfilesConfig {
    return this.ewProfiles;
  }

  async addEWProfile(data: {
    name: string;
    url: string;
    token: string;
    tokenExpiresAt?: number;
    tokenIssuedAt?: number;
    userName?: string;
    userId?: string;
    authMethod?: 'manual' | 'browser-auth';
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const id = `profile_${Date.now()}`;
      const profile: EverworkerProfile = {
        id,
        name: data.name,
        url: data.url.replace(/\/+$/, ''),
        token: data.token,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(data.tokenExpiresAt !== undefined && { tokenExpiresAt: data.tokenExpiresAt }),
        ...(data.tokenIssuedAt !== undefined && { tokenIssuedAt: data.tokenIssuedAt }),
        ...(data.userName !== undefined && { userName: data.userName }),
        ...(data.userId !== undefined && { userId: data.userId }),
        ...(data.authMethod !== undefined && { authMethod: data.authMethod }),
      };
      this.ewProfiles.profiles.push(profile);
      await this.saveEWProfiles();
      logger.info(`[addEWProfile] Added profile "${data.name}" (${id})`);
      return { success: true, id };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async updateEWProfile(id: string, updates: {
    name?: string;
    url?: string;
    token?: string;
    tokenExpiresAt?: number;
    tokenIssuedAt?: number;
    userName?: string;
    userId?: string;
    authMethod?: 'manual' | 'browser-auth';
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const profile = this.ewProfiles.profiles.find(p => p.id === id);
      if (!profile) return { success: false, error: 'Profile not found' };

      if (updates.name !== undefined) profile.name = updates.name;
      if (updates.url !== undefined) profile.url = updates.url.replace(/\/+$/, '');
      if (updates.token !== undefined) profile.token = updates.token;
      if (updates.tokenExpiresAt !== undefined) profile.tokenExpiresAt = updates.tokenExpiresAt;
      if (updates.tokenIssuedAt !== undefined) profile.tokenIssuedAt = updates.tokenIssuedAt;
      if (updates.userName !== undefined) profile.userName = updates.userName;
      if (updates.userId !== undefined) profile.userId = updates.userId;
      if (updates.authMethod !== undefined) profile.authMethod = updates.authMethod;
      profile.updatedAt = Date.now();

      await this.saveEWProfiles();
      logger.info(`[updateEWProfile] Updated profile "${profile.name}" (${id})`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async deleteEWProfile(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idx = this.ewProfiles.profiles.findIndex(p => p.id === id);
      if (idx === -1) return { success: false, error: 'Profile not found' };

      const wasActive = this.ewProfiles.activeProfileId === id;
      this.ewProfiles.profiles.splice(idx, 1);

      if (wasActive) {
        this.ewProfiles.activeProfileId = null;
        await this.saveEWProfiles();
        await this.purgeAllEWConnectors();
        this.notifyRenderer('everworker:connectors-changed', { profileId: null, added: 0, removed: 0 });
      } else {
        await this.saveEWProfiles();
      }

      logger.info(`[deleteEWProfile] Deleted profile ${id} (wasActive: ${wasActive})`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ---- Core switch + sync ----

  /**
   * Switch the active EW profile. Purges old connectors and syncs new ones live.
   */
  async switchEWProfile(profileId: string | null): Promise<{ success: boolean; added?: number; removed?: number; error?: string }> {
    try {
      // Count how many EW connectors existed before purge
      let removedCount = 0;
      for (const config of this.connectors.values()) {
        if (config.source === 'everworker') removedCount++;
      }
      for (const config of this.universalConnectors.values()) {
        if (config.source === 'everworker') removedCount++;
      }

      this.ewProfiles.activeProfileId = profileId;
      await this.saveEWProfiles();

      // Purge old connectors
      await this.purgeAllEWConnectors();

      let addedCount = 0;
      if (profileId) {
        // Sync new profile's connectors
        const syncResult = await this.syncActiveEWProfile();
        if (!syncResult.success) {
          return { success: false, added: 0, removed: removedCount, error: syncResult.error };
        }
        addedCount = syncResult.added;
      }

      // Invalidate tool caches
      ToolCatalogRegistry.reset();
      invalidateHoseaTools();

      // Notify renderer
      this.notifyRenderer('everworker:connectors-changed', { profileId, added: addedCount, removed: removedCount });

      logger.info(`[switchEWProfile] Switched to profile ${profileId}: ${addedCount} added, ${removedCount} removed`);
      return { success: true, added: addedCount, removed: removedCount };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Purge all EW-sourced connectors from memory, disk, and the library registry
   */
  private async purgeAllEWConnectors(): Promise<void> {
    const { unlink } = await import('node:fs/promises');

    for (const [name, config] of [...this.connectors.entries()]) {
      if (config.source === 'everworker') {
        this.connectors.delete(name);
        if (Connector.has(name)) Connector.remove(name);
        const filePath = join(this.dataDir, 'connectors', `${name}.json`);
        if (existsSync(filePath)) await unlink(filePath);
      }
    }

    for (const [name, config] of [...this.universalConnectors.entries()]) {
      if (config.source === 'everworker') {
        this.universalConnectors.delete(name);
        if (Connector.has(name)) Connector.remove(name);
        const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
        if (existsSync(filePath)) await unlink(filePath);
      }
    }

    logger.debug('[purgeAllEWConnectors] All EW connectors purged');
  }

  /**
   * Test connection for a specific profile
   */
  async testEWProfileConnection(id: string): Promise<{ success: boolean; connectorCount?: number; error?: string }> {
    const profile = this.ewProfiles.profiles.find(p => p.id === id);
    if (!profile) return { success: false, error: 'Profile not found' };

    try {
      const url = `${profile.url}/api/v1/proxy/connectors`;
      logger.info(`[testEWProfileConnection] Testing connection to ${url}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${profile.token}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        const text = await response.text();
        logger.error(`[testEWProfileConnection] HTTP ${response.status}: ${text}`);
        return { success: false, error: `HTTP ${response.status}: ${text}` };
      }
      const data = await response.json() as { connectors: EWRemoteConnector[] };
      const count = data.connectors?.length ?? 0;
      logger.info(`[testEWProfileConnection] Success: ${count} connectors available`);
      return { success: true, connectorCount: count };
    } catch (error) {
      logger.error(`[testEWProfileConnection] Error: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Sync connectors for the active EW profile.
   * Replaces the old syncEWConnectors method.
   */
  async syncActiveEWProfile(): Promise<{ success: boolean; added: number; updated: number; removed: number; error?: string }> {
    const activeProfile = this.getActiveEWProfile();
    if (!activeProfile) {
      return { success: true, added: 0, updated: 0, removed: 0 };
    }

    // Check token expiry before attempting sync
    const tokenStatus = this.getTokenStatus();
    if (tokenStatus.status === 'expired') {
      return { success: false, added: 0, updated: 0, removed: 0, error: 'Token expired. Please re-authenticate with EverWorker.' };
    }

    try {
      const url = `${activeProfile.url}/api/v1/proxy/connectors`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${activeProfile.token}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        const text = await response.text();
        logger.error(`[syncActiveEWProfile] Discovery endpoint returned HTTP ${response.status}: ${text}`);
        return { success: false, added: 0, updated: 0, removed: 0, error: `HTTP ${response.status}: ${text}` };
      }

      const data = await response.json() as { connectors: EWRemoteConnector[] };
      const remoteConnectors = data.connectors ?? [];

      let added = 0;
      let updated = 0;
      let removed = 0;

      // ---- Phase 1: Purge ALL existing EW-sourced entries from both stores ----
      const previousEWNames = new Set<string>();
      const { unlink } = await import('node:fs/promises');

      for (const [name, config] of [...this.connectors.entries()]) {
        if (config.source === 'everworker') {
          previousEWNames.add(name);
          this.connectors.delete(name);
          if (Connector.has(name)) Connector.remove(name);
          const filePath = join(this.dataDir, 'connectors', `${name}.json`);
          if (existsSync(filePath)) await unlink(filePath);
        }
      }

      for (const [name, config] of [...this.universalConnectors.entries()]) {
        if (config.source === 'everworker') {
          previousEWNames.add(name);
          this.universalConnectors.delete(name);
          if (Connector.has(name)) Connector.remove(name);
          const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
          if (existsSync(filePath)) await unlink(filePath);
        }
      }

      logger.debug(`[syncActiveEWProfile] Purged ${previousEWNames.size} previous EW entries, re-adding ${remoteConnectors.length} from server`);

      // ---- Phase 2: Re-add all remote connectors into the correct store ----
      for (const remote of remoteConnectors) {
        const proxyBaseURL = `${activeProfile.url}/api/v1/proxy/${remote.name}`;
        const isLLM = remote.type === 'llm' || (remote.type === undefined && isVendor(remote.vendor));
        const wasKnown = previousEWNames.has(remote.name);

        if (isLLM) {
          const localExisting = this.connectors.get(remote.name);
          if (localExisting) {
            logger.debug(`[syncActiveEWProfile] Skipping LLM "${remote.name}" - local connector exists`);
            continue;
          }

          const config: StoredConnectorConfig = {
            name: remote.name,
            vendor: remote.vendor,
            auth: { type: 'api_key', apiKey: activeProfile.token },
            baseURL: proxyBaseURL,
            models: remote.models,
            source: 'everworker',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          this.connectors.set(remote.name, config);
          const filePath = join(this.dataDir, 'connectors', `${remote.name}.json`);
          await writeFile(filePath, JSON.stringify(config, null, 2));

          if (Connector.has(remote.name)) Connector.remove(remote.name);
          Connector.create({
            name: remote.name,
            vendor: remote.vendor as Vendor,
            auth: config.auth,
            baseURL: config.baseURL,
          });

          if (wasKnown) updated++; else added++;
          logger.debug(`[syncActiveEWProfile] Synced LLM connector: ${remote.name} (vendor: ${remote.vendor})`);
        } else {
          const localExisting = this.universalConnectors.get(remote.name);
          if (localExisting) {
            logger.debug(`[syncActiveEWProfile] Skipping universal "${remote.name}" - local connector exists`);
            continue;
          }

          const config: StoredUniversalConnector = {
            name: remote.name,
            vendorId: remote.vendor || remote.serviceType || remote.name,
            vendorName: remote.name,
            authMethodId: 'ew-proxy',
            authMethodName: 'Everworker Proxy',
            credentials: {},
            baseURL: proxyBaseURL,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active',
            source: 'everworker',
          };

          this.universalConnectors.set(remote.name, config);
          const filePath = join(this.dataDir, 'universal-connectors', `${remote.name}.json`);
          await writeFile(filePath, JSON.stringify(config, null, 2));

          if (Connector.has(remote.name)) Connector.remove(remote.name);
          Connector.create({
            name: remote.name,
            serviceType: remote.serviceType,
            auth: { type: 'api_key', apiKey: activeProfile.token },
            baseURL: proxyBaseURL,
          });

          if (wasKnown) updated++; else added++;
          logger.debug(`[syncActiveEWProfile] Synced universal connector: ${remote.name} (vendor: ${remote.vendor})`);
        }
      }

      // ---- Phase 3: Count removals ----
      const remoteNames = new Set(remoteConnectors.map(c => c.name));
      for (const name of previousEWNames) {
        if (!remoteNames.has(name)) {
          removed++;
          logger.info(`[syncActiveEWProfile] Removed EW connector no longer on server: ${name}`);
        }
      }

      // Update profile sync metadata
      activeProfile.lastSyncedAt = Date.now();
      activeProfile.lastSyncConnectorCount = remoteConnectors.length;
      await this.saveEWProfiles();

      // Invalidate tool caches after sync
      ToolCatalogRegistry.reset();
      invalidateHoseaTools();

      logger.info(`[syncActiveEWProfile] Sync complete: ${added} added, ${updated} updated, ${removed} removed, ${remoteConnectors.length} total remote`);
      return { success: true, added, updated, removed };
    } catch (error) {
      logger.error(`[syncActiveEWProfile] Error: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, added: 0, updated: 0, removed: 0, error: String(error) };
    }
  }

  // ---- Legacy compatibility wrappers ----

  /** @deprecated Use getEWProfiles() and getActiveEWProfile() instead */
  getEWConfig(): EverworkerBackendConfig | null {
    const active = this.getActiveEWProfile();
    if (!active) return null;
    return { url: active.url, token: active.token, enabled: true };
  }

  /** @deprecated Use addEWProfile() or updateEWProfile() + switchEWProfile() instead */
  async setEWConfig(config: EverworkerBackendConfig): Promise<{ success: boolean; error?: string }> {
    try {
      // If no profiles exist, create one
      if (this.ewProfiles.profiles.length === 0) {
        const result = await this.addEWProfile({ name: 'Default', url: config.url, token: config.token });
        if (result.success && config.enabled && result.id) {
          this.ewProfiles.activeProfileId = result.id;
          await this.saveEWProfiles();
        }
      } else {
        // Update the first profile
        const first = this.ewProfiles.profiles[0];
        first.url = config.url.replace(/\/+$/, '');
        first.token = config.token;
        first.updatedAt = Date.now();
        this.ewProfiles.activeProfileId = config.enabled ? first.id : null;
        await this.saveEWProfiles();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /** @deprecated Use testEWProfileConnection() instead */
  async testEWConnection(): Promise<{ success: boolean; connectorCount?: number; error?: string }> {
    const active = this.getActiveEWProfile();
    if (!active) return { success: false, error: 'Everworker backend not configured or disabled' };
    return this.testEWProfileConnection(active.id);
  }

  /** @deprecated Use syncActiveEWProfile() instead */
  async syncEWConnectors(): Promise<{ success: boolean; added: number; updated: number; removed: number; error?: string }> {
    return this.syncActiveEWProfile();
  }

  private async loadAgents(): Promise<void> {
    try {
      // First, check for legacy agents in old format and migrate them
      await this.migrateLegacyAgents();

      // Load agents from the library's storage
      const summaries = await this.agentDefinitionStorage.list();
      for (const summary of summaries) {
        const definition = await this.agentDefinitionStorage.load(summary.agentId);
        if (definition) {
          const config = this.fromStoredDefinition(definition);
          this.agents.set(config.id, config);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Migrate legacy agents from old format (direct JSON files) to new storage
   */
  private async migrateLegacyAgents(): Promise<void> {
    const legacyAgentsDir = join(this.dataDir, 'agents');
    if (!existsSync(legacyAgentsDir)) return;

    try {
      const files = await readdir(legacyAgentsDir);
      for (const file of files) {
        // Skip non-JSON files and index files
        if (!file.endsWith('.json') || file.startsWith('_')) continue;

        const filePath = join(legacyAgentsDir, file);
        const content = await readFile(filePath, 'utf-8');
        const legacyConfig = JSON.parse(content) as StoredAgentConfig;

        // Check if this agent already exists in new storage
        const exists = await this.agentDefinitionStorage.exists(legacyConfig.id);
        if (!exists) {
          // Migrate to new storage
          const definition = this.toStoredDefinition(legacyConfig);
          await this.agentDefinitionStorage.save(definition);
          console.log(`Migrated legacy agent: ${legacyConfig.name} (${legacyConfig.id})`);
        }

        // Delete the legacy file after successful migration
        const { unlink } = await import('node:fs/promises');
        await unlink(filePath);
        console.log(`Deleted legacy agent file: ${file}`);
      }
    } catch (error) {
      console.warn('Error migrating legacy agents:', error);
    }
  }

  /**
   * Migrate existing agents to NextGen format:
   * - Convert all agent types to 'basic'
   * - Migrate legacy strategies not in StrategyRegistry (aggressive→proactive, rolling-window→lazy, adaptive→balanced)
   * - Rename memoryEnabled to workingMemoryEnabled (if needed)
   *
   * Note: Valid strategies from StrategyRegistry are preserved as-is. Only truly legacy
   * strategies that don't exist in the registry are migrated.
   */
  private async migrateAgentsToNextGen(): Promise<void> {
    try {
      for (const [id, config] of this.agents.entries()) {
        let needsSave = false;
        const updates: Partial<StoredAgentConfig> = {};

        // Convert agent type to 'basic' if it was something else
        if (config.agentType !== 'basic') {
          updates.agentType = 'basic';
          needsSave = true;
          console.log(`NextGen migration: Converted agent "${config.name}" from "${config.agentType}" to "basic"`);
        }

        // Validate strategy exists in registry - only migrate if truly invalid
        const { strategy: validatedStrategy, isValid } = validateStrategy(config.contextStrategy);
        if (!isValid) {
          // Map legacy strategies to reasonable NextGen equivalents
          const legacyMapping: Record<string, string> = {
            'aggressive': 'proactive',
            'rolling-window': 'lazy',
            'adaptive': 'balanced',
          };
          const mappedStrategy = legacyMapping[config.contextStrategy] ?? 'algorithmic';
          updates.contextStrategy = mappedStrategy;
          needsSave = true;
          console.log(`NextGen migration: Converted agent "${config.name}" strategy from "${config.contextStrategy}" to "${mappedStrategy}" (original strategy not found in registry)`);
        }

        // Handle legacy memoryEnabled field if present (backwards compatibility)
        const legacyConfig = config as unknown as Record<string, unknown>;
        if ('memoryEnabled' in legacyConfig && !('workingMemoryEnabled' in legacyConfig)) {
          updates.workingMemoryEnabled = legacyConfig.memoryEnabled as boolean;
          needsSave = true;
          console.log(`NextGen migration: Renamed memoryEnabled to workingMemoryEnabled for agent "${config.name}"`);
        }

        // Save if any changes were made
        if (needsSave) {
          const updatedConfig = { ...config, ...updates, updatedAt: Date.now() };
          this.agents.set(id, updatedConfig);
          // Persist to storage
          const definition = this.toStoredDefinition(updatedConfig);
          await this.agentDefinitionStorage.save(definition);
        }
      }
    } catch (error) {
      console.warn('Error during NextGen agent migration:', error);
    }
  }

  /**
   * Subscribe to context events for monitoring (compaction, budget updates)
   */
  private subscribeToContextEvents(agent: Agent, instanceId: string): void {
    const ctx = agent.context;
    if (!ctx) return;

    // Initialize compaction log for this instance
    if (!this.compactionLogs.has(instanceId)) {
      this.compactionLogs.set(instanceId, []);
    }
    const log = this.compactionLogs.get(instanceId)!;

    // Subscribe to compaction:starting event
    ctx.on('compaction:starting', ({ timestamp, targetTokensToFree }) => {
      log.push({
        timestamp,
        tokensToFree: targetTokensToFree,
        message: `Compaction starting: need to free ~${targetTokensToFree} tokens`,
      });
      // Keep only last N entries
      while (log.length > this.MAX_COMPACTION_LOG_ENTRIES) {
        log.shift();
      }
    });

    // Subscribe to context:compacted event
    ctx.on('context:compacted', ({ tokensFreed, log: compactionLog }) => {
      log.push({
        timestamp: Date.now(),
        tokensToFree: tokensFreed,
        message: `Compaction complete: freed ${tokensFreed} tokens`,
      });
      // Keep only last N entries
      while (log.length > this.MAX_COMPACTION_LOG_ENTRIES) {
        log.shift();
      }
    });
  }

  async initialize(connectorName: string, model: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get connector config
      const connectorConfig = this.connectors.get(connectorName);
      if (!connectorConfig) {
        return { success: false, error: `Connector "${connectorName}" not found` };
      }

      // Register with library if not already
      if (!Connector.has(connectorName)) {
        Connector.create({
          name: connectorName,
          vendor: connectorConfig.vendor as Vendor,
          auth: connectorConfig.auth,
          baseURL: connectorConfig.baseURL,
        });
      }

      // Destroy existing agent
      this.agent?.destroy();

      // Resolve session storage from StorageRegistry (uses factory configured in initializeStorageRegistry)
      this.sessionStorage = this.createSessionStorage('hosea');

      // Create agent with UI capabilities prompt (NextGen)
      const agentConfig: AgentConfig = {
        connector: connectorName,
        model,
        instructions: HOSEA_UI_CAPABILITIES_PROMPT,
        context: {
          model,
          storage: this.sessionStorage,
        },
      };

      this.agent = Agent.create(agentConfig);

      // Subscribe to context events for monitoring
      this.subscribeToContextEvents(this.agent, 'default');

      // Update config
      this.config.activeConnector = connectorName;
      this.config.activeModel = model;
      await this.saveConfigFile();

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async send(message: string): Promise<{ success: boolean; response?: string; error?: string }> {
    if (!this.agent) {
      return { success: false, error: 'Agent not initialized' };
    }

    try {
      // NextGen uses run() instead of chat()
      const response = await this.agent.run(message);
      return { success: true, response: response.output_text || '' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async *stream(message: string): AsyncGenerator<StreamChunk> {
    if (!this.agent) {
      yield { type: 'error', content: 'Agent not initialized' };
      return;
    }

    // Track when we're in plan creation mode to suppress text output
    // (since we show structured PlanDisplay instead of plain text)
    let suppressText = false;

    try {
      for await (const event of this.agent.stream(message)) {
        // Cast through unknown to any for flexible event handling
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = event as any;

        // Detect plan mode transitions to control text suppression
        if (e.type === 'plan:analyzing' || e.type === 'plan:created') {
          suppressText = true;
        } else if (e.type === 'plan:approved' || e.type === 'mode:changed') {
          // Resume text when plan is approved or mode changes
          if (e.type === 'mode:changed' && e.to === 'executing') {
            // Keep suppressing during execution - task events will show progress
          } else if (e.type === 'mode:changed' && e.to === 'interactive') {
            suppressText = false;
          } else if (e.type === 'plan:approved') {
            // Suppress during execution, resume when we get results
          }
        } else if (e.type === 'execution:done') {
          // Resume text after execution completes
          suppressText = false;
        }

        if (e.type === 'text:delta') {
          // Only forward text if we're not in plan mode
          if (!suppressText) {
            yield { type: 'text', content: String(e.delta || '') };
          }
        } else if (e.type === 'tool:start') {
          // Get tool description using describeCall or defaultDescribeCall
          const args = (e.args || {}) as Record<string, unknown>;
          const toolName = String(e.name || 'unknown');
          const tool = this.agent?.tools?.get(toolName);
          let description = '';
          if (tool?.describeCall) {
            try {
              description = tool.describeCall(args);
            } catch {
              description = defaultDescribeCall(args);
            }
          } else {
            description = defaultDescribeCall(args);
          }

          yield {
            type: 'tool_start',
            tool: toolName,
            args,
            description,
          };
        } else if (e.type === 'tool:complete' || e.type === 'response.tool_execution.done') {
          const toolName = String(e.name || e.tool_name || 'unknown');
          const durationMs = typeof e.durationMs === 'number' ? e.durationMs : (typeof e.execution_time_ms === 'number' ? e.execution_time_ms : undefined);
          if (e.error) {
            yield {
              type: 'tool_error',
              tool: toolName,
              error: String(e.error),
              result: e.result,
            };
          } else {
            yield {
              type: 'tool_end',
              tool: toolName,
              durationMs,
              result: e.result,
            };
          }
        } else if (e.type === 'tool:error') {
          yield {
            type: 'tool_error',
            tool: String(e.name || 'unknown'),
            error: String(e.error || 'Unknown error'),
          };
        } else if (e.type === 'text:done') {
          yield { type: 'done' };
        } else if (e.type === 'error') {
          yield { type: 'error', content: String(e.error || e.message || 'Unknown error') };
        }
        // Plan events (legacy - may not be emitted in NextGen)
        else if (e.type === 'plan:created') {
          yield { type: 'plan:created', plan: this.serializePlan((e as any).plan) };
        } else if (e.type === 'plan:awaiting_approval') {
          yield { type: 'plan:awaiting_approval', plan: this.serializePlan((e as any).plan) };
        } else if (e.type === 'plan:approved') {
          yield { type: 'plan:approved', plan: this.serializePlan((e as any).plan) };
        } else if (e.type === 'plan:analyzing') {
          yield { type: 'plan:analyzing', goal: (e as any).goal };
        } else if (e.type === 'mode:changed') {
          yield { type: 'mode:changed', from: (e as any).from, to: (e as any).to, reason: (e as any).reason };
        } else if (e.type === 'needs:approval') {
          yield { type: 'needs:approval', plan: this.serializePlan((e as any).plan) };
        }
        // Task events
        else if (e.type === 'task:started') {
          yield { type: 'task:started', task: this.serializeTask((e as any).task) };
        } else if (e.type === 'task:progress') {
          yield { type: 'task:progress', task: this.serializeTask((e as any).task), status: (e as any).status };
        } else if (e.type === 'task:completed') {
          yield { type: 'task:completed', task: this.serializeTask((e as any).task), result: (e as any).result };
        } else if (e.type === 'task:failed') {
          yield { type: 'task:failed', task: this.serializeTask((e as any).task), error: (e as any).error };
        }
        // Execution events
        else if (e.type === 'execution:done') {
          yield { type: 'execution:done', result: (e as any).result };
        } else if (e.type === 'execution:paused') {
          yield { type: 'execution:paused', reason: (e as any).reason };
        }
      }
    } catch (error) {
      yield { type: 'error', content: String(error) };
    }
  }

  /**
   * Serialize a Plan for IPC transfer
   */
  private serializePlan(plan: any): Plan {
    return {
      id: plan.id,
      goal: plan.goal,
      context: plan.context,
      tasks: plan.tasks?.map((t: any) => this.serializeTask(t)) || [],
      status: plan.status,
      createdAt: plan.createdAt,
      startedAt: plan.startedAt,
      completedAt: plan.completedAt,
    };
  }

  /**
   * Serialize a Task for IPC transfer
   */
  private serializeTask(task: any): PlanTask {
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      status: task.status,
      dependsOn: task.dependsOn || [],
      validation: task.validation ? {
        completionCriteria: task.validation.completionCriteria,
      } : undefined,
      result: task.result,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  /**
   * Approve the current pending plan
   */
  async approvePlan(_planId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.agent) {
      return { success: false, error: 'Agent not initialized' };
    }
    // Agent accepts approval via stream - send approval message
    // This will be picked up by the agent's intent analysis as an approval
    try {
      // Return success - the actual approval happens via stream when user sends approval message
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Reject the current pending plan
   */
  async rejectPlan(_planId: string, _reason?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.agent) {
      return { success: false, error: 'Agent not initialized' };
    }
    try {
      // Return success - the actual rejection happens via stream when user sends rejection message
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  cancel(): { success: boolean } {
    if (this.agent) {
      this.agent.cancel();
    }
    return { success: true };
  }

  getStatus(): {
    initialized: boolean;
    connector: string | null;
    model: string | null;
    mode: string | null;
  } {
    return {
      initialized: this.agent !== null,
      connector: this.config.activeConnector,
      model: this.config.activeModel,
      // Mode concept removed in NextGen (was UniversalAgent-specific)
      mode: null,
    };
  }

  listConnectors(): StoredConnectorConfig[] {
    return Array.from(this.connectors.values());
  }

  async addConnector(config: unknown): Promise<{ success: boolean; error?: string }> {
    try {
      const connectorConfig = config as StoredConnectorConfig;
      connectorConfig.createdAt = Date.now();
      connectorConfig.updatedAt = Date.now();

      this.connectors.set(connectorConfig.name, connectorConfig);

      // Save to file
      const filePath = join(this.dataDir, 'connectors', `${connectorConfig.name}.json`);
      await writeFile(filePath, JSON.stringify(connectorConfig, null, 2));

      // Register with the Connector library so it's immediately usable
      if (Connector.has(connectorConfig.name)) Connector.remove(connectorConfig.name);
      Connector.create({
        name: connectorConfig.name,
        vendor: connectorConfig.vendor as Vendor,
        auth: connectorConfig.auth,
        baseURL: connectorConfig.baseURL,
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async deleteConnector(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.connectors.has(name)) {
        return { success: false, error: `Connector "${name}" not found` };
      }

      this.connectors.delete(name);

      // Remove from library
      if (Connector.has(name)) {
        Connector.remove(name);
      }

      // Delete file
      const filePath = join(this.dataDir, 'connectors', `${name}.json`);
      if (existsSync(filePath)) {
        const { unlink } = await import('node:fs/promises');
        await unlink(filePath);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async updateConnector(
    name: string,
    updates: { apiKey?: string; baseURL?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const existing = this.connectors.get(name);
      if (!existing) {
        return { success: false, error: `Connector "${name}" not found` };
      }

      if (updates.apiKey !== undefined) {
        existing.auth = { type: 'api_key', apiKey: updates.apiKey };
      }
      if (updates.baseURL !== undefined) {
        existing.baseURL = updates.baseURL || undefined;
      }
      existing.updatedAt = Date.now();

      this.connectors.set(name, existing);

      // Save to file
      const filePath = join(this.dataDir, 'connectors', `${name}.json`);
      await writeFile(filePath, JSON.stringify(existing, null, 2));

      // Re-register with library
      if (Connector.has(name)) Connector.remove(name);
      Connector.create({
        name,
        vendor: existing.vendor as Vendor,
        auth: existing.auth,
        baseURL: existing.baseURL,
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async fetchAvailableModels(
    vendor: string,
    apiKey?: string,
    baseURL?: string,
    existingConnectorName?: string
  ): Promise<{ success: boolean; models?: string[]; error?: string }> {
    // If no new API key and an existing connector is registered, use it directly
    if (!apiKey && existingConnectorName && Connector.has(existingConnectorName)) {
      try {
        const connector = Connector.get(existingConnectorName);
        const provider = createProvider(connector);
        const models = await provider.listModels();
        return { success: true, models };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const tempName = `__temp_fetch_models_${Date.now()}`;
    try {
      const auth = apiKey
        ? { type: 'api_key' as const, apiKey }
        : { type: 'none' as const };

      Connector.create({
        name: tempName,
        vendor: vendor as Vendor,
        auth,
        baseURL: baseURL || undefined,
      });

      const connector = Connector.get(tempName);
      const provider = createProvider(connector);
      const models = await provider.listModels();

      return { success: true, models };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (Connector.has(tempName)) Connector.remove(tempName);
    }
  }

  // ============ Universal Connectors (Vendor Templates) ============

  /**
   * Load universal connectors from storage
   */
  private async loadUniversalConnectors(): Promise<void> {
    const universalConnectorsDir = join(this.dataDir, 'universal-connectors');
    if (!existsSync(universalConnectorsDir)) return;

    try {
      const files = await readdir(universalConnectorsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(join(universalConnectorsDir, file), 'utf-8');
          const config = JSON.parse(content) as StoredUniversalConnector;
          this.universalConnectors.set(config.name, config);

          // For OAuth authorization_code connectors: set default redirectUri if not already stored
          const authTemplate = getVendorAuthTemplate(config.vendorId, config.authMethodId);
          if (authTemplate?.type === 'oauth' && authTemplate.flow === 'authorization_code') {
            if (!config.credentials.redirectUri) {
              config.credentials.redirectUri = OAuthCallbackServer.redirectUri;
            }
          }

          // Register with the library using createConnectorFromTemplate
          if (!Connector.has(config.name)) {
            try {
              createConnectorFromTemplate(
                config.name,
                config.vendorId,
                config.authMethodId,
                config.credentials,
                { baseURL: config.baseURL, displayName: config.displayName }
              );
            } catch (error) {
              console.warn(`Failed to register universal connector ${config.name}:`, error);
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Migrate existing API connectors to universal connectors format
   */
  private async migrateAPIConnectorsToUniversal(): Promise<void> {
    // Legacy type shape (inlined since StoredAPIConnectorConfig was removed)
    interface LegacyAPIConnectorConfig {
      name: string;
      serviceType: string;
      displayName?: string;
      auth: { type: 'api_key'; apiKey: string; headerName?: string; headerPrefix?: string };
      baseURL?: string;
      createdAt: number;
      updatedAt: number;
    }

    // Map old serviceType to vendor template IDs
    const LEGACY_SERVICE_MAP: Record<string, { vendorId: string; authMethodId: string }> = {
      'serper': { vendorId: 'serper', authMethodId: 'api-key' },
      'brave-search': { vendorId: 'brave-search', authMethodId: 'api-key' },
      'tavily': { vendorId: 'tavily', authMethodId: 'api-key' },
      'rapidapi-websearch': { vendorId: 'rapidapi', authMethodId: 'api-key' },
      'zenrows': { vendorId: 'zenrows', authMethodId: 'api-key' },
    };

    const apiConnectorsDir = join(this.dataDir, 'api-connectors');
    if (!existsSync(apiConnectorsDir)) return;

    try {
      const files = await readdir(apiConnectorsDir);
      for (const file of files) {
        // Skip already-migrated files
        if (!file.endsWith('.json') || file.endsWith('.migrated.json')) continue;

        const filePath = join(apiConnectorsDir, file);
        const content = await readFile(filePath, 'utf-8');
        const apiConfig = JSON.parse(content) as LegacyAPIConnectorConfig;

        const mapping = LEGACY_SERVICE_MAP[apiConfig.serviceType];
        if (!mapping) {
          console.warn(`No migration mapping for service type: ${apiConfig.serviceType}`);
          continue;
        }

        // Check if already migrated (universal connector exists)
        if (this.universalConnectors.has(apiConfig.name)) {
          continue;
        }

        // Get vendor info
        const vendorInfo = getVendorInfo(mapping.vendorId);
        const authMethod = getVendorAuthTemplate(mapping.vendorId, mapping.authMethodId);

        if (!vendorInfo || !authMethod) {
          console.warn(`Vendor template not found for: ${mapping.vendorId}/${mapping.authMethodId}`);
          continue;
        }

        // Create universal connector
        const universalConfig: StoredUniversalConnector = {
          name: apiConfig.name,
          vendorId: mapping.vendorId,
          vendorName: vendorInfo.name,
          authMethodId: mapping.authMethodId,
          authMethodName: authMethod.name,
          credentials: { apiKey: apiConfig.auth.apiKey },
          displayName: apiConfig.displayName,
          baseURL: apiConfig.baseURL,
          createdAt: apiConfig.createdAt,
          updatedAt: Date.now(),
          status: 'active',
          legacyServiceType: apiConfig.serviceType,
        };

        // Save universal connector
        this.universalConnectors.set(universalConfig.name, universalConfig);
        const universalPath = join(this.dataDir, 'universal-connectors', `${universalConfig.name}.json`);
        await writeFile(universalPath, JSON.stringify(universalConfig, null, 2));

        // Register with library
        try {
          createConnectorFromTemplate(
            universalConfig.name,
            universalConfig.vendorId,
            universalConfig.authMethodId,
            universalConfig.credentials,
            { baseURL: universalConfig.baseURL, displayName: universalConfig.displayName }
          );
        } catch (error) {
          console.warn(`Failed to register migrated connector ${universalConfig.name}:`, error);
        }

        // Rename old file to .migrated.json
        const { rename } = await import('node:fs/promises');
        await rename(filePath, filePath.replace('.json', '.migrated.json'));
        console.log(`Migrated API connector: ${apiConfig.name}`);
      }
    } catch (error) {
      console.warn('Error migrating API connectors:', error);
    }
  }

  // ============ Vendor Template Access (read-only from library) ============

  /**
   * List all vendor templates
   */
  listVendorTemplates(): VendorInfo[] {
    return listVendorTemplates();
  }

  /**
   * Get vendor template by ID
   */
  getVendorTemplateById(vendorId: string): VendorInfo | undefined {
    return getVendorInfo(vendorId);
  }

  /**
   * Get full vendor template (with auth templates)
   */
  getFullVendorTemplate(vendorId: string): VendorTemplate | undefined {
    return getVendorTemplate(vendorId);
  }

  /**
   * Get vendor logo
   */
  getVendorLogoById(vendorId: string): VendorLogo | undefined {
    return getVendorLogo(vendorId);
  }

  /**
   * Get all unique vendor categories
   */
  getVendorCategories(): string[] {
    const templates = listVendorTemplates();
    return [...new Set(templates.map(t => t.category))].sort();
  }

  /**
   * Get vendors by category
   */
  getVendorsByCategory(category: string): VendorInfo[] {
    return listVendorsByCategory(category);
  }

  // ============ Universal Connector CRUD ============

  /**
   * List all universal connectors
   */
  listUniversalConnectors(): StoredUniversalConnector[] {
    return Array.from(this.universalConnectors.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get universal connector by name
   */
  getUniversalConnector(name: string): StoredUniversalConnector | null {
    return this.universalConnectors.get(name) || null;
  }

  /**
   * Create a universal connector from vendor template
   */
  async createUniversalConnector(input: CreateUniversalConnectorInput): Promise<{ success: boolean; error?: string; needsAuth?: boolean; flow?: string }> {
    try {
      // Validate vendor template exists
      const vendorInfo = getVendorInfo(input.vendorId);
      if (!vendorInfo) {
        return { success: false, error: `Unknown vendor: ${input.vendorId}` };
      }

      const authMethod = getVendorAuthTemplate(input.vendorId, input.authMethodId);
      if (!authMethod) {
        return { success: false, error: `Unknown auth method: ${input.authMethodId} for vendor ${input.vendorId}` };
      }

      // Check for duplicate name
      if (this.universalConnectors.has(input.name) || Connector.has(input.name)) {
        return { success: false, error: `Connector "${input.name}" already exists` };
      }

      // For authorization_code OAuth: set default redirectUri if not already provided
      const credentials = { ...input.credentials };
      if (authMethod.type === 'oauth' && authMethod.flow === 'authorization_code') {
        if (!credentials.redirectUri) {
          credentials.redirectUri = OAuthCallbackServer.redirectUri;
        }
      }

      // Create connector with library
      try {
        createConnectorFromTemplate(
          input.name,
          input.vendorId,
          input.authMethodId,
          credentials,
          { baseURL: input.baseURL, displayName: input.displayName }
        );
      } catch (error) {
        return { success: false, error: `Failed to create connector: ${error}` };
      }

      // Build stored config
      const config: StoredUniversalConnector = {
        name: input.name,
        vendorId: input.vendorId,
        vendorName: vendorInfo.name,
        authMethodId: input.authMethodId,
        authMethodName: authMethod.name,
        credentials: input.credentials,
        displayName: input.displayName,
        baseURL: input.baseURL,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'untested',
      };

      // Store in memory
      this.universalConnectors.set(input.name, config);

      // Save to file
      const filePath = join(this.dataDir, 'universal-connectors', `${input.name}.json`);
      await writeFile(filePath, JSON.stringify(config, null, 2));

      // Invalidate caches so tools appear immediately without restart
      ConnectorTools.clearCache();
      ToolCatalogRegistry.reset();
      invalidateHoseaTools();

      // Tell the caller whether OAuth authorization is needed
      const needsAuth = authMethod.type === 'oauth';
      return { success: true, needsAuth, flow: authMethod.flow };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update a universal connector
   */
  async updateUniversalConnector(name: string, updates: Partial<Omit<StoredUniversalConnector, 'name' | 'vendorId' | 'vendorName' | 'authMethodId' | 'authMethodName' | 'createdAt'>>): Promise<{ success: boolean; error?: string }> {
    try {
      const existing = this.universalConnectors.get(name);
      if (!existing) {
        return { success: false, error: `Universal connector "${name}" not found` };
      }

      const updated: StoredUniversalConnector = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      };

      // If credentials changed, re-register with library
      if (updates.credentials || updates.baseURL) {
        if (Connector.has(name)) {
          Connector.remove(name);
        }
        try {
          createConnectorFromTemplate(
            name,
            existing.vendorId,
            existing.authMethodId,
            updated.credentials,
            { baseURL: updated.baseURL, displayName: updated.displayName }
          );
        } catch (error) {
          return { success: false, error: `Failed to update connector: ${error}` };
        }
      }

      // Store in memory
      this.universalConnectors.set(name, updated);

      // Save to file
      const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
      await writeFile(filePath, JSON.stringify(updated, null, 2));

      // Invalidate caches so tool changes appear immediately
      ConnectorTools.clearCache();
      ToolCatalogRegistry.reset();
      invalidateHoseaTools();

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete a universal connector
   */
  async deleteUniversalConnector(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.universalConnectors.has(name)) {
        return { success: false, error: `Universal connector "${name}" not found` };
      }

      this.universalConnectors.delete(name);

      // Remove from library
      if (Connector.has(name)) {
        Connector.remove(name);
      }

      // Delete file
      const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
      if (existsSync(filePath)) {
        const { unlink } = await import('node:fs/promises');
        await unlink(filePath);
      }

      // Invalidate caches so removed tools disappear immediately
      ConnectorTools.clearCache();
      ToolCatalogRegistry.reset();
      invalidateHoseaTools();

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Test a universal connector connection
   */
  async testUniversalConnection(name: string): Promise<{ success: boolean; error?: string; needsAuth?: boolean; flow?: string }> {
    try {
      const config = this.universalConnectors.get(name);
      if (!config) {
        return { success: false, error: `Universal connector "${name}" not found` };
      }

      const connector = Connector.get(name);
      if (!connector) {
        return { success: false, error: 'Connector not registered with library' };
      }

      const authTemplate = getVendorAuthTemplate(config.vendorId, config.authMethodId);

      // For OAuth connectors: check token validity
      if (authTemplate?.type === 'oauth') {
        const hasValid = await connector.hasValidToken();
        if (!hasValid) {
          config.status = 'error';
          config.lastTestedAt = Date.now();
          this.universalConnectors.set(name, config);
          const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
          await writeFile(filePath, JSON.stringify(config, null, 2));
          return {
            success: false,
            error: 'No valid token. Authorization required.',
            needsAuth: true,
            flow: authTemplate.flow,
          };
        }

        // Verify token is usable (triggers auto-refresh if needed)
        try {
          await connector.getToken();
        } catch (err) {
          config.status = 'error';
          config.lastTestedAt = Date.now();
          this.universalConnectors.set(name, config);
          const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
          await writeFile(filePath, JSON.stringify(config, null, 2));
          return {
            success: false,
            error: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
            needsAuth: true,
            flow: authTemplate.flow,
          };
        }
      }

      config.lastTestedAt = Date.now();
      config.status = 'active';
      this.universalConnectors.set(name, config);

      const filePath = join(this.dataDir, 'universal-connectors', `${name}.json`);
      await writeFile(filePath, JSON.stringify(config, null, 2));

      return { success: true };
    } catch (error) {
      const config = this.universalConnectors.get(name);
      if (config) {
        config.status = 'error';
        config.lastTestedAt = Date.now();
        this.universalConnectors.set(name, config);
      }
      return { success: false, error: String(error) };
    }
  }

  // ============ OAuth Flow Management ============

  /**
   * Start an OAuth authorization flow for a universal connector.
   * For authorization_code: opens BrowserWindow + callback server.
   * For client_credentials: fetches a token directly (no UI).
   */
  async startOAuthFlow(
    connectorName: string,
    parentWindow?: import('electron').BrowserWindow | null
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[OAuthFlow] ── startOAuthFlow ── connector=${connectorName}`);
    const config = this.universalConnectors.get(connectorName);
    if (!config) {
      console.error(`[OAuthFlow]   Connector "${connectorName}" not found`);
      return { success: false, error: `Connector "${connectorName}" not found` };
    }

    const authTemplate = getVendorAuthTemplate(config.vendorId, config.authMethodId);
    if (!authTemplate || authTemplate.type !== 'oauth') {
      console.error(`[OAuthFlow]   Not an OAuth connector: vendor=${config.vendorId} auth=${config.authMethodId}`);
      return { success: false, error: 'This connector does not use OAuth authentication' };
    }
    console.log(`[OAuthFlow]   OAuth flow type: ${authTemplate.flow}`);

    let result: { success: boolean; error?: string };

    // Determine if this is a built-in connector (use system browser)
    const useSystemBrowser = config.source === 'built-in';

    if (authTemplate.flow === 'client_credentials') {
      result = await this.vendorOAuthService.authorizeClientCredentials(connectorName);
    } else if (authTemplate.flow === 'authorization_code') {
      const useHttps = config.credentials?.redirectUri?.startsWith('https://') ?? false;
      result = await this.vendorOAuthService.authorizeAuthCode({
        connectorName,
        parentWindow,
        useSystemBrowser,
        useHttps,
      });
    } else {
      return { success: false, error: `Unsupported OAuth flow: ${authTemplate.flow}` };
    }

    // Update connector status
    config.updatedAt = Date.now();
    config.lastTestedAt = Date.now();
    config.status = result.success ? 'active' : 'error';
    this.universalConnectors.set(connectorName, config);
    console.log(`[OAuthFlow]   Result: ${result.success ? 'SUCCESS' : 'FAILED'} — status set to ${config.status}`);

    const filePath = join(this.dataDir, 'universal-connectors', `${connectorName}.json`);
    await writeFile(filePath, JSON.stringify(config, null, 2));

    return result;
  }

  /**
   * Cancel an in-progress OAuth flow.
   */
  cancelOAuthFlow(): void {
    this.vendorOAuthService.cancel();
  }

  /**
   * Get OAuth token status for a connector.
   */
  async getOAuthTokenStatus(connectorName: string): Promise<{
    hasToken: boolean;
    isValid: boolean;
    needsAuth: boolean;
    flow?: string;
    error?: string;
  }> {
    const config = this.universalConnectors.get(connectorName);
    if (!config) {
      return { hasToken: false, isValid: false, needsAuth: false, error: 'Connector not found' };
    }

    const authTemplate = getVendorAuthTemplate(config.vendorId, config.authMethodId);
    if (!authTemplate || authTemplate.type !== 'oauth') {
      // Not an OAuth connector — no auth needed
      return { hasToken: false, isValid: false, needsAuth: false };
    }

    const status = await this.vendorOAuthService.checkTokenStatus(connectorName);
    return {
      hasToken: status.hasToken,
      isValid: status.isValid,
      needsAuth: !status.isValid,
      flow: authTemplate.flow,
      error: status.error,
    };
  }

  /**
   * Get the redirect URI that Hosea uses for OAuth callbacks.
   */
  getOAuthRedirectUri(): string {
    return OAuthCallbackServer.redirectUri;
  }

  // ============ Built-in OAuth (Connections Page) ============

  /**
   * Resolve the default EverWorker URL.
   * Priority: env var > settings file > hardcoded default.
   */
  getDefaultEWUrl(): string {
    // 1. Env var (dev override)
    if (process.env.HOSEA_EW_URL) {
      return process.env.HOSEA_EW_URL;
    }
    // 2. Settings file override
    try {
      const settingsPath = join(this.dataDir, 'settings.json');
      if (existsSync(settingsPath)) {
        const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (content.ewDefaultUrl) return content.ewDefaultUrl;
      }
    } catch {
      // ignore
    }
    // 3. Hardcoded default
    return 'https://saas.everworker.ai';
  }

  /**
   * List available built-in OAuth apps.
   */
  getBuiltInOAuthApps(): BuiltInOAuthApp[] {
    return loadBuiltInOAuthApps();
  }

  /**
   * Get connection status for a built-in OAuth vendor.
   */
  getBuiltInOAuthStatus(vendorId: string): { connected: boolean; connectorName?: string } {
    const connectorName = `ew-${vendorId}`;
    const config = this.universalConnectors.get(connectorName);
    if (!config || config.source !== 'built-in') {
      return { connected: false };
    }
    return {
      connected: config.status === 'active',
      connectorName,
    };
  }

  /**
   * One-click OAuth authorization for a built-in vendor.
   * Creates the connector + starts OAuth flow in one step.
   */
  async builtInOAuthAuthorize(
    vendorId: string,
    parentWindow?: import('electron').BrowserWindow | null
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[BuiltInOAuth] ── authorize START ── vendorId=${vendorId}`);

    const apps = loadBuiltInOAuthApps();
    const builtInApp = apps.find(a => a.vendorId === vendorId);
    if (!builtInApp) {
      console.error(`[BuiltInOAuth]   No built-in OAuth app for vendor: ${vendorId}`);
      return { success: false, error: `No built-in OAuth app for vendor: ${vendorId}` };
    }
    console.log(`[BuiltInOAuth]   Found app: ${builtInApp.displayName}, clientId=${builtInApp.clientId.substring(0, 20)}...`);
    console.log(`[BuiltInOAuth]   scopes: ${builtInApp.scopes.join(', ')}`);
    if (builtInApp.extraCredentials) {
      console.log(`[BuiltInOAuth]   extraCredentials keys: ${Object.keys(builtInApp.extraCredentials).join(', ')}`);
    }

    const vendorInfo = getVendorInfo(vendorId);
    if (!vendorInfo) {
      console.error(`[BuiltInOAuth]   Unknown vendor: ${vendorId}`);
      return { success: false, error: `Unknown vendor: ${vendorId}` };
    }

    const authTemplate = getVendorAuthTemplate(vendorId, builtInApp.authTemplateId);
    if (!authTemplate) {
      console.error(`[BuiltInOAuth]   Unknown auth template: ${builtInApp.authTemplateId} for vendor ${vendorId}`);
      return { success: false, error: `Unknown auth template: ${builtInApp.authTemplateId} for vendor ${vendorId}` };
    }
    console.log(`[BuiltInOAuth]   Auth template: ${authTemplate.name} (flow=${authTemplate.type === 'oauth' ? authTemplate.flow : 'n/a'})`);

    const connectorName = `ew-${vendorId}`;

    // If connector already exists, check if the auth template changed.
    // If so, destroy and recreate to pick up new OAuth URLs/config.
    const existingConfig = this.universalConnectors.get(connectorName);
    if (existingConfig && existingConfig.authMethodId === builtInApp.authTemplateId) {
      console.log(`[BuiltInOAuth]   Connector "${connectorName}" already exists — re-authorizing`);
      return this.startOAuthFlow(connectorName, parentWindow);
    }
    if (existingConfig) {
      console.log(`[BuiltInOAuth]   Auth template changed (${existingConfig.authMethodId} → ${builtInApp.authTemplateId}) — recreating connector`);
      try { Connector.remove(connectorName); } catch { /* already gone */ }
    }

    // Create a new connector from template with built-in Client ID + extra credentials
    const credentials: Record<string, string> = {
      clientId: builtInApp.clientId,
      scope: builtInApp.scopes.join(' '),
      redirectUri: builtInApp.requireHttps
        ? OAuthCallbackServerHttps.redirectUri
        : OAuthCallbackServer.redirectUri,
      ...builtInApp.extraCredentials,
    };
    console.log(`[BuiltInOAuth]   Credentials: ${JSON.stringify({ ...credentials, clientId: credentials.clientId.substring(0, 20) + '...' })}`);

    try {
      console.log(`[BuiltInOAuth]   Creating connector "${connectorName}" from template...`);
      createConnectorFromTemplate(
        connectorName,
        vendorId,
        builtInApp.authTemplateId,
        credentials,
        { displayName: builtInApp.displayName }
      );
      console.log(`[BuiltInOAuth]   Connector created ✓`);
    } catch (error) {
      console.error(`[BuiltInOAuth]   Failed to create connector: ${error}`);
      return { success: false, error: `Failed to create connector: ${error}` };
    }

    // Store as built-in
    const config: StoredUniversalConnector = {
      name: connectorName,
      vendorId,
      vendorName: vendorInfo.name,
      authMethodId: builtInApp.authTemplateId,
      authMethodName: authTemplate.name,
      credentials,
      displayName: builtInApp.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'untested',
      source: 'built-in',
    };

    this.universalConnectors.set(connectorName, config);
    const filePath = join(this.dataDir, 'universal-connectors', `${connectorName}.json`);
    await writeFile(filePath, JSON.stringify(config, null, 2));
    console.log(`[BuiltInOAuth]   Config saved to ${filePath}`);

    // Invalidate caches
    ConnectorTools.clearCache();
    ToolCatalogRegistry.reset();
    invalidateHoseaTools();

    // Start the OAuth flow
    console.log(`[BuiltInOAuth]   Starting OAuth flow...`);
    return this.startOAuthFlow(connectorName, parentWindow);
  }

  /**
   * Disconnect a built-in OAuth connector.
   */
  async builtInOAuthDisconnect(vendorId: string): Promise<{ success: boolean; error?: string }> {
    const connectorName = `ew-${vendorId}`;
    const config = this.universalConnectors.get(connectorName);
    if (!config || config.source !== 'built-in') {
      return { success: false, error: `No built-in connector found for vendor: ${vendorId}` };
    }
    return this.deleteUniversalConnector(connectorName);
  }

  // ============ MCP Server Management ============

  /**
   * Load MCP server configurations from storage
   */
  private async loadMCPServers(): Promise<void> {
    const mcpServersDir = join(this.dataDir, 'mcp-servers');
    if (!existsSync(mcpServersDir)) return;

    try {
      const files = await readdir(mcpServersDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(join(mcpServersDir, file), 'utf-8');
          const config = JSON.parse(content) as StoredMCPServerConfig;
          // Reset status to disconnected on load (will need to reconnect)
          config.status = 'disconnected';
          this.mcpServers.set(config.name, config);
        }
      }
    } catch (error) {
      console.warn('Error loading MCP servers:', error);
    }
  }

  /**
   * Save MCP server configuration to storage
   */
  private async saveMCPServer(config: StoredMCPServerConfig): Promise<void> {
    const filePath = join(this.dataDir, 'mcp-servers', `${config.name}.json`);
    await writeFile(filePath, JSON.stringify(config, null, 2));
  }

  /**
   * Delete MCP server configuration from storage
   */
  private async deleteMCPServerFile(name: string): Promise<void> {
    const filePath = join(this.dataDir, 'mcp-servers', `${name}.json`);
    if (existsSync(filePath)) {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);
    }
  }

  /**
   * List all configured MCP servers
   */
  listMCPServers(): StoredMCPServerConfig[] {
    return Array.from(this.mcpServers.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get a specific MCP server configuration
   */
  getMCPServer(name: string): StoredMCPServerConfig | null {
    return this.mcpServers.get(name) || null;
  }

  /**
   * Create a new MCP server configuration
   */
  async createMCPServer(input: CreateMCPServerInput): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if name already exists
      if (this.mcpServers.has(input.name)) {
        return { success: false, error: `MCP server "${input.name}" already exists` };
      }

      const now = Date.now();
      const config: StoredMCPServerConfig = {
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        transport: input.transport,
        transportConfig: input.transportConfig,
        toolNamespace: input.toolNamespace ?? `mcp:${input.name}`,
        connectorBindings: input.connectorBindings,
        status: 'disconnected',
        createdAt: now,
        updatedAt: now,
      };

      this.mcpServers.set(config.name, config);
      await this.saveMCPServer(config);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update an existing MCP server configuration
   */
  async updateMCPServer(name: string, updates: Partial<Omit<StoredMCPServerConfig, 'name' | 'createdAt'>>): Promise<{ success: boolean; error?: string }> {
    try {
      const config = this.mcpServers.get(name);
      if (!config) {
        return { success: false, error: `MCP server "${name}" not found` };
      }

      // If changing transport config, disconnect first
      if (updates.transport || updates.transportConfig) {
        await this.disconnectMCPServer(name);
      }

      // Apply updates
      const updatedConfig: StoredMCPServerConfig = {
        ...config,
        ...updates,
        name: config.name, // Prevent name change
        createdAt: config.createdAt, // Prevent createdAt change
        updatedAt: Date.now(),
      };

      this.mcpServers.set(name, updatedConfig);
      await this.saveMCPServer(updatedConfig);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete an MCP server configuration
   */
  async deleteMCPServer(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.mcpServers.has(name)) {
        return { success: false, error: `MCP server "${name}" not found` };
      }

      // Disconnect if connected
      await this.disconnectMCPServer(name);

      // Remove from registry if registered
      if (MCPRegistry.has(name)) {
        MCPRegistry.remove(name);
      }

      this.mcpServers.delete(name);
      await this.deleteMCPServerFile(name);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Connect to an MCP server
   */
  async connectMCPServer(name: string): Promise<{ success: boolean; tools?: string[]; error?: string }> {
    try {
      const config = this.mcpServers.get(name);
      if (!config) {
        return { success: false, error: `MCP server "${name}" not found` };
      }

      // Update status to connecting
      config.status = 'connecting';
      this.mcpServers.set(name, config);

      // Resolve connector bindings to actual tokens
      const resolvedEnv = { ...config.transportConfig.env };
      if (config.connectorBindings) {
        for (const [envKey, connectorName] of Object.entries(config.connectorBindings)) {
          if (Connector.has(connectorName)) {
            try {
              const connector = Connector.get(connectorName);
              const token = await connector.getToken();
              resolvedEnv[envKey] = token;
              logger.debug(`Resolved connector binding: ${envKey} <- ${connectorName}`);
            } catch (err) {
              logger.warn(`Failed to get token from connector "${connectorName}" for ${envKey}: ${err}`);
              // Continue with existing env value if present
            }
          } else {
            logger.warn(`Connector "${connectorName}" not found for binding ${envKey}`);
          }
        }
      }

      // Build MCPServerConfig for the library
      const mcpConfig: MCPServerConfig = {
        name: config.name,
        displayName: config.displayName,
        description: config.description,
        transport: config.transport,
        transportConfig: config.transport === 'stdio'
          ? {
              command: config.transportConfig.command!,
              args: config.transportConfig.args,
              env: resolvedEnv,
              cwd: config.transportConfig.cwd,
            }
          : {
              url: config.transportConfig.url!,
              token: config.transportConfig.token,
              headers: config.transportConfig.headers,
              timeoutMs: config.transportConfig.timeoutMs,
            },
        toolNamespace: config.toolNamespace,
      };

      // Create or get client from registry
      let client: IMCPClient;
      if (MCPRegistry.has(name)) {
        client = MCPRegistry.get(name);
        if (!client.isConnected()) {
          await client.connect();
        }
      } else {
        client = MCPRegistry.create(mcpConfig);
        await client.connect();
      }

      // Get available tools
      const tools = client.tools.map(t => t.name);

      // Update config with connection info
      config.status = 'connected';
      config.toolCount = tools.length;
      config.availableTools = tools;
      config.lastConnectedAt = Date.now();
      config.lastError = undefined;
      config.updatedAt = Date.now();
      this.mcpServers.set(name, config);
      await this.saveMCPServer(config);

      return { success: true, tools };
    } catch (error) {
      const config = this.mcpServers.get(name);
      if (config) {
        config.status = 'error';
        config.lastError = String(error);
        config.updatedAt = Date.now();
        this.mcpServers.set(name, config);
        await this.saveMCPServer(config);
      }
      return { success: false, error: String(error) };
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnectMCPServer(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = this.mcpServers.get(name);
      if (!config) {
        return { success: false, error: `MCP server "${name}" not found` };
      }

      // Disconnect if in registry
      if (MCPRegistry.has(name)) {
        const client = MCPRegistry.get(name);
        if (client.isConnected()) {
          await client.disconnect();
        }
      }

      // Update status
      config.status = 'disconnected';
      config.toolCount = undefined;
      config.availableTools = undefined;
      config.updatedAt = Date.now();
      this.mcpServers.set(name, config);
      await this.saveMCPServer(config);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get tools available from an MCP server
   * Returns empty array if not connected
   */
  getMCPServerTools(name: string): Array<{ name: string; description?: string }> {
    if (!MCPRegistry.has(name)) {
      return [];
    }

    const client = MCPRegistry.get(name);
    if (!client.isConnected()) {
      return [];
    }

    return client.tools.map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  /**
   * Refresh tools list from a connected MCP server
   */
  async refreshMCPServerTools(name: string): Promise<{ success: boolean; tools?: string[]; error?: string }> {
    try {
      if (!MCPRegistry.has(name)) {
        return { success: false, error: `MCP server "${name}" not in registry` };
      }

      const client = MCPRegistry.get(name);
      if (!client.isConnected()) {
        return { success: false, error: `MCP server "${name}" not connected` };
      }

      // Refresh tools list
      await client.listTools();
      const tools = client.tools.map(t => t.name);

      // Update stored config
      const config = this.mcpServers.get(name);
      if (config) {
        config.toolCount = tools.length;
        config.availableTools = tools;
        config.updatedAt = Date.now();
        this.mcpServers.set(name, config);
        await this.saveMCPServer(config);
      }

      return { success: true, tools };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ============ Agent Configuration CRUD ============

  listAgents(): StoredAgentConfig[] {
    return Array.from(this.agents.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getAgent(id: string): StoredAgentConfig | null {
    return this.agents.get(id) || null;
  }

  async createAgent(config: Omit<StoredAgentConfig, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const id = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      const agentConfig: StoredAgentConfig = {
        ...config,
        id,
        createdAt: now,
        updatedAt: now,
        isActive: false,
      };

      this.agents.set(id, agentConfig);

      // Save using library's agent definition storage
      const definition = this.toStoredDefinition(agentConfig);
      await this.agentDefinitionStorage.save(definition);

      return { success: true, id };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async updateAgent(id: string, updates: Partial<StoredAgentConfig>): Promise<{ success: boolean; error?: string }> {
    try {
      const existing = this.agents.get(id);
      if (!existing) {
        return { success: false, error: `Agent "${id}" not found` };
      }

      const oldToolNames = existing.tools;

      const updated: StoredAgentConfig = {
        ...existing,
        ...updates,
        id, // Ensure ID cannot be changed
        updatedAt: Date.now(),
      };
      this.agents.set(id, updated);

      // Save using library's agent definition storage
      const definition = this.toStoredDefinition(updated);
      await this.agentDefinitionStorage.save(definition);

      // Sync tools on running instances that use this agent config
      if (updates.tools) {
        this.syncInstanceTools(id, oldToolNames, updated.tools);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Sync tools on all running instances of an agent config after config update.
   * Only touches user-configured tools — plugin tools (memory, context) and MCP tools are untouched.
   */
  private syncInstanceTools(agentConfigId: string, oldToolNames: string[], newToolNames: string[]): void {
    for (const [instanceId, instance] of this.instances) {
      if (instance.agentConfigId !== agentConfigId) continue;

      const toolManager = instance.agent.tools;
      const context = { instanceId };

      // Remove tools that were in old config but not in new
      const toRemove = oldToolNames.filter(name => !newToolNames.includes(name));
      for (const name of toRemove) {
        toolManager.unregister(name);
      }

      // Add tools that are in new config but not in old, grouped by connector
      const toAdd = newToolNames.filter(name => !oldToolNames.includes(name));
      if (toAdd.length > 0) {
        const { plain, byConnector } = ToolCatalogRegistry.resolveToolsGrouped(toAdd, context, { includeConnectors: true });
        toolManager.registerMany(plain);
        for (const [connName, connTools] of byConnector) {
          toolManager.registerConnectorTools(connName, connTools);
        }
      }

      logger.info(`[syncInstanceTools] Instance ${instanceId}: removed ${toRemove.length}, added ${toAdd.length} tools`);
    }

    // Also update the legacy single-agent if it uses this config
    if (this.agent) {
      const activeConfig = this.getActiveAgent();
      if (activeConfig && activeConfig.id === agentConfigId) {
        const toolManager = this.agent.tools;
        const context = { instanceId: agentConfigId };

        const toRemove = oldToolNames.filter(name => !newToolNames.includes(name));
        for (const name of toRemove) {
          toolManager.unregister(name);
        }

        const toAdd = newToolNames.filter(name => !oldToolNames.includes(name));
        if (toAdd.length > 0) {
          const { plain, byConnector } = ToolCatalogRegistry.resolveToolsGrouped(toAdd, context, { includeConnectors: true });
          toolManager.registerMany(plain);
          for (const [connName, connTools] of byConnector) {
            toolManager.registerConnectorTools(connName, connTools);
          }
        }

        logger.info(`[syncInstanceTools] Legacy agent: removed ${toRemove.length}, added ${toAdd.length} tools`);
      }
    }
  }

  async deleteAgent(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.agents.has(id)) {
        return { success: false, error: `Agent "${id}" not found` };
      }

      this.agents.delete(id);

      // Delete from library's agent definition storage
      await this.agentDefinitionStorage.delete(id);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async setActiveAgent(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const agentConfig = this.agents.get(id);
      if (!agentConfig) {
        return { success: false, error: `Agent "${id}" not found` };
      }

      // Deactivate all other agents
      for (const [agentId, config] of this.agents) {
        if (config.isActive && agentId !== id) {
          config.isActive = false;
          // Save using library's agent definition storage
          const definition = this.toStoredDefinition(config);
          await this.agentDefinitionStorage.save(definition);
        }
      }

      // Activate the selected agent
      agentConfig.isActive = true;
      agentConfig.lastUsedAt = Date.now();
      // Save using library's agent definition storage
      const definition = this.toStoredDefinition(agentConfig);
      await this.agentDefinitionStorage.save(definition);

      // Initialize the agent with its full configuration (including tools)
      return this.initializeWithConfig(agentConfig);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Initialize agent with full configuration including tools
   */
  private async initializeWithConfig(agentConfig: StoredAgentConfig): Promise<{ success: boolean; error?: string }> {
    try {
      // Get connector config
      const connectorConfig = this.connectors.get(agentConfig.connector);
      if (!connectorConfig) {
        return { success: false, error: `Connector "${agentConfig.connector}" not found` };
      }

      // Register with library if not already
      if (!Connector.has(agentConfig.connector)) {
        Connector.create({
          name: agentConfig.connector,
          vendor: connectorConfig.vendor as Vendor,
          auth: connectorConfig.auth,
          baseURL: connectorConfig.baseURL,
        });
      }

      // Destroy existing agent
      this.agent?.destroy();

      // Resolve session storage from StorageRegistry
      this.sessionStorage = this.createSessionStorage('hosea');

      // Resolve tool names to actual ToolFunction objects using ToolCatalogRegistry
      // Use agent config ID as instance ID for single-agent mode
      const toolCreationContext = { instanceId: agentConfig.id };
      const { plain: plainTools, byConnector: connectorToolGroups } = ToolCatalogRegistry.resolveToolsGrouped(
        agentConfig.tools,
        toolCreationContext,
        { includeConnectors: true },
      );

      // Combine user instructions with UI capabilities prompt (user instructions first)
      const fullInstructions = (agentConfig.instructions || '') + '\n\n' + HOSEA_UI_CAPABILITIES_PROMPT;

      // Validate strategy exists in registry
      const { strategy: validStrategy, isValid: strategyIsValid } = validateStrategy(agentConfig.contextStrategy);
      if (!strategyIsValid) {
        const availableStrategies = StrategyRegistry.list().join(', ');
        console.warn(
          `Strategy "${agentConfig.contextStrategy}" not found in registry for agent "${agentConfig.name}". ` +
          `Using "${validStrategy}" instead. Available strategies: ${availableStrategies}. ` +
          `Please update the agent's strategy in settings.`
        );
      }

      // Create agent with NextGen context configuration
      // NOTE: NextGen simplifies context management - no history/permissions/cache options
      // Pass only plain (non-connector) tools at creation time; connector tools are registered separately below.
      const config: AgentConfig = {
        connector: agentConfig.connector,
        model: agentConfig.model,
        name: agentConfig.name,
        tools: plainTools,
        instructions: fullInstructions,
        temperature: agentConfig.temperature,
        maxIterations: agentConfig.maxIterations ?? 50,
        // NextGen context configuration
        context: {
          model: agentConfig.model,
          agentId: agentConfig.id,
          maxContextTokens: agentConfig.maxContextTokens,
          responseReserve: agentConfig.responseReserve,
          strategy: validStrategy, // Validated strategy from StrategyRegistry
          storage: this.sessionStorage,
          // Feature toggles (NextGen only has these 3)
          features: {
            workingMemory: agentConfig.workingMemoryEnabled,
            inContextMemory: agentConfig.inContextMemoryEnabled,
            persistentInstructions: agentConfig.persistentInstructionsEnabled ?? false,
          },
          // Plugin-specific configurations
          plugins: {
            workingMemory: agentConfig.workingMemoryEnabled
              ? {
                  maxSizeBytes: agentConfig.maxMemorySizeBytes,
                  maxIndexEntries: agentConfig.maxMemoryIndexEntries,
                  descriptionMaxLength: 150,
                  softLimitPercent: agentConfig.memorySoftLimitPercent,
                  contextAllocationPercent: agentConfig.contextAllocationPercent,
                }
              : undefined,
            inContextMemory: agentConfig.inContextMemoryEnabled
              ? {
                  maxEntries: agentConfig.maxInContextEntries,
                  maxTotalTokens: agentConfig.maxInContextTokens,
                }
              : undefined,
          },
        },
      };

      this.agent = Agent.create(config);

      // Register connector-produced tools with source tracking
      for (const [connName, connTools] of connectorToolGroups) {
        this.agent.tools.registerConnectorTools(connName, connTools);
      }

      // Update global config
      this.config.activeConnector = agentConfig.connector;
      this.config.activeModel = agentConfig.model;
      await this.saveConfigFile();

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get the currently active agent
   */
  getActiveAgent(): StoredAgentConfig | null {
    for (const config of this.agents.values()) {
      if (config.isActive) {
        return config;
      }
    }
    return null;
  }

  /**
   * Create a default agent for a connector
   */
  async createDefaultAgent(connectorName: string, model: string): Promise<{ success: boolean; id?: string; error?: string }> {
    const connector = this.connectors.get(connectorName);
    if (!connector) {
      return { success: false, error: `Connector "${connectorName}" not found` };
    }

    const defaultConfig = {
      name: 'Default Assistant',
      connector: connectorName,
      model,
      agentType: 'basic' as const,
      instructions: 'You are a helpful AI assistant. Use the rich formatting capabilities available to you (charts, diagrams, tables, code highlighting) to provide clear and visually informative responses when appropriate.',
      temperature: 0.7,
      maxIterations: 50,
      contextStrategy: 'algorithmic',
      maxContextTokens: 128000,
      responseReserve: 4096,
      workingMemoryEnabled: true,
      maxMemorySizeBytes: 25 * 1024 * 1024,
      maxMemoryIndexEntries: 30,
      memorySoftLimitPercent: 80,
      contextAllocationPercent: 10,
      inContextMemoryEnabled: false,
      maxInContextEntries: 20,
      maxInContextTokens: 4000,
      persistentInstructionsEnabled: false,
      toolCatalogEnabled: false,
      pinnedCategories: [],
      toolCategoryScope: [],
      permissionsEnabled: true,
      tools: [],
      voiceEnabled: false,
    };

    const result = await this.createAgent(defaultConfig);
    if (result.success && result.id) {
      // Also activate this agent
      await this.setActiveAgent(result.id);
    }
    return result;
  }

  listModels(): { vendor: string; models: { id: string; name: string; description?: string; contextWindow: number }[] }[] {
    const result: { vendor: string; models: { id: string; name: string; description?: string; contextWindow: number }[] }[] = [];

    for (const vendor of Object.values(Vendor)) {
      if (typeof vendor !== 'string') continue;
      const models = getModelsByVendor(vendor as Vendor);
      if (models.length > 0) {
        result.push({
          vendor,
          models: models
            .filter((m) => m.isActive)
            .map((m) => ({
              id: m.name,
              name: m.name,
              description: m.description,
              contextWindow: m.features.input.tokens,
            })),
        });
      }
    }

    return result;
  }

  /**
   * Get detailed information about a specific model
   */
  getModelDetails(modelId: string): ILLMDescription | null {
    return getModelInfo(modelId) || null;
  }

  /**
   * Get list of all supported vendors
   */
  listVendors(): string[] {
    return Object.values(Vendor).filter((v) => typeof v === 'string') as string[];
  }

  /**
   * Get list of available compaction strategies
   */
  getStrategies(): StrategyInfo[] {
    return StrategyRegistry.getInfo();
  }

  async saveSession(): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    if (!this.agent) {
      return { success: false, error: 'Agent not initialized' };
    }

    try {
      await this.agent.saveSession();
      return { success: true, sessionId: this.agent.getSessionId() || undefined };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async loadSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.sessionStorage) {
      return { success: false, error: 'Session storage not initialized' };
    }

    try {
      // Destroy current agent
      this.agent?.destroy();

      // Resume from session with UI capabilities (NextGen)
      this.agent = await Agent.resume(sessionId, {
        connector: this.config.activeConnector!,
        model: this.config.activeModel!,
        instructions: HOSEA_UI_CAPABILITIES_PROMPT,
        context: {
          model: this.config.activeModel!,
          storage: this.sessionStorage,
        },
        session: {
          storage: this.sessionStorage,
        },
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async listSessions(): Promise<{ id: string; createdAt: number }[]> {
    if (!this.sessionStorage) {
      return [];
    }

    try {
      const sessions = await this.sessionStorage.list();
      return sessions.map((s) => ({ id: s.sessionId, createdAt: s.createdAt.getTime() }));
    } catch {
      return [];
    }
  }

  newSession(): { success: boolean } {
    if (this.agent) {
      // Create a new agent instance (fresh session)
      this.initialize(this.config.activeConnector!, this.config.activeModel!);
    }
    return { success: true };
  }

  listTools(): { name: string; enabled: boolean; description: string }[] {
    if (!this.agent) {
      return [];
    }

    const tools = this.agent.tools?.getAll() || [];
    return tools.map((t: ToolFunction) => ({
      name: t.definition.function.name,
      enabled: true, // TODO: Track enabled state
      description: t.definition.function.description || '',
    }));
  }

  /**
   * Get all available tools from the registry (built-in + connector tools)
   */
  getAvailableTools(): {
    name: string;
    displayName: string;
    category: string;
    categoryDisplayName: string;
    description: string;
    safeByDefault: boolean;
    requiresConnector: boolean;
    connectorServiceTypes?: string[];
    source: 'oneringai' | 'hosea' | 'custom';
    connectorName?: string;
    serviceType?: string;
  }[] {
    // Use ToolCatalogRegistry which combines core + hosea tools
    const allTools = ToolCatalogRegistry.getAllCatalogTools();
    const connectorTools = allTools.filter(t => t.requiresConnector);
    logger.debug(`[getAvailableTools] Returning ${allTools.length} tools (${connectorTools.length} require connector)`);
    for (const t of connectorTools) {
      logger.debug(`  requiresConnector tool: name=${t.name}, serviceTypes=${JSON.stringify(t.connectorServiceTypes)}, source=${t.source}`);
    }

    // Map CatalogToolEntry to the serialized format the UI expects
    const categories = ToolCatalogRegistry.getCategories();
    const categoryDisplayMap = new Map(categories.map(c => [c.name, c.displayName]));

    return allTools.map((entry: CatalogToolEntry) => {
      // Find which category this tool belongs to
      const found = ToolCatalogRegistry.findTool(entry.name);
      const category = found?.category ?? 'other';
      return {
        name: entry.name,
        displayName: entry.displayName,
        category,
        categoryDisplayName: categoryDisplayMap.get(category) ?? category,
        description: entry.description,
        safeByDefault: entry.safeByDefault,
        requiresConnector: entry.requiresConnector || false,
        connectorServiceTypes: entry.connectorServiceTypes,
        source: (entry.source ?? 'oneringai') as 'oneringai' | 'hosea' | 'custom',
        connectorName: entry.connectorName,
        serviceType: entry.serviceType,
      };
    });
  }

  /**
   * Get tool categories with display names and counts
   */
  getToolCategories(): { id: string; displayName: string; count: number }[] {
    const categories = ToolCatalogRegistry.getCategories();
    return categories.map(cat => ({
      id: cat.name,
      displayName: cat.displayName,
      count: ToolCatalogRegistry.getToolsInCategory(cat.name).length,
    }));
  }

  toggleTool(toolName: string, enabled: boolean): { success: boolean } {
    if (!this.agent) {
      return { success: false };
    }

    if (enabled) {
      this.agent.tools?.enable(toolName);
    } else {
      this.agent.tools?.disable(toolName);
    }

    return { success: true };
  }

  getConfig(): HoseaConfig {
    return this.config;
  }

  async setConfig(key: string, value: unknown): Promise<{ success: boolean }> {
    const keys = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let obj: any = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }

    obj[keys[keys.length - 1]] = value;
    await this.saveConfigFile();

    // Handle special case for logLevel
    if (key === 'logLevel') {
      logger.updateConfig({ level: value as LogLevel });
    }

    return { success: true };
  }

  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return logger.getLevel();
  }

  /**
   * Set log level (updates both config and runtime)
   */
  async setLogLevel(level: LogLevel): Promise<{ success: boolean }> {
    this.config.logLevel = level;
    await this.saveConfigFile();
    logger.updateConfig({ level });
    console.log(`Log level changed to: ${level}`);
    return { success: true };
  }

  destroy(): void {
    // Destroy the legacy single agent
    this.agent?.destroy();
    this.agent = null;

    // Destroy all instances
    for (const instance of this.instances.values()) {
      try {
        instance.agent.destroy();
      } catch (error) {
        console.warn(`Error destroying instance ${instance.instanceId}:`, error);
      }
    }
    this.instances.clear();
  }

  /**
   * Set the BrowserService reference for browser automation tools
   */
  setBrowserService(browserService: BrowserService): void {
    this.browserService = browserService;
    // Update browser tool factories with the new service reference
    updateBrowserService(browserService);
    console.log('[AgentService] BrowserService connected');
  }

  /**
   * Set the OllamaService reference for local AI management
   */
  setOllamaService(ollamaService: import('./OllamaService.js').OllamaService): void {
    this.ollamaService = ollamaService;
    console.log('[AgentService] OllamaService connected');
  }

  /**
   * Get the BrowserService reference
   */
  getBrowserService(): BrowserService | null {
    return this.browserService;
  }

  /**
   * Set the stream emitter for sending chunks to renderer.
   * This enables the HoseaUIPlugin to emit Dynamic UI content for browser tools.
   * Must be called after mainWindow is created.
   */
  setStreamEmitter(emitter: (instanceId: string, chunk: StreamChunk) => void): void {
    this.streamEmitter = emitter;
    console.log('[AgentService] StreamEmitter connected - HoseaUIPlugin enabled for new instances');
  }

  // ============ Context Entry Pinning ============

  /**
   * Get pinned context keys for an agent (synchronous, cached from disk).
   */
  getPinnedContextKeysSync(agentConfigId: string): string[] {
    try {
      const configPath = join(homedir(), '.oneringai', 'agents', agentConfigId, 'ui_config.json');
      if (!existsSync(configPath)) return [];
      const { readFileSync } = require('node:fs');
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      return Array.isArray(data.pinnedContextKeys) ? data.pinnedContextKeys : [];
    } catch {
      return [];
    }
  }

  /**
   * Get pinned context keys for an agent (async).
   */
  async getPinnedContextKeys(agentConfigId: string): Promise<string[]> {
    try {
      const configPath = join(homedir(), '.oneringai', 'agents', agentConfigId, 'ui_config.json');
      if (!existsSync(configPath)) return [];
      const data = JSON.parse(await readFile(configPath, 'utf-8'));
      return Array.isArray(data.pinnedContextKeys) ? data.pinnedContextKeys : [];
    } catch {
      return [];
    }
  }

  /**
   * Pin or unpin a context key for an agent.
   */
  async setPinnedContextKey(agentConfigId: string, key: string, pinned: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      const agentDir = join(homedir(), '.oneringai', 'agents', agentConfigId);
      const configPath = join(agentDir, 'ui_config.json');

      // Ensure directory exists
      if (!existsSync(agentDir)) {
        await mkdir(agentDir, { recursive: true });
      }

      // Load existing config
      let config: { pinnedContextKeys: string[] } = { pinnedContextKeys: [] };
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(await readFile(configPath, 'utf-8'));
          if (!Array.isArray(config.pinnedContextKeys)) {
            config.pinnedContextKeys = [];
          }
        } catch {
          config = { pinnedContextKeys: [] };
        }
      }

      // Update
      const keySet = new Set(config.pinnedContextKeys);
      if (pinned) {
        keySet.add(key);
      } else {
        keySet.delete(key);
      }
      config.pinnedContextKeys = Array.from(keySet);

      // Save
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

      // Re-emit context entries to update the renderer with new pinned state
      // Find any active instance for this agent config and trigger re-emission
      for (const [instanceId, instance] of this.instances) {
        if (instance.agentConfigId === agentConfigId) {
          const ctx = instance.agent.context as AgentContextNextGen;
          const plugin = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory');
          if (plugin && this.streamEmitter) {
            const entries = Array.from(plugin.getContents().values());
            this.streamEmitter(instanceId, {
              type: 'ui:context_entries' as const,
              entries: entries.map(e => ({
                key: e.key,
                description: e.description,
                value: e.value,
                priority: e.priority,
                showInUI: e.showInUI ?? false,
                updatedAt: e.updatedAt,
              })),
              pinnedKeys: config.pinnedContextKeys,
            });
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ============ Multi-Tab Instance Management ============

  /**
   * Create a new agent instance for a tab
   * @param agentConfigId - The ID of the agent configuration to use
   * @returns instanceId if successful
   */
  async createInstance(agentConfigId: string): Promise<{ success: boolean; instanceId?: string; error?: string }> {
    try {
      // Check instance limit
      if (this.instances.size >= MAX_INSTANCES) {
        return { success: false, error: `Maximum number of instances (${MAX_INSTANCES}) reached` };
      }

      // Get agent config
      const agentConfig = this.agents.get(agentConfigId);
      if (!agentConfig) {
        return { success: false, error: `Agent configuration "${agentConfigId}" not found` };
      }

      // Get connector config
      const connectorConfig = this.connectors.get(agentConfig.connector);
      if (!connectorConfig) {
        return { success: false, error: `Connector "${agentConfig.connector}" not found` };
      }

      // Register connector with library if not already
      if (!Connector.has(agentConfig.connector)) {
        Connector.create({
          name: agentConfig.connector,
          vendor: connectorConfig.vendor as Vendor,
          auth: connectorConfig.auth,
          baseURL: connectorConfig.baseURL,
        });
      }

      // Generate unique instance ID
      const instanceId = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Create instance-specific session storage via StorageRegistry factory
      const sessionStorage = this.createSessionStorage(instanceId);

      // Resolve tool names to actual ToolFunction objects using ToolCatalogRegistry
      // This handles both oneringai tools AND hosea-specific tools (like browser automation)
      const toolCreationContext = { instanceId };
      const { plain: plainTools, byConnector: connectorToolGroups } = ToolCatalogRegistry.resolveToolsGrouped(
        agentConfig.tools,
        toolCreationContext,
        { includeConnectors: true },
      );
      logger.debug(`[createInstance] Resolved ${plainTools.length} plain + ${connectorToolGroups.size} connector groups from catalog for ${agentConfig.tools.length} configured tool names`);

      // Connect MCP servers and register their tools if configured
      if (agentConfig.mcpServers && agentConfig.mcpServers.length > 0) {
        for (const mcpRef of agentConfig.mcpServers) {
          const serverConfig = this.mcpServers.get(mcpRef.serverName);
          if (serverConfig && serverConfig.status !== 'connected') {
            await this.connectMCPServer(mcpRef.serverName);
          }
          // MCP tools are registered to the agent's tool manager below
        }
      }

      // Combine user instructions with UI capabilities prompt
      const fullInstructions = (agentConfig.instructions || '') + '\n\n' + HOSEA_UI_CAPABILITIES_PROMPT;

      // Build NextGen context configuration
      // Note: Use agentConfigId (not instanceId) for persistent instructions so they're
      // shared across all instances of the same agent. Instance ID is only for session storage.
      logger.debug(`[createInstance] Creating agent with features: workingMemory=${agentConfig.workingMemoryEnabled}, inContextMemory=${agentConfig.inContextMemoryEnabled}, persistentInstructions=${agentConfig.persistentInstructionsEnabled}`);
      logger.debug(`[createInstance] Agent ID for persistent instructions: ${agentConfigId}`);

      const contextConfig: AgentContextNextGenConfig = {
        model: agentConfig.model,
        agentId: agentConfigId, // Use agent config ID for persistent instructions path
        maxContextTokens: agentConfig.maxContextTokens,
        responseReserve: agentConfig.responseReserve,
        strategy: agentConfig.contextStrategy, // Already NextGen type
        storage: sessionStorage,
        features: {
          workingMemory: agentConfig.workingMemoryEnabled,
          inContextMemory: agentConfig.inContextMemoryEnabled,
          persistentInstructions: agentConfig.persistentInstructionsEnabled ?? false,
          toolCatalog: agentConfig.toolCatalogEnabled ?? false,
        },
        toolCategories: agentConfig.toolCategoryScope.length > 0
          ? agentConfig.toolCategoryScope
          : undefined,
        plugins: {
          workingMemory: agentConfig.workingMemoryEnabled
            ? {
                maxSizeBytes: agentConfig.maxMemorySizeBytes,
                maxIndexEntries: agentConfig.maxMemoryIndexEntries,
                descriptionMaxLength: 150,
                softLimitPercent: agentConfig.memorySoftLimitPercent,
                contextAllocationPercent: agentConfig.contextAllocationPercent,
              }
            : undefined,
          inContextMemory: agentConfig.inContextMemoryEnabled
            ? {
                maxEntries: agentConfig.maxInContextEntries,
                maxTotalTokens: agentConfig.maxInContextTokens,
                onEntriesChanged: (entries: any[]) => {
                  if (!this.streamEmitter) return;
                  const pinnedKeys = this.getPinnedContextKeysSync(agentConfigId);
                  this.streamEmitter(instanceId, {
                    type: 'ui:context_entries' as const,
                    entries: entries.map((e: any) => ({
                      key: e.key,
                      description: e.description,
                      value: e.value,
                      priority: e.priority,
                      showInUI: e.showInUI ?? false,
                      updatedAt: e.updatedAt,
                    })),
                    pinnedKeys,
                  });
                },
              }
            : undefined,
          toolCatalog: agentConfig.toolCatalogEnabled ? {
            pinned: agentConfig.pinnedCategories,
          } : undefined,
        },
      };

      // Create agent (only basic Agent type in NextGen - other types deprecated)
      // Pass only plain (non-connector) tools; connector tools registered separately below.
      const agent = Agent.create({
        connector: agentConfig.connector,
        model: agentConfig.model,
        name: agentConfig.name,
        tools: plainTools,
        instructions: fullInstructions,
        temperature: agentConfig.temperature,
        context: contextConfig,
      });

      // Register connector-produced tools with source tracking
      for (const [connName, connTools] of connectorToolGroups) {
        agent.tools.registerConnectorTools(connName, connTools);
      }

      // Register MCP tools with the agent if configured
      if (agentConfig.mcpServers && agentConfig.mcpServers.length > 0) {
        for (const mcpRef of agentConfig.mcpServers) {
          if (MCPRegistry.has(mcpRef.serverName)) {
            const client = MCPRegistry.get(mcpRef.serverName);
            if (client.isConnected()) {
              client.registerTools(agent.tools);
            }
          }
        }
      }

      // NOTE: Browser tools are now resolved through ToolCatalogRegistry when selected
      // No need for separate registration - they're part of agentConfig.tools

      // Register HoseaUIPlugin for browser tool UI integration
      // This plugin emits Dynamic UI content when browser tools execute
      if (this.streamEmitter) {
        const streamEmitter = this.streamEmitter;
        agent.tools.executionPipeline.use(
          new HoseaUIPlugin({
            emitDynamicUI: (instId: string, content: DynamicUIContent) => {
              // Send Dynamic UI content to renderer via the stream emitter
              console.log(`[HoseaUIPlugin.emitDynamicUI] Sending to renderer for ${instId}`);
              streamEmitter(instId, {
                type: 'ui:set_dynamic_content',
                content,
              });
            },
            getInstanceId: () => instanceId,
            onAgentStuck: (instId: string) => {
              // Trigger auto-pause via BrowserService event (Trigger 2)
              this.browserService?.emit('browser:agent-stuck', instId);
            },
          })
        );
        logger.info(`[createInstance] HoseaUIPlugin registered for instance ${instanceId}`);
      } else {
        logger.warn(`[createInstance] streamEmitter not set - HoseaUIPlugin NOT registered for ${instanceId}`);
      }

      // Store the instance
      const agentInstance: AgentInstance = {
        instanceId,
        agentConfigId,
        agent,
        sessionStorage,
        createdAt: Date.now(),
        voiceoverEnabled: false,
      };
      this.instances.set(instanceId, agentInstance);

      // Subscribe to context events for monitoring
      this.subscribeToContextEvents(agent, instanceId);

      // Log plugin status for debugging
      const ctx = agent.context as AgentContextNextGen;
      const hasPI = ctx.hasPlugin('persistent_instructions');
      logger.debug(`[createInstance] Persistent instructions plugin registered: ${hasPI}`);

      logger.info(`Created agent instance ${instanceId} for config ${agentConfigId} (${agentConfig.name})`);
      return { success: true, instanceId };
    } catch (error) {
      logger.error(`Error creating instance: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Destroy an agent instance
   * @param instanceId - The instance ID to destroy
   */
  async destroyInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const instance = this.instances.get(instanceId);
      if (!instance) {
        return { success: false, error: `Instance "${instanceId}" not found` };
      }

      // Cancel any ongoing operations
      if ('cancel' in instance.agent && typeof instance.agent.cancel === 'function') {
        instance.agent.cancel();
      }

      // Destroy voice stream if exists
      if (instance.voiceStream) {
        instance.voiceStream.interrupt();
        instance.voiceStream.destroy();
        instance.voiceStream = undefined;
      }

      // Destroy associated browser instance if exists
      if (this.browserService && this.browserService.hasBrowser(instanceId)) {
        await this.browserService.destroyBrowser(instanceId);
        logger.debug(`[destroyInstance] Destroyed browser for instance ${instanceId}`);
      }

      // Destroy the agent
      instance.agent.destroy();

      // Remove from instances map
      this.instances.delete(instanceId);

      console.log(`Destroyed agent instance ${instanceId}`);
      return { success: true };
    } catch (error) {
      console.error(`Error destroying instance ${instanceId}:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Enable or disable voiceover for an agent instance.
   * Creates/destroys VoiceStream based on the agent's voice config.
   */
  setVoiceover(instanceId: string, enabled: boolean): { success: boolean; error?: string } {
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: 'Instance not found' };

    const agentConfig = this.agents.get(instance.agentConfigId);
    if (!agentConfig?.voiceEnabled) {
      return { success: false, error: 'Voice not configured for this agent' };
    }

    if (enabled && !instance.voiceStream) {
      try {
        // Determine TTS connector (may differ from LLM connector)
        const ttsConnectorName = agentConfig.voiceConnector || agentConfig.connector;

        // Ensure the connector is registered in the Connector registry
        if (!Connector.has(ttsConnectorName)) {
          const connectorConfig = this.connectors.get(ttsConnectorName);
          if (!connectorConfig) {
            return { success: false, error: `Connector "${ttsConnectorName}" not found` };
          }
          Connector.create({
            name: ttsConnectorName,
            vendor: connectorConfig.vendor as typeof Vendor[keyof typeof Vendor],
            auth: connectorConfig.auth as any,
            baseURL: connectorConfig.baseURL,
          });
        }

        instance.voiceStream = VoiceStream.create({
          ttsConnector: ttsConnectorName,
          ttsModel: agentConfig.voiceModel,
          voice: agentConfig.voiceVoice,
          format: (agentConfig.voiceFormat ?? 'mp3') as any,
          speed: agentConfig.voiceSpeed ?? 1.0,
        });

        logger.info(`[setVoiceover] Enabled voiceover for instance ${instanceId} (model: ${agentConfig.voiceModel}, voice: ${agentConfig.voiceVoice})`);
      } catch (error) {
        logger.error(`[setVoiceover] Failed to create VoiceStream: ${error}`);
        return { success: false, error: String(error) };
      }
    } else if (!enabled && instance.voiceStream) {
      instance.voiceStream.interrupt();
      instance.voiceStream.destroy();
      instance.voiceStream = undefined;
      logger.info(`[setVoiceover] Disabled voiceover for instance ${instanceId}`);
    }

    instance.voiceoverEnabled = enabled;
    return { success: true };
  }

  /**
   * Get an agent instance by ID
   */
  getInstance(instanceId: string): AgentInstance | null {
    return this.instances.get(instanceId) || null;
  }

  /**
   * List all active instances
   */
  listInstances(): Array<{ instanceId: string; agentConfigId: string; createdAt: number }> {
    return Array.from(this.instances.values()).map(inst => ({
      instanceId: inst.instanceId,
      agentConfigId: inst.agentConfigId,
      createdAt: inst.createdAt,
    }));
  }

  /**
   * Stream a message to a specific agent instance
   */
  async *streamInstance(instanceId: string, message: string): AsyncGenerator<StreamChunk> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      yield { type: 'error', content: `Instance "${instanceId}" not found` };
      return;
    }

    // Track when we're in plan mode to suppress text output
    let suppressText = false;

    try {
      // Check if the agent has a stream method
      if ('stream' in instance.agent && typeof instance.agent.stream === 'function') {
        // Wrap with VoiceStream when voiceover is enabled
        const rawStream = instance.agent.stream(message);
        const eventStream = (instance.voiceoverEnabled && instance.voiceStream)
          ? instance.voiceStream.wrap(rawStream)
          : rawStream;

        for await (const event of eventStream) {
          // Cast through unknown to support various event type formats
          const e = event as unknown as { type: string; [key: string]: unknown };

          // Detect plan mode transitions to control text suppression
          if (e.type === 'plan:analyzing' || e.type === 'plan:created') {
            suppressText = true;
          } else if (e.type === 'plan:approved' || e.type === 'mode:changed') {
            const modeEvent = e as { type: string; to?: string };
            if (e.type === 'mode:changed' && modeEvent.to === 'interactive') {
              suppressText = false;
            }
          } else if (e.type === 'execution:done') {
            suppressText = false;
          }

          // Handle StreamEventType format from Agent.stream()
          // StreamEventType: response.output_text.delta, response.tool_execution.start, etc.
          // Legacy: text:delta, tool:start, etc.

          // Thinking/reasoning events
          if (e.type === 'response.reasoning.delta') {
            const delta = (e as any).delta || '';
            yield { type: 'thinking', content: delta };
          }
          else if (e.type === 'response.reasoning.done') {
            const thinking = (e as any).thinking || '';
            yield { type: 'thinking_done', content: thinking };
          }
          // Text events
          else if (e.type === 'text:delta' || e.type === 'response.output_text.delta') {
            if (!suppressText) {
              const delta = (e as any).delta || '';
              yield { type: 'text', content: delta };
            }
          }
          // Tool start events
          else if (e.type === 'tool:start' || e.type === 'response.tool_execution.start') {
            const toolName = (e as any).name || (e as any).tool_name || 'unknown';
            const args = ((e as any).args || (e as any).arguments || {}) as Record<string, unknown>;
            const tool = instance.agent.tools?.get(toolName);
            let description = '';
            if (tool?.describeCall) {
              try {
                description = tool.describeCall(args);
              } catch {
                description = defaultDescribeCall(args);
              }
            } else {
              description = defaultDescribeCall(args);
            }
            yield { type: 'tool_start', tool: toolName, args, description };
          }
          // Tool complete events
          else if (e.type === 'tool:complete' || e.type === 'response.tool_execution.done') {
            const toolName = (e as any).name || (e as any).tool_name || 'unknown';
            const durationMs = (e as any).durationMs || (e as any).execution_time_ms || 0;
            const result = (e as any).result;
            // Check for error in tool execution done
            if ((e as any).error) {
              yield { type: 'tool_error', tool: toolName, error: (e as any).error, result };
            } else {
              yield { type: 'tool_end', tool: toolName, durationMs, result };
            }
          }
          // Legacy tool error format
          else if (e.type === 'tool:error') {
            yield { type: 'tool_error', tool: (e as any).name, error: (e as any).error };
          }
          // Done events
          else if (e.type === 'text:done' || e.type === 'response.complete') {
            yield { type: 'done' };
          }
          // Error events
          else if (e.type === 'error' || e.type === 'response.error') {
            yield { type: 'error', content: (e as any).error || (e as any).message || 'Unknown error' };
          }
          // Plan events
          else if (e.type === 'plan:created') {
            yield { type: 'plan:created', plan: this.serializePlan((e as any).plan) };
          } else if (e.type === 'plan:awaiting_approval') {
            yield { type: 'plan:awaiting_approval', plan: this.serializePlan((e as any).plan) };
          } else if (e.type === 'plan:approved') {
            yield { type: 'plan:approved', plan: this.serializePlan((e as any).plan) };
          } else if (e.type === 'plan:analyzing') {
            yield { type: 'plan:analyzing', goal: (e as any).goal };
          } else if (e.type === 'mode:changed') {
            yield { type: 'mode:changed', from: (e as any).from, to: (e as any).to, reason: (e as any).reason };
          } else if (e.type === 'needs:approval') {
            yield { type: 'needs:approval', plan: this.serializePlan((e as any).plan) };
          }
          // Task events
          else if (e.type === 'task:started') {
            yield { type: 'task:started', task: this.serializeTask((e as any).task) };
          } else if (e.type === 'task:progress') {
            yield { type: 'task:progress', task: this.serializeTask((e as any).task), status: (e as any).status };
          } else if (e.type === 'task:completed') {
            yield { type: 'task:completed', task: this.serializeTask((e as any).task), result: (e as any).result };
          } else if (e.type === 'task:failed') {
            yield { type: 'task:failed', task: this.serializeTask((e as any).task), error: (e as any).error };
          }
          // Execution events
          else if (e.type === 'execution:done') {
            yield { type: 'execution:done', result: (e as any).result };
          } else if (e.type === 'execution:paused') {
            yield { type: 'execution:paused', reason: (e as any).reason };
          }
          // Voice pseudo-streaming events (from VoiceStream.wrap)
          else if (e.type === 'response.audio_chunk.ready') {
            yield {
              type: 'voice:chunk',
              chunkIndex: (e as any).chunk_index,
              audioBase64: (e as any).audio_base64,
              format: (e as any).format,
              durationSeconds: (e as any).duration_seconds,
              text: (e as any).text,
            };
          } else if (e.type === 'response.audio_chunk.error') {
            yield {
              type: 'voice:error',
              chunkIndex: (e as any).chunk_index,
              error: (e as any).error,
              text: (e as any).text,
            };
          } else if (e.type === 'response.audio_stream.complete') {
            yield {
              type: 'voice:complete',
              totalChunks: (e as any).total_chunks,
              totalDurationSeconds: (e as any).total_duration_seconds,
            };
          }
        }
      } else if ('run' in instance.agent && typeof instance.agent.run === 'function') {
        // Fallback for basic Agent that doesn't have stream - use run
        const response = await (instance.agent as Agent).run(message);
        yield { type: 'text', content: response.output_text || '' };
        yield { type: 'done' };
      } else {
        yield { type: 'error', content: 'Agent does not support streaming or run methods' };
      }

      // Flush any pending InContextMemory entries to the renderer.
      // The onEntriesChanged debounce (100ms) may not have fired yet, so we
      // emit a final snapshot here to guarantee the renderer receives entries.
      const ctx = instance.agent.context as AgentContextNextGen;
      const icmPlugin = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory');
      if (icmPlugin) {
        const allEntries = Array.from(icmPlugin.getContents().values());
        if (allEntries.length > 0) {
          const pinnedKeys = this.getPinnedContextKeysSync(instance.agentConfigId);
          yield {
            type: 'ui:context_entries',
            entries: allEntries.map(e => ({
              key: e.key,
              description: e.description,
              value: e.value,
              priority: e.priority,
              showInUI: e.showInUI ?? false,
              updatedAt: e.updatedAt,
            })),
            pinnedKeys,
          };
        }
      }
    } catch (error) {
      yield { type: 'error', content: String(error) };
    }
  }

  /**
   * Cancel an operation on a specific instance
   */
  cancelInstance(instanceId: string): { success: boolean; error?: string } {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    if ('cancel' in instance.agent && typeof instance.agent.cancel === 'function') {
      instance.agent.cancel();
    }
    return { success: true };
  }

  /**
   * Take user control of the browser - pauses the agent
   */
  takeUserControl(instanceId: string, reason?: string): { success: boolean; error?: string } {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    const pauseReason = reason || 'User took manual control';
    instance.agent.pause(pauseReason);

    // Emit stream chunk so UI knows
    this.streamEmitter?.(instanceId, {
      type: 'browser:user_has_control',
      reason: pauseReason,
    } as StreamChunk);

    logger.info(`[takeUserControl] Agent ${instanceId} paused: ${pauseReason}`);
    return { success: true };
  }

  /**
   * Hand control back to the agent - resumes execution
   */
  handBackToAgent(instanceId: string): { success: boolean; error?: string } {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    // Resume the agent
    instance.agent.resume();

    // Emit stream chunk so UI knows
    this.streamEmitter?.(instanceId, {
      type: 'browser:agent_has_control',
    } as StreamChunk);

    logger.info(`[handBackToAgent] Agent ${instanceId} resumed`);
    return { success: true };
  }

  /**
   * Get status of a specific instance
   */
  getInstanceStatus(instanceId: string): {
    found: boolean;
    initialized: boolean;
    connector: string | null;
    model: string | null;
    mode: string | null;
    agentConfigId: string | null;
  } {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return {
        found: false,
        initialized: false,
        connector: null,
        model: null,
        mode: null,
        agentConfigId: null,
      };
    }

    const agentConfig = this.agents.get(instance.agentConfigId);
    return {
      found: true,
      initialized: true,
      connector: agentConfig?.connector || null,
      model: agentConfig?.model || null,
      mode: null, // Mode concept removed in NextGen (was UniversalAgent-specific)
      agentConfigId: instance.agentConfigId,
    };
  }

  /**
   * Get a context snapshot for a specific instance.
   * If instanceId is null, falls back to legacy single agent behavior.
   * Returns IContextSnapshot from the core library.
   */
  async getSnapshotForInstance(instanceId: string | null): Promise<IContextSnapshot> {
    const agent = this.resolveAgent(instanceId);
    if (!agent) {
      return { available: false, agentId: '', model: '', features: {} as any, budget: {} as any, strategy: '', messagesCount: 0, toolCallsCount: 0, systemPrompt: null, plugins: [], tools: [] };
    }
    return agent.getSnapshot();
  }

  /**
   * Helper to resolve an Agent from instanceId or fallback to legacy single agent.
   */
  private resolveAgent(instanceId: string | null): Agent | null {
    if (instanceId) {
      const instance = this.instances.get(instanceId);
      return instance?.agent ?? null;
    }
    return this.agent;
  }

  /**
   * Get memory value for a specific instance
   */
  async getMemoryValueForInstance(instanceId: string | null, key: string): Promise<unknown> {
    let agent: Agent | null = null;

    if (instanceId) {
      const instance = this.instances.get(instanceId);
      if (instance) {
        agent = instance.agent;
      }
    } else {
      agent = this.agent;
    }

    if (!agent?.context?.memory) {
      return null;
    }

    try {
      return await agent.context.memory.retrieve(key);
    } catch {
      return null;
    }
  }

  /**
   * Force compaction for a specific instance
   */
  async forceCompactionForInstance(instanceId: string | null): Promise<{ success: boolean; tokensFreed: number; error?: string }> {
    let agent: Agent | null = null;

    if (instanceId) {
      const instance = this.instances.get(instanceId);
      if (instance) {
        agent = instance.agent;
      }
    } else {
      agent = this.agent;
    }

    if (!agent) {
      return { success: false, tokensFreed: 0, error: 'No agent found' };
    }

    try {
      // NextGen uses calculateBudget() and prepare() for compaction
      const ctx = agent.context as AgentContextNextGen;
      const beforeBudget = await ctx.calculateBudget();
      const beforeUsed = beforeBudget.totalUsed;

      // prepare() triggers compaction if above threshold
      await ctx.prepare();

      const afterBudget = await ctx.calculateBudget();
      const afterUsed = afterBudget.totalUsed;
      const tokensFreed = Math.max(0, beforeUsed - afterUsed);

      return { success: true, tokensFreed };
    } catch (error) {
      return { success: false, tokensFreed: 0, error: String(error) };
    }
  }

  // NOTE: getInternalsForAgent() removed — replaced by agent.getSnapshot() from core library

  // ============ Internals Monitoring (Look Inside) ============

  /**
   * Internals data types for monitoring
   */

  /**
   * Get snapshot for legacy single agent (for backwards compat).
   * Delegates to getSnapshotForInstance(null).
   */
  async getInternals(): Promise<IContextSnapshot> {
    return this.getSnapshotForInstance(null);
  }

  /**
   * Get just the context stats (lighter weight for frequent polling)
   */
  async getContextStats(): Promise<{
    available: boolean;
    totalTokens: number;
    maxTokens: number;
    utilizationPercent: number;
    messagesCount: number;
    toolCallsCount: number;
    strategy: string;
  } | null> {
    if (!this.agent) {
      return null;
    }

    try {
      // NextGen uses calculateBudget() instead of getMetrics()
      const ctx = this.agent.context as AgentContextNextGen;
      const budget = await ctx.calculateBudget();

      return {
        available: true,
        totalTokens: budget.totalUsed,
        maxTokens: budget.maxTokens,
        utilizationPercent: budget.utilizationPercent,
        messagesCount: ctx.getConversationLength(),
        toolCallsCount: 0, // NextGen doesn't track tool calls in context
        strategy: ctx.strategy,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get memory entries only
   */
  async getMemoryEntries(): Promise<Array<{
    key: string;
    description: string;
    scope: string;
    priority: string;
    sizeBytes: number;
    updatedAt: number;
    value?: unknown;
  }>> {
    // NextGen uses memory.getState() instead of getIndex()
    const ctx = this.agent?.context as AgentContextNextGen | undefined;
    if (!ctx?.memory) {
      return [];
    }

    try {
      const memState = ctx.memory.getState();
      const result = [];
      for (const entry of memState.entries) {
        result.push({
          key: entry.key,
          description: entry.description,
          scope: String(typeof entry.scope === 'object' ? JSON.stringify(entry.scope) : entry.scope),
          priority: entry.basePriority || 'normal',
          sizeBytes: entry.sizeBytes || 0,
          updatedAt: Date.now(),
          value: entry.value,
        });
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Get a single memory entry value by key
   */
  async getMemoryValue(key: string): Promise<unknown> {
    if (!this.agent?.context?.memory) {
      return null;
    }

    try {
      return await this.agent.context.memory.retrieve(key);
    } catch {
      return null;
    }
  }

  /**
   * Get the full prepared context (View Context).
   * Uses agent.getViewContext() from the core library.
   */
  async getPreparedContext(): Promise<IViewContextData> {
    if (!this.agent) {
      return { available: false, components: [], totalTokens: 0, rawContext: '' };
    }
    try {
      return await this.agent.getViewContext();
    } catch (error) {
      console.error('Error getting prepared context:', error);
      return { available: false, components: [], totalTokens: 0, rawContext: `Error: ${error}` };
    }
  }

  /**
   * Get prepared context for a specific instance (multi-tab support).
   * Uses agent.getViewContext() from the core library.
   */
  async getPreparedContextForInstance(instanceId: string): Promise<IViewContextData> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return { available: false, components: [], totalTokens: 0, rawContext: `Instance "${instanceId}" not found` };
    }
    try {
      return await instance.agent.getViewContext();
    } catch (error) {
      console.error('Error getting prepared context for instance:', error);
      return { available: false, components: [], totalTokens: 0, rawContext: `Error: ${error}` };
    }
  }

  /**
   * Force compaction of the context
   * Useful when auto-compaction hasn't triggered but context is high
   */
  async forceCompaction(): Promise<{ success: boolean; tokensFreed: number; error?: string }> {
    if (!this.agent) {
      return { success: false, tokensFreed: 0, error: 'No agent initialized' };
    }

    try {
      // NextGen uses calculateBudget() instead of getLastBudget()
      const ctx = this.agent.context as AgentContextNextGen;
      const beforeBudget = await ctx.calculateBudget();
      const beforeUsed = beforeBudget.totalUsed;

      // prepare() triggers compaction if above threshold
      await ctx.prepare();

      const afterBudget = await ctx.calculateBudget();
      const afterUsed = afterBudget.totalUsed;
      const tokensFreed = Math.max(0, beforeUsed - afterUsed);

      return {
        success: true,
        tokensFreed,
      };
    } catch (error) {
      console.error('Error forcing compaction:', error);
      return {
        success: false,
        tokensFreed: 0,
        error: String(error),
      };
    }
  }

  // ============ Multimedia - Image Generation ============

  /**
   * Get available image models based on configured connectors
   */
  getAvailableImageModels(): Array<{
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
  }> {
    // Get vendors from configured connectors
    const configuredVendors = new Set(
      Array.from(this.connectors.values()).map((c) => c.vendor)
    );

    // Get all active image models
    const allModels = getActiveImageModels();

    // Filter to only show models for configured vendors
    // Map vendor names to match what's stored in connectors
    const vendorMapping: Record<string, string[]> = {
      openai: ['openai'],
      google: ['google', 'google-vertex'],
      grok: ['grok'],
    };

    return allModels
      .filter((model) => {
        const modelVendor = model.provider.toLowerCase();
        // Check if any configured vendor matches this model's vendor
        return Array.from(configuredVendors).some((configuredVendor) => {
          const mapped = vendorMapping[configuredVendor] || [configuredVendor];
          return mapped.includes(modelVendor);
        });
      })
      .map((model) => ({
        name: model.name,
        displayName: model.displayName,
        vendor: model.provider.toLowerCase(),
        description: model.description,
        deprecationDate: model.deprecationDate,
        maxPromptLength: model.capabilities.limits.maxPromptLength,
        maxImagesPerRequest: model.capabilities.maxImagesPerRequest,
        pricing: model.pricing,
      }));
  }

  /**
   * Get capabilities for a specific image model
   */
  getImageModelCapabilities(modelName: string): {
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
  } | null {
    const model = getImageModelInfo(modelName);
    if (!model) return null;

    return model.capabilities;
  }

  /**
   * Calculate estimated cost for image generation
   */
  calculateImageCost(
    modelName: string,
    imageCount: number,
    quality: 'standard' | 'hd' = 'standard'
  ): number | null {
    return calculateImageCost(modelName, imageCount, quality);
  }

  /**
   * Generate an image using the specified model
   */
  async generateImage(options: {
    model: string;
    prompt: string;
    size?: string;
    quality?: string;
    style?: string;
    n?: number;
    [key: string]: unknown;
  }): Promise<{
    success: boolean;
    data?: {
      images: Array<{
        b64_json?: string;
        url?: string;
        revisedPrompt?: string;
      }>;
    };
    error?: string;
  }> {
    try {
      // Get the model info to determine the vendor
      const modelInfo = getImageModelInfo(options.model);
      if (!modelInfo) {
        return { success: false, error: `Unknown model: ${options.model}` };
      }

      const vendor = modelInfo.provider.toLowerCase();

      // Find a connector for this vendor
      const connector = Array.from(this.connectors.values()).find(
        (c) => c.vendor.toLowerCase() === vendor
      );

      if (!connector) {
        return {
          success: false,
          error: `No connector configured for vendor: ${vendor}`,
        };
      }

      // Ensure connector is registered with the library
      if (!Connector.has(connector.name)) {
        Connector.create({
          name: connector.name,
          vendor: connector.vendor as Vendor,
          auth: connector.auth,
          baseURL: connector.baseURL,
        });
      }

      // Create ImageGeneration instance
      const imageGen = ImageGeneration.create({ connector: connector.name });

      // Extract standard options
      const { model, prompt, size, quality, style, n, ...vendorOptions } = options;

      // Generate image
      const response = await imageGen.generate({
        model,
        prompt,
        size,
        quality: quality as 'standard' | 'hd' | undefined,
        style: style as 'vivid' | 'natural' | undefined,
        n,
        response_format: 'b64_json',
        // Pass vendor-specific options
        ...vendorOptions,
      });

      // Map response to our format
      return {
        success: true,
        data: {
          images: response.data.map((img) => ({
            b64_json: img.b64_json,
            url: img.url,
            revisedPrompt: img.revised_prompt,
          })),
        },
      };
    } catch (error) {
      console.error('Error generating image:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============ Multimedia - Video Generation ============

  /**
   * Get available video models based on configured connectors
   */
  getAvailableVideoModels(): Array<{
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
  }> {
    // Get vendors from configured connectors
    const configuredVendors = new Set(
      Array.from(this.connectors.values()).map((c) => c.vendor)
    );

    // Get all active video models
    const allModels = getActiveVideoModels();

    // Map vendor names to match what's stored in connectors
    const vendorMapping: Record<string, string[]> = {
      openai: ['openai'],
      google: ['google', 'google-vertex'],
      grok: ['grok'],
    };

    return allModels
      .filter((model) => {
        const modelVendor = model.provider.toLowerCase();
        // Check if any configured vendor matches this model's vendor
        return Array.from(configuredVendors).some((configuredVendor) => {
          const mapped = vendorMapping[configuredVendor] || [configuredVendor];
          return mapped.includes(modelVendor);
        });
      })
      .map((model) => ({
        name: model.name,
        displayName: model.displayName,
        vendor: model.provider.toLowerCase(),
        description: model.description,
        durations: model.capabilities.durations,
        resolutions: model.capabilities.resolutions,
        maxFps: model.capabilities.maxFps,
        audio: model.capabilities.audio,
        imageToVideo: model.capabilities.imageToVideo,
        pricing: model.pricing,
      }));
  }

  /**
   * Get capabilities for a specific video model
   */
  getVideoModelCapabilities(modelName: string): {
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
  } | null {
    const model = getVideoModelInfo(modelName);
    if (!model) return null;

    return {
      durations: model.capabilities.durations,
      resolutions: model.capabilities.resolutions,
      aspectRatios: model.capabilities.aspectRatios,
      maxFps: model.capabilities.maxFps,
      audio: model.capabilities.audio,
      imageToVideo: model.capabilities.imageToVideo,
      videoExtension: model.capabilities.videoExtension,
      frameControl: model.capabilities.frameControl,
      features: model.capabilities.features,
      pricing: model.pricing,
    };
  }

  /**
   * Calculate estimated cost for video generation
   */
  calculateVideoCost(modelName: string, durationSeconds: number): number | null {
    return calculateVideoCost(modelName, durationSeconds);
  }

  /**
   * Start video generation - returns a job ID for polling
   */
  async generateVideo(options: {
    model: string;
    prompt: string;
    duration?: number;
    resolution?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
    image?: string; // base64 image data
    seed?: number;
    vendorOptions?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    jobId?: string;
    error?: string;
  }> {
    try {
      // Get the model info to determine the vendor
      const modelInfo = getVideoModelInfo(options.model);
      if (!modelInfo) {
        return { success: false, error: `Unknown model: ${options.model}` };
      }

      const vendor = modelInfo.provider.toLowerCase();

      // Find a connector for this vendor
      const connector = Array.from(this.connectors.values()).find(
        (c) => c.vendor.toLowerCase() === vendor
      );

      if (!connector) {
        return {
          success: false,
          error: `No connector configured for vendor: ${vendor}`,
        };
      }

      // Ensure connector is registered with the library
      if (!Connector.has(connector.name)) {
        Connector.create({
          name: connector.name,
          vendor: connector.vendor as Vendor,
          auth: connector.auth,
          baseURL: connector.baseURL,
        });
      }

      // Create VideoGeneration instance
      const videoGen = VideoGeneration.create({ connector: connector.name });

      // Convert base64 image to Buffer if provided
      let imageBuffer: Buffer | undefined;
      if (options.image) {
        // Remove data URL prefix if present
        const base64Data = options.image.startsWith('data:')
          ? options.image.split(',')[1]
          : options.image;
        imageBuffer = Buffer.from(base64Data, 'base64');
      }

      // Start video generation
      const response = await videoGen.generate({
        model: options.model,
        prompt: options.prompt,
        duration: options.duration,
        resolution: options.resolution,
        aspectRatio: options.aspectRatio,
        image: imageBuffer,
        seed: options.seed,
        vendorOptions: options.vendorOptions,
      });

      // Store the job for later status checks
      this.activeVideoJobs.set(response.jobId, {
        connectorName: connector.name,
        videoGen,
      });

      return {
        success: true,
        jobId: response.jobId,
      };
    } catch (error) {
      console.error('Error starting video generation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the status of a video generation job
   */
  async getVideoStatus(jobId: string): Promise<{
    success: boolean;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    video?: {
      url?: string;
      duration?: number;
    };
    error?: string;
  }> {
    try {
      const job = this.activeVideoJobs.get(jobId);
      if (!job) {
        return { success: false, error: `Job not found: ${jobId}` };
      }

      const status = await job.videoGen.getStatus(jobId);

      return {
        success: true,
        status: status.status,
        progress: status.progress,
        video: status.video ? {
          url: status.video.url,
          duration: status.video.duration,
        } : undefined,
        error: status.error,
      };
    } catch (error) {
      console.error('Error getting video status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Download a completed video as base64
   */
  async downloadVideo(jobId: string): Promise<{
    success: boolean;
    data?: string; // base64 encoded video
    mimeType?: string;
    error?: string;
  }> {
    try {
      const job = this.activeVideoJobs.get(jobId);
      if (!job) {
        return { success: false, error: `Job not found: ${jobId}` };
      }

      const videoBuffer = await job.videoGen.download(jobId);

      // Clean up the job after download
      this.activeVideoJobs.delete(jobId);

      return {
        success: true,
        data: videoBuffer.toString('base64'),
        mimeType: 'video/mp4',
      };
    } catch (error) {
      console.error('Error downloading video:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cancel a video generation job
   */
  async cancelVideoJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const job = this.activeVideoJobs.get(jobId);
      if (!job) {
        return { success: false, error: `Job not found: ${jobId}` };
      }

      await job.videoGen.cancel(jobId);
      this.activeVideoJobs.delete(jobId);

      return { success: true };
    } catch (error) {
      console.error('Error canceling video job:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============ Multimedia - Text-to-Speech ============

  /**
   * Get available TTS models based on configured connectors
   */
  getAvailableTTSModels(): Array<{
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
  }> {
    // Build a map of vendor → connector names (a vendor may have multiple connectors)
    const vendorToConnectors = new Map<string, string[]>();
    for (const [, c] of this.connectors) {
      const list = vendorToConnectors.get(c.vendor) || [];
      list.push(c.name);
      vendorToConnectors.set(c.vendor, list);
    }

    // Map TTS model vendor names to connector vendor names
    const vendorMapping: Record<string, string[]> = {
      openai: ['openai'],
      google: ['google', 'google-vertex'],
    };

    // Get all active TTS models
    const allModels = getActiveTTSModels();

    const results: Array<{
      name: string;
      displayName: string;
      vendor: string;
      connector: string;
      description?: string;
      maxInputLength: number;
      voiceCount: number;
      pricing?: { per1kCharacters: number; currency: string };
    }> = [];

    for (const model of allModels) {
      const modelVendor = model.provider.toLowerCase();
      // Find all connector vendors that can serve this model
      for (const [connectorVendor, connectorNames] of vendorToConnectors) {
        const mapped = vendorMapping[connectorVendor] || [connectorVendor];
        if (mapped.includes(modelVendor)) {
          // Emit one entry per connector that can serve this model
          for (const connectorName of connectorNames) {
            results.push({
              name: model.name,
              displayName: model.displayName,
              vendor: model.provider.toLowerCase(),
              connector: connectorName,
              description: model.description,
              maxInputLength: model.capabilities.limits.maxInputLength,
              voiceCount: model.capabilities.voices.length,
              pricing: model.pricing as { per1kCharacters: number; currency: string } | undefined,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Get capabilities for a specific TTS model
   */
  getTTSModelCapabilities(modelName: string): {
    voices: IVoiceInfo[];
    formats: readonly string[] | string[];
    languages: readonly string[] | string[];
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
  } | null {
    const model = getTTSModelInfo(modelName);
    if (!model) return null;

    return model.capabilities;
  }

  /**
   * Calculate estimated cost for TTS
   */
  calculateTTSCost(modelName: string, characterCount: number): number | null {
    return calculateTTSCost(modelName, characterCount);
  }

  /**
   * Synthesize speech from text
   */
  async synthesizeSpeech(options: {
    model: string;
    text: string;
    voice: string;
    format?: string;
    speed?: number;
    vendorOptions?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    data?: {
      audio: string; // base64 encoded
      format: string;
    };
    error?: string;
  }> {
    try {
      // Get the model info to determine the vendor
      const modelInfo = getTTSModelInfo(options.model);
      if (!modelInfo) {
        return { success: false, error: `Unknown TTS model: ${options.model}` };
      }

      const vendor = modelInfo.provider.toLowerCase();

      // Find a connector for this vendor
      const connector = Array.from(this.connectors.values()).find(
        (c) => c.vendor.toLowerCase() === vendor
      );

      if (!connector) {
        return {
          success: false,
          error: `No connector configured for vendor: ${vendor}`,
        };
      }

      // Ensure connector is registered with the library
      if (!Connector.has(connector.name)) {
        Connector.create({
          name: connector.name,
          vendor: connector.vendor as Vendor,
          auth: connector.auth,
          baseURL: connector.baseURL,
        });
      }

      // Create TextToSpeech instance
      const tts = TextToSpeech.create({
        connector: connector.name,
        model: options.model,
      });

      // Synthesize speech
      const response = await tts.synthesize(options.text, {
        voice: options.voice,
        format: options.format as any,
        speed: options.speed,
        vendorOptions: options.vendorOptions,
      });

      return {
        success: true,
        data: {
          audio: response.audio.toString('base64'),
          format: response.format,
        },
      };
    } catch (error) {
      console.error('Error synthesizing speech:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============ Routine Methods ============

  async listRoutines(options?: { tags?: string[]; search?: string }): Promise<RoutineDefinition[]> {
    return this.routineStorage.list(undefined, options);
  }

  async getRoutine(id: string): Promise<RoutineDefinition | null> {
    return this.routineStorage.load(undefined, id);
  }

  async saveRoutine(input: RoutineDefinitionInput): Promise<{ id: string }> {
    // If input has an id, try to load existing to preserve createdAt
    let def: RoutineDefinition;
    if (input.id) {
      const existing = await this.routineStorage.load(undefined, input.id);
      if (existing) {
        // Update existing
        def = {
          ...existing,
          ...input,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        } as RoutineDefinition;
      } else {
        def = createRoutineDefinition(input);
      }
    } else {
      def = createRoutineDefinition(input);
    }
    await this.routineStorage.save(undefined, def);
    return { id: def.id };
  }

  async deleteRoutine(id: string): Promise<void> {
    await this.routineStorage.delete(undefined, id);
  }

  async duplicateRoutine(id: string): Promise<{ id: string }> {
    const original = await this.routineStorage.load(undefined, id);
    if (!original) {
      throw new Error(`Routine "${id}" not found`);
    }
    const duplicated = createRoutineDefinition({
      name: `Copy of ${original.name}`,
      description: original.description,
      version: original.version,
      tasks: original.tasks,
      requiredTools: original.requiredTools,
      requiredPlugins: original.requiredPlugins,
      instructions: original.instructions,
      concurrency: original.concurrency,
      allowDynamicTasks: original.allowDynamicTasks,
      tags: original.tags,
      author: original.author,
      metadata: original.metadata,
    });
    await this.routineStorage.save(undefined, duplicated);
    return { id: duplicated.id };
  }

  validateRoutine(input: RoutineDefinitionInput): { valid: boolean; error?: string } {
    try {
      createRoutineDefinition(input);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async executeRoutineOnInstance(instanceId: string, routineId: string): Promise<{ executionId: string }> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance "${instanceId}" not found`);
    }

    const definition = await this.routineStorage.load(undefined, routineId);
    if (!definition) {
      throw new Error(`Routine "${routineId}" not found`);
    }

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const emitter = this.streamEmitter;

    // Emit started event
    emitter?.(instanceId, {
      type: 'routine:started',
      executionId,
      routineName: definition.name,
      taskCount: definition.tasks.length,
    });

    // Fire-and-forget — execution state flows via stream events
    executeRoutine({
      definition,
      agent: instance.agent,
      onTaskStarted: (task) => {
        emitter?.(instanceId, {
          type: 'routine:task_started',
          executionId,
          taskId: task.id,
          taskName: task.name,
        });
      },
      onTaskComplete: (task, execution) => {
        emitter?.(instanceId, {
          type: 'routine:task_completed',
          executionId,
          taskId: task.id,
          taskName: task.name,
          progress: execution.progress,
          output: task.result?.output ? String(task.result.output).substring(0, 500) : undefined,
        });
      },
      onTaskFailed: (task, execution) => {
        emitter?.(instanceId, {
          type: 'routine:task_failed',
          executionId,
          taskId: task.id,
          taskName: task.name,
          progress: execution.progress,
          error: task.result?.error || 'Unknown error',
        });
      },
      onTaskValidation: (task, result) => {
        emitter?.(instanceId, {
          type: 'routine:step',
          executionId,
          step: {
            timestamp: Date.now(),
            taskName: task.name,
            type: 'validation',
            data: { score: result.completionScore, passed: result.isComplete, explanation: result.explanation },
          },
        });
      },
    }).then((execution) => {
      emitter?.(instanceId, {
        type: 'routine:completed',
        executionId,
        progress: execution.progress,
      });
    }).catch((error) => {
      emitter?.(instanceId, {
        type: 'routine:failed',
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { executionId };
  }

  cancelRoutineExecution(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && 'cancel' in instance.agent && typeof instance.agent.cancel === 'function') {
      instance.agent.cancel();
    }
  }
}
