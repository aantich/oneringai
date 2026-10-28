/** Pure browser-safe metadata; no keys, network, model or session construction. */
import assert from 'node:assert/strict';
import { Vendor, getRealtimeModelCapabilities, getTranscriptionCapabilities } from '@everworker/oneringai/shared';
for (const model of ['gpt-realtime-2', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'custom-realtime']) {
  const capability = getRealtimeModelCapabilities({ vendor: Vendor.OpenAI, model, transport: 'webrtc' });
  console.log(JSON.stringify({ model, ...capability.reasoning }));
}
const supported = getTranscriptionCapabilities({ vendor: Vendor.OpenAI, model: 'gpt-live-transcribe', mode: 'transcription-session', transport: 'webrtc', turnDetection: 'off' });
const unsupported = getTranscriptionCapabilities({ vendor: Vendor.OpenAI, model: 'gpt-transcribe', mode: 'transcription-session', transport: 'webrtc' });
const unknown = getTranscriptionCapabilities({ vendor: Vendor.OpenAI, model: 'gpt-transcribe', mode: 'conversation-input', transport: 'websocket', conversationModel: 'gpt-realtime-2.1' });
assert.equal(supported.support, 'supported'); assert.equal(unsupported.support, 'unsupported'); assert.equal(unknown.support, 'unknown');
console.log(JSON.stringify({ passed: true, dedicated: supported, incompatible: unsupported, unverifiedPair: unknown }));
