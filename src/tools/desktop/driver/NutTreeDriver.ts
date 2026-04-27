/**
 * NutTreeDriver - Desktop automation driver using @nut-tree-fork/nut-js
 *
 * Coordinate system: UI-pixel space (the dimensions of the screenshot returned
 * to callers). This is the unified coordinate space for all user-facing APIs —
 * screenshot() output, region specifications, mouseMove/mouseClick/mouseDrag
 * inputs, and getCursorPosition() output all live in this space.
 *
 * The raw OS pipeline has two distinct coordinate systems:
 *   1. Physical pixels: what nut-js's screen.grab() returns. On HiDPI/Retina
 *      this is 2x (or more) larger than the logical OS coordinates.
 *   2. Logical pixels: what nut-js's mouse/screen APIs operate in (CGEventPost
 *      on macOS). Equals screen.width()/height().
 *
 * Rather than exposing EITHER of those directly, we introduce a third space
 * (UI-pixel) that's CAPPED at `screenshotMaxDim` on the long side. This is
 * important because modern vision LLMs (OpenAI, Anthropic, Gemini) all resize
 * large input images internally; their coordinate-prediction accuracy drops
 * on oversized images. Capping at ~1280 keeps the image within their preferred
 * range across platforms and displays.
 *
 * Two scale factors:
 *   - retinaScale  = physical / logical  (reported as scaleFactor, diagnostic)
 *   - uiScale      = logical / ui        (internal, applied on every API call)
 *
 * When the logical screen is already within the cap, uiScale = 1 and this
 * driver behaves like a plain logical-coordinate driver.
 */

import type {
  IDesktopDriver,
  DesktopPoint,
  DesktopScreenSize,
  DesktopScreenshot,
  DesktopWindow,
  MouseButton,
} from '../types.js';

// Key name → nut-tree Key enum mapping
const KEY_MAP: Record<string, string> = {
  // Modifiers
  ctrl: 'LeftControl',
  control: 'LeftControl',
  cmd: 'LeftCmd',
  command: 'LeftCmd',
  meta: 'LeftCmd',
  super: 'LeftCmd',
  alt: 'LeftAlt',
  option: 'LeftAlt',
  shift: 'LeftShift',

  // Navigation
  enter: 'Return',
  return: 'Return',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',

  // Arrow keys
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',

  // Function keys
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4',
  f5: 'F5', f6: 'F6', f7: 'F7', f8: 'F8',
  f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',

  // Other
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  printscreen: 'Print',
  capslock: 'CapsLock',
  numlock: 'NumLock',
  scrolllock: 'ScrollLock',
};

/**
 * Parse a key combo string like "ctrl+c", "cmd+shift+s", "enter"
 * Returns nut-tree Key enum values.
 */
export function parseKeyCombo(keys: string, KeyEnum: Record<string, any>): any[] {
  const parts = keys.toLowerCase().split('+').map((k) => k.trim());
  const result: any[] = [];

  for (const part of parts) {
    const mapped = KEY_MAP[part];
    if (mapped && KeyEnum[mapped] !== undefined) {
      result.push(KeyEnum[mapped]);
      continue;
    }

    if (part.length === 1) {
      const upper = part.toUpperCase();
      if (KeyEnum[upper] !== undefined) {
        result.push(KeyEnum[upper]);
        continue;
      }
    }

    const pascal = part.charAt(0).toUpperCase() + part.slice(1);
    if (KeyEnum[pascal] !== undefined) {
      result.push(KeyEnum[pascal]);
      continue;
    }

    if (KeyEnum[part] !== undefined) {
      result.push(KeyEnum[part]);
      continue;
    }

    throw new Error(`Unknown key: "${part}". Available modifiers: ctrl, cmd, alt, shift. Common keys: enter, tab, escape, space, up, down, left, right, f1-f12, a-z, 0-9`);
  }

  return result;
}

/**
 * Encode raw RGBA pixel data to PNG using pngjs.
 */
async function encodeRGBAToPNG(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  const { PNG } = await import('pngjs');

  const png = new PNG({ width, height });
  const sourceBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  sourceBuffer.copy(png.data, 0, 0, width * height * 4);
  return PNG.sync.write(png);
}

/**
 * Downsample a BGRA/RGBA buffer using box-average filtering. Handles both
 * integer scale factors (exactly — for Retina 2x) and fractional factors.
 * No-op when srcW/H match dstW/H.
 *
 * Note: operates on the channel layout it's given (doesn't swap BGRA↔RGBA),
 * so apply BGRA→RGBA conversion either before or after, consistently.
 */
function downsampleRGBA(
  src: Buffer | Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const buf = Buffer.isBuffer(src) ? src : Buffer.from(src);
  if (srcW === dstW && srcH === dstH) {
    return buf;
  }
  const out = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let oy = 0; oy < dstH; oy++) {
    const y0 = Math.floor(oy * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((oy + 1) * yRatio));
    for (let ox = 0; ox < dstW; ox++) {
      const x0 = Math.floor(ox * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((ox + 1) * xRatio));
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const rowOffset = y * srcW;
        for (let x = x0; x < x1; x++) {
          const i = (rowOffset + x) * 4;
          c0 += buf.readUInt8(i);
          c1 += buf.readUInt8(i + 1);
          c2 += buf.readUInt8(i + 2);
          c3 += buf.readUInt8(i + 3);
          n++;
        }
      }
      const oi = (oy * dstW + ox) * 4;
      out[oi]     = Math.round(c0 / n);
      out[oi + 1] = Math.round(c1 / n);
      out[oi + 2] = Math.round(c2 / n);
      out[oi + 3] = Math.round(c3 / n);
    }
  }
  return out;
}

// ============================================================================
// NutTreeDriver
// ============================================================================

// Default cap for screenshot dimensions (longest side, in UI-pixel units).
// Chosen to fit comfortably within the preferred input sizes of all major
// vision LLMs (OpenAI ~1024, Anthropic ~1568, Gemini ~3072). Larger images
// consistently hurt AI coordinate-prediction accuracy.
const DEFAULT_SCREENSHOT_MAX_DIM = 1280;

export interface NutTreeDriverOptions {
  /** Cap on screenshot long-side in UI pixels. Default 1280. Set to Infinity to disable. */
  screenshotMaxDim?: number;
}

export class NutTreeDriver implements IDesktopDriver {
  private _isInitialized = false;
  private _retinaScale = 1;      // physical / logical
  private _uiScale = 1;          // logical / ui  (applied to all user coords)
  private _logicalWidth = 0;
  private _logicalHeight = 0;
  private _uiWidth = 0;
  private _uiHeight = 0;
  private readonly _screenshotMaxDim: number;

  // Lazy-loaded nut-tree modules
  private _nut: any = null;

  // Cache of Window objects keyed by windowHandle, populated by getWindowList()
  private _windowCache = new Map<number, any>();

  constructor(opts?: NutTreeDriverOptions) {
    this._screenshotMaxDim = opts?.screenshotMaxDim ?? DEFAULT_SCREENSHOT_MAX_DIM;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /** Retina/HiDPI scale factor (physical / logical). Diagnostic only. */
  get scaleFactor(): number {
    return this._retinaScale;
  }

  /** Convert a UI-pixel coordinate to the logical OS coordinate nut-js expects. */
  private uiToLogical(x: number, y: number): { x: number; y: number } {
    return { x: Math.round(x * this._uiScale), y: Math.round(y * this._uiScale) };
  }

  /** Convert a logical OS coordinate to UI-pixel coordinate for the caller. */
  private logicalToUi(x: number, y: number): { x: number; y: number } {
    return { x: Math.round(x / this._uiScale), y: Math.round(y / this._uiScale) };
  }

  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    try {
      this._nut = await import('@nut-tree-fork/nut-js');
    } catch {
      throw new Error(
        '@nut-tree-fork/nut-js is not installed. Install it to use desktop automation tools:\n' +
        '  npm install @nut-tree-fork/nut-js',
      );
    }

    // Note: DO NOT override mouse.config.mouseSpeed. High values (~3000+) cause
    // cursor to land off-target on macOS Retina — the internal interpolation
    // drops the final position. The nut-js default (1000) lands accurately.
    // Keyboard autoDelay is safe to disable for fast typing.
    try {
      const { keyboard } = this._nut;
      if (keyboard.config) {
        keyboard.config.autoDelayMs = 0;
      }
    } catch {
      // Config may not be available in all versions
    }

    // Detect display dimensions and compute both scale factors.
    try {
      const { screen } = this._nut;
      this._logicalWidth = await screen.width();
      this._logicalHeight = await screen.height();

      // Retina scale — compare logical to one raw screenshot
      const probe = await screen.grab();
      this._retinaScale = probe.width / this._logicalWidth;

      // UI scale — how much we shrink logical to fit the cap
      const longestLogical = Math.max(this._logicalWidth, this._logicalHeight);
      this._uiScale = longestLogical > this._screenshotMaxDim
        ? longestLogical / this._screenshotMaxDim
        : 1;
      this._uiWidth = Math.round(this._logicalWidth / this._uiScale);
      this._uiHeight = Math.round(this._logicalHeight / this._uiScale);
    } catch (err: any) {
      if (err.message?.includes('permission') || err.message?.includes('accessibility')) {
        throw new Error(
          'Desktop automation requires accessibility permissions.\n' +
          'On macOS: System Settings → Privacy & Security → Accessibility → Enable your terminal app.',
        );
      }
      // Fall back to identity scales
      this._retinaScale = 1;
      this._uiScale = 1;
    }

    this._isInitialized = true;
  }

  private assertInitialized(): void {
    if (!this._isInitialized) {
      throw new Error('NutTreeDriver not initialized. Call initialize() first.');
    }
  }

  // ===== Screen =====

  async screenshot(region?: { x: number; y: number; width: number; height: number }): Promise<DesktopScreenshot> {
    this.assertInitialized();
    const { screen } = this._nut;

    let image: any;
    let outWidth: number;
    let outHeight: number;

    if (region) {
      // Region is in UI space — convert to logical for nut-js grabRegion()
      const { Region } = this._nut;
      const logTopLeft = this.uiToLogical(region.x, region.y);
      const logW = Math.round(region.width * this._uiScale);
      const logH = Math.round(region.height * this._uiScale);
      const nutRegion = new Region(logTopLeft.x, logTopLeft.y, logW, logH);
      image = await screen.grabRegion(nutRegion);
      // Returned image is at physical dims; output at UI dims (what AI sees)
      outWidth = region.width;
      outHeight = region.height;
    } else {
      image = await screen.grab();
      outWidth = this._uiWidth;
      outHeight = this._uiHeight;
    }

    let rgbaBuffer: Buffer | Uint8Array = image.data;
    if (image.width !== outWidth || image.height !== outHeight) {
      rgbaBuffer = downsampleRGBA(image.data, image.width, image.height, outWidth, outHeight);
    }

    const pngBuffer = await encodeRGBAToPNG(rgbaBuffer, outWidth, outHeight);
    const base64 = pngBuffer.toString('base64');

    return {
      base64,
      width: outWidth,
      height: outHeight,
    };
  }

  async getScreenSize(): Promise<DesktopScreenSize> {
    this.assertInitialized();

    return {
      physicalWidth: Math.round(this._logicalWidth * this._retinaScale),
      physicalHeight: Math.round(this._logicalHeight * this._retinaScale),
      logicalWidth: this._uiWidth,
      logicalHeight: this._uiHeight,
      scaleFactor: this._retinaScale,
    };
  }

  // ===== Mouse =====
  // All coordinates are in UI-pixel space (same as the PNG from screenshot()).
  // Driver converts to logical OS coords internally via uiScale.
  // Note: mouse.setPosition() is broken in @nut-tree-fork/nut-js (no-ops silently).
  // Use mouse.move(straightTo(...)) instead.

  async mouseMove(x: number, y: number): Promise<void> {
    this.assertInitialized();
    const { mouse, straightTo, Point } = this._nut;
    const logical = this.uiToLogical(x, y);
    await mouse.move(straightTo(new Point(logical.x, logical.y)));
  }

  async mouseClick(x: number, y: number, button: MouseButton, clickCount: number): Promise<void> {
    this.assertInitialized();
    const { mouse, straightTo, Point, Button } = this._nut;

    const nutButton = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;
    const logical = this.uiToLogical(x, y);
    await mouse.move(straightTo(new Point(logical.x, logical.y)));

    for (let i = 0; i < clickCount; i++) {
      await mouse.click(nutButton);
    }
  }

  async mouseDrag(startX: number, startY: number, endX: number, endY: number, button: MouseButton): Promise<void> {
    this.assertInitialized();
    const { mouse, straightTo, Point, Button } = this._nut;

    const nutButton = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;
    const logStart = this.uiToLogical(startX, startY);
    const logEnd = this.uiToLogical(endX, endY);

    await mouse.move(straightTo(new Point(logStart.x, logStart.y)));
    await mouse.pressButton(nutButton);
    await mouse.move(straightTo(new Point(logEnd.x, logEnd.y)));
    await mouse.releaseButton(nutButton);
  }

  async mouseScroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void> {
    this.assertInitialized();
    const { mouse, straightTo, Point } = this._nut;

    if (x !== undefined && y !== undefined) {
      const logical = this.uiToLogical(x, y);
      await mouse.move(straightTo(new Point(logical.x, logical.y)));
    }

    if (deltaY !== 0) {
      if (deltaY > 0) {
        await mouse.scrollDown(Math.abs(deltaY));
      } else {
        await mouse.scrollUp(Math.abs(deltaY));
      }
    }

    if (deltaX !== 0) {
      if (deltaX > 0) {
        await mouse.scrollRight(Math.abs(deltaX));
      } else {
        await mouse.scrollLeft(Math.abs(deltaX));
      }
    }
  }

  async getCursorPosition(): Promise<DesktopPoint> {
    this.assertInitialized();
    const { mouse } = this._nut;

    const pos = await mouse.getPosition();
    return this.logicalToUi(pos.x, pos.y);
  }

  // ===== Keyboard =====

  async keyboardType(text: string, delay?: number): Promise<void> {
    this.assertInitialized();
    const { keyboard } = this._nut;

    const prevDelay = keyboard.config.autoDelayMs;
    if (delay !== undefined) {
      keyboard.config.autoDelayMs = delay;
    }

    try {
      await keyboard.type(text);
    } finally {
      if (delay !== undefined) {
        keyboard.config.autoDelayMs = prevDelay;
      }
    }
  }

  async keyboardKey(keys: string): Promise<void> {
    this.assertInitialized();
    const { keyboard, Key } = this._nut;

    const parsedKeys = parseKeyCombo(keys, Key);

    if (parsedKeys.length === 1) {
      await keyboard.pressKey(parsedKeys[0]);
      await keyboard.releaseKey(parsedKeys[0]);
    } else {
      for (const key of parsedKeys) {
        await keyboard.pressKey(key);
      }
      for (const key of [...parsedKeys].reverse()) {
        await keyboard.releaseKey(key);
      }
    }
  }

  // ===== Windows =====

  async getWindowList(): Promise<DesktopWindow[]> {
    this.assertInitialized();
    const { getWindows } = this._nut;

    try {
      const windows = await getWindows();
      const result: DesktopWindow[] = [];
      this._windowCache.clear();

      for (const win of windows) {
        try {
          const handle = (win as any).windowHandle as number;
          if (handle === undefined || handle === null) continue;

          const title = await win.title;
          const region = await win.region;

          this._windowCache.set(handle, win);

          result.push({
            id: handle,
            title: title || '',
            bounds: region ? {
              // nut-js returns window region in logical coords — convert to UI space
              x: Math.round(region.left / this._uiScale),
              y: Math.round(region.top / this._uiScale),
              width: Math.round(region.width / this._uiScale),
              height: Math.round(region.height / this._uiScale),
            } : undefined,
          });
        } catch {
          // Skip windows that can't be queried
        }
      }

      return result;
    } catch {
      return [];
    }
  }

  async focusWindow(windowId: number): Promise<void> {
    this.assertInitialized();

    let target = this._windowCache.get(windowId);

    if (!target) {
      const { getWindows } = this._nut;
      const windows = await getWindows();
      target = windows.find((w: any) => (w as any).windowHandle === windowId);
    }

    if (!target) {
      throw new Error(`Window with ID ${windowId} not found. Call desktop_window_list first to get current window IDs.`);
    }

    await target.focus();
  }
}
