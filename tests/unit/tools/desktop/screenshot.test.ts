/**
 * Tests for desktop_screenshot tool - __images convention
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDesktopDriver, DesktopScreenshot, DesktopScreenSize, DesktopPoint, DesktopWindow, MouseButton } from '../../../../src/tools/desktop/types.js';
import { createDesktopScreenshotTool } from '../../../../src/tools/desktop/screenshot.js';

/**
 * Mock driver for testing
 */
function createMockDriver(overrides?: Partial<IDesktopDriver>): IDesktopDriver {
  // Mock scenario: 2560×1600 physical Retina display, logical 1280×800.
  // Driver caps screenshots at the logical dims (≤ default screenshotMaxDim 1280),
  // so the screenshot dimensions match the logical/UI coordinate space —
  // the same space mouseClick/mouseMove arguments live in.
  return {
    isInitialized: true,
    scaleFactor: 2, // retina diagnostic only — not applied to caller coords
    initialize: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue({
      base64: 'dGVzdGltYWdl', // "testimage" in base64
      width: 1280,
      height: 800,
    } satisfies DesktopScreenshot),
    getScreenSize: vi.fn().mockResolvedValue({
      physicalWidth: 2560,
      physicalHeight: 1600,
      logicalWidth: 1280,
      logicalHeight: 800,
      scaleFactor: 2,
    } satisfies DesktopScreenSize),
    mouseMove: vi.fn().mockResolvedValue(undefined),
    mouseClick: vi.fn().mockResolvedValue(undefined),
    mouseDrag: vi.fn().mockResolvedValue(undefined),
    mouseScroll: vi.fn().mockResolvedValue(undefined),
    getCursorPosition: vi.fn().mockResolvedValue({ x: 100, y: 200 } satisfies DesktopPoint),
    keyboardType: vi.fn().mockResolvedValue(undefined),
    keyboardKey: vi.fn().mockResolvedValue(undefined),
    getWindowList: vi.fn().mockResolvedValue([] as DesktopWindow[]),
    focusWindow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('desktopScreenshot tool', () => {
  it('should return __images array in result', async () => {
    const mockDriver = createMockDriver();
    const tool = createDesktopScreenshotTool({ driver: mockDriver });
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    expect(result.__images).toBeDefined();
    expect(result.__images).toHaveLength(1);
    expect(result.__images![0]).toEqual({
      base64: 'dGVzdGltYWdl',
      mediaType: 'image/png',
    });
  });

  it('should include dimensions in result (in UI-pixel / mouse-coord space)', async () => {
    const mockDriver = createMockDriver();
    const tool = createDesktopScreenshotTool({ driver: mockDriver });
    const result = await tool.execute({});

    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it('should include base64 in result for text summary', async () => {
    const mockDriver = createMockDriver();
    const tool = createDesktopScreenshotTool({ driver: mockDriver });
    const result = await tool.execute({});

    expect(result.base64).toBe('dGVzdGltYWdl');
  });

  it('should pass region to driver', async () => {
    const mockDriver = createMockDriver();
    const tool = createDesktopScreenshotTool({ driver: mockDriver });
    const region = { x: 100, y: 200, width: 500, height: 300 };
    await tool.execute({ region });

    expect(mockDriver.screenshot).toHaveBeenCalledWith(region);
  });

  it('should handle driver errors gracefully', async () => {
    const mockDriver = createMockDriver({
      screenshot: vi.fn().mockRejectedValue(new Error('Permission denied')),
    });
    const tool = createDesktopScreenshotTool({ driver: mockDriver });
    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
    expect(result.__images).toBeUndefined();
  });

  it('should have correct tool definition', () => {
    const mockDriver = createMockDriver();
    const tool = createDesktopScreenshotTool({ driver: mockDriver });

    expect(tool.definition.function.name).toBe('desktop_screenshot');
    expect(tool.definition.type).toBe('function');
    expect(tool.definition.function.parameters).toBeDefined();
  });

  it('should describe call correctly', () => {
    const mockDriver = createMockDriver();
    const tool = createDesktopScreenshotTool({ driver: mockDriver });

    expect(tool.describeCall!({})).toBe('full screen');
    expect(tool.describeCall!({ region: { x: 10, y: 20, width: 100, height: 50 } }))
      .toBe('region (10,20) 100x50');
  });
});
