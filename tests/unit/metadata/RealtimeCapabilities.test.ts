import { describe, it, expect } from 'vitest';
import { Vendor, getRealtimeModelCapabilities, getTranscriptionCapabilities, MODEL_REGISTRY, STT_MODEL_REGISTRY } from '@/index.js';
import { build } from 'esbuild';
const realtime = (model: string, extra = {}) => getRealtimeModelCapabilities({ vendor: Vendor.OpenAI, model, transport: 'webrtc', ...extra });
const transcription = (extra = {}) => getTranscriptionCapabilities({ vendor: Vendor.OpenAI, model: 'gpt-transcribe', mode: 'transcription-session', transport: 'websocket', ...extra });
describe('sparse browser-safe endpoint metadata', () => {
  it.each(['websocket', 'webrtc', 'sip'] as const)('publishes only the documented exact 2 effort set for %s', transport => {
    expect(realtime('gpt-realtime-2', { transport }).reasoning).toMatchObject({ support: 'supported', allowedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], provenance: { kind: 'documentation', verifiedAt: '2026-10-28' } });
  });
  it.each(['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'])('keeps the exact allowed efforts unknown for %s', model => { expect(realtime(model).reasoning).toMatchObject({ support: 'supported', allowedEfforts: null }); });
  it.each(['custom-model', 'gpt-4o-mini'])('keeps unlisted and non-realtime %s unknown', model => { expect(realtime(model).reasoning.support).toBe('unknown'); });
  it('does not infer vendor or official endpoint from a known model string', () => { expect(realtime('gpt-realtime-2', { vendor: Vendor.Custom }).reasoning.support).toBe('unknown'); expect(realtime('gpt-realtime-2', { endpoint: 'custom' }).reasoning.support).toBe('unknown'); });
  it('freezes returned verified data while preserving old registry objects byte-for-byte', () => {
    const before = JSON.stringify([MODEL_REGISTRY, STT_MODEL_REGISTRY]); const r = realtime('gpt-realtime-2'); expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(r.reasoning.allowedEfforts)).toBe(true); transcription(); expect(JSON.stringify([MODEL_REGISTRY, STT_MODEL_REGISTRY])).toBe(before);
    const saved = 'max'; expect(r.reasoning.allowedEfforts).not.toContain(saved); expect(saved).toBe('max');
  });
  it('projects file transcription metadata instead of generic legacy streaming flags', () => { expect(transcription({ mode: 'file' }).support).toBe('supported'); expect(transcription({ model: 'gpt-live-transcribe', mode: 'file' }).support).toBe('unknown'); });
  it.each(['webrtc', 'sip'])('rejects the documented committed-turn transport constraint on %s', transport => { expect(transcription({ transport }).support).toBe('unsupported'); });
  it('requires actual transport before declaring a dedicated session supported', () => { expect(transcription({ transport: undefined }).support).toBe('unknown'); expect(transcription().support).toBe('supported'); });
  it.each(['gpt-realtime-2', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'custom-conversation'])('does not invent conversation input pairing %s', conversationModel => { expect(transcription({ mode: 'conversation-input', conversationModel }).support).toBe('unknown'); });
  it.each(['websocket', 'webrtc'])('supports documented dedicated live transcription over %s without VAD', transport => { expect(transcription({ model: 'gpt-live-transcribe', transport, turnDetection: 'off' }).support).toBe('supported'); });
  it.each(['server_vad', 'semantic_vad'])('rejects documented dedicated live VAD %s', turnDetection => { expect(transcription({ model: 'gpt-live-transcribe', turnDetection }).support).toBe('unsupported'); });
  it('keeps invalid JavaScript endpoint/mode/transport queries unknown', () => { expect(realtime('gpt-realtime-2', { transport: 'other' }).reasoning.support).toBe('unknown'); expect(transcription({ mode: 'other' }).support).toBe('unknown'); expect(transcription({ endpoint: 'other' }).support).toBe('unknown'); });
  it('keeps custom and unknown transcription endpoints unknown', () => { expect(transcription({ endpoint: 'custom' }).support).toBe('unknown'); expect(transcription({ model: 'unknown' }).support).toBe('unknown'); expect(transcription({ model: 'gpt-live-transcribe', mode: 'conversation-input', conversationModel: 'gpt-realtime-2' }).support).toBe('unknown'); });
  it('bundles /shared for browsers without Node builtins or provider SDKs', async () => {
    const output = await build({ entryPoints: ['src/shared/index.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true });
    expect(Object.keys(output.metafile!.inputs).some(path => path.includes('node_modules') || path.includes('/infrastructure/'))).toBe(false); expect(output.outputFiles[0]!.text).not.toMatch(/require\(["'](?:node:|fs|crypto)/);
  });
});
