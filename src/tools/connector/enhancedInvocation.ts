import type { Connector } from '../../core/Connector.js';

// Exact explicit proxy identity, never ambient Agent state or payload inspection.
export interface ConnectorAcceptedResource { readonly kind: 'reply_draft'; readonly id: string; readonly state: 'accepted' }
const reporters = new WeakMap<object, { report(error: Error): void; accepted: ConnectorAcceptedResource[] }>();
export function bindEnhancedConnector(connector: Connector, report: (error: Error) => void): () => void {
  reporters.set(connector, { report, accepted: [] }); return () => { reporters.delete(connector); };
}
/** Called only at owning factories' explicit failure-return branches. Legacy is a no-op. */
export function connectorFailure<T extends { error?: unknown }>(connector: Connector, result: T): T {
  const invocation = reporters.get(connector);
  if (invocation) {
    const error = result.error instanceof Error ? result.error : new Error(typeof result.error === 'string' ? result.error : 'Connector operation failed');
    try { invocation.report(error); } catch { /* The already produced raw result must remain observable. */ }
  }
  return result;
}

/** Known accepted resource at an owning multi-write boundary, not final completion. */
export function connectorAcceptance(connector: Connector, resource: ConnectorAcceptedResource): void {
  const invocation = reporters.get(connector);
  if (invocation) {
    if (typeof resource.id !== 'string' || !resource.id.trim()) throw new Error('Reply draft response lacks a usable ID; reconcile the accepted operation before another write');
    invocation.accepted.push(Object.freeze({ ...resource }));
  }
}
export function enhancedConnectorResult(connector: Connector, result: unknown): unknown {
  const accepted = reporters.get(connector)?.accepted;
  return accepted?.length && result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result, acceptedResources: accepted.map(value => ({ ...value })) } : result;
}
