/**
 * Slack Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const slackTemplate: VendorTemplate = {
  id: 'slack',
  name: 'Slack',
  serviceType: 'slack',
  baseURL: 'https://slack.com/api',
  docsURL: 'https://api.slack.com/methods',
  credentialsSetupURL: 'https://api.slack.com/apps',
  category: 'communication',

  authTemplates: [
    {
      id: 'bot-token',
      name: 'Bot Token',
      type: 'api_key',
      description: 'Internal workspace bot - get from OAuth & Permissions page of your Slack app. For Socket Mode bots, also provide appToken and signingSecret in extra fields.',
      requiredFields: ['apiKey'],
      optionalFields: ['appToken', 'signingSecret'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Token)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'Distributed app - users authorize via Slack OAuth. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope', 'userScope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        usePKCE: true,
      },
      scopes: ['chat:write', 'channels:read', 'channels:history', 'channels:manage', 'users:read', 'users:read.email', 'im:write', 'im:history', 'groups:read', 'groups:history', 'mpim:history', 'files:read', 'files:write', 'reactions:read', 'reactions:write', 'search:read', 'team:read'],
      scopeDescriptions: {
        'chat:write': 'Send messages as the app',
        'channels:read': 'View basic channel info',
        'channels:history': 'View messages in public channels',
        'channels:manage': 'Manage channel settings (topic, purpose)',
        'users:read': 'View people in the workspace',
        'users:read.email': 'View email addresses of people',
        'im:write': 'Send direct messages',
        'im:history': 'View messages in direct messages',
        'groups:read': 'View basic private channel info',
        'groups:history': 'View messages in private channels',
        'mpim:history': 'View messages in group direct messages',
        'files:read': 'View files shared in channels',
        'files:write': 'Upload and manage files',
        'reactions:read': 'View emoji reactions',
        'reactions:write': 'Add and remove emoji reactions',
        'search:read': 'Search messages and files',
        'team:read': 'View workspace info',
      },
      // Slack OAuth issues non-expiring `xoxb-` / `xoxp-` tokens by default.
      // Refresh tokens (`xoxe-`) are only issued when token rotation is
      // explicitly enabled per-app in the Slack app config — out of band of
      // the OAuth flow itself. Default behavior here assumes non-rotating
      // tokens that never expire; flip to a custom strategy if your app
      // enables rotation.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};
