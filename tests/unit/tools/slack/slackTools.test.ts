/**
 * Tests for Slack Connector Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import {
  toSlackTimestamp,
  fromSlackTimestamp,
  formatMessage,
  SlackAPIError,
} from '../../../../src/tools/slack/types.js';
import { createListChannelsTool } from '../../../../src/tools/slack/listChannels.js';
import { createGetMessagesTool } from '../../../../src/tools/slack/getMessages.js';
import { createPostMessageTool } from '../../../../src/tools/slack/postMessage.js';
import { createGetThreadTool } from '../../../../src/tools/slack/getThread.js';
import { createGetMentionsTool } from '../../../../src/tools/slack/getMentions.js';
import { createSearchMessagesTool } from '../../../../src/tools/slack/searchMessages.js';
import { createAddReactionTool } from '../../../../src/tools/slack/addReaction.js';
import { createGetUsersTool } from '../../../../src/tools/slack/getUsers.js';
import { createGetChannelInfoTool } from '../../../../src/tools/slack/getChannelInfo.js';
import { createSetChannelTopicTool } from '../../../../src/tools/slack/setChannelTopic.js';

// Import to trigger side-effect registration
import '../../../../src/tools/slack/index.js';

/**
 * Create a mock connector for Slack
 */
function createMockConnector(name: string): Connector {
  const connector = Connector.create({
    name,
    serviceType: 'slack',
    auth: { type: 'api_key', apiKey: 'xoxb-test-token' },
    baseURL: 'https://slack.com/api',
  });
  return connector;
}

/**
 * Create a mock Slack API response.
 * Slack always returns HTTP 200 — errors are indicated by the `ok` field.
 */
function mockSlackResponse(data: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

/**
 * Create a mock Slack error response (HTTP 200 with ok: false)
 */
function mockSlackError(error: string): Response {
  return mockSlackResponse({ ok: false, error });
}

describe('Slack Tools', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  // ========================================================================
  // Timestamp Helpers
  // ========================================================================

  describe('toSlackTimestamp', () => {
    it('should pass through Slack timestamps', () => {
      expect(toSlackTimestamp('1234567890.123456')).toBe('1234567890.123456');
    });

    it('should pass through integer timestamps', () => {
      expect(toSlackTimestamp('1234567890')).toBe('1234567890');
    });

    it('should convert ISO 8601 to Slack timestamp', () => {
      const ts = toSlackTimestamp('2025-01-15T12:00:00Z');
      const seconds = parseFloat(ts);
      // Should be a valid unix timestamp for Jan 15, 2025
      expect(seconds).toBeGreaterThan(1736900000);
      expect(seconds).toBeLessThan(1736990000);
    });

    it('should throw on invalid date', () => {
      expect(() => toSlackTimestamp('not-a-date')).toThrow('Invalid date');
    });
  });

  describe('fromSlackTimestamp', () => {
    it('should convert Slack timestamp to ISO string', () => {
      const iso = fromSlackTimestamp('1736942400.000000');
      expect(iso).toMatch(/^2025-01-15T/);
    });
  });

  describe('formatMessage', () => {
    it('should format a raw Slack message', () => {
      const raw = {
        ts: '1736942400.000000',
        user: 'U123',
        text: 'Hello world',
        thread_ts: '1736942300.000000',
        reply_count: 5,
        reactions: [{ name: 'thumbsup', count: 2, users: ['U1', 'U2'] }],
      };

      const formatted = formatMessage(raw);

      expect(formatted.ts).toBe('1736942400.000000');
      expect(formatted.date).toMatch(/^2025/);
      expect(formatted.user).toBe('U123');
      expect(formatted.text).toBe('Hello world');
      expect(formatted.threadTs).toBe('1736942300.000000');
      expect(formatted.replyCount).toBe(5);
      expect(formatted.reactions).toEqual([{ name: 'thumbsup', count: 2 }]);
    });

    it('should handle minimal message', () => {
      const formatted = formatMessage({ ts: '1000000000.000000', text: 'Hi' });
      expect(formatted.user).toBeUndefined();
      expect(formatted.threadTs).toBeUndefined();
      expect(formatted.reactions).toBeUndefined();
    });
  });

  // ========================================================================
  // Tool Registration
  // ========================================================================

  describe('Tool Registration', () => {
    it('should register slack service with ConnectorTools', () => {
      expect(ConnectorTools.hasServiceTools('slack')).toBe(true);
    });

    it('should return 11 tools (10 Slack + 1 generic API) via ConnectorTools.for()', () => {
      const connector = createMockConnector('my-slack');
      const tools = ConnectorTools.for(connector);
      expect(tools).toHaveLength(11);
    });

    it('should prefix tool names with connector name', () => {
      const connector = createMockConnector('my-slack');
      const tools = ConnectorTools.for(connector);
      const names = tools.map((t) => t.definition.function.name);

      expect(names).toContain('my-slack_api');
      expect(names).toContain('my-slack_list_channels');
      expect(names).toContain('my-slack_get_channel_info');
      expect(names).toContain('my-slack_set_channel_topic');
      expect(names).toContain('my-slack_get_messages');
      expect(names).toContain('my-slack_get_thread');
      expect(names).toContain('my-slack_post_message');
      expect(names).toContain('my-slack_search_messages');
      expect(names).toContain('my-slack_get_mentions');
      expect(names).toContain('my-slack_add_reaction');
      expect(names).toContain('my-slack_get_users');
    });

    it('should return 10 tools via serviceTools()', () => {
      const connector = createMockConnector('slack-svc');
      const tools = ConnectorTools.serviceTools(connector);
      expect(tools).toHaveLength(10);
    });
  });

  // ========================================================================
  // Tool Definitions
  // ========================================================================

  describe('Tool Definitions', () => {
    let connector: Connector;

    beforeEach(() => {
      connector = createMockConnector('slack-def');
    });

    it('list_channels has correct name and no required params', () => {
      const tool = createListChannelsTool(connector);
      expect(tool.definition.function.name).toBe('list_channels');
      expect(tool.definition.function.parameters?.required).toEqual([]);
    });

    it('get_messages has correct name and requires channel', () => {
      const tool = createGetMessagesTool(connector);
      expect(tool.definition.function.name).toBe('get_messages');
      expect(tool.definition.function.parameters?.required).toContain('channel');
    });

    it('post_message has correct name and requires channel + text', () => {
      const tool = createPostMessageTool(connector);
      expect(tool.definition.function.name).toBe('post_message');
      expect(tool.definition.function.parameters?.required).toEqual(['channel', 'text']);
    });

    it('get_thread has correct name and requires channel + ts', () => {
      const tool = createGetThreadTool(connector);
      expect(tool.definition.function.name).toBe('get_thread');
      expect(tool.definition.function.parameters?.required).toEqual(['channel', 'ts']);
    });

    it('get_mentions has correct name and no required params', () => {
      const tool = createGetMentionsTool(connector);
      expect(tool.definition.function.name).toBe('get_mentions');
      expect(tool.definition.function.parameters?.required).toEqual([]);
    });

    it('search_messages has correct name and requires query', () => {
      const tool = createSearchMessagesTool(connector);
      expect(tool.definition.function.name).toBe('search_messages');
      expect(tool.definition.function.parameters?.required).toContain('query');
    });

    it('add_reaction has correct name and requires channel + ts + emoji', () => {
      const tool = createAddReactionTool(connector);
      expect(tool.definition.function.name).toBe('add_reaction');
      expect(tool.definition.function.parameters?.required).toEqual(['channel', 'ts', 'emoji']);
    });

    it('get_users has correct name and no required params', () => {
      const tool = createGetUsersTool(connector);
      expect(tool.definition.function.name).toBe('get_users');
      expect(tool.definition.function.parameters?.required).toEqual([]);
    });

    it('get_channel_info has correct name and requires channel', () => {
      const tool = createGetChannelInfoTool(connector);
      expect(tool.definition.function.name).toBe('get_channel_info');
      expect(tool.definition.function.parameters?.required).toContain('channel');
    });

    it('set_channel_topic has correct name and requires channel + topic', () => {
      const tool = createSetChannelTopicTool(connector);
      expect(tool.definition.function.name).toBe('set_channel_topic');
      expect(tool.definition.function.parameters?.required).toEqual(['channel', 'topic']);
    });

    it('read-only tools have low risk level', () => {
      const readTools = [
        createListChannelsTool(connector),
        createGetMessagesTool(connector),
        createGetThreadTool(connector),
        createGetMentionsTool(connector),
        createSearchMessagesTool(connector),
        createAddReactionTool(connector),
        createGetUsersTool(connector),
        createGetChannelInfoTool(connector),
      ];

      for (const tool of readTools) {
        expect(tool.permission?.riskLevel).toBe('low');
      }
    });

    it('write tools have medium risk level', () => {
      const writeTools = [
        createPostMessageTool(connector),
        createSetChannelTopicTool(connector),
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
      connector = createMockConnector('slack-exec');
      fetchSpy = vi.spyOn(connector, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    // ---- list_channels ----

    describe('list_channels', () => {
      it('should list channels from workspace', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            channels: [
              {
                id: 'C001',
                name: 'general',
                topic: { value: 'Company-wide' },
                purpose: { value: 'General discussion' },
                num_members: 50,
                is_archived: false,
                is_private: false,
              },
              {
                id: 'C002',
                name: 'engineering',
                topic: { value: '' },
                num_members: 20,
                is_archived: false,
                is_private: false,
              },
            ],
            response_metadata: {},
          })
        );

        const tool = createListChannelsTool(connector);
        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.channels?.[0]?.id).toBe('C001');
        expect(result.channels?.[0]?.name).toBe('general');
        expect(result.channels?.[0]?.topic).toBe('Company-wide');
        expect(result.channels?.[0]?.memberCount).toBe(50);
        expect(result.channels?.[1]?.name).toBe('engineering');
      });

      it('should pass type filter to API', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, channels: [], response_metadata: {} })
        );

        const tool = createListChannelsTool(connector);
        await tool.execute({ type: 'private' });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.types).toBe('private_channel');
      });

      it('should handle API errors gracefully', async () => {
        fetchSpy.mockResolvedValueOnce(mockSlackError('missing_scope'));

        const tool = createListChannelsTool(connector);
        const result = await tool.execute({});

        expect(result.success).toBe(false);
        expect(result.error).toContain('missing_scope');
      });
    });

    // ---- get_messages ----

    describe('get_messages', () => {
      it('should fetch messages from a channel', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            messages: [
              { ts: '1736942400.000000', user: 'U001', text: 'Hello!' },
              { ts: '1736942300.000000', user: 'U002', text: 'Hi there' },
            ],
            has_more: false,
          })
        );

        const tool = createGetMessagesTool(connector);
        const result = await tool.execute({ channel: 'C001' });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.messages?.[0]?.text).toBe('Hello!');
        expect(result.messages?.[0]?.user).toBe('U001');
        expect(result.messages?.[0]?.date).toMatch(/^2025/);
        expect(result.channel).toBe('C001');
      });

      it('should convert ISO dates to Slack timestamps', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, messages: [], has_more: false })
        );

        const tool = createGetMessagesTool(connector);
        await tool.execute({
          channel: 'C001',
          oldest: '2025-03-01T00:00:00Z',
          latest: '2025-03-15T23:59:59Z',
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.oldest).toMatch(/^\d+\.\d+$/);
        expect(callBody.latest).toMatch(/^\d+\.\d+$/);
      });

      it('should respect limit parameter', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, messages: [], has_more: false })
        );

        const tool = createGetMessagesTool(connector);
        await tool.execute({ channel: 'C001', limit: 10 });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.limit).toBe(10);
      });

      it('should cap limit at 200', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, messages: [], has_more: false })
        );

        const tool = createGetMessagesTool(connector);
        await tool.execute({ channel: 'C001', limit: 500 });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.limit).toBe(200);
      });
    });

    // ---- post_message ----

    describe('post_message', () => {
      it('should post a message to a channel', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            ts: '1736942500.000000',
            channel: 'C001',
          })
        );

        const tool = createPostMessageTool(connector);
        const result = await tool.execute({ channel: 'C001', text: 'Hello team!' });

        expect(result.success).toBe(true);
        expect(result.ts).toBe('1736942500.000000');
        expect(result.channel).toBe('C001');

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.channel).toBe('C001');
        expect(callBody.text).toBe('Hello team!');
      });

      it('should send threaded reply with thread_ts', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, ts: '1736942600.000000', channel: 'C001' })
        );

        const tool = createPostMessageTool(connector);
        await tool.execute({
          channel: 'C001',
          text: 'Reply',
          threadTs: '1736942400.000000',
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.thread_ts).toBe('1736942400.000000');
      });

      it('should support reply_broadcast', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, ts: '1736942600.000000', channel: 'C001' })
        );

        const tool = createPostMessageTool(connector);
        await tool.execute({
          channel: 'C001',
          text: 'Broadcast reply',
          threadTs: '1736942400.000000',
          replyBroadcast: true,
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.reply_broadcast).toBe(true);
      });

      it('should handle unfurl_links=false', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, ts: '1736942600.000000', channel: 'C001' })
        );

        const tool = createPostMessageTool(connector);
        await tool.execute({
          channel: 'C001',
          text: 'Check https://example.com',
          unfurlLinks: false,
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.unfurl_links).toBe(false);
      });
    });

    // ---- get_thread ----

    describe('get_thread', () => {
      it('should return parent and replies', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            messages: [
              { ts: '1736942400.000000', user: 'U001', text: 'Parent message' },
              { ts: '1736942410.000000', user: 'U002', text: 'Reply 1' },
              { ts: '1736942420.000000', user: 'U003', text: 'Reply 2' },
            ],
            has_more: false,
          })
        );

        const tool = createGetThreadTool(connector);
        const result = await tool.execute({ channel: 'C001', ts: '1736942400.000000' });

        expect(result.success).toBe(true);
        expect(result.parentMessage?.text).toBe('Parent message');
        expect(result.count).toBe(2);
        expect(result.messages?.[0]?.text).toBe('Reply 1');
        expect(result.messages?.[1]?.text).toBe('Reply 2');
      });

      it('should pass channel and ts to API', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, messages: [{ ts: '123', text: 'parent' }] })
        );

        const tool = createGetThreadTool(connector);
        await tool.execute({ channel: 'C001', ts: '1736942400.000000' });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.channel).toBe('C001');
        expect(callBody.ts).toBe('1736942400.000000');
      });
    });

    // ---- get_mentions ----

    describe('get_mentions', () => {
      it('should search for self-mentions', async () => {
        // First call: auth.test to get own user ID
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            user_id: 'U_BOT',
            user: 'bot',
            team_id: 'T001',
            team: 'Test Team',
          })
        );

        // Second call: search.messages
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            messages: {
              total: 1,
              matches: [
                {
                  ts: '1736942400.000000',
                  text: 'Hey <@U_BOT> check this',
                  user: 'U001',
                  channel: { id: 'C001', name: 'general' },
                  permalink: 'https://slack.com/archives/C001/p1736942400',
                },
              ],
            },
          })
        );

        const tool = createGetMentionsTool(connector);
        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.count).toBe(1);
        expect(result.messages?.[0]?.text).toContain('<@U_BOT>');
        expect(result.messages?.[0]?.channel?.name).toBe('general');
        expect(result.messages?.[0]?.permalink).toBeDefined();

        // Verify search query includes the bot's user ID
        const searchBody = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
        expect(searchBody.query).toContain('<@U_BOT>');
      });

      it('should filter by channel when provided', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, user_id: 'U_BOT', user: 'bot', team_id: 'T001', team: 'T' })
        );
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, messages: { total: 0, matches: [] } })
        );

        const tool = createGetMentionsTool(connector);
        await tool.execute({ channel: 'C001' });

        const searchBody = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
        expect(searchBody.query).toContain('in:<#C001>');
      });
    });

    // ---- search_messages ----

    describe('search_messages', () => {
      it('should search messages with query', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            messages: {
              total: 2,
              matches: [
                {
                  ts: '1736942400.000000',
                  text: 'deployment plan for Q1',
                  user: 'U001',
                  channel: { id: 'C001', name: 'engineering' },
                },
                {
                  ts: '1736942300.000000',
                  text: 'updated deployment plan',
                  user: 'U002',
                  channel: { id: 'C002', name: 'ops' },
                },
              ],
            },
          })
        );

        const tool = createSearchMessagesTool(connector);
        const result = await tool.execute({ query: 'deployment plan' });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.total).toBe(2);
        expect(result.messages?.[0]?.text).toContain('deployment plan');
      });

      it('should pass sort parameter', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true, messages: { total: 0, matches: [] } })
        );

        const tool = createSearchMessagesTool(connector);
        await tool.execute({ query: 'test', sort: 'score' });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.sort).toBe('score');
      });
    });

    // ---- add_reaction ----

    describe('add_reaction', () => {
      it('should add a reaction to a message', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true })
        );

        const tool = createAddReactionTool(connector);
        const result = await tool.execute({
          channel: 'C001',
          ts: '1736942400.000000',
          emoji: 'thumbsup',
        });

        expect(result.success).toBe(true);

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.name).toBe('thumbsup');
        expect(callBody.channel).toBe('C001');
        expect(callBody.timestamp).toBe('1736942400.000000');
      });

      it('should strip colons from emoji name', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({ ok: true })
        );

        const tool = createAddReactionTool(connector);
        await tool.execute({
          channel: 'C001',
          ts: '1736942400.000000',
          emoji: ':thumbsup:',
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.name).toBe('thumbsup');
      });

      it('should treat already_reacted as success', async () => {
        fetchSpy.mockResolvedValueOnce(mockSlackError('already_reacted'));

        const tool = createAddReactionTool(connector);
        const result = await tool.execute({
          channel: 'C001',
          ts: '1736942400.000000',
          emoji: 'thumbsup',
        });

        expect(result.success).toBe(true);
      });
    });

    // ---- get_users ----

    describe('get_users', () => {
      it('should look up a single user by ID', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            user: {
              id: 'U001',
              name: 'alice',
              real_name: 'Alice Smith',
              profile: { display_name: 'alice.s', email: 'alice@example.com' },
              is_bot: false,
              is_admin: true,
              tz: 'America/New_York',
            },
          })
        );

        const tool = createGetUsersTool(connector);
        const result = await tool.execute({ userId: 'U001' });

        expect(result.success).toBe(true);
        expect(result.count).toBe(1);
        expect(result.users?.[0]?.id).toBe('U001');
        expect(result.users?.[0]?.realName).toBe('Alice Smith');
        expect(result.users?.[0]?.email).toBe('alice@example.com');
        expect(result.users?.[0]?.isAdmin).toBe(true);
      });

      it('should list all users', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            members: [
              { id: 'U001', name: 'alice', is_bot: false, deleted: false },
              { id: 'U002', name: 'bob', is_bot: false, deleted: false },
              { id: 'U003', name: 'old-user', is_bot: false, deleted: true },
            ],
            response_metadata: {},
          })
        );

        const tool = createGetUsersTool(connector);
        const result = await tool.execute({});

        expect(result.success).toBe(true);
        // Deactivated users filtered out by default
        expect(result.count).toBe(2);
      });

      it('should include deactivated users when requested', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            members: [
              { id: 'U001', name: 'alice', is_bot: false, deleted: false },
              { id: 'U002', name: 'old-user', is_bot: false, deleted: true },
            ],
            response_metadata: {},
          })
        );

        const tool = createGetUsersTool(connector);
        const result = await tool.execute({ includeDeactivated: true });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
      });
    });

    // ---- get_channel_info ----

    describe('get_channel_info', () => {
      it('should return channel details', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            channel: {
              id: 'C001',
              name: 'general',
              topic: { value: 'Company-wide announcements' },
              purpose: { value: 'General discussion' },
              num_members: 150,
              is_archived: false,
              is_private: false,
              created: 1600000000,
              creator: 'U001',
            },
          })
        );

        const tool = createGetChannelInfoTool(connector);
        const result = await tool.execute({ channel: 'C001' });

        expect(result.success).toBe(true);
        expect(result.channel?.id).toBe('C001');
        expect(result.channel?.name).toBe('general');
        expect(result.channel?.topic).toBe('Company-wide announcements');
        expect(result.channel?.purpose).toBe('General discussion');
        expect(result.channel?.memberCount).toBe(150);
        expect(result.channel?.creator).toBe('U001');
        expect(result.channel?.created).toMatch(/^2020/);
      });
    });

    // ---- set_channel_topic ----

    describe('set_channel_topic', () => {
      it('should set the channel topic', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            channel: {
              id: 'C001',
              topic: { value: 'Sprint 42: Auth migration' },
            },
          })
        );

        const tool = createSetChannelTopicTool(connector);
        const result = await tool.execute({
          channel: 'C001',
          topic: 'Sprint 42: Auth migration',
        });

        expect(result.success).toBe(true);
        expect(result.topic).toBe('Sprint 42: Auth migration');

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.channel).toBe('C001');
        expect(callBody.topic).toBe('Sprint 42: Auth migration');
      });

      it('should truncate topic to 250 characters', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockSlackResponse({
            ok: true,
            channel: { id: 'C001', topic: { value: 'x'.repeat(250) } },
          })
        );

        const tool = createSetChannelTopicTool(connector);
        await tool.execute({
          channel: 'C001',
          topic: 'x'.repeat(300),
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.topic).toHaveLength(250);
      });
    });

    // ---- Error handling ----

    describe('Error handling', () => {
      it('should handle Slack API errors (ok: false) in all tools', async () => {
        const tools = [
          { tool: createListChannelsTool(connector), args: {} },
          { tool: createGetMessagesTool(connector), args: { channel: 'C001' } },
          { tool: createGetThreadTool(connector), args: { channel: 'C001', ts: '123' } },
          { tool: createSearchMessagesTool(connector), args: { query: 'test' } },
          { tool: createGetChannelInfoTool(connector), args: { channel: 'C001' } },
          { tool: createSetChannelTopicTool(connector), args: { channel: 'C001', topic: 'x' } },
        ];

        for (const { tool, args } of tools) {
          fetchSpy.mockResolvedValueOnce(mockSlackError('channel_not_found'));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await tool.execute(args as any);

          expect(result.success).toBe(false);
          expect(result.error).toContain('channel_not_found');
        }
      });
    });

    // ---- describeCall ----

    describe('describeCall', () => {
      it('list_channels describes call', () => {
        const tool = createListChannelsTool(connector);
        expect(tool.describeCall?.({ type: 'private', limit: 50 })).toBe('channels (private) limit=50');
      });

      it('get_messages describes call', () => {
        const tool = createGetMessagesTool(connector);
        expect(tool.describeCall?.({ channel: 'C001', oldest: '2025-03-01' })).toBe('#C001 from 2025-03-01');
      });

      it('post_message describes call', () => {
        const tool = createPostMessageTool(connector);
        expect(tool.describeCall?.({ channel: 'C001', text: 'Hello!' })).toBe('Post to C001: Hello!');
      });

      it('post_message describes threaded reply', () => {
        const tool = createPostMessageTool(connector);
        expect(tool.describeCall?.({ channel: 'C001', text: 'Reply', threadTs: '123' })).toBe('Reply in C001: Reply');
      });

      it('get_thread describes call', () => {
        const tool = createGetThreadTool(connector);
        expect(tool.describeCall?.({ channel: 'C001', ts: '123.456' })).toBe('thread 123.456 in C001');
      });

      it('search_messages describes call', () => {
        const tool = createSearchMessagesTool(connector);
        expect(tool.describeCall?.({ query: 'deployment plan' })).toBe('search: deployment plan');
      });

      it('add_reaction describes call', () => {
        const tool = createAddReactionTool(connector);
        expect(tool.describeCall?.({ channel: 'C001', ts: '123', emoji: 'thumbsup' })).toBe(':thumbsup: on 123');
      });

      it('get_users describes single user lookup', () => {
        const tool = createGetUsersTool(connector);
        expect(tool.describeCall?.({ userId: 'U001' })).toBe('user U001');
      });

      it('get_users describes list', () => {
        const tool = createGetUsersTool(connector);
        expect(tool.describeCall?.({})).toBe('list users');
      });

      it('get_channel_info describes call', () => {
        const tool = createGetChannelInfoTool(connector);
        expect(tool.describeCall?.({ channel: 'C001' })).toBe('info for C001');
      });

      it('set_channel_topic describes call', () => {
        const tool = createSetChannelTopicTool(connector);
        expect(tool.describeCall?.({ channel: 'C001', topic: 'Sprint 42' })).toBe('topic for C001: Sprint 42');
      });
    });
  });
});
