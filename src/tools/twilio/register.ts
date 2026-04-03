/**
 * Twilio Tools Registration
 *
 * Registers Twilio-specific tool factory with ConnectorTools.
 * When a connector with serviceType 'twilio' (or baseURL matching api.twilio.com)
 * is used, these tools become available automatically.
 */

import { ConnectorTools } from '../connector/ConnectorTools.js';
import type { Connector } from '../../core/Connector.js';
import { createSendSMSTool } from './sendSMS.js';
import { createSendWhatsAppTool } from './sendWhatsApp.js';
import { createListMessagesTool } from './listMessages.js';
import { createGetMessageTool } from './getMessage.js';

/**
 * Register Twilio tools with the ConnectorTools framework.
 *
 * After calling this, `ConnectorTools.for('my-twilio-connector')` will
 * return all 4 Twilio tools plus the generic API tool.
 */
export function registerTwilioTools(): void {
  ConnectorTools.registerService('twilio', (connector: Connector, userId?: string) => {
    return [
      // Send
      createSendSMSTool(connector, userId),
      createSendWhatsAppTool(connector, userId),
      // Read
      createListMessagesTool(connector, userId),
      createGetMessageTool(connector, userId),
    ];
  });
}
