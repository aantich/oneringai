/**
 * Tests for Microsoft Graph Connector Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import {
  getUserPathPrefix,
  microsoftFetch,
  formatRecipients,
  formatAttendees,
  normalizeEmails,
  isTeamsMeetingUrl,
  resolveMeetingId,
  MicrosoftAPIError,
} from '../../../../src/tools/microsoft/types.js';
import { createDraftEmailTool } from '../../../../src/tools/microsoft/createDraftEmail.js';
import { createSendEmailTool } from '../../../../src/tools/microsoft/sendEmail.js';
import { createMeetingTool } from '../../../../src/tools/microsoft/createMeeting.js';
import { createEditMeetingTool } from '../../../../src/tools/microsoft/editMeeting.js';
import { createGetMeetingTranscriptTool } from '../../../../src/tools/microsoft/getMeetingTranscript.js';
import { createFindMeetingSlotsTool } from '../../../../src/tools/microsoft/findMeetingSlots.js';

// Import to trigger side-effect registration
import '../../../../src/tools/microsoft/index.js';

/**
 * Create a mock connector for delegated (authorization_code) auth
 */
function createMockConnector(name: string, auth?: 'delegated' | 'app'): Connector {
  const connector = Connector.create(
    auth === 'app'
      ? {
          name,
          serviceType: 'microsoft',
          auth: {
            type: 'oauth',
            flow: 'client_credentials',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            tokenUrl: 'https://login.microsoftonline.com/test/oauth2/v2.0/token',
          },
          baseURL: 'https://graph.microsoft.com/v1.0',
        }
      : {
          name,
          serviceType: 'microsoft',
          auth: { type: 'api_key', apiKey: 'test-token' },
          baseURL: 'https://graph.microsoft.com/v1.0',
        }
  );
  return connector;
}

/**
 * Create a mock Response
 */
function mockResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

/**
 * Create a mock empty Response (e.g., 202 Accepted from sendMail)
 */
function mockEmptyResponse(status = 202): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Accepted',
    headers: new Headers(),
    text: () => Promise.resolve(''),
    json: () => Promise.reject(new Error('No body')),
  } as unknown as Response;
}

describe('Microsoft Graph Tools', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  // ========================================================================
  // getUserPathPrefix
  // ========================================================================

  describe('getUserPathPrefix', () => {
    it('should return /me for api_key auth', () => {
      const connector = createMockConnector('ms-api');
      expect(getUserPathPrefix(connector)).toBe('/me');
    });

    it('should return /me for api_key auth even when targetUser is provided', () => {
      const connector = createMockConnector('ms-api2');
      expect(getUserPathPrefix(connector, 'user@example.com')).toBe('/me');
    });

    it('should return /users/{targetUser} for client_credentials auth', () => {
      const connector = createMockConnector('ms-app', 'app');
      expect(getUserPathPrefix(connector, 'user@example.com')).toBe('/users/user@example.com');
    });

    it('should throw for client_credentials auth without targetUser', () => {
      const connector = createMockConnector('ms-app2', 'app');
      expect(() => getUserPathPrefix(connector)).toThrow('targetUser is required');
    });
  });

  // ========================================================================
  // microsoftFetch
  // ========================================================================

  describe('microsoftFetch', () => {
    it('should make GET request and parse JSON response', async () => {
      const connector = createMockConnector('ms-fetch');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: '123', value: 'test' }));

      const result = await microsoftFetch<{ id: string; value: string }>(connector, '/me/messages');

      expect(result.id).toBe('123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('/me/messages');
      expect(opts?.method).toBe('GET');
      fetchSpy.mockRestore();
    });

    it('should add query params', async () => {
      const connector = createMockConnector('ms-fetch2');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ value: [] }));

      await microsoftFetch(connector, '/me/messages', {
        queryParams: { '$top': 10, '$filter': "isRead eq false" },
      });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('%24top=10');
      expect(calledUrl).toContain('%24filter=');
      fetchSpy.mockRestore();
    });

    it('should set Content-Type for POST with body', async () => {
      const connector = createMockConnector('ms-fetch3');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: '456' }));

      await microsoftFetch(connector, '/me/messages', {
        method: 'POST',
        body: { subject: 'Test' },
      });

      const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      fetchSpy.mockRestore();
    });

    it('should handle empty response body (202)', async () => {
      const connector = createMockConnector('ms-fetch4');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockEmptyResponse());

      const result = await microsoftFetch(connector, '/me/sendMail', { method: 'POST', body: {} });

      expect(result).toBeUndefined();
      fetchSpy.mockRestore();
    });

    it('should throw MicrosoftAPIError on non-ok response', async () => {
      const connector = createMockConnector('ms-fetch5');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValue(
        mockResponse({ error: { code: 'InvalidAuthenticationToken', message: 'Access token is invalid' } }, 401)
      );

      await expect(microsoftFetch(connector, '/me/messages')).rejects.toThrow(MicrosoftAPIError);
      await expect(microsoftFetch(connector, '/me/messages')).rejects.toThrow('Access token is invalid');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // normalizeEmails
  // ========================================================================

  describe('normalizeEmails', () => {
    it('should pass through plain strings', () => {
      expect(normalizeEmails(['alice@example.com', 'bob@example.com'])).toEqual([
        'alice@example.com',
        'bob@example.com',
      ]);
    });

    it('should extract from Graph recipient objects { emailAddress: { address } }', () => {
      const input = [
        { emailAddress: { address: 'alice@example.com', name: 'Alice' }, type: 'required' },
        { emailAddress: { address: 'bob@example.com' } },
      ];
      expect(normalizeEmails(input)).toEqual(['alice@example.com', 'bob@example.com']);
    });

    it('should extract from bare { address } objects', () => {
      expect(normalizeEmails([{ address: 'alice@example.com' }])).toEqual(['alice@example.com']);
    });

    it('should extract from { email } objects', () => {
      expect(normalizeEmails([{ email: 'alice@example.com' }])).toEqual(['alice@example.com']);
    });

    it('should handle mixed formats', () => {
      const input = [
        'plain@example.com',
        { emailAddress: { address: 'graph@example.com' } },
        { address: 'bare@example.com' },
      ];
      expect(normalizeEmails(input)).toEqual([
        'plain@example.com',
        'graph@example.com',
        'bare@example.com',
      ]);
    });

    it('should handle empty array', () => {
      expect(normalizeEmails([])).toEqual([]);
    });
  });

  // ========================================================================
  // formatRecipients / formatAttendees
  // ========================================================================

  describe('formatRecipients', () => {
    it('should convert plain email strings to Graph recipient format', () => {
      const result = formatRecipients(['alice@example.com']);
      expect(result).toEqual([{ emailAddress: { address: 'alice@example.com' } }]);
    });

    it('should normalize Graph objects and re-wrap correctly', () => {
      const result = formatRecipients([
        { emailAddress: { address: 'alice@example.com' }, type: 'required' } as any,
      ]);
      expect(result).toEqual([{ emailAddress: { address: 'alice@example.com' } }]);
    });
  });

  describe('formatAttendees', () => {
    it('should convert plain email strings to Graph attendee format', () => {
      const result = formatAttendees(['alice@example.com']);
      expect(result).toEqual([
        { emailAddress: { address: 'alice@example.com' }, type: 'required' },
      ]);
    });

    it('should normalize Graph objects and re-wrap correctly', () => {
      const result = formatAttendees([
        { emailAddress: { address: 'alice@example.com', name: 'Alice' }, type: 'required' } as any,
      ]);
      expect(result).toEqual([
        { emailAddress: { address: 'alice@example.com' }, type: 'required' },
      ]);
    });
  });

  // ========================================================================
  // isTeamsMeetingUrl
  // ========================================================================

  describe('isTeamsMeetingUrl', () => {
    it('should detect teams.microsoft.com meeting URLs', () => {
      expect(isTeamsMeetingUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123/0')).toBe(true);
    });

    it('should detect teams.live.com meeting URLs', () => {
      expect(isTeamsMeetingUrl('https://teams.live.com/l/meetup-join/19%3ameeting_XYZ/0')).toBe(true);
    });

    it('should return false for raw meeting IDs', () => {
      expect(isTeamsMeetingUrl('MSo1N2Y5ZGFjYy03MWJmLTQ3NDMtYjQxMy01M2EdFGkdRWHJlQ')).toBe(false);
    });

    it('should return false for other URLs', () => {
      expect(isTeamsMeetingUrl('https://example.com/meeting')).toBe(false);
    });

    it('should handle whitespace', () => {
      expect(isTeamsMeetingUrl('  https://teams.microsoft.com/l/meetup-join/19%3ameeting_X/0  ')).toBe(true);
    });
  });

  // ========================================================================
  // resolveMeetingId
  // ========================================================================

  describe('resolveMeetingId', () => {
    it('should pass through raw meeting IDs without API call', async () => {
      const connector = createMockConnector('ms-resolve');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      const result = await resolveMeetingId(connector, 'MSo1N2Y5ZGFjYy0', '/me');

      expect(result.meetingId).toBe('MSo1N2Y5ZGFjYy0');
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('should resolve Teams URL to meeting ID via Graph API', async () => {
      const connector = createMockConnector('ms-resolve2');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(
        mockResponse({
          value: [{ id: 'MSo1N2Y5ZGFjYy0', subject: 'Sprint Review' }],
        })
      );

      const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123/0';
      const result = await resolveMeetingId(connector, url, '/me');

      expect(result.meetingId).toBe('MSo1N2Y5ZGFjYy0');
      expect(result.subject).toBe('Sprint Review');
      // Should have called the onlineMeetings filter endpoint
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/me/onlineMeetings');
      expect(calledUrl).toContain('JoinWebUrl');
      fetchSpy.mockRestore();
    });

    it('should throw if Teams URL does not match any meeting', async () => {
      const connector = createMockConnector('ms-resolve3');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ value: [] }));

      const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_UNKNOWN/0';
      await expect(resolveMeetingId(connector, url, '/me')).rejects.toThrow('Could not find an online meeting');
      fetchSpy.mockRestore();
    });

    it('should throw on empty input', async () => {
      const connector = createMockConnector('ms-resolve4');
      await expect(resolveMeetingId(connector, '', '/me')).rejects.toThrow('cannot be empty');
    });
  });

  // ========================================================================
  // Tool Registration
  // ========================================================================

  describe('Tool Registration', () => {
    it('should register microsoft service with ConnectorTools', () => {
      expect(ConnectorTools.hasServiceTools('microsoft')).toBe(true);
    });

    it('should return 12 tools (11 Microsoft + 1 generic API) via ConnectorTools.for()', () => {
      const connector = createMockConnector('my-microsoft');
      const tools = ConnectorTools.for(connector);
      expect(tools).toHaveLength(12);
    });

    it('should prefix tool names with connector name', () => {
      const connector = createMockConnector('ms-outlook');
      const tools = ConnectorTools.for(connector);
      const names = tools.map((t) => t.definition.function.name);

      expect(names).toContain('ms-outlook_api');
      expect(names).toContain('ms-outlook_create_draft_email');
      expect(names).toContain('ms-outlook_send_email');
      expect(names).toContain('ms-outlook_create_meeting');
      expect(names).toContain('ms-outlook_edit_meeting');
      expect(names).toContain('ms-outlook_get_meeting_transcript');
      expect(names).toContain('ms-outlook_find_meeting_slots');
    });

    it('should return 11 tools via serviceTools()', () => {
      const connector = createMockConnector('ms-svc');
      const tools = ConnectorTools.serviceTools(connector);
      expect(tools).toHaveLength(11);
    });
  });

  // ========================================================================
  // Tool Definitions
  // ========================================================================

  describe('Tool Definitions', () => {
    let connector: Connector;

    beforeEach(() => {
      connector = createMockConnector('ms-def');
    });

    it('create_draft_email has correct name and required params', () => {
      const tool = createDraftEmailTool(connector);
      expect(tool.definition.function.name).toBe('create_draft_email');
      const required = tool.definition.function.parameters?.required;
      expect(required).toContain('to');
      expect(required).toContain('subject');
      expect(required).toContain('body');
    });

    it('send_email has correct name and required params', () => {
      const tool = createSendEmailTool(connector);
      expect(tool.definition.function.name).toBe('send_email');
      const required = tool.definition.function.parameters?.required;
      expect(required).toContain('to');
      expect(required).toContain('subject');
      expect(required).toContain('body');
    });

    it('create_meeting has correct name and required params', () => {
      const tool = createMeetingTool(connector);
      expect(tool.definition.function.name).toBe('create_meeting');
      const required = tool.definition.function.parameters?.required;
      expect(required).toContain('subject');
      expect(required).toContain('startDateTime');
      expect(required).toContain('endDateTime');
      expect(required).toContain('attendees');
    });

    it('edit_meeting has correct name and only requires eventId', () => {
      const tool = createEditMeetingTool(connector);
      expect(tool.definition.function.name).toBe('edit_meeting');
      expect(tool.definition.function.parameters?.required).toEqual(['eventId']);
    });

    it('get_meeting_transcript has correct name and required params', () => {
      const tool = createGetMeetingTranscriptTool(connector);
      expect(tool.definition.function.name).toBe('get_meeting_transcript');
      expect(tool.definition.function.parameters?.required).toContain('meetingId');
    });

    it('find_meeting_slots has correct name and required params', () => {
      const tool = createFindMeetingSlotsTool(connector);
      expect(tool.definition.function.name).toBe('find_meeting_slots');
      const required = tool.definition.function.parameters?.required;
      expect(required).toContain('attendees');
      expect(required).toContain('startDateTime');
      expect(required).toContain('endDateTime');
      expect(required).toContain('duration');
    });

    it('email tools have medium risk level', () => {
      expect(createDraftEmailTool(connector).permission?.riskLevel).toBe('medium');
      expect(createSendEmailTool(connector).permission?.riskLevel).toBe('medium');
    });

    it('meeting mutation tools have medium risk level', () => {
      expect(createMeetingTool(connector).permission?.riskLevel).toBe('medium');
      expect(createEditMeetingTool(connector).permission?.riskLevel).toBe('medium');
    });

    it('read-only tools have low risk level', () => {
      expect(createGetMeetingTranscriptTool(connector).permission?.riskLevel).toBe('low');
      expect(createFindMeetingSlotsTool(connector).permission?.riskLevel).toBe('low');
    });
  });

  // ========================================================================
  // Tool Execution (with mocked fetch)
  // ========================================================================

  describe('Tool Execution', () => {
    let connector: Connector;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      connector = createMockConnector('ms-exec');
      fetchSpy = vi.spyOn(connector, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    // ====================================================================
    // create_draft_email
    // ====================================================================

    describe('create_draft_email', () => {
      it('should create a new draft email', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ id: 'draft-001', webLink: 'https://outlook.office.com/mail/draft-001' })
        );

        const tool = createDraftEmailTool(connector);
        const result = await tool.execute({
          to: ['alice@example.com'],
          subject: 'Test Draft',
          body: '<p>Hello!</p>',
        });

        expect(result.success).toBe(true);
        expect(result.draftId).toBe('draft-001');
        expect(result.webLink).toContain('draft-001');

        // Verify POST body
        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.isDraft).toBe(true);
        expect(callBody.subject).toBe('Test Draft');
        expect(callBody.body).toEqual({ contentType: 'HTML', content: '<p>Hello!</p>' });
        expect(callBody.toRecipients).toEqual([{ emailAddress: { address: 'alice@example.com' } }]);
      });

      it('should create a reply draft (two-step: createReply + PATCH)', async () => {
        // Step 1: createReply returns a draft
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ id: 'reply-draft-001', webLink: 'https://outlook.office.com/mail/reply-draft-001' })
        );
        // Step 2: PATCH updates the draft
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ id: 'reply-draft-001', webLink: 'https://outlook.office.com/mail/reply-draft-001-updated' })
        );

        const tool = createDraftEmailTool(connector);
        const result = await tool.execute({
          to: ['alice@example.com'],
          subject: 'Re: Test',
          body: '<p>Thanks!</p>',
          replyToMessageId: 'original-msg-001',
        });

        expect(result.success).toBe(true);
        expect(result.draftId).toBe('reply-draft-001');
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        // First call: createReply
        const firstUrl = fetchSpy.mock.calls[0]![0] as string;
        expect(firstUrl).toBe('/me/messages/original-msg-001/createReply');

        // Second call: PATCH
        const secondUrl = fetchSpy.mock.calls[1]![0] as string;
        expect(secondUrl).toBe('/me/messages/reply-draft-001');
        expect(fetchSpy.mock.calls[1]![1]?.method).toBe('PATCH');
      });

      it('should include CC recipients when provided', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'draft-cc', webLink: '' }));

        const tool = createDraftEmailTool(connector);
        await tool.execute({
          to: ['alice@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
          cc: ['bob@example.com'],
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.ccRecipients).toEqual([{ emailAddress: { address: 'bob@example.com' } }]);
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ error: { code: 'MailboxNotEnabledForRESTAPI', message: 'Mailbox not enabled' } }, 404)
        );

        const tool = createDraftEmailTool(connector);
        const result = await tool.execute({
          to: ['alice@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to create draft email');
      });
    });

    // ====================================================================
    // send_email
    // ====================================================================

    describe('send_email', () => {
      it('should send a new email (202 empty body)', async () => {
        fetchSpy.mockResolvedValueOnce(mockEmptyResponse());

        const tool = createSendEmailTool(connector);
        const result = await tool.execute({
          to: ['alice@example.com'],
          subject: 'Hello',
          body: '<p>Hi there!</p>',
        });

        expect(result.success).toBe(true);

        // Verify it called /me/sendMail
        const calledUrl = fetchSpy.mock.calls[0]![0] as string;
        expect(calledUrl).toBe('/me/sendMail');

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.message.subject).toBe('Hello');
        expect(callBody.saveToSentItems).toBe(true);
      });

      it('should send a reply', async () => {
        // 3-step reply flow: createReply → PATCH → send
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ id: 'draft-001', body: { content: '<p>Quoted original</p>' } })
        );
        fetchSpy.mockResolvedValueOnce(mockEmptyResponse(200)); // PATCH
        fetchSpy.mockResolvedValueOnce(mockEmptyResponse());    // send

        const tool = createSendEmailTool(connector);
        const result = await tool.execute({
          to: ['alice@example.com'],
          subject: 'Re: Hello',
          body: '<p>Thanks!</p>',
          replyToMessageId: 'msg-001',
        });

        expect(result.success).toBe(true);

        // Step 1: createReply
        const createUrl = fetchSpy.mock.calls[0]![0] as string;
        expect(createUrl).toBe('/me/messages/msg-001/createReply');

        // Step 2: PATCH with combined body and recipients
        const patchUrl = fetchSpy.mock.calls[1]![0] as string;
        expect(patchUrl).toBe('/me/messages/draft-001');
        const patchBody = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
        expect(patchBody.body.content).toBe('<p>Thanks!</p><br/><p>Quoted original</p>');
        expect(patchBody.toRecipients).toEqual([{ emailAddress: { address: 'alice@example.com' } }]);

        // Step 3: send
        const sendUrl = fetchSpy.mock.calls[2]![0] as string;
        expect(sendUrl).toBe('/me/messages/draft-001/send');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ error: { code: 'ErrorSendAsDenied', message: 'Send denied' } }, 403)
        );

        const tool = createSendEmailTool(connector);
        const result = await tool.execute({
          to: ['alice@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to send email');
      });
    });

    // ====================================================================
    // create_meeting
    // ====================================================================

    describe('create_meeting', () => {
      it('should create a basic calendar event', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            id: 'event-001',
            webLink: 'https://outlook.office.com/calendar/event-001',
            onlineMeeting: null,
          })
        );

        const tool = createMeetingTool(connector);
        const result = await tool.execute({
          subject: 'Team Standup',
          startDateTime: '2025-01-15T09:00:00',
          endDateTime: '2025-01-15T09:30:00',
          attendees: ['alice@example.com', 'bob@example.com'],
        });

        expect(result.success).toBe(true);
        expect(result.eventId).toBe('event-001');
        expect(result.onlineMeetingUrl).toBeUndefined();

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.subject).toBe('Team Standup');
        expect(callBody.start).toEqual({ dateTime: '2025-01-15T09:00:00', timeZone: 'UTC' });
        expect(callBody.attendees).toHaveLength(2);
        expect(callBody.attendees[0]).toEqual({
          emailAddress: { address: 'alice@example.com' },
          type: 'required',
        });
      });

      it('should create a Teams online meeting', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            id: 'event-002',
            webLink: 'https://outlook.office.com/calendar/event-002',
            onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/...' },
          })
        );

        const tool = createMeetingTool(connector);
        const result = await tool.execute({
          subject: 'Sprint Review',
          startDateTime: '2025-01-15T14:00:00',
          endDateTime: '2025-01-15T15:00:00',
          attendees: ['alice@example.com'],
          isOnlineMeeting: true,
        });

        expect(result.success).toBe(true);
        expect(result.onlineMeetingUrl).toContain('teams.microsoft.com');

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.isOnlineMeeting).toBe(true);
        expect(callBody.onlineMeetingProvider).toBe('teamsForBusiness');
      });

      it('should include body, location, and timezone', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ id: 'event-003', webLink: '', onlineMeeting: null })
        );

        const tool = createMeetingTool(connector);
        await tool.execute({
          subject: 'Workshop',
          startDateTime: '2025-01-15T09:00:00',
          endDateTime: '2025-01-15T12:00:00',
          attendees: ['alice@example.com'],
          body: '<p>Agenda here</p>',
          location: 'Room 201',
          timeZone: 'America/New_York',
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.body).toEqual({ contentType: 'HTML', content: '<p>Agenda here</p>' });
        expect(callBody.location).toEqual({ displayName: 'Room 201' });
        expect(callBody.start.timeZone).toBe('America/New_York');
        expect(callBody.end.timeZone).toBe('America/New_York');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ error: { code: 'ErrorCalendarOverlapping', message: 'Calendar conflict' } }, 409)
        );

        const tool = createMeetingTool(connector);
        const result = await tool.execute({
          subject: 'Conflict',
          startDateTime: '2025-01-15T09:00:00',
          endDateTime: '2025-01-15T09:30:00',
          attendees: ['alice@example.com'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to create meeting');
      });
    });

    // ====================================================================
    // edit_meeting
    // ====================================================================

    describe('edit_meeting', () => {
      it('should update only provided fields via PATCH', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ id: 'event-001', webLink: 'https://outlook.office.com/calendar/event-001' })
        );

        const tool = createEditMeetingTool(connector);
        const result = await tool.execute({
          eventId: 'event-001',
          subject: 'Updated Title',
        });

        expect(result.success).toBe(true);
        expect(result.eventId).toBe('event-001');

        const calledUrl = fetchSpy.mock.calls[0]![0] as string;
        expect(calledUrl).toBe('/me/events/event-001');
        expect(fetchSpy.mock.calls[0]![1]?.method).toBe('PATCH');

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.subject).toBe('Updated Title');
        // Should NOT include fields that weren't provided
        expect(callBody.body).toBeUndefined();
        expect(callBody.start).toBeUndefined();
        expect(callBody.attendees).toBeUndefined();
      });

      it('should update time with timezone', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'event-001', webLink: '' }));

        const tool = createEditMeetingTool(connector);
        await tool.execute({
          eventId: 'event-001',
          startDateTime: '2025-01-16T10:00:00',
          endDateTime: '2025-01-16T10:30:00',
          timeZone: 'Europe/London',
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.start).toEqual({ dateTime: '2025-01-16T10:00:00', timeZone: 'Europe/London' });
        expect(callBody.end).toEqual({ dateTime: '2025-01-16T10:30:00', timeZone: 'Europe/London' });
      });

      it('should replace attendee list', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'event-001', webLink: '' }));

        const tool = createEditMeetingTool(connector);
        await tool.execute({
          eventId: 'event-001',
          attendees: ['charlie@example.com'],
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.attendees).toEqual([
          { emailAddress: { address: 'charlie@example.com' }, type: 'required' },
        ]);
      });

      it('should toggle online meeting', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'event-001', webLink: '' }));

        const tool = createEditMeetingTool(connector);
        await tool.execute({
          eventId: 'event-001',
          isOnlineMeeting: true,
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.isOnlineMeeting).toBe(true);
        expect(callBody.onlineMeetingProvider).toBe('teamsForBusiness');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ error: { code: 'ErrorItemNotFound', message: 'Event not found' } }, 404)
        );

        const tool = createEditMeetingTool(connector);
        const result = await tool.execute({ eventId: 'nonexistent' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to edit meeting');
      });
    });

    // ====================================================================
    // get_meeting_transcript
    // ====================================================================

    describe('get_meeting_transcript', () => {
      it('should retrieve and parse VTT transcript', async () => {
        // Step 1: List transcripts
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ value: [{ id: 'transcript-001', createdDateTime: '2025-01-15T10:00:00Z' }] })
        );
        // Step 2: Fetch VTT content (uses connector.fetch directly)
        const vttContent = `WEBVTT

1
00:00:00.000 --> 00:00:05.000
Alice: Hello everyone.

2
00:00:05.000 --> 00:00:10.000
Bob: Hi Alice, thanks for setting this up.`;
        fetchSpy.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(vttContent),
        } as unknown as Response);

        const tool = createGetMeetingTranscriptTool(connector);
        const result = await tool.execute({ meetingId: 'meeting-001' });

        expect(result.success).toBe(true);
        expect(result.transcript).toContain('Alice: Hello everyone.');
        expect(result.transcript).toContain('Bob: Hi Alice');
        // Should NOT contain timestamps or WEBVTT header
        expect(result.transcript).not.toContain('WEBVTT');
        expect(result.transcript).not.toContain('00:00:00');
      });

      it('should resolve Teams meeting URL to ID then fetch transcript', async () => {
        // Step 0: Resolve URL to meeting ID via Graph filter
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ value: [{ id: 'resolved-meeting-id', subject: 'Sprint Review' }] })
        );
        // Step 1: List transcripts
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ value: [{ id: 'transcript-001' }] })
        );
        // Step 2: Fetch VTT content
        fetchSpy.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello'),
        } as unknown as Response);

        const tool = createGetMeetingTranscriptTool(connector);
        const result = await tool.execute({
          meetingId: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123/0',
        });

        expect(result.success).toBe(true);
        expect(result.meetingSubject).toBe('Sprint Review');

        // First call should be the URL resolution filter
        const firstUrl = fetchSpy.mock.calls[0]![0] as string;
        expect(firstUrl).toContain('/me/onlineMeetings');
        expect(firstUrl).toContain('JoinWebUrl');

        // Second call should use the resolved meeting ID
        const secondUrl = fetchSpy.mock.calls[1]![0] as string;
        expect(secondUrl).toContain('resolved-meeting-id');
      });

      it('should return error when no transcripts found', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ value: [] }));

        const tool = createGetMeetingTranscriptTool(connector);
        const result = await tool.execute({ meetingId: 'meeting-no-transcript' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No transcripts found');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ error: { code: 'Forbidden', message: 'Insufficient permissions' } }, 403)
        );

        const tool = createGetMeetingTranscriptTool(connector);
        const result = await tool.execute({ meetingId: 'meeting-forbidden' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to get meeting transcript');
      });
    });

    // ====================================================================
    // find_meeting_slots
    // ====================================================================

    describe('find_meeting_slots', () => {
      it('should return available time slots', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            meetingTimeSuggestions: [
              {
                confidence: 100,
                meetingTimeSlot: {
                  start: { dateTime: '2025-01-15T09:00:00', timeZone: 'UTC' },
                  end: { dateTime: '2025-01-15T09:30:00', timeZone: 'UTC' },
                },
                attendeeAvailability: [
                  {
                    attendee: { emailAddress: { address: 'alice@example.com' } },
                    availability: 'free',
                  },
                  {
                    attendee: { emailAddress: { address: 'bob@example.com' } },
                    availability: 'free',
                  },
                ],
              },
              {
                confidence: 80,
                meetingTimeSlot: {
                  start: { dateTime: '2025-01-15T14:00:00', timeZone: 'UTC' },
                  end: { dateTime: '2025-01-15T14:30:00', timeZone: 'UTC' },
                },
                attendeeAvailability: [
                  {
                    attendee: { emailAddress: { address: 'alice@example.com' } },
                    availability: 'free',
                  },
                  {
                    attendee: { emailAddress: { address: 'bob@example.com' } },
                    availability: 'tentative',
                  },
                ],
              },
            ],
          })
        );

        const tool = createFindMeetingSlotsTool(connector);
        const result = await tool.execute({
          attendees: ['alice@example.com', 'bob@example.com'],
          startDateTime: '2025-01-15T08:00:00',
          endDateTime: '2025-01-15T18:00:00',
          duration: 30,
        });

        expect(result.success).toBe(true);
        expect(result.slots).toHaveLength(2);
        expect(result.slots![0]!.start).toBe('2025-01-15T09:00:00');
        expect(result.slots![0]!.confidence).toBe('100');
        expect(result.slots![0]!.attendeeAvailability).toHaveLength(2);
        expect(result.slots![0]!.attendeeAvailability[0]!.attendee).toBe('alice@example.com');
        expect(result.slots![0]!.attendeeAvailability[0]!.availability).toBe('free');
      });

      it('should pass correct request body', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ meetingTimeSuggestions: [] }));

        const tool = createFindMeetingSlotsTool(connector);
        await tool.execute({
          attendees: ['alice@example.com'],
          startDateTime: '2025-01-15T08:00:00',
          endDateTime: '2025-01-15T18:00:00',
          duration: 60,
          timeZone: 'America/New_York',
          maxResults: 10,
        });

        const calledUrl = fetchSpy.mock.calls[0]![0] as string;
        expect(calledUrl).toBe('/me/findMeetingTimes');

        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.meetingDuration).toBe('PT60M');
        expect(callBody.maxCandidates).toBe(10);
        expect(callBody.timeConstraint.timeslots[0].start.timeZone).toBe('America/New_York');
        expect(callBody.attendees).toEqual([
          { emailAddress: { address: 'alice@example.com' }, type: 'required' },
        ]);
      });

      it('should handle emptySuggestionsReason', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            meetingTimeSuggestions: [],
            emptySuggestionsReason: 'AttendeesUnavailable',
          })
        );

        const tool = createFindMeetingSlotsTool(connector);
        const result = await tool.execute({
          attendees: ['busy@example.com'],
          startDateTime: '2025-01-15T08:00:00',
          endDateTime: '2025-01-15T09:00:00',
          duration: 60,
        });

        expect(result.success).toBe(true);
        expect(result.slots).toHaveLength(0);
        expect(result.emptySuggestionsReason).toBe('AttendeesUnavailable');
      });

      it('should normalize Graph attendee objects sent by LLM', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ meetingTimeSuggestions: [], emptySuggestionsReason: 'AttendeesUnavailable' })
        );

        const tool = createFindMeetingSlotsTool(connector);
        // LLM sends Graph-formatted attendee objects instead of plain strings
        const result = await tool.execute({
          attendees: [
            { emailAddress: { address: 'alice@example.com', name: 'Alice' }, type: 'required' },
          ] as any,
          startDateTime: '2025-01-15T08:00:00',
          endDateTime: '2025-01-15T18:00:00',
          duration: 30,
        });

        expect(result.success).toBe(true);

        // Verify the body sent to Graph API has correct format (not double-nested)
        const callBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
        expect(callBody.attendees).toEqual([
          { emailAddress: { address: 'alice@example.com' }, type: 'required' },
        ]);
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ error: { code: 'BadRequest', message: 'Invalid time range' } }, 400)
        );

        const tool = createFindMeetingSlotsTool(connector);
        const result = await tool.execute({
          attendees: ['alice@example.com'],
          startDateTime: '2025-01-15T18:00:00',
          endDateTime: '2025-01-15T08:00:00',
          duration: 30,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to find meeting slots');
      });
    });

    // ====================================================================
    // describeCall
    // ====================================================================

    describe('describeCall', () => {
      it('create_draft_email describes new draft', () => {
        const tool = createDraftEmailTool(connector);
        expect(tool.describeCall?.({ to: ['alice@example.com'], subject: 'Hello', body: '' })).toBe(
          'Draft to alice@example.com: Hello'
        );
      });

      it('create_draft_email describes reply draft', () => {
        const tool = createDraftEmailTool(connector);
        expect(
          tool.describeCall?.({
            to: ['alice@example.com'],
            subject: 'Re: Hello',
            body: '',
            replyToMessageId: 'msg-001',
          })
        ).toBe('Reply draft to alice@example.com: Re: Hello');
      });

      it('send_email describes send', () => {
        const tool = createSendEmailTool(connector);
        expect(tool.describeCall?.({ to: ['a@b.com', 'c@d.com'], subject: 'Test', body: '' })).toBe(
          'Send to a@b.com, c@d.com: Test'
        );
      });

      it('create_meeting describes meeting', () => {
        const tool = createMeetingTool(connector);
        expect(
          tool.describeCall?.({
            subject: 'Standup',
            startDateTime: '',
            endDateTime: '',
            attendees: ['a@b.com', 'c@d.com'],
          })
        ).toBe('Create meeting: Standup (2 attendees)');
      });

      it('edit_meeting describes changes', () => {
        const tool = createEditMeetingTool(connector);
        expect(
          tool.describeCall?.({ eventId: 'AAMkADI1234567890', subject: 'New Title' })
        ).toContain('subject');
      });

      it('get_meeting_transcript describes meeting', () => {
        const tool = createGetMeetingTranscriptTool(connector);
        expect(tool.describeCall?.({ meetingId: 'meeting-very-long-id-here' })).toContain('meeting-very-long-id');
      });

      it('find_meeting_slots describes search', () => {
        const tool = createFindMeetingSlotsTool(connector);
        expect(
          tool.describeCall?.({
            attendees: ['a@b.com', 'c@d.com'],
            startDateTime: '',
            endDateTime: '',
            duration: 30,
          })
        ).toBe('Find 30min slots for 2 attendees');
      });
    });

    // ====================================================================
    // ToolContext userId forwarding
    // ====================================================================

    describe('userId forwarding', () => {
      it('should use context.userId over constructor userId', async () => {
        fetchSpy.mockResolvedValueOnce(mockEmptyResponse());

        const tool = createSendEmailTool(connector, 'constructor-user');
        await tool.execute(
          { to: ['a@b.com'], subject: 'Test', body: 'Hi' },
          { userId: 'context-user' } as any
        );

        // The third arg to connector.fetch is userId
        expect(fetchSpy.mock.calls[0]![2]).toBe('context-user');
      });

      it('should fall back to constructor userId when context has no userId', async () => {
        fetchSpy.mockResolvedValueOnce(mockEmptyResponse());

        const tool = createSendEmailTool(connector, 'constructor-user');
        await tool.execute({ to: ['a@b.com'], subject: 'Test', body: 'Hi' });

        expect(fetchSpy.mock.calls[0]![2]).toBe('constructor-user');
      });
    });
  });
});
