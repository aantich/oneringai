/**
 * Connector - Represents authenticated connection to ANY API
 *
 * Connectors handle authentication for:
 * - AI providers (OpenAI, Anthropic, Google, etc.)
 * - External APIs (GitHub, Microsoft, Salesforce, etc.)
 *
 * This is the SINGLE source of truth for authentication.
 */

import type { Vendor } from '../../core/Vendor.js';

/**
 * No authentication (for testing/mock providers and local services like Ollama)
 */
export interface NoneConnectorAuth {
  type: 'none';
}

/**
 * Connector authentication configuration
 * Supports OAuth 2.0, API keys, JWT bearer tokens, and none (for testing)
 */
export type ConnectorAuth =
  | OAuthConnectorAuth
  | APIKeyConnectorAuth
  | JWTConnectorAuth
  | NoneConnectorAuth;


/**
 * OAuth 2.0 authentication for connectors
 * Supports multiple OAuth flows
 */
export interface OAuthConnectorAuth {
  type: 'oauth';
  flow: 'authorization_code' | 'client_credentials' | 'jwt_bearer';

  // OAuth configuration
  clientId: string;
  clientSecret?: string;
  tokenUrl: string;

  // Authorization code flow specific
  authorizationUrl?: string;
  redirectUri?: string;
  scope?: string;
  usePKCE?: boolean;

  // JWT bearer flow specific
  privateKey?: string;
  privateKeyPath?: string;
  issuer?: string;
  subject?: string;
  audience?: string;

  // Advanced options
  refreshBeforeExpiry?: number; // Seconds before expiry to refresh (default: 300)
  storageKey?: string; // Custom storage key

  /** Extra query parameters appended to the authorization URL.
   *  Used for vendor-specific requirements, e.g. Google's `access_type: 'offline'`. */
  authorizationParams?: Record<string, string>;

  /** Vendor-specific extra credentials */
  extra?: Record<string, string>;
}

/**
 * Static API key authentication
 * For services like OpenAI, Anthropic, many SaaS APIs
 */
export interface APIKeyConnectorAuth {
  type: 'api_key';
  apiKey: string;
  headerName?: string; // Default: "Authorization"
  headerPrefix?: string; // Default: "Bearer"

  /**
   * Vendor-specific extra credentials beyond the primary API key.
   * E.g., Slack Socket Mode needs { appToken: 'xapp-...', signingSecret: '...' }
   */
  extra?: Record<string, string>;
}

/**
 * JWT Bearer token authentication
 * For service accounts (Google, Salesforce)
 */
export interface JWTConnectorAuth {
  type: 'jwt';
  privateKey: string;
  privateKeyPath?: string;
  tokenUrl: string;
  clientId: string;
  scope?: string;
  issuer?: string;
  subject?: string;
  audience?: string;

  /** Vendor-specific extra credentials */
  extra?: Record<string, string>;
}

/**
 * Complete connector configuration
 * Used for BOTH AI providers AND external APIs
 */
export interface ConnectorConfig {
  // Unique identifier (required for Connector.create())
  name?: string; // e.g., 'openai-main', 'openai-backup', 'github-user'

  // For AI providers: specify vendor (auto-selects SDK)
  vendor?: Vendor; // e.g., Vendor.OpenAI, Vendor.Anthropic

  // For external services: specify service type for tool generation
  // If not specified, will be auto-detected from baseURL patterns
  // Use Services constants (e.g., Services.Slack) or any string
  serviceType?: string;

  // Authentication
  auth: ConnectorAuth;

  // Optional identity
  displayName?: string; // Human-readable name
  description?: string; // What this connector provides

  // Optional: Override default baseURL (required for Custom vendor)
  baseURL?: string;

  // Optional: Default model for AI providers
  defaultModel?: string;

  // Optional metadata
  apiVersion?: string;
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
  };
  documentation?: string;
  tags?: string[];

  // Vendor-specific options
  options?: {
    organization?: string; // OpenAI
    project?: string; // OpenAI
    anthropicVersion?: string;
    location?: string; // Google Vertex
    projectId?: string; // Google Vertex
    [key: string]: unknown;
  };

  // ============ Resilience Options (Enterprise) ============

  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Retry configuration for transient failures
   */
  retry?: {
    /** Maximum number of retry attempts @default 3 */
    maxRetries?: number;
    /** HTTP status codes that trigger retry @default [429, 500, 502, 503, 504] */
    retryableStatuses?: number[];
    /** Base delay in ms for exponential backoff @default 1000 */
    baseDelayMs?: number;
    /** Maximum delay in ms @default 30000 */
    maxDelayMs?: number;
  };

  /**
   * Circuit breaker configuration for failing services
   */
  circuitBreaker?: {
    /** Enable circuit breaker @default true */
    enabled?: boolean;
    /** Number of failures before opening circuit @default 5 */
    failureThreshold?: number;
    /** Number of successes to close circuit @default 2 */
    successThreshold?: number;
    /** Time in ms before attempting to close circuit @default 30000 */
    resetTimeoutMs?: number;
  };

  /**
   * Logging configuration for requests/responses
   */
  logging?: {
    /** Enable request/response logging @default false */
    enabled?: boolean;
    /** Log request/response bodies (security risk) @default false */
    logBody?: boolean;
    /** Log request/response headers (security risk) @default false */
    logHeaders?: boolean;
  };
}

/**
 * Result from ProviderConfigAgent
 * Includes setup instructions and environment variables
 */
export interface ConnectorConfigResult {
  name: string; // Connector identifier (e.g., "github", "microsoft")
  config: ConnectorConfig; // Full configuration
  setupInstructions: string; // Step-by-step setup guide
  envVariables: string[]; // Required environment variables
  setupUrl?: string; // Direct URL to credential setup page
}
