import { containAsyncRejection } from '../evidence/validation.js';
/** Private per-request transport observation; no endpoint, headers or credentials. */
export interface ConnectorTransportAttempt {
  readonly attempt: number;
  readonly state: 'dispatched' | 'received' | 'failed';
  readonly method: string;
  readonly startedAt: number;
  readonly durationMs?: number;
  readonly httpStatus?: number;
}
const ATTEMPTS = Symbol.for('@everworker/oneringai/connector-attempts/v1');
export function attachConnectorAttempts(options: object, observer: (attempt: ConnectorTransportAttempt) => void): void {
  Object.defineProperty(options, ATTEMPTS, { value: observer });
}
export function connectorAttemptObserver(options: object | undefined): ((attempt: ConnectorTransportAttempt) => void) | undefined {
  try {
    const callback: unknown = options && Object.getOwnPropertyDescriptor(options, ATTEMPTS)?.value;
    return typeof callback === 'function' ? value => { try { containAsyncRejection(callback(value)); } catch { /* Diagnostics cannot repeat a transport operation. */ } } : undefined;
  } catch { return undefined; } // Legacy RequestInit proxies need not support private metadata reflection.
}
