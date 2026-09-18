import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { StorageRegistry } from '../../../src/core/StorageRegistry.js';
import { OAuthManager } from '../../../src/connectors/oauth/OAuthManager.js';
import { AuthCodePKCEFlow } from '../../../src/connectors/oauth/flows/AuthCodePKCE.js';
import type { ITokenStorage, OAuthCallbackResult } from '../../../src/index.js';
import { MockTokenStorage } from '../../fixtures/mockStorage.js';

const config = {
  flow: 'authorization_code' as const,
  clientId: 'callback-client',
  clientSecret: 'test-secret',
  authorizationUrl: 'https://oauth.example.test/authorize',
  tokenUrl: 'https://oauth.example.test/token',
  redirectUri: 'https://app.example.test/callback',
  scope: 'openid email profile',
};

interface CallbackClient {
  start(userId: string, accountId: string): Promise<string>;
  complete(state: string): Promise<OAuthCallbackResult>;
  getToken(userId: string, accountId: string): Promise<string>;
}

const callbackUrl = (state: string) =>
  `${config.redirectUri}?code=test-code&state=${encodeURIComponent(state)}`;

const clients: Array<{
  name: string;
  create(storage: MockTokenStorage): CallbackClient;
}> = [
  {
    name: 'AuthCodePKCEFlow',
    create(storage) {
      const flow = new AuthCodePKCEFlow({ ...config, storage });
      return {
        start: (user, account) => flow.getAuthorizationUrl(user, account),
        complete: state => flow.exchangeCode('test-code', state),
        getToken: (user, account) => flow.getToken(user, account),
      };
    },
  },
  {
    name: 'OAuthManager',
    create(storage) {
      const manager = new OAuthManager({ ...config, storage });
      return {
        start: (user, account) => manager.startAuthFlow(user, account),
        complete: state => manager.handleCallback(callbackUrl(state)),
        getToken: (user, account) => manager.getToken(user, account),
      };
    },
  },
  {
    name: 'Connector',
    create(storage) {
      Connector.setDefaultStorage(storage);
      const connector = Connector.create({
        name: 'oidc-callback-test',
        auth: { type: 'oauth', ...config },
      });
      return {
        start: (user, account) => connector.startAuth(user, account),
        complete: state => connector.handleCallback(callbackUrl(state)),
        getToken: (user, account) => connector.getToken(user, account),
      };
    },
  },
];

describe.each(clients)('$name callback result', ({ create }) => {
  let storage: MockTokenStorage;
  let previousStorage: ITokenStorage | undefined;
  let client: CallbackClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousStorage = StorageRegistry.get('oauthTokens');
    storage = new MockTokenStorage();
    client = create(storage);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    Connector.remove('oidc-callback-test');
    if (previousStorage) StorageRegistry.set('oauthTokens', previousStorage);
    else StorageRegistry.remove('oauthTokens');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stateFor = async (client: CallbackClient, user = 'alice', account = 'work') =>
    new URL(await client.start(user, account)).searchParams.get('state')!;

  function respond(extra: Record<string, unknown> = {}) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      ...extra,
    }), { status: 200 }));
  }

  it('returns the raw ID token once without persisting it or replacing the access token', async () => {
    const state = await stateFor(client);
    respond({ id_token: 'unverified.test.id-token' });
    const store = vi.spyOn(storage, 'storeToken');

    await expect(client.complete(state)).resolves.toEqual({ idToken: 'unverified.test.id-token' });
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0]![1]).toEqual({
      access_token: 'test-access', refresh_token: 'test-refresh',
      expires_in: 3600, token_type: 'Bearer', scope: undefined,
      obtained_at: expect.any(Number),
    });
    expect(storage.getAllKeys()[0]).toMatch(/:alice:work$/);
    await expect(client.getToken('alice', 'work')).resolves.toBe('test-access');
    await expect(client.complete(state)).rejects.toThrow('No PKCE state found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty result for a later non-OIDC exchange without reusing another account ID token', async () => {
    respond({ id_token: 'alice-id-token' });
    await expect(client.complete(await stateFor(client))).resolves.toEqual({ idToken: 'alice-id-token' });
    respond({ access_token: 'bob-access' });
    await expect(client.complete(await stateFor(client, 'bob', 'personal'))).resolves.toEqual({});
    await expect(client.getToken('alice', 'work')).resolves.toBe('test-access');
    await expect(client.getToken('bob', 'personal')).resolves.toBe('bob-access');
    expect(storage.size()).toBe(2);
  });

  it('does not expose a malformed non-string optional ID token', async () => {
    const state = await stateFor(client);
    respond({ id_token: { untrusted: 'object' } });
    await expect(client.complete(state)).resolves.toEqual({});
    await expect(client.getToken('alice', 'work')).resolves.toBe('test-access');
  });

  it('rejects invalid state before fetching or storing any callback result', async () => {
    const state = await stateFor(client);
    await expect(client.complete(`wrong-${state}`)).rejects.toThrow('State mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.size()).toBe(0);
  });

  it('does not return an ID token when token persistence fails', async () => {
    const state = await stateFor(client);
    respond({ id_token: 'must-not-be-returned' });
    vi.spyOn(storage, 'storeToken').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(client.complete(state)).rejects.toThrow('storage unavailable');
    expect(storage.size()).toBe(0);
  });
});
