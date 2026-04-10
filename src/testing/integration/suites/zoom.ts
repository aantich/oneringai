/**
 * Zoom Integration Test Suite
 *
 * Tests: zoom_create_meeting, zoom_update_meeting, zoom_get_transcript
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

const zoomSuite: IntegrationTestSuite = {
  id: 'zoom',
  serviceType: 'zoom',
  name: 'Zoom',
  description: 'Tests Zoom tools: meeting creation, updates, and transcripts.',
  requiredParams: [],
  optionalParams: [
    {
      key: 'testZoomMeetingId',
      label: 'Existing Meeting ID',
      description: 'Zoom meeting ID for transcript test (optional)',
      type: 'string',
      required: false,
    },
  ],
  tests: [
    {
      name: 'Create a Zoom meeting',
      toolName: 'zoom_create_meeting',
      description: 'Creates a scheduled Zoom meeting',
      critical: true,
      execute: async (tools, ctx) => {
        const tool = tools.get('zoom_create_meeting')!;
        const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const result = await tool.execute({
          topic: `[Integration Test] Zoom Meeting - ${new Date().toISOString()}`,
          startTime: start.toISOString(),
          duration: 30,
          type: 2, // scheduled
          agenda: 'Automated integration test meeting. Safe to delete.',
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Create meeting failed', data: result };
        }
        ctx.state.zoomMeetingId = result.id || result.meetingId;
        return {
          success: true,
          message: `Meeting created: ${ctx.state.zoomMeetingId}`,
          data: result,
        };
      },
      cleanup: async (tools, ctx) => {
        if (ctx.state.zoomMeetingId && tools.has('api')) {
          try {
            const apiTool = tools.get('api')!;
            await apiTool.execute({
              method: 'DELETE',
              endpoint: `/meetings/${ctx.state.zoomMeetingId}`,
            });
          } catch {
            // Best effort
          }
        }
      },
    },
    {
      name: 'Update a Zoom meeting',
      toolName: 'zoom_update_meeting',
      description: 'Updates the test meeting topic',
      critical: false,
      execute: async (tools, ctx) => {
        const meetingId = ctx.state.zoomMeetingId as string | undefined;
        if (!meetingId) {
          return { success: false, message: 'No meeting ID from create test' };
        }
        const tool = tools.get('zoom_update_meeting')!;
        const result = await tool.execute({
          meetingId,
          topic: `[Integration Test] Updated - ${new Date().toISOString()}`,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Update meeting failed', data: result };
        }
        return { success: true, message: 'Meeting updated', data: result };
      },
    },
    {
      name: 'Get meeting transcript',
      toolName: 'zoom_get_transcript',
      description: 'Retrieves a Zoom meeting transcript',
      requiredParams: ['testZoomMeetingId'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('zoom_get_transcript')!;
        const meetingId = ctx.params.testZoomMeetingId;
        const result = await tool.execute({ meetingId });
        if (!result.success && (result.error?.includes('not found') || result.error?.includes('No recording'))) {
          return { success: true, message: 'API call succeeded (no transcript available)', data: result };
        }
        if (!result.success) {
          return { success: false, message: result.error || 'Get transcript failed', data: result };
        }
        return { success: true, message: 'Transcript retrieved', data: result };
      },
    },
  ],
};

registerSuite(zoomSuite);
export { zoomSuite };
