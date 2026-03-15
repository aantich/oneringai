/**
 * Desktop Keyboard Key Tool
 *
 * Presses keyboard shortcuts or special keys (e.g., "ctrl+c", "enter", "cmd+shift+s").
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { DesktopToolConfig, DesktopKeyboardKeyArgs, DesktopKeyboardKeyResult } from './types.js';
import { applyHumanDelay } from './types.js';
import { getDesktopDriver } from './getDriver.js';

export function createDesktopKeyboardKeyTool(config?: DesktopToolConfig): ToolFunction<DesktopKeyboardKeyArgs, DesktopKeyboardKeyResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'desktop_keyboard_key',
        description: `Press a keyboard shortcut or special key. Use "+" to combine keys (e.g., "ctrl+c", "cmd+shift+s", "enter", "tab", "escape"). Modifiers: ctrl, cmd/command, alt/option, shift. Special keys: enter, tab, escape, backspace, delete, space, up, down, left, right, f1-f12, home, end, pageup, pagedown.`,
        parameters: {
          type: 'object',
          properties: {
            keys: {
              type: 'string',
              description: 'Key combo string (e.g., "ctrl+c", "enter", "cmd+shift+s")',
            },
          },
          required: ['keys'],
        },
      },
    },

    describeCall: (args: DesktopKeyboardKeyArgs): string => args.keys,

    permission: { scope: 'session' as const, riskLevel: 'medium' as const, sensitiveArgs: ['key'] },

    execute: async (args: DesktopKeyboardKeyArgs): Promise<DesktopKeyboardKeyResult> => {
      try {
        const driver = await getDesktopDriver(config);
        await driver.keyboardKey(args.keys);
        await applyHumanDelay(config ?? {});
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}

export const desktopKeyboardKey = createDesktopKeyboardKeyTool();
