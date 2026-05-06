/**
 * Zoom Vendor Template
 *
 * Supports:
 * - OAuth (User Token) — delegated permissions, user logs in via Zoom
 * - Server-to-Server OAuth — app-level access without user interaction
 */
import type { VendorTemplate } from '../types.js';

export const zoomTemplate: VendorTemplate = {
  id: 'zoom',
  name: 'Zoom',
  serviceType: 'zoom',
  baseURL: 'https://api.zoom.us/v2',
  docsURL: 'https://developers.zoom.us/docs/api/',
  credentialsSetupURL: 'https://marketplace.zoom.us/develop/create',
  category: 'communication',
  notes: 'Zoom supports OAuth user tokens (delegated) and Server-to-Server OAuth (app-level). Legacy JWT apps were deprecated June 2023 — use Server-to-Server OAuth instead.',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (User Token)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'User logs in to Zoom and grants your app permission. Use for user-specific operations like scheduling meetings on behalf of a user.',
      requiredFields: ['clientId', 'redirectUri'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://zoom.us/oauth/authorize',
        tokenUrl: 'https://zoom.us/oauth/token',
        usePKCE: true,
      },
      scopes: [
        'user:read:user',
        'meeting:read:meeting',
        'meeting:write:meeting',
        'meeting:read:list_meetings',
        'cloud_recording:read:list_recording_files',
        'cloud_recording:read:recording_transcript',
      ],
      scopeDescriptions: {
        'user:read:user': 'Read user profile information',
        'meeting:read:meeting': 'View meeting details',
        'meeting:write:meeting': 'Create and update meetings',
        'meeting:read:list_meetings': 'List user meetings',
        'cloud_recording:read:list_recording_files': 'View cloud recordings',
        'cloud_recording:read:recording_transcript': 'Access meeting transcripts',
      },
      // Zoom OAuth: access tokens expire in 1h, refresh_token issued
      // automatically.
      refreshStrategy: { kind: 'automatic' },
    },
    {
      id: 'server-to-server',
      name: 'Server-to-Server OAuth',
      type: 'oauth',
      flow: 'client_credentials',
      description: 'App-level access without user interaction. Uses client_credentials grant with account ID. Best for automation, background tasks, and admin operations.',
      requiredFields: ['clientId', 'clientSecret', 'accountId'],
      optionalFields: ['scope'],
      defaults: {
        type: 'oauth',
        flow: 'client_credentials',
        tokenUrl: 'https://zoom.us/oauth/token',
      },
      scopes: [
        'user:read:user',
        'meeting:read:meeting',
        'meeting:write:meeting',
        'meeting:read:list_meetings',
        'cloud_recording:read:list_recording_files',
        'cloud_recording:read:recording_transcript',
      ],
      scopeDescriptions: {
        'user:read:user': 'Read user profile information',
        'meeting:read:meeting': 'View meeting details',
        'meeting:write:meeting': 'Create and update meetings',
        'meeting:read:list_meetings': 'List user meetings',
        'cloud_recording:read:list_recording_files': 'View cloud recordings',
        'cloud_recording:read:recording_transcript': 'Access meeting transcripts',
      },
    },
  ],

  optionFields: [
    {
      key: 'defaultUserId',
      label: 'Default User ID or Email',
      description: 'Zoom user ID or email for Server-to-Server apps (defaults to "me" for OAuth user tokens)',
      required: false,
      type: 'string',
      placeholder: 'me',
    },
  ],
};
