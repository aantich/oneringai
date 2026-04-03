/**
 * Twilio Connector Tools
 *
 * Auto-registers Twilio tool factories with ConnectorTools.
 * When imported, this module registers factories so that `ConnectorTools.for('twilio')`
 * automatically includes Twilio-specific tools alongside the generic API tool.
 *
 * Tools provided:
 * - send_sms — Send an SMS text message
 * - send_whatsapp — Send a WhatsApp message (freeform or template)
 * - list_messages — List/filter messages (SMS and WhatsApp) by number, date, channel
 * - get_message — Get full details of a single message by SID
 */

// Side-effect: register Twilio tool factories with ConnectorTools
import { registerTwilioTools } from './register.js';
registerTwilioTools();

// Types
export type {
  TwilioMessage,
  TwilioSendResult,
  TwilioListMessagesResult,
  TwilioGetMessageResult,
} from './types.js';

// Error classes (runtime values — need value export for instanceof checks)
export { TwilioAPIError, TwilioConfigError } from './types.js';

// Utility functions
export {
  twilioFetch,
  normalizePhoneNumber,
  toWhatsAppNumber,
  getAccountSid,
  formatMessage,
} from './types.js';

// Tool factories (for direct use with custom options)
export { createSendSMSTool } from './sendSMS.js';
export { createSendWhatsAppTool } from './sendWhatsApp.js';
export { createListMessagesTool } from './listMessages.js';
export { createGetMessageTool } from './getMessage.js';
