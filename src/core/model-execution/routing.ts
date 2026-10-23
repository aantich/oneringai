import { randomUUID } from 'node:crypto';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { InputItem } from '../../domain/entities/Message.js';
import type { DataHandlingPolicy } from '../../domain/interfaces/IAdvancedInference.js';
import { withAbort } from '../tool-execution/cancellation.js';
import type { ModelRouteCandidate, ModelRoutingConfig, ModelRoutingContext, ModelRoutingDiagnostics, ModelRoutingRunOptions } from './types.js';
import type { ITextProvider, TextGenerateOptions } from '../../domain/interfaces/ITextProvider.js';
import type { Connector } from '../Connector.js';
import type { ModelExecutionConfig } from './types.js';

/** @internal Immutable execution-owned transport; public Agent defaults are untouched. */
export interface ModelExecutionBinding {
  readonly model: string;
  readonly connector: Connector;
  readonly provider: ITextProvider;
  readonly config: ModelExecutionConfig;
  readonly dataHandling?: DataHandlingPolicy;
  assertCurrent(request?: TextGenerateOptions): void;
  onDispatch(): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function boundedString(value: unknown, name: string, max: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max) throw new InvalidConfigError(`${name} must be ${empty ? 'at most' : '1–'}${max} characters`);
}
function routeName(value: unknown): asserts value is string {
  boundedString(value, 'Route name', 64);
  if (['__proto__', 'prototype', 'constructor'].includes(value)) throw new InvalidConfigError('Reserved route name');
}
function positive(value: unknown, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) <= 0)) throw new InvalidConfigError(`${name} must be a positive safe integer`);
}
/** @internal Global routing config is managed-only; explicit unsupported overrides are errors. */
export function assertNoRoutingOverride(options: object): void {
  if ((options as { routing?: unknown }).routing !== undefined) throw new InvalidConfigError('Model routing is supported only on managed run/stream calls');
}

/** @internal Copy configuration; arbitrary host callbacks remain runtime-only. */
export function copyRoutingConfig(value: ModelRoutingConfig | undefined): ModelRoutingConfig | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || !record(value.routes) || Object.keys(value.routes).length > 16) throw new InvalidConfigError('Routing requires a routes map with at most 16 alternatives');
  if (value.select !== undefined && typeof value.select !== 'function') throw new InvalidConfigError('Routing select must be a function');
  if (value.sticky !== undefined && !['run', 'phase'].includes(value.sticky)) throw new InvalidConfigError('Routing sticky must be run or phase');
  positive(value.timeoutMs, 'Routing timeoutMs');
  const routes: ModelRoutingConfig['routes'] = Object.create(null);
  for (const [name, route] of Object.entries(value.routes)) {
    routeName(name);
    if (name === 'default') throw new InvalidConfigError('The default route cannot be redefined');
    if (!record(route)) throw new InvalidConfigError(`Route ${name} must be an object`);
    boundedString(route.model, 'Route model', 256);
    if (route.connector !== undefined) boundedString(route.connector, 'Route connector', 256);
    positive(route.maxOutputTokens, 'Route maxOutputTokens');
    if (route.temperature !== undefined && (typeof route.temperature !== 'number' || !Number.isFinite(route.temperature))) throw new InvalidConfigError('Route temperature must be finite');
    if (route.allowContextTransfer !== undefined && typeof route.allowContextTransfer !== 'boolean') throw new InvalidConfigError('allowContextTransfer must be boolean');
    if (route.priceBound !== undefined && (!record(route.priceBound) || (['inputPerMillion', 'outputPerMillion'] as const).some(key => typeof route.priceBound![key] !== 'number' || !Number.isFinite(route.priceBound![key]) || route.priceBound![key] < 0))) throw new InvalidConfigError('Route priceBound requires nonnegative finite rates');
    if (route.dataHandling !== undefined && (!record(route.dataHandling) || Object.values(route.dataHandling).some(flag => typeof flag !== 'boolean'))) throw new InvalidConfigError('Route dataHandling flags must be boolean');
    try { routes[name] = structuredClone(route); } catch { throw new InvalidConfigError('Route configuration must be cloneable'); }
  }
  if (value.fallback !== undefined) { routeName(value.fallback); if (value.fallback !== 'default' && !Object.hasOwn(routes, value.fallback)) throw new InvalidConfigError('Unknown routing fallback'); }
  return Object.freeze({ routes: Object.freeze(routes), ...(value.select ? { select: value.select } : {}),
    ...(value.fallback !== undefined ? { fallback: value.fallback } : {}), ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs } : {}),
    ...(value.sticky !== undefined ? { sticky: value.sticky } : {}) });
}

/** @internal Reject ignored/malformed host options before changing conversation. */
export function routingOptions(value: ModelRoutingRunOptions | null | undefined): ModelRoutingRunOptions | null | undefined {
  if (value === null || value === undefined) return value;
  if (!record(value) || Object.keys(value).some(key => !['route', 'taskType', 'phase'].includes(key))) throw new InvalidConfigError('Invalid routing options');
  if (value.route !== undefined) routeName(value.route);
  for (const key of ['taskType', 'phase'] as const) if (value[key] !== undefined) boundedString(value[key], `Routing ${key}`, 128, true);
  return Object.freeze({ ...value });
}

/** @internal One bounded selector invocation; validation failures never trigger fallback. */
export async function selectModelRoute(config: ModelRoutingConfig | undefined, options: ModelRoutingRunOptions | null | undefined,
  candidates: readonly ModelRouteCandidate[], previous: ModelRoutingContext['previous'], signal: AbortSignal, executionId: string, deadline?: number): Promise<ModelRoutingDiagnostics> {
  const started = performance.now();
  const checkDeadline = (): void => { signal.throwIfAborted(); if (deadline !== undefined && Date.now() >= deadline) throw new DOMException('Model task deadline exceeded during routing', 'TimeoutError'); };
  checkDeadline();
  options = routingOptions(options);
  if (!config && options !== undefined && options !== null) throw new InvalidConfigError('Routing options require modelExecution.routing');
  let route = options?.route ?? 'default';
  let source: ModelRoutingDiagnostics['source'] = options === null ? 'disabled' : options?.route ? 'explicit' : 'default';
  let reason: string | undefined;
  let selectorFailure: ModelRoutingDiagnostics['selectorFailure'];
  if (config && options !== null && !options?.route) {
    if (config.sticky === 'phase' && previous && options?.phase) { route = previous.route; source = 'sticky'; }
    else if (config.select) {
      const controller = new AbortController();
      const selectorSignal = AbortSignal.any([signal, controller.signal]);
      const timeout = config.timeoutMs ?? 1000;
      const timer = setTimeout(() => controller.abort(new DOMException('Routing selector timed out', 'TimeoutError')), Math.min(timeout, deadline === undefined ? timeout : Math.max(1, deadline - Date.now()), 2_147_483_647));
      let decision: unknown;
      try {
        const context: ModelRoutingContext = Object.freeze({
          hints: Object.freeze({ ...(options?.taskType !== undefined ? { taskType: options.taskType } : {}), ...(options?.phase !== undefined ? { phase: options.phase } : {}) }),
          candidates: Object.freeze(candidates.map(candidate => Object.freeze({ ...candidate, reasons: Object.freeze([...candidate.reasons]) }))),
          ...(previous ? { previous: Object.freeze({ ...previous }) } : {}), signal: selectorSignal,
        });
        decision = await withAbort(Promise.resolve(config.select(context)), selectorSignal);
        checkDeadline();
        if (performance.now() - started >= timeout) throw new DOMException('Routing selector timed out', 'TimeoutError');
      } catch (error) {
        checkDeadline();
        selectorFailure = controller.signal.aborted || error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'exception';
        route = config.fallback ?? 'default'; source = 'fallback';
      } finally { clearTimeout(timer); controller.abort(); }
      if (!selectorFailure) {
        if (typeof decision === 'string') route = decision;
        else if (record(decision) && Object.keys(decision).every(key => key === 'route' || key === 'reason')) {
          routeName(decision.route); route = decision.route;
          if (decision.reason !== undefined) { boundedString(decision.reason, 'Routing reason', 512, true); reason = decision.reason; }
        } else throw new InvalidConfigError('Routing selector returned an invalid decision');
        source = 'policy';
      }
    }
  }
  routeName(route);
  const selected = candidates.find(candidate => candidate.route === route);
  if (!selected) throw new InvalidConfigError(`Unknown model route '${route}'`);
  return Object.freeze({ decisionId: randomUUID(), executionId, ...(options?.route ? { requestedRoute: options.route } : {}),
    selectedRoute: route, connector: selected.connector, model: selected.model, source,
    ...(reason !== undefined ? { reason } : {}), ...(selectorFailure ? { selectorFailure } : {}), selectionMs: performance.now() - started });
}

/** @internal False is an inherited prohibition, never loosened by a route/override. */
export function restrictDataHandling(...policies: Array<DataHandlingPolicy | undefined>): DataHandlingPolicy | undefined {
  const values = policies.filter((policy): policy is DataHandlingPolicy => policy !== undefined);
  if (!values.length) return undefined;
  const result = Object.assign({}, ...values) as DataHandlingPolicy;
  for (const key of ['allowProviderCaching', 'allowBatchRetention', 'allowProviderTools', 'allowThirdPartyTools'] as const) if (values.some(value => value[key] === false)) result[key] = false;
  return result;
}

/** @internal Inspect protocol containers, never user text or arbitrary tool-return JSON. */
export function hasProviderBoundState(items: readonly InputItem[]): boolean {
  const boundBlock = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const block = value as Record<string, unknown>;
    if (block.type === 'provider_state' || block.type === 'compaction' || block.type === 'reasoning') return true;
    if (block.signature || block.thoughtSignature || block.encrypted_content || block.encryptedContent || block.providerMetadata) return true;
    if (block.type === 'tool_use' && block.providerItemId) return true;
    return false;
  };
  return items.some(item => item.type === 'message' ? item.content.some(boundBlock)
    : item.type !== 'function_call_output' && item.type !== 'custom_tool_call_output' || boundBlock(item));
}
