/**
 * Desktop Mouse Drag Tool
 *
 * Drags from one position to another (press, move, release).
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopMouseDragArgs, DesktopMouseDragResult } from './types.js';
import { applyHumanDelay } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopMouseDragTool(config?: DesktopToolConfig): ToolFunction<DesktopMouseDragArgs, DesktopMouseDragResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_mouse_drag',
        description: `Drag the mouse from one position to another. Presses the button at the start position, moves to the end position, then releases.`,
        parameters: {
          type: 'object',
          properties: {
            startX: { type: 'number', description: 'Start X coordinate (in screen pixels)' },
            startY: { type: 'number', description: 'Start Y coordinate (in screen pixels)' },
            endX: { type: 'number', description: 'End X coordinate (in screen pixels)' },
            endY: { type: 'number', description: 'End Y coordinate (in screen pixels)' },
            button: {
              type: 'string',
              enum: ['left', 'right', 'middle'],
              description: 'Mouse button to use for dragging. Default: "left"',
            },
          },
          required: ['startX', 'startY', 'endX', 'endY'],
        },
      },
    },

    describeCall: (args: DesktopMouseDragArgs): string =>
      `(${args.startX},${args.startY}) → (${args.endX},${args.endY})`,

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: DesktopMouseDragArgs): Promise<DesktopMouseDragResult> => {
      try {
        const driver = await getDesktopDriver(config);
        await driver.mouseDrag(args.startX, args.startY, args.endX, args.endY, args.button ?? 'left');
        await applyHumanDelay(config ?? {});
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopMouseDrag = createDesktopMouseDragTool();
