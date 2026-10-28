import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { AuthIdentity } from '../context-nextgen/types.js';
import type { ConnectorCategoryInfo } from '../ToolCatalogRegistry.js';
import type { ToolManager } from '../ToolManager.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import { connectorExecutionHint } from './profile.js';
import { createCursorCodec, type CursorCodec } from './cursors.js';

const STATE = Symbol.for('@everworker/oneringai/connector-manager/v1');
interface Selection { profile: string; connector: string; accountId?: string; tools: ToolFunction[]; revision: number }
interface State { codec: CursorCodec; categories: Map<string, Selection>; revision: number }
function state(manager: object, create = false): State | undefined {
  let value: State | undefined;
  try { value = Object.getOwnPropertyDescriptor(manager, STATE)?.value as State | undefined; }
  catch { if (!create) return undefined; throw new InvalidConfigError('Enhanced selection cannot inspect this ToolManager'); }
  if (!value && create) {
    value = { codec: createCursorCodec(), categories: new Map(), revision: 0 };
    try { Object.defineProperty(manager, STATE, { value }); }
    catch { throw new InvalidConfigError('Enhanced catalog selection requires an extensible ToolManager'); }
  }
  return value;
}
export function selectionCategory(connector: string, accountId?: string): string { return `connector:${connector}${accountId ? ':' + accountId : ''}`; }
export function checkConnectorSelection(manager: ToolManager, connector: string, accountId: string | undefined, tools: ToolFunction[]): void {
  const profile = connectorExecutionHint(tools[0]!)?.profile;
  const old = state(manager)?.categories.get(selectionCategory(connector, accountId));
  if (old && (old.connector !== connector || old.accountId !== accountId)) throw new InvalidConfigError('Enhanced connector category identity collision');
  if (old && old.profile !== profile) throw new InvalidConfigError('Use one enhanced profile per connector/account in a ToolManager');
  if (profile === 'collections-v1') for (const name of manager.list()) {
    const registration = manager.getRegistration(name), selected = registration && connectorExecutionHint(registration.tool);
    if (registration?.source === selectionCategory(connector, accountId) && registration.tool.connectorName !== undefined
      && (registration.tool.connectorName !== connector || registration.tool.connectorAccountId !== accountId)) throw new InvalidConfigError('Enhanced connector category identity collision');
    if (registration?.source === selectionCategory(connector, accountId) && selected && selected.profile !== profile) throw new InvalidConfigError('Use one enhanced profile per connector/account in a ToolManager');
  }
}
export function registerConnectorSelection(manager: ToolManager, connector: string, accountId: string | undefined, tools: ToolFunction[]): void {
  if (!tools.length || connectorExecutionHint(tools[0]!)?.profile !== 'collections-v1') return;
  const value = state(manager, true)!, category = selectionCategory(connector, accountId);
  const names = new Set(tools.map(tool => tool.definition.function.name));
  value.categories.set(category, { profile: connectorExecutionHint(tools[0]!)!.profile, connector, accountId, tools: [...tools], revision: ++value.revision });
  // Only the selected identity's aliases are replaced; global factories/cache stay intact.
  // Disabled aliases must not reappear through a later enable or catalog load either.
  for (const name of manager.list()) {
    const old = manager.getRegistration(name);
    if (old?.source === category && !names.has(name)) manager.unregister(name);
  }
}
export function managerCursorCodec(manager: object): CursorCodec { return state(manager, true)!.codec; }
export function resetConnectorSelections(manager: object): void { const value = state(manager); if (value) { value.categories.clear(); value.codec = createCursorCodec(); value.revision++; } }
export function captureConnectorSelections(manager: object): () => void {
  const before = state(manager), codec = before?.codec, categories = new Map(before?.categories);
  return () => {
    const value = state(manager); if (!value) return;
    value.categories.clear(); value.codec = codec ?? createCursorCodec();
    for (const [name, selection] of categories) value.categories.set(name, { ...selection, revision: ++value.revision });
  };
}
export function selectedConnectorCategories(manager: object, identities?: AuthIdentity[]): Array<ConnectorCategoryInfo & { revision: number }> {
  const value = state(manager); if (!value) return [];
  return [...value.categories].flatMap(([name, selected]) => {
    const identity = identities?.find(id => id.connector === selected.connector && id.accountId === selected.accountId);
    if (identities?.length && !identity) return [];
    const tools = identity?.toolFilter?.length ? selected.tools.filter(tool => identity.toolFilter!.some(suffix => tool.definition.function.name === suffix || tool.definition.function.name.endsWith('_' + suffix))) : selected.tools;
    return [{ name, displayName: selected.connector + (selected.accountId ? ` (${selected.accountId})` : ''), description: `Selected ${selected.profile} connector tools`, toolCount: tools.length, tools,
      accountId: selected.accountId, revision: selected.revision }];
  });
}
