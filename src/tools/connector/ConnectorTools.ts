/**
 * ConnectorTools - Generate tools from Connectors
 *
 * This is the main API for vendor-dependent tools.
 * Tools are thin wrappers around Connector.fetch() for specific operations.
 *
 * Enterprise features:
 * - Service detection caching
 * - Tool instance caching
 * - Security: prevents auth header override
 * - Safe JSON serialization
 */

import { Connector } from '../../core/Connector.js';
import { logger } from '../../infrastructure/observability/Logger.js';
import { sanitizeToolName } from '../../utils/sanitize.js';
import { ToolFunction, ToolPermissionConfig, ToolContext } from '../../domain/entities/Tool.js';
import { detectServiceFromURL } from '../../domain/entities/Services.js';
import type { IConnectorRegistry } from '../../domain/interfaces/IConnectorRegistry.js';
import type { AuthIdentity } from '../../core/context-nextgen/types.js';

/**
 * Headers that are protected and cannot be overridden by tool arguments
 */
const PROTECTED_HEADERS = ['authorization', 'x-api-key', 'api-key', 'bearer'];

/**
 * Safely stringify an object, handling circular references
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * Filter out protected headers from user-provided headers
 */
function filterProtectedHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!PROTECTED_HEADERS.includes(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Normalize a body value that may be a string (from LLM) into a proper object.
 * LLMs sometimes send `body` as a stringified JSON string instead of a JSON object,
 * which would cause double-serialization when passed through safeStringify().
 */
function normalizeBody(body: unknown): unknown {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      // Not valid JSON — return as-is (will be sent as a raw string)
      return body;
    }
  }
  return body;
}

/**
 * Detect API-level errors from response data.
 * Many APIs (Slack, Twilio, etc.) return HTTP 200 with error info in the body.
 */
function detectAPIError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // Pattern 1: { ok: false, error: "..." } (Slack, some others)
  if (obj.ok === false && typeof obj.error === 'string') {
    return obj.error;
  }

  // Pattern 2: { success: false, error/message: "..." }
  if (obj.success === false) {
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string') return obj.message;
  }

  // Pattern 3: { error: { message: "..." } } (common REST pattern)
  if (obj.error && typeof obj.error === 'object') {
    const err = obj.error as Record<string, unknown>;
    if (typeof err.message === 'string') return err.message;
  }

  return null;
}

/**
 * Factory function type for creating service-specific tools.
 * Takes a Connector and returns an array of tools that use it.
 *
 * The `userId` parameter is a legacy fallback — tools should prefer reading
 * userId from ToolContext at execution time (auto-populated by Agent).
 * Factory userId is used as fallback when ToolContext is not available.
 */
export type ServiceToolFactory = (connector: Connector, userId?: string) => ToolFunction[];

/**
 * Options for generating the generic API tool
 */
export interface GenericAPIToolOptions {
  /** Override the tool name (default: `${connectorName}_api`) */
  toolName?: string;
  /** Override the description */
  description?: string;
  /** User ID for multi-user OAuth */
  userId?: string;
  /** Account alias for multi-account OAuth (baked into tool name and context) */
  accountId?: string;
  /** Permission config for the tool */
  permission?: ToolPermissionConfig;
}

/**
 * Arguments for the generic API call tool
 */
export interface GenericAPICallArgs {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  body?: Record<string, unknown>;
  queryParams?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

/**
 * Result from the generic API call tool
 */
export interface GenericAPICallResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * Options for ConnectorTools methods that accept a scoped registry
 */
export interface ConnectorToolsOptions {
  /** Optional scoped registry for access-controlled connector lookup */
  registry?: IConnectorRegistry;
  /** Account alias for multi-account OAuth. When set, tools are prefixed with accountId and context is bound. */
  accountId?: string;
}

/**
 * ConnectorTools - Main API for vendor-dependent tools
 *
 * Usage:
 * ```typescript
 * // Get all tools for a connector
 * const tools = ConnectorTools.for('slack');
 *
 * // Get just the generic API tool
 * const apiTool = ConnectorTools.genericAPI('github');
 *
 * // Discover all available connector tools
 * const allTools = ConnectorTools.discoverAll();
 *
 * // With scoped registry (access control)
 * const registry = Connector.scoped({ tenantId: 'acme' });
 * const tools = ConnectorTools.for('slack', undefined, { registry });
 * ```
 */
export class ConnectorTools {
  /** Registry of service-specific tool factories */
  private static factories = new Map<string, ServiceToolFactory>();

  /** Cache for detected service types (connector name -> service type) */
  private static serviceTypeCache = new Map<string, string | undefined>();

  /** Cache for generated tools (cacheKey -> tools) */
  private static toolCache = new Map<string, ToolFunction[]>();

  /** Maximum cache size to prevent memory issues */
  private static readonly MAX_CACHE_SIZE = 100;

  /**
   * Clear all caches (useful for testing or when connectors change)
   */
  static clearCache(): void {
    this.serviceTypeCache.clear();
    this.toolCache.clear();
  }

  /**
   * Invalidate cache for a specific connector
   */
  static invalidateCache(connectorName: string): void {
    this.serviceTypeCache.delete(connectorName);
    // Remove all tool cache entries for this connector
    for (const key of this.toolCache.keys()) {
      if (key.startsWith(`${connectorName}:`)) {
        this.toolCache.delete(key);
      }
    }
  }

  /**
   * Register a tool factory for a service type
   *
   * @param serviceType - Service identifier (e.g., 'slack', 'github')
   * @param factory - Function that creates tools from a Connector
   *
   * @example
   * ```typescript
   * ConnectorTools.registerService('slack', (connector) => [
   *   createSlackSendMessageTool(connector),
   *   createSlackListChannelsTool(connector),
   * ]);
   * ```
   */
  static registerService(serviceType: string, factory: ServiceToolFactory): void {
    this.factories.set(serviceType, factory);
    logger.debug(`[ConnectorTools.registerService] Registered factory for: ${serviceType} (total factories: ${this.factories.size})`);
  }

  /**
   * Unregister a service tool factory
   */
  static unregisterService(serviceType: string): boolean {
    return this.factories.delete(serviceType);
  }

  /**
   * Get ALL tools for a connector (generic API + service-specific)
   * This is the main entry point
   *
   * @param connectorOrName - Connector instance or name
   * @param userId - Optional user ID for multi-user OAuth
   * @returns Array of tools
   *
   * @example
   * ```typescript
   * const tools = ConnectorTools.for('slack');
   * // Returns: [slack_api, slack_send_message, slack_list_channels, ...]
   * ```
   */
  static for(connectorOrName: Connector | string, userId?: string, options?: ConnectorToolsOptions): ToolFunction[] {
    const connector = this.resolveConnector(connectorOrName, options?.registry);
    const accountId = options?.accountId;
    const tools: ToolFunction[] = [];

    // Name prefix: connectorName_accountId or just connectorName
    const namePrefix = accountId
      ? `${sanitizeToolName(connector.name)}_${sanitizeToolName(accountId)}`
      : sanitizeToolName(connector.name);

    // 1. Always include generic API tool if baseURL exists
    if (connector.baseURL) {
      const accountLabel = accountId ? ` (account: ${accountId})` : '';
      tools.push(this.createGenericAPITool(connector, {
        userId,
        accountId,
        toolName: `${namePrefix}_api`,
        description:
          `Make an authenticated API call to ${connector.displayName}${accountLabel}.` +
          (connector.baseURL ? ` Base URL: ${connector.baseURL}.` : ' Provide full URL in endpoint.') +
          ' IMPORTANT: For POST/PUT/PATCH requests, pass data in the "body" parameter as a JSON object, NOT as query string parameters in the endpoint URL. The body is sent as application/json.',
      }));
    }

    // 2. Add service-specific tools if factory exists
    const serviceType = this.detectService(connector);
    if (serviceType && this.factories.has(serviceType)) {
      const factory = this.factories.get(serviceType)!;
      const serviceTools = factory(connector, userId);
      for (const tool of serviceTools) {
        tool.definition.function.name = `${namePrefix}_${tool.definition.function.name}`;
      }
      tools.push(...serviceTools);
    }

    // 3. All connector tools get account resolution from ToolContext.connectorAccounts.
    //    This allows single-account connectors to work without per-tool wrapping —
    //    the host app sets connectorAccounts on ToolContext and tools resolve it here.
    const resolved = tools.map(tool => this.withAccountResolution(tool, connector.name));

    // 4. If accountId is explicitly set (multi-account expansion), also bind it per-tool.
    //    bindAccountId sets context.accountId which takes precedence over connectorAccounts.
    if (accountId) {
      return resolved.map(tool => this.bindAccountId(tool, accountId));
    }

    return resolved;
  }

  /**
   * Get just the generic API tool for a connector
   *
   * @param connectorOrName - Connector instance or name
   * @param options - Optional configuration
   * @returns Generic API tool
   *
   * @example
   * ```typescript
   * const apiTool = ConnectorTools.genericAPI('github');
   * ```
   */
  static genericAPI(
    connectorOrName: Connector | string,
    options?: GenericAPIToolOptions
  ): ToolFunction<GenericAPICallArgs, GenericAPICallResult> {
    const connector = this.resolveConnector(connectorOrName);
    return this.createGenericAPITool(connector, options);
  }

  /**
   * Get only service-specific tools (no generic API tool)
   *
   * @param connectorOrName - Connector instance or name
   * @param userId - Optional user ID for multi-user OAuth
   * @returns Service-specific tools only
   */
  static serviceTools(connectorOrName: Connector | string, userId?: string): ToolFunction[] {
    const connector = this.resolveConnector(connectorOrName);
    const serviceType = this.detectService(connector);

    if (!serviceType || !this.factories.has(serviceType)) {
      return [];
    }

    return this.factories.get(serviceType)!(connector, userId);
  }

  /**
   * Discover tools for ALL registered connectors with external services
   * Skips AI provider connectors (those with vendor but no serviceType)
   *
   * @param userId - Optional user ID for multi-user OAuth
   * @returns Map of connector name to tools
   *
   * @example
   * ```typescript
   * const allTools = ConnectorTools.discoverAll();
   * for (const [name, tools] of allTools) {
   *   agent.tools.registerMany(tools, { namespace: name });
   * }
   * ```
   */
  static discoverAll(userId?: string, options?: ConnectorToolsOptions): Map<string, ToolFunction[]> {
    const result = new Map<string, ToolFunction[]>();
    const allConnectors = options?.registry ? options.registry.listAll() : Connector.listAll();
    const factoryKeys = Array.from(this.factories.keys());
    logger.debug(`[ConnectorTools.discoverAll] ${allConnectors.length} connectors in library, ${factoryKeys.length} factories registered: [${factoryKeys.join(', ')}]`);

    for (const connector of allConnectors) {
      // Include connectors that:
      // 1. Have explicit serviceType, OR
      // 2. Have baseURL but no vendor (external API, not AI provider), OR
      // 3. Have a vendor with registered tool factories (e.g., multimedia tools)
      const hasServiceType = !!connector.config.serviceType;
      const isExternalAPI = connector.baseURL && !connector.vendor;
      const hasVendorFactory = !!connector.vendor && this.factories.has(connector.vendor);

      logger.debug(`[ConnectorTools.discoverAll] connector=${connector.name}: vendor=${connector.vendor}, serviceType=${connector.config.serviceType}, baseURL=${connector.baseURL ? 'yes' : 'no'} → hasServiceType=${hasServiceType}, isExternalAPI=${isExternalAPI}, hasVendorFactory=${hasVendorFactory}`);

      if (hasServiceType || isExternalAPI || hasVendorFactory) {
        try {
          const tools = this.for(connector, userId);
          logger.debug(`[ConnectorTools.discoverAll]   → ${tools.length} tools: [${tools.map(t => t.definition.function.name).join(', ')}]`);
          if (tools.length > 0) {
            result.set(connector.name, tools);
          }
        } catch (err) {
          logger.error(`[ConnectorTools.discoverAll]   → ERROR generating tools for ${connector.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    logger.debug(`[ConnectorTools.discoverAll] Result: ${result.size} connectors with tools`);
    return result;
  }

  /**
   * Find a connector by service type
   * Returns the first connector matching the service type
   *
   * @param serviceType - Service identifier
   * @returns Connector or undefined
   */
  static findConnector(serviceType: string, options?: ConnectorToolsOptions): Connector | undefined {
    const connectors = options?.registry ? options.registry.listAll() : Connector.listAll();
    return connectors.find((c) => this.detectService(c) === serviceType);
  }

  /**
   * Find all connectors for a service type
   * Useful when you have multiple connectors for the same service
   *
   * @param serviceType - Service identifier
   * @returns Array of matching connectors
   */
  static findConnectors(serviceType: string, options?: ConnectorToolsOptions): Connector[] {
    const connectors = options?.registry ? options.registry.listAll() : Connector.listAll();
    return connectors.filter((c) => this.detectService(c) === serviceType);
  }

  /**
   * List services that have registered tool factories
   */
  static listSupportedServices(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Check if a service has dedicated tool factory
   */
  static hasServiceTools(serviceType: string): boolean {
    return this.factories.has(serviceType);
  }

  /**
   * Detect the service type for a connector
   * Uses explicit serviceType if set, otherwise infers from baseURL
   * Results are cached for performance
   */
  static detectService(connector: Connector): string | undefined {
    // Check cache first
    const cacheKey = connector.name;
    if (this.serviceTypeCache.has(cacheKey)) {
      return this.serviceTypeCache.get(cacheKey);
    }

    let result: string | undefined;

    // 1. Explicit serviceType takes precedence
    if (connector.config.serviceType) {
      result = connector.config.serviceType;
    }
    // 2. Infer from baseURL patterns
    else if (connector.baseURL) {
      result = detectServiceFromURL(connector.baseURL);
    }

    // 3. Fall back to vendor as service identifier (for AI vendor connectors)
    if (!result && connector.vendor) {
      result = connector.vendor;
    }

    // Cache the result (even if undefined)
    this.maintainCacheSize(this.serviceTypeCache);
    this.serviceTypeCache.set(cacheKey, result);

    return result;
  }

  /**
   * Maintain cache size to prevent memory leaks
   */
  private static maintainCacheSize<K, V>(cache: Map<K, V>): void {
    if (cache.size >= this.MAX_CACHE_SIZE) {
      // Remove oldest entries (first 10%)
      const toRemove = Math.ceil(this.MAX_CACHE_SIZE * 0.1);
      const keys = Array.from(cache.keys()).slice(0, toRemove);
      for (const key of keys) {
        cache.delete(key);
      }
    }
  }

  // ============ Private Methods ============

  private static resolveConnector(connectorOrName: Connector | string, registry?: IConnectorRegistry): Connector {
    if (typeof connectorOrName === 'string') {
      return registry ? registry.get(connectorOrName) : Connector.get(connectorOrName);
    }
    return connectorOrName;
  }

  /**
   * Generate tools for a set of auth identities.
   * Each identity gets its own tool set with unique name prefixes.
   *
   * @param identities - Array of auth identities
   * @param userId - Optional user ID for multi-user OAuth
   * @param options - Optional registry for scoped connector lookup
   * @returns Map of identity key to tool array
   *
   * @example
   * ```typescript
   * const toolsByIdentity = ConnectorTools.forIdentities([
   *   { connector: 'microsoft', accountId: 'work' },
   *   { connector: 'microsoft', accountId: 'personal' },
   *   { connector: 'github' },
   * ]);
   * // Keys: 'microsoft:work', 'microsoft:personal', 'github'
   * ```
   */
  static forIdentities(
    identities: AuthIdentity[],
    userId?: string,
    options?: { registry?: IConnectorRegistry }
  ): Map<string, ToolFunction[]> {
    const result = new Map<string, ToolFunction[]>();

    for (const identity of identities) {
      const key = identity.accountId
        ? `${identity.connector}:${identity.accountId}`
        : identity.connector;

      try {
        const tools = this.for(identity.connector, userId, {
          registry: options?.registry,
          accountId: identity.accountId,
        });
        if (tools.length > 0) {
          result.set(key, tools);
        }
      } catch (err) {
        logger.error(`[ConnectorTools.forIdentities] Error generating tools for identity ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
  }

  /**
   * Wrap a tool to resolve accountId from ToolContext.connectorAccounts at execute time.
   *
   * Resolution order:
   * 1. context.accountId — explicit per-tool binding (set by bindAccountId for multi-account)
   * 2. context.connectorAccounts[connectorName] — per-connector binding (single-account)
   * 3. undefined — no binding (legacy tokens without accountId)
   *
   * This wrapper is applied to ALL connector tools in for(), so individual
   * service tool factories don't need to know about connectorAccounts.
   */
  private static withAccountResolution(tool: ToolFunction, connectorName: string): ToolFunction {
    return {
      ...tool,
      execute: async (args: any, context?: ToolContext) => {
        // If accountId is already set (by bindAccountId wrapper), pass through
        if (context?.accountId) {
          return tool.execute(args, context);
        }
        // Resolve from connectorAccounts map
        const resolved = context?.connectorAccounts?.[connectorName];
        if (resolved) {
          return tool.execute(args, { ...context, accountId: resolved });
        }
        // No binding — legacy path
        return tool.execute(args, context);
      },
    };
  }

  /**
   * Wrap a tool to inject accountId into ToolContext at execute time.
   * This allows identity-bound tools to use the correct account without
   * modifying every service tool factory.
   */
  private static bindAccountId(tool: ToolFunction, accountId: string): ToolFunction {
    return {
      ...tool,
      execute: async (args: any, context?: ToolContext) => {
        return tool.execute(args, { ...context, accountId });
      },
    };
  }

  private static createGenericAPITool(
    connector: Connector,
    options?: GenericAPIToolOptions
  ): ToolFunction<GenericAPICallArgs, GenericAPICallResult> {
    const toolName = options?.toolName ?? `${sanitizeToolName(connector.name)}_api`;
    const userId = options?.userId;

    const description =
      options?.description ??
      `Make an authenticated API call to ${connector.displayName}.` +
        (connector.baseURL ? ` Base URL: ${connector.baseURL}.` : ' Provide full URL in endpoint.') +
        ' IMPORTANT: For POST/PUT/PATCH requests, pass data in the "body" parameter as a JSON object, NOT as query string parameters in the endpoint URL. The body is sent as application/json.';

    return {
      definition: {
        type: 'function',
        function: {
          name: toolName,
          description,
          parameters: {
            type: 'object',
            properties: {
              method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                description: 'HTTP method',
              },
              endpoint: {
                type: 'string',
                description: 'API endpoint path (relative to base URL) or full URL. Do NOT put request data as query parameters here for POST/PUT/PATCH — use the "body" parameter instead.',
              },
              body: {
                type: 'object',
                description: 'JSON request body for POST/PUT/PATCH requests. MUST be a JSON object (NOT a string). Example: {"channel": "C123", "text": "hello"}. Do NOT stringify this — pass it as a raw JSON object. Do NOT use query string parameters for POST data.',
              },
              queryParams: {
                type: 'object',
                description: 'URL query parameters (for filtering/pagination on GET requests). Do NOT use for POST/PUT/PATCH data — use "body" instead.',
              },
              headers: {
                type: 'object',
                description: 'Additional request headers',
              },
            },
            required: ['method', 'endpoint'],
          },
        },
      },

      execute: async (args: GenericAPICallArgs, context?: ToolContext): Promise<GenericAPICallResult> => {
        const effectiveUserId = context?.userId ?? userId;
        const effectiveAccountId = context?.accountId;
        let url = args.endpoint;

        // Add query params if provided
        if (args.queryParams && Object.keys(args.queryParams).length > 0) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(args.queryParams)) {
            params.append(key, String(value));
          }
          url += (url.includes('?') ? '&' : '?') + params.toString();
        }

        // Filter out protected headers (security: prevent auth header override)
        const safeHeaders = filterProtectedHeaders(args.headers);

        // Normalize and stringify body (handles LLM sending stringified JSON)
        let bodyStr: string | undefined;
        if (args.body) {
          try {
            const normalized = normalizeBody(args.body);
            bodyStr = safeStringify(normalized);
          } catch (e) {
            return {
              success: false,
              error: `Failed to serialize request body: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        }

        try {
          const response = await connector.fetch(
            url,
            {
              method: args.method,
              headers: {
                'Content-Type': 'application/json',
                ...safeHeaders,
              },
              body: bodyStr,
            },
            effectiveUserId,
            effectiveAccountId
          );

          // Try to parse as JSON
          const text = await response.text();
          let data: unknown;

          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }

          // Check for API-level errors (many APIs return 200 with error in body)
          const apiError = detectAPIError(data);

          return {
            success: response.ok && !apiError,
            status: response.status,
            data: (response.ok && !apiError) ? data : undefined,
            error: apiError
              ? apiError
              : response.ok
                ? undefined
                : typeof data === 'string' ? data : safeStringify(data),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },

      describeCall: (args: GenericAPICallArgs) => {
        const bodyInfo = args.body ? ` body=${JSON.stringify(args.body).slice(0, 100)}` : '';
        return `${args.method} ${args.endpoint}${bodyInfo}`;
      },

      permission: options?.permission ?? {
        scope: 'session',
        riskLevel: 'medium',
        approvalMessage: `This will make an API call to ${connector.displayName}`,
      },
    };
  }
}
