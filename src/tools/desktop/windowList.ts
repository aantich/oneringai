/**
 * Desktop Window List Tool
 *
 * Lists all visible windows with their IDs, titles, and bounds.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopWindowListResult } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopWindowListTool(config?: DesktopToolConfig): ToolFunction<Record<string, never>, DesktopWindowListResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_window_list',
        description: `List all visible windows on the desktop. Returns window IDs, titles, application names, and bounds. Use the window ID with desktop_window_focus to bring a window to the foreground.`,
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },

    describeCall: (): string => 'list windows',

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (): Promise<DesktopWindowListResult> => {
      try {
        const driver = await getDesktopDriver(config);
        const windows = await driver.getWindowList();
        return { success: true, windows };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopWindowList = createDesktopWindowListTool();
