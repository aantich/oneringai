/**
 * OAuth Callback Server (HTTPS)
 *
 * Temporary localhost HTTPS server for OAuth providers that reject HTTP redirect URIs
 * (e.g., Slack). Runs on port 19877 alongside the HTTP server on port 19876.
 *
 * Uses a bundled self-signed certificate for localhost (valid 10+ years).
 * This is safe because the server only binds to 127.0.0.1.
 *
 * Redirect URI: https://localhost:19877/oauth/callback
 */

import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CallbackResult } from './OAuthCallbackServer.js';

// Re-export for convenience
export type { CallbackResult } from './OAuthCallbackServer.js';

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = 19877;
const PATH = '/oauth/callback';
const LOG_PREFIX = '[OAuthCallbackHttps]';

export class OAuthCallbackServerHttps {
  private server: Server | null = null;

  /** The HTTPS redirect URI to register with OAuth providers that require HTTPS. */
  static get redirectUri(): string {
    return `https://localhost:${PORT}${PATH}`;
  }

  /**
   * Start the HTTPS callback server and wait for the OAuth redirect.
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

      // Create HTTPS server with bundled self-signed cert for localhost
      const tlsOptions = OAuthCallbackServerHttps.getTlsOptions();
      this.server = createServer(tlsOptions, (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', `https://localhost:${PORT}`);
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
      console.log(`${LOG_PREFIX} Starting HTTPS server on 127.0.0.1:${PORT}...`);
      this.server.listen(PORT, '127.0.0.1', () => {
        console.log(`${LOG_PREFIX} Server listening on https://127.0.0.1:${PORT}${PATH}`);
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
          settle(() => reject(new Error(`Failed to start HTTPS OAuth callback server: ${err.message}`)));
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

  /** Bundled self-signed TLS cert for localhost (valid until 2036). */
  private static getTlsOptions(): { key: string; cert: string } {
    return { key: LOCALHOST_KEY, cert: LOCALHOST_CERT };
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

// ---------------------------------------------------------------------------
// Bundled self-signed certificate for localhost (RSA 2048, valid 10 years)
// Generated with: openssl req -x509 -newkey rsa:2048 -days 3650 -nodes
//   -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
// Safe to ship: only used for localhost OAuth callbacks, never exposed to network.
// ---------------------------------------------------------------------------

const LOCALHOST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDEHgrP0Q3C7Eu+
ps4S28a+IoeXhD+2S+BZlPkwCgfipDczCtq/NbrInpvWMo6j96iEsEXKLz3ypFcb
RH/Sjb4N71p65eP72zMOndlvqP01fFqidzzj0/z7Ti+OPpMexvL5MDu8ii5FuLh7
pqQbTwNvyV0S+xpT09nxGWDjmRD6mV3+9Gugn1SGx94JPQbDvut4PsNogLzKOCT+
e9ugrVeNl3rDkABQ2tAC++ydpkYgRy/B5CcecmAyoIFlQPm7mbTkVrblByIDrfIE
VMy6qG3VcLFLWUTDZNULTJHZWzVe9Ta+lacY0UlQlgxfnlD28r9eXo8ir5InRAxi
H5vvCHyVAgMBAAECggEACvokgEfTBZ1Myw3SnIcdK3DK1p4CI+3Az7rRLNFu6g5n
gY2iu0+iVg7cqaNYTRC0Z8LnER9OUBnHP2E451vkLqr+TUE3XtZA2BlZPZD/pUIB
37SdXaI0t4tDiapyeSdJG84Jle7FEsV5XABykI2+Y0Ap28Fe0qDZws85F1wusVwR
luDhkzH6ZAJScZehDc1g+GBVKqakrNHWc80d8fGd0fDq6KViXx3fnTrU724F/+es
NHFQBoCd2iFNYWTxGNuHS44R7K9NHfJeE/HuFcV5Gww9OtUsPwNDKtHZ0KUslnrY
Sq+vOmm8TxdPFU5nngWZUfgJZt1DK1ZBW3JK94JWmQKBgQDy2h/Cx0jMx4wrJ4e0
d4QWDDxQh5cx+HXEOO5311rYmD7SjpzviUP73Q9iN1wWcEwHTxNYj0PVrt2jkHTd
yn/AFh9iJvyFgQqoO1I9CUumoq+uLMCSbNodjoerrwgnmzKi1VNtkOb5g0Yf9BRx
orWkSMEaxycuRJM57Ddbk8WEyQKBgQDOvC+CaGrQrSkjcDXcYNJt36CRaXdCT+rw
1uPJo0iRTwHi14ASMVpyKJRnfL85y1NzHRjmcJHgh1gx3BpBQey0nLX/bRbJKEfm
KIyeDhtO3WENO9guST8kJEJZ5EILSz2lwd1wdvoNBuWE/HRLtwshkerktKzwd3L+
abf/vx/bbQKBgQDLeB+WNRv0ntf8rCER/fTH+DZsjj4KWw5oef6qn994i45PIbex
JgO0uRETjCh2kF3S3djqoRYHqXv/d5/C18/TI3Xl6Z43SNeh/hm4E9qzYajpuIsb
42GX0/wtxveBH5H8Rdmhef9bXDZbvUeHsfiYDXDlO6jDJidoJ1Z2PsgFqQKBgEcw
touJuX6yon/5nBKPpOcBIyHv14mWS6kz1q0Q9WRUeKnM2+Vn6WV2Y+RfKNqWEd6K
HpD8Ir/W26AP01q1gPWRIXsb7cTHgjrXq9ShtvWpdkpAWWlW/89KTS73U2bgOhJi
eAbKccEapt7ssH+CQOsGfITVUthbydWiQiJnhmjhAoGAVScS6aGbtyVLhHGr5BM7
CdrYBOYqHdZSMLxSy0YyYaIzKpVQLNNZkFNu3Ud5h9Mk4qSVWozoYMJZDBUyBueI
59i45e+s7rROeflCABxoy2oNdEM2hZIoY+/jfHe+bH4BJRz+jgOZg/VVv7K3xFRL
scWrzQdi5MMtK0WOxoAv7uI=
-----END PRIVATE KEY-----`;

const LOCALHOST_CERT = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUQ5ofmvtNG5plNPdqT9YsGdVYC1kwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDIyNTE5NDEwN1oXDTM2MDIy
MzE5NDEwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAxB4Kz9ENwuxLvqbOEtvGviKHl4Q/tkvgWZT5MAoH4qQ3
MwravzW6yJ6b1jKOo/eohLBFyi898qRXG0R/0o2+De9aeuXj+9szDp3Zb6j9NXxa
onc849P8+04vjj6THsby+TA7vIouRbi4e6akG08Db8ldEvsaU9PZ8Rlg45kQ+pld
/vRroJ9UhsfeCT0Gw77reD7DaIC8yjgk/nvboK1XjZd6w5AAUNrQAvvsnaZGIEcv
weQnHnJgMqCBZUD5u5m05Fa25QciA63yBFTMuqht1XCxS1lEw2TVC0yR2Vs1XvU2
vpWnGNFJUJYMX55Q9vK/Xl6PIq+SJ0QMYh+b7wh8lQIDAQABo28wbTAdBgNVHQ4E
FgQUnfoen6+sNc3GrOutmKgJ7SLAlJMwHwYDVR0jBBgwFoAUnfoen6+sNc3GrOut
mKgJ7SLAlJMwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAL1vg4sP0lEmAEkL0a2+eY9yLsb/mTFw
ePXd9aQzwptbUo8O0LEgfwGa7QeW4kcGCYmeCHjIJray6jPeeZy11PUWCwrI58x5
/Lc14CziZOHyF2gKKTfTTkxlcyPM6i/i25u63J8lWQhMUk1kxtBPrZWj7bi+zQOE
1FMAfn01svKmikYVHsT+1fFTXReOcc1ENjowycnNDS/KCwN+f+ZQ4wngzO+DgJ2u
lKRIrxk1fF/xCfHYcL/m6c5LuDO+XqYU2w6ZiAqstgO7Wq7d4u6yMEY1OXSBlfaO
IEwgegq11zBwMHoyFPKx0bJlJ0exyYBNHh1WpO7upeeesdPY9mliMB0=
-----END CERTIFICATE-----`;
