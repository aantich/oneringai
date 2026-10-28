import { Vendor } from '../../core/Vendor.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import { STT_MODEL_REGISTRY } from '../../domain/entities/STTModel.js';
export type EndpointCapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export type RealtimeTransport = 'websocket' | 'webrtc' | 'sip';
export type RealtimeReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export interface CapabilityProvenance { readonly kind: 'documentation' | 'registry'; readonly url?: string; readonly verifiedAt?: string }
export interface RealtimeModelCapabilityQuery {
  vendor: Vendor; model: string; transport: RealtimeTransport;
  /** Custom gateways do not inherit the official endpoint's verified facts. */
  endpoint?: 'openai-realtime' | 'custom';
}
export interface RealtimeModelCapabilities {
  readonly vendor: Vendor; readonly model: string; readonly transport: RealtimeTransport;
  readonly registryKnown: boolean;
  readonly reasoning: { readonly support: EndpointCapabilitySupport; /** null explicitly means the exact set is unknown. */ readonly allowedEfforts: readonly RealtimeReasoningEffort[] | null; readonly provenance?: CapabilityProvenance };
}
const verifiedAt = '2026-10-28';
const voiceGuide = 'https://developers.openai.com/api/docs/guides/voice-prompting#set-reasoning-effort';
const transcriptionGuide = 'https://developers.openai.com/api/docs/guides/realtime-transcription';
const efforts: readonly RealtimeReasoningEffort[] = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);
const documentedReasoningModels = new Set(['gpt-realtime-2', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini']);
/** Pure sparse companion. Unknown metadata never becomes an unsupported UI choice. */
export function getRealtimeModelCapabilities(query: RealtimeModelCapabilityQuery): RealtimeModelCapabilities {
  const model = getModelInfo(query.model), registryKnown = !!model && model.provider === query.vendor;
  let support: EndpointCapabilitySupport = 'unknown', allowedEfforts: readonly RealtimeReasoningEffort[] | null = null, provenance: CapabilityProvenance | undefined;
  if (query.vendor === Vendor.OpenAI && (query.endpoint === undefined || query.endpoint === 'openai-realtime') && ['websocket', 'webrtc', 'sip'].includes(query.transport) && registryKnown && model.features.realtime === true) {
    if (documentedReasoningModels.has(query.model)) {
      support = 'supported'; provenance = { kind: 'documentation', url: query.model === 'gpt-realtime-2' ? voiceGuide : `https://developers.openai.com/api/docs/models/${query.model}`, verifiedAt };
      if (query.model === 'gpt-realtime-2') allowedEfforts = efforts;
    } else if (model.features.reasoning === false) { support = 'unsupported'; allowedEfforts = Object.freeze([]); provenance = { kind: 'registry' }; }
  }
  return Object.freeze({ vendor: query.vendor, model: query.model, transport: query.transport, registryKnown, reasoning: Object.freeze({ support, allowedEfforts, ...(provenance ? { provenance: Object.freeze(provenance) } : {}) }) });
}
export interface TranscriptionCapabilityQuery {
  vendor: Vendor; model: string;
  mode: 'file' | 'transcription-session' | 'conversation-input';
  transport?: RealtimeTransport; conversationModel?: string;
  endpoint?: 'openai' | 'custom';
  turnDetection?: 'off' | 'server_vad' | 'semantic_vad';
}
export interface TranscriptionCapabilities {
  readonly support: EndpointCapabilitySupport;
  readonly constraints: { readonly requiredTransport?: 'websocket'; readonly turnDetection?: 'off' };
  readonly reason: string;
  readonly provenance?: CapabilityProvenance;
}
/** Endpoint/session constraints only. This does not modify legacy STT flags or validate a live session. */
export function getTranscriptionCapabilities(query: TranscriptionCapabilityQuery): TranscriptionCapabilities {
  const result = (support: EndpointCapabilitySupport, reason: string, constraints: TranscriptionCapabilities['constraints'] = {}, provenance?: CapabilityProvenance): TranscriptionCapabilities =>
    Object.freeze({ support, reason, constraints: Object.freeze(constraints), ...(provenance ? { provenance: Object.freeze(provenance) } : {}) });
  if (query.vendor !== Vendor.OpenAI || query.endpoint !== undefined && query.endpoint !== 'openai' || !['file', 'transcription-session', 'conversation-input'].includes(query.mode) || query.transport !== undefined && !['websocket', 'webrtc', 'sip'].includes(query.transport)) return result('unknown', 'Endpoint has no verified companion entry');
  const registry = STT_MODEL_REGISTRY[query.model];
  if (!registry || registry.provider !== query.vendor) return result('unknown', 'Transcription model is unlisted');
  if (query.mode === 'file') return registry.endpoints?.includes('audio_transcription')
    ? result('supported', 'Declared file transcription endpoint', {}, { kind: 'registry', ...(registry.sources?.documentation ? { url: registry.sources.documentation } : {}) })
    : result('unknown', 'File transcription support is not established by this companion');
  const provenance: CapabilityProvenance = { kind: 'documentation', url: transcriptionGuide, verifiedAt };
  if (query.model === 'gpt-transcribe') {
    const constraints = { requiredTransport: 'websocket' as const };
    if (query.transport && query.transport !== 'websocket') return result('unsupported', 'Committed-turn realtime transcription requires WebSocket', constraints, provenance);
    if (query.mode === 'conversation-input') return result('unknown', 'Exact conversation/transcription model pairing is unverified', constraints, provenance);
    return query.transport === 'websocket' ? result('supported', 'Dedicated committed-turn transcription over WebSocket', constraints, provenance) : result('unknown', 'Select the actual transport', constraints, provenance);
  }
  if (query.model === 'gpt-live-transcribe' && query.mode === 'transcription-session') {
    const constraints = { turnDetection: 'off' as const };
    if (query.turnDetection && query.turnDetection !== 'off') return result('unsupported', 'Dedicated live transcription requires VAD omitted or off', constraints, provenance);
    return query.transport === 'websocket' || query.transport === 'webrtc' ? result('supported', 'Dedicated streaming transcription; VAD omitted or off', constraints, provenance) : result('unknown', 'Dedicated transport is unverified', constraints, provenance);
  }
  return result('unknown', 'Exact endpoint/session/model combination is unverified');
}
