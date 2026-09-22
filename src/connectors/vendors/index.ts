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
  RefreshStrategy,
  OptionField,
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
  applyRefreshStrategy,
  extractNonSecretCredentials,
  initVendorRegistry,
} from './helpers.js';
export type { VendorInfo, ApplyRefreshStrategyOptions, BuildAuthConfigOptions } from './helpers.js';

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
import { initVendorRegistry, applyRefreshStrategy, getAllVendorTemplates } from './helpers.js';
import { allVendorTemplates } from './templates/index.js';
import { Connector } from '../../core/Connector.js';

// Initialize registry with all templates
initVendorRegistry(allVendorTemplates);

// Register the legacy-config backfill so Connectors reconstructed from saved
// DB configs (which may pre-date the `requiredScope` annotation) re-apply the
// vendor's RefreshStrategy at load time. Without this, an upgraded host with
// existing Microsoft connectors using `.default` scope overrides would lose
// refresh-token issuance silently — every saved config would need a manual
// re-stamp migration. This makes the upgrade self-healing.
//
// Idempotent for both fresh and saved configs, including existing required scopes.
// This applies refresh metadata only, never general scope or prompt defaults.
Connector.setRefreshStrategyBackfill((serviceType, auth) => {
  if (!serviceType) return undefined;
  // Match by serviceType, not vendor id — both are typically equal but
  // serviceType is what's persisted on ConnectorConfig and is the API-facing
  // discriminator. Find the auth-code template for this service.
  const candidates = getAllVendorTemplates()
    .filter(t => t.serviceType === serviceType)
    .flatMap(t => t.authTemplates)
    .filter(a => a.type === 'oauth' && a.flow === 'authorization_code');
  const strategyKey = (strategy: typeof candidates[number]['refreshStrategy']) => {
    if (!strategy) return undefined;
    switch (strategy.kind) {
      case 'scope': return JSON.stringify([strategy.kind, strategy.scope]);
      case 'auth_param': return JSON.stringify([strategy.kind, strategy.key, strategy.value]);
      case 'manual_setup': return JSON.stringify([strategy.kind, strategy.description]);
      default: return strategy.kind;
    }
  };
  const authTemplate = candidates[0];
  if (!authTemplate?.refreshStrategy || candidates.some(a =>
    strategyKey(a.refreshStrategy) !== strategyKey(authTemplate.refreshStrategy),
  )) return undefined; // Host must select the exact template; never guess the first.

  // Re-apply the strategy to the existing scope/authorizationParams. We pass
  // the persisted `auth.scope` as the base so operator overrides are
  // preserved verbatim — only the refresh-grant token is force-merged back.
  const result = applyRefreshStrategy(
    auth.scope,
    auth.authorizationParams,
    authTemplate.refreshStrategy,
    { requiredScope: auth.requiredScope },
  );
  return {
    requiredScope: result.requiredScope,
    scope: result.scope,
    authorizationParams: result.authorizationParams,
  };
});
