/**
 * Vendor Templates - Main Export
 *
 * Pre-configured authentication templates for 40+ common services.
 * Use createConnectorFromTemplate() for easy connector setup.
 *
 * @example
 * ```typescript
 * import {
 *   createConnectorFromTemplate,
 *   listVendors,
 *   getVendorTemplate,
 * } from '@everworker/oneringai';
 *
 * // List all available vendors
 * const vendors = listVendors();
 *
 * // Create a GitHub connector with PAT
 * const connector = createConnectorFromTemplate(
 *   'my-github',
 *   'github',
 *   'pat',
 *   { apiKey: process.env.GITHUB_TOKEN }
 * );
 *
 * // Get tools for the connector
 * const tools = getConnectorTools('my-github');
 * ```
 */

// Types
export type {
  VendorTemplate,
  AuthTemplate,
  AuthTemplateField,
  VendorRegistryEntry,
  TemplateCredentials,
  CreateConnectorOptions,
} from './types.js';

// Helpers
export {
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
  initVendorRegistry,
} from './helpers.js';
export type { VendorInfo } from './helpers.js';

// All templates
export { allVendorTemplates } from './templates/index.js';

// Individual templates for direct access
export * from './templates/index.js';

// Logo utilities
export {
  getVendorLogo,
  getVendorLogoSvg,
  getVendorColor,
  getVendorLogoCdnUrl,
  hasVendorLogo,
  getAllVendorLogos,
  listVendorsWithLogos,
  VENDOR_ICON_MAP,
  SIMPLE_ICONS_CDN,
} from './logos.js';
export type { VendorLogo, SimpleIcon } from './logos.js';

// Auto-register templates on import
import { initVendorRegistry } from './helpers.js';
import { allVendorTemplates } from './templates/index.js';

// Initialize registry with all templates
initVendorRegistry(allVendorTemplates);
