/**
 * Desktop Mouse Click Tool
 *
 * Clicks at the current cursor position or at specified coordinates.
 * If x/y are provided, moves to that position first, then clicks.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopMouseClickArgs, DesktopMouseClickResult } from './types.js';
import { applyHumanDelay } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopMouseClickTool(config?: DesktopToolConfig): ToolFunction<DesktopMouseClickArgs, DesktopMouseClickResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_mouse_click',
        description: `Click the mouse at the specified position or at the current cursor position. Supports left/right/middle button and single/double/triple click.`,
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate to click (in screen pixels). Omit to click at current position.' },
            y: { type: 'number', description: 'Y coordinate to click (in screen pixels). Omit to click at current position.' },
            button: {
              type: 'string',
              enum: ['left', 'right', 'middle'],
              description: 'Mouse button to click. Default: "left"',
            },
            clickCount: {
              type: 'number',
              description: 'Number of clicks (1=single, 2=double, 3=triple). Default: 1',
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: DesktopMouseClickArgs): string => {
      const pos = args.x !== undefined ? `(${args.x}, ${args.y})` : 'current position';
      const btn = args.button && args.button !== 'left' ? ` ${args.button}` : '';
      const count = args.clickCount && args.clickCount > 1 ? ` x${args.clickCount}` : '';
      return `${pos}${btn}${count}`;
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: DesktopMouseClickArgs): Promise<DesktopMouseClickResult> => {
      try {
        const driver = await getDesktopDriver(config);
        const button = args.button ?? 'left';
        const clickCount = args.clickCount ?? 1;

        if (args.x !== undefined && args.y !== undefined) {
          // Move + click
          await driver.mouseClick(args.x, args.y, button, clickCount);
        } else {
          // Click at current position
          const pos = await driver.getCursorPosition();
          await driver.mouseClick(pos.x, pos.y, button, clickCount);
        }

        await applyHumanDelay(config ?? {});
        // Return actual cursor position for verification
        const actual = await driver.getCursorPosition();
        return { success: true, x: actual.x, y: actual.y, button, clickCount };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopMouseClick = createDesktopMouseClickTool();
