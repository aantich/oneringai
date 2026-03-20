/**
 * ConnectorConfig Storage Interface (Clean Architecture - Domain Layer)
 *
 * Defines the contract for storing and retrieving ConnectorConfig objects.
 * Storage implementations do NOT handle encryption - that's done by ConnectorConfigStore.
 */

import type { ConnectorConfig } from '../entities/Connector.js';

/**
 * Wrapper for stored connector configuration with metadata
 */
export interface StoredConnectorConfig {
  /** The connector configuration (may contain encrypted fields) */
  config: ConnectorConfig;

  /** Timestamp when the config was first stored */
  createdAt: number;

  /** Timestamp when the config was last updated */
  updatedAt: number;

  /** Schema version for future migrations */
  version: number;

  /**
   * Raw non-secret template credentials for round-trip editing.
   * Populated by saveFromTemplate() / updateFromTemplate().
   * Contains only non-secret fields (clientId, tenantId, scope, redirectUri, etc.).
   * Secret fields (apiKey, clientSecret, privateKey, etc.) are NEVER stored here.
   * Used by edit UIs to re-populate form fields without needing to decrypt config.auth.
   */
  templateCredentials?: Record<string, string>;

  /** Vendor ID used to create this connector (e.g., 'microsoft', 'slack') */
  vendorId?: string;

  /** Auth template ID used (e.g., 'oauth-user', 'pat', 'bot-token') */
  authTemplateId?: string;
}

/**
 * Storage interface for ConnectorConfig persistence
 *
 * Implementations should:
 * - Store data as-is (encryption is handled by ConnectorConfigStore)
 * - Use appropriate file permissions for file-based storage
 * - Hash names for filenames to prevent enumeration attacks
 */
export interface IConnectorConfigStorage {
  /**
   * Save a connector configuration
   *
   * @param name - Unique identifier for this connector
   * @param stored - The stored config with metadata
   */
  save(name: string, stored: StoredConnectorConfig): Promise<void>;

  /**
   * Retrieve a connector configuration by name
   *
   * @param name - Unique identifier for the connector
   * @returns The stored config or null if not found
   */
  get(name: string): Promise<StoredConnectorConfig | null>;

  /**
   * Delete a connector configuration
   *
   * @param name - Unique identifier for the connector
   * @returns True if deleted, false if not found
   */
  delete(name: string): Promise<boolean>;

  /**
   * Check if a connector configuration exists
   *
   * @param name - Unique identifier for the connector
   * @returns True if exists
   */
  has(name: string): Promise<boolean>;

  /**
   * List all connector names
   *
   * @returns Array of connector names
   */
  list(): Promise<string[]>;

  /**
   * Get all stored connector configurations
   *
   * @returns Array of all stored configs
   */
  listAll(): Promise<StoredConnectorConfig[]>;
}

/** Current schema version */
export const CONNECTOR_CONFIG_VERSION = 1;
