/**
 * Voice calling capability
 *
 * Enables agents to participate in voice phone calls and messaging
 * via telephony providers (Twilio, etc.).
 *
 * Architecture:
 * - VoiceBridge: multi-session manager, connects adapters to agents
 * - VoiceSession: per-call state machine
 * - TextPipeline: STT → Agent → TTS pipeline (works with any LLM)
 * - TwilioAdapter: Twilio Voice integration (Media Streams WebSocket)
 *
 * @example
 * ```typescript
 * import {
 *   VoiceBridge,
 *   TwilioAdapter,
 * } from 'oneringai';
 *
 * const bridge = VoiceBridge.create({
 *   agent: { connector: 'anthropic', model: 'claude-sonnet-4-6' },
 *   pipeline: 'text',
 *   stt: { connector: 'openai' },
 *   tts: { connector: 'openai', voice: 'nova' },
 *   greeting: 'Hello! How can I help?',
 * });
 *
 * const adapter = TwilioAdapter.createStandalone({
 *   connector: 'twilio',
 *   port: 3000,
 *   publicUrl: 'https://abc.ngrok.io',
 * });
 *
 * bridge.attach(adapter);
 * await adapter.start();
 * ```
 */

// Core
export { VoiceBridge } from './VoiceBridge.js';
export type { VoiceBridgeEvents } from './VoiceBridge.js';
export { VoiceSession } from './VoiceSession.js';
export type { VoiceSessionEvents } from './VoiceSession.js';

// Pipelines
export { TextPipeline } from './pipelines/TextPipeline.js';
export { RealtimePipeline } from './pipelines/RealtimePipeline.js';
export {
  OpenAIRealtimeSession,
  OpenAIRealtimeAgentSession,
  OpenAIRealtimeAPI,
  OpenAIRealtimeChannelTransport,
} from './openai/index.js';
export { GrokRealtimeAPI, GrokRealtimeSession } from './grok/index.js';
export type {
  OpenAIRealtimeConnectOptions,
  OpenAIRealtimeSessionOptions,
  OpenAIRealtimeSessionEvents,
  OpenAIRealtimeAgentTransport,
  OpenAIRealtimeAgentSessionOptions,
  OpenAIRealtimeAgentSessionEvents,
  OpenAIRealtimeChannelTransportOptions,
  OpenAIRealtimeAgentUsage,
  OpenAIRealtimeMCPApprovalRequest,
  OpenAIRealtimeMCPApprovalDecision,
  CreateRealtimeClientSecretOptions,
  CreateRealtimeTranslationClientSecretOptions,
  CreateRealtimeWebRTCCallOptions,
  OpenAIRealtimeWebRTCCall,
  RealtimeMessageChannel,
  OpenAIRealtimeModel,
  OpenAIRealtimeVoice,
  RealtimePCMSampleRate,
  OpenAIRealtimePCMSampleRate,
  OpenAIRealtimeAudioFormat,
  OpenAIRealtimeTurnDetection,
  OpenAIServerVAD,
  OpenAISemanticVAD,
  OpenAIRealtimeFunctionTool,
  OpenAIRealtimeMCPTool,
  OpenAIRealtimeTool,
  OpenAIRealtimeSessionConfig,
  OpenAIRealtimeTranscriptionSessionConfig,
  OpenAIRealtimeTranslationSessionConfig,
  OpenAIRealtimeTranslationClientSessionConfig,
  OpenAIRealtimeClientSecret,
  OpenAIRealtimeClientEvent,
  OpenAIRealtimeServerEvent,
} from './openai/index.js';
export type {
  GrokRealtimeClientSecret,
  GrokRealtimeSessionOptions,
  GrokRealtimeAudioFormat,
  GrokRealtimeSessionConfig,
} from './grok/index.js';

// VAD
export { EnergyVAD } from './EnergyVAD.js';

// Adapters
export { TwilioAdapter, mulawToPcm, pcmToMulaw, resamplePcm, twilioToStt, sttToTwilio } from './adapters/twilio/index.js';

// Types
export type {
  // Audio
  AudioFrame,
  AudioEncoding,

  // VAD
  VADEvent,
  IVoiceActivityDetector,
  EnergyVADConfig,

  // Session
  CallDirection,
  SessionState,
  VoiceSessionInfo,
  CallEndReason,
  CallSummary,

  // Bridge config
  VoiceBridgeConfig,
  VoiceAgentFactory,
  TextPipelineConfig,
  RealtimePipelineConfig,
  PipelineConfig,
  TranscriptMessage,

  // Hooks
  VoiceHooks,

  // Pipeline interface
  IVoicePipeline,
  VoicePipelineEvents,

  // Adapter interface
  ITelephonyAdapter,
  TelephonyAdapterEvents,
  IncomingCallInfo,
  OutboundCallConfig,

  // Twilio
  TwilioAdapterConfig,
} from './types.js';
