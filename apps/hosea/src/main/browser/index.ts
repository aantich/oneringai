/**
 * Browser Automation Module
 *
 * Exports all browser automation types and tools for hosea.
 */

export * from './types.js';
export {
  createBrowserTools,
  BROWSER_TOOL_NAMES,
  type BrowserToolName,
  type DynamicUIEmitCallback,
  type BrowserDynamicUIContent,
} from './tools.js';
export {
  type StealthConfig,
  DEFAULT_STEALTH_CONFIG,
  getRealisticUserAgent,
  getRealisticWebGLFingerprint,
  getStealthScript,
  getStealthHeaders,
  getHeadersToRemove,
  getSecChUaHeaders,
} from './stealth.js';
export {
  type StoredCookie,
  saveCookiesToDisk,
  loadCookiesFromDisk,
  clearPersistedCookies,
  listPersistedSessions,
  saveAllCookies,
} from './persistence.js';
export {
  type Point,
  type MouseMovementStep,
  gaussianRandom,
  gaussianRandomClamped,
  clamp,
  getTypingDelay,
  getWordBoundaryPause,
  shouldInsertMicroPause,
  getMicroPauseDuration,
  getTypingBurstDelays,
  shouldTypeBurst,
  generateBezierPath,
  generateOvershoot,
  getClickOffset,
  getHoverDelay,
  getReactionDelay,
  getScrollAmount,
  getScrollWheelDelay,
  getScrollIncrements,
  getHumanDelay,
} from './humanTiming.js';
