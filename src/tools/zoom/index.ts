/**
 * Zoom Connector Tools
 *
 * Provides meeting management and transcript retrieval for Zoom.
 * Auto-registers with ConnectorTools on import.
 *
 * @example
 * ```typescript
 * import { ConnectorTools } from 'oneringai';
 *
 * const tools = ConnectorTools.for('my-zoom-connector');
 * // Returns: zoom_create_meeting, zoom_update_meeting, zoom_get_transcript + generic API tool
 * ```
 */

// Side-effect: register Zoom tools with ConnectorTools
import { registerZoomTools } from './register.js';
registerZoomTools();

// Tool factories
export { createCreateMeetingTool } from './createMeeting.js';
export { createUpdateMeetingTool } from './updateMeeting.js';
export { createGetTranscriptTool } from './getTranscript.js';

// Registration
export { registerZoomTools } from './register.js';

// Types and utilities
export {
  zoomFetch,
  parseMeetingId,
  parseVTT,
  ZoomAPIError,
} from './types.js';

export type {
  ZoomCreateMeetingResult,
  ZoomUpdateMeetingResult,
  ZoomGetTranscriptResult,
  TranscriptEntry,
  ZoomFetchOptions,
} from './types.js';
