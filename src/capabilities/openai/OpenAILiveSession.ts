import { EventEmitter } from 'events';
import { OpenAI } from 'openai/client.js';
import { LiveWS } from 'openai/resources/live/ws.js';
import type { LiveWSReconnectOptions } from 'openai/resources/live/ws-base.js';
import type * as LiveAPI from 'openai/resources/live/live.js';
import type { LiveStreamMessage } from 'openai/resources/live/internal-base.js';
import { Connector } from '../../core/Connector.js';

export interface OpenAILiveSessionOptions {
  connector: string | Connector;
  reconnect?: LiveWSReconnectOptions | null;
  maxQueueSize?: number;
  connectTimeoutMs?: number;
}

/** Connector-first primary WebSocket session for GPT-Live. */
export class OpenAILiveSession extends EventEmitter {
  readonly connector: Connector;
  private readonly options: OpenAILiveSessionOptions;
  private transport: LiveWS | null = null;
  private connectionState: 'idle' | 'connecting' | 'connected' | 'closing' = 'idle';
  private activeAttempt: symbol | null = null;

  constructor(options: OpenAILiveSessionOptions) {
    super();
    this.options = options;
    this.connector = typeof options.connector === 'string'
      ? Connector.get(options.connector)
      : options.connector;
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected' && this.transport?.socket.readyState === 1;
  }

  async connect(session: LiveAPI.SessionConfig): Promise<LiveAPI.SessionResource> {
    if (this.connectionState !== 'idle') {
      throw new Error('OpenAI Live session is already connected or connecting');
    }
    this.connectionState = 'connecting';
    const attempt = Symbol('openai-live-connect');
    this.activeAttempt = attempt;
    let transport: LiveWS | null = null;
    try {
      const token = await this.connector.getToken();
      if (this.activeAttempt !== attempt) {
        throw new Error('OpenAI Live session connection was cancelled');
      }
      const connectorOptions = this.connector.getOptions();
      const client = new OpenAI({
        apiKey: token,
        baseURL: this.connector.baseURL || undefined,
        organization: typeof connectorOptions.organization === 'string'
          ? connectorOptions.organization
          : undefined,
        project: typeof connectorOptions.project === 'string' ? connectorOptions.project : undefined,
      });
      transport = new LiveWS(client, {
        ...(this.options.reconnect !== undefined ? { reconnect: this.options.reconnect } : {}),
        ...(this.options.maxQueueSize !== undefined ? { maxQueueSize: this.options.maxQueueSize } : {}),
      });
      this.transport = transport;
      transport.on('event', (event) => this.emit('event', event));
      transport.on('error', (error) => this.forwardError(error));
      transport.on('close', (code, reason, unsent) => {
        if (this.transport === transport && this.activeAttempt === attempt) {
          this.activeAttempt = null;
          this.transport = null;
          this.connectionState = 'idle';
        }
        this.emit('close', code, reason, unsent);
      });
      transport.on('reconnecting', (event) => this.emit('reconnecting', event));
      transport.on('reconnected', () => this.emit('reconnected'));

      const started = await new Promise<LiveAPI.SessionResource>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timed out starting the OpenAI Live session'));
        }, this.options.connectTimeoutMs ?? 15_000);
        const onStarted = (event: LiveAPI.SessionStartedEvent): void => {
          cleanup();
          resolve(event.session);
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const onClose = (): void => {
          cleanup();
          reject(new Error('OpenAI Live session closed before session.started'));
        };
        const cleanup = (): void => {
          clearTimeout(timeout);
          transport!.off('session.started', onStarted);
          transport!.off('error', onError);
          transport!.off('close', onClose);
        };
        transport!.on('session.started', onStarted);
        transport!.on('error', onError);
        transport!.on('close', onClose);
        transport!.send({ type: 'session.start', session });
      });
      if (this.transport !== transport || this.activeAttempt !== attempt) {
        throw new Error('OpenAI Live session closed before connection completed');
      }
      this.connectionState = 'connected';
      return started;
    } catch (error) {
      if (this.transport === transport) this.close(1000, 'Start failed');
      else if (this.activeAttempt === attempt) {
        this.activeAttempt = null;
        this.connectionState = 'idle';
      }
      throw error;
    }
  }

  appendAudio(audio: Buffer | string, eventId?: string): void {
    this.send({
      type: 'session.input_audio.append',
      audio: Buffer.isBuffer(audio) ? audio.toString('base64') : audio,
      ...(eventId ? { event_id: eventId } : {}),
    });
  }

  send(event: LiveAPI.ClientEvent): void {
    this.requireTransport().send(event);
  }

  events(): AsyncIterableIterator<LiveStreamMessage> {
    return this.requireTransport().stream();
  }

  close(code = 1000, reason = 'OK'): void {
    const transport = this.transport;
    this.connectionState = 'closing';
    this.activeAttempt = null;
    this.transport = null;
    transport?.close({ code, reason });
    this.connectionState = 'idle';
  }

  private requireTransport(): LiveWS {
    if (!this.isConnected || !this.transport) {
      throw new Error('OpenAI Live session is not connected');
    }
    return this.transport;
  }

  private forwardError(error: Error): void {
    // EventEmitter treats an unhandled `error` event as an exception. The
    // transport may fail before consumers have attached an observer, so only
    // forward the optional notification when it has somewhere to go.
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }
}

export type {
  ClientEvent as OpenAILiveClientEvent,
  ServerEvent as OpenAILiveServerEvent,
  SessionConfig as OpenAILiveSessionConfig,
  SessionResource as OpenAILiveSessionResource,
} from 'openai/resources/live/live.js';
