/**
 * Telegram Tools Registration
 *
 * Registers Telegram-specific tool factory with ConnectorTools.
 * When a connector with serviceType 'telegram' is used,
 * these tools become available automatically.
 */

import { ConnectorTools } from '../connector/ConnectorTools.js';
import type { Connector } from '../../core/Connector.js';
import { createSendMessageTool } from './sendMessage.js';
import { createSendPhotoTool } from './sendPhoto.js';
import { createGetUpdatesTool } from './getUpdates.js';
import { createGetMeTool } from './getMe.js';
import { createGetChatTool } from './getChat.js';
import { createSetWebhookTool } from './setWebhook.js';

/**
 * Register Telegram tools with the ConnectorTools framework.
 *
 * After calling this, `ConnectorTools.for('my-telegram-bot')` will
 * return all 6 Telegram tools plus the generic API tool.
 */
export function registerTelegramTools(): void {
  ConnectorTools.registerService('telegram', (connector: Connector) => {
    return [
      // Info
      createGetMeTool(connector),
      createGetChatTool(connector),
      // Send
      createSendMessageTool(connector),
      createSendPhotoTool(connector),
      // Receive
      createGetUpdatesTool(connector),
      // Config
      createSetWebhookTool(connector),
    ];
  });
}
