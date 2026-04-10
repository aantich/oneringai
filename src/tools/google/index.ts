/**
 * Google API Connector Tools
 *
 * Auto-registers Google tool factories with ConnectorTools.
 * When imported, this module registers factories so that `ConnectorTools.for('google-api')`
 * automatically includes Google-specific tools alongside the generic API tool.
 *
 * Tools provided:
 * - create_draft_email — Create a draft email in Gmail
 * - send_email — Send an email or reply via Gmail
 * - create_meeting — Create a Google Calendar event with optional Meet link
 * - edit_meeting — Update an existing Google Calendar event
 * - get_meeting_transcript — Retrieve Google Meet transcript from Drive
 * - list_meetings — List calendar events in a time window
 * - get_meeting — Get full details of a single calendar event
 * - find_meeting_slots — Find available meeting time slots via freeBusy
 * - read_file — Read a file from Google Drive as markdown
 * - list_files — List files/folders in Google Drive
 * - search_files — Search across Google Drive for files
 */

// Side-effect: register Google tool factories with ConnectorTools
import { registerGoogleTools } from './register.js';
registerGoogleTools();

// Types
export type {
  GoogleDraftEmailResult,
  GoogleSendEmailResult,
  GoogleCreateMeetingResult,
  GoogleEditMeetingResult,
  GoogleGetTranscriptResult,
  GoogleListMeetingsResult,
  GoogleGetMeetingResult,
  GoogleMeetingListEntry,
  GoogleFindSlotsResult,
  MeetingSlotSuggestion,
  GoogleAPIError,
  GoogleReadFileResult,
  GoogleListFilesResult,
  GoogleSearchFilesResult,
  GoogleDriveFile,
} from './types.js';

// Utility functions
export {
  isServiceAccountAuth,
  getGoogleUserId,
  googleFetch,
  normalizeEmails,
  buildMimeMessage,
  encodeBase64Url,
  stripHtml,
  formatFileSize,
  isGoogleNativeFormat,
  GOOGLE_NATIVE_MIME_TYPES,
  SUPPORTED_EXTENSIONS,
} from './types.js';

// Tool factories (for direct use with custom options)
export { createGoogleDraftEmailTool } from './createDraftEmail.js';
export { createGoogleSendEmailTool } from './sendEmail.js';
export { createGoogleMeetingTool } from './createMeeting.js';
export { createGoogleEditMeetingTool } from './editMeeting.js';
export { createGoogleGetMeetingTranscriptTool } from './getMeetingTranscript.js';
export { createGoogleListMeetingsTool } from './listMeetings.js';
export { createGoogleGetMeetingTool } from './getMeeting.js';
export { createGoogleFindMeetingSlotsTool } from './findMeetingSlots.js';
export { createGoogleReadFileTool, type GoogleReadFileConfig } from './readFile.js';
export { createGoogleListFilesTool } from './listFiles.js';
export { createGoogleSearchFilesTool } from './searchFiles.js';
