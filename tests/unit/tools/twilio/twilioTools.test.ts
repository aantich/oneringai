/**
 * Tests for Twilio Connector Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import {
  normalizePhoneNumber,
  toWhatsAppNumber,
  getAccountSid,
  formatMessage,
  TwilioAPIError,
  TwilioConfigError,
} from '../../../../src/tools/twilio/types.js';
import { createSendSMSTool } from '../../../../src/tools/twilio/sendSMS.js';
import { createSendWhatsAppTool } from '../../../../src/tools/twilio/sendWhatsApp.js';
import { createListMessagesTool } from '../../../../src/tools/twilio/listMessages.js';
import { createGetMessageTool } from '../../../../src/tools/twilio/getMessage.js';

// Import to trigger side-effect registration
import '../../../../src/tools/twilio/index.js';

/**
 * Create a mock Twilio connector with Account SID in auth.extra
 */
function createMockConnector(name: string, options?: Record<string, unknown>): Connector {
  const connector = Connector.create({
    name,
    serviceType: 'twilio',
    auth: {
      type: 'api_key',
      apiKey: 'dGVzdC1zaWQ6dGVzdC10b2tlbg==', // base64 of test-sid:test-token
      headerName: 'Authorization',
      headerPrefix: 'Basic',
      extra: { accountId: 'AC_TEST_ACCOUNT_SID' },
    },
    baseURL: 'https://api.twilio.com/2010-04-01',
    options,
  });
  return connector;
}

/**
 * Create a mock Twilio API response (standard HTTP status codes)
 */
function mockTwilioResponse(data: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

/**
 * Create a mock Twilio error response
 */
function mockTwilioError(status: number, code: number, message: string): Response {
  return mockTwilioResponse({ code, message, status }, status);
}

/** Sample raw message from Twilio API */
const SAMPLE_RAW_SMS = {
  sid: 'SM_TEST_123',
  from: '+15551234567',
  to: '+15559876543',
  body: 'Hello from test',
  status: 'delivered',
  direction: 'outbound-api',
  date_sent: '2026-03-15T12:00:00Z',
  date_created: '2026-03-15T12:00:00Z',
  price: '-0.0075',
  price_unit: 'USD',
  num_segments: '1',
  error_code: null,
  error_message: null,
  uri: '/2010-04-01/Accounts/AC_TEST/Messages/SM_TEST_123.json',
};

const SAMPLE_RAW_WHATSAPP = {
  ...SAMPLE_RAW_SMS,
  sid: 'SM_WA_TEST_456',
  from: 'whatsapp:+15551234567',
  to: 'whatsapp:+15559876543',
  body: 'WhatsApp message',
};

describe('Twilio Tools', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  // ========================================================================
  // Phone Number Helpers
  // ========================================================================

  describe('normalizePhoneNumber', () => {
    it('should pass through numbers starting with +', () => {
      expect(normalizePhoneNumber('+15551234567')).toBe('+15551234567');
    });

    it('should add + prefix to bare numbers', () => {
      expect(normalizePhoneNumber('15551234567')).toBe('+15551234567');
    });

    it('should trim whitespace', () => {
      expect(normalizePhoneNumber('  +15551234567  ')).toBe('+15551234567');
    });

    it('should pass through whatsapp: prefixed numbers', () => {
      expect(normalizePhoneNumber('whatsapp:+15551234567')).toBe('whatsapp:+15551234567');
    });
  });

  describe('toWhatsAppNumber', () => {
    it('should add whatsapp: prefix to E.164 number', () => {
      expect(toWhatsAppNumber('+15551234567')).toBe('whatsapp:+15551234567');
    });

    it('should add whatsapp: prefix and normalize bare number', () => {
      expect(toWhatsAppNumber('15551234567')).toBe('whatsapp:+15551234567');
    });

    it('should not double-prefix whatsapp: numbers', () => {
      expect(toWhatsAppNumber('whatsapp:+15551234567')).toBe('whatsapp:+15551234567');
    });
  });

  // ========================================================================
  // Account SID Resolution
  // ========================================================================

  describe('getAccountSid', () => {
    it('should return Account SID from auth.extra', () => {
      const connector = createMockConnector('twilio-sid');
      expect(getAccountSid(connector)).toBe('AC_TEST_ACCOUNT_SID');
    });

    it('should throw TwilioConfigError when accountId is missing', () => {
      const connector = Connector.create({
        name: 'twilio-no-sid',
        serviceType: 'twilio',
        auth: { type: 'api_key', apiKey: 'test' },
        baseURL: 'https://api.twilio.com/2010-04-01',
      });

      expect(() => getAccountSid(connector)).toThrow(TwilioConfigError);
      expect(() => getAccountSid(connector)).toThrow('Account SID not found');
    });
  });

  // ========================================================================
  // formatMessage
  // ========================================================================

  describe('formatMessage', () => {
    it('should format a raw SMS message', () => {
      const formatted = formatMessage(SAMPLE_RAW_SMS);

      expect(formatted.sid).toBe('SM_TEST_123');
      expect(formatted.from).toBe('+15551234567');
      expect(formatted.to).toBe('+15559876543');
      expect(formatted.body).toBe('Hello from test');
      expect(formatted.status).toBe('delivered');
      expect(formatted.direction).toBe('outbound-api');
      expect(formatted.channel).toBe('sms');
      expect(formatted.price).toBe('-0.0075');
      expect(formatted.numSegments).toBe('1');
      expect(formatted.errorCode).toBeNull();
    });

    it('should detect WhatsApp channel from phone prefixes', () => {
      const formatted = formatMessage(SAMPLE_RAW_WHATSAPP);

      expect(formatted.channel).toBe('whatsapp');
      expect(formatted.from).toBe('whatsapp:+15551234567');
    });

    it('should handle message with error', () => {
      const raw = { ...SAMPLE_RAW_SMS, error_code: 30007, error_message: 'Message filtered' };
      const formatted = formatMessage(raw);

      expect(formatted.errorCode).toBe(30007);
      expect(formatted.errorMessage).toBe('Message filtered');
    });
  });

  // ========================================================================
  // Error Classes
  // ========================================================================

  describe('Error Classes', () => {
    it('TwilioAPIError should be instanceOf Error', () => {
      const err = new TwilioAPIError(401, 20003, 'Authentication failed');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TwilioAPIError);
      expect(err.statusCode).toBe(401);
      expect(err.twilioCode).toBe(20003);
      expect(err.twilioMessage).toBe('Authentication failed');
      expect(err.message).toContain('401');
      expect(err.name).toBe('TwilioAPIError');
    });

    it('TwilioConfigError should be instanceOf Error', () => {
      const err = new TwilioConfigError('Missing config');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TwilioConfigError);
      expect(err.message).toBe('Missing config');
      expect(err.name).toBe('TwilioConfigError');
    });
  });

  // ========================================================================
  // Tool Registration
  // ========================================================================

  describe('Tool Registration', () => {
    it('should register twilio service with ConnectorTools', () => {
      expect(ConnectorTools.hasServiceTools('twilio')).toBe(true);
    });

    it('should return 5 tools (4 Twilio + 1 generic API) via ConnectorTools.for()', () => {
      const connector = createMockConnector('my-twilio');
      const tools = ConnectorTools.for(connector);
      expect(tools).toHaveLength(5);
    });

    it('should prefix tool names with connector name', () => {
      const connector = createMockConnector('my-twilio');
      const tools = ConnectorTools.for(connector);
      const names = tools.map((t) => t.definition.function.name);

      expect(names).toContain('my-twilio_api');
      expect(names).toContain('my-twilio_send_sms');
      expect(names).toContain('my-twilio_send_whatsapp');
      expect(names).toContain('my-twilio_list_messages');
      expect(names).toContain('my-twilio_get_message');
    });

    it('should return 4 tools via serviceTools()', () => {
      const connector = createMockConnector('twilio-svc');
      const tools = ConnectorTools.serviceTools(connector);
      expect(tools).toHaveLength(4);
    });
  });

  // ========================================================================
  // Tool Definitions
  // ========================================================================

  describe('Tool Definitions', () => {
    let connector: Connector;

    beforeEach(() => {
      connector = createMockConnector('twilio-def');
    });

    it('send_sms has correct name and requires to + body', () => {
      const tool = createSendSMSTool(connector);
      expect(tool.definition.function.name).toBe('send_sms');
      expect(tool.definition.function.parameters?.required).toEqual(['to', 'body']);
    });

    it('send_whatsapp has correct name and requires to', () => {
      const tool = createSendWhatsAppTool(connector);
      expect(tool.definition.function.name).toBe('send_whatsapp');
      expect(tool.definition.function.parameters?.required).toEqual(['to']);
    });

    it('list_messages has correct name and no required params', () => {
      const tool = createListMessagesTool(connector);
      expect(tool.definition.function.name).toBe('list_messages');
      expect(tool.definition.function.parameters?.required).toEqual([]);
    });

    it('get_message has correct name and requires sid', () => {
      const tool = createGetMessageTool(connector);
      expect(tool.definition.function.name).toBe('get_message');
      expect(tool.definition.function.parameters?.required).toEqual(['sid']);
    });

    it('read-only tools have low risk level', () => {
      const readTools = [
        createListMessagesTool(connector),
        createGetMessageTool(connector),
      ];

      for (const tool of readTools) {
        expect(tool.permission?.riskLevel).toBe('low');
      }
    });

    it('write tools have medium risk level', () => {
      const writeTools = [
        createSendSMSTool(connector),
        createSendWhatsAppTool(connector),
      ];

      for (const tool of writeTools) {
        expect(tool.permission?.riskLevel).toBe('medium');
      }
    });
  });

  // ========================================================================
  // Tool Execution (with mocked fetch)
  // ========================================================================

  describe('Tool Execution', () => {
    let connector: Connector;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      connector = createMockConnector('twilio-exec', {
        defaultFromNumber: '+15550001111',
        defaultWhatsAppNumber: '+15550002222',
      });
      fetchSpy = vi.spyOn(connector, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    // ---- send_sms ----

    describe('send_sms', () => {
      it('should send an SMS message', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_SMS));

        const tool = createSendSMSTool(connector);
        const result = await tool.execute({ to: '+15559876543', body: 'Hello!' });

        expect(result.success).toBe(true);
        expect(result.message?.sid).toBe('SM_TEST_123');
        expect(result.message?.channel).toBe('sms');

        // Verify the fetch was called with correct URL and form-encoded body
        const [url, options] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('/Accounts/AC_TEST_ACCOUNT_SID/Messages.json');
        expect(options?.method).toBe('POST');
        expect(options?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });

        const body = new URLSearchParams(options?.body as string);
        expect(body.get('To')).toBe('+15559876543');
        expect(body.get('From')).toBe('+15550001111');
        expect(body.get('Body')).toBe('Hello!');
      });

      it('should use explicit from number over default', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_SMS));

        const tool = createSendSMSTool(connector);
        await tool.execute({ to: '+15559876543', from: '+15553334444', body: 'Hello!' });

        const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(body.get('From')).toBe('+15553334444');
      });

      it('should normalize bare phone numbers', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_SMS));

        const tool = createSendSMSTool(connector);
        await tool.execute({ to: '15559876543', body: 'Hello!' });

        const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(body.get('To')).toBe('+15559876543');
      });

      it('should include StatusCallback when provided', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_SMS));

        const tool = createSendSMSTool(connector);
        await tool.execute({
          to: '+15559876543',
          body: 'Hello!',
          statusCallback: 'https://example.com/webhook',
        });

        const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(body.get('StatusCallback')).toBe('https://example.com/webhook');
      });

      it('should fail when no from number is configured', async () => {
        const noDefaultConnector = createMockConnector('twilio-no-default');
        const tool = createSendSMSTool(noDefaultConnector);
        const result = await tool.execute({ to: '+15559876543', body: 'Hello!' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('defaultFromNumber');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioError(400, 21211, 'Invalid phone number'));

        const tool = createSendSMSTool(connector);
        const result = await tool.execute({ to: '+1invalid', body: 'Hello!' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid phone number');
      });
    });

    // ---- send_whatsapp ----

    describe('send_whatsapp', () => {
      it('should send a WhatsApp message with whatsapp: prefix', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_WHATSAPP));

        const tool = createSendWhatsAppTool(connector);
        const result = await tool.execute({ to: '+15559876543', body: 'Hello WhatsApp!' });

        expect(result.success).toBe(true);
        expect(result.message?.channel).toBe('whatsapp');

        const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(body.get('To')).toBe('whatsapp:+15559876543');
        expect(body.get('From')).toBe('whatsapp:+15550002222');
        expect(body.get('Body')).toBe('Hello WhatsApp!');
      });

      it('should send a template message with ContentSid', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_WHATSAPP));

        const tool = createSendWhatsAppTool(connector);
        const result = await tool.execute({
          to: '+15559876543',
          contentSid: 'HXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          contentVariables: '{"1":"John"}',
        });

        expect(result.success).toBe(true);

        const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(body.get('ContentSid')).toBe('HXXXXXXXXXXXXXXXXXXXXXXXXXXX');
        expect(body.get('ContentVariables')).toBe('{"1":"John"}');
        expect(body.has('Body')).toBe(false);
      });

      it('should fail when neither body nor contentSid is provided', async () => {
        const tool = createSendWhatsAppTool(connector);
        const result = await tool.execute({ to: '+15559876543' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('body');
        expect(result.error).toContain('contentSid');
      });

      it('should fail when no from WhatsApp number is configured', async () => {
        const noDefaultConnector = createMockConnector('twilio-no-wa-default');
        const tool = createSendWhatsAppTool(noDefaultConnector);
        const result = await tool.execute({ to: '+15559876543', body: 'Hello!' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('defaultWhatsAppNumber');
      });

      it('should use explicit from number with whatsapp: prefix', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_WHATSAPP));

        const tool = createSendWhatsAppTool(connector);
        await tool.execute({ to: '+15559876543', from: '+15557778888', body: 'Hello!' });

        const body = new URLSearchParams(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(body.get('From')).toBe('whatsapp:+15557778888');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioError(400, 63016, 'Template not found'));

        const tool = createSendWhatsAppTool(connector);
        const result = await tool.execute({ to: '+15559876543', contentSid: 'HX_INVALID' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Template not found');
      });
    });

    // ---- list_messages ----

    describe('list_messages', () => {
      it('should list messages with default params', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [SAMPLE_RAW_SMS, SAMPLE_RAW_WHATSAPP],
            first_page_uri: '/Messages.json?Page=0',
            next_page_uri: null,
            previous_page_uri: null,
            page: 0,
            page_size: 50,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.hasMore).toBe(false);
        expect(result.messages?.[0]?.channel).toBe('sms');
        expect(result.messages?.[1]?.channel).toBe('whatsapp');
      });

      it('should pass To and From query params', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [],
            next_page_uri: null,
            page: 0,
            page_size: 50,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        await tool.execute({ to: '+15559876543', from: '+15551234567' });

        const [url] = fetchSpy.mock.calls[0]!;
        const params = new URLSearchParams((url as string).split('?')[1]);
        expect(params.get('To')).toBe('+15559876543');
        expect(params.get('From')).toBe('+15551234567');
      });

      it('should add whatsapp: prefix when channel=whatsapp', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [],
            next_page_uri: null,
            page: 0,
            page_size: 50,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        await tool.execute({ to: '+15559876543', channel: 'whatsapp' });

        const [url] = fetchSpy.mock.calls[0]!;
        const params = new URLSearchParams((url as string).split('?')[1]);
        expect(params.get('To')).toBe('whatsapp:+15559876543');
      });

      it('should pass date filters', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [],
            next_page_uri: null,
            page: 0,
            page_size: 50,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        await tool.execute({ dateSentAfter: '2026-03-01', dateSentBefore: '2026-03-31' });

        const [url] = fetchSpy.mock.calls[0]!;
        const params = new URLSearchParams((url as string).split('?')[1]);
        expect(params.get('DateSent>')).toBe('2026-03-01');
        expect(params.get('DateSent<')).toBe('2026-03-31');
      });

      it('should cap limit at 1000', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [],
            next_page_uri: null,
            page: 0,
            page_size: 1000,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        await tool.execute({ limit: 5000 });

        const [url] = fetchSpy.mock.calls[0]!;
        const params = new URLSearchParams((url as string).split('?')[1]);
        expect(params.get('PageSize')).toBe('1000');
      });

      it('should client-side filter SMS when channel=sms', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [SAMPLE_RAW_SMS, SAMPLE_RAW_WHATSAPP],
            next_page_uri: null,
            page: 0,
            page_size: 50,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        const result = await tool.execute({ channel: 'sms' });

        expect(result.success).toBe(true);
        expect(result.count).toBe(1);
        expect(result.messages?.[0]?.channel).toBe('sms');
      });

      it('should report hasMore when next_page_uri exists', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockTwilioResponse({
            messages: [SAMPLE_RAW_SMS],
            next_page_uri: '/Messages.json?Page=1&PageToken=xxx',
            page: 0,
            page_size: 1,
            uri: '/Messages.json',
          })
        );

        const tool = createListMessagesTool(connector);
        const result = await tool.execute({ limit: 1 });

        expect(result.hasMore).toBe(true);
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioError(401, 20003, 'Authentication failed'));

        const tool = createListMessagesTool(connector);
        const result = await tool.execute({});

        expect(result.success).toBe(false);
        expect(result.error).toContain('Authentication failed');
      });
    });

    // ---- get_message ----

    describe('get_message', () => {
      it('should fetch a single message by SID', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioResponse(SAMPLE_RAW_SMS));

        const tool = createGetMessageTool(connector);
        const result = await tool.execute({ sid: 'SM_TEST_123' });

        expect(result.success).toBe(true);
        expect(result.message?.sid).toBe('SM_TEST_123');
        expect(result.message?.body).toBe('Hello from test');
        expect(result.message?.channel).toBe('sms');

        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('/Accounts/AC_TEST_ACCOUNT_SID/Messages/SM_TEST_123.json');
      });

      it('should handle not found errors', async () => {
        fetchSpy.mockResolvedValueOnce(mockTwilioError(404, 20404, 'Resource not found'));

        const tool = createGetMessageTool(connector);
        const result = await tool.execute({ sid: 'SM_NONEXISTENT' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Resource not found');
      });
    });

    // ---- describeCall ----

    describe('describeCall', () => {
      it('send_sms describes call with preview', () => {
        const tool = createSendSMSTool(connector);
        expect(tool.describeCall?.({ to: '+15551234567', body: 'Hello!' })).toBe(
          'SMS to +15551234567: Hello!'
        );
      });

      it('send_sms truncates long messages', () => {
        const tool = createSendSMSTool(connector);
        const longBody = 'x'.repeat(100);
        const desc = tool.describeCall?.({ to: '+15551234567', body: longBody });
        expect(desc).toContain('...');
        expect(desc!.length).toBeLessThan(100);
      });

      it('send_whatsapp describes freeform message', () => {
        const tool = createSendWhatsAppTool(connector);
        expect(tool.describeCall?.({ to: '+15551234567', body: 'Hello!' })).toBe(
          'WhatsApp to +15551234567: Hello!'
        );
      });

      it('send_whatsapp describes template message', () => {
        const tool = createSendWhatsAppTool(connector);
        expect(
          tool.describeCall?.({ to: '+15551234567', contentSid: 'HX_ABC' })
        ).toBe('WhatsApp template to +15551234567 (HX_ABC)');
      });

      it('list_messages describes call with filters', () => {
        const tool = createListMessagesTool(connector);
        expect(
          tool.describeCall?.({
            to: '+15551234567',
            channel: 'whatsapp',
            dateSentAfter: '2026-03-01',
            limit: 100,
          })
        ).toBe('List messages (whatsapp) to +15551234567 after 2026-03-01 limit=100');
      });

      it('list_messages describes minimal call', () => {
        const tool = createListMessagesTool(connector);
        expect(tool.describeCall?.({})).toBe('List messages');
      });

      it('get_message describes call', () => {
        const tool = createGetMessageTool(connector);
        expect(tool.describeCall?.({ sid: 'SM_TEST_123' })).toBe('Get message SM_TEST_123');
      });
    });
  });
});
