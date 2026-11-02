/**
 * OAuth Callback Server (HTTP)
 *
 * Temporary localhost HTTP server that catches OAuth redirect callbacks.
 * Used by VendorOAuthService to complete the authorization_code flow.
 *
 * The server listens on a fixed port (19876) and path (/oauth/callback).
 * Users register http://localhost:19876/oauth/callback as the redirect URI
 * in their OAuth provider's app settings.
 *
 * HTTP is fine for localhost callbacks — most OAuth providers accept it.
 * For providers that require HTTPS (e.g., Slack), see OAuthCallbackServerHttps.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallbackResult {
  /** Complete callback URL with query params (passed to connector.handleCallback()) */
  fullUrl: string;
  /** Authorization code from the provider */
  code: string;
  /** State parameter for CSRF verification */
  state: string;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = 19876;
const PATH = '/oauth/callback';
const LOG_PREFIX = '[OAuthCallback]';

export class OAuthCallbackServer {
  private server: Server | null = null;

  /** The redirect URI to register with OAuth providers. */
  static get redirectUri(): string {
    return `http://localhost:${PORT}${PATH}`;
  }

  /**
   * Start the callback server and wait for the OAuth redirect.
   *
   * Returns a promise that resolves when the callback is received, or rejects
   * on timeout, port conflict, provider error, or forced close.
   *
   * The server auto-closes after receiving a callback or on timeout.
   *
   * @param timeoutMs - Max wait time in ms (default: 5 minutes)
   */
  waitForCallback(timeoutMs: number = 300_000): Promise<CallbackResult> {
    return new Promise<CallbackResult>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closeServer();
        fn();
      };

      // Timeout
      const timer = setTimeout(() => {
        settle(() => reject(new Error('OAuth callback timed out after 5 minutes')));
      }, timeoutMs);

      // Create HTTP server
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', `http://localhost:${PORT}`);
        console.log(`${LOG_PREFIX} Incoming request: ${req.method} ${req.url}`);

        // Only handle our callback path
        if (url.pathname !== PATH) {
          console.log(`${LOG_PREFIX}   Ignoring non-callback path: ${url.pathname}`);
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        console.log(`${LOG_PREFIX}   Callback params: error=${error}, code=${code ? code.substring(0, 20) + '...' : 'null'}, state=${state ? state.substring(0, 20) + '...' : 'null'}`);

        // Always respond with HTML so the user sees something
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

        if (error) {
          console.error(`${LOG_PREFIX}   OAuth error from provider: ${error} — ${errorDescription}`);
          res.end(
            `<html><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px;">` +
              `<h2>Authorization Failed</h2>` +
              `<p>${escapeHtml(error)}${errorDescription ? ': ' + escapeHtml(errorDescription) : ''}</p>` +
              `<p style="color:#888;">You can close this window.</p>` +
              `</body></html>`
          );
          settle(() => reject(new Error(`OAuth error: ${error}${errorDescription ? ' — ' + errorDescription : ''}`)));
          return;
        }

        if (!code || !state) {
          console.error(`${LOG_PREFIX}   Missing code or state in callback`);
          res.end(
            `<html><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px;">` +
              `<h2>Invalid Callback</h2>` +
              `<p>Missing authorization code or state parameter.</p>` +
              `</body></html>`
          );
          settle(() => reject(new Error('OAuth callback missing code or state parameter')));
          return;
        }

        // Success
        console.log(`${LOG_PREFIX}   OAuth callback SUCCESS — code and state received`);
        res.end(
          `<html><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px;">` +
            `<h2>Authorization Complete!</h2>` +
            `<p>You can close this window and return to hosea.</p>` +
            `<script>setTimeout(function(){window.close()},1500);</script>` +
            `</body></html>`
        );

        settle(() =>
          resolve({
            fullUrl: url.toString(),
            code,
            state,
          })
        );
      });

      // Bind to localhost only (security)
      console.log(`${LOG_PREFIX} Starting HTTP server on 127.0.0.1:${PORT}...`);
      this.server.listen(PORT, '127.0.0.1', () => {
        console.log(`${LOG_PREFIX} Server listening on http://127.0.0.1:${PORT}${PATH}`);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          settle(() =>
            reject(
              new Error(
                `Port ${PORT} is already in use. Close other applications using this port and try again.`
              )
            )
          );
        } else {
          settle(() => reject(new Error(`Failed to start OAuth callback server: ${err.message}`)));
        }
      });
    });
  }

  /**
   * Force close the server (e.g., user cancelled the OAuth flow).
   * If a waitForCallback() promise is pending, it will reject.
   */
  close(): void {
    this.closeServer();
  }

  private closeServer(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // Already closed
      }
      this.server = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
