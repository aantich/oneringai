import { Vendor, getRealtimeModelCapabilities, getTranscriptionCapabilities } from '@everworker/oneringai/shared';
import type { RealtimeModelCapabilities } from '@everworker/oneringai';
const selected: RealtimeModelCapabilities = getRealtimeModelCapabilities({ vendor: Vendor.OpenAI, model: 'gpt-realtime-2.1', transport: 'webrtc' });
const unknown: readonly string[] | null = selected.reasoning.allowedEfforts;
// @ts-expect-error A model string does not select its vendor.
getRealtimeModelCapabilities({ model: 'gpt-realtime-2', transport: 'webrtc' });
// @ts-expect-error Session modes are explicit.
getTranscriptionCapabilities({ vendor: Vendor.OpenAI, model: 'gpt-transcribe', mode: 'streaming' });
void unknown;
import { Agent, assessModelParameters } from '@everworker/oneringai';
import type { ModelParameterPolicy, SerializedAgentPackage } from '@everworker/oneringai';
const policy: ModelParameterPolicy = { temperature: 'omit-unsupported' };
Agent.create({ connector: 'main', model: 'gpt-6-sol', parameterPolicy: policy });
assessModelParameters({ vendor: Vendor.OpenAI, model: 'gpt-6-sol', endpoint: 'responses', reasoningEffort: 'none' });
// @ts-expect-error Policy choices are explicit.
const badPolicy: ModelParameterPolicy = { temperature: 'auto' };
declare const legacyPackage: SerializedAgentPackage;
// @ts-expect-error Trusted host policy does not become portable v2 authority.
legacyPackage.agent.runtime.parameterPolicy;
void badPolicy;
import { getVendorPresentation, VENDOR_PRESENTATIONS } from '@everworker/oneringai/shared';
import type { VendorPresentation } from '@everworker/oneringai';
const display: VendorPresentation | undefined = getVendorPresentation(Vendor.OpenAI);
// @ts-expect-error Host overrides must be composed, not applied to shared immutable rows.
VENDOR_PRESENTATIONS.openai.color = '#000000';
void display;
