import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { AuthIdentity } from '../context-nextgen/types.js';
import type { OrchestratedAgentConfig } from './factoryTypes.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';

const opaqueKeys = new Set(['connector', 'registry', 'storage', 'compactionStrategy', 'estimator', 'tokenEstimator']);
const plain = (value: unknown): value is Record<PropertyKey, unknown> => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const badFactoryConfig = (message: string): never => { throw new InvalidConfigError(`Orchestrator factory: ${message}`); };

/** Detach option containers, retaining executable tools, callbacks and backend handles. */
export function detachFactoryConfig<T>(source: T): T {
  const seen = new WeakMap<object, unknown>();
  const copy = (value: unknown, key?: PropertyKey): unknown => {
    if (!value || typeof value !== 'object' || typeof key === 'string' && opaqueKeys.has(key)) return value;
    // ToolFunction is an executable host handle: preserve its receiver and identity.
    if (plain(value) && typeof value.execute === 'function' && value.definition) return value;
    if (plain(value) && typeof value.evaluate === 'function' && typeof value.name === 'string') return value;
    const known = seen.get(value); if (known) return known;
    if (Array.isArray(value)) { const array: unknown[] = []; seen.set(value, array); for (const item of value) array.push(copy(item)); return array; }
    if (!plain(value)) return value;
    const result: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(value)); seen.set(value, result);
    for (const name of Reflect.ownKeys(value)) Object.defineProperty(result, name, { value: copy(value[name], name), enumerable: true, configurable: true, writable: true });
    return result;
  };
  return copy(source) as T;
}

function identitySignature(identities: AuthIdentity[] | undefined): string {
  if (!identities) return '(unrestricted)';
  return JSON.stringify(identities.map(identity => [identity.connector, identity.accountId ?? null, identity.actAs ?? null,
    identity.toolFilter ? [...identity.toolFilter].sort() : null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function checkFactoryConfig(input: unknown, requiredNames: ReadonlySet<string>): OrchestratedAgentConfig {
  if (!plain(input)) return badFactoryConfig('configureAgent must return a plain complete Agent configuration');
  for (const key of ['toolManager', 'name', 'parentAgentId']) if (Object.hasOwn(input, key)) return badFactoryConfig(`${key} is library-owned on this entry point`);
  if (input.context !== undefined && !plain(input.context)) return badFactoryConfig('context must be a plain configuration, not a live context');
  const result = detachFactoryConfig(input) as unknown as OrchestratedAgentConfig;
  if (!result.connector || typeof result.model !== 'string' || !result.model.trim()) return badFactoryConfig('connector and model are required in the returned complete configuration');
  const context = result.context;
  if (context?.userId !== undefined && context.userId !== result.userId) return badFactoryConfig('context.userId must agree with the Agent userId authority');
  if (context?.identities !== undefined && identitySignature(context.identities) !== identitySignature(result.identities)) return badFactoryConfig('context.identities must agree with Agent identities');
  if (context?.plugins?.sharedWorkspace !== undefined) return badFactoryConfig('the shared workspace is library-owned; configure it through OrchestratorConfig.workspace');
  const names = new Set(requiredNames);
  const tools = (value: unknown, label: string): ToolFunction[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return badFactoryConfig(`${label} must be a tool array`);
    for (const tool of value) {
      const name = tool?.definition?.function?.name;
      if (typeof name !== 'string' || !name || typeof tool.execute !== 'function') return badFactoryConfig(`${label} contains an invalid local tool`);
      if (names.has(name)) return badFactoryConfig(`tool name collision before construction: ${name}`);
      names.add(name);
    }
    return value;
  };
  tools(context?.tools, 'context.tools'); tools(result.tools, 'tools');
  return result;
}
