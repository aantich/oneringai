/**
 * Desktop Get Screen Size Tool
 *
 * Returns the screen dimensions (physical, logical, and scale factor).
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopGetScreenSizeResult } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopGetScreenSizeTool(config?: DesktopToolConfig): ToolFunction<Record<string, never>, DesktopGetScreenSizeResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_get_screen_size',
        description: `Get the screen dimensions. Returns physical pixel size (screenshot space), logical size (OS coordinates), and the scale factor (e.g., 2.0 on Retina displays). All desktop tool coordinates use physical pixel space.`,
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },

    describeCall: (): string => 'get screen size',

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    execute: async (): Promise<DesktopGetScreenSizeResult> => {
      try {
        const driver = await getDesktopDriver(config);
        const size = await driver.getScreenSize();
        return {
          success: true,
          physicalWidth: size.physicalWidth,
          physicalHeight: size.physicalHeight,
          logicalWidth: size.logicalWidth,
          logicalHeight: size.logicalHeight,
          scaleFactor: size.scaleFactor,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopGetScreenSize = createDesktopGetScreenSizeTool();
