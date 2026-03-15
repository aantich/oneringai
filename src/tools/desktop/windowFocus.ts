/**
 * Desktop Window Focus Tool
 *
 * Brings a specific window to the foreground by its window ID.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopWindowFocusArgs, DesktopWindowFocusResult } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopWindowFocusTool(config?: DesktopToolConfig): ToolFunction<DesktopWindowFocusArgs, DesktopWindowFocusResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_window_focus',
        description: `Focus (bring to front) a window by its ID. Use desktop_window_list to get available window IDs.`,
        parameters: {
          type: 'object',
          properties: {
            windowId: {
              type: 'number',
              description: 'The window ID from desktop_window_list',
            },
          },
          required: ['windowId'],
        },
      },
    },

    describeCall: (args: DesktopWindowFocusArgs): string => `window ${args.windowId}`,

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: DesktopWindowFocusArgs): Promise<DesktopWindowFocusResult> => {
      try {
        const driver = await getDesktopDriver(config);
        await driver.focusWindow(args.windowId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopWindowFocus = createDesktopWindowFocusTool();
