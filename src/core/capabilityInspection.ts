import type { ModelCapabilities } from '../domain/interfaces/ITextProvider.js';
import type { AdvancedTextCapabilities, NativeToolCapability } from '../domain/interfaces/IAdvancedInference.js';
import { InvalidConfigError } from '../domain/errors/AIErrors.js';

function invalid(): never {
  throw new InvalidConfigError('Provider returned invalid declared capability metadata');
}
function boolean(value: boolean): boolean { return typeof value === 'boolean' ? value : invalid(); }
function number(value: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : invalid(); }
function string(value: string): string { return typeof value === 'string' ? value : invalid(); }
function choice<const T extends string>(value: T, allowed: readonly T[]): T { return allowed.includes(value) ? value : invalid(); }
function list<T extends string>(value: T[], allowed: readonly T[]): T[] {
  return Array.isArray(value) ? value.map(item => choice(item, allowed)) : invalid();
}

/** Project the declared contract, including prototype getters, without traversing provider extras. */
export function inspectModelCapabilities(value: ModelCapabilities): ModelCapabilities {
  return {
    supportsTools: boolean(value.supportsTools), supportsVision: boolean(value.supportsVision),
    supportsJSON: boolean(value.supportsJSON), supportsJSONSchema: boolean(value.supportsJSONSchema),
    maxTokens: number(value.maxTokens),
    ...(value.maxInputTokens === undefined ? {} : { maxInputTokens: number(value.maxInputTokens) }),
    ...(value.maxOutputTokens === undefined ? {} : { maxOutputTokens: number(value.maxOutputTokens) }),
  };
}

const nativeTools: readonly NativeToolCapability[] = ['web_search', 'x_search', 'web_fetch', 'code_execution', 'file_search', 'remote_mcp', 'computer_use', 'hosted_shell', 'apply_patch', 'tool_search', 'image_generation'];

export function inspectAdvancedCapabilities(value: AdvancedTextCapabilities): AdvancedTextCapabilities {
  const { promptCaching: cache, batch, structuredOutput: structured, nativeToolOptions: toolOptions, responsesExtensions: extensions, dataHandling: data } = value;
  return {
    ...(value.nativeCompaction === undefined ? {} : { nativeCompaction: {
      onDemand: choice(value.nativeCompaction.onDemand, ['supported', 'unsupported', 'unverified']),
      inputTokenCounting: choice(value.nativeCompaction.inputTokenCounting, ['provider', 'unavailable', 'unverified']),
    } }),
    ...(value.reasoningHistory === undefined ? {} : { reasoningHistory: choice(value.reasoningHistory, ['discard', 'always', 'when_tools_configured']) }),
    promptCaching: {
      mode: choice(cache.mode, ['unsupported', 'implicit', 'request_controlled', 'explicit_resource']),
      ttlModes: list(cache.ttlModes, ['short', 'extended']), reportsCacheUsage: boolean(cache.reportsCacheUsage),
      ...(cache.explicitBreakpoints === undefined ? {} : { explicitBreakpoints: boolean(cache.explicitBreakpoints) }),
    },
    batch: {
      supported: boolean(batch.supported), cancellable: boolean(batch.cancellable),
      ...(batch.maxRequests === undefined ? {} : { maxRequests: number(batch.maxRequests) }),
      ...(batch.completionWindow === undefined ? {} : { completionWindow: string(batch.completionWindow) }),
    },
    structuredOutput: {
      jsonObject: choice(structured.jsonObject, ['native', 'prompt']), jsonSchema: choice(structured.jsonSchema, ['native', 'prompt']),
      nativeWithTools: boolean(structured.nativeWithTools),
    },
    nativeTools: list(value.nativeTools, nativeTools),
    nativeToolOptions: { remoteMcpApproval: boolean(toolOptions.remoteMcpApproval) },
    ...(extensions === undefined ? {} : { responsesExtensions: {
      asyncToolCalling: boolean(extensions.asyncToolCalling), midTurnSteering: boolean(extensions.midTurnSteering),
      configurationUpdates: boolean(extensions.configurationUpdates), misalignmentMonitoring: boolean(extensions.misalignmentMonitoring),
    } }),
    dataHandling: {
      promptCaching: choice(data.promptCaching, ['none', 'provider_managed']), batch: choice(data.batch, ['none', 'provider_retained']),
      remoteMcp: choice(data.remoteMcp, ['none', 'third_party']),
    },
  };
}
