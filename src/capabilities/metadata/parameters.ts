import { Vendor } from '../../core/Vendor.js';
import { getModelInfo } from '../../domain/entities/Model.js';
import type { EndpointCapabilitySupport } from './realtime.js';
export type ModelParameterEndpoint = 'responses' | 'chat-completions' | 'custom';
export interface ModelParameterQuery { vendor: Vendor; model: string; endpoint: ModelParameterEndpoint; /** Actual effective effort after caller overrides; omitted means provider default. */ reasoningEffort?: string }
export interface ModelParameterAssessment {
  readonly effectiveReasoningEffort: string | null;
  readonly reasoningEffort: EndpointCapabilitySupport;
  readonly temperature: { readonly support: EndpointCapabilitySupport; readonly reason: 'reasoning-active' | 'reasoning-disabled' | 'registry' | 'unverified' };
}
export interface ModelParameterDecision {
  readonly vendor: Vendor; readonly model: string; readonly endpoint: ModelParameterEndpoint;
  readonly action: 'preserve' | 'omit' | 'reject'; readonly support: EndpointCapabilitySupport;
  readonly effectiveReasoningEffort: string | null; readonly reason: ModelParameterAssessment['temperature']['reason'];
}
export interface ModelParameterPolicy {
  temperature: 'strict' | 'omit-unsupported';
  /** Bounded diagnostics, no request payload. Observer failures cannot repeat a request. */
  observe?(decision: Readonly<ModelParameterDecision>): void;
}
// One fact source for the legacy validator, provider filtering and opt-in assessment.
const samplingFamilies = [
  { pattern: /^gpt-6-astra(?:-|$)/, legacy: true, none: false },
  { pattern: /^gpt-6\.1-sol(?:-|$)/, legacy: true, none: false },
  { pattern: /^gpt-6-sol(?:-|$)/, legacy: true, none: true },
  { pattern: /^gpt-6-luna(?:-|$)/, legacy: true, none: true },
  { pattern: /^gpt-6\.1-terra(?:-|$)/, legacy: false, none: true },
] as const;
/** @internal Legacy scope is intentionally frozen; selected policy can use newer documented facts. */
export function openAISamplingConstraint(model: string, effort?: string, legacyOnly = false) {
  const family = samplingFamilies.find(row => row.pattern.test(model) && (!legacyOnly || row.legacy));
  return family ? { effort: effort ?? 'medium', blocked: (effort ?? 'medium') !== 'none', allowsNone: family.none } : undefined;
}
/** @internal Resolve explicit request reasoning and the latest conversation configuration update. */
export function effectiveOpenAIRequestEffort(reasoning: unknown, input?: unknown): string | undefined {
  let effort = reasoning && typeof reasoning === 'object' && 'effort' in reasoning && typeof reasoning.effort === 'string' ? reasoning.effort : undefined;
  if (Array.isArray(input)) for (const item of input) {
    if (item && typeof item === 'object' && item.type === 'configuration_update' && item.reasoning && typeof item.reasoning.effort === 'string') effort = item.reasoning.effort;
  }
  return effort;
}
/** Pure metadata. Unknown/custom endpoints are preserved rather than silently sanitized. */
export function assessModelParameters(query: ModelParameterQuery): ModelParameterAssessment {
  const info = getModelInfo(query.model);
  if (query.endpoint === 'custom' || !['responses', 'chat-completions'].includes(query.endpoint) || query.vendor !== Vendor.OpenAI) return Object.freeze({ effectiveReasoningEffort: query.reasoningEffort ?? null, reasoningEffort: 'unknown', temperature: Object.freeze({ support: 'unknown', reason: 'unverified' }) });
  const constraint = openAISamplingConstraint(query.model, query.reasoningEffort);
  if (constraint) {
    const allowed = info?.provider === query.vendor ? info.features.reasoningEfforts : undefined;
    const reasoningEffort = allowed ? allowed.includes(constraint.effort as any) ? 'supported' : 'unsupported' : constraint.effort === 'none' && !constraint.allowsNone ? 'unsupported' : ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(constraint.effort) ? 'supported' : 'unknown';
    return Object.freeze({ effectiveReasoningEffort: constraint.effort, reasoningEffort, temperature: Object.freeze({ support: constraint.blocked || reasoningEffort === 'unsupported' ? 'unsupported' : 'supported', reason: constraint.blocked ? 'reasoning-active' : 'reasoning-disabled' }) });
  }
  const declared = info?.provider === query.vendor ? info.features.parameters?.temperature : undefined;
  return Object.freeze({ effectiveReasoningEffort: query.reasoningEffort ?? null, reasoningEffort: 'unknown', temperature: Object.freeze({ support: declared === false ? 'unsupported' : declared === true ? 'supported' : 'unknown', reason: declared === undefined ? 'unverified' : 'registry' }) });
}
