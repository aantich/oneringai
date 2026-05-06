/**
 * Vendor helpers — buildAuthConfig + RefreshStrategy
 *
 * Verifies that every `RefreshStrategy` kind produces the right OAuth config:
 *  - `scope` → stamps `requiredScope`, force-merges into `scope`
 *  - `auth_param` → merges into `authorizationParams` without clobbering
 *  - `automatic` / `never_expires` / `manual_setup` → no-op on the wire
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Importing the vendors barrel triggers `initVendorRegistry`, which validates
// every authorization_code template has a refreshStrategy. We don't depend on
// any specific template here — just need the registry initialized so other
// tests in this suite (importing real vendor templates) don't fail.
beforeAll(async () => {
  await import('@/connectors/vendors/index.js');
});

describe('buildAuthConfig — RefreshStrategy application', () => {
  it('scope strategy: stamps requiredScope and force-merges into scope', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    // Microsoft has `refreshStrategy: { kind: 'scope', scope: 'offline_access' }`
    const c = createConnectorFromTemplate('test-ms', 'microsoft', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      tenantId: 'common',
      scope: 'User.Read', // operator override that drops `offline_access`
    });
    const auth = c.config.auth as { type: 'oauth'; scope: string; requiredScope?: string };
    expect(auth.type).toBe('oauth');
    expect(auth.requiredScope).toBe('offline_access');
    expect(auth.scope).toContain('User.Read');
    expect(auth.scope).toContain('offline_access');
  });

  it('scope strategy: idempotent when operator already includes the required token', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-ms-2', 'microsoft', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      tenantId: 'common',
      scope: 'User.Read offline_access',
    });
    const auth = c.config.auth as { type: 'oauth'; scope: string; requiredScope?: string };
    const occurrences = auth.scope.split(/\s+/).filter((t) => t === 'offline_access').length;
    expect(occurrences).toBe(1);
  });

  it('scope strategy with custom required token: Salesforce → refresh_token', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-sf', 'salesforce', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      scope: 'api', // operator drops the refresh-grant scope
    });
    const auth = c.config.auth as { type: 'oauth'; scope: string; requiredScope?: string };
    expect(auth.requiredScope).toBe('refresh_token');
    expect(auth.scope).toContain('refresh_token');
  });

  it('scope strategy with dotted token: Twitter/X → offline.access (NOT offline_access)', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-x', 'twitter', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      scope: 'tweet.read users.read',
    });
    const auth = c.config.auth as { type: 'oauth'; scope: string; requiredScope?: string };
    expect(auth.requiredScope).toBe('offline.access');
    expect(auth.scope).toContain('offline.access');
    // Critical: must NOT inject the OIDC underscore form for Twitter.
    expect(auth.scope).not.toMatch(/\boffline_access\b/);
  });

  it('auth_param strategy: Google merges access_type=offline into authorizationParams', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-g', 'google-api', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
    });
    const auth = c.config.auth as {
      type: 'oauth';
      authorizationParams?: Record<string, string>;
      requiredScope?: string;
    };
    expect(auth.authorizationParams?.access_type).toBe('offline');
    // No requiredScope for auth_param strategy.
    expect(auth.requiredScope).toBeUndefined();
  });

  it('auth_param strategy: Dropbox merges token_access_type=offline', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-db', 'dropbox', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
    });
    const auth = c.config.auth as {
      type: 'oauth';
      authorizationParams?: Record<string, string>;
    };
    expect(auth.authorizationParams?.token_access_type).toBe('offline');
  });

  it('automatic strategy: leaves requiredScope undefined (Discord)', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-dc', 'discord', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
    });
    const auth = c.config.auth as { type: 'oauth'; requiredScope?: string };
    expect(auth.requiredScope).toBeUndefined();
  });

  it('never_expires strategy: leaves requiredScope undefined (Notion)', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-nt', 'notion', 'oauth-user', {
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
    });
    const auth = c.config.auth as { type: 'oauth'; requiredScope?: string };
    expect(auth.requiredScope).toBeUndefined();
  });

  it('backfill: legacy config without requiredScope gets it re-applied on Connector load', async () => {
    // Simulates v25's GroupScopedConnectorRegistry path — Connector
    // constructed directly from a decrypted DB config that pre-dates the
    // `requiredScope` annotation. Without backfill, refresh tokens would
    // silently stop being issued for Microsoft `.default` configs.
    const { Connector } = await import('@/core/Connector.js');
    const c = Connector.create({
      name: 'test-legacy-ms',
      serviceType: 'microsoft',
      baseURL: 'https://graph.microsoft.com/v1.0',
      auth: {
        type: 'oauth',
        flow: 'authorization_code',
        clientId: 'cid',
        clientSecret: 'sec',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        redirectUri: 'http://localhost/cb',
        // Operator override that drops `offline_access` — the exact silent
        // degradation case the backfill targets.
        scope: 'https://graph.microsoft.com/.default',
        // Note: NO `requiredScope` field — this is a legacy persisted config.
      },
    });
    // The Connector's runtime config (used by the OAuth flow) should have
    // had `requiredScope` re-stamped from the Microsoft template's strategy.
    // We verify via the persisted config; the OAuth flow's authorize URL is
    // covered separately by AuthCodePKCE tests.
    const auth = c.config.auth as { type: 'oauth'; scope?: string };
    expect(auth.type).toBe('oauth');
    // The persisted `auth` object on `config` is the input verbatim — the
    // backfill happens in `initOAuthManager` and reaches the OAuth flow's
    // own config copy. We assert the flow-side behavior by getting an
    // authorize URL and checking the merged scope.
    const url = await c.startAuth();
    expect(url).toContain('scope=');
    const scope = new URL(url).searchParams.get('scope') ?? '';
    expect(scope).toContain('https://graph.microsoft.com/.default');
    expect(scope).toContain('offline_access');
  });

  it('backfill: fires when requiredScope is null (storage layers that preserve null)', async () => {
    // MongoDB / Postgres jsonb / Firestore can persist `null` literally
    // rather than dropping the field. The backfill check uses `== null` so
    // both `undefined` and `null` trigger re-application — without this, a
    // null-persisting storage layer would silently bypass the safety net.
    const { Connector } = await import('@/core/Connector.js');
    const c = Connector.create({
      name: 'test-legacy-ms-null',
      serviceType: 'microsoft',
      baseURL: 'https://graph.microsoft.com/v1.0',
      auth: {
        type: 'oauth',
        flow: 'authorization_code',
        clientId: 'cid',
        clientSecret: 'sec',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        redirectUri: 'http://localhost/cb',
        scope: 'https://graph.microsoft.com/.default',
        // Explicit `null` — what a Mongo round-trip can produce.
        requiredScope: null as unknown as string | undefined,
      },
    });
    const url = await c.startAuth();
    const scope = new URL(url).searchParams.get('scope') ?? '';
    expect(scope).toContain('https://graph.microsoft.com/.default');
    expect(scope).toContain('offline_access');
  });

  it('backfill: legacy Google config re-applies access_type=offline auth_param', async () => {
    const { Connector } = await import('@/core/Connector.js');
    const c = Connector.create({
      name: 'test-legacy-google',
      serviceType: 'google-api',
      baseURL: 'https://www.googleapis.com',
      auth: {
        type: 'oauth',
        flow: 'authorization_code',
        clientId: 'cid',
        clientSecret: 'sec',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        redirectUri: 'http://localhost/cb',
        scope: 'https://www.googleapis.com/auth/drive',
        // No authorizationParams — legacy config saved before strategy stamp.
      },
    });
    const url = await c.startAuth();
    expect(new URL(url).searchParams.get('access_type')).toBe('offline');
  });

  it('backfill: vendor with no auth-code template (api-key only) is a no-op', async () => {
    const { Connector } = await import('@/core/Connector.js');
    // SendGrid is api-key only — no auth-code template, so no strategy.
    // The backfill should leave the config alone. We can't construct an
    // OAuth Connector for SendGrid (no auth-code template), so test via a
    // fake serviceType that doesn't match any template.
    const c = Connector.create({
      name: 'test-legacy-unknown',
      serviceType: 'no-such-vendor',
      baseURL: 'https://example.com',
      auth: {
        type: 'oauth',
        flow: 'authorization_code',
        clientId: 'cid',
        tokenUrl: 'https://example.com/token',
        authorizationUrl: 'https://example.com/auth',
        redirectUri: 'http://localhost/cb',
        scope: 'read',
      },
    });
    const url = await c.startAuth();
    expect(new URL(url).searchParams.get('scope')).toBe('read');
  });

  it('manual_setup strategy: no scope / param mutation, requiredScope undefined', async () => {
    // No template currently uses `manual_setup` (reserved for vendors like
    // GitHub Apps user-token-expiry and Slack token rotation that need
    // out-of-band IdP config the library can't enforce). Exercise it
    // directly so the type variant doesn't bit-rot if a template adopts it.
    const { applyRefreshStrategy } = await import('@/connectors/vendors/index.js');
    const result = applyRefreshStrategy(
      'read write',
      { foo: 'bar' },
      { kind: 'manual_setup', description: 'enable token rotation in app config' },
    );
    expect(result.scope).toBe('read write');
    expect(result.requiredScope).toBeUndefined();
    expect(result.authorizationParams).toEqual({ foo: 'bar' });
  });

  it('mergeScope: empty required string is a no-op (defensive)', async () => {
    // `RefreshStrategy.scope` is typed `string` (not non-empty), so a
    // misconfigured template could pass `scope: ''`. Verify we don't emit
    // an empty token onto the wire scope.
    const { applyRefreshStrategy } = await import('@/connectors/vendors/index.js');
    const result = applyRefreshStrategy(
      'read write',
      undefined,
      { kind: 'scope', scope: '' },
    );
    expect(result.scope).toBe('read write');
    expect(result.scope.split(/\s+/).filter((t) => t === '').length).toBe(0);
  });

  it('strategy not applied to client_credentials flows (Microsoft .default)', async () => {
    const { createConnectorFromTemplate } = await import('@/connectors/vendors/index.js');
    const c = createConnectorFromTemplate('test-cc', 'microsoft', 'client-credentials', {
      clientId: 'cid',
      clientSecret: 'sec',
      tenantId: 'common',
    });
    const auth = c.config.auth as { type: 'oauth'; scope: string; requiredScope?: string };
    // Even though the auth-code template's refreshStrategy is `scope:offline_access`,
    // it does NOT apply to client_credentials — those flows don't issue refresh
    // tokens, so adding offline_access would be at best ignored, at worst rejected.
    expect(auth.requiredScope).toBeUndefined();
    expect(auth.scope).not.toContain('offline_access');
  });
});
