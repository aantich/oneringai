/**
 * Google API Tools - Registration
 *
 * Registers all Google API tool factories with ConnectorTools.
 */

import { ConnectorTools } from '../connector/ConnectorTools.js';
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
 */
export function registerGoogleTools(): void {
  ConnectorTools.registerService('google-api', (connector: Connector, userId?: string) => [
    // Email (Gmail)
    createGoogleDraftEmailTool(connector, userId),
    createGoogleSendEmailTool(connector, userId),
    // Calendar
    createGoogleMeetingTool(connector, userId),
    createGoogleEditMeetingTool(connector, userId),
    createGoogleGetMeetingTranscriptTool(connector, userId),
    createGoogleListMeetingsTool(connector, userId),
    createGoogleGetMeetingTool(connector, userId),
    createGoogleFindMeetingSlotsTool(connector, userId),
    // Drive
    createGoogleReadFileTool(connector, userId),
    createGoogleListFilesTool(connector, userId),
    createGoogleSearchFilesTool(connector, userId),
  ]);
}
