/**
 * Desktop Get Cursor Tool
 *
 * Returns the current cursor position in physical pixel (screenshot) coordinates.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopGetCursorResult } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopGetCursorTool(config?: DesktopToolConfig): ToolFunction<Record<string, never>, DesktopGetCursorResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_get_cursor',
        description: `Get the current mouse cursor position in screenshot pixel coordinates.`,
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },

    describeCall: (): string => 'get cursor position',

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (): Promise<DesktopGetCursorResult> => {
      try {
        const driver = await getDesktopDriver(config);
        const pos = await driver.getCursorPosition();
        return { success: true, x: pos.x, y: pos.y };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopGetCursor = createDesktopGetCursorTool();
