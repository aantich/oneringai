/**
 * Vendor Templates - Type Definitions
 *
 * Types for vendor authentication templates and registry.
 * These templates provide pre-configured auth patterns for common services.
 */

import type { ServiceCategory } from '../../domain/entities/Services.js';
import type { ConnectorAuth } from '../../domain/entities/Connector.js';

/**
 * How a vendor issues refresh tokens for `authorization_code` flows. Determines
 * what (if anything) the library force-merges into authorize URLs to guarantee
 * long-lived sessions without manual re-auth. **Required** for every
 * `authorization_code` template — the registry initializer fails fast if absent.
 *
 * - `automatic`: vendor issues a refresh token unconditionally (Discord, Asana,
 *   HubSpot, Stripe, QuickBooks, Box, Zoom, Pipedrive, Ramp, Atlassian-Bitbucket).
 * - `never_expires`: tokens don't expire (or have multi-year lifetime), no
 *   refresh ever needed (Notion, Linear, Airtable PAT, GitHub OAuth Apps,
 *   Slack classic bot tokens).
 * - `scope`: a specific scope token must be in the authorize request. Microsoft
 *   / Atlassian / GitLab use `offline_access`; Salesforce uses `refresh_token`;
 *   Twitter/X uses `offline.access` (note the dot). Force-merged on every
 *   authorize URL to survive operator scope overrides.
 * - `auth_param`: a query param must be on the authorize URL. Google uses
 *   `access_type=offline`; Dropbox uses `token_access_type=offline`. Stamped
 *   into the persisted `authorizationParams`.
 * - `manual_setup`: refresh tokens require out-of-band IdP / app config the
 *   library can't enforce (GitHub App "expire user tokens" toggle, Slack token
 *   rotation enable). Surfaces a warning at template-import time.
 */
export type RefreshStrategy =
  | { kind: 'automatic' }
  | { kind: 'never_expires' }
  | { kind: 'scope'; scope: string }
  | { kind: 'auth_param'; key: string; value: string }
  | { kind: 'manual_setup'; description: string };

/**
 * Authentication template for a vendor
 * Defines a single authentication method (e.g., API key, OAuth user flow)
 */
export interface AuthTemplate {
  /** Unique auth method ID within vendor (e.g., 'pat', 'oauth-user', 'github-app') */
  id: string;

  /** Human-readable name (e.g., 'Personal Access Token') */
  name: string;

  /** Auth type */
  type: 'api_key' | 'oauth';

  /** OAuth flow type (required when type is 'oauth') */
  flow?: 'authorization_code' | 'client_credentials' | 'jwt_bearer';

  /** When to use this auth method */
  description: string;

  /** Fields user must provide (e.g., ['apiKey'], ['clientId', 'clientSecret', 'redirectUri']) */
  requiredFields: AuthTemplateField[];

  /** Optional fields user may provide */
  optionalFields?: AuthTemplateField[];

  /** Pre-filled OAuth URLs and defaults */
  defaults: Partial<ConnectorAuth>;

  /** Common scopes for this auth method */
  scopes?: string[];

  /** Human-readable descriptions for scopes (key = scope ID) */
  scopeDescriptions?: Record<string, string>;

  /**
   * How this vendor issues refresh tokens. **Required** when
   * `flow === 'authorization_code'`; ignored otherwise. Drives the force-merge
   * that guarantees refresh-capable tokens without operator intervention.
   * Validated at registry-init time — missing on an auth-code template throws.
   */
  refreshStrategy?: RefreshStrategy;
}

/**
 * Known fields that can be required/optional in auth templates
 */
export type AuthTemplateField =
  | 'apiKey'
  | 'clientId'
  | 'clientSecret'
  | 'redirectUri'
  | 'scope'
  | 'privateKey'
  | 'privateKeyPath'
  | 'appId'
  | 'installationId'
  | 'tenantId'
  | 'username'
  | 'subject'
  | 'audience'
  | 'userScope'
  | 'accountId'
  | 'subdomain'
  | 'region'
  | 'accessKeyId'
  | 'secretAccessKey'
  | 'applicationKey'
  // Vendor-specific extra fields (stored in auth.extra)
  | 'appToken'
  | 'signingSecret';

/**
 * Vendor-specific option field definition.
 * Declares a configurable option that UI apps render as form fields.
 * Values are stored in `connector.config.options` and accessed via `connector.getOptions()`.
 */
export interface OptionField {
  /** Option key stored in connector.config.options (e.g., 'defaultFromNumber') */
  key: string;

  /** Human-readable label for UI display (e.g., 'Default From Number') */
  label: string;

  /** Help text / placeholder shown in the UI */
  description: string;

  /** Whether the option must be provided (default: false) */
  required?: boolean;

  /** Field type hint for UI rendering (default: 'string') */
  type?: 'string' | 'number' | 'boolean';

  /** Default value if not provided */
  defaultValue?: string | number | boolean;

  /** Placeholder text for the input field */
  placeholder?: string;
}

/**
 * Vendor template definition
 * Complete configuration for a vendor's supported authentication methods
 */
export interface VendorTemplate {
  /** Unique vendor ID (matches Services.ts id, e.g., 'github', 'slack') */
  id: string;

  /** Human-readable name (e.g., 'GitHub', 'Slack') */
  name: string;

  /** Service type for ConnectorTools integration (matches serviceType in ConnectorConfig) */
  serviceType: string;

  /** Default API base URL */
  baseURL: string;

  /** API documentation URL */
  docsURL?: string;

  /** URL for setting up credentials on vendor's side */
  credentialsSetupURL?: string;

  /** All supported authentication methods */
  authTemplates: AuthTemplate[];

  /** Category from Services.ts */
  category: ServiceCategory;

  /** Additional notes about the vendor's authentication */
  notes?: string;

  /** Vendor-specific option fields (stored in connector.config.options). UI apps render these as form fields. */
  optionFields?: OptionField[];
}

/**
 * Registry entry for a vendor (generated at build time)
 */
export interface VendorRegistryEntry {
  /** Vendor ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Service type for ConnectorTools integration */
  serviceType: string;

  /** Category from Services.ts */
  category: ServiceCategory;

  /** List of supported auth method IDs */
  authMethods: string[];

  /** URL for credential setup */
  credentialsSetupURL?: string;

  /** Full vendor template (for programmatic access) */
  template: VendorTemplate;
}

/**
 * Credentials provided by user when creating connector from template
 */
export type TemplateCredentials = {
  [K in AuthTemplateField]?: string;
};

/**
 * Options for creating a connector from a template
 */
export interface CreateConnectorOptions {
  /** Override the default baseURL */
  baseURL?: string;

  /** Additional description for the connector */
  description?: string;

  /** Human-readable display name */
  displayName?: string;

  /** Request timeout in ms */
  timeout?: number;

  /** Enable request/response logging */
  logging?: boolean;

  /** Vendor-specific options (e.g., defaultFromNumber for Twilio). Stored in connector.config.options. */
  vendorOptions?: Record<string, unknown>;
}
