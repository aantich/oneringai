/**
 * Microsoft Graph Tools Registration
 *
 * Registers Microsoft-specific tool factory with ConnectorTools.
 * When a connector with serviceType 'microsoft' (or baseURL matching graph.microsoft.com)
 * is used, these tools become available automatically.
 */

import { ConnectorTools, type ServiceToolFactoryOptions } from '../connector/ConnectorTools.js';
import type { Connector } from '../../core/Connector.js';
import { createDraftEmailTool } from './createDraftEmail.js';
import { createSendEmailTool } from './sendEmail.js';
import { createMeetingTool } from './createMeeting.js';
import { createEditMeetingTool } from './editMeeting.js';
import { createGetMeetingTranscriptTool } from './getMeetingTranscript.js';
import { createListMeetingsTool } from './listMeetings.js';
import { createGetMeetingTool } from './getMeeting.js';
import { createFindMeetingSlotsTool } from './findMeetingSlots.js';
import { createMicrosoftReadFileTool } from './readFile.js';
import { createMicrosoftListFilesTool } from './listFiles.js';
import { createMicrosoftSearchFilesTool } from './searchFiles.js';

/**
 * Register Microsoft Graph tools with the ConnectorTools framework.
 *
 * After calling this, `ConnectorTools.for('my-microsoft-connector')` will
 * return all 11 Microsoft tools plus the generic API tool.
 *
 * The factory forwards `options.actAs` (the on-behalf-of user lock set at the
 * `ConnectorTools.for(..., { actAs })` call site) into each tool builder. The
 * `readFile` tool has its own `config` slot, so `actAs` is its 4th parameter.
 */
export function registerMicrosoftTools(): void {
  ConnectorTools.registerService(
    'microsoft',
    (connector: Connector, userId?: string, options?: ServiceToolFactoryOptions) => {
      const actAs = options?.actAs;
      return [
        // Email
        createDraftEmailTool(connector, userId, actAs),
        createSendEmailTool(connector, userId, actAs),
        // Meetings
        createMeetingTool(connector, userId, actAs),
        createEditMeetingTool(connector, userId, actAs),
        createGetMeetingTranscriptTool(connector, userId, actAs),
        createListMeetingsTool(connector, userId, actAs),
        createGetMeetingTool(connector, userId, actAs),
        createFindMeetingSlotsTool(connector, userId, actAs),
        // Files (OneDrive / SharePoint)
        // readFile keeps `config` at slot 3 (legacy); actAs is slot 4.
        createMicrosoftReadFileTool(connector, userId, undefined, actAs),
        createMicrosoftListFilesTool(connector, userId, actAs),
        createMicrosoftSearchFilesTool(connector, userId, actAs),
      ];
    },
  );
}
