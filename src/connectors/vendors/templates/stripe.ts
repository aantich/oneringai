/**
 * Stripe Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const stripeTemplate: VendorTemplate = {
  id: 'stripe',
  name: 'Stripe',
  serviceType: 'stripe',
  baseURL: 'https://api.stripe.com/v1',
  docsURL: 'https://stripe.com/docs/api',
  credentialsSetupURL: 'https://dashboard.stripe.com/apikeys',
  category: 'payments',

  authTemplates: [
    {
      id: 'api-key',
      name: 'Secret API Key',
      type: 'api_key',
      description: 'Secret API key for server-side requests. Get from Dashboard > Developers > API keys',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-connect',
      name: 'OAuth (Stripe Connect)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'Stripe Connect for marketplace platforms. Requires Connect setup in dashboard. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://connect.stripe.com/oauth/authorize',
        tokenUrl: 'https://connect.stripe.com/oauth/token',
        usePKCE: true,
      },
      scopes: ['read_write'],
      // Stripe Connect: connected-account access tokens are long-lived (do
      // not expire) for Standard accounts. Refresh tokens are returned
      // automatically on the initial exchange but are typically not needed
      // for ongoing access — treat as automatic so the lib stores them if
      // present.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
