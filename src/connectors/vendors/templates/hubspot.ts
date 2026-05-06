/**
 * HubSpot Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const hubspotTemplate: VendorTemplate = {
  id: 'hubspot',
  name: 'HubSpot',
  serviceType: 'hubspot',
  baseURL: 'https://api.hubapi.com',
  docsURL: 'https://developers.hubspot.com/docs/api',
  credentialsSetupURL: 'https://developers.hubspot.com/get-started',
  category: 'crm',

  authTemplates: [
    {
      id: 'api-key',
      name: 'Private App Token',
      type: 'api_key',
      description: 'Private app access token. Create at Settings > Integrations > Private Apps',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'Public app OAuth for multi-portal access. Create app at developers.hubspot.com. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
        tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
        usePKCE: true,
      },
      scopes: [
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.companies.write',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
        'tickets',
        'e-commerce',
      ],
      scopeDescriptions: {
        'crm.objects.contacts.read': 'Read contacts',
        'crm.objects.contacts.write': 'Create and update contacts',
        'crm.objects.companies.read': 'Read companies',
        'crm.objects.companies.write': 'Create and update companies',
        'crm.objects.deals.read': 'Read deals',
        'crm.objects.deals.write': 'Create and update deals',
        'tickets': 'Read and write support tickets',
        'e-commerce': 'Access e-commerce data (products, line items)',
      },
      // HubSpot OAuth: access tokens expire in ~30min, refresh_token issued
      // automatically (refresh_token never expires).
      refreshStrategy: { kind: 'automatic' },
    },
    {
      id: 'oauth-mcp',
      name: 'MCP Auth App (OAuth 2.1)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'HubSpot MCP Auth app using OAuth 2.1 with PKCE. Scopes are auto-granted based on user permissions at install time. Create app at developers.hubspot.com under MCP Auth Apps.',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://mcp.hubspot.com/oauth/authorize/user',
        tokenUrl: 'https://mcp.hubspot.com/oauth/v1/token',
        usePKCE: true,
      },
      // HubSpot MCP Auth Apps issue refresh tokens automatically — same
      // behavior as the public-app flow.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
