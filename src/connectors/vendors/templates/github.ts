/**
 * GitHub Vendor Template
 */
import type { VendorTemplate } from '../types.js';

export const githubTemplate: VendorTemplate = {
  id: 'github',
  name: 'GitHub',
  serviceType: 'github',
  baseURL: 'https://api.github.com',
  docsURL: 'https://docs.github.com/en/rest',
  credentialsSetupURL: 'https://github.com/settings/developers',
  category: 'development',

  authTemplates: [
    {
      id: 'pat',
      name: 'Personal Access Token',
      type: 'api_key',
      description: 'Simple token for personal use, scripts, or single-user apps. Create at Settings > Developer settings > Personal access tokens',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth App (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'User logs in via GitHub and grants permissions to your app. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        usePKCE: true,
      },
      scopes: ['repo', 'read:user', 'user:email', 'read:org', 'workflow', 'gist', 'notifications', 'delete_repo', 'admin:org'],
      scopeDescriptions: {
        'repo': 'Full control of private repositories',
        'read:user': 'Read user profile data',
        'user:email': 'Access user email addresses',
        'read:org': 'Read org and team membership',
        'workflow': 'Update GitHub Actions workflows',
        'gist': 'Create and manage gists',
        'notifications': 'Access notifications',
        'delete_repo': 'Delete repositories',
        'admin:org': 'Full control of orgs and teams',
      },
      // GitHub OAuth Apps issue non-expiring access tokens by default —
      // refresh tokens are only used by GitHub Apps with user-token expiry
      // explicitly enabled. The OAuth-App template here intentionally relies
      // on the never-expiry behavior; switch to `github-app` (jwt_bearer) for
      // org-wide automation if shorter-lived tokens are needed.
      refreshStrategy: { kind: 'never_expires' },
    },
    {
      id: 'github-app',
      name: 'GitHub App (Installation Token)',
      type: 'oauth',
      flow: 'jwt_bearer',
      description: 'App authenticates as itself for org-wide automation. Requires App ID, private key, and installation ID.',
      // `appId` (numeric) OR `clientId` (Iv23li…) can be used as the JWT `iss`;
      // GitHub accepts either. We also require clientId so OAuthManager.validateConfig
      // is happy and the JWT has a well-defined issuer.
      requiredFields: ['appId', 'privateKey', 'installationId'],
      optionalFields: ['clientId'],
      defaults: {
        type: 'oauth',
        flow: 'jwt_bearer',
        tokenUrl: 'https://api.github.com/app/installations/{installationId}/access_tokens',
        // GitHub's installation access token endpoint does NOT follow RFC 7523
        // (form-urlencoded body). Instead it expects the JWT in
        // `Authorization: Bearer` on an empty POST.
        tokenRequestStyle: 'bearer',
        // GitHub rejects JWTs with exp > 10 min. JWTBearerFlow caps to this.
        tokenLifetimeSeconds: 540,
      },
    },
  ],
};
