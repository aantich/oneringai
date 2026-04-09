/**
 * Google Vendor Template (Unified)
 *
 * Single connector for all Google services via Google APIs.
 * Includes access to: Workspace (Drive, Docs, Sheets, Calendar), Gmail, GCP, etc.
 */
import type { VendorTemplate } from '../types.js';

export const googleTemplate: VendorTemplate = {
  id: 'google-api',
  name: 'Google',
  serviceType: 'google-api',
  baseURL: 'https://www.googleapis.com',
  docsURL: 'https://developers.google.com/',
  credentialsSetupURL: 'https://console.cloud.google.com/apis/credentials',
  category: 'major-vendors',
  notes: 'Unified access to Google Workspace (Drive, Docs, Sheets, Calendar), Gmail, and Cloud APIs',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (User Consent)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'User logs in with Google account. Best for accessing user data (Drive, Gmail, Calendar). Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        usePKCE: true,
        // Google requires access_type=offline to return a refresh_token.
        // prompt=consent forces the consent screen on re-authorization,
        // which is the only way Google re-issues a refresh_token for
        // an app the user has already authorized.
        authorizationParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/contacts.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
      ],
      scopeDescriptions: {
        'https://www.googleapis.com/auth/drive': 'Read and write Google Drive files',
        'https://www.googleapis.com/auth/calendar': 'Read and write Google Calendar',
        'https://www.googleapis.com/auth/gmail.readonly': 'Read Gmail messages',
        'https://www.googleapis.com/auth/gmail.send': 'Send Gmail messages',
        'https://www.googleapis.com/auth/spreadsheets': 'Read and write Google Sheets',
        'https://www.googleapis.com/auth/documents': 'Read and write Google Docs',
        'https://www.googleapis.com/auth/contacts.readonly': 'Read Google Contacts',
        'https://www.googleapis.com/auth/tasks': 'Read and write Google Tasks',
        'https://www.googleapis.com/auth/admin.directory.user.readonly': 'Read user directory (Admin)',
      },
    },
    {
      id: 'service-account',
      name: 'Service Account (JWT Bearer)',
      type: 'oauth',
      flow: 'jwt_bearer',
      description: 'Server-to-server auth without user. Download JSON key from GCP Console. Can impersonate users with domain-wide delegation',
      requiredFields: ['clientId', 'privateKey'],
      optionalFields: ['scope', 'subject'],
      defaults: {
        type: 'oauth',
        flow: 'jwt_bearer',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        audience: 'https://oauth2.googleapis.com/token',
      },
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/drive',
      ],
      scopeDescriptions: {
        'https://www.googleapis.com/auth/cloud-platform': 'Full access to Google Cloud Platform',
        'https://www.googleapis.com/auth/drive': 'Read and write Google Drive files',
      },
    },
  ],
};

// Legacy exports for backward compatibility (all point to unified template)
export const googleWorkspaceTemplate = googleTemplate;
export const googleDriveTemplate = googleTemplate;
export const gcpTemplate = googleTemplate;
