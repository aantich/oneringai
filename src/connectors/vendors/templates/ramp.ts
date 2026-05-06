/**
 * Ramp Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const rampTemplate: VendorTemplate = {
  id: 'ramp',
  name: 'Ramp',
  serviceType: 'ramp',
  baseURL: 'https://api.ramp.com/developer/v1',
  docsURL: 'https://docs.ramp.com',
  credentialsSetupURL: 'https://app.ramp.com/settings/developer',
  category: 'payments',

  authTemplates: [
    {
      id: 'oauth-client-credentials',
      name: 'OAuth (Client Credentials)',
      type: 'oauth',
      flow: 'client_credentials',
      description:
        'App-level authentication using client credentials. Create an API application in Ramp developer settings',
      requiredFields: ['clientId', 'clientSecret'],
      defaults: {
        type: 'oauth',
        flow: 'client_credentials',
        tokenUrl: 'https://api.ramp.com/developer/v1/token',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description:
        'OAuth 2.0 authorization code flow for accessing Ramp on behalf of a user. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://app.ramp.com/v1/authorize',
        tokenUrl: 'https://api.ramp.com/developer/v1/token',
        usePKCE: true,
      },
      scopes: [
        'transactions:read',
        'users:read',
        'users:write',
        'cards:read',
        'cards:write',
        'departments:read',
        'reimbursements:read',
      ],
      // Ramp OAuth issues refresh_token automatically.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
