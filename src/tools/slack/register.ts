/**
 * Slack Tools Registration
 *
 * Registers Slack-specific tool factory with ConnectorTools.
 * When a connector with serviceType 'slack' (or baseURL matching slack.com)
 * is used, these tools become available automatically.
 */

import { ConnectorTools } from '../connector/ConnectorTools.js';
import type { Connector } from '../../core/Connector.js';
import { createListChannelsTool } from './listChannels.js';
import { createGetMessagesTool } from './getMessages.js';
import { createPostMessageTool } from './postMessage.js';
import { createGetThreadTool } from './getThread.js';
import { createGetMentionsTool } from './getMentions.js';
import { createSearchMessagesTool } from './searchMessages.js';
import { createAddReactionTool } from './addReaction.js';
import { createGetUsersTool } from './getUsers.js';
import { createGetChannelInfoTool } from './getChannelInfo.js';
import { createSetChannelTopicTool } from './setChannelTopic.js';

/**
 * Register Slack tools with the ConnectorTools framework.
 *
 * After calling this, `ConnectorTools.for('my-slack-connector')` will
 * return all 10 Slack tools plus the generic API tool.
 */
export function registerSlackTools(): void {
  ConnectorTools.registerService('slack', (connector: Connector, userId?: string) => {
    return [
      // Channel discovery
      createListChannelsTool(connector, userId),
      createGetChannelInfoTool(connector, userId),
      createSetChannelTopicTool(connector, userId),
      // Messages
      createGetMessagesTool(connector, userId),
      createGetThreadTool(connector, userId),
      createPostMessageTool(connector, userId),
      // Search & mentions
      createSearchMessagesTool(connector, userId),
      createGetMentionsTool(connector, userId),
      // Reactions
      createAddReactionTool(connector, userId),
      // Users
      createGetUsersTool(connector, userId),
    ];
  });
}
