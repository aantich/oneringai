/**
 * Dropbox Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const dropboxTemplate: VendorTemplate = {
  id: 'dropbox',
  name: 'Dropbox',
  serviceType: 'dropbox',
  baseURL: 'https://api.dropboxapi.com/2',
  docsURL: 'https://www.dropbox.com/developers/documentation',
  credentialsSetupURL: 'https://www.dropbox.com/developers/apps',
  category: 'storage',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth app for user authorization. Create app at dropbox.com/developers/apps. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
        usePKCE: true,
      },
      scopes: ['files.content.read', 'files.content.write', 'files.metadata.read', 'files.metadata.write', 'sharing.read', 'sharing.write', 'account_info.read'],
      scopeDescriptions: {
        'files.content.read': 'Read file contents',
        'files.content.write': 'Upload and modify files',
        'files.metadata.read': 'Read file and folder metadata',
        'files.metadata.write': 'Modify file and folder metadata',
        'sharing.read': 'View sharing settings',
        'sharing.write': 'Manage sharing settings',
        'account_info.read': 'Read account information',
      },
      // Dropbox requires `token_access_type=offline` on the authorize URL to
      // issue a refresh_token. Without it, access tokens are short-lived and
      // unrefreshable.
      refreshStrategy: { kind: 'auth_param', key: 'token_access_type', value: 'offline' },
    },
  ],
};
