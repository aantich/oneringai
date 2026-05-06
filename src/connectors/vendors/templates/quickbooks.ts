/**
 * QuickBooks Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const quickbooksTemplate: VendorTemplate = {
  id: 'quickbooks',
  name: 'QuickBooks',
  serviceType: 'quickbooks',
  baseURL: 'https://quickbooks.api.intuit.com/v3',
  docsURL: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account',
  credentialsSetupURL: 'https://developer.intuit.com/app/developer/dashboard',
  category: 'payments',
  notes: 'Use sandbox URL (sandbox-quickbooks.api.intuit.com) for testing. Requires company/realm ID in API paths.',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description:
        'Standard OAuth 2.0 flow for accessing QuickBooks on behalf of a user. Create an app at developer.intuit.com. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2',
        tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        usePKCE: true,
      },
      scopes: ['com.intuit.quickbooks.accounting', 'com.intuit.quickbooks.payment'],
      // QuickBooks OAuth: access tokens expire in 1h, refresh_token issued
      // automatically (refresh_token rotates on use; lifetime ~100d).
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
