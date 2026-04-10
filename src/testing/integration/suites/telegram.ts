/**
 * Telegram Bot Integration Test Suite
 *
 * Tests: telegram_get_me, telegram_get_updates, telegram_send_message, telegram_send_photo,
 *        telegram_get_chat, telegram_set_webhook
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

const telegramSuite: IntegrationTestSuite = {
  id: 'telegram',
  serviceType: 'telegram',
  name: 'Telegram Bot',
  description: 'Tests Telegram Bot API tools: messages, photos, chat info, updates.',
  requiredParams: [
    {
      key: 'testChatId',
      label: 'Test Chat ID',
      description: 'Telegram chat ID to send test messages to (numeric ID or @username)',
      type: 'string',
      required: true,
    },
  ],
  optionalParams: [
    {
      key: 'testPhotoUrl',
      label: 'Test Photo URL',
      description: 'URL of an image to send in photo test',
      type: 'url',
      required: false,
      default: 'https://via.placeholder.com/150',
    },
  ],
  tests: [
    {
      name: 'Get bot info',
      toolName: 'telegram_get_me',
      description: 'Gets information about the bot (verifies token)',
      critical: true,
      execute: async (tools, _ctx) => {
        const tool = tools.get('telegram_get_me')!;
        const result = await tool.execute({});
        if (!result.success) {
          return { success: false, message: result.error || 'getMe failed', data: result };
        }
        return {
          success: true,
          message: `Bot: @${result.username || result.result?.username || 'unknown'}`,
          data: result,
        };
      },
    },
    {
      name: 'Get updates',
      toolName: 'telegram_get_updates',
      description: 'Fetches recent updates (messages sent to the bot)',
      critical: false,
      execute: async (tools, _ctx) => {
        const tool = tools.get('telegram_get_updates')!;
        const result = await tool.execute({ limit: 5 });
        if (!result.success) {
          return { success: false, message: result.error || 'getUpdates failed', data: result };
        }
        return {
          success: true,
          message: `Got ${result.updates?.length ?? result.result?.length ?? 0} updates`,
          data: result,
        };
      },
    },
    {
      name: 'Get chat info',
      toolName: 'telegram_get_chat',
      description: 'Gets information about the test chat',
      requiredParams: ['testChatId'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('telegram_get_chat')!;
        const result = await tool.execute({ chatId: ctx.params.testChatId });
        if (!result.success) {
          return { success: false, message: result.error || 'getChat failed', data: result };
        }
        return {
          success: true,
          message: `Chat: ${result.title || result.result?.title || ctx.params.testChatId}`,
          data: result,
        };
      },
    },
    {
      name: 'Send a text message',
      toolName: 'telegram_send_message',
      description: 'Sends a test text message',
      requiredParams: ['testChatId'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('telegram_send_message')!;
        const result = await tool.execute({
          chatId: ctx.params.testChatId,
          text: `Integration test message - ${new Date().toISOString()}`,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'sendMessage failed', data: result };
        }
        return { success: true, message: 'Message sent', data: result };
      },
    },
    {
      name: 'Send a photo',
      toolName: 'telegram_send_photo',
      description: 'Sends a test photo by URL',
      requiredParams: ['testChatId'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('telegram_send_photo')!;
        const photoUrl = ctx.params.testPhotoUrl || 'https://via.placeholder.com/150';
        const result = await tool.execute({
          chatId: ctx.params.testChatId,
          photo: photoUrl,
          caption: `Integration test photo - ${new Date().toISOString()}`,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'sendPhoto failed', data: result };
        }
        return { success: true, message: 'Photo sent', data: result };
      },
    },
  ],
};

registerSuite(telegramSuite);
export { telegramSuite };
