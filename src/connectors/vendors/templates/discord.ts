/**
 * Discord Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const discordTemplate: VendorTemplate = {
  id: 'discord',
  name: 'Discord',
  serviceType: 'discord',
  baseURL: 'https://discord.com/api/v10',
  docsURL: 'https://discord.com/developers/docs',
  credentialsSetupURL: 'https://discord.com/developers/applications',
  category: 'communication',

  authTemplates: [
    {
      id: 'bot-token',
      name: 'Bot Token',
      type: 'api_key',
      description: 'Bot token for Discord bots - get from Bot section of your application',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bot',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Token)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth2 for user authorization - users grant permissions to your app. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://discord.com/api/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        usePKCE: true,
      },
      scopes: ['identify', 'email', 'guilds', 'guilds.members.read', 'messages.read', 'bot', 'connections'],
      scopeDescriptions: {
        'identify': 'Access your username and avatar',
        'email': 'Access your email address',
        'guilds': 'View your server list',
        'guilds.members.read': 'Read server member info',
        'messages.read': 'Read messages in accessible channels',
        'bot': 'Add a bot to your servers',
        'connections': 'View your connected accounts',
      },
      // Discord OAuth2: access tokens expire in ~7d, refresh_token issued
      // automatically with no special scope required.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};
