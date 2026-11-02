/**
 * Backend Authentication Service
 *
 * Manages the browser-based authentication flow between hosea and Backend.
 * Opens a BrowserWindow to the backend login page, monitors for the token callback,
 * and returns the token to the caller.
 */

import { BrowserWindow } from 'electron';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackendAuthResult {
  success: boolean;
  token?: string;
  expiresAt?: number;
  userName?: string;
  userId?: string;
  error?: string;
}

export interface BackendAuthOptions {
  backendUrl: string;
  parentWindow?: BrowserWindow | null;
  /** Timeout in milliseconds. Default: 300000 (5 minutes). */
  timeoutMs?: number;
}

export interface BackendAuthSupportResult {
  supported: boolean;
  version?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BackendAuthService {
  private authWindow: BrowserWindow | null = null;

  /**
   * Check if the backend instance supports the browser-based auth flow.
   * Makes a GET request to /api/v1/hosea-auth/status.
   */
  async checkAuthSupport(backendUrl: string): Promise<BackendAuthSupportResult> {
    try {
      const url = `${backendUrl.replace(/\/+$/, '')}/api/v1/hosea-auth/status`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return { supported: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      if (data.available === true) {
        return { supported: true, version: data.version };
      }
      return { supported: false, error: 'Endpoint did not report available' };
    } catch (error: any) {
      return {
        supported: false,
        error: error.name === 'AbortError' ? 'Connection timed out' : String(error.message || error),
      };
    }
  }

  /**
   * Open an authentication window and wait for the token.
   *
   * Returns a promise that resolves when:
   * - The auth flow completes successfully (token received)
   * - The user closes the window (cancelled)
   * - The timeout expires
   * - A network error occurs
   */
  async authenticate(options: BackendAuthOptions): Promise<BackendAuthResult> {
    const { backendUrl, parentWindow, timeoutMs = 300000 } = options;

    // Prevent multiple concurrent auth windows
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.focus();
      return { success: false, error: 'Authentication already in progress' };
    }

    return new Promise<BackendAuthResult>((resolve) => {
      let resolved = false;

      const finish = (result: BackendAuthResult): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.destroy();
        }
        this.authWindow = null;
        resolve(result);
      };

      // Create the auth window
      this.authWindow = new BrowserWindow({
        width: 800,
        height: 700,
        parent: parentWindow ?? undefined,
        modal: !!parentWindow,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          // No preload — this is a pure web page
        },
        title: 'Login to Backend',
        autoHideMenuBar: true,
      });

      // Timeout
      const timer = setTimeout(() => {
        finish({ success: false, error: 'Authentication timed out after 5 minutes' });
      }, timeoutMs);

      // Monitor navigation for the callback URL
      const checkUrl = (_event: any, url: string): void => {
        this.extractTokenFromUrl(url, finish);
      };

      this.authWindow.webContents.on('will-redirect', checkUrl);
      this.authWindow.webContents.on('did-navigate', checkUrl);
      this.authWindow.webContents.on('did-navigate-in-page', checkUrl);

      // Handle network errors
      this.authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        // Ignore aborted loads (e.g. from rapid redirects)
        if (errorCode === -3) return;
        finish({
          success: false,
          error: `Failed to load: ${errorDescription} (${errorCode})`,
        });
      });

      // Handle window closed by user
      this.authWindow.on('closed', () => {
        this.authWindow = null;
        finish({ success: false, error: 'Authentication cancelled' });
      });

      // Show window once loaded
      this.authWindow.once('ready-to-show', () => {
        this.authWindow?.show();
      });

      // Navigate to the auth endpoint
      const authUrl = `${backendUrl.replace(/\/+$/, '')}/api/v1/hosea-auth`;
      this.authWindow.loadURL(authUrl);
    });
  }

  /**
   * Cancel any in-progress authentication.
   */
  cancel(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.destroy();
      this.authWindow = null;
    }
  }

  /**
   * Whether an auth window is currently open.
   */
  get isAuthenticating(): boolean {
    return this.authWindow !== null && !this.authWindow.isDestroyed();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Check if a URL is the callback URL and extract token data from the hash fragment.
   */
  private extractTokenFromUrl(url: string, finish: (result: BackendAuthResult) => void): void {
    try {
      const parsed = new URL(url);
      if (parsed.pathname !== '/api/v1/hosea-auth/complete') return;
      if (!parsed.hash || parsed.hash.length < 2) return;

      const params = new URLSearchParams(parsed.hash.slice(1)); // Remove leading '#'
      const token = params.get('token');
      const expiresAt = params.get('expiresAt');
      const userName = params.get('userName');
      const userId = params.get('userId');

      if (token) {
        finish({
          success: true,
          token,
          expiresAt: expiresAt ? parseInt(expiresAt, 10) : undefined,
          userName: userName ?? undefined,
          userId: userId ?? undefined,
        });
      }
    } catch {
      // URL parsing failed — not the callback URL, ignore
    }
  }
}
