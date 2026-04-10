/**
 * Twilio Integration Test Suite
 *
 * Tests: send_sms, send_whatsapp, list_messages, get_message
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

const twilioSuite: IntegrationTestSuite = {
  id: 'twilio',
  serviceType: 'twilio',
  name: 'Twilio',
  description: 'Tests Twilio tools: SMS, WhatsApp, message history.',
  requiredParams: [
    {
      key: 'testToPhone',
      label: 'Test To Phone',
      description: 'Phone number to send test SMS to (E.164 format, e.g., +15551234567)',
      type: 'string',
      required: true,
    },
    {
      key: 'testFromPhone',
      label: 'Test From Phone',
      description: 'Twilio phone number to send from (E.164 format)',
      type: 'string',
      required: true,
    },
  ],
  optionalParams: [
    {
      key: 'testWhatsAppTo',
      label: 'WhatsApp To',
      description: 'WhatsApp number to test with (E.164, e.g., +15551234567)',
      type: 'string',
      required: false,
    },
    {
      key: 'testWhatsAppFrom',
      label: 'WhatsApp From',
      description: 'Twilio WhatsApp number (E.164)',
      type: 'string',
      required: false,
    },
  ],
  tests: [
    {
      name: 'List messages',
      toolName: 'list_messages',
      description: 'Lists recent messages from Twilio account',
      critical: true, // Verifies basic auth
      execute: async (tools, _ctx) => {
        const tool = tools.get('list_messages')!;
        const result = await tool.execute({ limit: 5 });
        if (!result.success) {
          return { success: false, message: result.error || 'List messages failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.messages?.length ?? 0} messages`,
          data: result,
        };
      },
    },
    {
      name: 'Send SMS',
      toolName: 'send_sms',
      description: 'Sends a test SMS message',
      requiredParams: ['testToPhone', 'testFromPhone'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('send_sms')!;
        const result = await tool.execute({
          to: ctx.params.testToPhone,
          from: ctx.params.testFromPhone,
          body: `Integration test SMS - ${new Date().toISOString()}`,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Send SMS failed', data: result };
        }
        ctx.state.messageSid = result.sid || result.messageSid;
        return { success: true, message: `SMS sent: ${ctx.state.messageSid}`, data: result };
      },
    },
    {
      name: 'Get message details',
      toolName: 'get_message',
      description: 'Gets details of the sent SMS',
      critical: false,
      execute: async (tools, ctx) => {
        const messageSid = ctx.state.messageSid as string | undefined;
        if (!messageSid) {
          return { success: false, message: 'No message SID from send_sms test' };
        }
        const tool = tools.get('get_message')!;
        const result = await tool.execute({ messageSid });
        if (!result.success) {
          return { success: false, message: result.error || 'Get message failed', data: result };
        }
        return {
          success: true,
          message: `Message status: ${result.status || 'retrieved'}`,
          data: result,
        };
      },
    },
    {
      name: 'Send WhatsApp message',
      toolName: 'send_whatsapp',
      description: 'Sends a test WhatsApp message',
      requiredParams: ['testWhatsAppTo', 'testWhatsAppFrom'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('send_whatsapp')!;
        const result = await tool.execute({
          to: ctx.params.testWhatsAppTo,
          from: ctx.params.testWhatsAppFrom,
          body: `Integration test WhatsApp - ${new Date().toISOString()}`,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Send WhatsApp failed', data: result };
        }
        return { success: true, message: 'WhatsApp message sent', data: result };
      },
    },
  ],
};

registerSuite(twilioSuite);
export { twilioSuite };
