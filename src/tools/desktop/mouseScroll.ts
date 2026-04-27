/**
 * Desktop Mouse Scroll Tool
 *
 * Scrolls the mouse wheel at the current position or at specified coordinates.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopMouseScrollArgs, DesktopMouseScrollResult } from './types.js';
import { applyHumanDelay } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopMouseScrollTool(config?: DesktopToolConfig): ToolFunction<DesktopMouseScrollArgs, DesktopMouseScrollResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_mouse_scroll',
        description: `Scroll the mouse wheel. Positive deltaY scrolls down, negative scrolls up. Positive deltaX scrolls right, negative scrolls left. Optionally specify position to scroll at.`,
        parameters: {
          type: 'object',
          properties: {
            deltaX: { type: 'number', description: 'Horizontal scroll amount. Positive=right, negative=left. Default: 0' },
            deltaY: { type: 'number', description: 'Vertical scroll amount. Positive=down, negative=up. Default: 0' },
            x: { type: 'number', description: 'X coordinate to scroll at (in screen pixels). Omit to scroll at current position.' },
            y: { type: 'number', description: 'Y coordinate to scroll at (in screen pixels). Omit to scroll at current position.' },
          },
          required: [],
        },
      },
    },

    describeCall: (args: DesktopMouseScrollArgs): string => {
      const parts: string[] = [];
      if (args.deltaY) parts.push(args.deltaY > 0 ? `down ${args.deltaY}` : `up ${Math.abs(args.deltaY)}`);
      if (args.deltaX) parts.push(args.deltaX > 0 ? `right ${args.deltaX}` : `left ${Math.abs(args.deltaX)}`);
      if (args.x !== undefined) parts.push(`at (${args.x},${args.y})`);
      return parts.join(', ') || 'no-op';
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: DesktopMouseScrollArgs): Promise<DesktopMouseScrollResult> => {
      try {
        const driver = await getDesktopDriver(config);
        await driver.mouseScroll(args.deltaX ?? 0, args.deltaY ?? 0, args.x, args.y);
        await applyHumanDelay(config ?? {});
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopMouseScroll = createDesktopMouseScrollTool();
