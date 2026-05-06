/**
 * Email Vendor Templates (SendGrid, Mailchimp, Postmark, Mailgun)
 */
import type { VendorTemplate } from '../types.js';

export const sendgridTemplate: VendorTemplate = {
  id: 'sendgrid',
  name: 'SendGrid',
  serviceType: 'sendgrid',
  baseURL: 'https://api.sendgrid.com/v3',
  docsURL: 'https://docs.sendgrid.com/api-reference',
  credentialsSetupURL: 'https://app.sendgrid.com/settings/api_keys',
  category: 'email',

  authTemplates: [
    {
      id: 'api-key',
      name: 'API Key',
      type: 'api_key',
      description: 'API key for SendGrid access. Create at Settings > API Keys',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
  ],
};

export const mailchimpTemplate: VendorTemplate = {
  id: 'mailchimp',
  name: 'Mailchimp',
  serviceType: 'mailchimp',
  baseURL: 'https://server.api.mailchimp.com/3.0',
  docsURL: 'https://mailchimp.com/developer/marketing/api/',
  credentialsSetupURL: 'https://admin.mailchimp.com/account/api/',
  category: 'email',
  notes: 'Replace "server" in baseURL with your datacenter (e.g., us1, us2)',

  authTemplates: [
    {
      id: 'api-key',
      name: 'API Key',
      type: 'api_key',
      description: 'API key for Mailchimp access. Create at Account > Extras > API keys',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth for multi-account access. Register app at mailchimp.com/developer. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://login.mailchimp.com/oauth2/authorize',
        tokenUrl: 'https://login.mailchimp.com/oauth2/token',
        usePKCE: true,
      },
      // Mailchimp OAuth tokens are long-lived and don't expire — no refresh
      // mechanism. Re-auth only on revocation.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};

export const postmarkTemplate: VendorTemplate = {
  id: 'postmark',
  name: 'Postmark',
  serviceType: 'postmark',
  baseURL: 'https://api.postmarkapp.com',
  docsURL: 'https://postmarkapp.com/developer',
  credentialsSetupURL: 'https://account.postmarkapp.com/api_tokens',
  category: 'email',

  authTemplates: [
    {
      id: 'server-token',
      name: 'Server API Token',
      type: 'api_key',
      description: 'Server API token for sending emails. Find in server settings',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'X-Postmark-Server-Token',
        headerPrefix: '',
      },
    },
    {
      id: 'account-token',
      name: 'Account API Token',
      type: 'api_key',
      description: 'Account API token for account management. Find in account settings',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'X-Postmark-Account-Token',
        headerPrefix: '',
      },
    },
  ],
};

export const mailgunTemplate: VendorTemplate = {
  id: 'mailgun',
  name: 'Mailgun',
  serviceType: 'mailgun',
  baseURL: 'https://api.mailgun.net/v3',
  docsURL: 'https://documentation.mailgun.com/docs/mailgun/api-reference/',
  credentialsSetupURL: 'https://app.mailgun.com/settings/api_security',
  category: 'email',
  notes: 'EU region uses api.eu.mailgun.net. Most endpoints require /v3/<domain> in the path.',

  authTemplates: [
    {
      id: 'api-key',
      name: 'API Key',
      type: 'api_key',
      description:
        'Private API key for full account access. Find at Settings > API Security',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
  ],
};
