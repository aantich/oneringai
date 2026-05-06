/**
 * Airtable Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const airtableTemplate: VendorTemplate = {
  id: 'airtable',
  name: 'Airtable',
  serviceType: 'airtable',
  baseURL: 'https://api.airtable.com/v0',
  docsURL: 'https://airtable.com/developers/web/api',
  credentialsSetupURL: 'https://airtable.com/create/tokens',
  category: 'productivity',

  authTemplates: [
    {
      id: 'pat',
      name: 'Personal Access Token',
      type: 'api_key',
      description: 'Personal access token with scoped permissions. Create at airtable.com/create/tokens',
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
      description: 'OAuth integration for multi-user access. Register at airtable.com/create/oauth. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
        tokenUrl: 'https://airtable.com/oauth2/v1/token',
        usePKCE: true,
      },
      scopes: ['data.records:read', 'data.records:write', 'schema.bases:read'],
      // Airtable OAuth: access tokens expire in ~1h, refresh_token issued
      // automatically on every authorization_code exchange.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
