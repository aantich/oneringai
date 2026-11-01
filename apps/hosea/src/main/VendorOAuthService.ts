/**
 * Vendor OAuth Service
 *
 * Orchestrates generic OAuth flows for vendor connectors in the Everworker Desktop Electron app.
 * Generalises the EWAuthService pattern (BrowserWindow + navigation monitoring)
 * to work with any OAuth vendor via the core library's Connector API.
 *
 * Supports:
 *   - authorization_code flow (BrowserWindow + localhost callback server)
 *   - client_credentials flow (direct token fetch, no UI)
 *
 * All PKCE, state, token exchange, and refresh logic lives in the core library.
 * This service is pure orchestration / glue code.
 */

import { BrowserWindow, shell } from 'electron';
import { Connector } from 'oneringai';
import { OAuthCallbackServer } from './OAuthCallbackServer.js';
import { OAuthCallbackServerHttps } from './OAuthCallbackServerHttps.js';

const LOG_PREFIX = '[VendorOAuth]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthFlowResult {
  success: boolean;
  error?: string;
}

export interface OAuthFlowOptions {
  /** Connector name (must already be registered via Connector.create()) */
  connectorName: string;
  /** Parent window for modal behaviour */
  parentWindow?: BrowserWindow | null;
  /** Timeout in ms (default: 300 000 = 5 min) */
  timeoutMs?: number;
  /** Use system browser instead of BrowserWindow (recommended — users already logged in) */
  useSystemBrowser?: boolean;
  /** Use HTTPS callback server (port 19877) instead of HTTP (port 19876). Required by Slack etc. */
  useHttps?: boolean;
}

export interface OAuthTokenStatus {
  hasToken: boolean;
  isValid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VendorOAuthService {
  private authWindow: BrowserWindow | null = null;
  private callbackServer: OAuthCallbackServer | OAuthCallbackServerHttps | null = null;
  private activeConnector: string | null = null;

  // ── authorization_code ──────────────────────────────────────────────

  /**
   * Run the full authorization_code flow:
   *
   * 1. Start localhost callback server
   * 2. Call connector.startAuth() → authorization URL (PKCE + state auto-generated)
   * 3. Open BrowserWindow with the auth URL
   * 4. Wait for the provider to redirect to the callback server
   * 5. Call connector.handleCallback(url) → exchanges code for tokens
   * 6. Clean up and return
   */
  async authorizeAuthCode(options: OAuthFlowOptions): Promise<OAuthFlowResult> {
    const { connectorName, parentWindow, timeoutMs = 300_000, useSystemBrowser = true, useHttps = false } = options;

    console.log(`${LOG_PREFIX} ── authorizeAuthCode START ──`);
    console.log(`${LOG_PREFIX}   connector: ${connectorName}`);
    console.log(`${LOG_PREFIX}   useSystemBrowser: ${useSystemBrowser}`);
    console.log(`${LOG_PREFIX}   timeoutMs: ${timeoutMs}`);

    // Prevent concurrent flows
    if (this.activeConnector) {
      console.warn(`${LOG_PREFIX}   BLOCKED — flow already active for "${this.activeConnector}"`);
      return {
        success: false,
        error: `OAuth flow already in progress for "${this.activeConnector}"`,
      };
    }

    this.activeConnector = connectorName;

    try {
      const connector = Connector.get(connectorName);
      if (!connector) {
        console.error(`${LOG_PREFIX}   Connector "${connectorName}" not found in registry`);
        return { success: false, error: `Connector "${connectorName}" not found in registry` };
      }
      console.log(`${LOG_PREFIX}   Connector found in registry ✓`);

      // 1. Start callback server (HTTPS for providers that require it, HTTP otherwise)
      this.callbackServer = useHttps
        ? new OAuthCallbackServerHttps()
        : new OAuthCallbackServer();
      const redirectUri = useHttps ? OAuthCallbackServerHttps.redirectUri : OAuthCallbackServer.redirectUri;
      console.log(`${LOG_PREFIX}   Starting callback server on ${redirectUri}...`);
      const callbackPromise = this.callbackServer.waitForCallback(timeoutMs);
      console.log(`${LOG_PREFIX}   Callback server started ✓`);

      // 2. Get authorization URL from the core library (generates PKCE + state)
      console.log(`${LOG_PREFIX}   Calling connector.startAuth() to get authorization URL...`);
      const authUrl = await connector.startAuth();
      console.log(`${LOG_PREFIX}   Auth URL received: ${authUrl.substring(0, 120)}...`);

      // 3. Open auth page (system browser or BrowserWindow)
      if (useSystemBrowser) {
        console.log(`${LOG_PREFIX}   Opening system browser...`);
        await shell.openExternal(authUrl);
        console.log(`${LOG_PREFIX}   System browser opened ✓`);
      } else {
        console.log(`${LOG_PREFIX}   Opening BrowserWindow...`);
        this.authWindow = new BrowserWindow({
          width: 900,
          height: 750,
          parent: parentWindow ?? undefined,
          modal: !!parentWindow,
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
          title: 'Authorize Application',
          autoHideMenuBar: true,
        });

        this.authWindow.on('closed', () => {
          console.log(`${LOG_PREFIX}   BrowserWindow closed by user`);
          this.authWindow = null;
          this.callbackServer?.close();
        });

        this.authWindow.once('ready-to-show', () => {
          this.authWindow?.show();
        });

        this.authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
          if (errorCode === -3) return;
          console.error(`${LOG_PREFIX}   BrowserWindow load failed: code=${errorCode} desc=${errorDescription}`);
          this.callbackServer?.close();
        });

        this.authWindow.webContents.on('did-navigate', (_event, url) => {
          console.log(`${LOG_PREFIX}   BrowserWindow navigated to: ${url.substring(0, 120)}`);
        });

        await this.authWindow.loadURL(authUrl);
        console.log(`${LOG_PREFIX}   BrowserWindow loaded auth URL ✓`);
      }

      // 4. Wait for the callback
      console.log(`${LOG_PREFIX}   Waiting for OAuth callback...`);
      const callbackResult = await callbackPromise;
      console.log(`${LOG_PREFIX}   Callback received ✓`);
      console.log(`${LOG_PREFIX}     code: ${callbackResult.code.substring(0, 20)}...`);
      console.log(`${LOG_PREFIX}     state: ${callbackResult.state.substring(0, 20)}...`);
      console.log(`${LOG_PREFIX}     fullUrl: ${callbackResult.fullUrl.substring(0, 120)}...`);

      // 5. Exchange code for tokens (core library handles PKCE verification, token storage, etc.)
      console.log(`${LOG_PREFIX}   Calling connector.handleCallback() to exchange code for tokens...`);
      await connector.handleCallback(callbackResult.fullUrl);
      console.log(`${LOG_PREFIX}   Token exchange complete ✓`);

      // 6. Done
      this.destroyWindow();
      console.log(`${LOG_PREFIX} ── authorizeAuthCode SUCCESS ──`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} ── authorizeAuthCode FAILED ──`);
      console.error(`${LOG_PREFIX}   error: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        console.error(`${LOG_PREFIX}   stack: ${error.stack}`);
      }
      return {
        success: false,
        error: errorMsg,
      };
    } finally {
      this.cleanup();
    }
  }

  // ── client_credentials ──────────────────────────────────────────────

  /**
   * Run the client_credentials flow.
   * No user interaction needed — just triggers a token fetch via the core library.
   */
  async authorizeClientCredentials(connectorName: string): Promise<OAuthFlowResult> {
    try {
      const connector = Connector.get(connectorName);
      if (!connector) {
        return { success: false, error: `Connector "${connectorName}" not found in registry` };
      }

      // getToken() automatically triggers ClientCredentialsFlow.requestToken()
      await connector.getToken();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Token status ────────────────────────────────────────────────────

  /**
   * Check whether a connector has a valid token.
   */
  async checkTokenStatus(connectorName: string): Promise<OAuthTokenStatus> {
    try {
      const connector = Connector.get(connectorName);
      if (!connector) {
        return { hasToken: false, isValid: false, error: 'Connector not found' };
      }

      const isValid = await connector.hasValidToken();
      return { hasToken: isValid, isValid };
    } catch (error) {
      return {
        hasToken: false,
        isValid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Control ─────────────────────────────────────────────────────────

  /**
   * Cancel any in-progress OAuth flow.
   */
  cancel(): void {
    this.destroyWindow();
    this.callbackServer?.close();
    this.callbackServer = null;
    this.activeConnector = null;
  }

  get isAuthorizing(): boolean {
    return this.activeConnector !== null;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private destroyWindow(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.destroy();
    }
    this.authWindow = null;
  }

  private cleanup(): void {
    this.destroyWindow();
    this.callbackServer?.close();
    this.callbackServer = null;
    this.activeConnector = null;
  }
}
