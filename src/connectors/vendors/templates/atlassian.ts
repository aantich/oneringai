/**
 * Atlassian Vendor Templates (Jira, Confluence, Bitbucket, Trello)
 */
import type { VendorTemplate } from '../types.js';

export const jiraTemplate: VendorTemplate = {
  id: 'jira',
  name: 'Jira',
  serviceType: 'jira',
  baseURL: 'https://your-domain.atlassian.net/rest/api/3',
  docsURL: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
  credentialsSetupURL: 'https://id.atlassian.com/manage-profile/security/api-tokens',
  category: 'development',
  notes: 'Replace "your-domain" in baseURL with your Atlassian domain',

  authTemplates: [
    {
      id: 'api-token',
      name: 'API Token',
      type: 'api_key',
      description: 'API token with email for Basic Auth. Create at Atlassian Account > Security > API tokens',
      requiredFields: ['apiKey', 'username'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
    {
      id: 'oauth-3lo',
      name: 'OAuth 2.0 (3LO)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'Three-legged OAuth for user authorization. Create app at developer.atlassian.com. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://auth.atlassian.com/authorize',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        usePKCE: true,
      },
      scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'manage:jira-project', 'manage:jira-configuration'],
      scopeDescriptions: {
        'read:jira-work': 'Read issues, projects, boards',
        'write:jira-work': 'Create and update issues',
        'read:jira-user': 'Read user information',
        'manage:jira-project': 'Manage projects and components',
        'manage:jira-configuration': 'Manage Jira settings',
      },
      refreshStrategy: { kind: 'scope', scope: 'offline_access' },
    },
  ],
};

export const confluenceTemplate: VendorTemplate = {
  id: 'confluence',
  name: 'Confluence',
  serviceType: 'confluence',
  baseURL: 'https://your-domain.atlassian.net/wiki/rest/api',
  docsURL: 'https://developer.atlassian.com/cloud/confluence/rest/',
  credentialsSetupURL: 'https://id.atlassian.com/manage-profile/security/api-tokens',
  category: 'productivity',
  notes: 'Replace "your-domain" in baseURL with your Atlassian domain',

  authTemplates: [
    {
      id: 'api-token',
      name: 'API Token',
      type: 'api_key',
      description: 'API token with email for Basic Auth. Create at Atlassian Account > Security > API tokens',
      requiredFields: ['apiKey', 'username'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
    {
      id: 'oauth-3lo',
      name: 'OAuth 2.0 (3LO)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'Three-legged OAuth for user authorization. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://auth.atlassian.com/authorize',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        usePKCE: true,
      },
      scopes: ['read:confluence-content.all', 'write:confluence-content', 'read:confluence-space.summary', 'write:confluence-space', 'read:confluence-user'],
      scopeDescriptions: {
        'read:confluence-content.all': 'Read all pages and blog posts',
        'write:confluence-content': 'Create and update pages',
        'read:confluence-space.summary': 'Read space summaries',
        'write:confluence-space': 'Create and manage spaces',
        'read:confluence-user': 'Read user information',
      },
      refreshStrategy: { kind: 'scope', scope: 'offline_access' },
    },
  ],
};

export const bitbucketTemplate: VendorTemplate = {
  id: 'bitbucket',
  name: 'Bitbucket',
  serviceType: 'bitbucket',
  baseURL: 'https://api.bitbucket.org/2.0',
  docsURL: 'https://developer.atlassian.com/cloud/bitbucket/rest/',
  credentialsSetupURL: 'https://bitbucket.org/account/settings/app-passwords/',
  category: 'development',

  authTemplates: [
    {
      id: 'app-password',
      name: 'App Password',
      type: 'api_key',
      description: 'App password with username for Basic Auth. Create at Personal Settings > App passwords',
      requiredFields: ['apiKey', 'username'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth Consumer',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth consumer for user authorization. Create at Workspace Settings > OAuth consumers. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://bitbucket.org/site/oauth2/authorize',
        tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
        usePKCE: true,
      },
      scopes: ['repository', 'repository:write', 'pullrequest', 'pullrequest:write', 'account', 'pipeline', 'wiki'],
      scopeDescriptions: {
        'repository': 'Read repositories',
        'repository:write': 'Write to repositories',
        'pullrequest': 'Read pull requests',
        'pullrequest:write': 'Create and update pull requests',
        'account': 'Read account information',
        'pipeline': 'Access Pipelines (CI/CD)',
        'wiki': 'Access repository wiki',
      },
      // Bitbucket OAuth issues a refresh_token on every authorization_code
      // exchange — no special scope or query param required.
      refreshStrategy: { kind: 'automatic' },
    },
  ],
};

export const trelloTemplate: VendorTemplate = {
  id: 'trello',
  name: 'Trello',
  serviceType: 'trello',
  baseURL: 'https://api.trello.com/1',
  docsURL: 'https://developer.atlassian.com/cloud/trello/rest/',
  credentialsSetupURL: 'https://trello.com/power-ups/admin',
  category: 'development',

  authTemplates: [
    {
      id: 'api-key',
      name: 'API Key + Token',
      type: 'api_key',
      description: 'API key and token pair. Get key at trello.com/app-key, generate token from there',
      requiredFields: ['apiKey'],
      optionalFields: ['applicationKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'OAuth oauth_consumer_key="{apiKey}", oauth_token=',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth 1.0a',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth 1.0a for user authorization (legacy). Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://trello.com/1/authorize',
        tokenUrl: 'https://trello.com/1/OAuthGetAccessToken',
        usePKCE: true,
      },
      scopes: ['read', 'write', 'account'],
      scopeDescriptions: {
        'read': 'Read boards, lists, and cards',
        'write': 'Create and update boards, lists, and cards',
        'account': 'Read member information',
      },
      // Trello tokens don't expire by default — the OAuth flow returns
      // long-lived tokens, no refresh needed.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};
