/**
 * Microsoft Graph Connector Tools
 *
 * Auto-registers Microsoft tool factories with ConnectorTools.
 * When imported, this module registers factories so that `ConnectorTools.for('microsoft')`
 * automatically includes Microsoft-specific tools alongside the generic API tool.
 *
 * Tools provided:
 * - create_draft_email — Create a draft email or reply draft
 * - send_email — Send an email or reply
 * - create_meeting — Create a calendar event with optional Teams link
 * - edit_meeting — Update an existing calendar event
 * - get_meeting_transcript — Retrieve Teams meeting transcript
 * - list_meetings — List calendar events in a time window with join URLs
 * - get_meeting — Get full details of a single calendar event
 * - find_meeting_slots — Find available meeting time slots
 * - read_file — Read a file from OneDrive/SharePoint as markdown
 * - list_files — List files/folders in a OneDrive/SharePoint directory
 * - search_files — Search across OneDrive/SharePoint for files
 */

// Side-effect: register Microsoft tool factories with ConnectorTools
import { registerMicrosoftTools } from './register.js';
registerMicrosoftTools();

// Types
export type {
  MicrosoftDraftEmailResult,
  MicrosoftSendEmailResult,
  MicrosoftCreateMeetingResult,
  MicrosoftEditMeetingResult,
  MicrosoftGetTranscriptResult,
  MicrosoftListMeetingsResult,
  MicrosoftGetMeetingResult,
  MeetingListEntry,
  MicrosoftFindSlotsResult,
  MeetingSlotSuggestion,
  MicrosoftAPIError,
  MicrosoftReadFileResult,
  MicrosoftListFilesResult,
  MicrosoftSearchFilesResult,
  GraphDriveItem,
} from './types.js';

// Utility functions
export {
  isAppPermissionAuth,
  getUserPathPrefix,
  microsoftFetch,
  formatRecipients,
  formatAttendees,
  normalizeEmails,
  isTeamsMeetingUrl,
  resolveMeetingId,
  encodeSharingUrl,
  isWebUrl,
  isMicrosoftFileUrl,
  getDrivePrefix,
  resolveFileEndpoints,
  formatFileSize,
  formatMicrosoftToolError,
} from './types.js';

// Tool factories (for direct use with custom options)
export { createDraftEmailTool } from './createDraftEmail.js';
export { createSendEmailTool } from './sendEmail.js';
export { createMeetingTool } from './createMeeting.js';
export { createEditMeetingTool } from './editMeeting.js';
export { createGetMeetingTranscriptTool } from './getMeetingTranscript.js';
export { createListMeetingsTool } from './listMeetings.js';
export { createGetMeetingTool } from './getMeeting.js';
export { createFindMeetingSlotsTool } from './findMeetingSlots.js';
export { createMicrosoftReadFileTool, type MicrosoftReadFileConfig } from './readFile.js';
export { createMicrosoftListFilesTool } from './listFiles.js';
export { createMicrosoftSearchFilesTool } from './searchFiles.js';
