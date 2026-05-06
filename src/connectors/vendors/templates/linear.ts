/**
 * Linear Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const linearTemplate: VendorTemplate = {
  id: 'linear',
  name: 'Linear',
  serviceType: 'linear',
  baseURL: 'https://api.linear.app/graphql',
  docsURL: 'https://developers.linear.app/docs',
  credentialsSetupURL: 'https://linear.app/settings/api',
  category: 'development',
  notes: 'Linear uses GraphQL API. All requests go to the /graphql endpoint',

  authTemplates: [
    {
      id: 'api-key',
      name: 'Personal API Key',
      type: 'api_key',
      description: 'Personal API key for full access. Create at Settings > API',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: '',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth application for user authorization. Create at Settings > API > OAuth applications. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://linear.app/oauth/authorize',
        tokenUrl: 'https://api.linear.app/oauth/token',
        usePKCE: true,
      },
      scopes: ['read', 'write', 'issues:create', 'comments:create'],
      // Linear access tokens have a 10-year lifetime — effectively never
      // expire. No refresh mechanism.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};
