/**
 * Salesforce Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const salesforceTemplate: VendorTemplate = {
  id: 'salesforce',
  name: 'Salesforce',
  serviceType: 'salesforce',
  baseURL: 'https://login.salesforce.com/services/data/v59.0',
  docsURL: 'https://developer.salesforce.com/docs/apis',
  credentialsSetupURL: 'https://login.salesforce.com/lightning/setup/ConnectedApplication/home',
  category: 'crm',
  notes: 'After OAuth, baseURL changes to instance URL (e.g., yourinstance.salesforce.com)',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'User logs in via Salesforce. Create Connected App in Setup. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        usePKCE: true,
      },
      scopes: ['api', 'refresh_token', 'offline_access', 'chatter_api', 'wave_api', 'full'],
      scopeDescriptions: {
        'api': 'Access and manage your data',
        'refresh_token': 'Maintain access with refresh tokens',
        'offline_access': 'Access data while you are offline',
        'chatter_api': 'Access Chatter feeds and posts',
        'wave_api': 'Access Analytics (Wave) API',
        'full': 'Full access to all data',
      },
      // Salesforce requires `refresh_token` scope for refresh-token issuance
      // (also accepts `offline_access`). Without it, access tokens (~2h)
      // become terminal.
      refreshStrategy: { kind: 'scope', scope: 'refresh_token' },
    },
    {
      id: 'jwt-bearer',
      name: 'JWT Bearer (Server-to-Server)',
      type: 'oauth',
      flow: 'jwt_bearer',
      description: 'Automated server integration - requires certificate setup in Connected App',
      requiredFields: ['clientId', 'privateKey', 'username'],
      defaults: {
        type: 'oauth',
        flow: 'jwt_bearer',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        audience: 'https://login.salesforce.com',
      },
    },
  ],
};
