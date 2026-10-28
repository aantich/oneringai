import type { Connector } from '../../../core/Connector.js';
import type { ToolContext } from '../../../domain/interfaces/IToolContext.js';
import type { ProviderPage, Coverage } from './types.js';
import { InvalidConfigError } from '../../../domain/errors/AIErrors.js';

export type PageArgs = Record<string, any>;
export interface PageRequest {
  service: string;
  connector: Connector; args: PageArgs; context?: ToolContext; userId?: string; actAs?: string;
  previous?: unknown;
  observe?(source: unknown): void;
}
export type PageReader = (request: PageRequest) => Promise<ProviderPage>;
export const badPage = (message: string): never => { throw new InvalidConfigError(`Collection page: ${message}`); };
export function rows(value: unknown, field: string): any[] { if (!Array.isArray(value)) return badPage(`provider omitted ${field} array`); return value; }
export function total(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) >= 0 ? value as number : undefined; }
export function coverage(previous: Coverage | undefined, current: Coverage): Coverage {
  if (previous === 'incomplete' || current === 'incomplete') return 'incomplete';
  if (previous === 'unknown' || current === 'unknown') return 'unknown';
  return 'complete';
}
export function pageToken(value: unknown, present: boolean): Pick<ProviderPage, 'next' | 'end' | 'unknown'> {
  if (!present || value === '') return { end: true };
  return typeof value === 'string' && value.trim() ? { next: value } : { unknown: 'provider_position_unusable' };
}
/** Validate nextLink without decoding or reconstructing its opaque query. */
export function nextURL(connector: Connector, candidate: unknown, firstEndpoint: string): string {
  if (typeof candidate !== 'string' || !candidate.trim() || !connector.baseURL) return badPage('provider position is not a URL');
  const base = connector.baseURL.replace(/\/+$/, ''), expected = new URL(base + (firstEndpoint.startsWith('/') ? '' : '/') + firstEndpoint);
  const next = new URL(candidate);
  if (!['http:', 'https:'].includes(next.protocol) || next.origin !== expected.origin || next.pathname !== expected.pathname || next.username || next.password || next.hash) return badPage('provider continuation origin/path changed');
  return candidate;
}
/** Connector remains the only authenticated transport; one provider request per call. */
export async function fetchPage(request: PageRequest, endpoint: string, params: Record<string, unknown> = {}, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<{ data: any; headers: Headers }> {
  const query = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const url = endpoint + (query.size ? (endpoint.includes('?') ? '&' : '?') + query.toString() : '');
  request.context?.signal?.throwIfAborted();
  const response = await request.connector.fetch(url, { method: options.body === undefined ? 'GET' : 'POST', signal: request.context?.signal,
    headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }, request.context?.userId ?? request.userId, request.context?.accountId);
  const text = await response.text();
  let data: unknown; try { data = JSON.parse(text); } catch { request.observe?.({ body: text }); return badPage(`provider returned invalid JSON (HTTP ${response.status})`); }
  request.observe?.({ body: data, ...(response.headers.has('link') ? { link: response.headers.get('link') } : {}) });
  if (!response.ok) throw new Error(`Collection request failed (HTTP ${response.status})`);
  if (request.service === 'slack' && (data as { ok?: unknown })?.ok !== true) throw new Error(`Slack collection request failed: ${String((data as { error?: unknown })?.error ?? 'unknown_error')}`);
  return { data, headers: response.headers };
}
