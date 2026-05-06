/**
 * Vendor Templates - Helper Functions
 *
 * Functions for creating connectors from vendor templates.
 */

import { Connector } from '../../core/Connector.js';
import type { ConnectorAuth, ConnectorConfig } from '../../domain/entities/Connector.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import { ConnectorTools } from '../../tools/connector/ConnectorTools.js';
import type {
  VendorTemplate,
  AuthTemplate,
  RefreshStrategy,
  TemplateCredentials,
  CreateConnectorOptions,
} from './types.js';

// Import will be replaced by generated registry
let vendorRegistry: Map<string, VendorTemplate> | null = null;

/**
 * Initialize the vendor registry (called by generated registry file).
 *
 * Validates that every `authorization_code` auth template declares a
 * `refreshStrategy`. Refresh-token issuance is a contract — without an
 * explicit strategy, a vendor's tokens silently expire after ~1h with no
 * recovery. Failing fast here surfaces the missing annotation at boot
 * instead of as a silent prod degradation hours later.
 */
export function initVendorRegistry(templates: VendorTemplate[]): void {
  const errors: string[] = [];
  for (const template of templates) {
    for (const auth of template.authTemplates) {
      if (auth.type === 'oauth' && auth.flow === 'authorization_code' && !auth.refreshStrategy) {
        errors.push(`${template.id}/${auth.id}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Vendor registry: missing refreshStrategy on authorization_code auth templates: ${errors.join(', ')}. ` +
        `Every auth-code template MUST declare how its IdP issues refresh tokens (scope, auth_param, automatic, never_expires, or manual_setup).`
    );
  }
  vendorRegistry = new Map(templates.map((t) => [t.id, t]));
}

/**
 * Get vendor template by ID
 */
export function getVendorTemplate(vendorId: string): VendorTemplate | undefined {
  if (!vendorRegistry) {
    throw new Error(
      'Vendor registry not initialized. Make sure to import from @everworker/oneringai which auto-registers templates.'
    );
  }
  return vendorRegistry.get(vendorId);
}

/**
 * Get all vendor templates
 */
export function getAllVendorTemplates(): VendorTemplate[] {
  if (!vendorRegistry) {
    throw new Error(
      'Vendor registry not initialized. Make sure to import from @everworker/oneringai which auto-registers templates.'
    );
  }
  return Array.from(vendorRegistry.values());
}

/**
 * Get auth template for a vendor
 */
export function getVendorAuthTemplate(
  vendorId: string,
  authId: string
): AuthTemplate | undefined {
  const template = getVendorTemplate(vendorId);
  if (!template) return undefined;
  return template.authTemplates.find((a) => a.id === authId);
}

/**
 * List all vendor IDs
 */
export function listVendorIds(): string[] {
  if (!vendorRegistry) {
    throw new Error(
      'Vendor registry not initialized. Make sure to import from @everworker/oneringai which auto-registers templates.'
    );
  }
  return Array.from(vendorRegistry.keys());
}

/**
 * Merge a single required scope token into a space-separated scope string.
 * Idempotent: returns the input unchanged if the token is already present.
 * Empty / undefined input yields the required token alone (so the IdP at
 * least gets refresh-grant guidance). Preserves token order.
 */
function mergeScope(scope: string | undefined, required: string): string {
  const requiredTrimmed = required.trim();
  const trimmed = scope?.trim() ?? '';
  // Empty/whitespace `required` is a misconfiguration (TypeScript types
  // require `string`, not non-empty), but we never want to inject empty
  // tokens into the wire scope.
  if (!requiredTrimmed) return trimmed;
  if (!trimmed) return requiredTrimmed;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.includes(requiredTrimmed)) return trimmed;
  tokens.push(requiredTrimmed);
  return tokens.join(' ');
}

/**
 * Build the final OAuth scope sent to the provider.
 *
 * Operator scope wins as the base — a site override (e.g. Microsoft
 * `.default`) is honored verbatim. The strategy-driven required scope (if
 * any) is force-merged downstream by the caller via `mergeScope` before the
 * scope hits the wire. Empty-input fallback is `.default` (meaningful for
 * Microsoft, ignored by other vendors).
 */
function buildOAuthScope(
  connectorScope: string | undefined,
  authTemplate: AuthTemplate
): string {
  const connectorTrimmed = connectorScope?.trim();
  const templateScopes = authTemplate.scopes?.join(' ').trim() ?? '';
  const base = connectorTrimmed || templateScopes;
  return base || '.default';
}

/**
 * Apply a `RefreshStrategy` to an OAuth config under construction.
 * - `scope`: stamps `requiredScope` and force-merges into `scope`.
 * - `auth_param`: stamps the key/value into `authorizationParams` without
 *   clobbering pre-existing operator-set keys.
 * - `automatic` / `never_expires` / `manual_setup`: no-op on the wire.
 *
 * Returns a new partial config; caller merges into the OAuth config.
 *
 * Exported for the legacy-config backfill path in `Connector.initOAuthManager`
 * — re-applies the strategy when reconstructing a Connector from a DB config
 * that pre-dates the `requiredScope` annotation. Other call sites should not
 * use this directly; they should go through `buildAuthConfig`.
 */
export function applyRefreshStrategy(
  scope: string,
  authorizationParams: Record<string, string> | undefined,
  strategy: RefreshStrategy | undefined
): {
  scope: string;
  requiredScope: string | undefined;
  authorizationParams: Record<string, string> | undefined;
} {
  if (!strategy) {
    return { scope, requiredScope: undefined, authorizationParams };
  }
  switch (strategy.kind) {
    case 'scope':
      return {
        scope: mergeScope(scope, strategy.scope),
        requiredScope: strategy.scope,
        authorizationParams,
      };
    case 'auth_param': {
      const merged = { ...(authorizationParams ?? {}) };
      // Operator-supplied param wins (don't clobber explicit overrides).
      if (!(strategy.key in merged)) {
        merged[strategy.key] = strategy.value;
      }
      return {
        scope,
        requiredScope: undefined,
        authorizationParams: merged,
      };
    }
    case 'automatic':
    case 'never_expires':
    case 'manual_setup':
      return { scope, requiredScope: undefined, authorizationParams };
  }
}

/**
 * Build ConnectorAuth from auth template and credentials
 */
export function buildAuthConfig(
  authTemplate: AuthTemplate,
  credentials: TemplateCredentials
): ConnectorAuth {
  const defaults = authTemplate.defaults;

  if (authTemplate.type === 'api_key') {
    if (!credentials.apiKey) {
      throw new Error('API key is required for api_key auth');
    }

    // Collect vendor-specific extra fields from BOTH requiredFields and optionalFields
    // that aren't standard api_key props. E.g., Twilio needs accountId, AWS needs accessKeyId.
    const standardApiKeyFields = new Set(['apiKey', 'headerName', 'headerPrefix']);
    const extra: Record<string, string> = {};
    const allTemplateFields = [
      ...authTemplate.requiredFields,
      ...(authTemplate.optionalFields ?? []),
    ];
    for (const field of allTemplateFields) {
      if (!standardApiKeyFields.has(field) && credentials[field]) {
        extra[field] = credentials[field]!;
      }
    }

    let apiKey = credentials.apiKey;
    const headerPrefix = (defaults as { headerPrefix?: string }).headerPrefix ?? 'Bearer';

    // Basic Auth: base64-encode "user:password" per RFC 7617.
    // The user part is resolved from extra fields with priority:
    //   applicationKey (Twilio API Key SID) > username (Jira/Zendesk/Bitbucket) > accountId (Twilio) > 'api' (Mailgun)
    if (headerPrefix === 'Basic') {
      const basicUser = extra.applicationKey ?? extra.username ?? extra.accountId ?? 'api';
      apiKey = Buffer.from(`${basicUser}:${apiKey}`).toString('base64');
    }

    return {
      type: 'api_key',
      apiKey,
      headerName: (defaults as { headerName?: string }).headerName ?? 'Authorization',
      headerPrefix,
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
  }

  // OAuth type
  if (!authTemplate.flow) {
    throw new Error(`OAuth flow not specified in auth template: ${authTemplate.id}`);
  }

  const oauthDefaults = defaults as Partial<ConnectorAuth & { type: 'oauth' }>;

  // Apply the vendor's RefreshStrategy. For `scope` strategies the required
  // token is force-merged into `scope` AND stamped on `requiredScope` so it
  // survives reconstitution-from-DB paths that bypass `buildAuthConfig`. For
  // `auth_param` strategies the param is merged into `authorizationParams`
  // (which is already protected by being persisted on the auth config).
  const baseScope = buildOAuthScope(credentials.scope, authTemplate);
  const strategyResult = applyRefreshStrategy(
    baseScope,
    oauthDefaults.authorizationParams,
    authTemplate.flow === 'authorization_code' ? authTemplate.refreshStrategy : undefined,
  );

  // Build OAuth config based on flow type
  const oauthConfig: ConnectorAuth & { type: 'oauth' } = {
    type: 'oauth',
    flow: authTemplate.flow,
    clientId: credentials.clientId ?? '',
    clientSecret: credentials.clientSecret,
    tokenUrl: oauthDefaults.tokenUrl ?? '',
    authorizationUrl: oauthDefaults.authorizationUrl,
    redirectUri: credentials.redirectUri,
    scope: strategyResult.scope,
    requiredScope: strategyResult.requiredScope,
    usePKCE: oauthDefaults.usePKCE,
    privateKey: credentials.privateKey,
    privateKeyPath: credentials.privateKeyPath,
    audience: credentials.audience ?? oauthDefaults.audience,
    subject: credentials.subject ?? oauthDefaults.subject,
    authorizationParams: strategyResult.authorizationParams,
    tokenRequestStyle: (oauthDefaults as { tokenRequestStyle?: 'form' | 'bearer' }).tokenRequestStyle,
    tokenLifetimeSeconds: (oauthDefaults as { tokenLifetimeSeconds?: number }).tokenLifetimeSeconds,
  };

  // Handle URL templates (e.g., {tenantId}, {installationId})
  if (oauthConfig.tokenUrl && credentials.tenantId) {
    oauthConfig.tokenUrl = oauthConfig.tokenUrl.replace('{tenantId}', credentials.tenantId);
  }
  if (oauthConfig.authorizationUrl && credentials.tenantId) {
    oauthConfig.authorizationUrl = oauthConfig.authorizationUrl.replace(
      '{tenantId}',
      credentials.tenantId
    );
  }
  if (oauthConfig.tokenUrl && credentials.installationId) {
    oauthConfig.tokenUrl = oauthConfig.tokenUrl.replace(
      '{installationId}',
      credentials.installationId
    );
  }

  // Collect vendor-specific extra fields into auth.extra (same pattern as api_key).
  // This preserves template fields like tenantId, installationId so they survive
  // round-trips through save → load → edit → save.
  const standardOAuthFields = new Set([
    'clientId', 'clientSecret', 'tokenUrl', 'authorizationUrl',
    'redirectUri', 'scope', 'usePKCE', 'privateKey', 'privateKeyPath',
    'issuer', 'subject', 'audience',
  ]);
  const oauthExtra: Record<string, string> = {};
  const allOAuthFields = [
    ...authTemplate.requiredFields,
    ...(authTemplate.optionalFields ?? []),
  ];
  for (const field of allOAuthFields) {
    if (!standardOAuthFields.has(field) && credentials[field]) {
      oauthExtra[field] = credentials[field]!;
    }
  }
  if (Object.keys(oauthExtra).length > 0) {
    (oauthConfig as any).extra = oauthExtra;
  }

  // Remove undefined properties
  const configAsUnknown = oauthConfig as unknown as Record<string, unknown>;
  Object.keys(configAsUnknown).forEach((key) => {
    if (configAsUnknown[key] === undefined) {
      delete configAsUnknown[key];
    }
  });

  return oauthConfig;
}

/** Known secret field names that must NEVER be stored in plaintext */
const SECRET_CREDENTIAL_FIELDS = new Set([
  'apiKey', 'clientSecret', 'privateKey', 'privateKeyPath',
  'secretAccessKey', 'applicationKey', 'appToken', 'signingSecret',
  'accessKeyId',
]);

/**
 * Extract non-secret credentials from a raw credentials dict.
 * Used by ConnectorConfigStore.saveFromTemplate() to preserve
 * template field values for round-trip editing without storing secrets.
 */
export function extractNonSecretCredentials(
  authTemplate: AuthTemplate,
  credentials: TemplateCredentials,
): Record<string, string> {
  const result: Record<string, string> = {};
  const allFields = [
    ...authTemplate.requiredFields,
    ...(authTemplate.optionalFields ?? []),
  ];
  for (const field of allFields) {
    if (!SECRET_CREDENTIAL_FIELDS.has(field) && credentials[field]) {
      result[field] = credentials[field]!;
    }
  }
  return result;
}

/**
 * Validate that all required fields are provided
 */
function validateCredentials(
  authTemplate: AuthTemplate,
  credentials: TemplateCredentials
): void {
  const missing: string[] = [];

  for (const field of authTemplate.requiredFields) {
    if (!credentials[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required credentials for ${authTemplate.name}: ${missing.join(', ')}`
    );
  }
}

/**
 * Create a Connector from a vendor template
 *
 * @param name - Unique connector name (e.g., 'my-github', 'github-work')
 * @param vendorId - Vendor ID (e.g., 'github', 'slack')
 * @param authTemplateId - Auth method ID (e.g., 'pat', 'oauth-user')
 * @param credentials - Credentials for the auth method
 * @param options - Optional configuration
 * @returns The created Connector
 *
 * @example
 * ```typescript
 * const connector = createConnectorFromTemplate(
 *   'my-github',
 *   'github',
 *   'pat',
 *   { apiKey: process.env.GITHUB_TOKEN }
 * );
 * ```
 */
export function createConnectorFromTemplate(
  name: string,
  vendorId: string,
  authTemplateId: string,
  credentials: TemplateCredentials,
  options?: CreateConnectorOptions
): Connector {
  const template = getVendorTemplate(vendorId);
  if (!template) {
    const available = listVendorIds().slice(0, 10).join(', ');
    throw new Error(
      `Unknown vendor: ${vendorId}. Available vendors include: ${available}...`
    );
  }

  const authTemplate = template.authTemplates.find((a) => a.id === authTemplateId);
  if (!authTemplate) {
    const available = template.authTemplates.map((a) => a.id).join(', ');
    throw new Error(
      `Unknown auth method '${authTemplateId}' for vendor '${vendorId}'. Available: ${available}`
    );
  }

  // Validate required fields
  validateCredentials(authTemplate, credentials);

  // Build auth config from template defaults + credentials
  const auth = buildAuthConfig(authTemplate, credentials);

  // Build connector config
  const config: ConnectorConfig & { name: string } = {
    name,
    serviceType: template.serviceType,
    baseURL: options?.baseURL ?? template.baseURL,
    auth,
    displayName: options?.displayName ?? `${template.name} (${authTemplate.name})`,
    description: options?.description ?? `${template.name} API connector using ${authTemplate.name}`,
    documentation: template.docsURL,
  };

  if (options?.timeout !== undefined) {
    config.timeout = options.timeout;
  }

  if (options?.logging) {
    config.logging = { enabled: true };
  }

  if (options?.vendorOptions && Object.keys(options.vendorOptions).length > 0) {
    config.options = options.vendorOptions;
  }

  return Connector.create(config);
}

/**
 * Get all tools for a connector (delegates to ConnectorTools)
 *
 * @param connectorName - Name of the connector
 * @returns Array of tools for the connector
 */
export function getConnectorTools(connectorName: string): ToolFunction[] {
  return ConnectorTools.for(connectorName);
}

/**
 * Get vendor template information for display
 */
export interface VendorInfo {
  id: string;
  name: string;
  category: string;
  docsURL?: string;
  credentialsSetupURL?: string;
  authMethods: {
    id: string;
    name: string;
    type: string;
    description: string;
    requiredFields: string[];
    scopes?: string[];
    scopeDescriptions?: Record<string, string>;
  }[];
}

/**
 * Get vendor information suitable for display
 */
export function getVendorInfo(vendorId: string): VendorInfo | undefined {
  const template = getVendorTemplate(vendorId);
  if (!template) return undefined;

  return {
    id: template.id,
    name: template.name,
    category: template.category,
    docsURL: template.docsURL,
    credentialsSetupURL: template.credentialsSetupURL,
    authMethods: template.authTemplates.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description,
      requiredFields: a.requiredFields,
      scopes: a.scopes,
      scopeDescriptions: a.scopeDescriptions,
    })),
  };
}

/**
 * List all vendors with basic info
 */
export function listVendors(): VendorInfo[] {
  return getAllVendorTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    docsURL: t.docsURL,
    credentialsSetupURL: t.credentialsSetupURL,
    authMethods: t.authTemplates.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description,
      requiredFields: a.requiredFields,
      scopes: a.scopes,
      scopeDescriptions: a.scopeDescriptions,
    })),
  }));
}

/**
 * List vendors by category
 */
export function listVendorsByCategory(category: string): VendorInfo[] {
  return listVendors().filter((v) => v.category === category);
}

/**
 * List vendors that support a specific auth type
 */
export function listVendorsByAuthType(authType: 'api_key' | 'oauth'): VendorInfo[] {
  return listVendors().filter((v) =>
    v.authMethods.some((a) => a.type === authType)
  );
}

/**
 * Get credentials setup URL for a vendor
 */
export function getCredentialsSetupURL(vendorId: string): string | undefined {
  const template = getVendorTemplate(vendorId);
  return template?.credentialsSetupURL;
}

/**
 * Get docs URL for a vendor
 */
export function getDocsURL(vendorId: string): string | undefined {
  const template = getVendorTemplate(vendorId);
  return template?.docsURL;
}
