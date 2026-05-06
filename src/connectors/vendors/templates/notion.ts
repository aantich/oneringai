/**
 * Notion Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const notionTemplate: VendorTemplate = {
  id: 'notion',
  name: 'Notion',
  serviceType: 'notion',
  baseURL: 'https://api.notion.com/v1',
  docsURL: 'https://developers.notion.com/reference',
  credentialsSetupURL: 'https://www.notion.so/my-integrations',
  category: 'productivity',

  authTemplates: [
    {
      id: 'internal-token',
      name: 'Internal Integration Token',
      type: 'api_key',
      description: 'Internal integration token for workspace access. Create at notion.so/my-integrations',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'Public Integration (OAuth)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'Public integration for multi-workspace access. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
        tokenUrl: 'https://api.notion.com/v1/oauth/token',
        usePKCE: true,
      },
      // Notion access tokens don't expire — no refresh mechanism.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};
