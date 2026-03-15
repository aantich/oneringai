/**
 * Desktop Mouse Move Tool
 *
 * Moves the mouse cursor to a specific position on screen.
 * Coordinates are in physical pixel space (same as screenshot pixels).
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopMouseMoveArgs, DesktopMouseMoveResult } from './types.js';
import { applyHumanDelay } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopMouseMoveTool(config?: DesktopToolConfig): ToolFunction<DesktopMouseMoveArgs, DesktopMouseMoveResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_mouse_move',
        description: `Move the mouse cursor to the specified (x, y) position. Coordinates are in screenshot pixel space (full screen). Returns the actual cursor position after the move for verification.`,
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate (in screenshot pixels)' },
            y: { type: 'number', description: 'Y coordinate (in screenshot pixels)' },
          },
          required: ['x', 'y'],
        },
      },
    },

    describeCall: (args: DesktopMouseMoveArgs): string => `(${args.x}, ${args.y})`,

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: DesktopMouseMoveArgs): Promise<DesktopMouseMoveResult> => {
      try {
        const driver = await getDesktopDriver(config);
        await driver.mouseMove(args.x, args.y);
        await applyHumanDelay(config ?? {});
        // Return actual cursor position for verification
        const actual = await driver.getCursorPosition();
        return { success: true, x: actual.x, y: actual.y };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopMouseMove = createDesktopMouseMoveTool();
