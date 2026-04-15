/**
 * Connector - The single source of truth for authentication
 *
 * Manages authenticated connections to:
 * - AI providers (OpenAI, Anthropic, Google, etc.)
 * - External APIs (GitHub, Salesforce, etc.)
 *
 * Enterprise features:
 * - Request timeout with AbortController
 * - Circuit breaker for failing services
 * - Retry with exponential backoff
 * - Request/response logging
 */

import { randomUUID } from 'crypto';
import { ConnectorConfig, ConnectorAuth } from '../domain/entities/Connector.js';
import { Vendor } from './Vendor.js';
import { OAuthManager } from '../connectors/oauth/OAuthManager.js';
import { MemoryStorage } from '../connectors/oauth/infrastructure/storage/MemoryStorage.js';
import type { ITokenStorage } from '../connectors/oauth/domain/ITokenStorage.js';
import { StorageRegistry } from './StorageRegistry.js';
import { CircuitBreaker } from '../infrastructure/resilience/CircuitBreaker.js';
import { calculateBackoff, BackoffConfig } from '../infrastructure/resilience/BackoffStrategy.js';
import { logger } from '../infrastructure/observability/Logger.js';
import { metrics } from '../infrastructure/observability/Metrics.js';
import type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
import type { IConnectorAccessPolicy, ConnectorAccessContext } from '../domain/interfaces/IConnectorAccessPolicy.js';
import { ScopedConnectorRegistry } from './ScopedConnectorRegistry.js';

/**
 * Default configuration values for resilience features
 */
export const DEFAULT_CONNECTOR_TIMEOUT = 30000; // 30 seconds
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

/**
 * Fetch options with additional connector-specific settings
 */
export interface ConnectorFetchOptions extends RequestInit {
  /** Override timeout for this request */
  timeout?: number;
  /** Skip retry for this request */
  skipRetry?: boolean;
  /** Skip circuit breaker for this request */
  skipCircuitBreaker?: boolean;
}

/**
 * Connector class - represents a single authenticated connection
 */
export class Connector {
  // ============ Custom Registry ============

  private static _customRegistry: IConnectorRegistry | null = null;

  /**
   * Set a custom connector registry implementation.
   * When set, all static read methods (get, has, list, listAll, size, etc.)
   * delegate to this registry instead of the internal Map.
   *
   * Use this to plug in multi-tenant, lazy-loading, or any custom connector
   * resolution strategy. Pass null to revert to the built-in Map-based registry.
   *
   * @example
   * ```typescript
   * // Multi-tenant app — set per-request in middleware
   * Connector.setRegistry(new TenantConnectorRegistry(tenantId));
   *
   * // Now Connector.get('microsoft') resolves via TenantConnectorRegistry
   * ```
   */
  static setRegistry(registry: IConnectorRegistry | null): void {
    Connector._customRegistry = registry;
  }

  /**
   * Get the current custom registry (or null if using the built-in registry).
   */
  static getRegistry(): IConnectorRegistry | null {
    return Connector._customRegistry;
  }

  // ============ Static Registry ============

  private static registry: Map<string, Connector> = new Map();

  /**
   * Create and register a new connector
   * @param config - Must include `name` field
   */
  static create(config: ConnectorConfig & { name: string }): Connector {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error('Connector name is required');
    }
    if (Connector.registry.has(config.name)) {
      throw new Error(`Connector '${config.name}' already exists. Use Connector.get() or choose a different name.`);
    }
    const connector = new Connector(config);
    Connector.registry.set(config.name, connector);
    return connector;
  }

  /**
   * Get a connector by name
   */
  static get(name: string): Connector {
    if (Connector._customRegistry) return Connector._customRegistry.get(name);
    const connector = Connector.registry.get(name);
    if (!connector) {
      const available = Connector.list().join(', ') || 'none';
      throw new Error(`Connector '${name}' not found. Available: ${available}`);
    }
    return connector;
  }

  /**
   * Check if a connector exists
   */
  static has(name: string): boolean {
    if (Connector._customRegistry) return Connector._customRegistry.has(name);
    return Connector.registry.has(name);
  }

  /**
   * List all registered connector names
   */
  static list(): string[] {
    if (Connector._customRegistry) return Connector._customRegistry.list();
    return Array.from(Connector.registry.keys());
  }

  /**
   * Remove a connector
   */
  static remove(name: string): boolean {
    const connector = Connector.registry.get(name);
    if (connector) {
      connector.dispose();
    }
    return Connector.registry.delete(name);
  }

  /**
   * Clear all connectors (useful for testing)
   */
  static clear(): void {
    for (const connector of Connector.registry.values()) {
      connector.dispose();
    }
    Connector.registry.clear();
  }

  /**
   * Get the default token storage for OAuth connectors.
   * Resolves from StorageRegistry, falling back to MemoryStorage.
   */
  private static get defaultStorage(): ITokenStorage {
    return StorageRegistry.resolve('oauthTokens', () => new MemoryStorage());
  }

  /**
   * Set default token storage for OAuth connectors
   */
  static setDefaultStorage(storage: ITokenStorage): void {
    StorageRegistry.set('oauthTokens', storage);
  }

  /**
   * Get all registered connectors
   */
  static listAll(): Connector[] {
    if (Connector._customRegistry) return Connector._customRegistry.listAll();
    return Array.from(Connector.registry.values());
  }

  /**
   * Get number of registered connectors
   */
  static size(): number {
    if (Connector._customRegistry) return Connector._customRegistry.size();
    return Connector.registry.size;
  }

  /**
   * Get a connector by ID
   */
  static getById(id: string): Connector {
    if (Connector._customRegistry?.getById) return Connector._customRegistry.getById(id);
    for (const connector of Connector.registry.values()) {
      if (connector.id === id) return connector;
    }
    throw new Error(`Connector with id '${id}' not found`);
  }

  // ============ Access Control ============

  private static _accessPolicy: IConnectorAccessPolicy | null = null;

  /**
   * Set a global access policy for connector scoping.
   * Pass null to clear the policy.
   */
  static setAccessPolicy(policy: IConnectorAccessPolicy | null): void {
    Connector._accessPolicy = policy;
  }

  /**
   * Get the current global access policy (or null if none set).
   */
  static getAccessPolicy(): IConnectorAccessPolicy | null {
    return Connector._accessPolicy;
  }

  /**
   * Create a scoped (filtered) view of the connector registry.
   * Requires a global access policy to be set via setAccessPolicy().
   *
   * @param context - Opaque context passed to the policy (e.g., { userId, tenantId })
   * @returns IConnectorRegistry that only exposes accessible connectors
   * @throws Error if no access policy is set
   */
  static scoped(context: ConnectorAccessContext): IConnectorRegistry {
    if (!Connector._accessPolicy) {
      throw new Error('No access policy set. Call Connector.setAccessPolicy() first.');
    }
    return new ScopedConnectorRegistry(Connector._accessPolicy, context);
  }

  /**
   * Return the static Connector methods as an IConnectorRegistry object (unfiltered).
   * Useful when code accepts the interface but you want the full admin view.
   */
  static asRegistry(): IConnectorRegistry {
    return {
      get: (name: string) => Connector.get(name),
      has: (name: string) => Connector.has(name),
      list: () => Connector.list(),
      listAll: () => Connector.listAll(),
      size: () => Connector.size(),
      getDescriptionsForTools: () => Connector.getDescriptionsForTools(),
      getInfo: () => Connector.getInfo(),
      getById: (id: string) => Connector.getById(id),
    };
  }

  /**
   * Get connector descriptions formatted for tool parameters
   * Useful for generating dynamic tool descriptions
   */
  static getDescriptionsForTools(): string {
    if (Connector._customRegistry) return Connector._customRegistry.getDescriptionsForTools();

    const connectors = Connector.listAll();

    if (connectors.length === 0) {
      return 'No connectors registered yet.';
    }

    return connectors
      .map((c) => `  - "${c.name}": ${c.displayName} - ${c.config.description || 'No description'}`)
      .join('\n');
  }

  /**
   * Get connector info (for tools and documentation)
   */
  static getInfo(): Record<string, { displayName: string; description: string; baseURL: string }> {
    if (Connector._customRegistry) return Connector._customRegistry.getInfo();

    const info: Record<string, { displayName: string; description: string; baseURL: string }> = {};

    for (const connector of Connector.registry.values()) {
      info[connector.name] = {
        displayName: connector.displayName,
        description: connector.config.description || '',
        baseURL: connector.baseURL,
      };
    }

    return info;
  }

  // ============ Instance ============

  readonly id: string;
  readonly name: string;
  readonly vendor?: Vendor;
  readonly config: ConnectorConfig;

  private oauthManager?: OAuthManager;
  private circuitBreaker?: CircuitBreaker;
  private disposed = false;

  // Metrics
  private requestCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private totalLatencyMs = 0;

  private constructor(config: ConnectorConfig & { name: string }) {
    this.id = config.id ?? randomUUID();
    this.name = config.name;
    this.vendor = config.vendor;
    this.config = { ...config, id: this.id };

    // Initialize OAuth manager for OAuth and JWT auth types
    if (config.auth.type === 'oauth') {
      this.initOAuthManager(config.auth);
    } else if (config.auth.type === 'jwt') {
      this.initJWTManager(config.auth);
    }

    // Initialize circuit breaker if enabled (default: true)
    this.initCircuitBreaker();
  }

  /**
   * Initialize circuit breaker with config or defaults
   */
  private initCircuitBreaker(): void {
    const cbConfig = this.config.circuitBreaker;
    const enabled = cbConfig?.enabled ?? true;

    if (enabled) {
      this.circuitBreaker = new CircuitBreaker(`connector:${this.name}`, {
        failureThreshold: cbConfig?.failureThreshold ?? 5,
        successThreshold: cbConfig?.successThreshold ?? 2,
        resetTimeoutMs: cbConfig?.resetTimeoutMs ?? 30000,
        windowMs: 60000, // 1 minute window
        isRetryable: (error) => {
          // Don't count client errors (4xx except 429) as circuit breaker failures
          if (error.message.includes('HTTP 4') && !error.message.includes('HTTP 429')) {
            return false;
          }
          return true;
        },
      });

      // Log circuit breaker state changes
      this.circuitBreaker.on('opened', ({ name, failureCount, lastError }) => {
        logger.warn(`Circuit breaker opened for ${name}: ${failureCount} failures, last error: ${lastError}`);
        metrics.increment('connector.circuit_breaker.opened', 1, { connector: this.name });
      });

      this.circuitBreaker.on('closed', ({ name }) => {
        logger.info(`Circuit breaker closed for ${name}`);
        metrics.increment('connector.circuit_breaker.closed', 1, { connector: this.name });
      });
    }
  }

  /**
   * Human-readable display name
   */
  get displayName(): string {
    return this.config.displayName || this.name;
  }

  /**
   * API base URL for this connector
   */
  get baseURL(): string {
    return this.config.baseURL || '';
  }

  /**
   * Get the API key (for api_key auth type)
   */
  getApiKey(): string {
    if (this.config.auth.type !== 'api_key') {
      throw new Error(`Connector '${this.name}' does not use API key auth. Type: ${this.config.auth.type}`);
    }
    return this.config.auth.apiKey;
  }

  /**
   * Get the current access token (for OAuth, JWT, or API key)
   * Handles automatic refresh if needed
   *
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support (e.g., 'work', 'personal')
   */
  async getToken(userId?: string, accountId?: string): Promise<string> {
    if (this.config.auth.type === 'api_key') {
      return this.config.auth.apiKey;
    }

    // OAuth and JWT both use OAuthManager
    if (!this.oauthManager) {
      throw new Error(`OAuth manager not initialized for connector '${this.name}'`);
    }

    return this.oauthManager.getToken(userId, accountId);
  }

  /**
   * Start OAuth authorization flow
   * Returns the URL to redirect the user to
   *
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support (e.g., 'work', 'personal')
   */
  async startAuth(userId?: string, accountId?: string): Promise<string> {
    if (!this.oauthManager) {
      throw new Error(`Connector '${this.name}' is not an OAuth connector`);
    }
    return this.oauthManager.startAuthFlow(userId, accountId);
  }

  /**
   * Handle OAuth callback
   * Call this after user is redirected back from OAuth provider
   *
   * @param callbackUrl - Full callback URL with code and state parameters
   * @param userId - Optional user identifier (can be extracted from state if embedded)
   * @param accountId - Optional account alias (can be extracted from state if embedded)
   */
  async handleCallback(callbackUrl: string, userId?: string, accountId?: string): Promise<void> {
    if (!this.oauthManager) {
      throw new Error(`Connector '${this.name}' is not an OAuth connector`);
    }
    await this.oauthManager.handleCallback(callbackUrl, userId, accountId);
  }

  /**
   * Check if the connector has a valid token
   *
   * @param userId - Optional user identifier for multi-user support
   * @param accountId - Optional account alias for multi-account support
   */
  async hasValidToken(userId?: string, accountId?: string): Promise<boolean> {
    try {
      if (this.config.auth.type === 'api_key') {
        return true; // API keys are always "valid" (we don't validate them)
      }
      if (this.oauthManager) {
        const token = await this.oauthManager.getToken(userId, accountId);
        return !!token;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List account aliases for a user on this connector.
   * Only applicable for OAuth connectors with multi-account support.
   *
   * @param userId - Optional user identifier
   * @returns Array of account aliases (e.g., ['work', 'personal'])
   */
  async listAccounts(userId?: string): Promise<string[]> {
    if (!this.oauthManager) {
      return [];
    }
    return this.oauthManager.listAccounts(userId);
  }

  /**
   * Re-key a token from one accountId to another.
   * Used to stabilize account IDs after OAuth — e.g., replacing a temporary
   * random ID with the actual email address discovered post-authorization.
   *
   * @param userId - User identifier
   * @param oldAccountId - Current account alias (temporary)
   * @param newAccountId - Stable account alias (e.g., email)
   * @returns true if re-keyed, false if no token found under oldAccountId
   */
  async rekeyAccount(userId: string, oldAccountId: string, newAccountId: string): Promise<boolean> {
    if (!this.oauthManager) {
      throw new Error(`Connector '${this.name}' is not an OAuth connector`);
    }
    return this.oauthManager.rekeyAccount(userId, oldAccountId, newAccountId);
  }

  /**
   * Remove a specific account's stored token.
   * Used when a user unlinks/disconnects one of their accounts.
   * Only applicable for OAuth connectors with multi-account support.
   *
   * @param userId - User identifier
   * @param accountId - Account alias to remove (e.g., 'work', 'personal')
   * @returns true if a token was deleted, false if no token existed
   */
  async removeAccount(userId: string, accountId: string): Promise<boolean> {
    if (!this.oauthManager) {
      throw new Error(`Connector '${this.name}' is not an OAuth connector`);
    }
    return this.oauthManager.removeAccount(userId, accountId);
  }

  /**
   * Get vendor-specific options from config
   */
  getOptions(): Record<string, unknown> {
    return this.config.options ?? {};
  }

  /**
   * Get the service type (explicit or undefined)
   */
  get serviceType(): string | undefined {
    return this.config.serviceType;
  }

  /**
   * Get connector metrics
   */
  getMetrics(): {
    requestCount: number;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    circuitBreakerState?: string;
  } {
    return {
      requestCount: this.requestCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      avgLatencyMs: this.requestCount > 0 ? this.totalLatencyMs / this.requestCount : 0,
      circuitBreakerState: this.circuitBreaker?.getState(),
    };
  }

  /**
   * Reset circuit breaker (force close)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker?.reset();
  }

  /**
   * Make an authenticated fetch request using this connector
   * This is the foundation for all vendor-dependent tools
   *
   * Features:
   * - Timeout with AbortController
   * - Circuit breaker protection
   * - Retry with exponential backoff
   * - Request/response logging
   *
   * @param endpoint - API endpoint (relative to baseURL) or full URL
   * @param options - Fetch options with connector-specific settings
   * @param userId - Optional user ID for multi-user OAuth
   * @param accountId - Optional account alias for multi-account OAuth
   * @returns Fetch Response
   */
  async fetch(
    endpoint: string,
    options?: ConnectorFetchOptions,
    userId?: string,
    accountId?: string
  ): Promise<Response> {
    // Check if disposed
    if (this.disposed) {
      throw new Error(`Connector '${this.name}' has been disposed`);
    }

    const startTime = Date.now();
    this.requestCount++;

    // Resolve URL (ensure proper slash between baseURL and relative endpoint)
    let url: string;
    if (endpoint.startsWith('http')) {
      url = endpoint;
    } else {
      const base = (this.baseURL ?? '').replace(/\/+$/, '');
      const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      url = `${base}${path}`;
    }

    // Get timeout
    const timeout = options?.timeout ?? this.config.timeout ?? DEFAULT_CONNECTOR_TIMEOUT;

    // Log request if enabled
    if (this.config.logging?.enabled) {
      this.logRequest(url, options);
    }

    // Build the actual fetch function
    const doFetch = async (): Promise<Response> => {
      // Get token (may involve refresh)
      const token = await this.getToken(userId, accountId);
      const auth = this.config.auth;

      // Build auth header
      let headerName = 'Authorization';
      let headerValue = `Bearer ${token}`;

      if (auth.type === 'api_key') {
        headerName = auth.headerName || 'Authorization';
        const prefix = auth.headerPrefix ?? 'Bearer';
        headerValue = prefix ? `${prefix} ${token}` : token;
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            ...options?.headers,
            [headerName]: headerValue,
          },
        });

        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Build retry wrapper
    const doFetchWithRetry = async (): Promise<Response> => {
      const retryConfig = this.config.retry;
      const maxRetries = retryConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
      const retryableStatuses = retryConfig?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
      const baseDelayMs = retryConfig?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
      const maxDelayMs = retryConfig?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

      const backoffConfig: BackoffConfig = {
        strategy: 'exponential',
        initialDelayMs: baseDelayMs,
        maxDelayMs: maxDelayMs,
        multiplier: 2,
        jitter: true,
        jitterFactor: 0.1,
      };

      let lastError: Error | undefined;
      let lastResponse: Response | undefined;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          const response = await doFetch();

          // Check if we should retry based on status code
          if (!response.ok && retryableStatuses.includes(response.status) && attempt <= maxRetries) {
            lastResponse = response;
            const delay = calculateBackoff(attempt, backoffConfig);

            if (this.config.logging?.enabled) {
              logger.debug(`Connector ${this.name}: Retry ${attempt}/${maxRetries} after ${delay}ms (status ${response.status})`);
            }

            await this.sleep(delay);
            continue;
          }

          return response;
        } catch (error) {
          lastError = error as Error;

          // Don't retry on abort (timeout)
          if (lastError.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms: ${url}`);
          }

          // Retry on network errors
          if (attempt <= maxRetries && !options?.skipRetry) {
            const delay = calculateBackoff(attempt, backoffConfig);

            if (this.config.logging?.enabled) {
              logger.debug(`Connector ${this.name}: Retry ${attempt}/${maxRetries} after ${delay}ms (error: ${lastError.message})`);
            }

            await this.sleep(delay);
            continue;
          }

          throw lastError;
        }
      }

      // If we exhausted retries with a response, return it
      if (lastResponse) {
        return lastResponse;
      }

      // Otherwise throw the last error
      throw lastError ?? new Error('Unknown error during fetch');
    };

    try {
      let response: Response;

      // Wrap with circuit breaker if enabled and not skipped
      if (this.circuitBreaker && !options?.skipCircuitBreaker) {
        response = await this.circuitBreaker.execute(doFetchWithRetry);
      } else {
        response = await doFetchWithRetry();
      }

      // Record success
      const latency = Date.now() - startTime;
      this.successCount++;
      this.totalLatencyMs += latency;
      metrics.timing('connector.latency', latency, { connector: this.name });
      metrics.increment('connector.success', 1, { connector: this.name });

      // Log response if enabled
      if (this.config.logging?.enabled) {
        this.logResponse(url, response, latency);
      }

      return response;
    } catch (error) {
      // Record failure
      const latency = Date.now() - startTime;
      this.failureCount++;
      this.totalLatencyMs += latency;
      metrics.increment('connector.failure', 1, { connector: this.name, error: (error as Error).name });

      // Log error
      if (this.config.logging?.enabled) {
        logger.error(
          { connector: this.name, url, latency, error: (error as Error).message },
          `Connector ${this.name} fetch failed: ${(error as Error).message}`
        );
      }

      throw error;
    }
  }

  /**
   * Make an authenticated fetch request and parse JSON response
   * Throws on non-OK responses
   *
   * @param endpoint - API endpoint (relative to baseURL) or full URL
   * @param options - Fetch options with connector-specific settings
   * @param userId - Optional user ID for multi-user OAuth
   * @param accountId - Optional account alias for multi-account OAuth
   * @returns Parsed JSON response
   */
  async fetchJSON<T = unknown>(
    endpoint: string,
    options?: ConnectorFetchOptions,
    userId?: string,
    accountId?: string
  ): Promise<T> {
    const response = await this.fetch(endpoint, options, userId, accountId);

    // Try to parse response body
    const text = await response.text();
    let data: T;

    try {
      data = JSON.parse(text) as T;
    } catch {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
    }

    if (!response.ok) {
      // Include parsed error in message if available
      const errorMsg = typeof data === 'object' && data !== null ? JSON.stringify(data) : text;
      throw new Error(`HTTP ${response.status}: ${errorMsg}`);
    }

    return data;
  }

  // ============ Private Helpers ============

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logRequest(url: string, options?: RequestInit): void {
    const logData: Record<string, unknown> = {
      connector: this.name,
      method: options?.method ?? 'GET',
      url,
    };

    if (this.config.logging?.logHeaders && options?.headers) {
      // Redact sensitive headers
      const headers = { ...options.headers } as Record<string, string>;
      if (headers['Authorization']) {
        headers['Authorization'] = '[REDACTED]';
      }
      if (headers['authorization']) {
        headers['authorization'] = '[REDACTED]';
      }
      logData.headers = headers;
    }

    if (this.config.logging?.logBody && options?.body) {
      logData.body = typeof options.body === 'string' ? options.body.slice(0, 1000) : '[non-string body]';
    }

    logger.debug(logData, `Connector ${this.name} request`);
  }

  private logResponse(url: string, response: Response, latency: number): void {
    logger.debug(
      { connector: this.name, url, status: response.status, latency },
      `Connector ${this.name} response`
    );
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Clean up resources
    if (this.circuitBreaker) {
      this.circuitBreaker.removeAllListeners();
    }
    this.oauthManager = undefined;
    this.circuitBreaker = undefined;
  }

  /**
   * Check if connector is disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  // ============ Private ============

  private initOAuthManager(auth: ConnectorAuth & { type: 'oauth' }): void {
    // Convert ConnectorAuth to OAuthConfig
    const oauthConfig = {
      flow: auth.flow as 'authorization_code' | 'client_credentials' | 'jwt_bearer',
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      tokenUrl: auth.tokenUrl,
      authorizationUrl: auth.authorizationUrl,
      redirectUri: auth.redirectUri,
      scope: auth.scope,
      usePKCE: auth.usePKCE,
      privateKey: auth.privateKey,
      privateKeyPath: auth.privateKeyPath,
      audience: auth.audience,
      refreshBeforeExpiry: auth.refreshBeforeExpiry,
      authorizationParams: auth.authorizationParams,
      storage: Connector.defaultStorage,
      storageKey: auth.storageKey ?? this.name,
    };

    this.oauthManager = new OAuthManager(oauthConfig);
  }

  private initJWTManager(auth: ConnectorAuth & { type: 'jwt' }): void {
    // JWT uses jwt_bearer flow via OAuthManager
    this.oauthManager = new OAuthManager({
      flow: 'jwt_bearer',
      clientId: auth.clientId,
      tokenUrl: auth.tokenUrl,
      privateKey: auth.privateKey,
      privateKeyPath: auth.privateKeyPath,
      scope: auth.scope,
      audience: auth.audience,
      storage: Connector.defaultStorage,
      storageKey: this.name,
    });
  }
}
