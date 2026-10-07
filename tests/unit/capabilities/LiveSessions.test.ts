import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';

const {
  liveControl,
  liveTransports,
  mockOpenAI,
  mockLiveWS,
  googleCallbacks,
  googleSessions,
  mockGoogleLiveConnect,
  mockGoogleGenAI,
} = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;
  class FakeLiveWS {
    socket = { readyState: 1 };
    listeners = new Map<string, Listener[]>();

    on(event: string, listener: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    off(event: string, listener: Listener): this {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((entry) => entry !== listener));
      return this;
    }

    emit(event: string, ...args: any[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    send(event: { type?: string }): void {
      if (event.type === 'session.start' && liveControl.autoStart) {
        queueMicrotask(() => this.emit('session.started', { session: { id: 'live_session' } }));
      }
    }

    close(): void {
      this.socket.readyState = 3;
      this.emit('close', 1000, 'closed', []);
    }

    stream(): AsyncIterableIterator<any> {
      return (async function* () {})();
    }
  }

  const liveControl = { autoStart: true };
  const liveTransports: FakeLiveWS[] = [];
  const mockOpenAI = vi.fn(() => ({}));
  const mockLiveWS = vi.fn(() => {
    const transport = new FakeLiveWS();
    liveTransports.push(transport);
    return transport;
  });

  const googleCallbacks: any[] = [];
  const googleSessions: any[] = [];
  const mockGoogleLiveConnect = vi.fn(async ({ callbacks }: any) => {
    googleCallbacks.push(callbacks);
    const session = {
      close: vi.fn(),
      sendClientContent: vi.fn(),
      sendRealtimeInput: vi.fn(),
      sendToolResponse: vi.fn(),
    };
    googleSessions.push(session);
    return session;
  });
  const mockGoogleGenAI = vi.fn(() => ({ live: { connect: mockGoogleLiveConnect } }));

  return {
    liveControl,
    liveTransports,
    mockOpenAI,
    mockLiveWS,
    googleCallbacks,
    googleSessions,
    mockGoogleLiveConnect,
    mockGoogleGenAI,
  };
});

vi.mock('openai/client.js', () => ({ OpenAI: mockOpenAI }));
vi.mock('openai/resources/live/ws.js', () => ({ LiveWS: mockLiveWS }));
vi.mock('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }));

import { GoogleLiveSession } from '@/capabilities/google/GoogleLiveSession.js';
import { OpenAILiveSession } from '@/capabilities/openai/OpenAILiveSession.js';

describe('primary live session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveControl.autoStart = true;
    liveTransports.length = 0;
    googleCallbacks.length = 0;
    googleSessions.length = 0;
  });

  afterEach(() => Connector.clear());

  it('resets OpenAI state after a remote close and reconnects', async () => {
    const connector = Connector.create({
      name: 'openai-live-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new OpenAILiveSession({ connector });

    await live.connect({ model: 'gpt-live' } as any);
    expect(live.isConnected).toBe(true);
    liveTransports[0].emit('close', 1006, 'remote', []);
    expect(live.isConnected).toBe(false);

    await live.connect({ model: 'gpt-live' } as any);
    expect(live.isConnected).toBe(true);
    expect(mockLiveWS).toHaveBeenCalledTimes(2);
  });

  it('rejects an OpenAI connection that closes before session.started', async () => {
    const connector = Connector.create({
      name: 'openai-live-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new OpenAILiveSession({ connector, connectTimeoutMs: 1_000 });
    liveControl.autoStart = false;

    const connecting = live.connect({ model: 'gpt-live' } as any);
    await vi.waitFor(() => expect(liveTransports).toHaveLength(1));
    liveTransports[0].emit('close', 1006, 'remote', []);

    await expect(connecting).rejects.toThrow('closed before session.started');
    expect(live.isConnected).toBe(false);
  });

  it('rejects an OpenAI connection error without requiring an error observer', async () => {
    const connector = Connector.create({
      name: 'openai-live-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new OpenAILiveSession({ connector, connectTimeoutMs: 1_000 });
    liveControl.autoStart = false;

    const connecting = live.connect({ model: 'gpt-live' } as any);
    await vi.waitFor(() => expect(liveTransports).toHaveLength(1));
    liveTransports[0].emit('error', new Error('start failed'));

    await expect(connecting).rejects.toThrow('start failed');
    expect(live.isConnected).toBe(false);
  });

  it('rejects concurrent OpenAI connect attempts', async () => {
    const connector = Connector.create({
      name: 'openai-live-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new OpenAILiveSession({ connector, connectTimeoutMs: 1_000 });
    liveControl.autoStart = false;

    const first = live.connect({ model: 'gpt-live' } as any);
    await expect(live.connect({ model: 'gpt-live' } as any)).rejects.toThrow(/already connected or connecting/);
    await vi.waitFor(() => expect(liveTransports).toHaveLength(1));
    liveTransports[0].emit('close', 1006, 'remote', []);
    await expect(first).rejects.toThrow();
  });

  it('cancels an OpenAI connect closed during credential resolution', async () => {
    let releaseToken!: (token: string) => void;
    const connector = {
      getToken: () => new Promise<string>((resolve) => { releaseToken = resolve; }),
      getOptions: () => ({}),
      baseURL: '',
    } as any;
    const live = new OpenAILiveSession({ connector });

    const connecting = live.connect({ model: 'gpt-live' } as any);
    live.close();
    releaseToken('secret');

    await expect(connecting).rejects.toThrow(/cancelled/);
    expect(mockLiveWS).not.toHaveBeenCalled();
    expect(live.isConnected).toBe(false);
  });

  it('resets Google state and interaction status after remote close', async () => {
    const connector = Connector.create({
      name: 'google-live-test',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new GoogleLiveSession({ connector, model: 'gemini-live' });

    await live.connect();
    googleCallbacks[0].onmessage({ interactionStatus: 'IN_PROGRESS' });
    expect(live.interactionStatus).toBe('IN_PROGRESS');
    googleCallbacks[0].onclose({ reason: 'remote' });
    expect(live.isConnected).toBe(false);
    expect(live.interactionStatus).toBeUndefined();

    await live.connect();
    expect(live.isConnected).toBe(true);
    expect(mockGoogleLiveConnect).toHaveBeenCalledTimes(2);
  });

  it('does not throw for an unobserved Google Live error and forwards observed errors', async () => {
    const connector = Connector.create({
      name: 'google-live-test',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new GoogleLiveSession({ connector, model: 'gemini-live' });
    await live.connect();

    expect(() => googleCallbacks[0].onerror({ error: new Error('unobserved') })).not.toThrow();
    const listener = vi.fn();
    live.on('error', listener);
    const observed = new Error('observed');
    googleCallbacks[0].onerror({ error: observed });
    expect(listener).toHaveBeenCalledWith(observed);
  });

  it('rejects concurrent Google connect attempts', async () => {
    const connector = Connector.create({
      name: 'google-live-test',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: 'secret' },
    });
    const live = new GoogleLiveSession({ connector, model: 'gemini-live' });

    const first = live.connect();
    await expect(live.connect()).rejects.toThrow(/already connected or connecting/);
    await first;
    expect(live.isConnected).toBe(true);
  });

  it('cancels a Google connect closed during credential resolution', async () => {
    let releaseToken!: (token: string) => void;
    const connector = {
      getToken: () => new Promise<string>((resolve) => { releaseToken = resolve; }),
      baseURL: '',
    } as any;
    const live = new GoogleLiveSession({ connector, model: 'gemini-live' });

    const connecting = live.connect();
    live.close();
    releaseToken('secret');

    await expect(connecting).rejects.toThrow(/cancelled/);
    expect(mockGoogleGenAI).not.toHaveBeenCalled();
    expect(live.isConnected).toBe(false);
  });
});
