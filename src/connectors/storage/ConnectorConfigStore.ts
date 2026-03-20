/**
 * ConnectorConfigStore - Domain service for storing ConnectorConfig with encryption
 *
 * Handles encryption/decryption of sensitive fields uniformly,
 * regardless of which storage backend is used.
 */

import type { ConnectorConfig, ConnectorAuth } from '../../domain/entities/Connector.js';
import type {
  IConnectorConfigStorage,
  StoredConnectorConfig,
} from '../../domain/interfaces/IConnectorConfigStorage.js';
import { CONNECTOR_CONFIG_VERSION } from '../../domain/interfaces/IConnectorConfigStorage.js';
import { encrypt, decrypt } from '../oauth/utils/encryption.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';
import {
  buildAuthConfig,
  extractNonSecretCredentials,
  getVendorTemplate,
  getVendorAuthTemplate,
} from '../vendors/helpers.js';
import type { TemplateCredentials } from '../vendors/types.js';

/** Prefix for encrypted values */
const ENCRYPTED_PREFIX = '$ENC$:';

/**
 * ConnectorConfigStore - manages connector configs with automatic encryption
 *
 * Usage:
 * ```typescript
 * const storage = new MemoryConnectorStorage();
 * const store = new ConnectorConfigStore(storage, process.env.ENCRYPTION_KEY!);
 *
 * await store.save('openai', { auth: { type: 'api_key', apiKey: 'sk-xxx' } });
 * const config = await store.get('openai'); // apiKey is decrypted
 * ```
 */
export class ConnectorConfigStore {
  constructor(
    private storage: IConnectorConfigStorage,
    private encryptionKey: string
  ) {
    if (!encryptionKey || encryptionKey.length < 16) {
      throw new Error(
        'ConnectorConfigStore requires an encryption key of at least 16 characters'
      );
    }
  }

  /**
   * Factory that resolves storage from StorageRegistry when no explicit storage is provided.
   *
   * @param encryptionKey - Encryption key for secrets (required, min 16 chars)
   * @param storage - Optional explicit storage backend (overrides registry)
   * @returns ConnectorConfigStore instance
   * @throws Error if no storage available (neither explicit nor in registry)
   */
  static create(encryptionKey: string, storage?: IConnectorConfigStorage): ConnectorConfigStore {
    if (storage) {
      return new ConnectorConfigStore(storage, encryptionKey);
    }

    const registryStorage = StorageRegistry.get('connectorConfig');
    if (!registryStorage) {
      throw new Error(
        'No storage provided and no connectorConfig configured in StorageRegistry. ' +
        'Pass storage explicitly or call StorageRegistry.set(\'connectorConfig\', storage) first.'
      );
    }
    return new ConnectorConfigStore(registryStorage, encryptionKey);
  }

  /**
   * Save a connector configuration (secrets are encrypted automatically)
   *
   * @param name - Unique identifier for this connector
   * @param config - The connector configuration
   */
  async save(name: string, config: ConnectorConfig): Promise<void> {
    if (!name || name.trim().length === 0) {
      throw new Error('Connector name is required');
    }

    const existing = await this.storage.get(name);
    const now = Date.now();

    const encryptedConfig = this.encryptSecrets(config);

    const stored: StoredConnectorConfig = {
      config: { ...encryptedConfig, name },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: CONNECTOR_CONFIG_VERSION,
    };

    await this.storage.save(name, stored);
  }

  /**
   * Retrieve a connector configuration (secrets are decrypted automatically)
   *
   * @param name - Unique identifier for the connector
   * @returns The decrypted config or null if not found
   */
  async get(name: string): Promise<ConnectorConfig | null> {
    const stored = await this.storage.get(name);
    if (!stored) {
      return null;
    }

    return this.decryptSecrets(stored.config);
  }

  /**
   * Delete a connector configuration
   *
   * @param name - Unique identifier for the connector
   * @returns True if deleted, false if not found
   */
  async delete(name: string): Promise<boolean> {
    return this.storage.delete(name);
  }

  /**
   * Check if a connector configuration exists
   *
   * @param name - Unique identifier for the connector
   * @returns True if exists
   */
  async has(name: string): Promise<boolean> {
    return this.storage.has(name);
  }

  /**
   * List all connector names
   *
   * @returns Array of connector names
   */
  async list(): Promise<string[]> {
    return this.storage.list();
  }

  /**
   * Get all connector configurations (secrets are decrypted automatically)
   *
   * @returns Array of decrypted configs
   */
  async listAll(): Promise<ConnectorConfig[]> {
    const stored = await this.storage.listAll();
    return stored.map((s) => this.decryptSecrets(s.config));
  }

  /**
   * Get stored metadata for a connector
   *
   * @param name - Unique identifier for the connector
   * @returns Metadata (createdAt, updatedAt, version) or null
   */
  async getMetadata(
    name: string
  ): Promise<{ createdAt: number; updatedAt: number; version: number } | null> {
    const stored = await this.storage.get(name);
    if (!stored) {
      return null;
    }
    return {
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      version: stored.version,
    };
  }

  // ============ Template Lifecycle ============

  /**
   * Options for saveFromTemplate / updateFromTemplate
   */
  static TemplateOptions: undefined; // type anchor only

  /**
   * Save a connector created from a vendor template.
   * Handles the full lifecycle: validates, builds auth, encrypts secrets,
   * stores config AND preserves non-secret credentials for round-trip editing.
   *
   * @param name - Unique connector name
   * @param vendorId - Vendor template ID (e.g., 'microsoft', 'slack')
   * @param authTemplateId - Auth method ID (e.g., 'oauth-user', 'pat')
   * @param credentials - Raw credentials from the user form
   * @param options - Optional overrides (baseURL, displayName, etc.)
   * @returns The built ConnectorConfig (decrypted, for runtime registration)
   */
  async saveFromTemplate(
    name: string,
    vendorId: string,
    authTemplateId: string,
    credentials: TemplateCredentials,
    options?: {
      baseURL?: string;
      displayName?: string;
      description?: string;
      defaultModel?: string;
      vendor?: string;
      serviceType?: string;
    },
  ): Promise<ConnectorConfig> {
    if (!name || name.trim().length === 0) {
      throw new Error('Connector name is required');
    }

    const template = getVendorTemplate(vendorId);
    if (!template) {
      throw new Error(`Unknown vendor: ${vendorId}`);
    }
    const authTemplate = getVendorAuthTemplate(vendorId, authTemplateId);
    if (!authTemplate) {
      throw new Error(`Unknown auth method '${authTemplateId}' for vendor '${vendorId}'`);
    }

    // Build auth config from template + credentials
    const auth = buildAuthConfig(authTemplate, credentials);

    // Build full connector config
    const config: ConnectorConfig = {
      name,
      vendor: (options?.vendor ?? vendorId) as any,
      serviceType: options?.serviceType ?? template.serviceType,
      auth,
      baseURL: options?.baseURL ?? template.baseURL,
      displayName: options?.displayName ?? template.name,
      description: options?.description,
      defaultModel: options?.defaultModel,
    };

    // Extract non-secret credentials for round-trip editing
    const templateCredentials = extractNonSecretCredentials(authTemplate, credentials);

    // Encrypt and save
    const existing = await this.storage.get(name);
    const now = Date.now();
    const encryptedConfig = this.encryptSecrets(config);

    const stored: StoredConnectorConfig = {
      config: { ...encryptedConfig, name },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: CONNECTOR_CONFIG_VERSION,
      templateCredentials,
      vendorId,
      authTemplateId,
    };

    await this.storage.save(name, stored);

    return config;
  }

  /**
   * Update a connector that was created from a vendor template.
   * Merges new credentials with existing: non-empty values override,
   * empty values preserve the existing decrypted value ("leave empty to keep").
   *
   * @param name - Existing connector name
   * @param vendorId - Vendor template ID
   * @param authTemplateId - Auth method ID
   * @param credentials - New credentials (empty strings = keep existing)
   * @param options - Optional overrides
   * @returns The updated ConnectorConfig (decrypted, for runtime re-registration)
   */
  async updateFromTemplate(
    name: string,
    vendorId: string,
    authTemplateId: string,
    credentials: TemplateCredentials,
    options?: {
      baseURL?: string;
      displayName?: string;
      description?: string;
      defaultModel?: string;
      vendor?: string;
      serviceType?: string;
    },
  ): Promise<ConnectorConfig> {
    const template = getVendorTemplate(vendorId);
    if (!template) {
      throw new Error(`Unknown vendor: ${vendorId}`);
    }
    const authTemplate = getVendorAuthTemplate(vendorId, authTemplateId);
    if (!authTemplate) {
      throw new Error(`Unknown auth method '${authTemplateId}' for vendor '${vendorId}'`);
    }

    // Load existing decrypted config for merging
    const existingConfig = await this.get(name);

    // Merge credentials: new non-empty values override, empty = keep existing
    const merged: Record<string, string> = {};
    const allFields = [
      ...authTemplate.requiredFields,
      ...(authTemplate.optionalFields ?? []),
    ];

    for (const field of allFields) {
      if (credentials[field]) {
        // User provided a new value
        merged[field] = credentials[field]!;
      } else if (existingConfig) {
        // Try to get existing value from decrypted auth
        const authAny = existingConfig.auth as Record<string, any>;
        if (typeof authAny[field] === 'string' && authAny[field]) {
          merged[field] = authAny[field];
        } else if (authAny.extra && typeof authAny.extra[field] === 'string' && authAny.extra[field]) {
          merged[field] = authAny.extra[field];
        }
      }
    }

    // Build new auth from merged credentials
    const auth = buildAuthConfig(authTemplate, merged);

    // Build updated config
    const config: ConnectorConfig = {
      ...(existingConfig || {}),
      name,
      vendor: (options?.vendor ?? vendorId) as any,
      serviceType: options?.serviceType ?? template.serviceType,
      auth,
      baseURL: options?.baseURL ?? existingConfig?.baseURL ?? template.baseURL,
      displayName: options?.displayName ?? existingConfig?.displayName ?? template.name,
      description: options?.description ?? existingConfig?.description,
      defaultModel: options?.defaultModel ?? existingConfig?.defaultModel,
    };

    // Extract non-secret credentials for round-trip editing
    const templateCredentials = extractNonSecretCredentials(authTemplate, merged);

    // Encrypt and save
    const existing = await this.storage.get(name);
    const now = Date.now();
    const encryptedConfig = this.encryptSecrets(config);

    const stored: StoredConnectorConfig = {
      config: { ...encryptedConfig, name },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: CONNECTOR_CONFIG_VERSION,
      templateCredentials,
      vendorId,
      authTemplateId,
    };

    await this.storage.save(name, stored);

    return config;
  }

  // ============ Encryption Helpers ============

  /**
   * Encrypt sensitive fields in a ConnectorConfig
   * Fields encrypted: apiKey, clientSecret, privateKey
   */
  private encryptSecrets(config: ConnectorConfig): ConnectorConfig {
    const result = { ...config };

    if (result.auth) {
      result.auth = this.encryptAuthSecrets(result.auth);
    }

    return result;
  }

  /**
   * Decrypt sensitive fields in a ConnectorConfig
   */
  private decryptSecrets(config: ConnectorConfig): ConnectorConfig {
    const result = { ...config };

    if (result.auth) {
      result.auth = this.decryptAuthSecrets(result.auth);
    }

    return result;
  }

  /**
   * Encrypt secrets in ConnectorAuth based on auth type
   */
  private encryptAuthSecrets(auth: ConnectorAuth): ConnectorAuth {
    const encryptedExtra = this.encryptExtra((auth as any).extra);

    switch (auth.type) {
      case 'api_key':
        return {
          ...auth,
          apiKey: this.encryptValue(auth.apiKey),
          ...(encryptedExtra ? { extra: encryptedExtra } : {}),
        };

      case 'oauth':
        return {
          ...auth,
          clientSecret: auth.clientSecret
            ? this.encryptValue(auth.clientSecret)
            : undefined,
          privateKey: auth.privateKey
            ? this.encryptValue(auth.privateKey)
            : undefined,
          ...(encryptedExtra ? { extra: encryptedExtra } : {}),
        };

      case 'jwt':
        return {
          ...auth,
          privateKey: this.encryptValue(auth.privateKey),
          ...(encryptedExtra ? { extra: encryptedExtra } : {}),
        };

      default:
        return auth;
    }
  }

  /**
   * Decrypt secrets in ConnectorAuth based on auth type
   */
  private decryptAuthSecrets(auth: ConnectorAuth): ConnectorAuth {
    const decryptedExtra = this.decryptExtra((auth as any).extra);

    switch (auth.type) {
      case 'api_key':
        return {
          ...auth,
          apiKey: this.decryptValue(auth.apiKey),
          ...(decryptedExtra ? { extra: decryptedExtra } : {}),
        };

      case 'oauth':
        return {
          ...auth,
          clientSecret: auth.clientSecret
            ? this.decryptValue(auth.clientSecret)
            : undefined,
          privateKey: auth.privateKey
            ? this.decryptValue(auth.privateKey)
            : undefined,
          ...(decryptedExtra ? { extra: decryptedExtra } : {}),
        };

      case 'jwt':
        return {
          ...auth,
          privateKey: this.decryptValue(auth.privateKey),
          ...(decryptedExtra ? { extra: decryptedExtra } : {}),
        };

      default:
        return auth;
    }
  }

  /**
   * Encrypt all values in an extra Record (vendor-specific credentials)
   */
  private encryptExtra(
    extra: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!extra || Object.keys(extra).length === 0) return undefined;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(extra)) {
      result[key] = this.encryptValue(value);
    }
    return result;
  }

  /**
   * Decrypt all values in an extra Record (vendor-specific credentials)
   */
  private decryptExtra(
    extra: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!extra || Object.keys(extra).length === 0) return undefined;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(extra)) {
      result[key] = this.decryptValue(value);
    }
    return result;
  }

  /**
   * Encrypt a single value if not already encrypted
   */
  private encryptValue(value: string): string {
    if (this.isEncrypted(value)) {
      return value; // Already encrypted
    }
    const encrypted = encrypt(value, this.encryptionKey);
    return `${ENCRYPTED_PREFIX}${encrypted}`;
  }

  /**
   * Decrypt a single value if encrypted
   */
  private decryptValue(value: string): string {
    if (!this.isEncrypted(value)) {
      return value; // Not encrypted (legacy or plaintext)
    }
    const encryptedData = value.slice(ENCRYPTED_PREFIX.length);
    return decrypt(encryptedData, this.encryptionKey);
  }

  /**
   * Check if a value is encrypted (has the $ENC$: prefix)
   */
  private isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX);
  }
}
