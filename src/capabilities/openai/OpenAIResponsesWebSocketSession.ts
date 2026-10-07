import { EventEmitter } from 'events';
import { OpenAI } from 'openai/client.js';
import { ResponsesWS } from 'openai/resources/responses/ws.js';
import type * as ResponsesAPI from 'openai/resources/responses/responses.js';
import type { ResponsesStreamMessage } from 'openai/resources/responses/internal-base.js';
import type { ResponsesWSReconnectOptions } from 'openai/resources/responses/ws.js';
import { Connector } from '../../core/Connector.js';
import { OpenAIResponsesConverter } from '../../infrastructure/providers/openai/OpenAIResponsesConverter.js';
import { validateOpenAIResponsesRequest } from '../../infrastructure/providers/openai/OpenAIRequestValidator.js';
import type { InputItem } from '../../domain/entities/Message.js';
import type { Tool } from '../../domain/entities/Tool.js';

interface WebSocketLike {
  readonly readyState: number;
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

type ResponsesCloseMessage = Extract<ResponsesStreamMessage, { type: 'close' }>;
type ResponsesReconnectingMessage = Extract<ResponsesStreamMessage, { type: 'reconnecting' }>;
type ResponsesUnsentMessage = ResponsesCloseMessage['unsent'][number];
type ResponsesReconnectingEvent = ResponsesReconnectingMessage['reconnect'];

export interface OpenAIResponsesWebSocketTransport {
  readonly socket: WebSocketLike;
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(event: ResponsesAPI.ResponsesClientEvent): void;
  stream(): AsyncIterableIterator<ResponsesStreamMessage>;
  close(props?: { code: number; reason: string }): void;
}

export interface OpenAIResponsesWebSocketSessionOptions {
  connector: string | Connector;
  headers?: Record<string, string>;
  connectTimeoutMs?: number;
  reconnect?: ResponsesWSReconnectOptions | null;
  maxQueueSize?: number;
  /** Test/custom-runtime hook. Normal Node callers should leave this unset. */
  transportFactory?: (
    client: OpenAI,
    options: {
      headers?: Record<string, string>;
      reconnect?: ResponsesWSReconnectOptions | null;
      maxQueueSize?: number;
    },
  ) => OpenAIResponsesWebSocketTransport;
}

export type OpenAIResponsesCreateEventOptions = Omit<
  ResponsesAPI.ResponsesClientEvent.ResponseCreate,
  'type' | 'model' | 'input' | 'tools' | 'stream' | 'background'
> & {
  model: string;
  input: string | InputItem[];
  tools?: Tool[];
};

/** One user message accepted by the Responses mid-turn steering protocol. */
export interface OpenAIResponseSteerMessage {
  type?: 'message';
  role: 'user';
  content: string | ResponsesAPI.ResponseSteerInputContent[];
}

/**
 * Mid-turn steering accepts a string or a non-empty list of user messages.
 * Tool results and general Responses input items are intentionally excluded.
 */
export type ResponseSteerInput =
  | string
  | [OpenAIResponseSteerMessage, ...OpenAIResponseSteerMessage[]];

export interface OpenAIResponsesWebSocketSessionEvents {
  event: (event: ResponsesAPI.ResponsesServerEvent) => void;
  error: (error: Error) => void;
  close: (code: number, reason: string, unsent: ResponsesUnsentMessage[]) => void;
  reconnecting: (event: ResponsesReconnectingEvent) => void;
  reconnected: () => void;
}

/** Connector-first Responses WebSocket session with GPT-6 Astra steering support. */
export class OpenAIResponsesWebSocketSession extends EventEmitter {
  readonly connector: Connector;
  private readonly options: OpenAIResponsesWebSocketSessionOptions;
  private readonly converter = new OpenAIResponsesConverter();
  private transport: OpenAIResponsesWebSocketTransport | null = null;
  private connectionState: 'idle' | 'connecting' | 'connected' | 'closing' = 'idle';
  private activeAttempt: symbol | null = null;

  constructor(options: OpenAIResponsesWebSocketSessionOptions) {
    super();
    this.options = options;
    this.connector = typeof options.connector === 'string'
      ? Connector.get(options.connector)
      : options.connector;
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected' && this.transport?.socket.readyState === 1;
  }

  async connect(): Promise<void> {
    if (this.connectionState !== 'idle') {
      throw new Error('Responses WebSocket session is already connected or connecting');
    }
    this.connectionState = 'connecting';
    const attempt = Symbol('openai-responses-ws-connect');
    this.activeAttempt = attempt;
    let transport: OpenAIResponsesWebSocketTransport | null = null;

    try {
      // ResponsesWS opens synchronously from its constructor, so rotating connector
      // credentials must be resolved before the SDK client is created.
      const apiKey = await this.connector.getToken();
      if (this.activeAttempt !== attempt) {
        throw new Error('OpenAI Responses WebSocket connection was cancelled');
      }
      const connectorOptions = this.connector.getOptions();
      const client = new OpenAI({
        apiKey,
        baseURL: this.connector.baseURL || undefined,
        organization: typeof connectorOptions.organization === 'string'
          ? connectorOptions.organization
          : undefined,
        project: typeof connectorOptions.project === 'string' ? connectorOptions.project : undefined,
      });
      const transportOptions = {
        ...(this.options.headers ? { headers: this.options.headers } : {}),
        ...(this.options.reconnect !== undefined ? { reconnect: this.options.reconnect } : {}),
        ...(this.options.maxQueueSize !== undefined ? { maxQueueSize: this.options.maxQueueSize } : {}),
      };
      transport = this.options.transportFactory
        ? this.options.transportFactory(client, transportOptions)
        : new ResponsesWS(client, transportOptions) as unknown as OpenAIResponsesWebSocketTransport;
      this.transport = transport;
      this.forwardEvents(transport, attempt);

      if (transport.socket.readyState !== 1) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => finish(
            new Error('Timed out connecting to the OpenAI Responses WebSocket'),
          ), this.options.connectTimeoutMs ?? 15_000);
          const onOpen = (): void => finish();
          const onError = (error: Error): void => finish(error);
          const onClose = (code: number, reason: string): void => finish(
            new Error(`OpenAI Responses WebSocket closed during connect: ${code} ${reason}`.trim()),
          );
          const finish = (error?: Error): void => {
            clearTimeout(timeout);
            transport!.socket.off('open', onOpen);
            transport!.socket.off('error', onError);
            transport!.socket.off('close', onClose);
            if (error) reject(error);
            else resolve();
          };
          transport!.socket.on('open', onOpen);
          transport!.socket.on('error', onError);
          transport!.socket.on('close', onClose);
        });
      }
      if (this.transport !== transport || this.activeAttempt !== attempt) {
        throw new Error('OpenAI Responses WebSocket closed before connection completed');
      }
      this.connectionState = 'connected';
    } catch (error) {
      if (this.transport === transport) this.close(1000, 'Connect failed');
      else if (this.activeAttempt === attempt) {
        this.activeAttempt = null;
        this.connectionState = 'idle';
      }
      throw error;
    }
  }

  createResponse(options: OpenAIResponsesCreateEventOptions): void {
    const { input, tools, instructions, ...rest } = options;
    const converted = this.converter.convertInput(input, instructions ?? undefined);
    const params: Record<string, unknown> = {
      ...rest,
      model: options.model,
      input: converted.input,
      ...(converted.instructions ? { instructions: converted.instructions } : {}),
      ...(tools?.length ? { tools: this.converter.convertTools(tools) } : {}),
    };
    this.assertStreamId(params.stream_id);
    validateOpenAIResponsesRequest(
      { model: options.model, temperature: options.temperature ?? undefined },
      params,
      this.connector.baseURL || undefined,
    );
    this.requireTransport().send({
      type: 'response.create',
      ...params,
    } as ResponsesAPI.ResponsesClientEvent.ResponseCreate);
  }

  /** Queue additional user input for an active Astra response. */
  steer(previousResponseId: string, input: ResponseSteerInput): void {
    if (!previousResponseId.trim()) throw new RangeError('previousResponseId must not be empty');
    this.assertSteerInput(input);
    const wireInput: ResponsesAPI.ResponseSteerInput = typeof input === 'string'
      ? input
      : input.map((message) => ({ ...message, type: 'message' }));
    this.requireTransport().send({
      type: 'response.steer',
      previous_response_id: previousResponseId,
      input: wireInput,
    });
  }

  /** Send an advanced SDK-typed Responses WebSocket event. */
  send(event: ResponsesAPI.ResponsesClientEvent): void {
    this.requireTransport().send(event);
  }

  events(): AsyncIterableIterator<ResponsesStreamMessage> {
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

  override on<K extends keyof OpenAIResponsesWebSocketSessionEvents>(
    event: K,
    listener: OpenAIResponsesWebSocketSessionEvents[K],
  ): this {
    return super.on(event, listener);
  }

  private requireTransport(): OpenAIResponsesWebSocketTransport {
    if (
      this.connectionState !== 'connected'
      || !this.transport
      || this.transport.socket.readyState !== 1
    ) {
      throw new Error('OpenAI Responses WebSocket is not connected');
    }
    return this.transport;
  }

  private forwardEvents(transport: OpenAIResponsesWebSocketTransport, attempt: symbol): void {
    transport.on('event', (event: ResponsesAPI.ResponsesServerEvent) => this.emit('event', event));
    transport.on('error', (error: Error) => this.forwardError(error));
    transport.on('close', (code: number, reason: string, unsent: ResponsesUnsentMessage[]) => {
      if (this.transport === transport && this.activeAttempt === attempt) {
        this.activeAttempt = null;
        this.transport = null;
        this.connectionState = 'idle';
      }
      this.emit('close', code, reason, unsent);
    });
    transport.on('reconnecting', (event: ResponsesReconnectingEvent) => this.emit('reconnecting', event));
    transport.on('reconnected', () => this.emit('reconnected'));
  }

  private forwardError(error: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }

  private assertStreamId(value: unknown): void {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/.test(value)) {
      throw new RangeError('stream_id must be 1-256 letters, numbers, underscores, periods, or hyphens');
    }
  }

  private assertSteerInput(input: ResponseSteerInput): void {
    if (typeof input === 'string') {
      if (!input.trim()) throw new RangeError('Steering input must not be empty');
      return;
    }
    if (!Array.isArray(input) || input.length === 0) {
      throw new RangeError('Steering input must contain at least one user message');
    }
    for (const message of input as unknown[]) {
      if (!message || typeof message !== 'object') {
        throw new TypeError('Steering input items must be user messages');
      }
      const value = message as Record<string, unknown>;
      if ((value.type !== undefined && value.type !== 'message') || value.role !== 'user') {
        throw new TypeError('Steering input accepts only messages with role user');
      }
      if (Object.keys(value).some((key) => !['type', 'role', 'content'].includes(key))) {
        throw new TypeError('Steering messages may contain only type, role, and content');
      }
      if (typeof value.content === 'string') {
        if (!value.content.trim()) throw new RangeError('Steering message content must not be empty');
        continue;
      }
      if (!Array.isArray(value.content) || value.content.length === 0) {
        throw new RangeError('Steering message content must not be empty');
      }
      for (const part of value.content) {
        const partType = part && typeof part === 'object'
          ? (part as { type?: unknown }).type
          : undefined;
        if (!['input_text', 'input_image', 'input_file'].includes(String(partType))) {
          throw new TypeError('Steering content accepts only input_text, input_image, and input_file');
        }
      }
    }
  }
}
