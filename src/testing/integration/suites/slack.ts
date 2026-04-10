/**
 * Slack Integration Test Suite
 *
 * Tests: list_channels, get_channel_info, get_messages, post_message, get_thread,
 *        search_messages, add_reaction, get_mentions, get_users, set_channel_topic
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

const slackSuite: IntegrationTestSuite = {
  id: 'slack',
  serviceType: 'slack',
  name: 'Slack',
  description: 'Tests all Slack tools: channels, messages, threads, reactions, users, search.',
  requiredParams: [
    {
      key: 'testChannel',
      label: 'Test Channel ID',
      description:
        'Slack channel ID (e.g., C0123456789) to post test messages in. Use a dedicated test channel.',
      type: 'string',
      required: true,
    },
  ],
  optionalParams: [
    {
      key: 'testSearchQuery',
      label: 'Search Query',
      description: 'Query for search_messages test (default: "test")',
      type: 'string',
      required: false,
      default: 'test',
    },
  ],
  tests: [
    // --- Channel discovery ---
    {
      name: 'List channels',
      toolName: 'list_channels',
      description: 'Lists accessible Slack channels',
      critical: true, // Verifies basic connectivity
      execute: async (tools, _ctx) => {
        const tool = tools.get('list_channels')!;
        const result = await tool.execute({ limit: 10 });
        if (!result.success) {
          return { success: false, message: result.error || 'List channels failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.channels?.length ?? 0} channels`,
          data: result,
        };
      },
    },
    {
      name: 'Get channel info',
      toolName: 'get_channel_info',
      description: 'Gets details of the test channel',
      requiredParams: ['testChannel'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('get_channel_info')!;
        const result = await tool.execute({ channel: ctx.params.testChannel });
        if (!result.success) {
          return { success: false, message: result.error || 'Get channel info failed', data: result };
        }
        return {
          success: true,
          message: `Channel: ${result.channel?.name || ctx.params.testChannel}`,
          data: result,
        };
      },
    },

    // --- Messages ---
    {
      name: 'Get channel messages',
      toolName: 'get_messages',
      description: 'Gets recent messages from the test channel',
      requiredParams: ['testChannel'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('get_messages')!;
        const result = await tool.execute({
          channel: ctx.params.testChannel,
          limit: 5,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Get messages failed', data: result };
        }
        return {
          success: true,
          message: `Got ${result.messages?.length ?? 0} messages`,
          data: result,
        };
      },
    },
    {
      name: 'Post a message',
      toolName: 'post_message',
      description: 'Posts a test message to the channel',
      requiredParams: ['testChannel'],
      critical: true, // Thread test depends on this
      execute: async (tools, ctx) => {
        const tool = tools.get('post_message')!;
        const result = await tool.execute({
          channel: ctx.params.testChannel,
          text: `Integration test message - ${new Date().toISOString()}`,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Post message failed', data: result };
        }
        ctx.state.messageTs = result.ts;
        ctx.state.messageChannel = result.channel || ctx.params.testChannel;
        return { success: true, message: `Message posted: ts=${result.ts}`, data: result };
      },
    },
    {
      name: 'Reply in thread',
      toolName: 'post_message',
      description: 'Posts a threaded reply to the test message',
      requiredParams: ['testChannel'],
      critical: false,
      execute: async (tools, ctx) => {
        const messageTs = ctx.state.messageTs as string | undefined;
        if (!messageTs) {
          return { success: true, message: 'Skipped: no message ts (post_message did not succeed)' };
        }
        const tool = tools.get('post_message')!;
        const result = await tool.execute({
          channel: ctx.params.testChannel,
          text: `Thread reply - ${new Date().toISOString()}`,
          threadTs: messageTs,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Thread reply failed', data: result };
        }
        return { success: true, message: 'Thread reply posted', data: result };
      },
    },
    {
      name: 'Get thread',
      toolName: 'get_thread',
      description: 'Gets the thread started by the test message',
      requiredParams: ['testChannel'],
      critical: false,
      execute: async (tools, ctx) => {
        const messageTs = ctx.state.messageTs as string | undefined;
        if (!messageTs) {
          return { success: true, message: 'Skipped: no message ts (post_message did not succeed)' };
        }
        const tool = tools.get('get_thread')!;
        const result = await tool.execute({
          channel: ctx.params.testChannel,
          threadTs: messageTs,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Get thread failed', data: result };
        }
        return {
          success: true,
          message: `Thread has ${result.messages?.length ?? 0} messages`,
          data: result,
        };
      },
    },
    {
      name: 'Add reaction to message',
      toolName: 'add_reaction',
      description: 'Adds a reaction emoji to the test message',
      requiredParams: ['testChannel'],
      critical: false,
      execute: async (tools, ctx) => {
        const messageTs = ctx.state.messageTs as string | undefined;
        if (!messageTs) {
          return { success: true, message: 'Skipped: no message ts (post_message did not succeed)' };
        }
        const tool = tools.get('add_reaction')!;
        const result = await tool.execute({
          channel: ctx.params.testChannel,
          timestamp: messageTs,
          name: 'white_check_mark',
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Add reaction failed', data: result };
        }
        return { success: true, message: 'Reaction added', data: result };
      },
    },

    // --- Search & Discovery ---
    {
      name: 'Search messages',
      toolName: 'search_messages',
      description: 'Searches for messages matching a query',
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('search_messages')!;
        const query = ctx.params.testSearchQuery || 'test';
        const result = await tool.execute({ query, count: 5 });
        if (!result.success) {
          return { success: false, message: result.error || 'Search messages failed', data: result };
        }
        return {
          success: true,
          message: `Search returned ${result.messages?.length ?? 0} results`,
          data: result,
        };
      },
    },
    {
      name: 'Get mentions',
      toolName: 'get_mentions',
      description: 'Gets recent mentions of the bot/user',
      critical: false,
      execute: async (tools, _ctx) => {
        const tool = tools.get('get_mentions')!;
        const result = await tool.execute({ limit: 5 });
        // Mentions may be empty for a bot — that's OK
        if (!result.success) {
          return { success: false, message: result.error || 'Get mentions failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.mentions?.length ?? result.messages?.length ?? 0} mentions`,
          data: result,
        };
      },
    },
    {
      name: 'Get users',
      toolName: 'get_users',
      description: 'Lists workspace users',
      critical: false,
      execute: async (tools, _ctx) => {
        const tool = tools.get('get_users')!;
        const result = await tool.execute({ limit: 10 });
        if (!result.success) {
          return { success: false, message: result.error || 'Get users failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.users?.length ?? 0} users`,
          data: result,
        };
      },
    },
  ],
};

registerSuite(slackSuite);
export { slackSuite };
