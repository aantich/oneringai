/**
 * Desktop Screenshot Tool
 *
 * Captures a screenshot of the entire screen or a specific region.
 * Returns base64 PNG with __images convention for multimodal provider handling.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopScreenshotArgs, DesktopScreenshotResult } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopScreenshotTool(config?: DesktopToolConfig): ToolFunction<DesktopScreenshotArgs, DesktopScreenshotResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_screenshot',
        description: `Take a screenshot of the entire screen or a specific region. Returns the screenshot image for visual analysis. Use this to see what's on screen before performing actions. IMPORTANT: If you capture a region, element positions in the image are relative to the region's top-left corner. To click an element at image position (ix, iy), you must use screen coordinates (ix + region.x, iy + region.y). Prefer full-screen screenshots to avoid coordinate offset errors.`,
        parameters: {
          type: 'object',
          properties: {
            region: {
              type: 'object',
              description: 'Optional region to capture (in physical pixel coordinates). Omit to capture full screen.',
              properties: {
                x: { type: 'number', description: 'Left edge X coordinate' },
                y: { type: 'number', description: 'Top edge Y coordinate' },
                width: { type: 'number', description: 'Width in pixels' },
                height: { type: 'number', description: 'Height in pixels' },
              },
              required: ['x', 'y', 'width', 'height'],
            },
          },
          required: [],
        },
      },
    },

    describeCall: (args: DesktopScreenshotArgs): string => {
      if (args.region) {
        return `region (${args.region.x},${args.region.y}) ${args.region.width}x${args.region.height}`;
      }
      return 'full screen';
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    execute: async (args: DesktopScreenshotArgs): Promise<DesktopScreenshotResult> => {
      try {
        const driver = await getDesktopDriver(config);
        const screenshot = await driver.screenshot(args.region);

        return {
          success: true,
          width: screenshot.width,
          height: screenshot.height,
          base64: screenshot.base64,
          __images: [{ base64: screenshot.base64, mediaType: 'image/png' }],
          // Include region info so the agent can compute screen coordinates:
          // screen_x = image_x + regionOffsetX, screen_y = image_y + regionOffsetY
          ...(args.region ? { regionOffsetX: args.region.x, regionOffsetY: args.region.y } : {}),
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopScreenshot = createDesktopScreenshotTool();
