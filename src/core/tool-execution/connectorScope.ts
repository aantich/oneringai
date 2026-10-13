import type { IConnectorRegistry } from '../../domain/interfaces/IConnectorRegistry.js';
import type { Connector } from '../Connector.js';
import { ConnectorNotFoundError } from '../../domain/errors/AIErrors.js';

/** Bind synchronous registry reads to the authority visible at admission. No credentials copied. */
export function captureConnectorScope(source: IConnectorRegistry): IConnectorRegistry {
  const entries = new Map<string, Connector>();
  const errors = new Map<string, unknown>();
  // Resolve while the host's principal/ambient tenant is still the admitting one.
  for (const name of source.list()) {
    try { entries.set(name, source.get(name)); } catch (error) { errors.set(name, error); }
  }
  const get = (name: string): Connector => {
    if (errors.has(name)) throw errors.get(name);
    const connector = entries.get(name);
    if (!connector) throw new ConnectorNotFoundError(`Connector '${name}' not found in execution scope`);
    return connector;
  };
  const all = (): Connector[] => [...entries.keys(), ...errors.keys()].map(get);
  return {
    get,
    has: name => entries.has(name) || (errors.has(name) && !(errors.get(name) instanceof ConnectorNotFoundError)),
    list: () => [...entries.keys(), ...errors.keys()],
    listAll: all,
    size: () => entries.size + errors.size,
    getDescriptionsForTools: () => all().map(c => `  - "${c.name}": ${c.displayName} - ${c.config.description || 'No description'}`).join('\n') || 'No connectors registered yet.',
    getInfo: () => Object.fromEntries(all().map(c => [c.name, { displayName: c.displayName, description: c.config.description || '', baseURL: c.baseURL }])),
    ...(source.getById ? { getById: (id: string): Connector => {
      const connector = [...entries.values()].find(c => c.id === id);
      if (!connector) throw new ConnectorNotFoundError(`Connector ID '${id}' not found in execution scope`);
      return connector;
    } } : {}),
  };
}

/** Conservative equality for background delivery; changed authority discards old results. */
export function sameConnectorScope(captured: IConnectorRegistry | undefined, current: IConnectorRegistry | undefined): boolean {
  if (!captured || !current) return captured === current;
  try {
    const names = captured.list();
    const next = captureConnectorScope(current);
    if (names.length !== next.size()) return false;
    return names.every(name => {
      try { return captured.get(name) === next.get(name); } catch { return false; }
    });
  } catch { return false; }
}
