/**
 * Box Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const boxTemplate: VendorTemplate = {
  id: 'box',
  name: 'Box',
  serviceType: 'box',
  baseURL: 'https://api.box.com/2.0',
  docsURL: 'https://developer.box.com/reference/',
  credentialsSetupURL: 'https://developer.box.com/console',
  category: 'storage',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth 2.0 for user authorization. Create app at developer.box.com/console. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
        tokenUrl: 'https://api.box.com/oauth2/token',
        usePKCE: true,
      },
      scopes: ['root_readwrite', 'manage_users', 'manage_groups', 'manage_enterprise'],
      scopeDescriptions: {
        'root_readwrite': 'Read and write all files and folders',
        'manage_users': 'Manage enterprise users',
        'manage_groups': 'Manage enterprise groups',
        'manage_enterprise': 'Manage enterprise settings',
      },
      // Box OAuth: access tokens expire in 1h, refresh_token issued
      // automatically (refresh_token expires in 60 days).
      refreshStrategy: { kind: 'automatic' },
    },
    {
      id: 'client-credentials',
      name: 'Client Credentials (Server Auth)',
      type: 'oauth',
      flow: 'client_credentials',
      description: 'Server-to-server auth with Client Credentials Grant. Enable in app settings',
      requiredFields: ['clientId', 'clientSecret'],
      optionalFields: ['subject'],
      defaults: {
        type: 'oauth',
        flow: 'client_credentials',
        tokenUrl: 'https://api.box.com/oauth2/token',
      },
    },
  ],
};
