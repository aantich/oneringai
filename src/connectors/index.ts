/**
 * Connectors - OAuth and authentication utilities
 *
 * Provides OAuth 2.0 infrastructure for authenticated API access.
 * Use Connector.create() from '@everworker/oneringai' for connector registration.
 *
 * Supports:
 * - OAuth 2.0 (Authorization Code + PKCE, Client Credentials, JWT Bearer)
 * - API Keys
 * - JWT Bearer tokens
 */

// OAuth manager
export {
  OAuthManager,
} from './oauth/index.js';

export type {
  OAuthConfig,
  OAuthFlow,
  TokenResponse,
  StoredToken,
} from './oauth/types.js';

export type { ITokenStorage } from './oauth/domain/ITokenStorage.js';

// Storage implementations
export { MemoryStorage } from './oauth/infrastructure/storage/MemoryStorage.js';
export { FileStorage } from './oauth/infrastructure/storage/FileStorage.js';
export type { FileStorageConfig } from './oauth/infrastructure/storage/FileStorage.js';

// Utilities
export { authenticatedFetch, createAuthenticatedFetch } from './authenticatedFetch.js';
export { generateWebAPITool } from './toolGenerator.js';

// OAuth utilities (for advanced users)
export { generatePKCE, generateState } from './oauth/utils/pkce.js';
export { encrypt, decrypt, generateEncryptionKey } from './oauth/utils/encryption.js';

// ConnectorConfig storage (for persistent connector configs)
export {
  ConnectorConfigStore,
  MemoryConnectorStorage,
  FileConnectorStorage,
  CONNECTOR_CONFIG_VERSION,
} from './storage/index.js';
export type {
  IConnectorConfigStorage,
  StoredConnectorConfig,
  FileConnectorStorageConfig,
} from './storage/index.js';

// ============ Vendor Templates ============
// Pre-configured auth templates for 40+ common services
export {
  // Helpers
  createConnectorFromTemplate,
  getConnectorTools,
  getVendorTemplate,
  getVendorAuthTemplate,
  getAllVendorTemplates,
  listVendorIds,
  listVendors,
  listVendorsByCategory,
  listVendorsByAuthType,
  getVendorInfo,
  getCredentialsSetupURL,
  getDocsURL,
  buildAuthConfig,
  extractNonSecretCredentials,
  // All templates array
  allVendorTemplates,
  // Logo utilities
  getVendorLogo,
  getVendorLogoSvg,
  getVendorColor,
  getVendorLogoCdnUrl,
  hasVendorLogo,
  getAllVendorLogos,
  listVendorsWithLogos,
  VENDOR_ICON_MAP,
  SIMPLE_ICONS_CDN,
} from './vendors/index.js';

export type {
  VendorTemplate,
  AuthTemplate,
  AuthTemplateField,
  OptionField,
  VendorRegistryEntry,
  TemplateCredentials,
  CreateConnectorOptions,
  VendorInfo,
  VendorLogo,
  SimpleIcon,
} from './vendors/index.js';
