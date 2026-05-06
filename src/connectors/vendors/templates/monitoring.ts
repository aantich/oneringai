/**
 * Monitoring Vendor Templates (Datadog, PagerDuty, Sentry)
 */
import type { VendorTemplate } from '../types.js';

export const datadogTemplate: VendorTemplate = {
  id: 'datadog',
  name: 'Datadog',
  serviceType: 'datadog',
  baseURL: 'https://api.datadoghq.com/api/v2',
  docsURL: 'https://docs.datadoghq.com/api/',
  credentialsSetupURL: 'https://app.datadoghq.com/organization-settings/api-keys',
  category: 'monitoring',
  notes: 'Use region-specific URL (e.g., api.datadoghq.eu for EU)',

  authTemplates: [
    {
      id: 'api-key',
      name: 'API & Application Keys',
      type: 'api_key',
      description: 'API key + Application key for full access. Get from Organization Settings',
      requiredFields: ['apiKey', 'applicationKey'],
      defaults: {
        type: 'api_key',
        headerName: 'DD-API-KEY',
        headerPrefix: '',
      },
    },
  ],
};

export const pagerdutyTemplate: VendorTemplate = {
  id: 'pagerduty',
  name: 'PagerDuty',
  serviceType: 'pagerduty',
  baseURL: 'https://api.pagerduty.com',
  docsURL: 'https://developer.pagerduty.com/api-reference/',
  credentialsSetupURL: 'https://support.pagerduty.com/main/docs/api-access-keys',
  category: 'monitoring',

  authTemplates: [
    {
      id: 'api-key',
      name: 'API Token',
      type: 'api_key',
      description: 'REST API token. Create at User Settings > Create API Key or via Admin',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Token token=',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (App Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth app for multi-account access. Register at developer.pagerduty.com. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://app.pagerduty.com/oauth/authorize',
        tokenUrl: 'https://app.pagerduty.com/oauth/token',
        usePKCE: true,
      },
      scopes: ['read', 'write'],
      scopeDescriptions: {
        'read': 'Read incidents, services, and schedules',
        'write': 'Create and update incidents and services',
      },
      // PagerDuty OAuth issues refresh_token automatically.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};

export const sentryTemplate: VendorTemplate = {
  id: 'sentry',
  name: 'Sentry',
  serviceType: 'sentry',
  baseURL: 'https://sentry.io/api/0',
  docsURL: 'https://docs.sentry.io/api/',
  credentialsSetupURL: 'https://sentry.io/settings/account/api/auth-tokens/',
  category: 'monitoring',

  authTemplates: [
    {
      id: 'auth-token',
      name: 'Auth Token',
      type: 'api_key',
      description: 'Authentication token. Create at User Settings > Auth Tokens',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (Integration)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth integration. Create at Organization Settings > Integrations. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://sentry.io/oauth/authorize/',
        tokenUrl: 'https://sentry.io/oauth/token/',
        usePKCE: true,
      },
      scopes: ['project:read', 'project:write', 'event:read', 'org:read', 'member:read'],
      scopeDescriptions: {
        'project:read': 'Read project settings',
        'project:write': 'Manage project settings',
        'event:read': 'Read error events and issues',
        'org:read': 'Read organization info',
        'member:read': 'Read org member info',
      },
      // Sentry OAuth issues refresh_token automatically (access token ~8h).
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
