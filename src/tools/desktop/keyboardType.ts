/**
 * Desktop Keyboard Type Tool
 *
 * Types text as if from a physical keyboard.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopKeyboardTypeArgs, DesktopKeyboardTypeResult } from './types.js';
import { applyHumanDelay } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopKeyboardTypeTool(config?: DesktopToolConfig): ToolFunction<DesktopKeyboardTypeArgs, DesktopKeyboardTypeResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_keyboard_type',
        description: `Type text using the keyboard. Each character is typed as a keypress. Use this for entering text into focused input fields.`,
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text to type' },
            delay: { type: 'number', description: 'Delay in ms between each keystroke. Default: uses system default.' },
          },
          required: ['text'],
        },
      },
    },

    describeCall: (args: DesktopKeyboardTypeArgs): string => {
      const preview = args.text.length > 30 ? args.text.slice(0, 27) + '...' : args.text;
      return `"${preview}"`;
    },

    permission: { scope: 'session' as const, riskLevel: 'high' as const, sensitiveArgs: ['text'] },

    execute: async (args: DesktopKeyboardTypeArgs): Promise<DesktopKeyboardTypeResult> => {
      try {
        const driver = await getDesktopDriver(config);
        await driver.keyboardType(args.text, args.delay);
        await applyHumanDelay(config ?? {});
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopKeyboardType = createDesktopKeyboardTypeTool();
