/**
 * Google Workspace Integration Test Suite
 *
 * Tests: Gmail (draft, send), Calendar (create, list, get, edit, find slots, transcript), Drive (list, search, read)
 *
 * NOTE: When using service-account auth, most Google tools require `targetUser`
 * to specify which user's mailbox/calendar/drive to act on.
 */

import type { IntegrationTestSuite, TestContext } from '../types.js';
import { registerSuite } from '../runner.js';

/** If targetUser param is set, include it in tool args for service-account auth. */
function withTargetUser(ctx: TestContext, args: Record<string, unknown>): Record<string, unknown> {
  if (ctx.params.targetUser) {
    return { ...args, targetUser: ctx.params.targetUser };
  }
  return args;
}

const googleWorkspaceSuite: IntegrationTestSuite = {
  id: 'google-workspace',
  serviceType: 'google-api',
  name: 'Google Workspace',
  description:
    'Tests Gmail, Google Calendar, and Google Drive tools via Google API connector.',
  requiredParams: [
    {
      key: 'testRecipientEmail',
      label: 'Test Recipient Email',
      description: 'Email address to send test emails and calendar invites to',
      type: 'email',
      required: true,
    },
  ],
  optionalParams: [
    {
      key: 'targetUser',
      label: 'Target User (Service Account Auth)',
      description: 'User email for service-account/domain-wide delegation auth, e.g. "alice@company.com". Required for service-account connectors, leave empty for OAuth.',
      type: 'email',
      required: false,
    },
    {
      key: 'testDriveQuery',
      label: 'Drive Search Query',
      description: 'Search query for Drive file search test (default: "test")',
      type: 'string',
      required: false,
      default: 'test',
    },
    {
      key: 'testMeetingId',
      label: 'Existing Meeting ID',
      description: 'Google Calendar event ID for transcript test (optional)',
      type: 'string',
      required: false,
    },
    {
      key: 'testSlotAttendees',
      label: 'Slot Finder Attendees',
      description: 'Comma-separated emails for find_meeting_slots test',
      type: 'string',
      required: false,
    },
  ],
  tests: [
    // --- Gmail ---
    {
      name: 'Draft an email',
      toolName: 'create_draft_email',
      description: 'Creates a draft email via Gmail API',
      requiredParams: ['testRecipientEmail'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('create_draft_email')!;
        const result = await tool.execute(withTargetUser(ctx, {
          to: [ctx.params.testRecipientEmail],
          subject: `[Integration Test] Draft - ${new Date().toISOString()}`,
          body: 'This is an automated integration test draft. Safe to delete.',
        }));
        if (!result.success) {
          return { success: false, message: result.error || 'Draft creation failed', data: result };
        }
        ctx.state.draftId = result.draftId || result.id;
        return { success: true, message: `Draft created: ${ctx.state.draftId}`, data: result };
      },
    },
    {
      name: 'Send an email',
      toolName: 'send_email',
      description: 'Sends an email via Gmail API',
      requiredParams: ['testRecipientEmail'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('send_email')!;
        const result = await tool.execute(withTargetUser(ctx, {
          to: [ctx.params.testRecipientEmail],
          subject: `[Integration Test] Send - ${new Date().toISOString()}`,
          body: 'This is an automated integration test email. Safe to delete.',
        }));
        if (!result.success) {
          return { success: false, message: result.error || 'Send failed', data: result };
        }
        return { success: true, message: 'Email sent successfully', data: result };
      },
    },

    // --- Calendar ---
    {
      name: 'Create a calendar meeting',
      toolName: 'create_meeting',
      description: 'Creates a Google Calendar event',
      requiredParams: ['testRecipientEmail'],
      critical: true, // get_meeting and edit_meeting depend on this
      execute: async (tools, ctx) => {
        const tool = tools.get('create_meeting')!;
        const start = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
        const end = new Date(start.getTime() + 60 * 60 * 1000); // +1h
        const result = await tool.execute(withTargetUser(ctx, {
          summary: `[Integration Test] Meeting - ${new Date().toISOString()}`,
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          attendees: [ctx.params.testRecipientEmail],
          description: 'Automated integration test meeting. Safe to delete.',
          isOnlineMeeting: true,
          timeZone: 'UTC',
        }));
        if (!result.success) {
          return { success: false, message: result.error || 'Create meeting failed', data: result };
        }
        ctx.state.meetingId = result.eventId;
        return { success: true, message: `Meeting created: ${result.eventId}`, data: result };
      },
      cleanup: async (tools, ctx) => {
        // Delete the test meeting via generic API if it was created
        if (ctx.state.meetingId && tools.has('api')) {
          try {
            const apiTool = tools.get('api')!;
            await apiTool.execute({
              method: 'DELETE',
              endpoint: `/calendar/v3/calendars/primary/events/${ctx.state.meetingId}`,
            });
          } catch {
            // Best effort cleanup
          }
        }
      },
    },
    {
      name: 'List calendar meetings',
      toolName: 'list_meetings',
      description: 'Lists upcoming Google Calendar events',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('list_meetings')!;
        const now = new Date();
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const result = await tool.execute(withTargetUser(ctx, {
          startDateTime: now.toISOString(),
          endDateTime: weekLater.toISOString(),
          maxResults: 10,
          timeZone: 'UTC',
        }));
        if (!result.success) {
          return { success: false, message: result.error || 'List meetings failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.totalCount ?? result.meetings?.length ?? 0} meetings`,
          data: result,
        };
      },
    },
    {
      name: 'Get a specific meeting',
      toolName: 'get_meeting',
      description: 'Gets details of the meeting created in the previous test',
      critical: false,
      execute: async (tools, ctx) => {
        const meetingId = ctx.state.meetingId as string | undefined;
        if (!meetingId) {
          return { success: false, message: 'No meeting ID from create test' };
        }
        const tool = tools.get('get_meeting')!;
        const result = await tool.execute(withTargetUser(ctx, { eventId: meetingId }));
        if (!result.success) {
          return { success: false, message: result.error || 'Get meeting failed', data: result };
        }
        return { success: true, message: `Got meeting: ${result.summary || meetingId}`, data: result };
      },
    },
    {
      name: 'Edit a calendar meeting',
      toolName: 'edit_meeting',
      description: 'Updates the test meeting summary',
      critical: false,
      execute: async (tools, ctx) => {
        const meetingId = ctx.state.meetingId as string | undefined;
        if (!meetingId) {
          return { success: false, message: 'No meeting ID from create test' };
        }
        const tool = tools.get('edit_meeting')!;
        const result = await tool.execute(withTargetUser(ctx, {
          eventId: meetingId,
          summary: `[Integration Test] Updated - ${new Date().toISOString()}`,
        }));
        if (!result.success) {
          return { success: false, message: result.error || 'Edit meeting failed', data: result };
        }
        return { success: true, message: 'Meeting updated successfully', data: result };
      },
    },
    {
      name: 'Find available meeting slots',
      toolName: 'find_meeting_slots',
      description: 'Queries free/busy to find available slots',
      requiredParams: ['testSlotAttendees'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('find_meeting_slots')!;
        const attendees = ctx.params.testSlotAttendees!.split(',').map((e) => e.trim());
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const result = await tool.execute(withTargetUser(ctx, {
          attendees,
          startDateTime: now.toISOString(),
          endDateTime: tomorrow.toISOString(),
          durationMinutes: 30,
          timeZone: 'UTC',
        }));
        if (!result.success) {
          return { success: false, message: result.error || 'Find slots failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.slots?.length ?? 0} available slots`,
          data: result,
        };
      },
    },
    {
      name: 'Get meeting transcript',
      toolName: 'get_meeting_transcript',
      description: 'Retrieves a meeting transcript (requires recorded meeting)',
      requiredParams: ['testMeetingId'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('get_meeting_transcript')!;
        const result = await tool.execute(withTargetUser(ctx, {
          meetingId: ctx.params.testMeetingId,
        }));
        // Transcript may not exist — that's OK, we just verify the API call works
        if (!result.success && result.error?.includes('not found')) {
          return { success: true, message: 'API call succeeded (no transcript found)', data: result };
        }
        if (!result.success) {
          return { success: false, message: result.error || 'Get transcript failed', data: result };
        }
        return { success: true, message: 'Transcript retrieved', data: result };
      },
    },

    // --- Drive ---
    {
      name: 'List Drive files',
      toolName: 'list_files',
      description: 'Lists files in Google Drive',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('list_files')!;
        const result = await tool.execute(withTargetUser(ctx, { maxResults: 5 }));
        if (!result.success) {
          return { success: false, message: result.error || 'List files failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.files?.length ?? 0} files`,
          data: result,
        };
      },
    },
    {
      name: 'Search Drive files',
      toolName: 'search_files',
      description: 'Searches for files in Google Drive',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('search_files')!;
        const query = ctx.params.testDriveQuery || 'test';
        const result = await tool.execute(withTargetUser(ctx, { query, maxResults: 5 }));
        if (!result.success) {
          return { success: false, message: result.error || 'Search files failed', data: result };
        }
        return {
          success: true,
          message: `Search returned ${result.files?.length ?? 0} results`,
          data: result,
        };
      },
    },
    {
      name: 'Read a Drive file',
      toolName: 'read_file',
      description: 'Reads content of a file found in the search',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('read_file')!;
        const searchResult = ctx.state.searchFileId as string | undefined;
        if (!searchResult) {
          const listTool = tools.get('list_files');
          if (listTool) {
            const listResult = await listTool.execute(withTargetUser(ctx, { maxResults: 1 }));
            if (listResult.success && listResult.files?.length > 0) {
              ctx.state.searchFileId = listResult.files[0].id;
            }
          }
        }
        const fileId = ctx.state.searchFileId as string | undefined;
        if (!fileId) {
          return { success: true, message: 'No files available to read (empty Drive)', data: {} };
        }
        const result = await tool.execute(withTargetUser(ctx, { fileId }));
        if (!result.success) {
          return { success: false, message: result.error || 'Read file failed', data: result };
        }
        return { success: true, message: 'File read successfully', data: result };
      },
    },
  ],
};

registerSuite(googleWorkspaceSuite);
export { googleWorkspaceSuite };
