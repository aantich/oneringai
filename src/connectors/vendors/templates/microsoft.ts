/**
 * Microsoft Vendor Template (Unified)
 *
 * Single connector for all Microsoft services via Microsoft Graph API.
 * Includes access to: 365, Teams, OneDrive, Outlook, Azure AD, etc.
 */
import type { VendorTemplate } from '../types.js';

export const microsoftTemplate: VendorTemplate = {
  id: 'microsoft',
  name: 'Microsoft',
  serviceType: 'microsoft',
  baseURL: 'https://graph.microsoft.com/v1.0',
  docsURL: 'https://learn.microsoft.com/en-us/graph/',
  credentialsSetupURL: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  category: 'major-vendors',
  notes: 'Unified access to Microsoft 365, Teams, OneDrive, Outlook, Calendar via Microsoft Graph API',

  authTemplates: [
    {
      id: 'oauth-user',
      name: 'OAuth (Delegated Permissions)',
      type: 'oauth',
      flow: 'authorization_code',
      description: 'User signs in with Microsoft account. Best for accessing user data (mail, calendar, files). Provide clientSecret for web apps; omit for native/desktop apps (secured via PKCE).',
      requiredFields: ['clientId', 'redirectUri', 'tenantId'],
      optionalFields: ['clientSecret', 'scope'],
      defaults: {
        type: 'oauth',
        flow: 'authorization_code',
        authorizationUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
        usePKCE: true,
      },
      scopes: [
        'User.Read',
        'Mail.Read',
        'Mail.ReadWrite',
        'Mail.Send',
        'Calendars.ReadWrite',
        'OnlineMeetings.Read',
        'OnlineMeetingTranscript.Read.All',
        'Contacts.Read',
        'Contacts.ReadWrite',
        'Files.ReadWrite',
        'Sites.Read.All',
        'Sites.ReadWrite.All',
        'Notes.Read',
        'Notes.ReadWrite',
        'Tasks.ReadWrite',
        'ChannelMessage.Send',
        'Team.ReadBasic.All',
        'Chat.ReadWrite',
        'People.Read',
        'Presence.Read',
        'Directory.Read.All',
        'BookingsAppointment.ReadWrite.All',
        'offline_access',
      ],
      scopeDescriptions: {
        'User.Read': 'Read your profile',
        'Mail.Read': 'Read your email',
        'Mail.ReadWrite': 'Read and write your email',
        'Mail.Send': 'Send email on your behalf',
        'Calendars.ReadWrite': 'Read and write your calendar',
        'OnlineMeetings.Read': 'Read your online meetings (Teams)',
        'OnlineMeetingTranscript.Read.All': 'Read transcripts of your online meetings',
        'Contacts.Read': 'Read your contacts',
        'Contacts.ReadWrite': 'Read and write your contacts',
        'Files.ReadWrite': 'Read and write your files (OneDrive)',
        'Sites.Read.All': 'Read SharePoint sites',
        'Sites.ReadWrite.All': 'Read and write SharePoint sites',
        'Notes.Read': 'Read your OneNote notebooks',
        'Notes.ReadWrite': 'Read and write your OneNote notebooks',
        'Tasks.ReadWrite': 'Read and write your tasks (To Do / Planner)',
        'ChannelMessage.Send': 'Send messages in Teams channels',
        'Team.ReadBasic.All': 'Read Teams basic info',
        'Chat.ReadWrite': 'Read and write Teams chats',
        'People.Read': 'Read your relevant people list',
        'Presence.Read': 'Read user presence information',
        'Directory.Read.All': 'Read directory data (Azure AD)',
        'BookingsAppointment.ReadWrite.All': 'Manage Bookings appointments',
        'offline_access': 'Maintain access (refresh token)',
      },
    },
    {
      id: 'client-credentials',
      name: 'App-Only (Client Credentials)',
      type: 'oauth',
      flow: 'client_credentials',
      description: 'App authenticates as itself - requires admin consent. Best for automation and background tasks',
      requiredFields: ['clientId', 'clientSecret', 'tenantId'],
      optionalFields: ['scope'],
      defaults: {
        type: 'oauth',
        flow: 'client_credentials',
        tokenUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
      },
      scopes: ['https://graph.microsoft.com/.default'],
      scopeDescriptions: {
        'https://graph.microsoft.com/.default': 'All permissions granted to the app registration',
      },
    },
  ],
};

// Legacy exports for backward compatibility (all point to unified template)
export const microsoft365Template = microsoftTemplate;
export const microsoftTeamsTemplate = microsoftTemplate;
export const azureTemplate = microsoftTemplate;
export const onedriveTemplate = microsoftTemplate;
