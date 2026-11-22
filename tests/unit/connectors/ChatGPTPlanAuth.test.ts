import { describe, expect, it, vi } from 'vitest';
import { Connector } from '../../../src/core/Connector.js';
import { ChatGPTPlanAuth } from '../../../src/connectors/oauth/openai.js';

const now = 1_790_000_000_000;
const planScope = 'chatgpt.tokens.use.direct';

function savedProfile(id: string, expiresAt: number) {
  return {
    id, clientId: `oaiapp_${id}`, subject: `subject-${id}`, email: `${id}@example.test`,
    credentials: { accessToken: `access-${id}`, refreshToken: `refresh-${id}`, idToken: `identity-${id}`,
      expiresAt, scopes: [planScope, 'offline_access'] },
  };
}

function setup({ expired = false, holdSave, fetch }: {
  expired?: boolean; holdSave?: Promise<void>; fetch?: typeof globalThis.fetch;
} = {}) {
  const expiresAt = expired ? now : now + 3600_000;
  let snapshot = JSON.stringify({ version: 1, hostId: 'urn:uuid:fixture', activeId: 'first', usePlan: true,
    profiles: [savedProfile('first', expiresAt), savedProfile('second', expiresAt)] });
  const storage = {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async (next: string) => { await holdSave; snapshot = next; }),
  };
  const options = {
    applicationName: 'Auth fixture', storage, openBrowser: () => { throw new Error('No browser expected'); },
    fetch: fetch ?? vi.fn(async () => { throw new Error('No external request expected'); }), now: () => now,
  };
  return { auth: new ChatGPTPlanAuth(options), options };
}

function replacement(id: string) {
  return Response.json({ access_token: `rotated-${id}`, refresh_token: `next-refresh-${id}`, expires_in: 3600 });
}

describe('ChatGPTPlanAuth', () => {
  it('restores existing Hosea records and binds each connector to its own account', async () => {
    const { auth, options } = setup();
    await Promise.all([auth.initialize(), auth.initialize()]);
    expect(options.storage.load).toHaveBeenCalledTimes(1);
    const first = auth.createConnector('test-plan-first', 'first', { requireSelected: true });
    const second = auth.createConnector('test-plan-second', 'second');
    try {
      expect(Connector.get(first.name)).toBe(first);
      expect(first.getOptions()).toMatchObject({ openaiAuthMode: 'chatgpt-plan', openaiAccountId: 'first' });
      expect(second.getOptions().openaiAccountId).toBe('second');
      expect(JSON.stringify(auth.status())).not.toContain('access-first');
      expect(JSON.stringify(auth)).not.toContain('access-first');
      await expect(Promise.all([first.getToken(), second.getToken()])).resolves.toEqual(['access-first', 'access-second']);
      await auth.selectAccount('second');
      await expect(first.getToken()).rejects.toThrow(/account changed/);
      await expect(second.getToken()).resolves.toBe('access-second');
      await auth.clearSelection();
      await expect(second.getToken()).resolves.toBe('access-second');
    } finally {
      Connector.remove(first.name);
      Connector.remove(second.name);
    }
  });

  it('waits for storage acknowledgment and preserves both registrations during simultaneous rotation', async () => {
    let allowSave!: () => void;
    const holdSave = new Promise<void>(resolve => { allowSave = resolve; });
    const request: typeof fetch = vi.fn(async (_url, init) => {
      const form = init?.body as URLSearchParams;
      return replacement(form.get('client_id')!.replace('oaiapp_', ''));
    });
    const { auth, options } = setup({ expired: true, holdSave, fetch: request });
    await auth.initialize();
    const first = auth.getAccessToken('first');
    const second = auth.getAccessToken('second');
    let dispatched = false;
    const third = auth.getAccessToken('first').then(token => { dispatched = true; return token; });
    await vi.waitFor(() => expect(options.storage.save).toHaveBeenCalledTimes(1));
    expect(dispatched).toBe(false);
    allowSave();
    await expect(Promise.all([first, second, third])).resolves.toEqual(['rotated-first', 'rotated-second', 'rotated-first']);
    expect(request).toHaveBeenCalledTimes(2);

    const restored = new ChatGPTPlanAuth(options);
    await restored.initialize();
    await expect(restored.getAccessToken('first')).resolves.toBe('rotated-first');
    await expect(restored.getAccessToken('second')).resolves.toBe('rotated-second');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('revokes the replacement token and blocks dispatch if sign-out overlaps a refresh', async () => {
    let finishRefresh!: () => void;
    const hold = new Promise<void>(resolve => { finishRefresh = resolve; });
    const revoke = vi.fn();
    const request: typeof fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith('/oauth/token')) {
        await hold;
        return replacement('first');
      }
      if (String(url).endsWith('openid-configuration')) {
        return Response.json({ issuer: 'https://auth.openai.com', revocation_endpoint: 'https://auth.openai.com/revoke' });
      }
      expect(String(url)).toBe('https://auth.openai.com/revoke');
      revoke((init?.body as URLSearchParams).get('token'));
      return new Response('', { status: 200 });
    });
    const { auth } = setup({ expired: true, fetch: request });
    await auth.initialize();
    const rejected = expect(auth.getAccessToken('first')).rejects.toThrow(/account changed/);
    const signOut = auth.signOut('first');
    finishRefresh();
    await rejected;
    await expect(signOut).resolves.toEqual({});
    expect(revoke).toHaveBeenCalledWith('next-refresh-first');
    await expect(auth.getAccessToken('first')).rejects.toThrow(/Reconnect/);
    expect(auth.selectedAccountId).toBe('first');
  });

  it('clears a session after a successful refresh returns an unusable token response', async () => {
    const request = vi.fn(async () => new Response('broken token response', { status: 200 }));
    const { auth } = setup({ expired: true, fetch: request });
    await auth.initialize();
    await expect(auth.getAccessToken('first')).rejects.toThrow(/invalid token response/);
    await expect(auth.getAccessToken('first')).rejects.toThrow(/Reconnect/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
