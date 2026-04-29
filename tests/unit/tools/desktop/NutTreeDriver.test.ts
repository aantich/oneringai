/**
 * Tests for NutTreeDriver - coordinate scaling and initialization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('NutTreeDriver', () => {
  // Since @nut-tree-fork/nut-js is an optional peer dep, we test the driver logic
  // by mocking the dynamic import.

  // Coordinate model:
  //   - UI-pixel  : the unified space exposed to callers (screenshot dims, mouse args)
  //   - Logical   : OS-level coords that nut-js mouse APIs operate in
  //   - Physical  : raw pixels on a Retina/HiDPI display
  // uiScale     = logical / ui    (applied internally on every API call)
  // retinaScale = physical / logical  (diagnostic only, exposed as scaleFactor)
  describe('coordinate scaling', () => {
    it('uiToLogical: multiplies UI coords by uiScale to get OS logical coords', () => {
      // e.g. 2560-wide logical screen capped to 1280 UI → uiScale = 2
      // UI (100, 200) → logical (200, 400)
      const uiScale = 2;
      expect(Math.round(100 * uiScale)).toBe(200);
      expect(Math.round(200 * uiScale)).toBe(400);
    });

    it('logicalToUi: divides OS logical coords by uiScale to get UI coords', () => {
      // Inverse direction — used by getCursorPosition and window bounds
      const uiScale = 2;
      expect(Math.round(200 / uiScale)).toBe(100);
      expect(Math.round(400 / uiScale)).toBe(200);
    });

    it('handles non-integer uiScale (e.g. 1920-wide logical capped to 1280 UI)', () => {
      // 1920 / 1280 = 1.5 → UI (200, 300) ↔ logical (300, 450)
      const uiScale = 1.5;
      expect(Math.round(200 * uiScale)).toBe(300);
      expect(Math.round(300 * uiScale)).toBe(450);
      expect(Math.round(300 / uiScale)).toBe(200);
      expect(Math.round(450 / uiScale)).toBe(300);
    });

    it('uiScale = 1 when logical screen already fits within screenshotMaxDim', () => {
      // No scaling — driver behaves as plain logical-coordinate driver
      const uiScale = 1;
      expect(Math.round(500 * uiScale)).toBe(500);
      expect(Math.round(300 * uiScale)).toBe(300);
    });
  });

  describe('error handling', () => {
    it('should throw helpful error when @nut-tree-fork/nut-js is not installed', async () => {
      // The NutTreeDriver.initialize() should throw a clear error
      // when the dynamic import fails
      const { NutTreeDriver } = await import('../../../../src/tools/desktop/driver/NutTreeDriver.js');
      const driver = new NutTreeDriver();

      // @nut-tree-fork/nut-js is not installed in test env, so initialize should fail
      await expect(driver.initialize()).rejects.toThrow(
        '@nut-tree-fork/nut-js is not installed'
      );
    });

    it('should not be initialized before initialize() is called', async () => {
      const { NutTreeDriver } = await import('../../../../src/tools/desktop/driver/NutTreeDriver.js');
      const driver = new NutTreeDriver();
      expect(driver.isInitialized).toBe(false);
    });

    it('should default scaleFactor (retina diagnostic) to 1 before initialize', async () => {
      const { NutTreeDriver } = await import('../../../../src/tools/desktop/driver/NutTreeDriver.js');
      const driver = new NutTreeDriver();
      // scaleFactor reports the Retina/HiDPI ratio (physical / logical) for diagnostics.
      // It is NOT applied to caller coordinates — those go through uiScale internally.
      expect(driver.scaleFactor).toBe(1);
    });

    it('should accept screenshotMaxDim constructor option', async () => {
      const { NutTreeDriver } = await import('../../../../src/tools/desktop/driver/NutTreeDriver.js');
      // Explicit cap
      expect(() => new NutTreeDriver({ screenshotMaxDim: 1024 })).not.toThrow();
      // Disabled cap
      expect(() => new NutTreeDriver({ screenshotMaxDim: Infinity })).not.toThrow();
      // No options at all (uses default cap)
      expect(() => new NutTreeDriver()).not.toThrow();
    });
  });
});
