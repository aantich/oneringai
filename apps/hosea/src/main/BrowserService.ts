/**
 * BrowserService - Manages BrowserView instances for browser automation
 *
 * This service handles:
 * - Creation/destruction of BrowserView instances (one per agent instance)
 * - Navigation, interaction, and content extraction
 * - Event emission for UI updates
 * - Attachment/detachment to/from the main window for display
 */

import { BrowserView, BrowserWindow, session, Session } from 'electron';
import { EventEmitter } from 'events';
import type {
  NavigateOptions,
  NavigateResult,
  GetContentOptions,
  GetContentResult,
  ClickOptions,
  ClickResult,
  TypeOptions,
  TypeResult,
  SelectOptions,
  SelectResult,
  ScreenshotOptions,
  ScreenshotResult,
  ScrollOptions,
  ScrollResult,
  WaitOptions,
  WaitResult,
  EvaluateOptions,
  EvaluateResult,
  BrowserState,
  NavigationControlResult,
  FindElementsOptions,
  FindElementsResult,
  Rectangle,
  BrowserInstance,
} from './browser/types.js';
import {
  type StealthConfig,
  DEFAULT_STEALTH_CONFIG,
  getRealisticUserAgent,
  getStealthScript,
  getStealthHeaders,
  getHeadersToRemove,
} from './browser/stealth.js';
import {
  saveCookiesToDisk,
  loadCookiesFromDisk,
} from './browser/persistence.js';
import {
  type Point,
  getTypingDelay,
  getWordBoundaryPause,
  shouldInsertMicroPause,
  getMicroPauseDuration,
  shouldTypeBurst,
  getTypingBurstDelays,
  generateBezierPath,
  getClickOffset,
  getHoverDelay,
  getReactionDelay,
  getScrollAmount,
  getScrollIncrements,
  getScrollWheelDelay,
  getHumanDelay,
} from './browser/humanTiming.js';

// Default timeouts
const DEFAULT_NAVIGATION_TIMEOUT = 30000;
const DEFAULT_ELEMENT_TIMEOUT = 5000;
const DEFAULT_WAIT_TIMEOUT = 30000;

// URL validation
const BLOCKED_SCHEMES = ['javascript:', 'data:', 'file:'];

/**
 * BrowserService manages BrowserView instances for browser automation
 */
export class BrowserService extends EventEmitter {
  /** Map of instanceId -> BrowserView */
  private browsers: Map<string, BrowserView> = new Map();

  /** Map of instanceId -> BrowserInstance metadata */
  private instances: Map<string, BrowserInstance> = new Map();

  /** Reference to main window for attaching BrowserViews */
  private mainWindow: BrowserWindow | null = null;

  /** Stealth configuration for anti-bot bypass */
  private stealthConfig: StealthConfig;

  /** Track last known mouse position per instance for human-like movement */
  private mousePositions: Map<string, Point> = new Map();

  constructor(mainWindow: BrowserWindow | null = null, stealthConfig?: Partial<StealthConfig>) {
    super();
    this.mainWindow = mainWindow;
    this.stealthConfig = { ...DEFAULT_STEALTH_CONFIG, ...stealthConfig };
  }

  /**
   * Update stealth configuration
   */
  setStealthConfig(config: Partial<StealthConfig>): void {
    this.stealthConfig = { ...this.stealthConfig, ...config };
  }

  /**
   * Get current stealth configuration
   */
  getStealthConfig(): StealthConfig {
    return { ...this.stealthConfig };
  }

  /**
   * Set the main window reference (called when window is created)
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Execute JavaScript in page context with enforced timeout.
   * This prevents hanging when page navigates or context is destroyed.
   */
  private async safeExecuteJavaScript<T>(
    webContents: Electron.WebContents,
    script: string,
    timeoutMs: number = 30000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // Check if webContents is still valid
      if (webContents.isDestroyed()) {
        reject(new Error('WebContents is destroyed'));
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      webContents
        .executeJavaScript(script)
        .then((result: T) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((err: Error) => {
          clearTimeout(timeoutId);
          // Handle common errors gracefully
          if (err.message?.includes('Render frame was disposed') ||
              err.message?.includes('context was destroyed') ||
              err.message?.includes('frame not found')) {
            reject(new Error('Page navigated or closed during script execution'));
          } else {
            reject(err);
          }
        });
    });
  }

  /**
   * Validate URL for navigation
   */
  private validateUrl(url: string): { valid: boolean; error?: string; normalizedUrl?: string } {
    try {
      // Handle relative URLs or URLs without protocol
      let normalizedUrl = url;
      if (!url.includes('://')) {
        normalizedUrl = 'https://' + url;
      }

      const parsed = new URL(normalizedUrl);

      // Block dangerous schemes
      for (const scheme of BLOCKED_SCHEMES) {
        if (normalizedUrl.toLowerCase().startsWith(scheme)) {
          return { valid: false, error: `Blocked URL scheme: ${scheme}` };
        }
      }

      // Upgrade http to https for security (optional, can be disabled)
      if (parsed.protocol === 'http:') {
        normalizedUrl = 'https:' + normalizedUrl.slice(5);
      }

      return { valid: true, normalizedUrl };
    } catch (error) {
      return { valid: false, error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Create a new browser instance for an agent instance
   */
  async createBrowser(instanceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if browser already exists
      if (this.browsers.has(instanceId)) {
        return { success: true }; // Already exists
      }

      // Create a dedicated session partition for this instance (isolation)
      const partition = `persist:browser_${instanceId}`;

      // Create BrowserView with isolated session
      const view = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition,
          // Allow DevTools for debugging during development
          devTools: process.env.NODE_ENV === 'development',
        },
      });

      // Store the view
      this.browsers.set(instanceId, view);

      // Create instance metadata
      const instance: BrowserInstance = {
        instanceId,
        view,
        currentUrl: '',
        currentTitle: '',
        isAttached: false,
        createdAt: Date.now(),
      };
      this.instances.set(instanceId, instance);

      // Set up event listeners on the webContents
      const webContents = view.webContents;

      // ============ Apply Stealth Configuration ============
      if (this.stealthConfig.enabled) {
        // 1. Set realistic user agent
        const userAgent = this.stealthConfig.userAgent || getRealisticUserAgent(this.stealthConfig.platform);
        webContents.setUserAgent(userAgent);

        // 2. Set up header interception
        const ses = session.fromPartition(partition);
        this.setupStealthHeaders(ses, userAgent);

        // 3. Inject stealth script on every page load
        webContents.on('dom-ready', () => {
          webContents.executeJavaScript(getStealthScript(this.stealthConfig)).catch((err) => {
            console.warn(`[BrowserService] Stealth script injection warning:`, err.message);
          });
        });

        console.log(`[BrowserService] Stealth mode enabled for ${instanceId}`);
      }

      // ============ Load Persisted Cookies ============
      // Load any saved cookies from previous sessions for this partition
      const cookieResult = await loadCookiesFromDisk(partition);
      if (cookieResult.count > 0) {
        console.log(`[BrowserService] Restored ${cookieResult.count} cookies for ${instanceId}`);
      }

      webContents.on('did-navigate', (_event, url) => {
        instance.currentUrl = url;
        this.emit('browser:navigate', instanceId, url);
      });

      webContents.on('page-title-updated', (_event, title) => {
        instance.currentTitle = title;
        this.emit('browser:title-change', instanceId, title);
      });

      webContents.on('did-start-loading', () => {
        this.emit('browser:loading', instanceId, true);
      });

      webContents.on('did-stop-loading', () => {
        this.emit('browser:loading', instanceId, false);
      });

      webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        this.emit('browser:error', instanceId, { errorCode, errorDescription, url: validatedURL });
      });

      // ============ Handle Browser Dialogs (alert/confirm/prompt) ============
      // Auto-handle JavaScript dialogs to prevent blocking
      webContents.on('will-prevent-unload', (event) => {
        // Prevent "Are you sure you want to leave?" dialogs from blocking
        event.preventDefault();
      });

      // Handle new window requests (popups)
      webContents.setWindowOpenHandler(({ url }) => {
        // Log popup attempts and navigate in same window instead
        console.log(`[BrowserService] Popup blocked, navigating to: ${url}`);
        webContents.loadURL(url).catch(() => {});
        return { action: 'deny' };
      });

      // ============ Auto-dismiss Cookie Consent on Page Load ============
      webContents.on('did-finish-load', () => {
        // Run cookie consent dismissal script after page loads
        this.autoDismissCookieConsent(webContents).catch((err) => {
          // Silently ignore errors - cookie consent may not exist
          console.debug(`[BrowserService] Cookie consent auto-dismiss:`, err.message);
        });

        // Inject overlay watcher after page loads
        this.injectOverlayWatcher(webContents).catch((err) => {
          console.debug(`[BrowserService] Overlay watcher injection:`, err.message);
        });
      });

      // ============ Listen for Overlay Detection from Page ============
      // The injected script sends messages via console.log with a special prefix
      webContents.on('console-message', (_event, _level, message) => {
        if (message.startsWith('__HOSEA_OVERLAY__:')) {
          try {
            const overlayData = JSON.parse(message.slice('__HOSEA_OVERLAY__:'.length));
            console.log(`[BrowserService] Overlay detected: ${overlayData.type}`);
            this.emit('browser:overlay-detected', instanceId, overlayData);
          } catch (e) {
            // Ignore parse errors
          }
        }
      });

      console.log(`[BrowserService] Created browser instance: ${instanceId}`);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserService] Error creating browser:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set up stealth headers for a session
   */
  private setupStealthHeaders(ses: Session, userAgent: string): void {
    const stealthHeaders = getStealthHeaders(this.stealthConfig);
    const headersToRemove = getHeadersToRemove();

    ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };

      // Add stealth headers
      for (const [key, value] of Object.entries(stealthHeaders)) {
        requestHeaders[key] = value;
      }

      // Remove Electron-specific headers
      for (const header of headersToRemove) {
        delete requestHeaders[header];
      }

      // Ensure User-Agent is set
      requestHeaders['User-Agent'] = userAgent;

      callback({ requestHeaders });
    });
  }

  /**
   * Auto-dismiss cookie consent banners
   * Attempts to find and click common accept buttons
   */
  private async autoDismissCookieConsent(webContents: Electron.WebContents): Promise<void> {
    const dismissScript = `
      (function() {
        // Common cookie consent button selectors and text patterns
        const acceptPatterns = [
          // By ID
          '#accept-cookies', '#acceptCookies', '#accept-all', '#acceptAll',
          '#cookie-accept', '#cookieAccept', '#onetrust-accept-btn-handler',
          '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
          '#didomi-notice-agree-button', '#tarteaucitronPersonalize2',
          // By class
          '.accept-cookies', '.acceptCookies', '.cookie-accept', '.cookieAccept',
          '.accept-all', '.acceptAll', '.consent-accept', '.cc-accept',
          '.cc-allow', '.cc-btn-accept', '.cookie-consent-accept',
          '.js-accept-cookies', '.gdpr-accept', '.cookie-notice-accept',
          // By data attributes
          '[data-action="accept"]', '[data-consent="accept"]',
          '[data-cookie-accept]', '[data-testid="cookie-accept"]',
          // By aria-label
          '[aria-label*="Accept"]', '[aria-label*="accept"]',
          '[aria-label*="Agree"]', '[aria-label*="agree"]',
        ];

        const buttonTextPatterns = [
          /^accept$/i, /^accept all$/i, /^accept cookies$/i,
          /^i accept$/i, /^i agree$/i, /^agree$/i, /^allow$/i,
          /^allow all$/i, /^ok$/i, /^got it$/i, /^understood$/i,
          /^continue$/i, /^dismiss$/i, /^close$/i,
          /^akzeptieren$/i, /^alle akzeptieren$/i, // German
          /^accepter$/i, /^tout accepter$/i, // French
          /^aceptar$/i, /^aceptar todo$/i, // Spanish
        ];

        // Try to find and click accept button
        function findAndClick() {
          // First try direct selectors
          for (const selector of acceptPatterns) {
            try {
              const el = document.querySelector(selector);
              if (el && isVisible(el)) {
                el.click();
                console.log('[CookieConsent] Clicked:', selector);
                return true;
              }
            } catch (e) {}
          }

          // Then try finding buttons by text
          const buttons = document.querySelectorAll('button, a, span, div[role="button"]');
          for (const btn of buttons) {
            const text = btn.textContent?.trim() || '';
            for (const pattern of buttonTextPatterns) {
              if (pattern.test(text) && isVisible(btn)) {
                btn.click();
                console.log('[CookieConsent] Clicked by text:', text);
                return true;
              }
            }
          }

          return false;
        }

        function isVisible(el) {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' &&
                 style.visibility !== 'hidden' &&
                 style.opacity !== '0' &&
                 el.offsetParent !== null;
        }

        // Try immediately and then after a short delay (for lazy-loaded banners)
        if (!findAndClick()) {
          setTimeout(findAndClick, 1000);
        }
      })()
    `;

    await webContents.executeJavaScript(dismissScript);
  }

  /**
   * Inject overlay watcher using MutationObserver
   * Monitors for popups/modals appearing and reports them via console message
   */
  private async injectOverlayWatcher(webContents: Electron.WebContents): Promise<void> {
    const watcherScript = `
      (function() {
        // Avoid re-injecting
        if (window.__hoseaOverlayWatcher) return;
        window.__hoseaOverlayWatcher = true;

        // Track already-reported overlays to avoid spam
        const reportedOverlays = new Set();

        // Debounce reporting
        let reportTimeout = null;
        const pendingOverlays = [];

        function isOverlayElement(el) {
          if (!el || el.nodeType !== 1) return false;

          const style = window.getComputedStyle(el);
          const position = style.position;
          const zIndex = parseInt(style.zIndex) || 0;
          const display = style.display;
          const visibility = style.visibility;

          // Must be visible
          if (display === 'none' || visibility === 'hidden' || style.opacity === '0') return false;

          // Must be positioned (fixed or absolute with high z-index)
          if (!((position === 'fixed' || position === 'absolute') && zIndex > 100)) return false;

          // Check size - must be meaningful
          const rect = el.getBoundingClientRect();
          if (rect.width < 150 || rect.height < 100) return false;

          // Check if it's covering a significant portion or centered (modal-like)
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const coverageX = rect.width / viewportWidth;
          const coverageY = rect.height / viewportHeight;
          const isCentered = Math.abs((rect.left + rect.width/2) - viewportWidth/2) < viewportWidth * 0.3;

          // Either covers significant area or is centered (modal)
          if (coverageX < 0.2 && coverageY < 0.2 && !isCentered) return false;

          return true;
        }

        function analyzeOverlay(el) {
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.toLowerCase() || '';
          const classes = el.className?.toLowerCase() || '';
          const id = el.id?.toLowerCase() || '';

          // Determine type
          let type = 'unknown';
          if (text.includes('cookie') || text.includes('consent') || text.includes('gdpr') ||
              classes.includes('cookie') || classes.includes('consent') || id.includes('cookie')) {
            type = 'cookie_consent';
          } else if (classes.includes('modal') || id.includes('modal') ||
                     el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') {
            type = 'modal';
          } else if (classes.includes('popup') || id.includes('popup') ||
                     classes.includes('overlay') || id.includes('overlay')) {
            type = 'popup';
          } else if (classes.includes('notification') || classes.includes('toast') ||
                     classes.includes('alert') || classes.includes('banner')) {
            type = 'notification';
          }

          // Find buttons
          const buttons = [];
          const buttonEls = el.querySelectorAll('button, a[role="button"], [type="submit"], .btn, .button');
          for (let i = 0; i < Math.min(buttonEls.length, 5); i++) {
            const btn = buttonEls[i];
            const btnText = btn.textContent?.trim() || '';
            if (btnText && btnText.length < 50) {
              buttons.push(btnText);
            }
          }

          // Get title
          const headings = el.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="header"]');
          const title = headings.length > 0 ? headings[0].textContent?.trim().slice(0, 100) : undefined;

          // Generate selector
          let selector = '';
          if (el.id) {
            selector = '#' + el.id;
          } else if (el.className && typeof el.className === 'string') {
            selector = '.' + el.className.split(' ').filter(c => c).slice(0, 2).join('.');
          }

          return {
            type,
            selector,
            title,
            text: el.textContent?.trim().slice(0, 150),
            buttons,
            position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          };
        }

        function reportOverlay(overlay) {
          // Create unique key for this overlay
          const key = overlay.selector || overlay.title || overlay.text?.slice(0, 50);
          if (reportedOverlays.has(key)) return;
          reportedOverlays.add(key);

          // Report via console (picked up by Electron)
          console.log('__HOSEA_OVERLAY__:' + JSON.stringify(overlay));
        }

        function checkNewElement(el) {
          if (isOverlayElement(el)) {
            const overlay = analyzeOverlay(el);
            reportOverlay(overlay);
          }

          // Also check children (for containers that become overlays)
          if (el.querySelectorAll) {
            const children = el.querySelectorAll('*');
            for (const child of children) {
              if (isOverlayElement(child)) {
                const overlay = analyzeOverlay(child);
                reportOverlay(overlay);
              }
            }
          }
        }

        // Set up MutationObserver
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            // Check added nodes
            for (const node of mutation.addedNodes) {
              checkNewElement(node);
            }

            // Check attribute changes (element might become an overlay via style change)
            if (mutation.type === 'attributes' &&
                (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
              checkNewElement(mutation.target);
            }
          }
        });

        // Observe the entire document
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });

        // Also do an initial scan after a short delay
        setTimeout(() => {
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (isOverlayElement(el)) {
              const overlay = analyzeOverlay(el);
              reportOverlay(overlay);
            }
          }
        }, 1000);

        console.log('[EW Desktop] Overlay watcher installed');
      })()
    `;

    await webContents.executeJavaScript(watcherScript);
  }

  /**
   * Destroy a browser instance
   */
  async destroyBrowser(instanceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: true }; // Already destroyed or never existed
      }

      // ============ Save Cookies Before Destroying ============
      // Persist cookies for future sessions
      const partition = `persist:browser_${instanceId}`;
      try {
        const saveResult = await saveCookiesToDisk(partition);
        if (saveResult.count > 0) {
          console.log(`[BrowserService] Saved ${saveResult.count} cookies for ${instanceId}`);
        }
      } catch (err) {
        console.warn(`[BrowserService] Failed to save cookies for ${instanceId}:`, err);
      }

      // Detach from window if attached
      if (this.mainWindow && this.instances.get(instanceId)?.isAttached) {
        try {
          this.mainWindow.removeBrowserView(view);
        } catch {
          // Ignore errors during removal
        }
      }

      // Remove all event listeners before closing to prevent leaks
      try {
        view.webContents.removeAllListeners();
      } catch {
        // Ignore errors during listener cleanup
      }

      // Destroy the web contents
      try {
        view.webContents.close();
      } catch {
        // Ignore errors during close
      }

      // Remove from maps
      this.browsers.delete(instanceId);
      this.instances.delete(instanceId);
      this.mousePositions.delete(instanceId);

      console.log(`[BrowserService] Destroyed browser instance: ${instanceId}`);
      this.emit('browser:destroyed', instanceId);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserService] Error destroying browser:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Navigate to a URL
   */
  async navigate(
    instanceId: string,
    url: string,
    options: NavigateOptions = {}
  ): Promise<NavigateResult> {
    const startTime = Date.now();

    try {
      // Ensure browser exists
      let view = this.browsers.get(instanceId);
      if (!view) {
        // Auto-create browser if it doesn't exist
        const createResult = await this.createBrowser(instanceId);
        if (!createResult.success) {
          return {
            success: false,
            url: '',
            title: '',
            loadTime: 0,
            error: createResult.error || 'Failed to create browser',
          };
        }
        view = this.browsers.get(instanceId)!;
      }

      // Validate URL
      const validation = this.validateUrl(url);
      if (!validation.valid) {
        return {
          success: false,
          url: url,
          title: '',
          loadTime: 0,
          error: validation.error,
        };
      }

      const normalizedUrl = validation.normalizedUrl!;
      const timeout = options.timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
      const waitUntil = options.waitUntil ?? 'load';

      // Create a promise that resolves when navigation completes
      const navigationPromise = new Promise<{ url: string; title: string }>((resolve, reject) => {
        const webContents = view!.webContents;
        let timeoutId: NodeJS.Timeout;

        const cleanup = () => {
          clearTimeout(timeoutId);
          webContents.removeListener('did-finish-load', onLoad);
          webContents.removeListener('did-fail-load', onError);
          webContents.removeListener('dom-ready', onDomReady);
        };

        const onLoad = () => {
          if (waitUntil === 'load') {
            cleanup();
            resolve({
              url: webContents.getURL(),
              title: webContents.getTitle(),
            });
          }
        };

        const onDomReady = () => {
          if (waitUntil === 'domcontentloaded') {
            cleanup();
            resolve({
              url: webContents.getURL(),
              title: webContents.getTitle(),
            });
          }
        };

        const onError = (_event: Electron.Event, errorCode: number, errorDescription: string) => {
          // Ignore aborted errors (usually from redirect)
          if (errorCode === -3) return;

          cleanup();
          reject(new Error(`Navigation failed: ${errorDescription} (code: ${errorCode})`));
        };

        webContents.on('did-finish-load', onLoad);
        webContents.on('dom-ready', onDomReady);
        webContents.on('did-fail-load', onError);

        timeoutId = setTimeout(() => {
          cleanup();
          // For networkidle, resolve with current state after timeout
          if (waitUntil === 'networkidle') {
            resolve({
              url: webContents.getURL(),
              title: webContents.getTitle(),
            });
          } else {
            reject(new Error(`Navigation timeout after ${timeout}ms`));
          }
        }, timeout);
      });

      // Start navigation
      await view.webContents.loadURL(normalizedUrl);

      // Wait for navigation to complete
      const result = await navigationPromise;

      // Update instance metadata
      const instance = this.instances.get(instanceId);
      if (instance) {
        instance.currentUrl = result.url;
        instance.currentTitle = result.title;
      }

      const loadTime = Date.now() - startTime;
      console.log(`[BrowserService] Navigated to ${result.url} in ${loadTime}ms`);

      // Auto-detect overlays after a short delay (for lazy-loaded popups)
      await new Promise((r) => setTimeout(r, 500));
      const overlayResult = await this.detectOverlays(instanceId);
      const overlays = overlayResult.success && overlayResult.overlays.length > 0
        ? overlayResult.overlays.map((o) => ({
            type: o.type as 'modal' | 'popup' | 'cookie_consent' | 'notification' | 'unknown',
            selector: o.selector,
            title: o.title,
            text: o.text?.slice(0, 100),
            buttons: o.buttons,
          }))
        : undefined;

      if (overlays && overlays.length > 0) {
        console.log(`[BrowserService] Detected ${overlays.length} overlay(s) on page`);
      }

      return {
        success: true,
        url: result.url,
        title: result.title,
        loadTime,
        overlays,
      };
    } catch (error) {
      const loadTime = Date.now() - startTime;
      console.error(`[BrowserService] Navigation error:`, error);
      return {
        success: false,
        url: url,
        title: '',
        loadTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get current browser state
   */
  async getState(instanceId: string): Promise<BrowserState> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return {
          success: false,
          url: '',
          title: '',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          viewport: { width: 0, height: 0 },
          error: 'Browser instance not found',
        };
      }

      const webContents = view.webContents;
      const bounds = view.getBounds();

      return {
        success: true,
        url: webContents.getURL(),
        title: webContents.getTitle(),
        isLoading: webContents.isLoading(),
        canGoBack: webContents.canGoBack(),
        canGoForward: webContents.canGoForward(),
        viewport: { width: bounds.width, height: bounds.height },
      };
    } catch (error) {
      return {
        success: false,
        url: '',
        title: '',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        viewport: { width: 0, height: 0 },
        error: String(error),
      };
    }
  }

  /**
   * Navigate back in history
   */
  async goBack(instanceId: string): Promise<NavigationControlResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, url: '', title: '', error: 'Browser instance not found' };
      }

      const webContents = view.webContents;
      if (!webContents.canGoBack()) {
        return { success: false, url: webContents.getURL(), title: webContents.getTitle(), error: 'Cannot go back' };
      }

      webContents.goBack();

      // Wait briefly for navigation
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        success: true,
        url: webContents.getURL(),
        title: webContents.getTitle(),
      };
    } catch (error) {
      return { success: false, url: '', title: '', error: String(error) };
    }
  }

  /**
   * Navigate forward in history
   */
  async goForward(instanceId: string): Promise<NavigationControlResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, url: '', title: '', error: 'Browser instance not found' };
      }

      const webContents = view.webContents;
      if (!webContents.canGoForward()) {
        return { success: false, url: webContents.getURL(), title: webContents.getTitle(), error: 'Cannot go forward' };
      }

      webContents.goForward();

      // Wait briefly for navigation
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        success: true,
        url: webContents.getURL(),
        title: webContents.getTitle(),
      };
    } catch (error) {
      return { success: false, url: '', title: '', error: String(error) };
    }
  }

  /**
   * Reload the current page
   */
  async reload(instanceId: string): Promise<NavigationControlResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, url: '', title: '', error: 'Browser instance not found' };
      }

      const webContents = view.webContents;
      webContents.reload();

      // Wait briefly for navigation to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        success: true,
        url: webContents.getURL(),
        title: webContents.getTitle(),
      };
    } catch (error) {
      return { success: false, url: '', title: '', error: String(error) };
    }
  }

  /**
   * Attach browser view to main window for display
   */
  attachToWindow(instanceId: string, bounds: Rectangle): { success: boolean; error?: string } {
    try {
      if (!this.mainWindow) {
        return { success: false, error: 'Main window not available' };
      }

      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      // Add to window
      this.mainWindow.addBrowserView(view);

      // Set bounds
      view.setBounds(bounds);
      view.setAutoResize({ width: true, height: true, horizontal: false, vertical: false });

      // Update metadata
      const instance = this.instances.get(instanceId);
      if (instance) {
        instance.isAttached = true;
      }

      console.log(`[BrowserService] Attached browser ${instanceId} to window`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Detach browser view from main window
   */
  detachFromWindow(instanceId: string): { success: boolean; error?: string } {
    try {
      if (!this.mainWindow) {
        return { success: false, error: 'Main window not available' };
      }

      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      // Remove from window
      this.mainWindow.removeBrowserView(view);

      // Update metadata
      const instance = this.instances.get(instanceId);
      if (instance) {
        instance.isAttached = false;
      }

      console.log(`[BrowserService] Detached browser ${instanceId} from window`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update bounds of attached browser view
   */
  updateBounds(instanceId: string, bounds: Rectangle): { success: boolean; error?: string } {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      view.setBounds(bounds);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get browser instance metadata
   */
  getInstanceInfo(instanceId: string): BrowserInstance | null {
    return this.instances.get(instanceId) || null;
  }

  /**
   * Get all browser instances
   */
  getAllInstances(): BrowserInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Check if browser instance exists
   */
  hasBrowser(instanceId: string): boolean {
    return this.browsers.has(instanceId);
  }

  /**
   * Destroy all browser instances (cleanup)
   */
  async destroyAll(): Promise<void> {
    const instanceIds = Array.from(this.browsers.keys());
    for (const instanceId of instanceIds) {
      await this.destroyBrowser(instanceId);
    }
  }

  // ============ Interaction Methods ============

  /**
   * Click an element on the page with human-like mouse movement
   */
  async click(instanceId: string, options: ClickOptions): Promise<ClickResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, element: { tagName: '', text: '' }, error: 'Browser instance not found' };
      }

      const timeout = options.timeout ?? DEFAULT_ELEMENT_TIMEOUT;
      const clickCount = options.clickCount ?? 1;
      const button = options.button ?? 'left';
      const waitForNavigation = options.waitForNavigation ?? false;
      const humanLike = options.humanLike ?? true;

      const webContents = view.webContents;

      // First, find element and get its position
      const findScript = `
        (async function() {
          const selector = ${JSON.stringify(options.selector)};
          const timeout = ${timeout};

          // Helper to find element by selector or text
          function findElement(sel) {
            if (sel.startsWith('text=')) {
              const text = sel.slice(5);
              const xpath = '//*[contains(text(), "' + text.replace(/"/g, '\\"') + '")]';
              const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              return result.singleNodeValue;
            }
            return document.querySelector(sel);
          }

          // Wait for element with timeout
          async function waitForElement(sel, timeoutMs) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const el = findElement(sel);
              if (el) return el;
              await new Promise(r => setTimeout(r, 100));
            }
            return null;
          }

          const element = await waitForElement(selector, timeout);
          if (!element) {
            return { success: false, error: 'Element not found: ' + selector };
          }

          // Scroll into view
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          await new Promise(r => setTimeout(r, 100));

          // Get element info and bounding box
          const rect = element.getBoundingClientRect();
          const tagName = element.tagName.toLowerCase();
          const text = (element.textContent || '').slice(0, 100).trim();
          const href = element.href || undefined;

          return {
            success: true,
            element: { tagName, text, href },
            rect: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
              centerX: rect.left + rect.width / 2,
              centerY: rect.top + rect.height / 2
            }
          };
        })()
      `;

      const findResult = await this.safeExecuteJavaScript<{
        success: boolean;
        error?: string;
        element?: { tagName: string; text: string; href?: string };
        rect?: { x: number; y: number; width: number; height: number; centerX: number; centerY: number };
      }>(webContents, findScript, timeout + 5000);

      if (!findResult.success || !findResult.rect) {
        return { success: false, element: { tagName: '', text: '' }, error: findResult.error };
      }

      const { rect } = findResult;

      // Calculate click position (with offset for human-like behavior)
      let clickX: number;
      let clickY: number;

      if (humanLike) {
        const offset = getClickOffset(rect.width, rect.height);
        clickX = rect.centerX + offset.x;
        clickY = rect.centerY + offset.y;
      } else {
        clickX = rect.centerX;
        clickY = rect.centerY;
      }

      // Set up navigation listener if needed
      let navigationPromise: Promise<string> | null = null;
      if (waitForNavigation) {
        navigationPromise = new Promise<string>((resolve) => {
          const onNavigate = (_event: unknown, url: string) => {
            webContents.removeListener('did-navigate', onNavigate);
            resolve(url);
          };
          webContents.on('did-navigate', onNavigate);
          setTimeout(() => {
            webContents.removeListener('did-navigate', onNavigate);
            resolve('');
          }, DEFAULT_NAVIGATION_TIMEOUT);
        });
      }

      if (humanLike) {
        // Get starting position (last known or random viewport location)
        let startPos = this.mousePositions.get(instanceId);
        if (!startPos) {
          // Random starting position in viewport
          const viewportScript = `({ width: window.innerWidth, height: window.innerHeight })`;
          const viewport = await this.safeExecuteJavaScript<{ width: number; height: number }>(
            webContents, viewportScript, 1000
          );
          startPos = {
            x: Math.random() * (viewport?.width || 1000),
            y: Math.random() * (viewport?.height || 700),
          };
        }

        // Reaction delay before starting to move
        await new Promise((r) => setTimeout(r, getReactionDelay()));

        // Generate bezier path for mouse movement
        const targetPos = { x: clickX, y: clickY };
        const path = generateBezierPath(startPos, targetPos);

        // Simulate mouse movement along the path
        for (const step of path) {
          // Check if browser still exists before each step
          if (!this.browsers.has(instanceId) || webContents.isDestroyed()) {
            return { success: false, element: { tagName: '', text: '' }, error: 'Browser was destroyed during operation' };
          }

          if (step.delay > 0) {
            await new Promise((r) => setTimeout(r, step.delay));
          }

          // Dispatch mousemove event
          const moveScript = `
            (function() {
              const event = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: ${step.point.x},
                clientY: ${step.point.y}
              });
              document.elementFromPoint(${step.point.x}, ${step.point.y})?.dispatchEvent(event);
            })()
          `;
          await this.safeExecuteJavaScript(webContents, moveScript, 500);
        }

        // Hover delay before clicking
        await new Promise((r) => setTimeout(r, getHoverDelay()));

        // Update stored mouse position
        this.mousePositions.set(instanceId, targetPos);
      } else {
        // Simple delay before clicking
        const humanDelay = 50 + Math.random() * 150;
        await new Promise((r) => setTimeout(r, humanDelay));
      }

      // Perform the click
      const clickScript = `
        (function() {
          const x = ${clickX};
          const y = ${clickY};
          const button = ${JSON.stringify(button)};
          const clickCount = ${clickCount};

          const element = document.elementFromPoint(x, y);
          if (!element) {
            return { success: false, error: 'No element at click position' };
          }

          const buttonNum = button === 'left' ? 0 : button === 'right' ? 2 : 1;
          const eventInit = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: buttonNum,
            buttons: 1 << buttonNum
          };

          // Dispatch mouseenter and mouseover first (for hover effects)
          element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
          element.dispatchEvent(new MouseEvent('mouseover', eventInit));

          for (let i = 0; i < clickCount; i++) {
            element.dispatchEvent(new MouseEvent('mousedown', eventInit));
            element.dispatchEvent(new MouseEvent('mouseup', eventInit));
            element.dispatchEvent(new MouseEvent('click', { ...eventInit, detail: i + 1 }));
          }

          // Focus the element if it's focusable
          if (element.focus) {
            element.focus();
          }

          return { success: true };
        })()
      `;

      const clickResult = await this.safeExecuteJavaScript<{ success: boolean; error?: string }>(
        webContents, clickScript, 5000
      );

      if (!clickResult.success) {
        return { success: false, element: { tagName: '', text: '' }, error: clickResult.error };
      }

      // Wait for navigation if requested
      let navigated = false;
      let newUrl: string | undefined;
      if (navigationPromise) {
        newUrl = await navigationPromise;
        navigated = !!newUrl;
      }

      return {
        success: true,
        element: findResult.element || { tagName: '', text: '' },
        navigated,
        newUrl,
      };
    } catch (error) {
      return { success: false, element: { tagName: '', text: '' }, error: String(error) };
    }
  }

  /**
   * Type text into an input element with human-like timing patterns
   */
  async type(instanceId: string, options: TypeOptions): Promise<TypeResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, element: { tagName: '' }, error: 'Browser instance not found' };
      }

      const clear = options.clear ?? true;
      const pressEnter = options.pressEnter ?? false;
      const delay = options.delay ?? 0;
      // humanLike defaults to true when delay > 0, otherwise false (for speed)
      const humanLike = options.humanLike ?? (delay > 0);

      const webContents = view.webContents;

      // First, find and focus the element
      const findScript = `
        (function() {
          const selector = ${JSON.stringify(options.selector)};
          const element = document.querySelector(selector);
          if (!element) {
            return { success: false, error: 'Element not found: ' + selector };
          }

          // Scroll into view
          element.scrollIntoView({ behavior: 'instant', block: 'center' });

          // Focus the element
          element.focus();

          return {
            success: true,
            element: {
              tagName: element.tagName.toLowerCase(),
              type: element.type,
              name: element.name
            }
          };
        })()
      `;

      const findResult = await this.safeExecuteJavaScript<{
        success: boolean;
        error?: string;
        element?: { tagName: string; type?: string; name?: string };
      }>(webContents, findScript, 5000);
      if (!findResult.success) {
        return { success: false, element: { tagName: '' }, error: findResult.error };
      }

      // Clear existing content if requested
      if (clear) {
        const clearScript = `
          (function() {
            const el = document.querySelector(${JSON.stringify(options.selector)});
            if (el) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `;
        await this.safeExecuteJavaScript(webContents, clearScript, 2000);
      }

      // Type each character with human-like timing patterns
      const text = options.text;
      const baseDelay = delay > 0 ? delay : 50; // Default 50ms for human-like mode
      let inBurst = false;
      let burstDelays: number[] = [];
      let burstIndex = 0;

      for (let i = 0; i < text.length; i++) {
        // Check if browser still exists before each character
        if (!this.browsers.has(instanceId) || webContents.isDestroyed()) {
          return { success: false, element: { tagName: '' }, error: 'Browser was destroyed during operation' };
        }

        const char = text[i];
        const prevChar = i > 0 ? text[i - 1] : null;

        const typeCharScript = `
          (function() {
            const el = document.querySelector(${JSON.stringify(options.selector)});
            if (!el) return;

            const char = ${JSON.stringify(char)};

            // Dispatch keyboard events
            el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

            // Update value
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              el.value += char;
            } else if (el.isContentEditable) {
              el.textContent += char;
            }

            el.dispatchEvent(new InputEvent('input', { data: char, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          })()
        `;
        await this.safeExecuteJavaScript(webContents, typeCharScript, 2000);

        // Calculate delay before next character
        if (i < text.length - 1) {
          let charDelay: number;

          if (humanLike) {
            // Check for micro-pause (rare distraction simulation)
            if (shouldInsertMicroPause(0.02)) {
              await new Promise((resolve) => setTimeout(resolve, getMicroPauseDuration()));
            }

            // Check if we're at a word boundary (space or after punctuation)
            const isWordBoundary = char === ' ' || /[.,!?;:]/.test(char);
            if (isWordBoundary) {
              // Longer pause at word boundaries (thinking time)
              charDelay = getWordBoundaryPause();
              inBurst = false; // Reset burst mode at word boundaries
            } else if (inBurst && burstIndex < burstDelays.length) {
              // Continue typing in burst mode
              charDelay = burstDelays[burstIndex++];
              if (burstIndex >= burstDelays.length) {
                inBurst = false;
              }
            } else if (!inBurst && shouldTypeBurst(0.12)) {
              // Start a new burst (3-6 characters typed quickly)
              const burstLength = 3 + Math.floor(Math.random() * 4);
              burstDelays = getTypingBurstDelays(burstLength);
              burstIndex = 0;
              inBurst = true;
              charDelay = burstDelays[burstIndex++];
            } else {
              // Normal character-by-character timing with Gaussian variance
              charDelay = getTypingDelay(char, prevChar, baseDelay);
            }
          } else {
            // Simple mode: just use base delay with minimal variance
            charDelay = delay > 0 ? delay + Math.random() * 20 : 0;
          }

          if (charDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, charDelay));
          }
        }
      }

      // Press Enter if requested
      if (pressEnter) {
        // Pause before pressing enter (human-like thinking time)
        const enterPause = humanLike ? getHumanDelay(150, 400) : 100 + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, enterPause));

        const enterScript = `
          (function() {
            const el = document.querySelector(${JSON.stringify(options.selector)});
            if (!el) return;

            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

            // Submit form if in a form
            if (el.form) {
              el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          })()
        `;
        await this.safeExecuteJavaScript(webContents, enterScript, 2000);
      }

      return {
        success: true,
        element: findResult.element || { tagName: '' },
      };
    } catch (error) {
      return { success: false, element: { tagName: '' }, error: String(error) };
    }
  }

  /**
   * Select from dropdown
   */
  async select(instanceId: string, options: SelectOptions): Promise<SelectResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, selected: [], error: 'Browser instance not found' };
      }

      // Human-like delay before selecting
      const humanDelay = 30 + Math.random() * 100; // 30-130ms
      await new Promise((r) => setTimeout(r, humanDelay));

      const webContents = view.webContents;

      const selectScript = `
        (function() {
          const selector = ${JSON.stringify(options.selector)};
          const value = ${JSON.stringify(options.value)};
          const label = ${JSON.stringify(options.label)};
          const index = ${JSON.stringify(options.index)};

          const element = document.querySelector(selector);
          if (!element || element.tagName !== 'SELECT') {
            return { success: false, error: 'Select element not found: ' + selector };
          }

          let selected = [];

          if (typeof index === 'number') {
            if (index >= 0 && index < element.options.length) {
              element.selectedIndex = index;
              selected.push({
                value: element.options[index].value,
                label: element.options[index].text
              });
            }
          } else if (value !== undefined && value !== null) {
            for (let opt of element.options) {
              if (opt.value === value) {
                opt.selected = true;
                selected.push({ value: opt.value, label: opt.text });
                break;
              }
            }
          } else if (label !== undefined && label !== null) {
            for (let opt of element.options) {
              if (opt.text === label || opt.text.includes(label)) {
                opt.selected = true;
                selected.push({ value: opt.value, label: opt.text });
                break;
              }
            }
          }

          if (selected.length === 0) {
            return { success: false, error: 'No option matched the criteria' };
          }

          // Dispatch change event
          element.dispatchEvent(new Event('change', { bubbles: true }));

          return { success: true, selected };
        })()
      `;

      const result = await this.safeExecuteJavaScript<SelectResult>(webContents, selectScript, 5000);
      return result;
    } catch (error) {
      return { success: false, selected: [], error: String(error) };
    }
  }

  /**
   * Wait for element or condition.
   * This implementation polls from TypeScript with short JS checks to avoid hanging
   * when page navigates or context is destroyed.
   */
  async wait(instanceId: string, options: WaitOptions): Promise<WaitResult> {
    const view = this.browsers.get(instanceId);
    if (!view) {
      return { success: false, waited: 0, error: 'Browser instance not found' };
    }

    const timeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT;
    const state = options.state ?? 'visible';
    const webContents = view.webContents;
    const startTime = Date.now();

    // Track if navigation occurs - should abort wait
    let navigationOccurred = false;
    let navigationUrl = '';
    const onNavigation = (_event: unknown, url: string) => {
      navigationOccurred = true;
      navigationUrl = url;
    };
    webContents.on('did-start-navigation', onNavigation);

    // Build the quick check script (runs once per poll, no loop)
    const buildCheckScript = () => `
      (function() {
        const selector = ${JSON.stringify(options.selector)};
        const targetState = ${JSON.stringify(state)};
        const condition = ${JSON.stringify(options.condition)};

        // Helper to check element state
        function checkElement(el) {
          if (!el) {
            return targetState === 'detached' || targetState === 'hidden';
          }

          const style = window.getComputedStyle(el);
          const isVisible = style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0' &&
                            el.offsetWidth > 0 &&
                            el.offsetHeight > 0;

          switch (targetState) {
            case 'visible': return isVisible;
            case 'hidden': return !isVisible;
            case 'attached': return true;
            case 'detached': return false;
            default: return isVisible;
          }
        }

        let conditionMet = false;

        if (condition) {
          try {
            conditionMet = eval(condition);
          } catch(e) {
            conditionMet = false;
          }
        } else if (selector) {
          const el = document.querySelector(selector);
          conditionMet = checkElement(el);
        } else {
          // No selector or condition - immediately succeed
          conditionMet = true;
        }

        return { met: conditionMet };
      })()
    `;

    try {
      // Poll with short checks until timeout
      while (Date.now() - startTime < timeout) {
        // Check for navigation - abort if page changed
        if (navigationOccurred) {
          return {
            success: false,
            waited: Date.now() - startTime,
            error: `Page navigated to ${navigationUrl} during wait`,
          };
        }

        // Check if webContents is still valid
        if (webContents.isDestroyed()) {
          return {
            success: false,
            waited: Date.now() - startTime,
            error: 'Browser was closed during wait',
          };
        }

        try {
          // Run quick check with 2 second timeout per check
          const result = await this.safeExecuteJavaScript<{ met: boolean }>(
            webContents,
            buildCheckScript(),
            2000
          );

          if (result.met) {
            return { success: true, waited: Date.now() - startTime };
          }
        } catch (checkError) {
          // Script execution failed - might be due to navigation, continue polling
          // unless it's been too long
          if (Date.now() - startTime > timeout) {
            return {
              success: false,
              waited: Date.now() - startTime,
              error: `Wait check failed: ${checkError}`,
            };
          }
        }

        // Wait before next poll
        await new Promise((r) => setTimeout(r, 200));
      }

      // Timeout reached
      return {
        success: false,
        waited: Date.now() - startTime,
        error: `Timeout after ${timeout}ms waiting for ${options.selector || options.condition || 'condition'}`,
      };
    } finally {
      // Always clean up the navigation listener
      webContents.removeListener('did-start-navigation', onNavigation);
    }
  }

  /**
   * Find elements matching criteria
   */
  async findElements(instanceId: string, options: FindElementsOptions): Promise<FindElementsResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, elements: [], error: 'Browser instance not found' };
      }

      const limit = options.limit ?? 10;
      const webContents = view.webContents;

      const findScript = `
        (function() {
          const cssSelector = ${JSON.stringify(options.selector)};
          const textContent = ${JSON.stringify(options.text)};
          const role = ${JSON.stringify(options.role)};
          const limit = ${limit};

          let elements = [];

          // Find by CSS selector
          if (cssSelector) {
            elements = Array.from(document.querySelectorAll(cssSelector));
          }
          // Find by text content
          else if (textContent) {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_ELEMENT,
              {
                acceptNode: (node) => {
                  if (node.textContent && node.textContent.toLowerCase().includes(textContent.toLowerCase())) {
                    return NodeFilter.FILTER_ACCEPT;
                  }
                  return NodeFilter.FILTER_SKIP;
                }
              }
            );
            while (walker.nextNode() && elements.length < limit * 2) {
              elements.push(walker.currentNode);
            }
          }
          // Find by ARIA role
          else if (role) {
            elements = Array.from(document.querySelectorAll('[role="' + role + '"]'));
          }
          // Find all interactive elements
          else {
            elements = Array.from(document.querySelectorAll(
              'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]'
            ));
          }

          // Process and format results
          const results = [];
          for (let i = 0; i < Math.min(elements.length, limit); i++) {
            const el = elements[i];
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);

            // Check visibility
            const isVisible = style.display !== 'none' &&
                              style.visibility !== 'hidden' &&
                              style.opacity !== '0' &&
                              rect.width > 0 &&
                              rect.height > 0;

            // Check interactivity
            const isInteractive = el.tagName === 'A' ||
                                  el.tagName === 'BUTTON' ||
                                  el.tagName === 'INPUT' ||
                                  el.tagName === 'SELECT' ||
                                  el.tagName === 'TEXTAREA' ||
                                  el.onclick !== null ||
                                  el.getAttribute('role') === 'button' ||
                                  el.getAttribute('tabindex') !== null;

            // Generate unique selector
            let selector = '';
            if (el.id) {
              selector = '#' + el.id;
            } else if (el.className && typeof el.className === 'string') {
              const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
              selector = el.tagName.toLowerCase() + (classes ? '.' + classes : '');
            } else {
              selector = el.tagName.toLowerCase();
            }

            // Get relevant attributes
            const attributes = {};
            ['href', 'type', 'name', 'placeholder', 'role', 'aria-label', 'value', 'src', 'alt'].forEach(attr => {
              if (el.hasAttribute(attr)) {
                attributes[attr] = el.getAttribute(attr);
              }
            });

            results.push({
              selector,
              tagName: el.tagName.toLowerCase(),
              text: (el.textContent || '').slice(0, 200).trim(),
              attributes,
              isVisible,
              isInteractive,
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }

          return { success: true, elements: results };
        })()
      `;

      const result = await this.safeExecuteJavaScript<FindElementsResult>(webContents, findScript, 10000);
      return result;
    } catch (error) {
      return { success: false, elements: [], error: String(error) };
    }
  }

  /**
   * Get page content in various formats
   */
  async getContent(instanceId: string, options: GetContentOptions): Promise<GetContentResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return {
          success: false,
          content: '',
          truncated: false,
          contentLength: 0,
          format: options.format,
          error: 'Browser instance not found',
        };
      }

      const maxLength = options.maxLength ?? 100000;
      const includeLinks = options.includeLinks ?? true;
      const webContents = view.webContents;

      const contentScript = `
        (function() {
          const format = ${JSON.stringify(options.format)};
          const selector = ${JSON.stringify(options.selector)};
          const maxLength = ${maxLength};
          const includeLinks = ${includeLinks};
          const includeImages = ${options.includeImages ?? false};

          const root = selector ? document.querySelector(selector) : document.body;
          if (!root) {
            return { success: false, error: 'Selector not found: ' + selector };
          }

          let content = '';

          switch (format) {
            case 'text':
              content = root.innerText || root.textContent || '';
              break;

            case 'html':
              content = root.innerHTML;
              break;

            case 'markdown':
              // Convert HTML to markdown
              function htmlToMarkdown(element, depth = 0) {
                let md = '';
                for (const node of element.childNodes) {
                  if (node.nodeType === Node.TEXT_NODE) {
                    md += node.textContent;
                  } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toLowerCase();
                    const text = node.textContent?.trim() || '';

                    switch (tag) {
                      case 'h1': md += '\\n# ' + text + '\\n'; break;
                      case 'h2': md += '\\n## ' + text + '\\n'; break;
                      case 'h3': md += '\\n### ' + text + '\\n'; break;
                      case 'h4': md += '\\n#### ' + text + '\\n'; break;
                      case 'h5': md += '\\n##### ' + text + '\\n'; break;
                      case 'h6': md += '\\n###### ' + text + '\\n'; break;
                      case 'p': md += '\\n' + htmlToMarkdown(node, depth) + '\\n'; break;
                      case 'br': md += '\\n'; break;
                      case 'hr': md += '\\n---\\n'; break;
                      case 'strong':
                      case 'b': md += '**' + text + '**'; break;
                      case 'em':
                      case 'i': md += '*' + text + '*'; break;
                      case 'code': md += String.fromCharCode(96) + text + String.fromCharCode(96); break;
                      case 'pre': md += '\\n' + String.fromCharCode(96,96,96) + '\\n' + text + '\\n' + String.fromCharCode(96,96,96) + '\\n'; break;
                      case 'a':
                        if (includeLinks && node.href) {
                          md += '[' + text + '](' + node.href + ')';
                        } else {
                          md += text;
                        }
                        break;
                      case 'img':
                        if (includeImages) {
                          md += '![' + (node.alt || 'image') + '](' + node.src + ')';
                        }
                        break;
                      case 'ul':
                      case 'ol':
                        md += '\\n';
                        const items = node.querySelectorAll(':scope > li');
                        items.forEach((li, idx) => {
                          const prefix = tag === 'ol' ? (idx + 1) + '. ' : '- ';
                          md += prefix + li.textContent?.trim() + '\\n';
                        });
                        break;
                      case 'blockquote':
                        md += '\\n> ' + text.replace(/\\n/g, '\\n> ') + '\\n';
                        break;
                      case 'table':
                        // Simple table handling
                        const rows = node.querySelectorAll('tr');
                        rows.forEach((row, idx) => {
                          const cells = row.querySelectorAll('th, td');
                          md += '| ' + Array.from(cells).map(c => c.textContent?.trim()).join(' | ') + ' |\\n';
                          if (idx === 0) {
                            md += '| ' + Array.from(cells).map(() => '---').join(' | ') + ' |\\n';
                          }
                        });
                        break;
                      case 'script':
                      case 'style':
                      case 'noscript':
                        break; // Skip
                      default:
                        md += htmlToMarkdown(node, depth);
                    }
                  }
                }
                return md;
              }
              content = htmlToMarkdown(root).trim();
              // Clean up excessive whitespace
              content = content.replace(/\\n{3,}/g, '\\n\\n');
              break;

            case 'json':
              // Extract structured data
              const data = {
                title: document.title,
                url: window.location.href,
                headings: [],
                links: [],
                forms: [],
                images: []
              };

              // Headings
              root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
                data.headings.push({
                  level: parseInt(h.tagName[1]),
                  text: h.textContent?.trim()
                });
              });

              // Links
              if (includeLinks) {
                root.querySelectorAll('a[href]').forEach(a => {
                  data.links.push({
                    text: a.textContent?.trim().slice(0, 100),
                    href: a.href
                  });
                });
              }

              // Forms
              root.querySelectorAll('form').forEach(form => {
                const formData = {
                  action: form.action,
                  method: form.method,
                  fields: []
                };
                form.querySelectorAll('input, select, textarea').forEach(field => {
                  formData.fields.push({
                    type: field.type || field.tagName.toLowerCase(),
                    name: field.name,
                    placeholder: field.placeholder
                  });
                });
                data.forms.push(formData);
              });

              // Images
              if (includeImages) {
                root.querySelectorAll('img').forEach(img => {
                  data.images.push({
                    src: img.src,
                    alt: img.alt
                  });
                });
              }

              content = JSON.stringify(data, null, 2);
              break;

            case 'accessibility':
              // Build accessibility tree
              function getAccessibilityTree(el, depth = 0) {
                const indent = '  '.repeat(depth);
                let tree = '';

                const role = el.getAttribute('role') ||
                             (el.tagName === 'BUTTON' ? 'button' :
                              el.tagName === 'A' ? 'link' :
                              el.tagName === 'INPUT' ? 'textbox' :
                              el.tagName === 'IMG' ? 'img' :
                              el.tagName.match(/^H[1-6]$/) ? 'heading' :
                              'generic');

                const name = el.getAttribute('aria-label') ||
                             el.getAttribute('alt') ||
                             el.getAttribute('title') ||
                             (el.textContent?.trim().slice(0, 50) || '');

                if (name || role !== 'generic') {
                  tree += indent + role + (name ? ': "' + name + '"' : '') + '\\n';
                }

                for (const child of el.children) {
                  tree += getAccessibilityTree(child, depth + 1);
                }

                return tree;
              }
              content = getAccessibilityTree(root);
              break;

            default:
              content = root.innerText || '';
          }

          const originalLength = content.length;
          const truncated = originalLength > maxLength;
          if (truncated) {
            content = content.slice(0, maxLength) + '\\n... [truncated]';
          }

          return {
            success: true,
            content,
            truncated,
            contentLength: originalLength,
            format
          };
        })()
      `;

      const result = await this.safeExecuteJavaScript<GetContentResult>(
        webContents,
        contentScript,
        30000 // 30 second timeout for content extraction
      );
      return result;
    } catch (error) {
      return {
        success: false,
        content: '',
        truncated: false,
        contentLength: 0,
        format: options.format,
        error: String(error),
      };
    }
  }

  /**
   * Scroll the page or an element with human-like variance
   */
  async scroll(instanceId: string, options: ScrollOptions): Promise<ScrollResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, scrollPosition: { x: 0, y: 0 }, error: 'Browser instance not found' };
      }

      const smooth = options.smooth ?? true;
      const humanLike = options.humanLike ?? true;
      const webContents = view.webContents;

      // For 'top' and 'bottom', use simple scroll
      if (options.direction === 'top' || options.direction === 'bottom') {
        const scrollScript = `
          (function() {
            const direction = ${JSON.stringify(options.direction)};
            const selector = ${JSON.stringify(options.selector)};
            const smooth = ${smooth};

            const target = selector ? document.querySelector(selector) : window;
            if (!target && selector) {
              return { success: false, error: 'Element not found: ' + selector };
            }

            const behavior = smooth ? 'smooth' : 'instant';

            if (direction === 'top') {
              if (selector) {
                target.scrollTo({ top: 0, behavior });
              } else {
                window.scrollTo({ top: 0, behavior });
              }
            } else {
              if (selector) {
                target.scrollTo({ top: target.scrollHeight, behavior });
              } else {
                window.scrollTo({ top: document.body.scrollHeight, behavior });
              }
            }

            return new Promise(resolve => {
              setTimeout(() => {
                const x = selector ? target.scrollLeft : window.scrollX;
                const y = selector ? target.scrollTop : window.scrollY;
                resolve({
                  success: true,
                  scrollPosition: { x: Math.round(x), y: Math.round(y) }
                });
              }, smooth ? 300 : 50);
            });
          })()
        `;

        return await this.safeExecuteJavaScript<ScrollResult>(webContents, scrollScript, 10000);
      }

      // For directional scrolls (up/down/left/right), use human-like incremental scrolling
      // First, get viewport dimensions and calculate scroll amount
      const viewportScript = `({
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      })`;
      const viewportInfo = await this.safeExecuteJavaScript<{
        viewportHeight: number;
        viewportWidth: number;
        scrollX: number;
        scrollY: number;
      }>(webContents, viewportScript, 2000);

      if (!viewportInfo) {
        return { success: false, scrollPosition: { x: 0, y: 0 }, error: 'Failed to get viewport info' };
      }

      // Calculate base scroll amount (default to viewport height/width)
      let baseAmount = options.amount;
      if (!baseAmount) {
        baseAmount = (options.direction === 'left' || options.direction === 'right')
          ? viewportInfo.viewportWidth
          : viewportInfo.viewportHeight;
      }

      // Apply human-like variance to the total amount (+/- 5-15%)
      const totalAmount = humanLike ? getScrollAmount(baseAmount) : baseAmount;

      // Determine if this is a vertical or horizontal scroll
      const isVertical = options.direction === 'up' || options.direction === 'down';
      const isNegative = options.direction === 'up' || options.direction === 'left';

      if (humanLike && totalAmount > 100) {
        // Break into incremental wheel-like scrolls for more human-like behavior
        const increments = getScrollIncrements(isNegative ? -totalAmount : totalAmount, 120);

        for (let i = 0; i < increments.length; i++) {
          // Check if browser still exists before each step
          if (!this.browsers.has(instanceId) || webContents.isDestroyed()) {
            return { success: false, scrollPosition: { x: 0, y: 0 }, error: 'Browser was destroyed during operation' };
          }

          const increment = increments[i];

          // Dispatch wheel event (more realistic than scrollBy)
          const wheelScript = `
            (function() {
              const selector = ${JSON.stringify(options.selector)};
              const target = selector ? document.querySelector(selector) : document;
              if (!target && selector) {
                return { success: false, error: 'Element not found: ' + selector };
              }

              const deltaY = ${isVertical ? increment : 0};
              const deltaX = ${!isVertical ? increment : 0};

              const wheelEvent = new WheelEvent('wheel', {
                deltaX: deltaX,
                deltaY: deltaY,
                deltaMode: 0, // DOM_DELTA_PIXEL
                bubbles: true,
                cancelable: true
              });

              target.dispatchEvent(wheelEvent);

              // Also do actual scroll for browsers that don't respond to wheel events
              if (selector) {
                target.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
              } else {
                window.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
              }

              return { success: true };
            })()
          `;

          await this.safeExecuteJavaScript(webContents, wheelScript, 2000);

          // Add delay between wheel events (except for the last one)
          if (i < increments.length - 1) {
            await new Promise((r) => setTimeout(r, getScrollWheelDelay()));
          }
        }

        // Small pause for scroll to settle
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 50));
      } else {
        // Simple scroll for small amounts or when humanLike is disabled
        const scrollScript = `
          (function() {
            const direction = ${JSON.stringify(options.direction)};
            const amount = ${totalAmount};
            const selector = ${JSON.stringify(options.selector)};
            const smooth = ${smooth};

            const target = selector ? document.querySelector(selector) : window;
            if (!target && selector) {
              return { success: false, error: 'Element not found: ' + selector };
            }

            const behavior = smooth ? 'smooth' : 'instant';
            const signedAmount = ${isNegative ? -1 : 1} * amount;

            if (${isVertical}) {
              if (selector) {
                target.scrollBy({ top: signedAmount, behavior });
              } else {
                window.scrollBy({ top: signedAmount, behavior });
              }
            } else {
              if (selector) {
                target.scrollBy({ left: signedAmount, behavior });
              } else {
                window.scrollBy({ left: signedAmount, behavior });
              }
            }

            return { success: true };
          })()
        `;

        await this.safeExecuteJavaScript(webContents, scrollScript, 5000);

        // Wait for smooth scroll to complete
        if (smooth) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      // Get final scroll position
      const positionScript = `
        (function() {
          const selector = ${JSON.stringify(options.selector)};
          const target = selector ? document.querySelector(selector) : null;
          return {
            success: true,
            scrollPosition: {
              x: Math.round(selector && target ? target.scrollLeft : window.scrollX),
              y: Math.round(selector && target ? target.scrollTop : window.scrollY)
            }
          };
        })()
      `;

      const result = await this.safeExecuteJavaScript<ScrollResult>(webContents, positionScript, 2000);
      return result || { success: true, scrollPosition: { x: 0, y: 0 } };
    } catch (error) {
      return { success: false, scrollPosition: { x: 0, y: 0 }, error: String(error) };
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(instanceId: string, options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, dataUrl: '', width: 0, height: 0, error: 'Browser instance not found' };
      }

      const format = options.format ?? 'png';
      const quality = options.quality ?? 80;
      const webContents = view.webContents;

      // If selector is specified, get element bounds
      let rect: Electron.Rectangle | undefined;
      if (options.selector) {
        const boundsScript = `
          (function() {
            const el = document.querySelector(${JSON.stringify(options.selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height)
            };
          })()
        `;
        rect = await this.safeExecuteJavaScript<Electron.Rectangle | null>(
          webContents,
          boundsScript,
          5000 // 5 second timeout for bounds check
        ) ?? undefined;
        if (!rect) {
          return {
            success: false,
            dataUrl: '',
            width: 0,
            height: 0,
            error: 'Element not found: ' + options.selector,
          };
        }
      }

      // Capture the page
      const image = await webContents.capturePage(rect);

      // Convert to data URL
      let dataUrl: string;
      if (format === 'jpeg') {
        const buffer = image.toJPEG(quality);
        dataUrl = 'data:image/jpeg;base64,' + buffer.toString('base64');
      } else {
        const buffer = image.toPNG();
        dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
      }

      const size = image.getSize();

      return {
        success: true,
        dataUrl,
        width: size.width,
        height: size.height,
      };
    } catch (error) {
      return { success: false, dataUrl: '', width: 0, height: 0, error: String(error) };
    }
  }

  /**
   * Execute JavaScript in page context
   */
  async evaluate(instanceId: string, options: EvaluateOptions): Promise<EvaluateResult> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      const returnValue = options.returnValue ?? true;
      const webContents = view.webContents;

      // Wrap script to handle return value
      const wrappedScript = returnValue
        ? `(async function() { return ${options.script}; })()`
        : `(async function() { ${options.script}; return undefined; })()`;

      const result = await this.safeExecuteJavaScript<unknown>(
        webContents,
        wrappedScript,
        30000 // 30 second timeout for user scripts
      );

      return {
        success: true,
        result: returnValue ? result : undefined,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ============ Cookie Management ============

  /**
   * Export all cookies for the browser instance
   */
  async exportCookies(instanceId: string): Promise<{ success: boolean; cookies?: Electron.Cookie[]; error?: string }> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      const partition = `persist:browser_${instanceId}`;
      const ses = session.fromPartition(partition);
      const cookies = await ses.cookies.get({});

      return { success: true, cookies };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Import cookies into the browser instance
   */
  async importCookies(
    instanceId: string,
    cookies: Array<{
      url?: string;
      name: string;
      value: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
      expirationDate?: number;
    }>
  ): Promise<{ success: boolean; imported?: number; error?: string }> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      const partition = `persist:browser_${instanceId}`;
      const ses = session.fromPartition(partition);
      let imported = 0;

      for (const cookie of cookies) {
        try {
          // Build URL from domain if not provided
          const url = cookie.url || `https://${cookie.domain?.replace(/^\./, '') || 'localhost'}${cookie.path || '/'}`;

          await ses.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            expirationDate: cookie.expirationDate,
          });
          imported++;
        } catch (e) {
          console.warn(`[BrowserService] Failed to import cookie ${cookie.name}:`, e);
        }
      }

      return { success: true, imported };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Clear all cookies for the browser instance
   */
  async clearCookies(instanceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      const partition = `persist:browser_${instanceId}`;
      const ses = session.fromPartition(partition);

      // Get all cookies and remove them
      const cookies = await ses.cookies.get({});
      for (const cookie of cookies) {
        const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain?.replace(/^\./, '')}${cookie.path}`;
        await ses.cookies.remove(url, cookie.name);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ============ Popup/Overlay Detection and Handling ============

  /**
   * Detect overlays/modals/popups on the page
   */
  async detectOverlays(instanceId: string): Promise<{
    success: boolean;
    overlays: Array<{
      type: 'modal' | 'popup' | 'cookie_consent' | 'notification' | 'unknown';
      selector: string;
      title?: string;
      text?: string;
      buttons: Array<{ text: string; selector: string; isPrimary: boolean }>;
      boundingBox: { x: number; y: number; width: number; height: number };
      zIndex: number;
    }>;
    error?: string;
  }> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, overlays: [], error: 'Browser instance not found' };
      }

      const detectScript = `
        (function() {
          const overlays = [];

          // Find elements that look like overlays (high z-index, fixed/absolute position, covers significant area)
          const allElements = document.querySelectorAll('*');
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;

          for (const el of allElements) {
            const style = window.getComputedStyle(el);
            const zIndex = parseInt(style.zIndex) || 0;
            const position = style.position;
            const display = style.display;
            const visibility = style.visibility;

            // Skip hidden elements
            if (display === 'none' || visibility === 'hidden' || style.opacity === '0') continue;

            // Look for overlay characteristics
            const isFixed = position === 'fixed';
            const isAbsolute = position === 'absolute';
            const hasHighZIndex = zIndex > 100;

            if (!((isFixed || isAbsolute) && hasHighZIndex)) continue;

            const rect = el.getBoundingClientRect();

            // Skip elements that are too small to be meaningful overlays
            if (rect.width < 100 || rect.height < 50) continue;

            // Skip elements that are off-screen
            if (rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight) continue;

            // Determine overlay type
            let type = 'unknown';
            const text = el.textContent?.toLowerCase() || '';
            const classes = el.className?.toLowerCase() || '';
            const id = el.id?.toLowerCase() || '';

            if (text.includes('cookie') || text.includes('consent') || text.includes('gdpr') ||
                classes.includes('cookie') || classes.includes('consent') || id.includes('cookie')) {
              type = 'cookie_consent';
            } else if (classes.includes('modal') || id.includes('modal') ||
                       el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') {
              type = 'modal';
            } else if (classes.includes('popup') || id.includes('popup') ||
                       classes.includes('overlay') || id.includes('overlay')) {
              type = 'popup';
            } else if (classes.includes('notification') || classes.includes('toast') ||
                       classes.includes('alert') || classes.includes('banner')) {
              type = 'notification';
            }

            // Find buttons within the overlay
            const buttons = [];
            const buttonEls = el.querySelectorAll('button, a[role="button"], [type="submit"], .btn, .button');
            for (let i = 0; i < Math.min(buttonEls.length, 5); i++) {
              const btn = buttonEls[i];
              const btnText = btn.textContent?.trim() || '';
              const btnClasses = btn.className?.toLowerCase() || '';
              const isPrimary = btnClasses.includes('primary') || btnClasses.includes('accept') ||
                               btnClasses.includes('confirm') || btnClasses.includes('submit') ||
                               btn.getAttribute('data-primary') === 'true';

              // Generate a unique selector for the button
              let btnSelector = '';
              if (btn.id) {
                btnSelector = '#' + btn.id;
              } else if (btn.className) {
                btnSelector = '.' + btn.className.split(' ')[0];
              } else {
                btnSelector = btn.tagName.toLowerCase();
              }

              buttons.push({
                text: btnText.slice(0, 50),
                selector: btnSelector,
                isPrimary
              });
            }

            // Get title (look for headings in the overlay)
            const headings = el.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="header"]');
            const title = headings.length > 0 ? headings[0].textContent?.trim().slice(0, 100) : undefined;

            // Get a snippet of text content
            const textContent = el.textContent?.trim().slice(0, 200);

            // Generate unique selector for the overlay
            let selector = '';
            if (el.id) {
              selector = '#' + el.id;
            } else if (el.className) {
              selector = '.' + el.className.split(' ').filter(c => c).join('.');
            } else {
              selector = el.tagName.toLowerCase();
            }

            overlays.push({
              type,
              selector,
              title,
              text: textContent,
              buttons,
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              zIndex
            });
          }

          // Sort by z-index (highest first) and return top 5
          overlays.sort((a, b) => b.zIndex - a.zIndex);
          return overlays.slice(0, 5);
        })()
      `;

      const overlays = await this.safeExecuteJavaScript<Array<{
        type: string;
        selector: string;
        title?: string;
        text?: string;
        buttons: Array<{ text: string; selector: string; isPrimary: boolean }>;
        boundingBox: { x: number; y: number; width: number; height: number };
        zIndex: number;
      }>>(
        view.webContents,
        detectScript,
        10000
      );

      return { success: true, overlays: (overlays || []) as any };
    } catch (error) {
      return { success: false, overlays: [], error: String(error) };
    }
  }

  /**
   * Dismiss an overlay by clicking a close button or the specified button
   */
  async dismissOverlay(
    instanceId: string,
    options: {
      /** CSS selector of the overlay to dismiss */
      selector?: string;
      /** Text of button to click (e.g., "Accept", "Close", "Cancel") */
      buttonText?: string;
      /** Click the primary/accept button */
      clickPrimary?: boolean;
      /** Click close/X button */
      clickClose?: boolean;
    }
  ): Promise<{ success: boolean; clicked?: string; error?: string }> {
    try {
      const view = this.browsers.get(instanceId);
      if (!view) {
        return { success: false, error: 'Browser instance not found' };
      }

      const dismissScript = `
        (function() {
          const options = ${JSON.stringify(options)};

          // Find the overlay
          let overlay = null;
          if (options.selector) {
            overlay = document.querySelector(options.selector);
          } else {
            // Find the topmost overlay
            const allElements = document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, .popup, .overlay');
            for (const el of allElements) {
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                overlay = el;
                break;
              }
            }
          }

          if (!overlay) {
            return { success: false, error: 'No overlay found' };
          }

          // Find button to click
          let button = null;
          let clickedText = '';

          if (options.buttonText) {
            // Find button by text
            const buttons = overlay.querySelectorAll('button, a, [role="button"]');
            for (const btn of buttons) {
              if (btn.textContent?.toLowerCase().includes(options.buttonText.toLowerCase())) {
                button = btn;
                clickedText = btn.textContent?.trim() || '';
                break;
              }
            }
          } else if (options.clickPrimary) {
            // Find primary/accept button
            const primarySelectors = [
              '[class*="primary"]', '[class*="accept"]', '[class*="confirm"]',
              '[class*="submit"]', '[data-primary="true"]', 'button[type="submit"]'
            ];
            for (const sel of primarySelectors) {
              button = overlay.querySelector(sel);
              if (button) {
                clickedText = button.textContent?.trim() || 'primary';
                break;
              }
            }
          } else if (options.clickClose) {
            // Find close button
            const closeSelectors = [
              '[class*="close"]', '[aria-label*="close"]', '[aria-label*="Close"]',
              '[title*="close"]', '[title*="Close"]', '.dismiss', 'button[class*="x"]',
              'button:has(svg)', 'button:has([class*="icon"])'
            ];
            for (const sel of closeSelectors) {
              try {
                button = overlay.querySelector(sel);
                if (button) {
                  clickedText = 'close';
                  break;
                }
              } catch (e) {}
            }
          }

          if (!button) {
            // Fallback: try any button in the overlay
            button = overlay.querySelector('button, [role="button"]');
            if (button) {
              clickedText = button.textContent?.trim() || 'fallback';
            }
          }

          if (button) {
            button.click();
            return { success: true, clicked: clickedText };
          }

          return { success: false, error: 'No button found to click' };
        })()
      `;

      // Add human-like delay before clicking
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

      const result = await this.safeExecuteJavaScript<{ success: boolean; clicked?: string; error?: string }>(
        view.webContents,
        dismissScript,
        5000
      );

      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
