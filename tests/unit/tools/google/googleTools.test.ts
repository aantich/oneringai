/**
 * Tests for Google API Connector Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import {
  getGoogleUserId,
  googleFetch,
  normalizeEmails,
  buildMimeMessage,
  encodeBase64Url,
  stripHtml,
  isGoogleNativeFormat,
  GoogleAPIError,
} from '../../../../src/tools/google/types.js';
import { createGoogleDraftEmailTool } from '../../../../src/tools/google/createDraftEmail.js';
import { createGoogleSendEmailTool } from '../../../../src/tools/google/sendEmail.js';
import { createGoogleMeetingTool } from '../../../../src/tools/google/createMeeting.js';
import { createGoogleEditMeetingTool } from '../../../../src/tools/google/editMeeting.js';
import { createGoogleGetMeetingTranscriptTool } from '../../../../src/tools/google/getMeetingTranscript.js';
import { createGoogleListMeetingsTool } from '../../../../src/tools/google/listMeetings.js';
import { createGoogleGetMeetingTool } from '../../../../src/tools/google/getMeeting.js';
import { createGoogleFindMeetingSlotsTool } from '../../../../src/tools/google/findMeetingSlots.js';
import { createGoogleReadFileTool } from '../../../../src/tools/google/readFile.js';
import { createGoogleListFilesTool } from '../../../../src/tools/google/listFiles.js';
import { createGoogleSearchFilesTool } from '../../../../src/tools/google/searchFiles.js';

// Import to trigger side-effect registration
import '../../../../src/tools/google/index.js';

/**
 * Create a mock connector for delegated (authorization_code) auth
 */
function createMockConnector(name: string, auth?: 'delegated' | 'service-account'): Connector {
  const connector = Connector.create(
    auth === 'service-account'
      ? {
          name,
          serviceType: 'google-api',
          auth: {
            type: 'oauth',
            flow: 'jwt_bearer',
            clientId: 'test-client',
            privateKey: 'test-key',
            tokenUrl: 'https://oauth2.googleapis.com/token',
          },
          baseURL: 'https://www.googleapis.com',
        }
      : {
          name,
          serviceType: 'google-api',
          auth: { type: 'api_key', apiKey: 'test-token' },
          baseURL: 'https://www.googleapis.com',
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
    arrayBuffer: () => Promise.resolve(
      typeof data === 'string'
        ? new TextEncoder().encode(data).buffer
        : new TextEncoder().encode(JSON.stringify(data)).buffer
    ),
  } as unknown as Response;
}

/**
 * Create a mock empty Response
 */
function mockEmptyResponse(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'No Content',
    headers: new Headers(),
    text: () => Promise.resolve(''),
    json: () => Promise.reject(new Error('No body')),
  } as unknown as Response;
}

describe('Google API Tools', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  // ========================================================================
  // getGoogleUserId
  // ========================================================================

  describe('getGoogleUserId', () => {
    it('should return "me" for api_key auth', () => {
      const connector = createMockConnector('google-api');
      expect(getGoogleUserId(connector)).toBe('me');
    });

    it('should return "me" for api_key auth even when targetUser is provided', () => {
      const connector = createMockConnector('google-api2');
      expect(getGoogleUserId(connector, 'user@example.com')).toBe('me');
    });

    it('should return targetUser for service-account auth', () => {
      const connector = createMockConnector('google-sa', 'service-account');
      expect(getGoogleUserId(connector, 'user@example.com')).toBe('user@example.com');
    });

    it('should throw for service-account auth without targetUser', () => {
      const connector = createMockConnector('google-sa2', 'service-account');
      expect(() => getGoogleUserId(connector)).toThrow('targetUser is required');
    });
  });

  // ========================================================================
  // googleFetch
  // ========================================================================

  describe('googleFetch', () => {
    it('should make GET request and parse JSON response', async () => {
      const connector = createMockConnector('google-fetch');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: '123', value: 'test' }));

      const result = await googleFetch<{ id: string; value: string }>(connector, '/drive/v3/files');

      expect(result.id).toBe('123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('/drive/v3/files');
      expect(opts?.method).toBe('GET');
      fetchSpy.mockRestore();
    });

    it('should add query params', async () => {
      const connector = createMockConnector('google-fetch2');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      await googleFetch(connector, '/drive/v3/files', {
        queryParams: { pageSize: 10, q: "name contains 'test'" },
      });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('pageSize=10');
      expect(calledUrl).toContain('q=');
      fetchSpy.mockRestore();
    });

    it('should set Content-Type for POST with body', async () => {
      const connector = createMockConnector('google-fetch3');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: '456' }));

      await googleFetch(connector, '/calendar/v3/calendars/me/events', {
        method: 'POST',
        body: { summary: 'Test' },
      });

      const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      fetchSpy.mockRestore();
    });

    it('should handle empty response body (204)', async () => {
      const connector = createMockConnector('google-fetch4');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockEmptyResponse());

      const result = await googleFetch(connector, '/some/endpoint', { method: 'DELETE' });

      expect(result).toBeUndefined();
      fetchSpy.mockRestore();
    });

    it('should throw GoogleAPIError on non-ok response', async () => {
      const connector = createMockConnector('google-fetch5');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValue(
        mockResponse({ error: { code: 401, message: 'Invalid credentials' } }, 401)
      );

      await expect(googleFetch(connector, '/drive/v3/files')).rejects.toThrow(GoogleAPIError);
      await expect(googleFetch(connector, '/drive/v3/files')).rejects.toThrow('Invalid credentials');
      fetchSpy.mockRestore();
    });

    it('should prepend baseUrl when provided with relative endpoint', async () => {
      const connector = createMockConnector('google-fetch6');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'msg1' }));

      await googleFetch(connector, '/gmail/v1/users/me/messages', {
        baseUrl: 'https://gmail.googleapis.com',
      });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages');
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

    it('should extract from { emailAddress: { address } } objects', () => {
      const input = [
        { emailAddress: { address: 'alice@example.com', name: 'Alice' }, type: 'required' },
      ];
      expect(normalizeEmails(input)).toEqual(['alice@example.com']);
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
  // buildMimeMessage / encodeBase64Url
  // ========================================================================

  describe('buildMimeMessage', () => {
    it('should build a valid MIME message', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test Subject',
        body: '<p>Hello</p>',
      });

      expect(mime).toContain('To: alice@example.com');
      expect(mime).toContain('Subject: Test Subject');
      expect(mime).toContain('MIME-Version: 1.0');
      expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    });

    it('should include CC when provided', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'Hi',
        cc: ['bob@example.com', 'carol@example.com'],
      });

      expect(mime).toContain('Cc: bob@example.com, carol@example.com');
    });

    it('should include reply headers when inReplyTo is set', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Re: Test',
        body: 'Reply',
        inReplyTo: '<msg123@example.com>',
        references: '<msg100@example.com>',
      });

      expect(mime).toContain('In-Reply-To: <msg123@example.com>');
      expect(mime).toContain('References: <msg100@example.com>');
    });

    it('should wrap base64 body to max 76-char lines (RFC 2822)', () => {
      // Create a body large enough to produce >76 chars of base64
      const longBody = '<p>' + 'A'.repeat(200) + '</p>';
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body: longBody,
      });

      // Split on the empty line separator to get the body part
      const parts = mime.split('\r\n\r\n');
      const bodyPart = parts[1]!;
      const lines = bodyPart.split('\r\n').filter(l => l.length > 0);

      // Every line of the base64 body should be <= 76 chars
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
      // Should have multiple lines (not one giant line)
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe('encodeBase64Url', () => {
    it('should encode to base64url (no +, /, or = characters)', () => {
      const encoded = encodeBase64Url('Hello World! This is a test with special chars: +/=');
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('should produce a non-empty string', () => {
      expect(encodeBase64Url('test')).toBeTruthy();
    });
  });

  // ========================================================================
  // stripHtml
  // ========================================================================

  describe('stripHtml', () => {
    it('should strip HTML tags', () => {
      expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    it('should convert <br> to newlines', () => {
      expect(stripHtml('line1<br>line2<br/>line3')).toBe('line1\nline2\nline3');
    });

    it('should decode HTML entities', () => {
      expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
    });
  });

  // ========================================================================
  // isGoogleNativeFormat
  // ========================================================================

  describe('isGoogleNativeFormat', () => {
    it('should return true for Google Docs', () => {
      expect(isGoogleNativeFormat('application/vnd.google-apps.document')).toBe(true);
    });

    it('should return true for Google Sheets', () => {
      expect(isGoogleNativeFormat('application/vnd.google-apps.spreadsheet')).toBe(true);
    });

    it('should return false for regular files', () => {
      expect(isGoogleNativeFormat('application/pdf')).toBe(false);
    });
  });

  // ========================================================================
  // ConnectorTools Registration
  // ========================================================================

  describe('ConnectorTools registration', () => {
    it('should register google-api service and return tools', () => {
      expect(ConnectorTools.hasServiceTools('google-api')).toBe(true);
    });

    it('should return all 11 tools from serviceTools', () => {
      const connector = createMockConnector('google-reg');
      const tools = ConnectorTools.serviceTools(connector);
      expect(tools.length).toBe(11);

      const names = tools.map(t => t.definition.function.name);
      expect(names).toContain('create_draft_email');
      expect(names).toContain('send_email');
      expect(names).toContain('create_meeting');
      expect(names).toContain('edit_meeting');
      expect(names).toContain('get_meeting_transcript');
      expect(names).toContain('list_meetings');
      expect(names).toContain('get_meeting');
      expect(names).toContain('find_meeting_slots');
      expect(names).toContain('read_file');
      expect(names).toContain('list_files');
      expect(names).toContain('search_files');
    });
  });

  // ========================================================================
  // create_draft_email
  // ========================================================================

  describe('create_draft_email', () => {
    it('should create a draft email', async () => {
      const connector = createMockConnector('google-draft');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'draft-123',
        message: { id: 'msg-456', threadId: 'thread-789' },
      }));

      const tool = createGoogleDraftEmailTool(connector);
      const result = await tool.execute({
        to: ['alice@example.com'],
        subject: 'Test Draft',
        body: '<p>Hello</p>',
      });

      expect(result.success).toBe(true);
      expect(result.draftId).toBe('draft-123');
      expect(result.messageId).toBe('msg-456');
      expect(result.threadId).toBe('thread-789');
      fetchSpy.mockRestore();
    });

    it('should create a reply draft with threading', async () => {
      const connector = createMockConnector('google-draft-reply');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // First call: fetch original message for threading headers
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'orig-msg',
        threadId: 'thread-ABC',
        payload: {
          headers: [
            { name: 'Message-Id', value: '<orig@example.com>' },
          ],
        },
      }));

      // Second call: create draft
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'draft-reply',
        message: { id: 'msg-reply', threadId: 'thread-ABC' },
      }));

      const tool = createGoogleDraftEmailTool(connector);
      const result = await tool.execute({
        to: ['alice@example.com'],
        subject: 'Re: Test',
        body: 'Reply here',
        replyToMessageId: 'orig-msg',
      });

      expect(result.success).toBe(true);
      expect(result.threadId).toBe('thread-ABC');

      // Check that threadId is at top level of draft body (NOT inside message)
      const createCall = fetchSpy.mock.calls[1]!;
      const body = JSON.parse(createCall[1]?.body as string);
      expect(body.threadId).toBe('thread-ABC');
      expect(body.message.threadId).toBeUndefined();
      expect(body.message.raw).toBeTruthy();
      fetchSpy.mockRestore();
    });

    it('should return error on API failure', async () => {
      const connector = createMockConnector('google-draft-err');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ error: { message: 'Forbidden' } }, 403));

      const tool = createGoogleDraftEmailTool(connector);
      const result = await tool.execute({
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'Hi',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create draft email');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // send_email
  // ========================================================================

  describe('send_email', () => {
    it('should send an email', async () => {
      const connector = createMockConnector('google-send');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'msg-sent',
        threadId: 'thread-new',
      }));

      const tool = createGoogleSendEmailTool(connector);
      const result = await tool.execute({
        to: ['alice@example.com'],
        subject: 'Hello',
        body: '<p>Hi Alice</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-sent');
      expect(result.threadId).toBe('thread-new');

      // Verify the request body contains a raw field
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body.raw).toBeTruthy();
      fetchSpy.mockRestore();
    });

    it('should send a reply with threading', async () => {
      const connector = createMockConnector('google-send-reply');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // Fetch original message
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'orig-msg',
        threadId: 'thread-XYZ',
        payload: {
          headers: [
            { name: 'Message-Id', value: '<orig@example.com>' },
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'me@example.com' },
          ],
        },
      }));

      // Send reply
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'msg-reply-sent',
        threadId: 'thread-XYZ',
      }));

      const tool = createGoogleSendEmailTool(connector);
      const result = await tool.execute({
        to: ['sender@example.com'],
        subject: 'Re: Hello',
        body: 'Reply',
        replyToMessageId: 'orig-msg',
      });

      expect(result.success).toBe(true);
      expect(result.threadId).toBe('thread-XYZ');

      // Verify threadId in send request
      const sendBody = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
      expect(sendBody.threadId).toBe('thread-XYZ');
      fetchSpy.mockRestore();
    });

    it('should handle replyAll by merging CC recipients', async () => {
      const connector = createMockConnector('google-send-replyall');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'orig-msg',
        threadId: 'thread-1',
        payload: {
          headers: [
            { name: 'Message-Id', value: '<orig@example.com>' },
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'me@example.com, alice@example.com' },
            { name: 'Cc', value: 'bob@example.com' },
          ],
        },
      }));

      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'msg-replyall',
        threadId: 'thread-1',
      }));

      const tool = createGoogleSendEmailTool(connector);
      const result = await tool.execute({
        to: ['sender@example.com'],
        subject: 'Re: Hello',
        body: 'Reply all',
        replyToMessageId: 'orig-msg',
        replyAll: true,
      });

      expect(result.success).toBe(true);
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // create_meeting
  // ========================================================================

  describe('create_meeting', () => {
    it('should create a calendar event', async () => {
      const connector = createMockConnector('google-create-mtg');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'event-123',
        htmlLink: 'https://calendar.google.com/event?eid=xxx',
      }));

      const tool = createGoogleMeetingTool(connector);
      const result = await tool.execute({
        summary: 'Sprint Review',
        startDateTime: '2025-01-15T14:00:00',
        endDateTime: '2025-01-15T15:00:00',
        attendees: ['alice@example.com', 'bob@example.com'],
        timeZone: 'America/New_York',
      });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-123');
      expect(result.htmlLink).toContain('calendar.google.com');

      // Verify request body
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body.summary).toBe('Sprint Review');
      expect(body.start.dateTime).toBe('2025-01-15T14:00:00');
      expect(body.start.timeZone).toBe('America/New_York');
      expect(body.attendees).toHaveLength(2);
      fetchSpy.mockRestore();
    });

    it('should create a meeting with Google Meet link', async () => {
      const connector = createMockConnector('google-create-meet');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'event-meet',
        htmlLink: 'https://calendar.google.com/event?eid=yyy',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
      }));

      const tool = createGoogleMeetingTool(connector);
      const result = await tool.execute({
        summary: 'Online Meeting',
        startDateTime: '2025-01-15T14:00:00',
        endDateTime: '2025-01-15T15:00:00',
        attendees: ['alice@example.com'],
        isOnlineMeeting: true,
      });

      expect(result.success).toBe(true);
      expect(result.meetLink).toBe('https://meet.google.com/abc-defg-hij');

      // Verify conferenceData was sent
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body.conferenceData).toBeDefined();
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');

      // Verify conferenceDataVersion query param
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('conferenceDataVersion=1');
      fetchSpy.mockRestore();
    });

    it('should use UTC as default timezone', async () => {
      const connector = createMockConnector('google-create-tz');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'event-tz' }));

      const tool = createGoogleMeetingTool(connector);
      await tool.execute({
        summary: 'Test',
        startDateTime: '2025-01-15T14:00:00',
        endDateTime: '2025-01-15T15:00:00',
        attendees: ['alice@example.com'],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body.start.timeZone).toBe('UTC');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // edit_meeting
  // ========================================================================

  describe('edit_meeting', () => {
    it('should update only provided fields', async () => {
      const connector = createMockConnector('google-edit-mtg');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'event-123',
        htmlLink: 'https://calendar.google.com/event?eid=xxx',
      }));

      const tool = createGoogleEditMeetingTool(connector);
      const result = await tool.execute({
        eventId: 'event-123',
        summary: 'Updated Title',
      });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-123');

      // Verify PATCH method and only summary in body
      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(opts?.method).toBe('PATCH');
      const body = JSON.parse(opts?.body as string);
      expect(body.summary).toBe('Updated Title');
      expect(body.start).toBeUndefined();
      expect(body.end).toBeUndefined();
      expect(body.attendees).toBeUndefined();
      fetchSpy.mockRestore();
    });

    it('should replace attendees list entirely', async () => {
      const connector = createMockConnector('google-edit-att');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'event-123' }));

      const tool = createGoogleEditMeetingTool(connector);
      await tool.execute({
        eventId: 'event-123',
        attendees: ['new@example.com'],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body.attendees).toEqual([{ email: 'new@example.com' }]);
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // list_meetings
  // ========================================================================

  describe('list_meetings', () => {
    it('should list calendar events', async () => {
      const connector = createMockConnector('google-list-mtg');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        items: [
          {
            id: 'event-1',
            summary: 'Sprint Review',
            start: { dateTime: '2025-01-15T14:00:00-05:00', timeZone: 'America/New_York' },
            end: { dateTime: '2025-01-15T15:00:00-05:00', timeZone: 'America/New_York' },
            organizer: { email: 'alice@example.com' },
            attendees: [
              { email: 'alice@example.com' },
              { email: 'bob@example.com' },
              { email: 'room@resource.calendar.google.com', resource: true },
            ],
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          },
          {
            id: 'event-2',
            summary: 'Lunch',
            start: { dateTime: '2025-01-15T12:00:00-05:00' },
            end: { dateTime: '2025-01-15T13:00:00-05:00' },
            status: 'confirmed',
          },
        ],
      }));

      const tool = createGoogleListMeetingsTool(connector);
      const result = await tool.execute({
        startDateTime: '2025-01-15T00:00:00Z',
        endDateTime: '2025-01-16T00:00:00Z',
      });

      expect(result.success).toBe(true);
      expect(result.meetings).toHaveLength(2);
      expect(result.meetings![0]!.summary).toBe('Sprint Review');
      expect(result.meetings![0]!.meetLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(result.meetings![0]!.isOnlineMeeting).toBe(true);
      // Resource attendees should be filtered out
      expect(result.meetings![0]!.attendees).toEqual(['alice@example.com', 'bob@example.com']);
      fetchSpy.mockRestore();
    });

    it('should filter out cancelled events', async () => {
      const connector = createMockConnector('google-list-cancelled');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        items: [
          { id: 'event-1', summary: 'Active', start: { dateTime: '2025-01-15T10:00:00Z' }, end: { dateTime: '2025-01-15T11:00:00Z' } },
          { id: 'event-2', summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2025-01-15T12:00:00Z' }, end: { dateTime: '2025-01-15T13:00:00Z' } },
        ],
      }));

      const tool = createGoogleListMeetingsTool(connector);
      const result = await tool.execute({
        startDateTime: '2025-01-15T00:00:00Z',
        endDateTime: '2025-01-16T00:00:00Z',
      });

      expect(result.meetings).toHaveLength(1);
      expect(result.meetings![0]!.summary).toBe('Active');
      fetchSpy.mockRestore();
    });

    it('should pass query params correctly', async () => {
      const connector = createMockConnector('google-list-params');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ items: [] }));

      const tool = createGoogleListMeetingsTool(connector);
      await tool.execute({
        startDateTime: '2025-01-15T00:00:00Z',
        endDateTime: '2025-01-16T00:00:00Z',
        timeZone: 'Europe/London',
        maxResults: 10,
      });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('timeMin=');
      expect(calledUrl).toContain('timeMax=');
      expect(calledUrl).toContain('timeZone=Europe%2FLondon');
      expect(calledUrl).toContain('maxResults=10');
      expect(calledUrl).toContain('singleEvents=true');
      expect(calledUrl).toContain('orderBy=startTime');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // get_meeting
  // ========================================================================

  describe('get_meeting', () => {
    it('should get meeting details', async () => {
      const connector = createMockConnector('google-get-mtg');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'event-123',
        summary: 'Team Standup',
        description: '<p>Daily <b>standup</b> meeting</p>',
        start: { dateTime: '2025-01-15T09:00:00-05:00', timeZone: 'America/New_York' },
        end: { dateTime: '2025-01-15T09:15:00-05:00', timeZone: 'America/New_York' },
        organizer: { email: 'alice@example.com', displayName: 'Alice' },
        attendees: [
          { email: 'alice@example.com' },
          { email: 'bob@example.com' },
        ],
        location: 'Room 42',
        htmlLink: 'https://calendar.google.com/event?eid=xxx',
        hangoutLink: 'https://meet.google.com/xyz',
      }));

      const tool = createGoogleGetMeetingTool(connector);
      const result = await tool.execute({ eventId: 'event-123' });

      expect(result.success).toBe(true);
      expect(result.summary).toBe('Team Standup');
      expect(result.description).toBe('Daily standup meeting');
      expect(result.organizer).toBe('alice@example.com');
      expect(result.attendees).toEqual(['alice@example.com', 'bob@example.com']);
      expect(result.meetLink).toBe('https://meet.google.com/xyz');
      expect(result.location).toBe('Room 42');
      expect(result.isOnlineMeeting).toBe(true);
      fetchSpy.mockRestore();
    });

    it('should return error on not found', async () => {
      const connector = createMockConnector('google-get-mtg-404');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ error: { message: 'Not Found' } }, 404));

      const tool = createGoogleGetMeetingTool(connector);
      const result = await tool.execute({ eventId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get meeting');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // find_meeting_slots
  // ========================================================================

  describe('find_meeting_slots', () => {
    it('should find free slots when attendees are available', async () => {
      const connector = createMockConnector('google-find-slots');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        kind: 'calendar#freeBusy',
        timeMin: '2025-01-15T08:00:00Z',
        timeMax: '2025-01-15T18:00:00Z',
        calendars: {
          'alice@example.com': {
            busy: [
              { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
            ],
          },
          'bob@example.com': {
            busy: [
              { start: '2025-01-15T10:30:00Z', end: '2025-01-15T11:30:00Z' },
            ],
          },
        },
      }));

      const tool = createGoogleFindMeetingSlotsTool(connector);
      const result = await tool.execute({
        attendees: ['alice@example.com', 'bob@example.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T18:00:00Z',
        duration: 30,
        maxResults: 3,
      });

      expect(result.success).toBe(true);
      expect(result.slots).toBeDefined();
      expect(result.slots!.length).toBeGreaterThan(0);
      expect(result.slots!.length).toBeLessThanOrEqual(3);

      // First slot should be at 08:00 (before any busy time)
      const firstSlot = result.slots![0]!;
      expect(firstSlot.start).toContain('2025-01-15T08:00:00');
      expect(firstSlot.confidence).toBe('100');
      expect(firstSlot.attendeeAvailability).toHaveLength(2);
      expect(firstSlot.attendeeAvailability[0]!.availability).toBe('free');
      expect(firstSlot.attendeeAvailability[1]!.availability).toBe('free');
      fetchSpy.mockRestore();
    });

    it('should return empty suggestions when all slots are busy', async () => {
      const connector = createMockConnector('google-find-busy');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        kind: 'calendar#freeBusy',
        timeMin: '2025-01-15T10:00:00Z',
        timeMax: '2025-01-15T11:00:00Z',
        calendars: {
          'alice@example.com': {
            busy: [
              { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
            ],
          },
        },
      }));

      const tool = createGoogleFindMeetingSlotsTool(connector);
      const result = await tool.execute({
        attendees: ['alice@example.com'],
        startDateTime: '2025-01-15T10:00:00Z',
        endDateTime: '2025-01-15T11:00:00Z',
        duration: 60,
      });

      expect(result.success).toBe(true);
      expect(result.slots).toHaveLength(0);
      expect(result.emptySuggestionsReason).toContain('No free slots found');
      fetchSpy.mockRestore();
    });

    it('should report when attendee calendars have errors', async () => {
      const connector = createMockConnector('google-find-err');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        kind: 'calendar#freeBusy',
        timeMin: '2025-01-15T08:00:00Z',
        timeMax: '2025-01-15T18:00:00Z',
        calendars: {
          'alice@example.com': {
            busy: [],
          },
          'external@other.com': {
            busy: [],
            errors: [{ domain: 'calendar', reason: 'notFound' }],
          },
        },
      }));

      const tool = createGoogleFindMeetingSlotsTool(connector);
      const result = await tool.execute({
        attendees: ['alice@example.com', 'external@other.com'],
        // Use a very short window so we can predict the slots
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T08:30:00Z',
        duration: 30,
      });

      expect(result.success).toBe(true);
      // Should still find slots (error attendee treated as free)
      expect(result.slots!.length).toBeGreaterThanOrEqual(1);
      fetchSpy.mockRestore();
    });

    it('should match find_meeting_slots API format exactly', async () => {
      const connector = createMockConnector('google-find-api');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        kind: 'calendar#freeBusy',
        timeMin: '2025-01-15T08:00:00Z',
        timeMax: '2025-01-15T09:00:00Z',
        calendars: {
          'alice@example.com': { busy: [] },
        },
      }));

      const tool = createGoogleFindMeetingSlotsTool(connector);
      const result = await tool.execute({
        attendees: ['alice@example.com'],
        startDateTime: '2025-01-15T08:00:00Z',
        endDateTime: '2025-01-15T09:00:00Z',
        duration: 30,
      });

      // Verify the result matches MicrosoftFindSlotsResult shape
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('slots');
      // Optional: emptySuggestionsReason only present when no slots

      const slot = result.slots![0]!;
      expect(slot).toHaveProperty('start');
      expect(slot).toHaveProperty('end');
      expect(slot).toHaveProperty('confidence');
      expect(slot).toHaveProperty('attendeeAvailability');
      expect(slot.attendeeAvailability[0]).toHaveProperty('attendee');
      expect(slot.attendeeAvailability[0]).toHaveProperty('availability');
      fetchSpy.mockRestore();
    });

    it('should send correct request to freeBusy API', async () => {
      const connector = createMockConnector('google-find-req');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        kind: 'calendar#freeBusy',
        timeMin: '2025-01-15T08:00:00Z',
        timeMax: '2025-01-15T18:00:00Z',
        calendars: { 'alice@example.com': { busy: [] } },
      }));

      const tool = createGoogleFindMeetingSlotsTool(connector);
      await tool.execute({
        attendees: ['alice@example.com'],
        startDateTime: '2025-01-15T08:00:00',
        endDateTime: '2025-01-15T18:00:00',
        duration: 60,
        timeZone: 'America/New_York',
      });

      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toContain('/calendar/v3/freeBusy');
      expect(opts?.method).toBe('POST');

      const body = JSON.parse(opts?.body as string);
      expect(body.timeZone).toBe('America/New_York');
      expect(body.items).toEqual([{ id: 'alice@example.com' }]);
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // get_meeting_transcript
  // ========================================================================

  describe('get_meeting_transcript', () => {
    it('should find transcript by meeting title and return text', async () => {
      const connector = createMockConnector('google-transcript');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // Search for transcript doc
      fetchSpy.mockResolvedValueOnce(mockResponse({
        files: [
          { id: 'doc-123', name: 'Meeting transcript - Sprint Review (2025-01-15)', modifiedTime: '2025-01-15T16:00:00Z' },
        ],
      }));

      // Export as plain text
      fetchSpy.mockResolvedValueOnce(mockResponse('Speaker 1: Hello everyone\nSpeaker 2: Hi there'));

      const tool = createGoogleGetMeetingTranscriptTool(connector);
      const result = await tool.execute({ meetingTitle: 'Sprint Review' });

      expect(result.success).toBe(true);
      expect(result.transcript).toContain('Speaker 1: Hello everyone');
      expect(result.meetingTitle).toContain('Sprint Review');
      fetchSpy.mockRestore();
    });

    it('should read transcript directly by fileId', async () => {
      const connector = createMockConnector('google-transcript-id');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // Export only (no search needed)
      fetchSpy.mockResolvedValueOnce(mockResponse('Transcript content here'));

      const tool = createGoogleGetMeetingTranscriptTool(connector);
      const result = await tool.execute({ fileId: 'doc-456' });

      expect(result.success).toBe(true);
      expect(result.transcript).toBe('Transcript content here');

      // Should only have made 1 call (no search)
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/drive/v3/files/doc-456/export');
      fetchSpy.mockRestore();
    });

    it('should return error when no transcript found', async () => {
      const connector = createMockConnector('google-transcript-none');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleGetMeetingTranscriptTool(connector);
      const result = await tool.execute({ meetingTitle: 'Nonexistent Meeting' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No transcript found');
      fetchSpy.mockRestore();
    });

    it('should require at least one identifier', async () => {
      const connector = createMockConnector('google-transcript-empty');
      const tool = createGoogleGetMeetingTranscriptTool(connector);
      const result = await tool.execute({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one of');
    });
  });

  // ========================================================================
  // read_file
  // ========================================================================

  describe('read_file', () => {
    it('should read a Google Doc by exporting as plain text', async () => {
      const connector = createMockConnector('google-read-doc');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // Get metadata
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'doc-123',
        name: 'My Document',
        mimeType: 'application/vnd.google-apps.document',
        webViewLink: 'https://docs.google.com/document/d/doc-123/edit',
      }));

      // Export as text
      fetchSpy.mockResolvedValueOnce(mockResponse('Hello, this is the document content.'));

      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: 'doc-123' });

      expect(result.success).toBe(true);
      expect(result.filename).toBe('My Document');
      expect(result.mimeType).toBe('application/vnd.google-apps.document');
      expect(result.markdown).toContain('Hello, this is the document content.');
      expect(result.webUrl).toContain('docs.google.com');
      fetchSpy.mockRestore();
    });

    it('should read a Google Sheet by exporting as xlsx', async () => {
      const connector = createMockConnector('google-read-sheet');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // Get metadata
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'sheet-123',
        name: 'Budget Sheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
      }));

      // Export as xlsx — returns binary, but our mock returns text, which is fine for testing the flow
      // The actual DocumentReader.read call would be tested separately
      const xlsxBuffer = Buffer.from('mock xlsx content');
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve(''),
        arrayBuffer: () => Promise.resolve(xlsxBuffer.buffer.slice(xlsxBuffer.byteOffset, xlsxBuffer.byteOffset + xlsxBuffer.byteLength)),
      } as unknown as Response);

      const tool = createGoogleReadFileTool(connector);
      // The read will fail because the mock xlsx is not valid, but we can verify the flow
      const result = await tool.execute({ fileId: 'sheet-123' });

      // The conversion will fail since we mock invalid xlsx, but verify it attempted export
      const exportUrl = fetchSpy.mock.calls[1]![0] as string;
      expect(exportUrl).toContain('/drive/v3/files/sheet-123/export');
      expect(exportUrl).toContain('spreadsheetml.sheet');
      fetchSpy.mockRestore();
    });

    it('should read an uploaded PDF via alt=media', async () => {
      const connector = createMockConnector('google-read-pdf');
      const fetchSpy = vi.spyOn(connector, 'fetch');

      // Get metadata
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'pdf-123',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: '1024',
        webViewLink: 'https://drive.google.com/file/d/pdf-123/view',
      }));

      // Download binary content — mock response
      const pdfBuffer = Buffer.from('mock pdf content');
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => Promise.resolve(''),
        arrayBuffer: () => Promise.resolve(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength)),
      } as unknown as Response);

      const tool = createGoogleReadFileTool(connector);
      // Will fail conversion since it's not a real PDF, but we verify the flow
      const result = await tool.execute({ fileId: 'pdf-123' });

      // Verify alt=media download was used
      const downloadUrl = fetchSpy.mock.calls[1]![0] as string;
      expect(downloadUrl).toContain('/drive/v3/files/pdf-123');
      expect(downloadUrl).toContain('alt=media');
      fetchSpy.mockRestore();
    });

    it('should reject empty fileId', async () => {
      const connector = createMockConnector('google-read-empty');
      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('fileId');
    });

    it('should reject trashed files', async () => {
      const connector = createMockConnector('google-read-trashed');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'trashed-123',
        name: 'Deleted.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        trashed: true,
      }));

      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: 'trashed-123' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('trash');
      fetchSpy.mockRestore();
    });

    it('should reject unsupported file extensions', async () => {
      const connector = createMockConnector('google-read-unsupported');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'exe-123',
        name: 'program.exe',
        mimeType: 'application/x-msdownload',
        size: '1024',
      }));

      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: 'exe-123' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
      fetchSpy.mockRestore();
    });

    it('should reject files exceeding size limit', async () => {
      const connector = createMockConnector('google-read-large');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'large-123',
        name: 'huge.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: String(100 * 1024 * 1024), // 100 MB
      }));

      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: 'large-123' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds');
      fetchSpy.mockRestore();
    });

    it('should handle 404 errors', async () => {
      const connector = createMockConnector('google-read-404');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ error: { message: 'File not found' } }, 404));

      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      fetchSpy.mockRestore();
    });

    it('should handle unsupported Google native formats', async () => {
      const connector = createMockConnector('google-read-form');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        id: 'form-123',
        name: 'Survey',
        mimeType: 'application/vnd.google-apps.form',
      }));

      const tool = createGoogleReadFileTool(connector);
      const result = await tool.execute({ fileId: 'form-123' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // list_files
  // ========================================================================

  describe('list_files', () => {
    it('should list files in root', async () => {
      const connector = createMockConnector('google-list-files');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        files: [
          {
            id: 'folder-1',
            name: 'Documents',
            mimeType: 'application/vnd.google-apps.folder',
            modifiedTime: '2025-01-15T10:00:00Z',
            webViewLink: 'https://drive.google.com/drive/folders/folder-1',
          },
          {
            id: 'file-1',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            size: '2048',
            modifiedTime: '2025-01-14T10:00:00Z',
            webViewLink: 'https://drive.google.com/file/d/file-1/view',
          },
        ],
      }));

      const tool = createGoogleListFilesTool(connector);
      const result = await tool.execute({});

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items![0]!.name).toBe('Documents');
      expect(result.items![0]!.type).toBe('folder');
      expect(result.items![1]!.name).toBe('report.pdf');
      expect(result.items![1]!.type).toBe('file');
      expect(result.items![1]!.sizeFormatted).toBe('2.0 KB');

      // Verify root query (quotes are URL-encoded as %27)
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('%27root%27+in+parents');
      fetchSpy.mockRestore();
    });

    it('should list files in a specific folder', async () => {
      const connector = createMockConnector('google-list-folder');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleListFilesTool(connector);
      await tool.execute({ folderId: 'folder-ABC' });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('%27folder-ABC%27+in+parents');
      fetchSpy.mockRestore();
    });

    it('should filter by name when search is provided', async () => {
      const connector = createMockConnector('google-list-search');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleListFilesTool(connector);
      await tool.execute({ search: 'quarterly report' });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('name+contains');
      expect(calledUrl).toContain('quarterly+report');
      // Should NOT restrict to root when searching
      expect(calledUrl).not.toContain('%27root%27+in+parents');
      fetchSpy.mockRestore();
    });

    it('should strip single quotes from search to avoid query injection', async () => {
      const connector = createMockConnector('google-list-quote');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleListFilesTool(connector);
      await tool.execute({ search: "O'Reilly books" });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      // Single quote should be stripped, not backslash-escaped
      expect(calledUrl).toContain('OReilly+books');
      expect(calledUrl).not.toContain('\\');
      fetchSpy.mockRestore();
    });

    it('should respect limit parameter', async () => {
      const connector = createMockConnector('google-list-limit');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleListFilesTool(connector);
      await tool.execute({ limit: 10 });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('pageSize=10');
      fetchSpy.mockRestore();
    });

    it('should report hasMore when nextPageToken exists', async () => {
      const connector = createMockConnector('google-list-more');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        files: [{ id: 'f1', name: 'file1.txt', mimeType: 'text/plain' }],
        nextPageToken: 'abc123',
      }));

      const tool = createGoogleListFilesTool(connector);
      const result = await tool.execute({});

      expect(result.hasMore).toBe(true);
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // search_files
  // ========================================================================

  describe('search_files', () => {
    it('should search files by query', async () => {
      const connector = createMockConnector('google-search');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({
        files: [
          {
            id: 'file-found',
            name: 'Q4 Report.pdf',
            mimeType: 'application/pdf',
            size: '5120',
            modifiedTime: '2025-01-10T10:00:00Z',
            webViewLink: 'https://drive.google.com/file/d/file-found/view',
          },
        ],
      }));

      const tool = createGoogleSearchFilesTool(connector);
      const result = await tool.execute({ query: 'Q4 report' });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results![0]!.name).toBe('Q4 Report.pdf');
      expect(result.results![0]!.id).toBe('file-found');
      expect(result.results![0]!.sizeFormatted).toBe('5.0 KB');

      // Verify fullText search query
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('fullText+contains');
      fetchSpy.mockRestore();
    });

    it('should filter by file types', async () => {
      const connector = createMockConnector('google-search-types');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleSearchFilesTool(connector);
      await tool.execute({ query: 'budget', fileTypes: ['sheet', 'xlsx'] });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('mimeType');
      fetchSpy.mockRestore();
    });

    it('should restrict to folder when folderId provided', async () => {
      const connector = createMockConnector('google-search-folder');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleSearchFilesTool(connector);
      await tool.execute({ query: 'notes', folderId: 'folder-ABC' });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('%27folder-ABC%27+in+parents');
      fetchSpy.mockRestore();
    });

    it('should use default limit of 20', async () => {
      const connector = createMockConnector('google-search-limit');
      const fetchSpy = vi.spyOn(connector, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockResponse({ files: [] }));

      const tool = createGoogleSearchFilesTool(connector);
      await tool.execute({ query: 'test' });

      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('pageSize=20');
      fetchSpy.mockRestore();
    });
  });

  // ========================================================================
  // describeCall
  // ========================================================================

  describe('describeCall', () => {
    it('should describe draft email call', () => {
      const connector = createMockConnector('google-desc1');
      const tool = createGoogleDraftEmailTool(connector);
      expect(tool.describeCall!({ to: ['alice@example.com'], subject: 'Test', body: 'Hi' })).toBe('Draft email to alice@example.com');
    });

    it('should describe send email call', () => {
      const connector = createMockConnector('google-desc2');
      const tool = createGoogleSendEmailTool(connector);
      expect(tool.describeCall!({ to: ['alice@example.com'], subject: 'Test', body: 'Hi' })).toBe('Send email to alice@example.com');
    });

    it('should describe reply call', () => {
      const connector = createMockConnector('google-desc3');
      const tool = createGoogleSendEmailTool(connector);
      expect(tool.describeCall!({ to: ['alice@example.com'], subject: 'Re: Test', body: 'Reply', replyToMessageId: 'msg1' })).toBe('Reply to alice@example.com');
    });

    it('should describe reply all call', () => {
      const connector = createMockConnector('google-desc4');
      const tool = createGoogleSendEmailTool(connector);
      expect(tool.describeCall!({ to: ['alice@example.com'], subject: 'Re: Test', body: 'Reply', replyToMessageId: 'msg1', replyAll: true })).toBe('Reply all to alice@example.com');
    });

    it('should describe find slots call', () => {
      const connector = createMockConnector('google-desc5');
      const tool = createGoogleFindMeetingSlotsTool(connector);
      expect(tool.describeCall!({ attendees: ['a@x.com', 'b@x.com'], startDateTime: '', endDateTime: '', duration: 30 })).toBe('Find 30min slots for 2 attendees');
    });

    it('should describe search files call', () => {
      const connector = createMockConnector('google-desc6');
      const tool = createGoogleSearchFilesTool(connector);
      expect(tool.describeCall!({ query: 'budget report' })).toBe('Search Drive: "budget report"');
    });
  });
});
