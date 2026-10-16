import { Agent, createAgentPreset, InMemoryEvidenceStorage, BasePluginNextGen } from '@everworker/oneringai';
import type { AgentPresetName, AgentPresetConfig, AgentCapabilityInspection, AgentConfig, ITextProvider, ModelCapabilities, IContextStorage, EvidenceScope, SerializedContextState } from '@everworker/oneringai';
const name: AgentPresetName = 'workflow';
const scope = { ownerId: 'host-user', namespace: 'workflow' };
export const supplied: AgentPresetConfig = { connector: 'main', model: 'gpt-4o-mini', userId: scope.ownerId,
  context: { plugins: { evidence: { scope, storage: new InMemoryEvidenceStorage({ scope }) }, taskState: { scope, taskId: 'T42' } } }, loopPolicy: null };
export const resolved: AgentConfig = createAgentPreset(name, supplied);
export function inspect(agent: Agent): AgentCapabilityInspection { return agent.inspectCapabilities(); }
// Existing creation and snapshot/storage/event contracts remain valid in the older fixtures.

// Structurally valid extension/provider instances retain their getter receivers.
class PluginSettings { [key: string]: unknown; #limit = 7; get limit() { return this.#limit; } }
class GetterCapabilities implements ModelCapabilities {
  get supportsTools() { return true; } get supportsVision() { return false; }
  get supportsJSON() { return true; } get supportsJSONSchema() { return false; } get maxTokens() { return 128000; }
}
export const pluginSettings = new PluginSettings();
export const capabilityProvider: Pick<ITextProvider, 'getModelCapabilities'> = { getModelCapabilities: () => new GetterCapabilities() };
export const normalized = createAgentPreset('workflow', { ...supplied, context: { ...supplied.context, userId: undefined, plugins: { ...supplied.context?.plugins, extension: pluginSettings } } });
export function resumeWithAutosave(storage: IContextStorage) { return Agent.resume('saved', { ...resolved, session: { storage, autoSave: true, autoSaveIntervalMs: 60000 } }); }


class GetterScope implements EvidenceScope {
  get ownerId() { return 'host-user'; }
  get namespace() { return 'getter-workflow'; }
  get tenantId() { return 'tenant'; }
}
const getterScope = new GetterScope();
export const getterScopedPreset = createAgentPreset('workflow', { connector: 'main', model: 'gpt-4o-mini', userId: getterScope.ownerId,
  context: { plugins: { evidence: { scope: getterScope, storage: new InMemoryEvidenceStorage({ scope: getterScope }) }, taskState: { scope: getterScope, taskId: 'T42' } } } });
export function resumeCallerContext(agent: Agent, storage: IContextStorage) { return Agent.resume('saved', { connector: 'main', model: 'gpt-4o-mini', context: agent.context, session: { storage, autoSave: true } }); }
export function existingAndDeferredSnapshots(agent: Agent, state: SerializedContextState) {
  return Promise.all([agent.context.save('existing', undefined, state), agent.context.save('deferred', undefined, async () => state)]);
}

// The existing plugin contract is JSON serialization, including conversion hooks.
export class JsonExtension extends BasePluginNextGen {
  readonly name = 'json_extension'; private value = 'host';
  getInstructions() { return null; } async getContent() { return null; } getContents() { return null; }
  override getState() { const value = this.value; return { toJSON() { return { value }; } }; }
  override restoreState(state: unknown) { this.value = (state as { value: string }).value; }
}
export function installJsonExtension(agent: Agent) { agent.context.registerPlugin(new JsonExtension()); }
