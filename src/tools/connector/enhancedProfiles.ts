import { containAsyncRejection } from '../../core/evidence/validation.js';
import { randomUUID } from 'node:crypto';
import { Connector, type ConnectorFetchOptions } from '../../core/Connector.js';
import { createOutcomeTool } from '../../core/createOutcomeTool.js';
import { createExecutionSignal, withAbort } from '../../core/tool-execution/cancellation.js';
import { connectorInvocation, markConnectorExecution, markConnectorPolicyDenial } from '../../core/connector-execution/profile.js';
import { attachConnectorAttempts, type ConnectorTransportAttempt } from '../../core/connector-execution/attempts.js';
import { InvalidConfigError, ToolPermissionDeniedError, ToolTimeoutError } from '../../domain/errors/AIErrors.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { ConnectorToolsOptions, ServiceToolFactory } from './ConnectorTools.js';
import { bindEnhancedConnector, enhancedConnectorResult } from './enhancedInvocation.js';
import { detectServiceFromURL } from '../../domain/entities/Services.js';
import { sanitizeToolName } from '../../utils/sanitize.js';
import { collectionContract } from './pages/contract.js';
import { createCursorCodec } from '../../core/connector-execution/cursors.js';

export interface EnhancedConnectorAttempt extends ConnectorTransportAttempt {
  readonly connector: string;
  readonly toolName: string;
  readonly accountId?: string;
  readonly invocationId: string;
  readonly requestId: string;
}
export interface EnhancedConnectorOptions extends ConnectorToolsOptions {
  profile: string;
  userId?: string;
  /** Whole invocation deadline, default connector timeout or 30s; zero disables it. */
  timeoutMs?: number;
  /** Counts physical transport attempts, distinct from logical pages/model calls. */
  onAttempt?(attempt: EnhancedConnectorAttempt): void;
}

type Effect = 'read' | 'write' | 'unknown';
const inventories: Record<string, Readonly<Record<string, Effect>>> = {
  microsoft: { create_draft_email: 'write', send_email: 'write', create_meeting: 'write', edit_meeting: 'write', get_meeting_transcript: 'read', list_meetings: 'read', get_meeting: 'read', find_meeting_slots: 'read', read_file: 'read', list_files: 'read', search_files: 'read' },
  'google-api': { create_draft_email: 'write', send_email: 'write', create_meeting: 'write', edit_meeting: 'write', get_meeting_transcript: 'read', list_meetings: 'read', get_meeting: 'read', find_meeting_slots: 'read', read_file: 'read', list_files: 'read', search_files: 'read' },
  slack: { list_channels: 'read', get_channel_info: 'read', set_channel_topic: 'write', get_messages: 'read', get_thread: 'read', post_message: 'write', search_messages: 'read', get_mentions: 'read', add_reaction: 'write', get_users: 'read' },
  github: { search_files: 'read', search_code: 'read', read_file: 'read', list_branches: 'read', get_pr: 'read', pr_files: 'read', pr_comments: 'read', create_pr: 'write' },
};
const bundled = new Map<string, ServiceToolFactory>();
/** Only bundled registration modules call this private manifest seam. */
export function registerEnhancedFactory(service: string, factory: ServiceToolFactory): void { bundled.set(service, factory); }
const bodyFields = new Set(['markdown', 'content', 'transcript', 'text', 'body', 'snippet', 'patch', 'description']);
/** Only the acknowledged evidence middleware can replace a source with this view. */
function projectRead(value: unknown): string {
  const omitted = new Set<string>();
  const visit = (input: unknown, depth: number): unknown => {
    if (!input || typeof input !== 'object' || depth > 8) return input;
    if (Array.isArray(input)) return input.map(item => visit(item, depth + 1));
    return Object.fromEntries(Object.entries(input).filter(([key, child]) => {
      if (bodyFields.has(key) && typeof child === 'string') { omitted.add(key); return false; }
      return true;
    }).map(([key, child]) => [key, visit(child, depth + 1)]));
  };
  const metadata = visit(value, 0);
  return JSON.stringify({ view: 'source_reference', metadata, omittedBodyFields: [...omitted].sort(), requiresEvidenceRead: omitted.size > 0 });
}
const deny = (name: string, reason: string): never => { const error = new ToolPermissionDeniedError(name, reason); markConnectorPolicyDenial(error); throw error; };
const fail = (message: string): never => { throw new InvalidConfigError(`Enhanced connectors: ${message}`); };

/** Keep generic credentials on their admitted origin, including each redirect hop. */
async function fetchGenericRedirects(endpoint: string, options: ConnectorFetchOptions, baseURL: string, name: string,
  dispatch: (url: string, request: ConnectorFetchOptions) => Promise<Response>): Promise<Response> {
  const base = baseURL.replace(/\/+$/, ''), origin = new URL(base).origin;
  let url = new URL(endpoint.startsWith('http') ? endpoint : `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);
  let request: ConnectorFetchOptions = { ...options, redirect: 'manual' };
  for (let redirects = 0; ; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
      return deny(name, 'Enhanced generic API credentials are restricted to the configured connector origin');
    }
    const response = await dispatch(url.href, request), location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || location === null) return response;
    // Release the intermediate body and its operation timer before another request.
    if (response.body) await withAbort(response.body.cancel(), request.signal);
    if (redirects >= 20) return fail('generic API redirect limit exceeded');
    url = new URL(location, response.url || url.href);
    const method = (request.method ?? 'GET').toUpperCase();
    if ((response.status === 301 || response.status === 302) && method === 'POST'
      || response.status === 303 && method !== 'GET' && method !== 'HEAD') {
      const headers = new Headers(request.headers);
      for (const field of ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length']) headers.delete(field);
      request = { ...request, method: 'GET', body: undefined, headers: Object.fromEntries(headers) };
    }
  }
}

/** Fixed C4 inventory; never falls back to an unreviewed custom/legacy factory. */
export function buildEnhancedTools(connector: Connector, service: string, currentFactory: ServiceToolFactory | undefined,
  options: EnhancedConnectorOptions, generic: (connector: Connector, name: string) => ToolFunction,
  bindAccount: (tool: ToolFunction) => ToolFunction): ToolFunction[] {
  options = { ...options };
  if (!['execution-v1', 'collections-v1'].includes(options.profile)) return fail(`unsupported profile ${String(options.profile)}`);
  const factory = bundled.get(service), inventory = inventories[service];
  if (!factory || !inventory || factory !== currentFactory) return fail('profile requires an audited bundled Microsoft, Google, Slack or GitHub factory; custom overrides remain on the legacy path');
  if (options.accountId !== undefined && (typeof options.accountId !== 'string' || !options.accountId.trim())) return fail('accountId must be a nonempty host-selected string');
  if (options.profile === 'collections-v1' && (connector.name.includes(':') || options.accountId?.includes(':'))) return fail('collections-v1 catalog identity aliases cannot contain a colon');
  if (options.onAttempt !== undefined && typeof options.onAttempt !== 'function') return fail('onAttempt must be a host callback');
  const timeout = options.timeoutMs ?? connector.config.timeout ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2_147_483_647) return fail('timeoutMs must be a nonnegative supported timer integer');
  const prefix = options.accountId ? `${sanitizeToolName(connector.name)}_${sanitizeToolName(options.accountId)}` : sanitizeToolName(connector.name);
  const factoryOptions = { ...(options.actAs !== undefined ? { actAs: options.actAs } : {}) };
  const originals = factory(connector, options.userId, factoryOptions);
  const names = originals.map(tool => tool.definition.function.name);
  if (new Set(names).size !== names.length || names.length !== Object.keys(inventory).length || names.some(name => !(name in inventory))) return fail(`bundled ${service} inventory no longer matches execution-v1`);
  if (connector.baseURL) originals.push(generic(connector, 'api'));
  const directCodec = options.profile === 'collections-v1' ? createCursorCodec() : undefined;
  const contracts = new Map(originals.map(original => [original.definition.function.name, directCodec ? collectionContract(service, original, options) : undefined]));
  const selected = originals.map(original => {
    const operation = original.definition.function.name, effect = inventory[operation] ?? 'unknown';
    const collection = contracts.get(operation);
    const name = `${prefix}_${operation}_${collection?.suffix ?? 'exec'}`;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return fail(`tool name exceeds provider constraints: ${name}`);
    const definition = structuredClone(original.definition); definition.function.name = name; definition.timeout = timeout;
    if (collection) { definition.function.parameters = collection.parameters; definition.function.description = collection.description; }
    const resolve = (context?: ToolContext): Connector => {
      const current = options.registry ? options.registry.get(connector.name) : Connector.get(connector.name);
      const scoped = context?.connectorRegistry?.get(connector.name);
      if (scoped && scoped !== current) return deny(name, 'Selected and invocation connector scopes disagree');
      const currentService = current.config.serviceType ?? (current.baseURL ? detectServiceFromURL(current.baseURL) : current.vendor);
      if (currentService !== service) return fail('connector service changed; reconstruct the selected profile before dispatch');
      return current;
    };
    if (definition.function.description) for (const base of names) definition.function.description = definition.function.description.replace(new RegExp(`\\b${base}\\b`, 'g'), `${prefix}_${base}_${contracts.get(base)?.suffix ?? 'exec'}`);
    const tool = createOutcomeTool({ ...original, definition, output: { ...original.output, effect, ...(effect === 'read' ? { expectedSize: 'large' as const, summarize: projectRead } : {}) },
      execute: async (args, invocation) => {
        const admission = connectorInvocation(invocation.context);
        if (admission && 'error' in admission) throw admission.error;
        const initial = admission ? admission.value as Connector : resolve(invocation.context);
        if (operation === 'api') {
          const endpoint: unknown = args?.endpoint;
          if (typeof endpoint !== 'string' || !initial.baseURL) return fail('generic endpoint and current baseURL are required');
          if (args.headers && typeof args.headers === 'object' && Object.keys(args.headers).some(key => key.toLowerCase() === 'host')) return deny(name, 'The configured connector controls the HTTP host');
          const base = initial.baseURL.replace(/\/+$/, '');
          const url = new URL(endpoint.startsWith('http') ? endpoint : `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);
          if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(base).origin || url.username || url.password) {
            return deny(name, 'Enhanced generic API credentials are restricted to the configured connector origin');
          }
        }
        const joined = createExecutionSignal([invocation.context?.signal]);
        const timer = timeout > 0 ? setTimeout(() => joined.controller.abort(new ToolTimeoutError(name, timeout)), timeout) : undefined;
        const invocationId = randomUUID();
        const proxy = new Proxy(initial, { get(target, property) {
          if (property === 'fetch') return async (endpoint: string, requestOptions?: ConnectorFetchOptions, userId?: string, accountId?: string) => {
            joined.controller.signal.throwIfAborted();
            const signal = requestOptions?.signal ? AbortSignal.any([joined.controller.signal, requestOptions.signal]) : joined.controller.signal;
            const request: ConnectorFetchOptions = { ...requestOptions, signal, timeoutScope: 'operation', retryPolicy: 'safe',
              ...(effect !== 'read' ? { skipRetry: true } : {}) };
            const dispatch = (url: string, selected: ConnectorFetchOptions): Promise<Response> => {
              const requestId = randomUUID(), outgoing = { ...selected };
              attachConnectorAttempts(outgoing, attempt => {
                try { containAsyncRejection(options.onAttempt?.(Object.freeze({ ...attempt, connector: connector.name, toolName: name,
                  ...(accountId ? { accountId } : {}), invocationId, requestId }))); } catch { /* Diagnostic observer only. */ }
              });
              return initial.fetch(url, outgoing, userId, accountId);
            };
            return operation === 'api' ? fetchGenericRedirects(endpoint, request, initial.baseURL!, name, dispatch) : dispatch(endpoint, request);
          };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        const unbind = bindEnhancedConnector(proxy, error => invocation.reportFailure(joined.controller.signal.reason instanceof ToolTimeoutError ? joined.controller.signal.reason : error));
        try {
          joined.controller.signal.throwIfAborted();
          const execute = collection ? (args: unknown, context?: ToolContext) => collection.execute(proxy, args, context, admission?.codec ?? directCodec!, invocation)
            : operation === 'api' ? generic(proxy, 'api').execute
            : factory(proxy, options.userId, factoryOptions).find(tool => tool.definition.function.name === operation)?.execute;
          if (!execute) return fail('audited operation is unavailable');
          return enhancedConnectorResult(proxy, await execute(args, invocation.context));
        } finally { clearTimeout(timer); joined.dispose(); unbind(); }
      },
    });
    const bound = bindAccount(tool); markConnectorExecution(bound, { version: 1, profile: options.profile, timeoutMs: timeout, prepare: resolve }); bound.connectorName = connector.name;
    if (options.accountId) bound.connectorAccountId = options.accountId;
    return bound;
  });
  if (new Set(selected.map(tool => tool.definition.function.name)).size !== selected.length) return fail('tool name collision');
  return selected;
}
