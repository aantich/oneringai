/**
 * Vendor Templates - Helper Functions
 *
 * Functions for creating connectors from vendor templates.
 */

import { mergeOAuthScopes as mergeScope } from '../oauth/utils/scopes.js';
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

/** Options for applying provider refresh requirements to an existing configuration. */
export interface ApplyRefreshStrategyOptions {
  /** Enforce the strategy's authorization parameter over a conflicting value. Default: false. */
  enforce?: boolean;
  /** Other required scope tokens to preserve and merge, without importing template scopes. */
  requiredScope?: string;
}

/**
 * Apply only a provider's refresh requirements. Pure and idempotent: configured
 * API scopes and unrelated parameters (including prompt) are preserved.
 * `scope` is authoritative, including an explicit empty string. When absent,
 * fall back to `authorizationParams.scope`; remove that duplicate parameter
 * from the returned patch so it cannot override edits or required scopes.
 * With enforce enabled, a missing strategy is an error and the strategy's
 * authorization parameter wins. Existing three-argument calls keep their
 * operator-value precedence. This requests renewal capability; it does not
 * guarantee a refresh token in every response or perform manual provider setup.
 */
export function applyRefreshStrategy(
  scope: string | undefined,
  authorizationParams: Record<string, string> | undefined,
  strategy: RefreshStrategy | undefined,
  options: ApplyRefreshStrategyOptions = {},
): {
  scope: string;
  requiredScope: string | undefined;
  authorizationParams: Record<string, string> | undefined;
} {
  const configuredScope = scope ?? authorizationParams?.scope ?? '';
  if (authorizationParams && 'scope' in authorizationParams) {
    authorizationParams = { ...authorizationParams };
    delete authorizationParams.scope;
  }
  const requiredScope = mergeScope(undefined, options.requiredScope ?? '') || undefined;
  const baseScope = requiredScope ? mergeScope(configuredScope, requiredScope) : configuredScope;
  if (!strategy) {
    if (options.enforce) throw new Error('Refresh strategy is required when enforcement is enabled');
    return { scope: baseScope, requiredScope, authorizationParams };
  }
  switch (strategy.kind) {
    case 'scope': {
      const combinedRequiredScope = mergeScope(requiredScope, strategy.scope);
      return {
        scope: mergeScope(baseScope, combinedRequiredScope),
        requiredScope: combinedRequiredScope,
        authorizationParams,
      };
    }
    case 'auth_param': {
      const merged = { ...(authorizationParams ?? {}) };
      if (options.enforce || !(strategy.key in merged)) {
        merged[strategy.key] = strategy.value;
      }
      return { scope: baseScope, requiredScope, authorizationParams: merged };
    }
    case 'automatic':
    case 'never_expires':
    case 'manual_setup':
      return { scope: baseScope, requiredScope, authorizationParams };
  }
}

/** Options for editing a same-method authorization-code configuration. */
export interface BuildAuthConfigOptions {
  /** Preserve saved settings; nonempty supplied template credentials replace their fields. */
  existingAuth?: ConnectorAuth;
}

const standardOAuthFields = new Set([
  'clientId', 'clientSecret', 'tokenUrl', 'authorizationUrl',
  'redirectUri', 'scope', 'usePKCE', 'privateKey', 'privateKeyPath',
  'issuer', 'subject', 'audience',
]);

/** Resolve only placeholders declared in the template, using supplied credentials. */
function resolveOAuthUrl(url: string | undefined, credentials: Record<string, string | undefined>): string | undefined {
  return url?.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, field: string) =>
    credentials[field] || placeholder,
  );
}

/** Update auth settings without re-importing creation defaults or losing token namespaces. */
function updateAuthorizationCodeAuth(
  authTemplate: AuthTemplate,
  credentials: TemplateCredentials,
  existingAuth: ConnectorAuth,
): ConnectorAuth {
  if (existingAuth.type !== 'oauth' || existingAuth.flow !== 'authorization_code' ||
      authTemplate.type !== 'oauth' || authTemplate.flow !== 'authorization_code') {
    throw new Error('existingAuth requires the same authorization-code authentication method');
  }
  const auth = {
    ...existingAuth,
    ...(existingAuth.authorizationParams && { authorizationParams: { ...existingAuth.authorizationParams } }),
    ...(existingAuth.extra && { extra: { ...existingAuth.extra } }),
  };
  const fields = [...authTemplate.requiredFields, ...(authTemplate.optionalFields ?? [])];
  const previous: Record<string, string | undefined> = { ...existingAuth.extra };
  for (const field of fields) {
    const value = (existingAuth as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string') previous[field] = value;
  }
  const next = { ...previous };
  for (const field of fields) {
    const value = credentials[field];
    if (!value) continue; // Existing update contract: empty means keep, including secrets.
    next[field] = value;
    if (standardOAuthFields.has(field)) {
      (auth as unknown as Record<string, unknown>)[field] = value;
    } else {
      auth.extra = { ...auth.extra, [field]: value };
    }
  }
  const defaults = authTemplate.defaults as Partial<typeof existingAuth>;
  for (const field of ['tokenUrl', 'authorizationUrl'] as const) {
    const templateUrl = defaults[field];
    if (!templateUrl) continue;
    const previousUrl = resolveOAuthUrl(templateUrl, previous);
    const nextUrl = resolveOAuthUrl(templateUrl, next);
    // A changed tenant/installation only updates a template-derived endpoint.
    // Explicit endpoint edits and custom saved endpoints remain authoritative.
    if (nextUrl !== previousUrl && existingAuth[field] === previousUrl && auth[field] === existingAuth[field]) {
      auth[field] = nextUrl!;
    }
  }
  const refresh = applyRefreshStrategy(
    auth.scope, auth.authorizationParams, authTemplate.refreshStrategy,
    { requiredScope: auth.requiredScope },
  );
  return {
    ...auth,
    ...refresh,
    scope: refresh.scope || auth.scope, // Missing saved scopes never import broad template scopes.
  };
}

/**
 * Build ConnectorAuth from a template and credentials. Creation uses template
 * defaults. With existingAuth, preserve saved authorization-code settings and
 * apply only the nonempty credential patch plus provider refresh requirements.
 */
export function buildAuthConfig(
  authTemplate: AuthTemplate,
  credentials: TemplateCredentials,
  options: BuildAuthConfigOptions = {},
): ConnectorAuth {
  if (options.existingAuth) {
    return updateAuthorizationCodeAuth(authTemplate, credentials, options.existingAuth);
  }
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

    const queryParamName = (defaults as { queryParamName?: string }).queryParamName;

    return {
      type: 'api_key',
      apiKey,
      headerName: (defaults as { headerName?: string }).headerName ?? 'Authorization',
      headerPrefix,
      ...(queryParamName ? { queryParamName } : {}),
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

  // Keep creation and update endpoint interpolation identical.
  oauthConfig.tokenUrl = resolveOAuthUrl(oauthConfig.tokenUrl, credentials) ?? '';
  oauthConfig.authorizationUrl = resolveOAuthUrl(oauthConfig.authorizationUrl, credentials);

  // Preserve template-specific fields for later edits and URL reconstruction.
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
