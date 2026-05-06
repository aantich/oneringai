/**
 * Pipedrive Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const pipedriveTemplate: VendorTemplate = {
  id: 'pipedrive',
  name: 'Pipedrive',
  serviceType: 'pipedrive',
  baseURL: 'https://api.pipedrive.com/v1',
  docsURL: 'https://developers.pipedrive.com/docs/api/v1',
  credentialsSetupURL: 'https://app.pipedrive.com/settings/api',
  category: 'crm',

  authTemplates: [
    {
      id: 'api-token',
      name: 'API Token',
      type: 'api_key',
      description: 'Personal API token. Find at Settings > Personal preferences > API',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (App Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth app for marketplace distribution. Create at developers.pipedrive.com. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://oauth.pipedrive.com/oauth/authorize',
        tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
        usePKCE: true,
      },
      // Pipedrive OAuth: access tokens expire in ~1h, refresh_token issued
      // automatically.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
