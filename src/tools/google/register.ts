/**
 * Google API Tools - Registration
 *
 * Registers all Google API tool factories with ConnectorTools.
 */

import { ConnectorTools, type ServiceToolFactoryOptions } from '../connector/ConnectorTools.js';
import type { Connector } from '../../core/Connector.js';
import { createGoogleDraftEmailTool } from './createDraftEmail.js';
import { createGoogleSendEmailTool } from './sendEmail.js';
import { createGoogleMeetingTool } from './createMeeting.js';
import { createGoogleEditMeetingTool } from './editMeeting.js';
import { createGoogleGetMeetingTranscriptTool } from './getMeetingTranscript.js';
import { createGoogleListMeetingsTool } from './listMeetings.js';
import { createGoogleGetMeetingTool } from './getMeeting.js';
import { createGoogleFindMeetingSlotsTool } from './findMeetingSlots.js';
import { createGoogleReadFileTool } from './readFile.js';
import { createGoogleListFilesTool } from './listFiles.js';
import { createGoogleSearchFilesTool } from './searchFiles.js';

/**
 * Register all Google API tools with ConnectorTools.
 * Called as a side-effect when importing `./index.js`.
 *
 * The factory forwards `options.actAs` (the on-behalf-of user lock set at the
 * `ConnectorTools.for(..., { actAs })` call site) into each tool builder. The
 * `readFile` tool has its own `config` slot, so `actAs` is its 4th parameter.
 */
export function registerGoogleTools(): void {
  ConnectorTools.registerService(
    'google-api',
    (connector: Connector, userId?: string, options?: ServiceToolFactoryOptions) => {
      const actAs = options?.actAs;
      return [
        // Email (Gmail)
        createGoogleDraftEmailTool(connector, userId, actAs),
        createGoogleSendEmailTool(connector, userId, actAs),
        // Calendar
        createGoogleMeetingTool(connector, userId, actAs),
        createGoogleEditMeetingTool(connector, userId, actAs),
        createGoogleGetMeetingTranscriptTool(connector, userId, actAs),
        createGoogleListMeetingsTool(connector, userId, actAs),
        createGoogleGetMeetingTool(connector, userId, actAs),
        createGoogleFindMeetingSlotsTool(connector, userId, actAs),
        // Drive — readFile keeps `config` at slot 3 (legacy); actAs is slot 4.
        createGoogleReadFileTool(connector, userId, undefined, actAs),
        createGoogleListFilesTool(connector, userId, actAs),
        createGoogleSearchFilesTool(connector, userId, actAs),
      ];
    },
  );
}
