/**
 * AMOS Configuration Types
 * Type definitions for the app configuration and state
 */

import type {
  InputItem,
  PermissionScope,
  ReasoningEffort,
  RiskLevel,
  ToolFunction,
  Vendor,
} from '@everworker/oneringai';
import type { ExternalToolManager } from '../tools/ExternalToolManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// App Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface AmosConfig {
  // Current active settings
  activeConnector: string | null;
  activeModel: string | null;
  activeVendor: string | null;

  // Default settings
  defaults: {
    vendor: string;
    model: string;
    temperature: number;
    reasoningEffort: ReasoningEffort;
    maxOutputTokens: number;
  };

  // Planning settings
  planning: {
    enabled: boolean;
    autoDetect: boolean;
    requireApproval: boolean;
  };

  // Session settings
  session: {
    autoSave: boolean;
    autoSaveIntervalMs: number;
    activeSessionId: string | null;
  };

  // UI settings
  ui: {
    showTokenUsage: boolean;
    showTiming: boolean;
    streamResponses: boolean;
    colorOutput: boolean;
  };

  // Tool settings
  tools: {
    enabledTools: string[];
    disabledTools: string[];
    customToolsDir: string;
  };

  // Tool permission settings
  permissions: {
    defaultScope: PermissionScope;
    defaultRiskLevel: RiskLevel;
    allowlist: string[];
    blocklist: string[];
    toolOverrides: Record<string, { scope?: PermissionScope; riskLevel?: RiskLevel }>;
    promptForApproval: boolean; // Interactive approval prompts
  };

  // Prompt template settings
  prompts: {
    promptsDir: string;
    activePrompt: string | null;
  };

  // Developer tools settings
  developerTools: {
    enabled: boolean;
    workingDirectory: string;
    allowedDirectories: string[];
    blockedDirectories: string[];
    blockedCommands: string[];
    commandTimeout: number;
  };

  // External tools settings (connector-dependent tools)
  externalTools: ExternalToolsConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector Configuration (stored in data/connectors/)
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredConnectorConfig {
  name: string;
  vendor: string;
  auth: ConnectorAuth;
  baseURL?: string;
  options?: Record<string, unknown>;
  models?: string[]; // Available models for this connector
  /** Service type for external APIs (search, scrape). E.g., 'serper', 'rapidapi-search', 'zenrows' */
  serviceType?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorAuth {
  type: 'api_key' | 'oauth';
  apiKey?: string;
  // Custom header configuration for API key auth
  headerName?: string;   // e.g., 'X-API-KEY', 'X-Subscription-Token'
  headerPrefix?: string; // e.g., '', 'Bearer' (empty string = no prefix)
  // OAuth fields
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  redirectUri?: string;
  scope?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command System Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandContext {
  app: IAmosApp;
  args: string[];
  rawInput: string;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
  shouldExit?: boolean;
  clearScreen?: boolean;
}

export interface ICommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  /** Detailed help text for this command */
  detailedHelp?: string;
  execute(context: CommandContext): Promise<CommandResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// App Interface (for dependency injection)
// ─────────────────────────────────────────────────────────────────────────────

export interface IAmosApp {
  // Configuration
  getConfig(): AmosConfig;
  updateConfig(partial: Partial<AmosConfig>): void;
  saveConfig(): Promise<void>;

  // Connectors
  getConnectorManager(): IConnectorManager;

  // Prompts
  getPromptManager(): IPromptManager;

  // Tools
  getToolLoader(): IToolLoader;
  getActiveTools(): ToolFunction[];

  // Commands
  getRegisteredCommands(): ICommand[];
  getCommand(name: string): ICommand | null;

  // Agent
  getAgent(): IAgentRunner | null;
  createAgent(options?: { freshSession?: boolean }): Promise<void>;
  destroyAgent(): void;

  // UI
  print(message: string): void;
  printError(message: string): void;
  printSuccess(message: string): void;
  printInfo(message: string): void;
  printDim(message: string): void;
  write(message: string): void;
  prompt(question: string): Promise<string>;
  confirm(question: string): Promise<boolean>;
  select<T extends string>(question: string, options: T[]): Promise<T>;
  setColorOutput(enabled: boolean): void;
}

export interface IConnectorManager {
  // CRUD
  list(): StoredConnectorConfig[];
  get(name: string): StoredConnectorConfig | null;
  add(config: StoredConnectorConfig): Promise<void>;
  update(name: string, config: Partial<StoredConnectorConfig>): Promise<void>;
  delete(name: string): Promise<void>;

  // Registration
  registerConnector(name: string): void;
  unregisterConnector(name: string): void;
  isRegistered(name: string): boolean;

  // Helpers
  getVendorConnectors(vendor: string): StoredConnectorConfig[];
  getModelsForConnector(name: string): string[];
}

export interface IToolLoader {
  // Loading
  loadBuiltinTools(): ToolFunction[];
  loadCustomTools(directory: string): Promise<ToolFunction[]>;
  reloadTools(): Promise<void>;
  applyConfig(enabledTools: string[], disabledTools: string[]): void;

  // Management
  getAllTools(): ToolFunction[];
  getTool(name: string): ToolFunction | null;
  enableTool(name: string): void;
  disableTool(name: string): void;
  isEnabled(name: string): boolean;
  getEnabledTools(): ToolFunction[];

  // Configuration
  setConfig(config: AmosConfig): void;
  setExternalToolManager(manager: ExternalToolManager): void;
  getExternalToolManager(): ExternalToolManager | null;

  // External tools
  getExternalToolInfo(): ExternalToolInfo[];
}

/**
 * External tool info for status display
 */
export interface ExternalToolInfo {
  /** Tool name (e.g., 'web_search', 'web_scrape', 'web_fetch') */
  name: string;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Provider type (null for tools that don't need connectors) */
  providerType: ExternalProviderType | null;
  /** Whether this tool requires a connector */
  requiresConnector: boolean;
  /** Whether the tool is available (has connector or doesn't need one) */
  available: boolean;
  /** Configured connector name (if any) */
  connectorName: string | null;
  /** Available providers for this tool type */
  supportedProviders: string[];
}

export interface IPromptManager {
  // Loading
  initialize(): Promise<void>;
  reload(): Promise<void>;

  // CRUD
  list(): PromptTemplate[];
  get(name: string): PromptTemplate | null;
  getContent(name: string): string | null;
  create(name: string, content: string, description?: string): Promise<void>;
  update(name: string, content: string, description?: string): Promise<void>;
  delete(name: string): Promise<void>;

  // Selection
  setActive(name: string | null): void;
  getActive(): PromptTemplate | null;
  getActiveContent(): string | null;
}

export interface PromptTemplate {
  name: string;
  description: string;
  content: string;
  filePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface IAgentRunner {
  // State
  isReady(): boolean;
  isRunning(): boolean;
  isPaused(): boolean;

  // Execution
  run(input: string): Promise<AgentResponse>;
  stream(input: string): AsyncGenerator<StreamEvent>;

  // Control
  pause(): void;
  resume(): void;
  cancel(): void;

  // Configuration
  setModel(model: string): void;
  getModel(): string;
  setTemperature(temp: number): void;
  getTemperature(): number;
  getReasoningEffort(): ReasoningEffort | null;

  // GPT-6 Astra Responses protocol demonstrations
  runAstraDirect(
    input: string | InputItem[],
    options?: { previousResponseId?: string; effort?: AstraReasoningEffort },
  ): Promise<AstraDirectResponse>;
  runAstraAsyncTool(toolName: string, prompt: string): Promise<AstraAsyncToolResponse>;

  // Session
  saveSession(name?: string): Promise<string>;
  loadSession(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionSummaryInfo[]>;
  deleteSession(sessionId: string): Promise<void>;
  getSessionId(): string | null;

  // Runtime configuration used by commands
  setInstructions(instructions: string | null): void;
  updateTools(tools: ToolFunction[]): void;
  getMode(): 'interactive' | 'planning' | 'executing';

  // Permission Management
  approveToolForSession(toolName: string): void;
  revokeToolApproval(toolName: string): void;
  allowlistTool(toolName: string): void;
  blocklistTool(toolName: string): void;
  removeFromAllowlist(toolName: string): void;
  removeFromBlocklist(toolName: string): void;
  getApprovedTools(): string[];
  getAllowlist(): string[];
  getBlocklist(): string[];
  toolNeedsApproval(toolName: string): boolean;
  toolIsBlocked(toolName: string): boolean;

  // Context Access (Phase 2 - unified context management)
  getContextMetrics(): Promise<ContextMetrics | null>;
  getConversationHistory(count?: number): Promise<HistoryEntry[]>;

  // Context Inspection (Phase 3 - detailed context inspection)
  getContextBudget(): Promise<ContextBudgetInfo | null>;
  getContextBreakdown(): Promise<ContextBreakdownInfo | null>;
  getCacheStats(): Promise<CacheStatsInfo | null>;
  getMemoryEntries(): Promise<MemoryEntryInfo[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context metrics from AgentContextNextGen
 */
export interface ContextMetrics {
  /** Number of messages in conversation history */
  historyMessageCount: number;
  /** Memory statistics */
  memoryStats: {
    totalEntries: number;
    totalSizeBytes: number;
  };
  /** Current agent mode */
  mode: 'interactive' | 'planning' | 'executing';
  /** Whether a plan is active */
  hasPlan: boolean;
}

/**
 * A single entry in the conversation history
 */
export interface HistoryEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface SessionSummaryInfo {
  id: string;
  title?: string;
  createdAt: Date;
  lastSavedAt: Date;
  messageCount: number;
  memoryEntryCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Inspection Types (Phase 3 - detailed context inspection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detailed context budget information
 */
export interface ContextBudgetInfo {
  /** Counts are estimates; prepared refers to the last selected request. */
  source?: 'prepared' | 'estimate';
  revision?: number;
  preparedAt?: number;
  /** Total tokens available for the model */
  total: number;
  /** Tokens reserved for response generation */
  reserved: number;
  /** Tokens currently used by context */
  used: number;
  /** Tokens available for additional context */
  available: number;
  /** Utilization as percentage (0-100) */
  utilizationPercent: number;
  /** Budget status indicator */
  status: 'ok' | 'warning' | 'critical';
}

/**
 * Token breakdown by component
 */
export interface ContextBreakdownInfo {
  source?: 'prepared' | 'estimate';
  revision?: number;
  preparedAt?: number;
  /** Total tokens used across all components */
  totalUsed: number;
  /** Individual component token usage */
  components: Array<{
    /** Component name */
    name: string;
    /** Tokens used by this component */
    tokens: number;
    /** Percentage of total used tokens */
    percent: number;
  }>;
}

/**
 * Cache statistics
 */
export interface CacheStatsInfo {
  /** Number of cached entries */
  entries: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate as percentage (0-100) */
  hitRate: number;
}

/**
 * Memory entry information
 */
export interface MemoryEntryInfo {
  /** Entry key */
  key: string;
  /** Human-readable description */
  description: string;
  /** Size in bytes */
  sizeBytes: number;
  /** Scope type */
  scope: string;
  /** Priority level */
  priority: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// External Tools Configuration (connector-dependent tools like search, scrape)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Types of external tool providers that require API connectors
 */
export type ExternalProviderType = 'search' | 'scrape';

/**
 * Available search providers
 */
export type SearchProvider = 'serper';

/**
 * Available scrape providers
 */
export type ScrapeProvider = 'zenrows';

/**
 * Configuration for a specific external provider
 */
export interface ExternalProviderConfig {
  /** The connector name to use (references a connector in data/connectors/) */
  connectorName: string;
  /** Whether this provider is enabled */
  enabled: boolean;
}

/**
 * External tools configuration
 * Manages tools that require external API connectors
 */
export interface ExternalToolsConfig {
  /** Global enable/disable for all external tools */
  enabled: boolean;
  /** Search provider configuration (web_search tool) */
  search: ExternalProviderConfig | null;
  /** Scrape provider configuration (webScrape tool) */
  scrape: ExternalProviderConfig | null;
  /** webFetch is always available (no connector needed) - this flag controls if it's enabled */
  webFetchEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Response Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentResponse {
  text: string;
  mode: 'interactive' | 'planning' | 'executing';
  usage?: TokenUsage;
  duration?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StreamEvent {
  type: 'text:delta' | 'text:done' | 'tool:start' | 'tool:complete' | 'error' | 'done';
  delta?: string;
  text?: string;
  tool?: { name: string; args?: unknown; result?: unknown };
  error?: Error;
  usage?: TokenUsage;
}

export interface ToolApprovalContext {
  toolName: string;
  args?: unknown;
  riskLevel?: RiskLevel;
  reason?: string;
}

export type AstraReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AstraDirectResponse {
  responseId: string;
  text: string;
}

export interface AstraAsyncToolResponse extends AstraDirectResponse {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  initialText: string;
  duration: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Info
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorInfo {
  id: string;
  name: string;
  models: ModelInfo[];
  requiresApiKey: boolean;
  supportsOAuth: boolean;
  baseURL?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: AmosConfig = {
  activeConnector: null,
  activeModel: null,
  activeVendor: null,

  defaults: {
    vendor: 'openai',
    model: 'gpt-6-astra',
    temperature: 0.7,
    reasoningEffort: 'medium',
    maxOutputTokens: 4096,
  },

  planning: {
    enabled: true,
    autoDetect: true,
    requireApproval: true,
  },

  session: {
    autoSave: true,
    autoSaveIntervalMs: 60000,
    activeSessionId: null,
  },

  ui: {
    showTokenUsage: true,
    showTiming: true,
    streamResponses: true,
    colorOutput: true,
  },

  tools: {
    enabledTools: [],
    disabledTools: [],
    customToolsDir: './data/tools',
  },

  permissions: {
    defaultScope: 'session',
    defaultRiskLevel: 'low',
    allowlist: [],
    blocklist: [],
    toolOverrides: {},
    promptForApproval: true,
  },

  prompts: {
    promptsDir: './data/prompts',
    activePrompt: null,
  },

  developerTools: {
    enabled: true,
    workingDirectory: process.cwd(),
    allowedDirectories: [],
    blockedDirectories: ['node_modules', '.git', 'dist', 'build'],
    blockedCommands: ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:'],
    commandTimeout: 30000,
  },

  externalTools: {
    enabled: true,
    search: null,      // No search provider configured by default
    scrape: null,      // No scrape provider configured by default
    webFetchEnabled: true, // webFetch is free and always available
  },
};
