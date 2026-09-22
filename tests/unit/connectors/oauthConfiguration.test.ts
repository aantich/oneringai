import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRefreshStrategy, buildAuthConfig, Connector, ConnectorConfigStore,
  MemoryConnectorStorage, MemoryStorage, StorageRegistry, generateEncryptionKey,
  getVendorAuthTemplate, getVendorTemplate,
  type AuthTemplate, type ConnectorAuth, type OAuthConnectorAuth, type RefreshStrategy,
} from '@/index.js';

function template(vendor: string, method = 'oauth-user'): AuthTemplate {
  const result = getVendorAuthTemplate(vendor, method);
  if (!result) throw new Error('Missing test template');
  return result;
}

function oauth(auth: ConnectorAuth): OAuthConnectorAuth {
  if (auth.type !== 'oauth') throw new Error('Expected OAuth');
  return auth;
}

const credentials = {
  clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  redirectUri: 'https://example.invalid/callback', scope: 'openid email profile',
};

beforeEach(() => Connector.clear());
afterEach(() => { Connector.clear(); vi.restoreAllMocks(); });

describe('public refresh requirements', () => {
  it.each(['google-api', 'dropbox'])('enforces only the required parameter for %s', vendor => {
    const strategy = template(vendor).refreshStrategy!;
    if (strategy.kind !== 'auth_param') throw new Error('Expected parameter strategy');
    const params = Object.freeze({ [strategy.key]: 'online', prompt: 'select_account', custom: 'kept' });
    expect(applyRefreshStrategy('read', params, strategy).authorizationParams).toEqual(params);
    const result = applyRefreshStrategy('read', params, strategy, { enforce: true });
    expect(result).toEqual({ scope: 'read', requiredScope: undefined,
      authorizationParams: { ...params, [strategy.key]: strategy.value } });
    expect(params[strategy.key]).toBe('online');
    expect(applyRefreshStrategy(result.scope, result.authorizationParams, strategy, { enforce: true })).toEqual(result);
  });

  it.each([
    ['microsoft', 'offline_access'], ['salesforce', 'refresh_token'], ['twitter', 'offline.access'],
  ])('merges the exact required scope for %s', (vendor, required) => {
    const result = applyRefreshStrategy('api.read', { prompt: 'custom' }, template(vendor).refreshStrategy,
      { enforce: true, requiredScope: 'custom.required custom.required' });
    expect(result.scope).toBe(`api.read custom.required ${required}`);
    expect(result.requiredScope).toBe(`custom.required ${required}`);
    expect(result.authorizationParams).toEqual({ prompt: 'custom' });
    expect(applyRefreshStrategy(result.scope, result.authorizationParams, template(vendor).refreshStrategy,
      { enforce: true, requiredScope: result.requiredScope })).toEqual(result);
  });

  it.each<RefreshStrategy>([
    { kind: 'automatic' }, { kind: 'never_expires' }, { kind: 'manual_setup', description: 'Provider setup' },
  ])('does not invent request fields for $kind', strategy => {
    expect(applyRefreshStrategy('read', {}, strategy, { enforce: true })).toEqual({
      scope: 'read', requiredScope: undefined, authorizationParams: {},
    });
  });

  it.each<RefreshStrategy | undefined>([
    undefined, { kind: 'automatic' }, { kind: 'never_expires' },
    { kind: 'manual_setup', description: 'Provider setup' },
    { kind: 'auth_param', key: 'access_type', value: 'offline' },
    { kind: 'scope', scope: 'offline_access' },
  ])('reconciles duplicate scope fields without mutating inputs (%j)', strategy => {
    const params = Object.freeze({ scope: 'stale.scope', prompt: 'select_account', custom: 'kept' });
    const result = applyRefreshStrategy('openid email profile', params, strategy);
    expect(result.scope).toBe(strategy?.kind === 'scope'
      ? 'openid email profile offline_access' : 'openid email profile');
    expect(result.authorizationParams).not.toHaveProperty('scope');
    expect(result.authorizationParams).toMatchObject({ prompt: 'select_account', custom: 'kept' });
    expect(params.scope).toBe('stale.scope');
    expect(applyRefreshStrategy(result.scope, result.authorizationParams, strategy,
      { requiredScope: result.requiredScope })).toEqual(result);
  });

  it.each([
    { scope: undefined, expected: 'legacy.read offline_access' },
    { scope: '', expected: 'offline_access' },
  ])('uses parameter-only scopes only when scope is absent ($scope)', ({ scope, expected }) => {
    const result = applyRefreshStrategy(scope, { scope: 'legacy.read' },
      { kind: 'scope', scope: 'offline_access' });
    expect(result.scope).toBe(expected);
    expect(result.authorizationParams).not.toHaveProperty('scope');
  });

  it('supports a future provider and multiple required tokens without a vendor branch', () => {
    const strategy: RefreshStrategy = { kind: 'scope', scope: 'future.renew future.background' };
    expect(applyRefreshStrategy('read future.renew', undefined, strategy, { enforce: true })).toEqual({
      scope: 'read future.renew future.background', requiredScope: 'future.renew future.background',
      authorizationParams: undefined,
    });
  });

  it('rejects missing strategy only when enforcement is requested', () => {
    expect(() => applyRefreshStrategy('read', undefined, undefined, { enforce: true })).toThrow('strategy is required');
    expect(applyRefreshStrategy('read', undefined, undefined)).toEqual({
      scope: 'read', requiredScope: undefined, authorizationParams: undefined,
    });
  });
});

describe('creation, update and reconstructed authorization URLs', () => {
  it('preserves creation defaults and explicit scope overrides', () => {
    const defaults = oauth(buildAuthConfig(template('google-api'), { ...credentials, scope: undefined }));
    expect(defaults.scope).toContain('https://www.googleapis.com/auth/drive');
    expect(defaults.authorizationParams?.prompt).toBe('consent');
    expect(oauth(buildAuthConfig(template('google-api'), credentials)).scope).toBe(credentials.scope);
  });

  it.each([undefined, ''])('never imports broad scope or prompt defaults into an update (%s)', scope => {
    const saved = oauth(buildAuthConfig(template('google-api'), credentials));
    saved.scope = scope;
    saved.authorizationParams = {};
    const updated = oauth(buildAuthConfig(template('google-api'), {}, { existingAuth: saved }));
    expect(updated.scope).toBe(scope);
    expect(updated.authorizationParams).toEqual({ access_type: 'offline' });
    expect(saved.authorizationParams).toEqual({});
  });

  it.each([undefined, null, '', 'custom.required'])('backfills alongside existing requiredScope=%s', requiredScope => {
    const config = oauth(buildAuthConfig(template('microsoft'), { ...credentials, tenantId: 'common' }));
    config.scope = 'https://graph.microsoft.com/.default';
    config.requiredScope = requiredScope as string | undefined;
    const connector = Connector.create({ name: 'restored', serviceType: 'microsoft', auth: config });
    return connector.startAuth('user', 'account').then(url => {
      const scope = new URL(url).searchParams.get('scope')!.split(/\s+/);
      expect(scope).toContain('https://graph.microsoft.com/.default');
      expect(scope.filter(s => s === 'offline_access')).toHaveLength(1);
      if (requiredScope) expect(scope.filter(s => s === requiredScope)).toHaveLength(1);
    });
  });

  it('applies Google parameters even when another required scope already exists', async () => {
    const auth = oauth(buildAuthConfig(template('google-api'), credentials));
    auth.requiredScope = 'custom.required';
    auth.authorizationParams = { prompt: 'select_account' };
    const connector = Connector.create({ name: 'restored', serviceType: 'google-api', auth });
    const params = new URL(await connector.startAuth()).searchParams;
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('select_account');
    expect(params.get('scope')!.split(/\s+/).filter(s => s === 'custom.required')).toHaveLength(1);
  });

  it.each(['google-api', 'microsoft'])('preserves parameter-only scopes during %s reconstruction', async vendor => {
    const auth = oauth(buildAuthConfig(template(vendor), credentials));
    delete auth.scope;
    auth.authorizationParams = { scope: 'legacy.read', prompt: 'select_account' };
    const connector = Connector.create({ name: 'legacy-params', serviceType: vendor, auth });
    const params = new URL(await connector.startAuth()).searchParams;
    expect(params.getAll('scope')).toEqual([vendor === 'microsoft'
      ? 'legacy.read offline_access' : 'legacy.read']);
    expect(params.get('prompt')).toBe('select_account');
  });

  it('does not silently opt an existing online connector into enforcement', async () => {
    const auth = oauth(buildAuthConfig(template('google-api'), credentials));
    auth.authorizationParams = { access_type: 'online' };
    const connector = Connector.create({ name: 'online', serviceType: 'google-api', auth });
    expect(new URL(await connector.startAuth()).searchParams.get('access_type')).toBe('online');
  });

  it('does not guess between conflicting strategies for one service', async () => {
    const vendor = getVendorTemplate('google-api')!;
    const original = vendor.authTemplates;
    vendor.authTemplates = [...original, { ...template('google-api'), id: 'alternate',
      refreshStrategy: { kind: 'scope', scope: 'different' } }];
    try {
      const auth = oauth(buildAuthConfig(original[0]!, credentials));
      auth.authorizationParams = {};
      const connector = Connector.create({ name: 'ambiguous', serviceType: vendor.serviceType, auth });
      expect(new URL(await connector.startAuth()).searchParams.has('access_type')).toBe(false);
    } finally { vendor.authTemplates = original; }
  });

  it('accepts matching strategy metadata regardless of property order', async () => {
    const vendor = getVendorTemplate('google-api')!;
    const original = vendor.authTemplates;
    vendor.authTemplates = [...original, { ...template('google-api'), id: 'alternate',
      refreshStrategy: { value: 'offline', key: 'access_type', kind: 'auth_param' } }];
    try {
      const auth = oauth(buildAuthConfig(original[0]!, credentials));
      auth.authorizationParams = {};
      const connector = Connector.create({ name: 'same-strategy', serviceType: vendor.serviceType, auth });
      expect(new URL(await connector.startAuth()).searchParams.get('access_type')).toBe('offline');
    } finally { vendor.authTemplates = original; }
  });
});

describe('saved template updates', () => {
  let storage: MemoryConnectorStorage;
  let store: ConnectorConfigStore;
  beforeEach(() => {
    storage = new MemoryConnectorStorage();
    store = new ConnectorConfigStore(storage, generateEncryptionKey());
  });

  async function customized(vendor = 'google-api') {
    await store.saveFromTemplate('saved', vendor, 'oauth-user', { ...credentials, tenantId: 'old-tenant' });
    const raw = (await storage.get('saved'))!;
    const auth = oauth(raw.config.auth);
    auth.authorizationParams = { access_type: 'offline', prompt: 'select_account', custom: 'kept' };
    auth.storageKey = 'custom-token-namespace';
    auth.refreshBeforeExpiry = 120;
    auth.usePKCE = false;
    auth.extra = { ...auth.extra, custom: 'retained' };
    await storage.save('saved', raw);
    return oauth((await store.get('saved'))!.auth);
  }

  it('preserves all auth settings on a display-name edit with one read and one write', async () => {
    const before = await customized();
    const get = vi.spyOn(storage, 'get');
    const save = vi.spyOn(storage, 'save');
    const updated = await store.updateFromTemplate('saved', 'google-api', 'oauth-user', {}, { displayName: 'New label' });
    expect(updated.auth).toEqual(before);
    expect(updated.displayName).toBe('New label');
    expect(get).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('preserves empty secrets and safely replaces supplied secrets/scopes', async () => {
    const before = await customized();
    const blank = await store.updateFromTemplate('saved', 'google-api', 'oauth-user', { clientSecret: '' });
    expect(oauth(blank.auth).clientSecret).toBe(before.clientSecret);
    const after = oauth((await store.updateFromTemplate('saved', 'google-api', 'oauth-user', {
      clientSecret: 'synthetic-replacement', scope: 'openid email profile calendar.read',
    })).auth);
    expect(after).toEqual({ ...before, clientSecret: 'synthetic-replacement', scope: 'openid email profile calendar.read' });
    expect(oauth((await storage.get('saved'))!.config.auth).clientSecret).not.toBe(after.clientSecret);
  });

  it.each([
    ['google-api', 'openid email profile'], ['google-api', 'openid'],
    ['microsoft', 'openid email profile'], ['microsoft', 'openid'],
  ])('scope edits survive stale parameters, persistence and reload (%s, %s)', async (vendor, editedScope) => {
    await customized(vendor);
    const raw = (await storage.get('saved'))!;
    const auth = oauth(raw.config.auth);
    auth.scope = 'openid email';
    auth.authorizationParams!.scope = 'openid email';
    await storage.save('saved', raw);
    await store.updateFromTemplate('saved', vendor, 'oauth-user', { scope: editedScope });
    const reloaded = (await store.get('saved'))!;
    const expected = vendor === 'microsoft' ? `${editedScope} offline_access` : editedScope;
    expect(oauth(reloaded.auth).scope).toBe(expected);
    expect(oauth(reloaded.auth).authorizationParams).not.toHaveProperty('scope');
    const connector = Connector.create(reloaded);
    const params = new URL(await connector.startAuth('user', 'account')).searchParams;
    expect(params.getAll('scope')).toEqual([expected]);
    expect(params.get('prompt')).toBe('select_account');
    expect(params.get('custom')).toBe('kept');
  });

  it('promotes parameter-only scopes on an unrelated saved-config edit', async () => {
    await customized();
    const raw = (await storage.get('saved'))!;
    const auth = oauth(raw.config.auth);
    delete auth.scope;
    auth.authorizationParams!.scope = 'legacy.read';
    await storage.save('saved', raw);
    await store.updateFromTemplate('saved', 'google-api', 'oauth-user', {}, { displayName: 'Renamed' });
    const reloaded = (await store.get('saved'))!;
    expect(oauth(reloaded.auth).scope).toBe('legacy.read');
    expect(oauth(reloaded.auth).authorizationParams).not.toHaveProperty('scope');
    expect(new URL(await Connector.create(reloaded).startAuth()).searchParams.get('scope')).toBe('legacy.read');
  });

  it('updates generated Microsoft tenant URLs and preserves unrelated settings', async () => {
    const before = await customized('microsoft');
    const after = oauth((await store.updateFromTemplate('saved', 'microsoft', 'oauth-user', { tenantId: 'new-tenant' })).auth);
    expect(after.tokenUrl).toContain('/new-tenant/');
    expect(after.authorizationUrl).toContain('/new-tenant/');
    expect(after.extra).toEqual({ ...before.extra, tenantId: 'new-tenant' });
    expect(after.storageKey).toBe(before.storageKey);
  });

  it('preserves custom endpoints when a template parameter changes', async () => {
    await customized('microsoft');
    const raw = (await storage.get('saved'))!;
    const auth = oauth(raw.config.auth);
    auth.tokenUrl = 'https://custom.invalid/token';
    auth.authorizationUrl = 'https://custom.invalid/authorize';
    await storage.save('saved', raw);
    const after = oauth((await store.updateFromTemplate('saved', 'microsoft', 'oauth-user', { tenantId: 'new-tenant' })).auth);
    expect(after.tokenUrl).toBe(auth.tokenUrl);
    expect(after.authorizationUrl).toBe(auth.authorizationUrl);
  });

  it('does not import old settings or secrets when explicitly changing auth method', async () => {
    await customized('microsoft');
    await expect(store.updateFromTemplate('saved', 'microsoft', 'client-credentials', {})).rejects.toThrow('requires credentials');
    const next = oauth((await store.updateFromTemplate('saved', 'microsoft', 'client-credentials', {
      clientId: 'new-client', clientSecret: 'new-secret', tenantId: 'new-tenant',
    })).auth);
    expect(next.storageKey).toBeUndefined();
    expect(next.authorizationParams).toBeUndefined();
    expect(next.scope).not.toContain('offline_access');
    expect(next.clientSecret).toBe('new-secret');
  });

  it('preserves compatible legacy settings and rejects ambiguous legacy ownership', async () => {
    const before = await customized();
    const raw = (await storage.get('saved'))!;
    delete raw.vendorId;
    delete raw.authTemplateId;
    await storage.save('saved', raw);
    expect((await store.updateFromTemplate('saved', 'google-api', 'oauth-user', {})).auth).toEqual(before);
    delete raw.config.serviceType;
    delete raw.config.vendor;
    await storage.save('saved', raw);
    await expect(store.updateFromTemplate('saved', 'google-api', 'oauth-user', {})).rejects.toThrow('Cannot infer');
  });

  it('retained accounts remain discoverable and usable after update and reconstruction', async () => {
    const before = await customized();
    const tokens = new MemoryStorage();
    StorageRegistry.set('oauthTokens', tokens);
    await tokens.storeToken(`${before.storageKey}:user:account`, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer',
      expires_in: 3600, obtained_at: Date.now(), scope: before.scope,
    });
    const config = await store.updateFromTemplate('saved', 'google-api', 'oauth-user', {}, { displayName: 'New label' });
    const connector = Connector.create(config);
    expect(await connector.listAccounts('user')).toEqual(['account']);
    expect(await connector.getToken('user', 'account')).toBe('synthetic-access');
  });
});
