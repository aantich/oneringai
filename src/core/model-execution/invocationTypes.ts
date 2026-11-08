import type { ModelAttemptRecord } from './types.js';
/** Private invocation ownership, shared by the ledger and host transport binding. */
export interface InvocationState {
  signal: AbortSignal;
  beginTransport(): ModelAttemptRecord;
  endTransport(attempt: ModelAttemptRecord, status?: number): void;
}
