import type { ToolContext, ToolFunction, ToolExecutionOutcome, ToolExecutionOptions } from '../../domain/entities/Tool.js';
import type { EvidenceReference, EvidenceRecord, IEvidenceStorage } from '../../domain/interfaces/IEvidenceStorage.js';
import type { AgentContextNextGen } from '../context-nextgen/AgentContextNextGen.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';

/** Private, invocation-owned extension. No remote facts are merged into public local outcomes. */
export interface RemoteInvocationIdentity {
  readonly executionId: string;
  readonly toolName: string;
  readonly callId?: string;
  readonly runId?: string;
  readonly startedAt: number;
  readonly principal: Readonly<{ userId?: string; accountId?: string; agentId?: string }>;
}
export interface RemoteInvocationObservation {
  readonly version: 1;
  /** Actual authenticated server effect/outcome, if observed; never package hints. */
  readonly effect: 'read' | 'write' | 'unknown';
  readonly serverOutcome?: ToolExecutionOutcome;
  readonly notStarted?: boolean;
  /** Only a complete acknowledged source/sidecar may become result-bearing evidence. */
  evidenceResult(outcome: ToolExecutionOutcome, result?: { value: unknown }): { value: unknown } | undefined;
  validateEvidence(outcome: ToolExecutionOutcome, reference: EvidenceReference): Promise<boolean>;
  observeProxy(outcome: ToolExecutionOutcome, fullReference?: EvidenceReference): void;
  /** Explicit uncertainty guard, including unacknowledged sidecar persistence. */
  issue(): Error | undefined;
}
type ProxyFactory = (identity: RemoteInvocationIdentity, context: ToolContext, manager: object) => RemoteInvocationObservation;
export interface RemoteToolOwner {
  attach(manager: object, toolName: string): void;
  detach(manager: object): void;
  issue(manager: object): Error | undefined;
  claims(executionId: string): boolean;
  hasTool(name: string): boolean;
  validateRecord(record: EvidenceRecord, reference: EvidenceReference, callId: string, signal?: AbortSignal): Promise<void>;
}
interface RemoteManager {
  version: 1;
  storage(): IEvidenceStorage | undefined;
  context?: AgentContextNextGen;
  owners: Set<RemoteToolOwner>;
  destroyed: boolean;
}
type SourceGuard = (tool: ToolFunction, context: ToolContext, effect: 'read' | 'write' | 'unknown') => void;
const PROXY = Symbol.for('@everworker/oneringai/remote-proxy/v1');
const INVOCATION = Symbol.for('@everworker/oneringai/remote-invocation/v1');
const SOURCE = Symbol.for('@everworker/oneringai/remote-source-admission/v1');
const OWNER = Symbol.for('@everworker/oneringai/remote-tool-owner/v1');
const MANAGER = Symbol.for('@everworker/oneringai/remote-manager/v1');
const agentGuards = new WeakMap<object, () => Error | undefined>();
function own<T>(value: unknown, key: symbol): T | undefined {
  try { return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value as T | undefined : undefined; }
  catch { return undefined; }
}
export function selectRemoteProxy(tool: ToolFunction, factory: ProxyFactory, owner?: RemoteToolOwner): void {
  Object.defineProperty(tool, PROXY, { value: factory, enumerable: true });
  if (owner) Object.defineProperty(tool, OWNER, { value: owner, enumerable: true });
}
/** Called synchronously at real ToolManager admission, before plugin/hooks can yield. */
export function prepareRemoteInvocation(manager: object, tool: ToolFunction, context: ToolContext, identity: RemoteInvocationIdentity): RemoteInvocationObservation | undefined {
  const factory = own<ProxyFactory>(tool, PROXY); if (!factory) return undefined;
  const invocation = factory(Object.freeze({ ...identity, principal: Object.freeze({ ...identity.principal }) }), context, manager);
  if (invocation?.version !== 1 || typeof invocation.validateEvidence !== 'function') throw new InvalidConfigError('Unsupported remote invocation companion');
  Object.defineProperty(context, INVOCATION, { value: invocation, enumerable: true });
  return invocation;
}
export function remoteInvocation(context: ToolContext | undefined): RemoteInvocationObservation | undefined { return own(context, INVOCATION); }
/** Symbol survives internal outcome/receipt copies; JSON and public field shapes stay unchanged. */
export function attachRemoteOutcome(outcome: ToolExecutionOutcome, observation: RemoteInvocationObservation | undefined): void {
  if (observation) Object.defineProperty(outcome, INVOCATION, { value: observation, enumerable: true });
}
export function remoteOutcome(outcome: ToolExecutionOutcome | undefined): RemoteInvocationObservation | undefined { return own(outcome, INVOCATION); }
export function selectRemoteSourceAdmission(options: ToolExecutionOptions, guard: SourceGuard): void { Object.defineProperty(options, SOURCE, { value: guard, enumerable: true }); }
export function assertRemoteSourceAdmission(options: ToolExecutionOptions, tool: ToolFunction, context: ToolContext, effect: 'read' | 'write' | 'unknown'): void { own<SourceGuard>(options, SOURCE)?.(tool, context, effect); }
export function registerRemoteAgentGuard(agent: object, guard: () => Error | undefined): () => void {
  agentGuards.set(agent, guard); return () => { if (agentGuards.get(agent) === guard) agentGuards.delete(agent); };
}
export function initializeRemoteManager(manager: object, storage: () => IEvidenceStorage | undefined): void {
  try { if (!own(manager, MANAGER)) Object.defineProperty(manager, MANAGER, { value: { version: 1, storage, owners: new Set(), destroyed: false } satisfies RemoteManager }); }
  catch { /* Unselected legacy nonextensible managers remain supported. */ }
}
export function bindRemoteContext(manager: object, context: AgentContextNextGen): void { const state = own<RemoteManager>(manager, MANAGER); if (state) state.context = context; }
export function remoteManagerContext(manager: object): AgentContextNextGen | undefined { return own<RemoteManager>(manager, MANAGER)?.context; }
export function remoteManagerStorage(manager: object): IEvidenceStorage | undefined { return own<RemoteManager>(manager, MANAGER)?.storage(); }
export function bindRemoteToolOwner(manager: object, tool: ToolFunction): void {
  const owner = own<RemoteToolOwner>(tool, OWNER); if (!owner) return;
  const state = own<RemoteManager>(manager, MANAGER);
  if (!state || state.destroyed) throw new InvalidConfigError('Tool manager does not support remote observation ownership');
  owner.attach(manager, tool.definition.function.name); state.owners.add(owner);
}
export function captureRemoteOwners(manager: object): () => void {
  const state = own<RemoteManager>(manager, MANAGER), previous = new Set(state?.owners ?? []);
  return () => { if (state && !state.destroyed) for (const owner of [...state.owners]) if (!previous.has(owner)) { owner.detach(manager); state.owners.delete(owner); } };
}
export function destroyRemoteManager(manager: object): void {
  const state = own<RemoteManager>(manager, MANAGER); if (!state || state.destroyed) return;
  state.destroyed = true; for (const owner of state.owners) { try { owner.detach(manager); } catch { /* Continue owned cleanup. */ } } state.owners.clear(); state.context = undefined;
}
export function hasRemoteEvidenceOwners(manager: object): boolean { return !!own<RemoteManager>(manager, MANAGER)?.owners.size; }
export async function validateRemoteEvidenceRecord(manager: object, record: EvidenceRecord, reference: EvidenceReference, callId: string, signal?: AbortSignal): Promise<void> {
  const owners = [...(own<RemoteManager>(manager, MANAGER)?.owners ?? [])], claimed = owners.filter(owner => owner.claims(record.source.executionId));
  if (claimed.length > 1) throw new InvalidConfigError('Conflicting remote observation ownership');
  if (claimed[0]) await claimed[0].validateRecord(record, reference, callId, signal);
  else if (owners.some(owner => owner.hasTool(record.source.toolName))) throw new InvalidConfigError('Remote source is missing its acknowledged admission and observation');
}
export function remoteAgentIssue(agent: object): Error | undefined {
  const explicit = agentGuards.get(agent)?.(); if (explicit) return explicit;
  for (const owner of own<RemoteManager>(agent, MANAGER)?.owners ?? []) { const issue = owner.issue(agent); if (issue) return issue; }
  return undefined;
}
export function hasRemoteAgentGuard(agent: object): boolean { return agentGuards.has(agent) || hasRemoteEvidenceOwners(agent); }
