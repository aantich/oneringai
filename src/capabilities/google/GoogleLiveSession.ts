import { EventEmitter } from 'events';
import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { Connector } from '../../core/Connector.js';

export interface GoogleLiveSessionOptions {
  connector: string | Connector;
  model: string;
  config?: LiveConnectConfig;
}

/** Connector-first Gemini Live session, including 3.8 background-reasoning status. */
export class GoogleLiveSession extends EventEmitter {
  readonly connector: Connector;
  readonly model: string;
  readonly config?: LiveConnectConfig;
  private session: Session | null = null;
  private _interactionStatus?: 'IN_PROGRESS' | 'IDLE';
  private connectionState: 'idle' | 'connecting' | 'connected' | 'closing' = 'idle';
  private activeAttempt: symbol | null = null;

  constructor(options: GoogleLiveSessionOptions) {
    super();
    this.connector = typeof options.connector === 'string'
      ? Connector.get(options.connector)
      : options.connector;
    this.model = options.model;
    this.config = options.config;
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected' && this.session !== null;
  }

  get interactionStatus(): 'IN_PROGRESS' | 'IDLE' | undefined {
    return this._interactionStatus;
  }

  async connect(): Promise<void> {
    if (this.connectionState !== 'idle') {
      throw new Error('Google Live session is already connected or connecting');
    }
    this.connectionState = 'connecting';
    const attempt = Symbol('google-live-connect');
    this.activeAttempt = attempt;
    try {
      const token = await this.connector.getToken();
      if (this.activeAttempt !== attempt) {
        throw new Error('Google Live session connection was cancelled');
      }
      const client = new GoogleGenAI({
        apiKey: token,
        ...(this.connector.baseURL
          ? { httpOptions: { baseUrl: this.connector.baseURL } }
          : {}),
      });
      const session = await client.live.connect({
        model: this.model,
        ...(this.config ? { config: this.config } : {}),
        callbacks: {
          onopen: () => this.emit('open'),
          onmessage: (message) => this.handleMessage(message),
          onerror: (event) => this.forwardError(event.error ?? event),
          onclose: (event) => {
            if (this.activeAttempt === attempt) {
              this.activeAttempt = null;
              this.session = null;
              this.connectionState = 'idle';
              this._interactionStatus = undefined;
            }
            this.emit('close', event);
          },
        },
      });
      if (this.activeAttempt !== attempt) {
        session.close();
        throw new Error('Google Live session closed before connection completed');
      }
      this.session = session;
      this.connectionState = 'connected';
    } catch (error) {
      if (this.activeAttempt === attempt) this.activeAttempt = null;
      this.session = null;
      this.connectionState = 'idle';
      this._interactionStatus = undefined;
      throw error;
    }
  }

  sendClientContent(params: Parameters<Session['sendClientContent']>[0]): void {
    this.requireSession().sendClientContent(params);
  }

  sendRealtimeInput(params: Parameters<Session['sendRealtimeInput']>[0]): void {
    this.requireSession().sendRealtimeInput(params);
  }

  sendToolResponse(params: Parameters<Session['sendToolResponse']>[0]): void {
    this.requireSession().sendToolResponse(params);
  }

  close(): void {
    const session = this.session;
    this.connectionState = 'closing';
    this.activeAttempt = null;
    this.session = null;
    this._interactionStatus = undefined;
    session?.close();
    this.connectionState = 'idle';
  }

  private handleMessage(message: LiveServerMessage): void {
    const rawStatus = (message as LiveServerMessage & {
      interactionStatus?: string;
      interaction_status?: string;
    }).interactionStatus ?? (message as any).interaction_status;
    if (rawStatus === 'IN_PROGRESS' || rawStatus === 'IDLE') {
      if (this._interactionStatus !== rawStatus) {
        this._interactionStatus = rawStatus;
        this.emit('interactionStatus', rawStatus);
      }
    }
    this.emit('message', message);
  }

  private forwardError(error: unknown): void {
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('Google Live session is not connected');
    return this.session;
  }
}

export type { LiveConnectConfig as GoogleLiveConnectConfig, LiveServerMessage as GoogleLiveServerMessage };
