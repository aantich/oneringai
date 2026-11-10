/** Hosea-owned SIWC registration. One selected account serves every OpenAI agent. */
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { ChatGPTStatus } from '../shared/chatgpt.js';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const TERMINAL_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
interface Credentials { accessToken: string; refreshToken: string; idToken: string; expiresAt: number; scopes: string[] }
interface Profile { id: string; clientId: string; subject?: string; email?: string; credentials?: Credentials }
interface State { version: 1; hostId: string; profiles: Profile[]; activeId: string | null; usePlan: boolean }
export interface ChatGPTAuthOptions {
  directory: string;
  openExternal: (url: string) => Promise<void>;
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
  available: () => boolean;
  /** Host must also block starting new model operations for the duration of mutations. */
  assertCanChange: () => void;
  onChanged?: (status: ChatGPTStatus) => void;
  fetch?: typeof fetch;
  verifyIdentity?: (token: string, clientId: string, nonce?: string) => Promise<{ sub: string; email?: string }>;
  now?: () => number;
}
export class ChatGPTAuthService {
  private state: State = { version: 1, hostId: `urn:uuid:${randomUUID()}`, profiles: [], activeId: null, usePlan: false };
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private pending?: AbortController;
  private refreshes = new Map<string, Promise<string>>();
  private writes: Promise<void> = Promise.resolve();
  private blocked?: string;
  private mutation = false;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly options: ChatGPTAuthOptions) {
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    let bytes: Buffer;
    try { bytes = await readFile(join(this.options.directory, 'accounts.enc')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try {
      if (!this.options.available()) throw new Error('OS credential encryption is unavailable');
      const state = JSON.parse(this.options.decrypt(bytes)) as State;
      if (state.version !== 1 || !Array.isArray(state.profiles) || typeof state.hostId !== 'string'
        || typeof state.usePlan !== 'boolean' || (state.usePlan && !state.activeId)
        || new Set(state.profiles.map(p => p.id)).size !== state.profiles.length
        || state.profiles.some(p => typeof p.id !== 'string' || typeof p.clientId !== 'string' || p.clientId === 'dynamic_agent_client'
          || (p.credentials && (!p.subject || typeof p.credentials.accessToken !== 'string'
            || typeof p.credentials.refreshToken !== 'string' || !Number.isFinite(p.credentials.expiresAt)
            || !Array.isArray(p.credentials.scopes))))
        || (state.activeId !== null && !state.profiles.some(p => p.id === state.activeId))) throw new Error('Invalid saved account state');
      this.state = state;
    } catch { this.blocked = 'Saved ChatGPT credentials could not be opened. Restore OS credential access before reconnecting.'; }
  }
  status(): ChatGPTStatus {
    return { accounts: this.state.profiles.map(p => ({ id: p.id, label: `${p.email ?? 'ChatGPT account'} · ${p.id.slice(0, 8)}`,
      email: p.email, connected: !!p.credentials, planEnabled: this.hasPlan(p) })),
    activeId: this.state.activeId, usePlan: this.state.usePlan, signingIn: !!this.pending,
    available: this.options.available() && !this.blocked, ...(this.blocked ? { message: this.blocked } : {}) };
  }
  get activeProfileId(): string | null { return this.state.usePlan ? this.state.activeId : null; }
  get busy(): boolean { return this.mutation; }
  assertAPIKeyAccess(): void {
    if (this.blocked) throw new Error(this.blocked);
    if (this.mutation || this.state.usePlan) throw new Error('ChatGPT plan access is selected. Reconnect ChatGPT or explicitly choose API-key billing.');
  }
  private hasPlan(profile?: Profile): boolean { return !!profile?.credentials?.scopes.includes('chatgpt.tokens.use.direct'); }
  private profile(id: string): Profile {
    const profile = this.state.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Unknown ChatGPT account');
    return profile;
  }
  private assertAvailable(): void {
    if (this.blocked) throw new Error(this.blocked);
    if (!this.options.available()) throw new Error('ChatGPT sign-in requires OS-encrypted credential storage. Unlock or configure your system keyring.');
  }
  private async change<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    if (this.mutation) throw new Error('A ChatGPT account change is already in progress');
    this.options.assertCanChange();
    this.mutation = true;
    try { return await operation(); } finally { this.mutation = false; }
  }
  private async persist(): Promise<void> {
    let snapshot: Buffer;
    try { snapshot = this.options.encrypt(JSON.stringify(this.state)); }
    catch { this.blocked = 'ChatGPT credential persistence failed. Restore storage before making more requests.'; throw new Error(this.blocked); }
    const write = this.writes.then(async () => {
      const temporary = join(this.options.directory, `accounts-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' });
        await rename(temporary, join(this.options.directory, 'accounts.enc'));
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.writes = write.catch(() => {});
    try { await write; } catch { this.blocked = 'ChatGPT credential persistence failed. Restore storage before making more requests.'; throw new Error(this.blocked); }
    try { this.options.onChanged?.(this.status()); } catch { /* display updates cannot invalidate acknowledged storage */ }
  }
  async signIn(profileId?: string, requestConsent = false): Promise<ChatGPTStatus> {
    return this.change(async () => {
      const existing = profileId ? this.profile(profileId) : undefined;
      const controller = new AbortController();
      this.pending = controller;
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const server = createServer();
      const timer = setTimeout(() => controller.abort(new Error('ChatGPT sign-in timed out')), 300_000);
      let redirectUri = '';
      let resolveCallback!: (url: URL) => void;
      let rejectCallback!: (error: Error) => void;
      const callback = new Promise<URL>((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
      // Attach immediately: cancellation may happen while opening the browser.
      void callback.catch(() => {});
      const onAbort = () => rejectCallback(new Error('ChatGPT sign-in cancelled or timed out'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      let accepted = false;
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri || 'http://127.0.0.1');
        if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
        // Unrelated callbacks cannot consume the pending attempt, including OAuth errors.
        if (accepted || url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid authorization state.'); return; }
        accepted = true;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' });
        res.end('<!doctype html><title>Hosea</title><p>Authorization received. Return to Hosea to see the result.</p>');
        resolveCallback(url);
      });
      try {
        // Persist the installation identity before first browser authorization.
        await this.persist();
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Could not start ChatGPT callback listener');
        redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
        const url = new URL(`${ISSUER}/api/accounts/authorize`);
        url.search = new URLSearchParams({ client_id: existing?.clientId ?? 'dynamic_agent_client',
          ext_agent_host_id: this.state.hostId, response_type: 'code', redirect_uri: redirectUri,
          scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: challenge }).toString();
        if (!existing) url.searchParams.set('agent_name_hint', 'Hosea');
        if (existing?.credentials?.idToken) url.searchParams.set('id_token_hint', existing.credentials.idToken);
        if (requestConsent) url.searchParams.set('prompt', 'consent');
        await this.options.openExternal(url.toString());
        const result = await callback;
        if (result.searchParams.has('error')) throw new Error('ChatGPT authorization was declined. No billing method was changed.');
        const clientId = result.searchParams.get('client_id') ?? existing?.clientId;
        const code = result.searchParams.get('code');
        if (!code || !clientId || clientId === 'dynamic_agent_client'
          || (existing && clientId !== existing.clientId)) throw new Error('Invalid ChatGPT registration callback');
        const profile = existing ?? { id: randomUUID(), clientId };
        if (!existing) { this.state.profiles.push(profile); await this.persist(); }
        const tokens = await this.tokenRequest({ grant_type: 'authorization_code', client_id: clientId,
          code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }, controller.signal);
        const identity = await this.verifyIdentity(String(tokens.id_token ?? ''), clientId, nonce);
        if (profile.subject && profile.subject !== identity.sub) throw new Error('ChatGPT sign-in returned a different account. Add a new account instead.');
        const credentials = this.credentials(tokens);
        controller.signal.throwIfAborted();
        this.pending = undefined; // Authorization accepted; finish the atomic credential commit.
        profile.subject = identity.sub;
        profile.email = identity.email;
        profile.credentials = credentials;
        this.state.activeId = profile.id;
        this.state.usePlan = true; // A missing grant blocks inference; it never selects API-key billing.
        await this.persist();
        return this.status();
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        this.pending = undefined;
      }
    });
  }
  cancel(): void { this.pending?.abort(); }
  async select(profileId: string): Promise<ChatGPTStatus> {
    return this.change(async () => {
      const profile = this.profile(profileId);
      if (!this.hasPlan(profile)) throw new Error('Reconnect this account and enable ChatGPT plan usage first');
      this.state.activeId = profile.id; this.state.usePlan = true; await this.persist(); return this.status();
    });
  }
  async useAPIKeys(): Promise<ChatGPTStatus> {
    return this.change(async () => { this.state.usePlan = false; await this.persist(); return this.status(); });
  }
  async signOut(profileId: string): Promise<{ status: ChatGPTStatus; warning?: string }> {
    return this.change(async () => {
      const profile = this.profile(profileId);
      let warning: string | undefined;
      if (profile.credentials) {
        await this.refreshes.get(profile.id)?.catch(() => {});
        const refreshToken = profile.credentials?.refreshToken;
        let revoked = !refreshToken;
        for (let attempt = 0; refreshToken && attempt < 2 && !revoked; attempt++) {
          try {
            const discovery = await this.request(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
            const config = await discovery.json() as { revocation_endpoint?: string };
            const endpoint = new URL(config.revocation_endpoint ?? '');
            if (!discovery.ok || endpoint.origin !== ISSUER) throw new Error('Invalid revocation endpoint');
            const result = await this.request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }) });
            revoked = result.status === 200;
            if (!revoked && result.status < 500) break;
          } catch { /* Retry this idempotent operation once, retaining the token until then. */ }
          if (!revoked && attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
        }
        if (!revoked) warning = 'Signed out locally. Remote revocation was not confirmed; disconnect Hosea in ChatGPT Settings → Usage.';
      }
      profile.credentials = undefined;
      // Preserve the chosen billing path: signed-out agents must fail, never fall back to paid API keys.
      await this.persist();
      return { status: this.status(), ...(warning ? { warning } : {}) };
    });
  }
  async accessToken(profileId: string): Promise<string> {
    this.assertAvailable();
    if (this.mutation || !this.state.usePlan || this.state.activeId !== profileId) throw new Error('ChatGPT account changed; reopen this chat before continuing');
    const profile = this.profile(profileId);
    if (!this.hasPlan(profile) || !profile.credentials) throw new Error('Reconnect ChatGPT and enable plan usage in Model providers');
    if (profile.credentials.expiresAt > this.now() + 60_000) return profile.credentials.accessToken;
    const current = this.refreshes.get(profileId);
    if (current) {
      const token = await current;
      if (this.mutation || this.activeProfileId !== profileId) throw new Error('ChatGPT account changed before credential dispatch');
      return token;
    }
    const refresh = this.refresh(profile);
    this.refreshes.set(profileId, refresh);
    try {
      const token = await refresh;
      if (this.mutation || this.activeProfileId !== profileId) throw new Error('ChatGPT account changed before credential dispatch');
      return token;
    } finally { this.refreshes.delete(profileId); }
  }
  private async refresh(profile: Profile): Promise<string> {
    const previous = profile.credentials!;
    try {
      const tokens = await this.tokenRequest({ grant_type: 'refresh_token', client_id: profile.clientId,
        refresh_token: previous.refreshToken, resource: RESOURCE });
      if (typeof tokens.id_token === 'string') {
        const identity = await this.verifyIdentity(tokens.id_token, profile.clientId);
        if (identity.sub !== profile.subject) throw new Error('ChatGPT refresh returned a different account');
      }
      profile.credentials = this.credentials(tokens, previous);
      await this.persist();
      if (!this.hasPlan(profile)) throw new Error('ChatGPT plan usage permission is no longer enabled');
      return profile.credentials.accessToken;
    } catch (error) {
      if (TERMINAL_REFRESH.has((error as { code?: string }).code ?? '')) {
        profile.credentials = undefined; await this.persist();
      }
      throw error;
    }
  }
  private credentials(data: Record<string, unknown>, previous?: Credentials): Credentials {
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string'
      || !data.refresh_token || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0
      || (!previous && typeof data.id_token !== 'string')) throw new Error('ChatGPT returned invalid credentials');
    return { accessToken: data.access_token, refreshToken: data.refresh_token,
      idToken: typeof data.id_token === 'string' ? data.id_token : previous!.idToken,
      expiresAt: this.now() + Number(data.expires_in) * 1000,
      scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/) : previous?.scopes ?? [] };
  }
  private async tokenRequest(params: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.request(TOKEN_URL, { method: 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : 'chatgpt_token_error';
      throw Object.assign(new Error(`ChatGPT authorization failed (${code}). Reconnect if your session has expired.`), { code });
    }
    return data;
  }
  private async verifyIdentity(token: string, clientId: string, nonce?: string): Promise<{ sub: string; email?: string }> {
    if (this.options.verifyIdentity) return this.options.verifyIdentity(token, clientId, nonce);
    if (!this.jwks) {
      const response = await this.request(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
      const config = await response.json() as { issuer?: string; jwks_uri?: string };
      const url = new URL(config.jwks_uri ?? '');
      if (!response.ok || config.issuer !== ISSUER || url.origin !== ISSUER) throw new Error('Invalid ChatGPT identity discovery');
      this.jwks = createRemoteJWKSet(url);
    }
    const { payload } = await jwtVerify(token, this.jwks, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
    if ((nonce !== undefined && payload.nonce !== nonce) || typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number') throw new Error('Invalid ChatGPT identity or nonce');
    return { sub: payload.sub, ...(typeof payload.email === 'string' ? { email: payload.email } : {}) };
  }
}
