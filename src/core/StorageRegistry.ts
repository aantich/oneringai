/**
 * StorageRegistry - Centralized storage backend registry
 *
 * Provides a single point of configuration for all storage backends
 * used across the library. Subsystems resolve their storage at execution
 * time (not construction time) via `resolve()`, which lazily creates
 * and caches a default when nothing has been configured.
 *
 * Storage types are split into two categories:
 * - **Global singletons**: customTools, media, agentDefinitions, connectorConfig, oauthTokens
 * - **Per-agent factories** (need agentId): sessions, persistentInstructions, workingMemory
 *
 * For multi-user / multi-tenant environments, factories receive an optional
 * `StorageContext` (opaque, like `ConnectorAccessContext`) so backends can
 * partition data by userId, tenantId, or any custom field.
 *
 * @example
 * ```typescript
 * import { StorageRegistry } from '@everworker/oneringai';
 *
 * // Single-tenant (simple)
 * StorageRegistry.configure({
 *   customTools: new MongoCustomToolStorage(),
 *   media: new S3MediaStorage(),
 *   sessions: (agentId) => new RedisContextStorage(agentId),
 * });
 *
 * // Multi-tenant
 * StorageRegistry.configure({
 *   sessions: (agentId, ctx) => new RedisContextStorage(agentId, ctx?.userId),
 *   customTools: new MongoCustomToolStorage(),  // global singletons are unaffected
 * });
 * ```
 */

import type { ICustomToolStorage } from '../domain/interfaces/ICustomToolStorage.js';
import type { IMediaStorage } from '../domain/interfaces/IMediaStorage.js';
import type { IAgentDefinitionStorage } from '../domain/interfaces/IAgentDefinitionStorage.js';
import type { IConnectorConfigStorage } from '../domain/interfaces/IConnectorConfigStorage.js';
import type { ITokenStorage } from '../connectors/oauth/domain/ITokenStorage.js';
import type { IContextStorage } from '../domain/interfaces/IContextStorage.js';
import type { IPersistentInstructionsStorage } from '../domain/interfaces/IPersistentInstructionsStorage.js';
import type { IMemoryStorage } from '../domain/interfaces/IMemoryStorage.js';
import type { IUserInfoStorage } from '../domain/interfaces/IUserInfoStorage.js';
import type { IRoutineDefinitionStorage } from '../domain/interfaces/IRoutineDefinitionStorage.js';
import type { IRoutineExecutionStorage } from '../domain/interfaces/IRoutineExecutionStorage.js';
import type { ICorrelationStorage } from '../domain/interfaces/ICorrelationStorage.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Opaque context passed to per-agent storage factories.
 *
 * The library imposes no structure — consumers define their own shape
 * (e.g., `{ userId: 'alice', tenantId: 'acme' }`).
 *
 * Mirrors the `ConnectorAccessContext` pattern used by `Connector.scoped()`.
 */
export type StorageContext = Record<string, unknown>;

/**
 * Storage configuration map.
 *
 * Global singletons are stored directly.
 * Per-agent factories are functions that accept an agentId (and optional
 * StorageContext for multi-tenant scenarios) and return a storage instance.
 */
export interface StorageConfig {
  // Global singletons
  media: IMediaStorage;
  agentDefinitions: IAgentDefinitionStorage;
  connectorConfig: IConnectorConfigStorage;
  oauthTokens: ITokenStorage;

  // Context-aware factories (optional StorageContext for multi-tenant)
  customTools: (context?: StorageContext) => ICustomToolStorage;
  sessions: (agentId: string, context?: StorageContext) => IContextStorage;
  persistentInstructions: (agentId: string, context?: StorageContext) => IPersistentInstructionsStorage;
  workingMemory: (context?: StorageContext) => IMemoryStorage;
  userInfo: (context?: StorageContext) => IUserInfoStorage;
  routineDefinitions: (context?: StorageContext) => IRoutineDefinitionStorage;
  routineExecutions: (context?: StorageContext) => IRoutineExecutionStorage;

  // Global singleton
  correlations: ICorrelationStorage;
}

// ============================================================================
// StorageRegistry
// ============================================================================

export class StorageRegistry {
  /** Internal storage map */
  private static entries = new Map<string, unknown>();

  /** Default context passed to all factory calls (set via setContext) */
  private static _context: StorageContext | undefined;

  /**
   * Configure multiple storage backends at once.
   *
   * @example
   * ```typescript
   * // Single-tenant
   * StorageRegistry.configure({
   *   customTools: new MongoCustomToolStorage(),
   *   sessions: (agentId) => new RedisContextStorage(agentId),
   * });
   *
   * // Multi-tenant
   * StorageRegistry.configure({
   *   sessions: (agentId, ctx) => new TenantContextStorage(agentId, ctx?.tenantId),
   *   persistentInstructions: (agentId, ctx) => new TenantInstructionsStorage(agentId, ctx?.userId),
   * });
   * ```
   */
  static configure(config: Partial<StorageConfig>): void {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        StorageRegistry.entries.set(key, value);
      }
    }
  }

  /**
   * Set the default StorageContext.
   *
   * This context is automatically passed to all per-agent factory calls
   * (sessions, persistentInstructions, workingMemory) when no explicit
   * context is provided. Typically set once at app startup with global
   * tenant/environment info, or per-request in multi-tenant servers.
   *
   * @example
   * ```typescript
   * // Single-tenant app — set once at init
   * StorageRegistry.setContext({ tenantId: 'acme', environment: 'production' });
   *
   * // Multi-tenant server — set per-request
   * app.use((req, res, next) => {
   *   StorageRegistry.setContext({ userId: req.user.id, tenantId: req.tenant.id });
   *   next();
   * });
   * ```
   */
  static setContext(context: StorageContext | undefined): void {
    StorageRegistry._context = context;
  }

  /**
   * Get the current default StorageContext.
   */
  static getContext(): StorageContext | undefined {
    return StorageRegistry._context;
  }

  /**
   * Set a single storage backend.
   */
  static set<K extends keyof StorageConfig>(key: K, value: StorageConfig[K]): void {
    StorageRegistry.entries.set(key, value);
  }

  /**
   * Get a storage backend (or undefined if not configured).
   */
  static get<K extends keyof StorageConfig>(key: K): StorageConfig[K] | undefined {
    return StorageRegistry.entries.get(key) as StorageConfig[K] | undefined;
  }

  /**
   * Resolve a storage backend, lazily creating and caching a default if needed.
   *
   * If a value has been configured via `set()` or `configure()`, returns that.
   * Otherwise, calls `defaultFactory()`, caches the result, and returns it.
   */
  static resolve<K extends keyof StorageConfig>(key: K, defaultFactory: () => StorageConfig[K]): StorageConfig[K] {
    const existing = StorageRegistry.entries.get(key) as StorageConfig[K] | undefined;
    if (existing !== undefined) {
      return existing;
    }

    const value = defaultFactory();
    StorageRegistry.entries.set(key, value);
    return value;
  }

  /**
   * Remove a single storage backend.
   */
  static remove(key: keyof StorageConfig): boolean {
    return StorageRegistry.entries.delete(key);
  }

  /**
   * Check if a storage backend has been configured.
   */
  static has(key: keyof StorageConfig): boolean {
    return StorageRegistry.entries.has(key);
  }

  /**
   * Clear all configured storage backends and context.
   * Useful for testing.
   */
  static reset(): void {
    StorageRegistry.entries.clear();
    StorageRegistry._context = undefined;
  }
}
