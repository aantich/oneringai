import type { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { Vendor } from '../../../core/Vendor.js';
import { InvalidConfigError } from '../../../domain/errors/AIErrors.js';
import { containAsyncRejection } from '../../../core/evidence/validation.js';
import { assessModelParameters, effectiveOpenAIRequestEffort } from '../../../capabilities/metadata/parameters.js';
/** Apply only the explicit policy to normalized fields, before endpoint-specific projection. */
export function applyOpenAIParameterPolicy(options: TextGenerateOptions, providerName: string, baseURL?: string): TextGenerateOptions {
  const policy = options.parameterPolicy; if (!policy) return options;
  if (!['strict', 'omit-unsupported'].includes(policy.temperature)) throw new InvalidConfigError('Invalid temperature parameter policy');
  let official = providerName === 'openai';
  if (baseURL) { try { official &&= /^(?:api\.openai\.com|eu\.api\.openai\.com|us\.api\.openai\.com)$/.test(new URL(baseURL).hostname); } catch { official = false; } }
  const initialEffort = options.thinking?.enabled ? options.thinking.effort || 'medium' : options.vendorOptions?.reasoning?.effort;
  const reasoning = effectiveOpenAIRequestEffort({ effort: initialEffort }, options.input);
  const assessment = assessModelParameters({ vendor: official ? Vendor.OpenAI : Vendor.Custom, model: options.model, endpoint: official ? 'responses' : 'custom', ...(typeof reasoning === 'string' ? { reasoningEffort: reasoning } : {}) });
  const unsupported = assessment.temperature.support === 'unsupported';
  const raw = options.vendorOptions?.temperature !== undefined;
  const action = unsupported && (raw || options.temperature !== undefined && policy.temperature === 'strict') ? 'reject'
    : unsupported && options.temperature !== undefined ? 'omit' : 'preserve';
  try { containAsyncRejection(policy.observe?.(Object.freeze({ vendor: official ? Vendor.OpenAI : Vendor.Custom, model: options.model.slice(0, 256), endpoint: official ? 'responses' : 'custom', action,
    support: assessment.temperature.support, effectiveReasoningEffort: assessment.effectiveReasoningEffort?.slice(0, 32) ?? null, reason: assessment.temperature.reason }))); } catch { /* Observation cannot change dispatch. */ }
  if (action === 'reject') throw new InvalidConfigError(`${options.model} does not support ${raw ? 'explicit vendorOptions.temperature' : 'temperature'} when reasoning effort is '${assessment.effectiveReasoningEffort ?? 'unverified'}'`);
  if (action !== 'omit') return options;
  const { temperature: _temperature, ...selected } = options; return selected;
}
