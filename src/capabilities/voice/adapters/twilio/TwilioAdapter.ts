/**
 * TwilioAdapter - Telephony adapter for Twilio Voice
 *
 * Handles:
 * - Inbound call webhooks (returns TwiML to connect Media Stream)
 * - Twilio Media Stream WebSocket protocol
 * - μ-law ↔ PCM transcoding
 * - Maps Twilio protocol to ITelephonyAdapter interface
 *
 * Usage modes:
 * 1. Standalone: adapter creates its own HTTP/WS server
 * 2. External: you get webhook/media handlers for your existing server
 *
 * @example Standalone
 * ```typescript
 * const adapter = TwilioAdapter.createStandalone({
 *   connector: 'twilio',
 *   port: 3000,
 *   publicUrl: 'https://abc123.ngrok.io',
 * });
 * await adapter.start();
 * ```
 *
 * @example External (Express + ws)
 * ```typescript
 * const adapter = TwilioAdapter.create({ connector: 'twilio' });
 * app.post('/voice', adapter.webhookHandler());
 * wss.on('connection', (ws, req) => {
 *   if (req.url === '/media-stream') adapter.handleMediaSocket(ws);
 * });
 * ```
 */

import { EventEmitter } from 'events';
import { Connector } from '../../../../core/Connector.js';
import { logger } from '../../../../infrastructure/observability/Logger.js';
import { mulawToPcm, pcmToMulaw, resamplePcm } from './codecs.js';
import type {
  ITelephonyAdapter,
  TelephonyAdapterEvents,
  TwilioAdapterConfig,
  AudioFrame,
  IncomingCallInfo,
  OutboundCallConfig,
} from '../../types.js';

// =============================================================================
// Twilio Media Stream Protocol Types
// =============================================================================

/** Twilio → Server messages */
interface TwilioMediaMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
    customParameters?: Record<string, string>;
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
  mark?: {
    name: string;
  };
}

/** Server → Twilio messages */
interface TwilioOutboundMessage {
  event: 'media' | 'mark' | 'clear';
  streamSid: string;
  media?: {
    payload: string;
  };
  mark?: {
    name: string;
  };
}

// =============================================================================
// Per-call WebSocket state
// =============================================================================

interface PendingPlaybackMark {
  name: string;
  playedMs: number;
}

interface MediaStreamState {
  callId: string;
  streamSid: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any;
  startTime: number;
  info: IncomingCallInfo;
  /** Counter for periodic debug logging of inbound audio frames */
  inboundFrameCount: number;
  /** Total assistant audio duration queued to Twilio */
  outboundQueuedMs: number;
  /** Marks awaiting Twilio playback acknowledgement */
  pendingPlaybackMarks: PendingPlaybackMark[];
}

// =============================================================================
// TwilioAdapter
// =============================================================================

export class TwilioAdapter extends EventEmitter implements ITelephonyAdapter {
  private config: TwilioAdapterConfig;
  private connector: Connector;
  private streams = new Map<string, MediaStreamState>();
  private streamSidToCallId = new Map<string, string>();
  private pendingOutbound = new Set<string>();
  private destroyed = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any = null;

  static create(config: TwilioAdapterConfig): TwilioAdapter {
    return new TwilioAdapter({ ...config, mode: 'external' });
  }

  static createStandalone(config: TwilioAdapterConfig & { publicUrl: string; port?: number }): TwilioAdapter {
    return new TwilioAdapter({ ...config, mode: 'standalone' });
  }

  private constructor(config: TwilioAdapterConfig) {
    super();
    this.config = {
      mode: 'external',
      port: 3000,
      webhookPath: '/voice',
      mediaStreamPath: '/media-stream',
      ...config,
    };
    this.connector = typeof config.connector === 'string'
      ? Connector.get(config.connector)
      : config.connector as unknown as Connector;
  }

  // ─── Twilio REST API Helper ─────────────────────────────────────

  /**
   * Make a Twilio REST API call with proper Basic Auth.
   *
   * Twilio requires HTTP Basic Auth = base64(AccountSid:AuthToken).
   * The Connector.fetch() doesn't support two-part Basic Auth natively,
   * so we construct it manually here.
   */
  private async twilioFetch(
    path: string,
    options: { method: string; headers?: Record<string, string>; body?: string }
  ): Promise<Response> {
    const accountSid = this.config.accountSid;
    if (!accountSid) {
      throw new Error('accountSid is required for Twilio REST API calls');
    }

    // Get the auth token from the connector
    const authToken = this.connector.getApiKey();
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const baseUrl = this.connector.baseURL || 'https://api.twilio.com/2010-04-01';
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;

    logger.debug({ url, method: options.method }, '[TwilioAdapter] REST API request');

    const response = await fetch(url, {
      method: options.method,
      headers: {
        ...options.headers,
        'Authorization': `Basic ${basicAuth}`,
      },
      body: options.body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({
        url,
        method: options.method,
        status: response.status,
        statusText: response.statusText,
        errorBody,
      }, '[TwilioAdapter] REST API error');
      throw new Error(`Twilio API error ${response.status}: ${errorBody}`);
    }

    return response;
  }

  // ─── Standalone Server ───────────────────────────────────────────

  async start(): Promise<void> {
    if (this.config.mode !== 'standalone') {
      throw new Error('start() is only available in standalone mode.');
    }

    const http = await import('http');
    // Dynamic import — ws is an optional peer dependency
    const { WebSocketServer } = await import('ws' as string);

    const port = this.config.port ?? 3000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server = http.createServer((req: any, res: any) => {
      if (req.method === 'POST' && req.url === this.config.webhookPath) {
        this.handleWebhookRequest(req, res);
      } else if (req.method === 'POST' && req.url === '/voice-outbound') {
        this.handleOutboundWebhookRequest(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    const wss = new WebSocketServer({
      server: this.server,
      path: this.config.mediaStreamPath,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wss.on('connection', (ws: any) => {
      this.handleMediaSocket(ws);
    });

    return new Promise((resolve, reject) => {
      this.server.on('error', (err: Error) => {
        logger.error({ err, port }, '[TwilioAdapter] Server error');
        this.server = null;
        reject(err);
      });
      this.server.listen(port, () => {
        logger.info({ port, webhookPath: this.config.webhookPath }, '[TwilioAdapter] Standalone server started');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }

  // ─── External Server Integration ─────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webhookHandler(): (req: any, res: any) => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req: any, res: any) => {
      this.handleWebhookRequest(req, res);
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMediaSocket(ws: any): void {
    let streamState: MediaStreamState | null = null;

    ws.on('message', (data: string | Buffer) => {
      try {
        const msg: TwilioMediaMessage = JSON.parse(
          typeof data === 'string' ? data : data.toString()
        );

        switch (msg.event) {
          case 'connected':
            logger.debug('Media stream WebSocket connected');
            break;

          case 'start':
            streamState = this.handleStreamStart(msg, ws);
            break;

          case 'media':
            if (streamState && msg.media) {
              this.handleStreamMedia(streamState, msg.media);
            }
            break;

          case 'stop':
            if (streamState) {
              this.handleStreamStop(streamState);
              streamState = null;
            }
            break;

          case 'mark':
            if (streamState && msg.mark) {
              this.handlePlaybackMark(streamState, msg.mark);
            }
            break;
        }
      } catch (error) {
        logger.error({ error }, '[TwilioAdapter] Error processing media message');
      }
    });

    ws.on('close', () => {
      if (streamState) {
        this.handleStreamStop(streamState);
      }
    });

    ws.on('error', (error: Error) => {
      logger.error({ error }, '[TwilioAdapter] WebSocket error');
      this.emit('error', error, streamState?.callId);
    });
  }

  // ─── ITelephonyAdapter Implementation ────────────────────────────

  /** Counter for diagnostic logging (first few frames only) */
  private sendDiagCount = 0;

  sendAudio(callId: string, frame: AudioFrame): void {
    const state = this.streams.get(callId);
    if (!state) return;

    try {
      let mulaw: Buffer;
      if (frame.encoding === 'mulaw' && frame.sampleRate === 8000) {
        mulaw = frame.audio;
      } else if (frame.encoding === 'pcm_s16le') {
        const pcm8k = frame.sampleRate !== 8000
          ? resamplePcm(frame.audio, frame.sampleRate, 8000)
          : frame.audio;

        // Diagnostic: log PCM stats for first few frames to verify data integrity
        if (this.sendDiagCount < 3) {
          const safeLen = pcm8k.length & ~1;
          let minSample = 32767, maxSample = -32768, sumAbs = 0;
          for (let i = 0; i < safeLen; i += 2) {
            const s = pcm8k.readInt16LE(i);
            if (s < minSample) minSample = s;
            if (s > maxSample) maxSample = s;
            sumAbs += Math.abs(s);
          }
          const numSamples = safeLen / 2;
          const avgAbs = numSamples > 0 ? Math.round(sumAbs / numSamples) : 0;
          logger.info({
            callId,
            diagFrame: this.sendDiagCount,
            inputEncoding: frame.encoding,
            inputRate: frame.sampleRate,
            inputBytes: frame.audio.length,
            pcm8kBytes: pcm8k.length,
            pcm8kSamples: numSamples,
            pcmMin: minSample,
            pcmMax: maxSample,
            pcmAvgAbs: avgAbs,
            durationMs: numSamples > 0 ? Math.round(numSamples / 8) : 0, // ms at 8kHz
          }, '[TwilioAdapter] DIAG: PCM→mulaw conversion stats');
        }

        mulaw = pcmToMulaw(pcm8k);

        // Diagnostic: verify mulaw output
        if (this.sendDiagCount < 3) {
          // Check a few mulaw bytes to see if they look reasonable
          const first10 = Array.from(mulaw.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          logger.info({
            callId,
            diagFrame: this.sendDiagCount,
            mulawBytes: mulaw.length,
            mulawFirst10Hex: first10,
            base64Length: mulaw.toString('base64').length,
          }, '[TwilioAdapter] DIAG: mulaw output');
          this.sendDiagCount++;
        }
      } else {
        logger.warn({ encoding: frame.encoding }, '[TwilioAdapter] Unsupported audio encoding');
        return;
      }

      const outMsg: TwilioOutboundMessage = {
        event: 'media',
        streamSid: state.streamSid,
        media: {
          payload: mulaw.toString('base64'),
        },
      };

      const chunkMs = Math.max(1, Math.round((mulaw.length / 8000) * 1000));
      state.outboundQueuedMs += chunkMs;
      const markName = `assistant:${state.outboundQueuedMs}:${Date.now()}`;
      const markMsg: TwilioOutboundMessage = {
        event: 'mark',
        streamSid: state.streamSid,
        mark: {
          name: markName,
        },
      };
      state.pendingPlaybackMarks.push({ name: markName, playedMs: state.outboundQueuedMs });

      try {
        if (state.ws.readyState === 1) {
          state.ws.send(JSON.stringify(outMsg));
          state.ws.send(JSON.stringify(markMsg));
          if (state.pendingPlaybackMarks.length <= 3 || state.pendingPlaybackMarks.length % 25 === 0) {
            logger.debug({
              callId,
              queuedMs: state.outboundQueuedMs,
              pendingMarks: state.pendingPlaybackMarks.length,
              chunkMs,
              markName,
            }, '[TwilioAdapter] Queued outbound audio with playback mark');
          }
        }
      } catch (sendError) {
        logger.debug({ callId, error: sendError }, '[TwilioAdapter] WebSocket send failed');
      }
    } catch (error) {
      logger.error({ callId, error }, '[TwilioAdapter] Error encoding audio for send');
    }
  }

  clearAudio(callId: string): void {
    const state = this.streams.get(callId);
    if (!state) return;

    try {
      if (state.ws.readyState === 1) {
        const clearMsg = {
          event: 'clear',
          streamSid: state.streamSid,
        };
        state.ws.send(JSON.stringify(clearMsg));
        state.pendingPlaybackMarks = [];
        logger.info({
          callId,
          queuedMs: state.outboundQueuedMs,
        }, '[TwilioAdapter] Sent clear (barge-in)');
      }
    } catch (error) {
      logger.debug({ callId, error }, '[TwilioAdapter] Clear send failed');
    }
  }

  async hangup(callId: string): Promise<void> {
    const state = this.streams.get(callId);
    if (!state) return;

    try {
      if (state.ws.readyState === 1) {
        state.ws.close();
      }
    } catch (error) {
      logger.debug({ callId, error }, '[TwilioAdapter] WebSocket close error (non-fatal)');
    }

    this.cleanupStream(callId);

    try {
      const accountSid = (state.info.metadata.accountSid as string) || this.config.accountSid || '';
      if (accountSid && this.config.accountSid) {
        await this.twilioFetch(
          `/Accounts/${accountSid}/Calls/${callId}.json`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'Status=completed',
          }
        );
        logger.info({ callId }, '[TwilioAdapter] REST hangup succeeded');
      } else {
        logger.warn({ callId, hasAccountSid: !!accountSid, hasConfigSid: !!this.config.accountSid },
          '[TwilioAdapter] Cannot send REST hangup — no accountSid available');
      }
    } catch (error) {
      logger.error({ callId, error: error instanceof Error ? error.message : String(error) },
        '[TwilioAdapter] REST hangup failed');
    }
  }

  getActiveCalls(): string[] {
    return Array.from(this.streams.keys());
  }

  on<K extends keyof TelephonyAdapterEvents>(event: K, handler: TelephonyAdapterEvents[K]): this {
    return super.on(event, handler);
  }

  off<K extends keyof TelephonyAdapterEvents>(event: K, handler: TelephonyAdapterEvents[K]): this {
    return super.off(event, handler);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const [callId, state] of this.streams) {
      try {
        if (state.ws.readyState === 1) {
          state.ws.close();
        }
      } catch (error) {
        logger.debug({ callId, error }, '[TwilioAdapter] WebSocket close error during destroy');
      }
      this.emit('call:ended', callId, 'adapter_destroyed');
    }
    this.streams.clear();
    this.streamSidToCallId.clear();
    this.pendingOutbound.clear();

    await this.stop();
    this.removeAllListeners();

    logger.info('TwilioAdapter destroyed');
  }

  // ─── Outbound Calls ────────────────────────────────────────────

  /**
   * Initiate an outbound call via Twilio REST API.
   * When the callee answers, Twilio hits /voice-outbound which returns
   * TwiML to connect a media stream (same pipeline as inbound).
   *
   * @returns The Twilio CallSid
   */
  async makeCall(config: OutboundCallConfig): Promise<string> {
    const accountSid = this.config.accountSid;
    if (!accountSid) {
      throw new Error('accountSid is required in TwilioAdapterConfig for outbound calls');
    }
    if (!this.config.publicUrl) {
      throw new Error('publicUrl is required in TwilioAdapterConfig for outbound calls');
    }

    const callbackUrl = `${this.config.publicUrl}/voice-outbound`;

    const body = new URLSearchParams({
      To: config.to,
      From: config.from,
      Url: callbackUrl,
    });

    if (config.timeout) {
      body.set('Timeout', String(config.timeout));
    }
    if (config.machineDetection) {
      body.set('MachineDetection', 'Enable');
    }

    logger.info({
      to: config.to,
      from: config.from,
      callbackUrl,
      accountSid: accountSid.slice(0, 8) + '...',
    }, '[TwilioAdapter] Initiating outbound call');

    const response = await this.twilioFetch(
      `/Accounts/${accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }
    );

    const data = await response.json() as { sid: string };
    const callSid = data.sid;

    this.pendingOutbound.add(callSid);
    logger.info({ callSid, to: config.to }, '[TwilioAdapter] Outbound call initiated');

    return callSid;
  }

  /**
   * Returns a webhook handler for outbound calls (external mode).
   * When callee answers, Twilio POSTs to this endpoint.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outboundWebhookHandler(): (req: any, res: any) => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req: any, res: any) => {
      this.handleOutboundWebhookRequest(req, res);
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleOutboundWebhookRequest(_req: any, res: any): void {
    const wsUrl = this.config.publicUrl
      ? `${this.config.publicUrl.replace(/^http/, 'ws')}${this.config.mediaStreamPath}`
      : `wss://localhost:${this.config.port}${this.config.mediaStreamPath}`;

    const twiml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Connect>',
      `    <Stream url="${wsUrl}" />`,
      '  </Connect>',
      '</Response>',
    ].join('\n');

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
  }

  // ─── Internal: Webhook ───────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleWebhookRequest(req: any, res: any): void {
    // Handle pre-parsed body (Express/Connect bodyParser) or raw stream
    const processBody = (bodyStr: string) => {
      const params = new URLSearchParams(bodyStr);

      const callSid = params.get('CallSid') || 'unknown';
      const from = params.get('From') || 'unknown';
      const to = params.get('To') || 'unknown';

      logger.info({ callSid, from, to }, '[TwilioAdapter] Incoming call');

      const wsUrl = this.config.publicUrl
        ? `${this.config.publicUrl.replace(/^http/, 'ws')}${this.config.mediaStreamPath}`
        : `wss://localhost:${this.config.port}${this.config.mediaStreamPath}`;

      const twiml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Response>',
        '  <Connect>',
        `    <Stream url="${wsUrl}">`,
        `      <Parameter name="callSid" value="${callSid}" />`,
        `      <Parameter name="from" value="${from}" />`,
        `      <Parameter name="to" value="${to}" />`,
        '    </Stream>',
        '  </Connect>',
        '</Response>',
      ].join('\n');

      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
    };

    // Express bodyParser may have already parsed the body
    if (req.body) {
      // req.body is either a parsed object or a string
      if (typeof req.body === 'string') {
        processBody(req.body);
      } else {
        // bodyParser.urlencoded() produces an object — re-serialize
        const bodyStr = new URLSearchParams(req.body).toString();
        processBody(bodyStr);
      }
      return;
    }

    // Raw stream reading (standalone mode or no bodyParser)
    const MAX_BODY_SIZE = 65536; // 64KB limit
    let body = '';
    let overflow = false;

    req.on('data', (chunk: string | Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (overflow) {
        logger.warn('[TwilioAdapter] Webhook body too large, rejecting');
        res.writeHead(413);
        res.end('Request too large');
        return;
      }
      processBody(body);
    });
    req.on('error', (error: Error) => {
      logger.error({ error }, '[TwilioAdapter] Webhook request read error');
      res.writeHead(500);
      res.end('Internal error');
    });
  }

  // ─── Internal: Media Stream Protocol ─────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleStreamStart(msg: TwilioMediaMessage, ws: any): MediaStreamState {
    const start = msg.start!;
    const callId = start.customParameters?.callSid || start.callSid;

    // Detect if this is an outbound call we initiated
    const isOutbound = this.pendingOutbound.has(callId);
    if (isOutbound) {
      this.pendingOutbound.delete(callId);
    }

    const info: IncomingCallInfo = {
      callId,
      from: start.customParameters?.from || 'unknown',
      to: start.customParameters?.to || 'unknown',
      metadata: {
        accountSid: start.accountSid,
        streamSid: start.streamSid,
        tracks: start.tracks,
        mediaFormat: start.mediaFormat,
        direction: isOutbound ? 'outbound' : 'inbound',
      },
    };

    const state: MediaStreamState = {
      callId,
      streamSid: start.streamSid,
      ws,
      startTime: Date.now(),
      info,
      inboundFrameCount: 0,
      outboundQueuedMs: 0,
      pendingPlaybackMarks: [],
    };

    this.streams.set(callId, state);
    this.streamSidToCallId.set(start.streamSid, callId);

    logger.info({ callId, streamSid: start.streamSid }, '[TwilioAdapter] Media stream started');

    this.emit('call:connected', callId, info);

    return state;
  }

  private handleStreamMedia(
    state: MediaStreamState,
    media: NonNullable<TwilioMediaMessage['media']>
  ): void {
    const mulawAudio = Buffer.from(media.payload, 'base64');
    const pcmAudio = mulawToPcm(mulawAudio);

    const frame: AudioFrame = {
      audio: pcmAudio,
      sampleRate: 8000,
      encoding: 'pcm_s16le',
      channels: 1,
      timestamp: parseInt(media.timestamp, 10),
    };

    state.inboundFrameCount++;
    // Log every 100 frames (~2 seconds at 20ms/frame) to avoid flooding
    if (state.inboundFrameCount % 100 === 0) {
      logger.debug(
        { callId: state.callId, frameCount: state.inboundFrameCount },
        '[TwilioAdapter] Inbound audio frames received'
      );
    }

    this.emit('call:media_timestamp', state.callId, { timestamp: frame.timestamp });
    this.emit('call:audio', state.callId, frame);
  }

  private handlePlaybackMark(
    state: MediaStreamState,
    mark: NonNullable<TwilioMediaMessage['mark']>
  ): void {
    const pendingIndex = state.pendingPlaybackMarks.findIndex((entry) => entry.name === mark.name);
    if (pendingIndex === -1) {
      logger.debug({
        callId: state.callId,
        markName: mark.name,
        pendingMarks: state.pendingPlaybackMarks.map(entry => entry.name).slice(0, 5),
      }, '[TwilioAdapter] Unexpected playback mark');
      return;
    }

    const [pending] = state.pendingPlaybackMarks.splice(pendingIndex, 1);
    if (!pending) {
      logger.debug({ callId: state.callId, markName: mark.name }, '[TwilioAdapter] Playback mark disappeared before ack handling');
      return;
    }
    if (pendingIndex > 0) {
      state.pendingPlaybackMarks.splice(0, pendingIndex);
    }
    logger.debug({
      callId: state.callId,
      markName: mark.name,
      playedMs: pending.playedMs,
      remainingMarks: state.pendingPlaybackMarks.length,
    }, '[TwilioAdapter] Playback mark acknowledged');
    this.emit('call:playback_mark', state.callId, {
      name: mark.name,
      playedMs: pending.playedMs,
    });
  }

  private handleStreamStop(state: MediaStreamState): void {
    logger.info({ callId: state.callId }, '[TwilioAdapter] Media stream stopped');
    this.emit('call:ended', state.callId, 'stream_stopped');
    this.cleanupStream(state.callId);
  }

  private cleanupStream(callId: string): void {
    const state = this.streams.get(callId);
    if (state) {
      this.streamSidToCallId.delete(state.streamSid);
      this.streams.delete(callId);
    }
  }
}
