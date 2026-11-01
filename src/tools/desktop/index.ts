/**
 * Desktop Automation Tools
 *
 * OS-level desktop automation for "computer use" agent loops:
 * screenshot → vision model → tool calls (click, type, etc.) → repeat.
 *
 * Requires @nut-tree-fork/nut-js as an optional peer dependency.
 * All coordinates are in physical pixel space (screenshot space).
 *
 * @example
 * ```typescript
 * import { tools } from 'oneringai';
 *
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: tools.desktopTools,
 * });
 * ```
 */

// Types
export type {
  IDesktopDriver,
  DesktopToolConfig,
  DesktopPoint,
  DesktopScreenSize,
  DesktopScreenshot,
  DesktopWindow,
  MouseButton,
  DesktopToolName,
  // Arg/Result types
  DesktopScreenshotArgs,
  DesktopScreenshotResult,
  DesktopMouseMoveArgs,
  DesktopMouseMoveResult,
  DesktopMouseClickArgs,
  DesktopMouseClickResult,
  DesktopMouseDragArgs,
  DesktopMouseDragResult,
  DesktopMouseScrollArgs,
  DesktopMouseScrollResult,
  DesktopGetCursorResult,
  DesktopKeyboardTypeArgs,
  DesktopKeyboardTypeResult,
  DesktopKeyboardKeyArgs,
  DesktopKeyboardKeyResult,
  DesktopGetScreenSizeResult,
  DesktopWindowListResult,
  DesktopWindowFocusArgs,
  DesktopWindowFocusResult,
} from './types.js';

export {
  DEFAULT_DESKTOP_CONFIG,
  applyHumanDelay,
  DESKTOP_TOOL_NAMES,
} from './types.js';

// Driver
export { NutTreeDriver, parseKeyCombo } from './driver/index.js';
export { getDesktopDriver, resetDefaultDriver } from './getDriver.js';

// Tool factories + default instances
export { desktopScreenshot, createDesktopScreenshotTool } from './screenshot.js';
export { desktopMouseMove, createDesktopMouseMoveTool } from './mouseMove.js';
export { desktopMouseClick, createDesktopMouseClickTool } from './mouseClick.js';
export { desktopMouseDrag, createDesktopMouseDragTool } from './mouseDrag.js';
export { desktopMouseScroll, createDesktopMouseScrollTool } from './mouseScroll.js';
export { desktopGetCursor, createDesktopGetCursorTool } from './getCursor.js';
export { desktopKeyboardType, createDesktopKeyboardTypeTool } from './keyboardType.js';
export { desktopKeyboardKey, createDesktopKeyboardKeyTool } from './keyboardKey.js';
export { desktopGetScreenSize, createDesktopGetScreenSizeTool } from './getScreenSize.js';
export { desktopWindowList, createDesktopWindowListTool } from './windowList.js';
export { desktopWindowFocus, createDesktopWindowFocusTool } from './windowFocus.js';

// Convenience bundle
import { desktopScreenshot } from './screenshot.js';
import { desktopMouseMove } from './mouseMove.js';
import { desktopMouseClick } from './mouseClick.js';
import { desktopMouseDrag } from './mouseDrag.js';
import { desktopMouseScroll } from './mouseScroll.js';
import { desktopGetCursor } from './getCursor.js';
import { desktopKeyboardType } from './keyboardType.js';
import { desktopKeyboardKey } from './keyboardKey.js';
import { desktopGetScreenSize } from './getScreenSize.js';
import { desktopWindowList } from './windowList.js';
import { desktopWindowFocus } from './windowFocus.js';

/**
 * A bundle of all desktop automation tools.
 * Includes: screenshot, mouse (move, click, drag, scroll, getCursor),
 * keyboard (type, key), screen info, and window management.
 */
export const desktopTools = [
  desktopScreenshot,
  desktopMouseMove,
  desktopMouseClick,
  desktopMouseDrag,
  desktopMouseScroll,
  desktopGetCursor,
  desktopKeyboardType,
  desktopKeyboardKey,
  desktopGetScreenSize,
  desktopWindowList,
  desktopWindowFocus,
];
