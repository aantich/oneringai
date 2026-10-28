import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { CursorCodec } from './cursors.js';

/** Private additive hint carried only by explicitly selected connector tools. */
export interface ConnectorExecutionHint {
  readonly version: 1; readonly profile: string; readonly timeoutMs: number;
  /** Synchronous authority capture before pipeline hooks can yield. */
  readonly prepare?: (context: ToolContext) => unknown;
}
const PROFILE = Symbol.for('@everworker/oneringai/connector-execution/v1');
export function markConnectorExecution(tool: object, hint: ConnectorExecutionHint): void {
  Object.defineProperty(tool, PROFILE, { value: Object.freeze({ ...hint }) });
}

const INVOCATION = Symbol.for('@everworker/oneringai/connector-invocation/v1');
type Admission = Readonly<({ value: unknown } | { error: unknown }) & { codec?: CursorCodec }>;
export function prepareConnectorInvocation(tool: object, context: ToolContext, codec?: CursorCodec): void {
  const prepare = connectorExecutionHint(tool)?.prepare;
  if (!prepare) return;
  let admission: Admission;
  try { admission = { value: prepare(context) }; } catch (error) { admission = { error }; }
  // Account binding copies this invocation-local context using object spread.
  Object.defineProperty(context, INVOCATION, { value: Object.freeze({ ...admission, codec }), enumerable: true });
}
export function connectorInvocation(context: ToolContext | undefined): Admission | undefined {
  return context ? Object.getOwnPropertyDescriptor(context, INVOCATION)?.value as Admission | undefined : undefined;
}
export function connectorExecutionHint(tool: object): ConnectorExecutionHint | undefined {
  try {
    const value = Object.getOwnPropertyDescriptor(tool, PROFILE)?.value as ConnectorExecutionHint | undefined;
    return value?.version === 1 && typeof value.profile === 'string' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 0 ? value : undefined;
  } catch { return undefined; }
}

const DENIAL = Symbol.for('@everworker/oneringai/connector-policy-denial/v1');
export function markConnectorPolicyDenial(error: Error): void { Object.defineProperty(error, DENIAL, { value: true }); }
export function isConnectorPolicyDenial(error: unknown): boolean {
  try { return !!error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, DENIAL)?.value === true; } catch { return false; }
}
