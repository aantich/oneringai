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
 * `ConnectorTools.for(..., { actAs })` call site) into tool builders that USE
 * the user identity in their request URL. Drive (`/drive/v3/files`) and
 * `freeBusy` endpoints are not user-scoped at the URL level, so the
 * corresponding tools do not participate in the lock — `actAs` is
 * intentionally NOT forwarded to them. (See each tool's doc comment.)
 */
export function registerGoogleTools(): void {
  ConnectorTools.registerService(
    'google-api',
    (connector: Connector, userId?: string, options?: ServiceToolFactoryOptions) => {
      const actAs = options?.actAs;
      return [
        // Email (Gmail) — URL-scoped, participate in actAs lock
        createGoogleDraftEmailTool(connector, userId, actAs),
        createGoogleSendEmailTool(connector, userId, actAs),
        // Calendar — URL-scoped (/calendar/v3/calendars/{id}/events)
        createGoogleMeetingTool(connector, userId, actAs),
        createGoogleEditMeetingTool(connector, userId, actAs),
        createGoogleListMeetingsTool(connector, userId, actAs),
        createGoogleGetMeetingTool(connector, userId, actAs),
        // freeBusy — NOT user-scoped, does NOT take actAs
        createGoogleFindMeetingSlotsTool(connector, userId),
        // Meet transcript — uses /drive/v3/files (NOT user-scoped), does NOT take actAs
        createGoogleGetMeetingTranscriptTool(connector, userId),
        // Drive — NOT user-scoped, does NOT take actAs
        createGoogleReadFileTool(connector, userId),
        createGoogleListFilesTool(connector, userId),
        createGoogleSearchFilesTool(connector, userId),
      ];
    },
  );
}
