/**
 * Microsoft 365 Integration Test Suite
 *
 * Tests: Outlook (draft, send), Calendar (create, list, get, edit, find slots, transcript),
 *        OneDrive/SharePoint (list, search, read)
 *
 * NOTE: When using app-only (client_credentials) auth, most Microsoft Graph tools
 * require `targetUser` to specify which mailbox/calendar to act on.
 * Provide it in the optional params.
 */

import type { IntegrationTestSuite, TestContext } from '../types.js';
import { registerSuite } from '../runner.js';

/** If targetUser param is set, include it in tool args for app-only auth. */
function withTargetUser(ctx: TestContext, args: Record<string, unknown>): Record<string, unknown> {
  if (ctx.params.targetUser) {
    return { ...args, targetUser: ctx.params.targetUser };
  }
  return args;
}

const microsoftSuite: IntegrationTestSuite = {
  id: 'microsoft-365',
  serviceType: 'microsoft',
  name: 'Microsoft 365',
  description:
    'Tests Outlook email, Microsoft Calendar, and OneDrive/SharePoint tools via Microsoft Graph.',
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
      label: 'Target User (App-Only Auth)',
      description: 'User email/ID for app-only (client_credentials) auth, e.g. "alice@contoso.com". Required for app-permission connectors, leave empty for delegated auth.',
      type: 'email',
      required: false,
    },
    {
      key: 'testDriveQuery',
      label: 'OneDrive Search Query',
      description: 'Search query for OneDrive file search test (default: "test")',
      type: 'string',
      required: false,
      default: 'test',
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
    // --- Outlook Email ---
    {
      name: 'Draft an email',
      toolName: 'create_draft_email',
      description: 'Creates a draft email via Microsoft Graph',
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
        ctx.state.draftId = result.messageId || result.id;
        return { success: true, message: `Draft created: ${ctx.state.draftId}`, data: result };
      },
    },
    {
      name: 'Send an email',
      toolName: 'send_email',
      description: 'Sends an email via Microsoft Graph',
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
      description: 'Creates a Microsoft Calendar event',
      requiredParams: ['testRecipientEmail'],
      critical: true,
      execute: async (tools, ctx) => {
        const tool = tools.get('create_meeting')!;
        const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const result = await tool.execute(withTargetUser(ctx, {
          subject: `[Integration Test] Meeting - ${new Date().toISOString()}`,
          startDateTime: start.toISOString().replace('Z', ''),
          endDateTime: end.toISOString().replace('Z', ''),
          attendees: [ctx.params.testRecipientEmail],
          body: '<p>Automated integration test meeting. Safe to delete.</p>',
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
        if (ctx.state.meetingId && tools.has('api')) {
          try {
            const apiTool = tools.get('api')!;
            const userPath = ctx.params.targetUser
              ? `/users/${ctx.params.targetUser}`
              : '/me';
            await apiTool.execute({
              method: 'DELETE',
              endpoint: `${userPath}/events/${ctx.state.meetingId}`,
            });
          } catch {
            // Best effort
          }
        }
      },
    },
    {
      name: 'List calendar meetings',
      toolName: 'list_meetings',
      description: 'Lists upcoming Microsoft Calendar events',
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
        return { success: true, message: `Got meeting: ${result.subject || meetingId}`, data: result };
      },
    },
    {
      name: 'Edit a calendar meeting',
      toolName: 'edit_meeting',
      description: 'Updates the test meeting subject',
      critical: false,
      execute: async (tools, ctx) => {
        const meetingId = ctx.state.meetingId as string | undefined;
        if (!meetingId) {
          return { success: false, message: 'No meeting ID from create test' };
        }
        const tool = tools.get('edit_meeting')!;
        const result = await tool.execute(withTargetUser(ctx, {
          eventId: meetingId,
          subject: `[Integration Test] Updated - ${new Date().toISOString()}`,
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
      description: 'Queries Microsoft scheduling assistant for available slots',
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
      description: 'Retrieves a Teams meeting transcript',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('get_meeting_transcript')!;
        const meetingId = ctx.state.meetingId as string | undefined;
        if (!meetingId) {
          return { success: true, message: 'No meeting ID to check transcript for' };
        }
        const result = await tool.execute(withTargetUser(ctx, { meetingId }));
        if (!result.success && (result.error?.includes('not found') || result.error?.includes('No transcript'))) {
          return { success: true, message: 'API call succeeded (no transcript available)', data: result };
        }
        if (!result.success) {
          return { success: false, message: result.error || 'Get transcript failed', data: result };
        }
        return { success: true, message: 'Transcript retrieved', data: result };
      },
    },

    // --- OneDrive / SharePoint ---
    {
      name: 'List OneDrive files',
      toolName: 'list_files',
      description: 'Lists files in OneDrive',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('list_files')!;
        const result = await tool.execute(withTargetUser(ctx, { maxResults: 5 }));
        if (!result.success) {
          return { success: false, message: result.error || 'List files failed', data: result };
        }
        const count = result.files?.length ?? 0;
        if (count > 0) {
          ctx.state.searchFileId = result.files[0].id;
        }
        return { success: true, message: `Found ${count} files`, data: result };
      },
    },
    {
      name: 'Search OneDrive files',
      toolName: 'search_files',
      description: 'Searches for files in OneDrive/SharePoint',
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
      name: 'Read a OneDrive file',
      toolName: 'read_file',
      description: 'Reads content of a file from OneDrive',
      critical: false,
      execute: async (tools, ctx) => {
        const fileId = ctx.state.searchFileId as string | undefined;
        if (!fileId) {
          return { success: true, message: 'No files available to read (empty OneDrive)' };
        }
        const tool = tools.get('read_file')!;
        const result = await tool.execute(withTargetUser(ctx, { fileId }));
        if (!result.success) {
          return { success: false, message: result.error || 'Read file failed', data: result };
        }
        return { success: true, message: 'File read successfully', data: result };
      },
    },
  ],
};

registerSuite(microsoftSuite);
export { microsoftSuite };
