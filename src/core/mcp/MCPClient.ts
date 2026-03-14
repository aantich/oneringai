/**
 * MCP Client Implementation
 *
 * Wrapper around @modelcontextprotocol/sdk Client with lifecycle management,
 * auto-reconnect, and integration with ToolManager.
 */

import { EventEmitter } from 'eventemitter3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  CallToolResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  EmptyResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IMCPClient, MCPClientConnectionState } from '../../domain/interfaces/IMCPClient.js';
import type {
  MCPTool,
  MCPToolResult,
  MCPResource,
  MCPResourceContent,
  MCPPrompt,
  MCPPromptResult,
  MCPServerCapabilities,
  MCPClientState,
} from '../../domain/entities/MCPTypes.js';
import type {
  MCPServerConfig,
  MCPConfiguration,
  StdioTransportConfig,
  HTTPTransportConfig,
} from '../../domain/entities/MCPConfig.js';
import type { ToolManager } from '../ToolManager.js';
import {
  MCPError,
  MCPConnectionError,
  MCPToolError,
} from '../../domain/errors/MCPError.js';
import { applyServerDefaults } from '../../domain/entities/MCPConfig.js';
import { createMCPToolAdapters } from '../../infrastructure/mcp/adapters/MCPToolAdapter.js';
import { IDisposable } from '../../domain/interfaces/IDisposable.js';

/**
 * MCP Client class
 */
export class MCPClient extends EventEmitter implements IMCPClient, IDisposable {
  public readonly name: string;
  private readonly config: ReturnType<typeof applyServerDefaults>;
  private client: Client | null = null;
  private transport: Transport | null = null;
  private _state: MCPClientConnectionState = 'disconnected';
  private _capabilities?: MCPServerCapabilities;
  private _tools: MCPTool[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private subscribedResources = new Set<string>();
  private registeredToolNames = new Set<string>();
  private _isDestroyed = false;

  constructor(config: MCPServerConfig, defaults?: MCPConfiguration['defaults']) {
    super();
    this.name = config.name;
    this.config = applyServerDefaults(config, defaults);
  }

  // Getters

  get state(): MCPClientConnectionState {
    return this._state;
  }

  get capabilities(): MCPServerCapabilities | undefined {
    return this._capabilities;
  }

  get tools(): MCPTool[] {
    return this._tools;
  }

  // Lifecycle methods

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') {
      return;
    }

    this._state = 'connecting';
    this.emit('connecting');

    try {
      // Create transport based on config
      this.transport = this.createTransport();

      // Create SDK client
      this.client = new Client(
        {
          name: '@everworker/oneringai',
          version: '0.2.0',
        },
        {
          capabilities: {
            // Request all capabilities (empty object means we support all)
          },
        }
      );

      // Connect
      await this.client.connect(this.transport);

      // Get server capabilities - the SDK exposes this after connection
      // The actual capabilities are negotiated during connection
      this._capabilities = {} as MCPServerCapabilities;

      // Mark as connected before refreshing tools (so ensureConnected() doesn't throw)
      this._state = 'connected';
      this.reconnectAttempts = 0;

      // List available tools
      await this.refreshTools();

      this.emit('connected');

      // Start health check
      this.startHealthCheck();
    } catch (error) {
      // Clean up partially created resources
      this.stopHealthCheck(); // In case error occurred after startHealthCheck()
      this.stopReconnect();   // Prevent stale reconnect timers from previous attempts

      if (this.client) {
        try {
          await this.client.close();
        } catch {
          // Ignore close errors during cleanup
        }
        this.client = null;
      }
      this.transport = null;
      this._tools = [];
      this._capabilities = undefined;

      this._state = 'failed';
      const mcpError = new MCPConnectionError(
        `Failed to connect to MCP server '${this.name}'`,
        this.name,
        error as Error
      );
      this.emit('failed', mcpError);
      this.emit('error', mcpError);

      // Auto-reconnect if enabled
      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      } else {
        throw mcpError;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.stopHealthCheck();
    this.stopReconnect();

    if (this.client && this.transport) {
      try {
        await this.client.close();
      } catch (error) {
        // Ignore close errors
      }
    }

    this.client = null;
    this.transport = null;
    this._state = 'disconnected';
    this._tools = [];
    this.emit('disconnected');
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  isConnected(): boolean {
    return this._state === 'connected';
  }

  async ping(): Promise<boolean> {
    if (!this.client || !this.isConnected()) {
      return false;
    }

    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Tool methods

  async listTools(): Promise<MCPTool[]> {
    this.ensureConnected();

    try {
      const response = await this.client!.request({ method: 'tools/list' }, ListToolsResultSchema);

      this._tools = response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as MCPTool['inputSchema'],
      }));

      return this._tools;
    } catch (error) {
      throw this.createMCPError('list tools', error as Error);
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    this.ensureConnected();

    this.emit('tool:called', name, args);

    try {
      const response = await this.client!.request(
        {
          method: 'tools/call',
          params: {
            name,
            arguments: args,
          },
        },
        CallToolResultSchema
      );

      const result: MCPToolResult = {
        content: response.content.map((item) => ({
          type: item.type as 'text' | 'image' | 'resource',
          text: 'text' in item ? item.text : undefined,
          data: 'data' in item ? item.data : undefined,
          mimeType: 'mimeType' in item ? item.mimeType : undefined,
          uri: 'uri' in item ? item.uri : undefined,
        })),
        isError: response.isError,
      };

      this.emit('tool:result', name, result);

      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Unknown error';
        throw new MCPToolError(errorText, name, this.name);
      }

      return result;
    } catch (error) {
      if (error instanceof MCPToolError) {
        throw error;
      }
      throw new MCPToolError(
        `Failed to call tool '${name}' on server '${this.name}'`,
        name,
        this.name,
        error as Error
      );
    }
  }

  registerTools(toolManager: ToolManager): void {
    this.registerToolsSelective(toolManager);
  }

  /**
   * Register specific tools with a ToolManager (selective registration)
   * @param toolManager - ToolManager to register with
   * @param toolNames - Optional array of tool names to register (original MCP names, not namespaced).
   *                    If not provided, registers all tools.
   */
  registerToolsSelective(toolManager: ToolManager, toolNames?: string[]): void {
    if (this._tools.length === 0) {
      return;
    }

    // Filter tools if specific names provided
    const toolsToRegister = toolNames
      ? this._tools.filter(t => toolNames.includes(t.name))
      : this._tools;

    if (toolsToRegister.length === 0) {
      return;
    }

    // Convert MCP tools to ToolFunctions
    const toolFunctions = createMCPToolAdapters(toolsToRegister, this, this.config.toolNamespace);

    // Register each tool with the ToolManager
    for (const toolFn of toolFunctions) {
      const toolName = toolFn.definition.function.name;

      toolManager.register(toolFn, {
        namespace: this.config.toolNamespace,
        enabled: true,
        permission: this.config.permissions
          ? {
              scope: this.config.permissions.defaultScope,
              riskLevel: this.config.permissions.defaultRiskLevel,
            }
          : undefined,
      });

      this.registeredToolNames.add(toolName);
    }
  }

  unregisterTools(toolManager: ToolManager): void {
    for (const toolName of this.registeredToolNames) {
      toolManager.unregister(toolName);
    }
    this.registeredToolNames.clear();
  }

  // Resource methods

  async listResources(): Promise<MCPResource[]> {
    this.ensureConnected();

    try {
      const response = await this.client!.request({ method: 'resources/list' }, ListResourcesResultSchema);

      return response.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }));
    } catch (error) {
      throw this.createMCPError('list resources', error as Error);
    }
  }

  async readResource(uri: string): Promise<MCPResourceContent> {
    this.ensureConnected();

    try {
      const response = await this.client!.request(
        {
          method: 'resources/read',
          params: { uri },
        },
        ReadResourceResultSchema
      );

      const content = response.contents?.[0];
      if (!content) {
        throw new MCPError(`No content returned for resource '${uri}'`, this.name);
      }

      return {
        uri: content.uri,
        mimeType: content.mimeType,
        text: 'text' in content ? content.text : undefined,
        blob: 'blob' in content ? content.blob : undefined,
      };
    } catch (error) {
      throw this.createMCPError(`read resource '${uri}'`, error as Error);
    }
  }

  async subscribeResource(uri: string): Promise<void> {
    this.ensureConnected();

    if (!this._capabilities?.resources?.subscribe) {
      throw new MCPError(`Server '${this.name}' does not support resource subscriptions`, this.name);
    }

    try {
      // Subscribe method typically doesn't return structured data
      await this.client!.request(
        {
          method: 'resources/subscribe',
          params: { uri },
        },
        EmptyResultSchema
      );

      this.subscribedResources.add(uri);
    } catch (error) {
      throw this.createMCPError(`subscribe to resource '${uri}'`, error as Error);
    }
  }

  async unsubscribeResource(uri: string): Promise<void> {
    this.ensureConnected();

    try {
      await this.client!.request(
        {
          method: 'resources/unsubscribe',
          params: { uri },
        },
        EmptyResultSchema
      );

      this.subscribedResources.delete(uri);
    } catch (error) {
      throw this.createMCPError(`unsubscribe from resource '${uri}'`, error as Error);
    }
  }

  // Prompt methods

  async listPrompts(): Promise<MCPPrompt[]> {
    this.ensureConnected();

    try {
      const response = await this.client!.request({ method: 'prompts/list' }, ListPromptsResultSchema);

      return response.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      }));
    } catch (error) {
      throw this.createMCPError('list prompts', error as Error);
    }
  }

  async getPrompt(name: string, args?: Record<string, unknown>): Promise<MCPPromptResult> {
    this.ensureConnected();

    try {
      const response = await this.client!.request(
        {
          method: 'prompts/get',
          params: {
            name,
            arguments: args,
          },
        },
        GetPromptResultSchema
      );

      return {
        description: response.description,
        messages: response.messages.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: {
            type: msg.content.type as 'text' | 'image' | 'resource',
            text: 'text' in msg.content ? msg.content.text : undefined,
            data: 'data' in msg.content ? msg.content.data : undefined,
            mimeType: 'mimeType' in msg.content ? msg.content.mimeType : undefined,
            uri: 'uri' in msg.content ? msg.content.uri : undefined,
          },
        })),
      };
    } catch (error) {
      throw this.createMCPError(`get prompt '${name}'`, error as Error);
    }
  }

  // State management

  getState(): MCPClientState {
    return {
      name: this.name,
      state: this._state,
      capabilities: this._capabilities,
      subscribedResources: Array.from(this.subscribedResources),
      lastConnectedAt: this._state === 'connected' ? Date.now() : undefined,
      connectionAttempts: this.reconnectAttempts,
    };
  }

  loadState(state: MCPClientState): void {
    this.subscribedResources = new Set(state.subscribedResources);
    this.reconnectAttempts = state.connectionAttempts;
  }

  /**
   * Check if the MCPClient instance has been destroyed
   */
  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    this.stopHealthCheck();
    this.stopReconnect();
    if (this.client) {
      this.client.close().catch(() => {});
      this.client = null;
    }
    this.transport = null;
    this._tools = [];
    this._capabilities = undefined;
    this._state = 'disconnected';
    this.reconnectAttempts = 0;
    this.subscribedResources.clear();
    this.registeredToolNames.clear();
    this.removeAllListeners();
  }

  /**
   * Create a standardized MCPError for this server
   */
  private createMCPError(operation: string, cause?: Error): MCPError {
    return new MCPError(
      `Failed to ${operation} from server '${this.name}'`,
      this.name,
      cause,
    );
  }

  // Private helper methods

  private createTransport(): Transport {
    const { transport, transportConfig } = this.config;

    if (transport === 'stdio') {
      const stdioConfig = transportConfig as StdioTransportConfig;
      return new StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args,
        env: stdioConfig.env as Record<string, string> | undefined,
      });
    }

    if (transport === 'http' || transport === 'https') {
      const httpConfig = transportConfig as HTTPTransportConfig;

      // Build headers
      const headers: Record<string, string> = { ...httpConfig.headers };
      if (httpConfig.token) {
        headers['Authorization'] = `Bearer ${httpConfig.token}`;
      }

      return new StreamableHTTPClientTransport(new URL(httpConfig.url), {
        sessionId: httpConfig.sessionId,
        requestInit: {
          headers,
          ...(httpConfig.timeoutMs && { signal: AbortSignal.timeout(httpConfig.timeoutMs) }),
        },
        reconnectionOptions: httpConfig.reconnection
          ? {
              maxReconnectionDelay: httpConfig.reconnection.maxReconnectionDelay ?? 30000,
              initialReconnectionDelay: httpConfig.reconnection.initialReconnectionDelay ?? 1000,
              reconnectionDelayGrowFactor: httpConfig.reconnection.reconnectionDelayGrowFactor ?? 1.5,
              maxRetries: httpConfig.reconnection.maxRetries ?? 2,
            }
          : undefined,
      });
    }

    throw new MCPError(`Transport '${transport}' not supported`, this.name);
  }

  private ensureConnected(): void {
    if (!this.client || !this.isConnected()) {
      throw new MCPConnectionError(`MCP server '${this.name}' is not connected`, this.name);
    }
  }

  private async refreshTools(): Promise<void> {
    try {
      await this.listTools();
    } catch (error) {
      // Log but don't fail
      this.emit('error', error);
    }
  }

  private startHealthCheck(): void {
    if (this.config.healthCheckIntervalMs <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      const alive = await this.ping();
      if (!alive && this._state === 'connected') {
        this.emit('error', new MCPConnectionError(`Health check failed for server '${this.name}'`, this.name));
        if (this.config.autoReconnect) {
          await this.reconnect();
        }
      }
    }, this.config.healthCheckIntervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this._state = 'disconnected';
      this.emit('error', new MCPConnectionError(`Max reconnect attempts reached for server '${this.name}'`, this.name));
      return;
    }

    this.reconnectAttempts++;
    this._state = 'reconnecting';
    this.emit('reconnecting', this.reconnectAttempts);

    // Exponential backoff: 5s, 10s, 20s, 40s, ... capped at 5 minutes
    const delay = Math.min(this.config.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts - 1), 300_000);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        // connect() will handle retry
      }
    }, delay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
