/**
 * ConnectorConfig Storage Module
 *
 * Provides persistent storage for ConnectorConfig with automatic encryption.
 *
 * Usage:
 * ```typescript
 * import {
 *   ConnectorConfigStore,
 *   FileConnectorStorage,
 *   MemoryConnectorStorage
 * } from 'oneringai';
 *
 * // File-based storage
 * const storage = new FileConnectorStorage({ directory: './connectors' });
 * const store = new ConnectorConfigStore(storage, process.env.ENCRYPTION_KEY!);
 *
 * // Save (secrets auto-encrypted)
 * await store.save('openai', { auth: { type: 'api_key', apiKey: 'sk-xxx' } });
 *
 * // Load (secrets auto-decrypted)
 * const config = await store.get('openai');
 * ```
 */

// Domain service (handles encryption)
export { ConnectorConfigStore } from './ConnectorConfigStore.js';

// Storage implementations
export { MemoryConnectorStorage } from './MemoryConnectorStorage.js';
export { FileConnectorStorage } from './FileConnectorStorage.js';
export type { FileConnectorStorageConfig } from './FileConnectorStorage.js';

// Re-export interface and types from domain
export type {
  IConnectorConfigStorage,
  StoredConnectorConfig,
} from '../../domain/interfaces/IConnectorConfigStorage.js';
export { CONNECTOR_CONFIG_VERSION } from '../../domain/interfaces/IConnectorConfigStorage.js';
