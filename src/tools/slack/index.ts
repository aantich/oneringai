/**
 * Slack Connector Tools
 *
 * Auto-registers Slack tool factories with ConnectorTools.
 * When imported, this module registers factories so that `ConnectorTools.for('slack')`
 * automatically includes Slack-specific tools alongside the generic API tool.
 *
 * Tools provided:
 * - list_channels — List workspace channels (public, private, DMs)
 * - get_channel_info — Get detailed channel information
 * - set_channel_topic — Update a channel's topic
 * - get_messages — Get messages from a channel with optional time range
 * - get_thread — Get all replies in a message thread
 * - post_message — Send a message to a channel, DM, or thread
 * - search_messages — Search messages by keyword, user, channel, date
 * - get_mentions — Find messages mentioning the authenticated user/bot
 * - add_reaction — Add an emoji reaction to a message
 * - get_users — List workspace members or look up a specific user
 */

// Side-effect: register Slack tool factories with ConnectorTools
import { registerSlackTools } from './register.js';
registerSlackTools();

// Types
export type {
  SlackChannel,
  SlackMessage,
  SlackMentionMessage,
  SlackUser,
  SlackListChannelsResult,
  SlackGetMessagesResult,
  SlackPostMessageResult,
  SlackGetThreadResult,
  SlackGetMentionsResult,
  SlackSearchMessagesResult,
  SlackAddReactionResult,
  SlackGetUsersResult,
  SlackGetChannelInfoResult,
  SlackSetChannelTopicResult,
  SlackAPIError,
} from './types.js';

// Utility functions
export {
  slackFetch,
  toSlackTimestamp,
  fromSlackTimestamp,
  getAuthenticatedUserId,
  formatMessage,
  slackPaginate,
} from './types.js';

// Tool factories (for direct use with custom options)
export { createListChannelsTool } from './listChannels.js';
export { createGetMessagesTool } from './getMessages.js';
export { createPostMessageTool } from './postMessage.js';
export { createGetThreadTool } from './getThread.js';
export { createGetMentionsTool } from './getMentions.js';
export { createSearchMessagesTool } from './searchMessages.js';
export { createAddReactionTool } from './addReaction.js';
export { createGetUsersTool } from './getUsers.js';
export { createGetChannelInfoTool } from './getChannelInfo.js';
export { createSetChannelTopicTool } from './setChannelTopic.js';
