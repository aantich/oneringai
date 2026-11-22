import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { Connector } from '../../core/Connector.js';
import { Vendor } from '../../core/Vendor.js';
import type { OAuthSessionStorage } from './domain/OAuthSessionStorage.js';
import { generatePKCE, generateState } from './utils/pkce.js';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const DYNAMIC_CLIENT = 'dynamic_agent_client';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const CALLBACK_PATH = '/auth/callback';
const INVALID_TOKEN_RESPONSE = 'invalid_chatgpt_token_response';
const TERMINAL_REFRESH = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused',
]);

interface Credentials {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}

interface Profile {
  id: string;
  clientId: string;
  subject?: string;
  email?: string;
  credentials?: Credentials;
}

// Keep the version 1 snapshot compatible with existing Hosea installations.
interface State {
  version: 1;
  hostId: string;
  profiles: Profile[];
  activeId: string | null;
  usePlan: boolean;
}

/** Public account details suitable for application UI. */
export interface ChatGPTPlanAccount {
  id: string;
  label: string;
  email?: string;
  connected: boolean;
  planEnabled: boolean;
}

/** Credential-free account and optional selection state. */
export interface ChatGPTPlanAuthStatus {
  accounts: ChatGPTPlanAccount[];
  activeId: string | null;
  usePlan: boolean;
  signingIn: boolean;
  available: boolean;
  message?: string;
}

export interface ChatGPTPlanAuthOptions {
  /** The actual name of the host app, used for first-time OpenAI registration. */
  applicationName: string;
  /** Opens the provided URL in the system browser. Authorization URLs are private. */
  openBrowser(url: string): Promise<void> | void;
  /** Host-owned credential storage. Use a single manager and process per store. */
  storage: OAuthSessionStorage;
  /** Optional host check for whether an account change can start. */
  assertCanChange?(): void;
  /** Observes committed state without receiving credential material. */
  onChanged?(status: ChatGPTPlanAuthStatus): void;
  /** Optional host transport for OAuth and OIDC requests. */
  fetch?: typeof fetch;
  /** Optional clock for calculating token expiry. Defaults to Date.now. */
  now?: () => number;
}

export interface ChatGPTPlanSignInOptions {
  /** Reuse this registration, or omit it to register a new account. */
  accountId?: string;
  /** Request consent again after the user explicitly asks to enable plan usage. */
  requestConsent?: boolean;
  /** Set this host's optional selection when authorization commits. Defaults to false. */
  select?: boolean;
  signal?: AbortSignal;
}

function hasPlan(profile: Profile): boolean {
  return profile.credentials?.scopes.includes(PLAN_SCOPE) ?? false;
}

function accountInfo(profile: Profile): ChatGPTPlanAccount {
  return {
    id: profile.id,
    label: `${profile.email ?? 'ChatGPT account'} · ${profile.id.slice(0, 8)}`,
    email: profile.email,
    connected: !!profile.credentials,
    planEnabled: hasPlan(profile),
  };
}

function validProfile(profile: Profile): boolean {
  if (typeof profile.id !== 'string' || !profile.id || typeof profile.clientId !== 'string'
    || !profile.clientId || profile.clientId === DYNAMIC_CLIENT
    || (profile.subject !== undefined && typeof profile.subject !== 'string')
    || (profile.email !== undefined && typeof profile.email !== 'string')) return false;
  const credentials = profile.credentials;
  return credentials === undefined || !!(credentials && profile.subject
    && typeof credentials.accessToken === 'string' && credentials.accessToken
    && (credentials.refreshToken === undefined || (typeof credentials.refreshToken === 'string' && credentials.refreshToken))
    && typeof credentials.idToken === 'string' && credentials.idToken
    && Number.isFinite(credentials.expiresAt) && Array.isArray(credentials.scopes)
    && credentials.scopes.every(scope => typeof scope === 'string'));
}

function parseState(snapshot: string): State {
  const state = JSON.parse(snapshot) as State;
  if (state.version !== 1 || typeof state.hostId !== 'string' || !state.hostId
    || !Array.isArray(state.profiles) || typeof state.usePlan !== 'boolean'
    || (state.usePlan && !state.activeId)
    || new Set(state.profiles.map(p => p.id)).size !== state.profiles.length
    || !state.profiles.every(validProfile)
    || (state.activeId !== null && !state.profiles.some(p => p.id === state.activeId))) {
    throw new Error('Invalid saved ChatGPT account state');
  }
  return state;
}

/** Local Node.js Sign in with ChatGPT flow for eligible open-source hosts. */
export class ChatGPTPlanAuth {
  readonly #options: ChatGPTPlanAuthOptions;
  #state: State = { version: 1, hostId: `urn:uuid:${randomUUID()}`, profiles: [], activeId: null, usePlan: false };
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private initialization?: Promise<void>;
  private initialized = false;
  private pending?: AbortController;
  private readonly refreshes = new Map<string, Promise<string>>();
  private writes: Promise<void> = Promise.resolve();
  private blocked?: string;
  private mutation = false;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(options: ChatGPTPlanAuthOptions) {
    this.#options = options;
    if (!options.applicationName.trim()) throw new Error('ChatGPT sign-in requires an application name');
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Load saved registrations before using the manager. Repeated calls share the same load. */
  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }

  private async load(): Promise<void> {
    try {
      const snapshot = await this.#options.storage.load();
      if (snapshot !== null) this.#state = parseState(snapshot);
    } catch {
      this.blocked = 'Saved ChatGPT credentials could not be opened. Restore credential storage before reconnecting.';
    }
    this.initialized = true;
  }

  status(): ChatGPTPlanAuthStatus {
    return {
      accounts: this.#state.profiles.map(accountInfo),
      activeId: this.#state.activeId,
      usePlan: this.#state.usePlan,
      signingIn: !!this.pending,
      available: this.initialized && !this.blocked && this.storageAvailable(),
      ...(this.blocked ? { message: this.blocked } : {}),
    };
  }

  get selectedAccountId(): string | null { return this.#state.usePlan ? this.#state.activeId : null; }
  get busy(): boolean { return this.mutation; }

  private storageAvailable(): boolean {
    return this.#options.storage.available?.() ?? true;
  }

  private assertAvailable(): void {
    if (!this.initialized) throw new Error('Initialize ChatGPT sign-in before using it');
    if (this.blocked) throw new Error(this.blocked);
    if (!this.storageAvailable()) throw new Error('ChatGPT sign-in requires protected credential storage. Unlock or configure your credential store.');
  }

  private profile(id: string): Profile {
    const profile = this.#state.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Unknown ChatGPT account');
    return profile;
  }

  private async change<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    if (this.mutation) throw new Error('A ChatGPT account change is already in progress');
    this.#options.assertCanChange?.();
    this.mutation = true;
    try {
      // An admitted refresh must settle before revocation or reauthorization reads its token.
      if (this.refreshes.size) await Promise.allSettled(this.refreshes.values());
      this.assertAvailable();
      return await operation();
    } finally {
      this.mutation = false;
    }
  }

  private commit(update: (state: State) => State): Promise<void> {
    const write = this.writes.then(async () => {
      const next = update(this.#state);
      try {
        this.assertAvailable();
        await this.#options.storage.save(JSON.stringify(next));
      } catch {
        this.blocked = 'ChatGPT credential persistence failed. Restore storage before making more requests.';
        throw new Error(this.blocked);
      }
      this.#state = next;
      try { this.#options.onChanged?.(this.status()); } catch { /* display updates cannot invalidate committed credentials */ }
    });
    this.writes = write.catch(() => {});
    return write;
  }

  private replaceProfile(profile: Profile, select = false): Promise<void> {
    return this.commit(state => ({
      ...state,
      profiles: state.profiles.map(existing => existing.id === profile.id ? profile : existing),
      ...(select ? { activeId: profile.id, usePlan: true } : {}),
    }));
  }

  /** Register or reauthorize an account. A successful identity may still lack the plan grant. */
  async signIn(options: ChatGPTPlanSignInOptions = {}): Promise<ChatGPTPlanAccount> {
    return this.change(() => this.authorize(options));
  }

  private async authorize(options: ChatGPTPlanSignInOptions): Promise<ChatGPTPlanAccount> {
    const existing = options.accountId === undefined ? undefined : this.profile(options.accountId);
    const controller = new AbortController();
    const signals = [controller.signal, AbortSignal.timeout(300_000)];
    if (options.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);
    const cancelError = () => new Error('ChatGPT sign-in cancelled or timed out');
    if (signal.aborted) throw cancelError();

    const state = generateState();
    const nonce = generateState();
    const { codeVerifier, codeChallenge } = generatePKCE();
    const server = createServer();
    this.pending = controller;
    let redirect: URL;
    let accepted = false;
    const callback = new Promise<URL>(resolve => {
      server.on('request', (req, res) => {
        const url = URL.parse(req.url ?? '/', redirect?.href);
        if (req.method !== 'GET' || !url || url.origin !== redirect?.origin || url.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end();
          return;
        }
        const states = url.searchParams.getAll('state');
        if (accepted || signal.aborted || states.length !== 1 || states[0] !== state) {
          res.writeHead(400).end('Invalid authorization state.');
          return;
        }
        accepted = true;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer',
        });
        res.end('<!doctype html><title>ChatGPT sign-in</title><p>Authorization received. Return to the application to see the result.</p>');
        resolve(url);
      });
    });
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(cancelError());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    void cancelled.catch(() => {});

    try {
      // Persist the installation identity before asking OpenAI to register it.
      await this.commit(current => current);
      if (signal.aborted) throw cancelError();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not start the ChatGPT callback listener');
      if (signal.aborted) throw cancelError();
      redirect = new URL(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: existing?.clientId ?? DYNAMIC_CLIENT, ext_agent_host_id: this.#state.hostId,
        response_type: 'code', redirect_uri: redirect.href, scope: SCOPES, resource: RESOURCE,
        state, nonce, code_challenge_method: 'S256', code_challenge: codeChallenge,
      }).toString();
      if (!existing) url.searchParams.set('agent_name_hint', this.#options.applicationName);
      if (existing?.credentials?.idToken) url.searchParams.set('id_token_hint', existing.credentials.idToken);
      if (options.requestConsent) url.searchParams.set('prompt', 'consent');

      const opened = Promise.resolve().then(() => this.#options.openBrowser(url.href)).catch(() => {
        throw new Error('Could not open the browser for ChatGPT sign-in');
      });
      const [, result] = await Promise.race([Promise.all([opened, callback]), cancelled]);
      if (result.searchParams.has('error')) throw new Error('ChatGPT authorization was declined. No billing method was changed.');
      const ids = result.searchParams.getAll('client_id');
      const codes = result.searchParams.getAll('code');
      const clientId = ids[0] ?? existing?.clientId;
      if (ids.length > 1 || codes.length !== 1 || !codes[0] || !clientId || clientId === DYNAMIC_CLIENT
        || (existing ? clientId !== existing.clientId : this.#state.profiles.some(p => p.clientId === clientId))) {
        throw new Error('Invalid ChatGPT registration callback');
      }
      const profile = existing ?? { id: randomUUID(), clientId };
      if (!existing) await this.commit(current => ({ ...current, profiles: [...current.profiles, profile] }));
      if (signal.aborted) throw cancelError();

      const tokens = await Promise.race([this.tokenRequest({
        grant_type: 'authorization_code', client_id: clientId, code: codes[0],
        code_verifier: codeVerifier, redirect_uri: redirect.href, resource: RESOURCE,
      }, signal), cancelled]);
      const identity = await Promise.race([this.verifyIdentity(tokens.id_token, clientId, nonce), cancelled]);
      if (profile.subject && profile.subject !== identity.sub) {
        throw new Error('ChatGPT sign-in returned a different account. Add a new account instead.');
      }
      const authorized = { ...profile, subject: identity.sub, email: identity.email, credentials: this.credentials(tokens) };
      if (signal.aborted) throw cancelError();
      this.pending = undefined;
      await this.replaceProfile(authorized, options.select);
      return accountInfo(authorized);
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.pending = undefined;
      // Stop admission first, then tear down idle and incomplete loopback requests.
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  }

  /** Cancel a pending sign-in before its credential commit starts. */
  cancel(): void { this.pending?.abort(); }

  /** Set a selection for hosts that want a single active plan account. */
  async selectAccount(accountId: string): Promise<void> {
    await this.change(async () => {
      if (!hasPlan(this.profile(accountId))) throw new Error('Reconnect this account and enable ChatGPT plan usage first');
      await this.commit(state => ({ ...state, activeId: accountId, usePlan: true }));
    });
  }

  /** Disable the optional selection without signing out any accounts. */
  async clearSelection(): Promise<void> {
    await this.change(() => this.commit(state => ({ ...state, usePlan: false })));
  }

  /** Revoke and clear this registration's credentials while retaining its client mapping. */
  async signOut(accountId: string): Promise<{ warning?: string }> {
    return this.change(async () => {
      const profile = this.profile(accountId);
      const token = profile.credentials?.refreshToken ?? profile.credentials?.accessToken;
      const revoked = !token || await this.revoke(profile.clientId, token, !!profile.credentials?.refreshToken);
      await this.replaceProfile({ ...profile, credentials: undefined });
      return revoked ? {} : {
        warning: `Signed out locally. Remote revocation was not confirmed. Disconnect ${this.#options.applicationName} in ChatGPT Settings → Usage.`,
      };
    });
  }

  /** Register a named OpenAI connector bound to an explicit account. */
  createConnector(name: string, accountId: string, options: { requireSelected?: boolean } = {}): Connector {
    if (!this.initialized) throw new Error('Initialize ChatGPT sign-in before using it');
    this.profile(accountId);
    const requireSelected = options.requireSelected ?? false;
    return Connector.create({
      name,
      vendor: Vendor.OpenAI,
      baseURL: RESOURCE,
      auth: { type: 'api_key_provider', getApiKey: () => this.getAccessToken(accountId, { requireSelected }) },
      options: { openaiAuthMode: 'chatgpt-plan', openaiAccountId: accountId },
    });
  }

  /** Retrieve a current token in trusted host code for this account and the OpenAI plan route. */
  async getAccessToken(accountId: string, options: { requireSelected?: boolean } = {}): Promise<string> {
    const requireSelected = options.requireSelected ?? false;
    this.assertTokenAccess(accountId, requireSelected);
    const profile = this.profile(accountId);
    const credentials = profile.credentials;
    if (!credentials || !hasPlan(profile)) throw new Error('Reconnect ChatGPT and enable plan usage');
    const pending = this.refreshes.get(accountId);
    if (pending) {
      const token = await pending;
      this.assertTokenAccess(accountId, requireSelected);
      return token;
    }
    const remaining = credentials.expiresAt - this.now();
    if (remaining > 60_000 || (remaining > 0 && !credentials.refreshToken)) return credentials.accessToken;
    if (!credentials.refreshToken) throw new Error('ChatGPT access expired. Reconnect to renew plan access.');
    const refresh = this.refresh(profile, credentials, credentials.refreshToken);
    this.refreshes.set(accountId, refresh);
    try {
      const token = await refresh;
      this.assertTokenAccess(accountId, requireSelected);
      return token;
    } finally {
      this.refreshes.delete(accountId);
    }
  }

  private assertTokenAccess(accountId: string, requireSelected: boolean): void {
    this.assertAvailable();
    if (this.mutation || (requireSelected && this.selectedAccountId !== accountId)) {
      throw new Error('ChatGPT account changed or is changing. Reopen this chat before continuing.');
    }
  }

  private async refresh(profile: Profile, previous: Credentials, refreshToken: string): Promise<string> {
    let tokens: Record<string, unknown>;
    try {
      tokens = await this.tokenRequest({
        grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: refreshToken, resource: RESOURCE,
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (TERMINAL_REFRESH.has(code) || code === INVALID_TOKEN_RESPONSE) {
        await this.replaceProfile({ ...profile, credentials: undefined });
      }
      throw error;
    }

    let credentials: Credentials;
    try {
      if (tokens.id_token !== undefined) {
        const identity = await this.verifyIdentity(tokens.id_token, profile.clientId);
        if (identity.sub !== profile.subject) throw new Error('ChatGPT refresh returned a different account');
      }
      credentials = this.credentials(tokens, previous);
    } catch (error) {
      // The exchange succeeded. The preceding refresh token may already be invalidated.
      await this.replaceProfile({ ...profile, credentials: undefined });
      throw error;
    }
    await this.replaceProfile({ ...profile, credentials });
    if (!credentials.scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT plan usage permission is no longer enabled');
    return credentials.accessToken;
  }

  private credentials(data: Record<string, unknown>, previous?: Credentials): Credentials {
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
    const idToken = data.id_token ?? previous?.idToken;
    const refreshToken = data.refresh_token;
    const expiresAt = this.now() + Number(data.expires_in) * 1000;
    if (typeof data.access_token !== 'string' || !data.access_token || typeof idToken !== 'string' || !idToken
      || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0 || !Number.isFinite(expiresAt)
      || (data.scope !== undefined && typeof data.scope !== 'string')
      || (data.token_type !== undefined && (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'))
      || (refreshToken !== undefined && (typeof refreshToken !== 'string' || !refreshToken))
      || ((previous || scopes.includes('offline_access')) && !refreshToken)) {
      throw new Error('ChatGPT returned invalid credentials');
    }
    return { accessToken: data.access_token, refreshToken, idToken, expiresAt, scopes };
  }

  private async tokenRequest(params: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(30_000);
    let response: Response;
    try {
      response = await this.request(`${ISSUER}/api/accounts/oauth/token`, {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
      });
    } catch {
      throw new Error('Could not reach ChatGPT to exchange credentials. Try again.');
    }
    const data: unknown = await response.json().catch(() => undefined);
    const fields = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
    if (!response.ok) {
      const code = typeof fields?.error === 'string' && /^[a-z][a-z_]{0,63}$/.test(fields.error)
        ? fields.error : 'chatgpt_token_error';
      throw Object.assign(new Error(`ChatGPT authorization failed (${code}). Reconnect if your session has expired.`), { code });
    }
    if (!fields) throw Object.assign(new Error('ChatGPT returned an invalid token response'), { code: INVALID_TOKEN_RESPONSE });
    return fields;
  }

  private async discovery(): Promise<Record<string, unknown>> {
    const response = await this.request(`${ISSUER}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    const config = await response.json() as Record<string, unknown>;
    if (!response.ok || config.issuer !== ISSUER) throw new Error('Invalid ChatGPT identity discovery');
    return config;
  }

  private async verifyIdentity(token: unknown, clientId: string, nonce?: string): Promise<{ sub: string; email?: string }> {
    if (typeof token !== 'string' || !token) throw new Error('ChatGPT did not return an ID token');
    try {
      if (!this.jwks) {
        const config = await this.discovery();
        const url = typeof config.jwks_uri === 'string' ? URL.parse(config.jwks_uri) : null;
        if (url?.origin !== ISSUER) throw new Error('Invalid ChatGPT signing key URL');
        this.jwks = createRemoteJWKSet(url, {
          [customFetch]: (input, init) => this.request(input, { ...init, redirect: 'error' }),
        });
      }
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
      });
      if ((nonce !== undefined && payload.nonce !== nonce) || typeof payload.sub !== 'string' || !payload.sub) {
        throw new Error('Invalid ChatGPT identity or nonce');
      }
      return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
    } catch {
      throw new Error('ChatGPT identity verification failed');
    }
  }

  private async revoke(clientId: string, token: string, refresh: boolean): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const config = await this.discovery();
        const endpoint = typeof config.revocation_endpoint === 'string' ? URL.parse(config.revocation_endpoint) : null;
        if (endpoint?.origin !== ISSUER) return false;
        const response = await this.request(endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token, token_type_hint: refresh ? 'refresh_token' : 'access_token', client_id: clientId }),
        });
        if (response.status === 200) return true;
        if (response.status < 500) return false;
      } catch { /* Retry a transient network failure once. */ }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
    }
    return false;
  }
}
