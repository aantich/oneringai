/**
 * Other Vendor Templates (Twilio, Zendesk, Intercom, Shopify)
 */
import type { VendorTemplate } from '../types.js';

export const twilioTemplate: VendorTemplate = {
  id: 'twilio',
  name: 'Twilio',
  serviceType: 'twilio',
  baseURL: 'https://api.twilio.com/2010-04-01',
  docsURL: 'https://www.twilio.com/docs/usage/api',
  credentialsSetupURL: 'https://console.twilio.com/us1/account/keys-credentials/api-keys',
  category: 'other',

  authTemplates: [
    {
      id: 'api-key',
      name: 'Account SID + Auth Token',
      type: 'api_key',
      description: 'Account credentials for Basic Auth. Find at console.twilio.com',
      requiredFields: ['apiKey', 'accountId'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
    {
      id: 'api-key-sid',
      name: 'API Key + Secret',
      type: 'api_key',
      description: 'API key credentials (recommended). Create at Console > API Keys',
      requiredFields: ['apiKey', 'applicationKey', 'accountId'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
  ],

  optionFields: [
    {
      key: 'defaultFromNumber',
      label: 'Default SMS Phone Number',
      description: 'Your Twilio phone number for sending SMS (E.164 format). Used when no "from" is specified in send_sms.',
      required: false,
      type: 'string',
      placeholder: '+15551234567',
    },
    {
      key: 'defaultWhatsAppNumber',
      label: 'Default WhatsApp Phone Number',
      description: 'Your Twilio WhatsApp-enabled number (E.164 format). Used when no "from" is specified in send_whatsapp.',
      required: false,
      type: 'string',
      placeholder: '+15551234567',
    },
  ],
};

export const zendeskTemplate: VendorTemplate = {
  id: 'zendesk',
  name: 'Zendesk',
  serviceType: 'zendesk',
  baseURL: 'https://your-subdomain.zendesk.com/api/v2',
  docsURL: 'https://developer.zendesk.com/api-reference/',
  credentialsSetupURL: 'https://support.zendesk.com/hc/en-us/articles/4408889192858',
  category: 'other',
  notes: 'Replace "your-subdomain" in baseURL with your Zendesk subdomain',

  authTemplates: [
    {
      id: 'api-token',
      name: 'API Token',
      type: 'api_key',
      description: 'API token with email/token for Basic Auth. Create at Admin > Channels > API',
      requiredFields: ['apiKey', 'username'],
      optionalFields: ['subdomain'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Basic',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (User Authorization)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth client for user authorization. Create at Admin > Channels > API > OAuth Clients. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri', 'subdomain'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://{subdomain}.zendesk.com/oauth/authorizations/new',
        tokenUrl: 'https://{subdomain}.zendesk.com/oauth/tokens',
        usePKCE: true,
      },
      scopes: ['read', 'write', 'tickets:read', 'tickets:write'],
      scopeDescriptions: {
        'read': 'Read all resources',
        'write': 'Create and update resources',
        'tickets:read': 'Read support tickets',
        'tickets:write': 'Create and update tickets',
      },
      // Zendesk OAuth tokens don't expire by default — long-lived. No
      // refresh mechanism in the standard flow.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};

export const intercomTemplate: VendorTemplate = {
  id: 'intercom',
  name: 'Intercom',
  serviceType: 'intercom',
  baseURL: 'https://api.intercom.io',
  docsURL: 'https://developers.intercom.com/docs/',
  credentialsSetupURL: 'https://developers.intercom.com/docs/build-an-integration',
  category: 'other',

  authTemplates: [
    {
      id: 'access-token',
      name: 'Access Token',
      type: 'api_key',
      description: 'Access token for API access. Create app at app.intercom.com/developers',
      requiredFields: ['apiKey'],
      defaults: {
        type: 'api_key',
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (App Installation)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth for Intercom app marketplace distribution. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://app.intercom.com/oauth',
        tokenUrl: 'https://api.intercom.io/auth/eagle/token',
        usePKCE: true,
      },
      // Intercom OAuth tokens don't expire — no refresh mechanism.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};

export const shopifyTemplate: VendorTemplate = {
  id: 'shopify',
  name: 'Shopify',
  serviceType: 'shopify',
  baseURL: 'https://your-store.myshopify.com/admin/api/2024-01',
  docsURL: 'https://shopify.dev/docs/api',
  credentialsSetupURL: 'https://partners.shopify.com/',
  category: 'other',
  notes: 'Replace "your-store" in baseURL with your store name',

  authTemplates: [
    {
      id: 'access-token',
      name: 'Admin API Access Token',
      type: 'api_key',
      description: 'Private app access token. Create custom app at your-store.myshopify.com/admin/apps',
      requiredFields: ['apiKey'],
      optionalFields: ['subdomain'],
      defaults: {
        type: 'api_key',
        headerName: 'X-Shopify-Access-Token',
        headerPrefix: '',
      },
    },
    {
      id: 'oauth-user',
      name: 'OAuth (Public/Custom App)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'OAuth for public apps or per-store custom apps. Create at partners.shopify.com. Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri', 'subdomain'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://{subdomain}.myshopify.com/admin/oauth/authorize',
        tokenUrl: 'https://{subdomain}.myshopify.com/admin/oauth/access_token',
        usePKCE: true,
      },
      scopes: ['read_products', 'write_products', 'read_orders', 'write_orders', 'read_customers', 'write_customers', 'read_inventory', 'write_inventory', 'read_fulfillments', 'write_fulfillments'],
      scopeDescriptions: {
        'read_products': 'Read products and collections',
        'write_products': 'Create and update products',
        'read_orders': 'Read orders and transactions',
        'write_orders': 'Create and update orders',
        'read_customers': 'Read customer information',
        'write_customers': 'Create and update customers',
        'read_inventory': 'Read inventory levels',
        'write_inventory': 'Update inventory levels',
        'read_fulfillments': 'Read fulfillment data',
        'write_fulfillments': 'Create and update fulfillments',
      },
      // Shopify Admin API access tokens are long-lived (do not expire) for
      // online & offline access modes. No refresh mechanism.
      refreshStrategy: { kind: 'never_expires' },
    },
  ],
};
