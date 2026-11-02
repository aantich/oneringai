/**
 * Browser Automation Types
 *
 * Type definitions for browser automation tools in hosea.
 * These types are shared between BrowserService and browser tools.
 */

// ============ Navigation Types ============

export interface NavigateOptions {
  /** Wait condition for navigation */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Navigation timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/** Detected overlay/popup information */
export interface DetectedOverlay {
  type: 'modal' | 'popup' | 'cookie_consent' | 'notification' | 'unknown';
  selector: string;
  title?: string;
  text?: string;
  buttons: Array<{ text: string; selector: string; isPrimary: boolean }>;
}

export interface NavigateResult {
  success: boolean;
  /** Final URL after any redirects */
  url: string;
  /** Page title */
  title: string;
  /** Load time in milliseconds */
  loadTime: number;
  /** Detected overlays/popups on the page (auto-checked after navigation) */
  overlays?: DetectedOverlay[];
  error?: string;
}

// ============ Content Extraction Types ============

export type ContentFormat = 'markdown' | 'text' | 'html' | 'json' | 'accessibility';

export interface GetContentOptions {
  /** Format to extract content in */
  format: ContentFormat;
  /** CSS selector to extract (default: whole page) */
  selector?: string;
  /** Truncate output to this length (for token efficiency) */
  maxLength?: number;
  /** Include link URLs in markdown (default: true) */
  includeLinks?: boolean;
  /** Include image descriptions (default: false) */
  includeImages?: boolean;
}

export interface GetContentResult {
  success: boolean;
  /** Extracted content */
  content: string;
  /** Whether content was truncated */
  truncated: boolean;
  /** Original length before truncation */
  contentLength: number;
  /** Format used */
  format: ContentFormat;
  error?: string;
}

// ============ Element Interaction Types ============

export interface ClickOptions {
  /** CSS selector OR text content with "text=" prefix */
  selector: string;
  /** Mouse button (default: 'left') */
  button?: 'left' | 'right' | 'middle';
  /** Click count - 1 for single, 2 for double (default: 1) */
  clickCount?: number;
  /** Wait if click causes navigation (default: false) */
  waitForNavigation?: boolean;
  /** Element wait timeout in ms (default: 5000) */
  timeout?: number;
  /** Enable human-like mouse movement and click offset (default: true) */
  humanLike?: boolean;
}

export interface ClickResult {
  success: boolean;
  /** Info about the clicked element */
  element: {
    tagName: string;
    text: string;
    href?: string;
  };
  /** Whether navigation occurred */
  navigated?: boolean;
  /** URL after navigation (if navigated) */
  newUrl?: string;
  error?: string;
}

export interface TypeOptions {
  /** CSS selector for input/textarea */
  selector: string;
  /** Text to type */
  text: string;
  /** Clear existing content first (default: true) */
  clear?: boolean;
  /** Press Enter after typing (default: false) */
  pressEnter?: boolean;
  /** Delay between keystrokes in ms (default: 0 for fast, set >0 for human-like) */
  delay?: number;
  /** Enable human-like typing patterns with variance and pauses (default: true when delay > 0) */
  humanLike?: boolean;
}

export interface TypeResult {
  success: boolean;
  element: {
    tagName: string;
    type?: string;
    name?: string;
  };
  error?: string;
}

export interface SelectOptions {
  /** CSS selector for select element */
  selector: string;
  /** Select by value attribute */
  value?: string;
  /** Select by visible text */
  label?: string;
  /** Select by index */
  index?: number;
}

export interface SelectResult {
  success: boolean;
  selected: Array<{
    value: string;
    label: string;
  }>;
  error?: string;
}

// ============ Screenshot Types ============

export interface ScreenshotOptions {
  /** CSS selector for element (default: full page) */
  selector?: string;
  /** Capture entire scrollable page (default: false) */
  fullPage?: boolean;
  /** Image format (default: 'png') */
  format?: 'png' | 'jpeg';
  /** JPEG quality 0-100 (default: 80) */
  quality?: number;
}

export interface ScreenshotResult {
  success: boolean;
  /** Base64 data URL of image */
  dataUrl: string;
  width: number;
  height: number;
  error?: string;
}

// ============ Scroll Types ============

export interface ScrollOptions {
  /** Scroll direction */
  direction: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom';
  /** Pixels to scroll (default: viewport height) */
  amount?: number;
  /** Element to scroll (default: page) */
  selector?: string;
  /** Smooth scrolling (default: true) */
  smooth?: boolean;
  /** Enable human-like scroll variance and increments (default: true) */
  humanLike?: boolean;
}

export interface ScrollResult {
  success: boolean;
  scrollPosition: { x: number; y: number };
  error?: string;
}

// ============ Wait Types ============

export interface WaitOptions {
  /** Wait for element to appear */
  selector?: string;
  /** Element state to wait for */
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
  /** Max wait time in ms (default: 30000) */
  timeout?: number;
  /** JavaScript expression that returns boolean */
  condition?: string;
}

export interface WaitResult {
  success: boolean;
  /** Time waited in ms */
  waited: number;
  error?: string;
}

// ============ Evaluate Types ============

export interface EvaluateOptions {
  /** JavaScript code to execute */
  script: string;
  /** Whether to return result (default: true) */
  returnValue?: boolean;
}

export interface EvaluateResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============ Browser State Types ============

export interface BrowserState {
  success: boolean;
  /** Current URL */
  url: string;
  /** Page title */
  title: string;
  /** Whether page is loading */
  isLoading: boolean;
  /** Can navigate back */
  canGoBack: boolean;
  /** Can navigate forward */
  canGoForward: boolean;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  error?: string;
}

// ============ Navigation Control Types ============

export interface NavigationControlResult {
  success: boolean;
  url: string;
  title: string;
  error?: string;
}

// ============ Find Elements Types ============

export interface FindElementsOptions {
  /** CSS selector */
  selector?: string;
  /** Text content contains */
  text?: string;
  /** ARIA role */
  role?: string;
  /** Max results (default: 10) */
  limit?: number;
}

export interface FoundElement {
  /** Unique selector for this element */
  selector: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isInteractive: boolean;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface FindElementsResult {
  success: boolean;
  elements: FoundElement[];
  error?: string;
}

// ============ Browser Instance Types ============

export interface BrowserInstance {
  /** Unique instance ID (matches agent instance) */
  instanceId: string;
  /** BrowserView or similar */
  view: unknown;
  /** Current URL */
  currentUrl: string;
  /** Current page title */
  currentTitle: string;
  /** Whether attached to window */
  isAttached: boolean;
  /** Creation timestamp */
  createdAt: number;
}

// ============ Bounds Types (for attaching BrowserView) ============

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============ Console Types ============

export type ConsoleMessageLevel = 'verbose' | 'info' | 'warning' | 'error';

export interface ConsoleMessage {
  /** Log level */
  level: ConsoleMessageLevel;
  /** Message text */
  message: string;
  /** Source file URL */
  source?: string;
  /** Line number in source */
  line?: number;
  /** Timestamp (ISO string) */
  timestamp: string;
}

export interface ConsoleReadOptions {
  /** Filter by level: 'all' (default), 'errors', 'warnings', 'info' */
  level?: 'all' | 'errors' | 'warnings' | 'info';
  /** Text search (case-insensitive substring match) */
  search?: string;
  /** Max messages to return (default: 100, most recent first) */
  limit?: number;
  /** Clear the buffer after reading (default: false) */
  clear?: boolean;
}

export interface ConsoleReadResult {
  success: boolean;
  messages: ConsoleMessage[];
  /** Total messages in buffer (before filtering) */
  totalBuffered: number;
  /** Whether buffer was cleared */
  cleared: boolean;
  error?: string;
}

// ============ Cookie Types ============

export interface CookieData {
  /** Cookie name */
  name: string;
  /** Cookie value */
  value: string;
  /** Cookie domain */
  domain?: string;
  /** Cookie path */
  path?: string;
  /** Is secure-only cookie */
  secure?: boolean;
  /** Is HTTP-only cookie */
  httpOnly?: boolean;
  /** SameSite attribute */
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  /** Expiration timestamp */
  expirationDate?: number;
}

export interface ExportCookiesResult {
  success: boolean;
  cookies?: CookieData[];
  error?: string;
}

export interface ImportCookiesResult {
  success: boolean;
  imported?: number;
  error?: string;
}

export interface ClearCookiesResult {
  success: boolean;
  error?: string;
}
