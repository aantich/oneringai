/**
 * Telegram Connector Tools
 *
 * Auto-registers Telegram tool factories with ConnectorTools.
 * When imported, this module registers factories so that `ConnectorTools.for('telegram')`
 * automatically includes Telegram-specific tools alongside the generic API tool.
 *
 * Tools provided:
 * - telegram_get_me — Get bot info (connection test)
 * - telegram_get_chat — Get chat/group/channel info
 * - telegram_send_message — Send a text message with optional formatting
 * - telegram_send_photo — Send a photo by URL or file_id
 * - telegram_get_updates — Poll for incoming messages/events
 * - telegram_set_webhook — Set or remove webhook for push updates
 */

// Side-effect: register Telegram tool factories with ConnectorTools
import { registerTelegramTools } from './register.js';
registerTelegramTools();

// Types
export type {
  TelegramUser,
  TelegramChat,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramSendResult,
  TelegramGetMeResult,
  TelegramGetChatResult,
  TelegramGetUpdatesResult,
  TelegramSetWebhookResult,
} from './types.js';

// Error classes
export { TelegramAPIError, TelegramConfigError } from './types.js';

// Utility functions
export { telegramFetch, getBotToken } from './types.js';

// Tool factories
export { createSendMessageTool } from './sendMessage.js';
export { createSendPhotoTool } from './sendPhoto.js';
export { createGetUpdatesTool } from './getUpdates.js';
export { createGetMeTool } from './getMe.js';
export { createGetChatTool } from './getChat.js';
export { createSetWebhookTool } from './setWebhook.js';
