import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGPTAuthService, type ChatGPTAuthOptions } from '../src/main/ChatGPTAuthService.js';

async function fixture(options: Partial<ChatGPTAuthOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hosea-chatgpt-test-'));
  let now = Date.now(); let registrations = 0; let refreshes = 0; let requested: URL | undefined;
  let grantedScopes = 'openid email offline_access resource.invoke chatgpt.tokens.use.direct';
  let refreshError = ''; let mismatch = false;
  const exchanges: URLSearchParams[] = [];
  const config: ChatGPTAuthOptions = {
    directory, available: () => true, assertCanChange: () => {}, now: () => now,
    // Deliberately reversible test codec, without storing plaintext fixture tokens on disk.
    encrypt: text => Buffer.from(Buffer.from(text).map(b => b ^ 53)),
    decrypt: bytes => Buffer.from(bytes.map(b => b ^ 53)).toString(),
    openExternal: async url => {
      requested = new URL(url);
      const callback = new URL(requested.searchParams.get('redirect_uri')!);
      assert.equal(callback.hostname, '127.0.0.1'); assert.equal(callback.pathname, '/auth/callback');
      callback.search = new URLSearchParams({ state: 'wrong-state', error: 'access_denied' }).toString();
      assert.equal((await fetch(callback)).status, 400);
      callback.search = new URLSearchParams({ state: requested.searchParams.get('state')!, code: 'test-code',
        client_id: requested.searchParams.get('client_id') === 'dynamic_agent_client' ? `oaiapp_${++registrations}` : requested.searchParams.get('client_id')! }).toString();
      assert.equal((await fetch(callback)).status, 200);
    },
    verifyIdentity: async (_token, _client, nonce) => {
      if (nonce !== undefined) assert.equal(nonce, requested!.searchParams.get('nonce'));
      return { sub: mismatch ? 'different-user' : 'test-user', email: 'person@example.test' };
    },
    fetch: (async (url, init) => {
      if (String(url).includes('openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/revoke' });
      if (String(url).endsWith('/revoke')) return new Response('', { status: 200 });
      const body = new URLSearchParams(init?.body as URLSearchParams); exchanges.push(body);
      if (body.get('grant_type') === 'refresh_token') {
        refreshes++;
        if (refreshError) return Response.json({ error: refreshError }, { status: 400 });
      }
      return Response.json({ access_token: `access-${exchanges.length}`, refresh_token: `refresh-${exchanges.length}`,
        id_token: 'test-id-token', expires_in: 3600, scope: grantedScopes });
    }) as typeof fetch,
    ...options,
  };
  const service = new ChatGPTAuthService(config); await service.initialize();
  return { service, directory, config, exchanges, get requested() { return requested!; }, get refreshes() { return refreshes; },
    advance() { now += 3600_000; }, set scopes(value: string) { grantedScopes = value; },
    set refreshError(value: string) { refreshError = value; }, set mismatch(value: boolean) { mismatch = value; },
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('one sign-in supplies every caller; fresh registration, protected persistence and reuse are correct', async () => {
  const f = await fixture();
  try {
    const initial = await f.service.signIn(); const id = initial.activeId!;
    assert.equal(initial.usePlan, true); assert.equal(initial.accounts.length, 1);
    assert.equal(f.exchanges[0].get('client_id'), 'oaiapp_1');
    assert.equal(f.exchanges[0].get('resource'), 'https://api.openai.com/v1');
    assert.equal(f.requested.searchParams.get('agent_name_hint'), 'Hosea');
    const host = f.requested.searchParams.get('ext_agent_host_id');
    assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => f.service.accessToken(id))), Array(20).fill('access-1'));
    const bytes = await readFile(join(f.directory, 'accounts.enc'));
    assert.equal(bytes.includes(Buffer.from('access-1')), false);
    assert.equal(JSON.stringify(initial).includes('access-1'), false);
    const restored = new ChatGPTAuthService(f.config); await restored.initialize();
    assert.equal(await restored.accessToken(id), 'access-1');
    await f.service.signIn(id);
    assert.equal(f.requested.searchParams.get('client_id'), 'oaiapp_1');
    assert.equal(f.requested.searchParams.get('agent_name_hint'), null);
    assert.equal(f.requested.searchParams.get('ext_agent_host_id'), host);
    assert.equal(f.service.status().accounts.length, 1);
  } finally { await f.cleanup(); }
});

test('concurrent agents share one refresh and rotated credentials survive restart', async () => {
  const f = await fixture();
  try {
    const id = (await f.service.signIn()).activeId!; f.advance();
    const tokens = await Promise.all(Array.from({ length: 20 }, () => f.service.accessToken(id)));
    assert.equal(f.refreshes, 1); assert.equal(new Set(tokens).size, 1);
    const restored = new ChatGPTAuthService(f.config); await restored.initialize();
    assert.equal(await restored.accessToken(id), 'access-2');
  } finally { await f.cleanup(); }
});

test('account registrations remain distinct, reject stale agents, and identity mismatch preserves credentials', async () => {
  const f = await fixture();
  try {
    const first = (await f.service.signIn()).activeId!;
    const second = (await f.service.signIn()).activeId!;
    assert.notEqual(first, second); assert.equal(f.service.status().accounts.length, 2);
    await assert.rejects(f.service.accessToken(first), /account changed/);
    await f.service.select(first); assert.equal(await f.service.accessToken(first), 'access-1');
    f.mismatch = true;
    await assert.rejects(f.service.signIn(first), /different account/);
    assert.equal(await f.service.accessToken(first), 'access-1');
  } finally { await f.cleanup(); }
});

test('identity alone cannot enable inference; refresh revocation never selects API-key billing', async () => {
  const f = await fixture();
  try {
    f.scopes = 'openid email';
    const status = await f.service.signIn(); assert.equal(status.usePlan, true);
    await assert.rejects(f.service.select(status.activeId!), /enable ChatGPT plan/);
    f.scopes = 'openid offline_access resource.invoke chatgpt.tokens.use.direct';
    await f.service.signIn(status.activeId!); f.advance(); f.refreshError = 'invalid_grant';
    await assert.rejects(f.service.accessToken(status.activeId!), /invalid_grant/);
    assert.equal(f.service.status().usePlan, true);
    assert.equal(f.service.status().accounts[0].connected, false);
  } finally { await f.cleanup(); }
});

test('logout revokes and clears tokens while retaining registration and selected billing path', async () => {
  const f = await fixture();
  try {
    const id = (await f.service.signIn()).activeId!;
    const result = await f.service.signOut(id);
    assert.equal(result.warning, undefined); assert.equal(result.status.usePlan, true);
    await assert.rejects(f.service.accessToken(id), /Reconnect/);
    await f.service.signIn(id); assert.equal(f.requested.searchParams.get('client_id'), 'oaiapp_1');
    assert.equal(f.requested.searchParams.has('id_token_hint'), false);
    await f.service.useAPIKeys(); assert.equal(f.service.status().usePlan, false);
    await assert.rejects(f.service.accessToken(id), /account changed/);
  } finally { await f.cleanup(); }
});

test('unreadable credentials and unavailable OS encryption fail closed', async () => {
  const f = await fixture();
  try {
    await f.service.signIn();
    const service = new ChatGPTAuthService({ ...f.config, decrypt: () => { throw new Error('locked'); } });
    await service.initialize(); assert.equal(service.status().available, false);
    await assert.rejects(service.signIn(), /could not be opened/);
    assert.throws(() => service.assertAPIKeyAccess(), /could not be opened/);
    const unavailable = new ChatGPTAuthService({ ...f.config, available: () => false });
    await unavailable.initialize(); await assert.rejects(unavailable.signIn(), /credentials could not be opened/);
  } finally { await f.cleanup(); }
});

test('temporary refresh failures retain credentials; account changes respect host execution', async () => {
  let idle = true;
  const f = await fixture({ assertCanChange: () => { if (!idle) throw new Error('agent running'); } });
  try {
    const id = (await f.service.signIn()).activeId!; f.advance(); f.refreshError = 'temporarily_unavailable';
    await assert.rejects(f.service.accessToken(id), /temporarily_unavailable/);
    assert.equal(f.service.status().accounts[0].connected, true);
    idle = false; await assert.rejects(f.service.useAPIKeys(), /agent running/);
    assert.equal(f.service.status().usePlan, true);
  } finally { await f.cleanup(); }
});

test('cancelling authorization closes its listener without replacing the selected account', async () => {
  let opened!: () => void;
  const browser = new Promise<void>(resolve => { opened = resolve; });
  let callbackURL = '';
  const f = await fixture({ openExternal: async address => { callbackURL = new URL(address).searchParams.get('redirect_uri')!; opened(); } });
  try {
    const attempt = f.service.signIn();
    await browser; f.service.cancel();
    await assert.rejects(attempt, /cancelled/);
    assert.equal(f.service.status().signingIn, false);
    assert.equal(f.service.status().activeId, null);
    await assert.rejects(fetch(callbackURL));
  } finally { await f.cleanup(); }
});

test('failed code exchange retains the issued client registration for reconnection', async () => {
  let allow = false;
  const f = await fixture({ fetch: (async () => allow
    ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'id', expires_in: 3600,
      scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' })
    : Response.json({ error: 'invalid_grant' }, { status: 400 })) as typeof fetch });
  try {
    await assert.rejects(f.service.signIn(), /invalid_grant/);
    const registration = f.service.status().accounts[0];
    assert.equal(registration.connected, false);
    allow = true;
    await f.service.signIn(registration.id);
    assert.equal(f.requested.searchParams.get('client_id'), 'oaiapp_1');
    assert.equal(f.service.status().accounts.length, 1);
  } finally { await f.cleanup(); }
});

test('failure to encrypt a rotated token blocks later dispatch instead of using unpersisted credentials', async () => {
  let fail = false;
  const f = await fixture({ encrypt: text => {
    if (fail) throw new Error('keyring locked');
    return Buffer.from(Buffer.from(text).map(b => b ^ 53));
  } });
  try {
    const id = (await f.service.signIn()).activeId!;
    fail = true; f.advance();
    await assert.rejects(f.service.accessToken(id), /persistence failed/);
    await assert.rejects(f.service.accessToken(id), /persistence failed/);
    assert.throws(() => f.service.assertAPIKeyAccess(), /persistence failed/);
    assert.equal(f.service.status().usePlan, true);
  } finally { await f.cleanup(); }
});

test('cancellation during identity verification cannot activate the pending account', async () => {
  let verifyStarted!: () => void; let finishVerification!: () => void;
  const started = new Promise<void>(resolve => { verifyStarted = resolve; });
  const verification = new Promise<void>(resolve => { finishVerification = resolve; });
  const f = await fixture({ verifyIdentity: async () => {
    verifyStarted(); await verification;
    return { sub: 'test-user', email: 'person@example.test' };
  } });
  try {
    const attempt = f.service.signIn();
    await started; f.service.cancel(); finishVerification();
    await assert.rejects(attempt);
    assert.equal(f.service.status().activeId, null);
    assert.equal(f.service.status().accounts[0].connected, false);
  } finally { await f.cleanup(); }
});

for (const permanent of [false, true]) {
  test(`logout retries revocation safely and reports ${permanent ? 'unconfirmed' : 'confirmed'} remote cleanup`, async () => {
    let revocations = 0;
    const f = await fixture({ fetch: (async url => {
      if (String(url).includes('openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/revoke' });
      if (String(url).endsWith('/revoke')) {
        revocations++;
        if (permanent) return new Response('', { status: 503 });
        if (revocations === 1) throw new Error('offline');
        return new Response('', { status: 200 });
      }
      return Response.json({ access_token: 'access', refresh_token: 'refresh', id_token: 'id', expires_in: 3600,
        scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' });
    }) as typeof fetch });
    try {
      const id = (await f.service.signIn()).activeId!;
      const result = await f.service.signOut(id);
      assert.equal(revocations, 2);
      assert.equal(!!result.warning, permanent);
      assert.equal(result.status.accounts[0].connected, false);
      assert.equal(result.status.usePlan, true);
      assert.throws(() => f.service.assertAPIKeyAccess(), /ChatGPT plan access is selected/);
    } finally { await f.cleanup(); }
  });
}


test('production OIDC validation accepts a signed identity and rejects invalid nonce, audience, expiry and required claims', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'hosea-test-key', alg: 'RS256', use: 'sig' };
  const originalFetch = globalThis.fetch;
  let variant = 'valid';
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.href === 'https://auth.openai.com/jwks') return Response.json({ keys: [jwk] });
    if (url.hostname === '127.0.0.1') return originalFetch(input, init);
    throw new Error('Offline identity test blocked external network');
  }) as typeof fetch;
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    f = await fixture({ verifyIdentity: undefined, fetch: (async (url, init) => {
      if (String(url).includes('openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks' });
      const clientId = new URLSearchParams(init?.body as URLSearchParams).get('client_id')!;
      const token = new SignJWT({ nonce: variant === 'nonce' ? 'other-attempt' : f!.requested.searchParams.get('nonce'), email: 'signed@example.test' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer('https://auth.openai.com')
        .setAudience(variant === 'audience' ? 'different-client' : clientId).setSubject('signed-user')
        .setExpirationTime(variant === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '1h');
      if (variant !== 'missing-iat') token.setIssuedAt();
      let idToken = await token.sign(privateKey);
      if (variant === 'signature') { const parts = idToken.split('.'); parts[2] = (parts[2].startsWith('A') ? 'B' : 'A') + parts[2].slice(1); idToken = parts.join('.'); }
      return Response.json({ id_token: idToken, access_token: 'verified-access', refresh_token: 'verified-refresh',
        expires_in: 3600, scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' });
    }) as typeof fetch });
    const id = (await f.service.signIn()).activeId!;
    assert.equal(await f.service.accessToken(id), 'verified-access');
    for (variant of ['nonce', 'audience', 'expired', 'missing-iat', 'signature']) {
      await assert.rejects(f.service.signIn(id));
      assert.equal(await f.service.accessToken(id), 'verified-access');
      assert.equal(f.service.status().activeId, id);
    }
  } finally { globalThis.fetch = originalFetch; await f?.cleanup(); }
});
