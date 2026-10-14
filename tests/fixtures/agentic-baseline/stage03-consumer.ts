/** Compile against built public package; feature/config/storage APIs remain additive. */
import { Agent, EvidencePluginNextGen, FileEvidenceStorage, InMemoryEvidenceStorage, StorageRegistry, ToolEvidenceMiddleware, ToolManager } from '@everworker/oneringai';
import type { EvidenceScope, EvidencePluginConfig, ToolEvidenceConfig, ToolFunction, ToolOutputHints, ToolExecutionOutcome, ToolExecutionReport, ToolResultEvidence, ToolResult, IEvidenceStorage } from '@everworker/oneringai';
const scope: EvidenceScope = { ownerId: 'consumer', namespace: 'task' };
const memory: IEvidenceStorage = new InMemoryEvidenceStorage({ scope });
const file: IEvidenceStorage = new FileEvidenceStorage({ directory: '/tmp/consumer-evidence', scope, durability: 'restart' });
const config: EvidencePluginConfig = { storage: file, maxRecentReceipts: 20 };
StorageRegistry.configure({ evidence: requested => new InMemoryEvidenceStorage({ scope: requested }) });
const hints: ToolOutputHints = { expectedSize: 'large', effect: 'read', summarize: value => String(value) };
const tool: ToolFunction = { definition: { type: 'function', function: { name: 'consumer', parameters: { type: 'object', properties: {} } } }, execute: async () => ({ id: 'result' }), output: hints };
const manager = new ToolManager(); manager.setEvidenceMiddleware(new ToolEvidenceMiddleware({ storage: memory })); manager.register(tool);
const report: Promise<ToolExecutionReport> = manager.executeWithOutcome('consumer', {});
const legacy: ToolExecutionOutcome = { executionId: 'e', toolName: 'consumer', status: 'succeeded', executionStarted: true, completion: 'settled', cancellation: 'none', startedAt: 1, durationMs: 1 };
const persistence: ToolResultEvidence = { version: 1, status: 'storage_failed' };
const plugin = new EvidencePluginNextGen({ storage: memory });
const agent = Agent.create({ connector: 'existing', model: 'gpt-4o-mini', context: { model: 'gpt-4o-mini', features: { evidence: true }, plugins: { evidence: config } } });
void [report, legacy, persistence, plugin, agent];

// Previously accepted arbitrary external-plugin config under feature key evidence stays valid.
const legacyContext: Parameters<typeof Agent.create>[0]['context'] = {
  model: 'gpt-4o-mini', features: { evidence: true }, plugins: { evidence: { storage: 'legacy-storage-name' } },
};
void legacyContext;

void file.getReference?.('00000000-0000-4000-8000-000000000000');

// Optional capacity hints preserve adapters that implement the original storage interface.
const serializationLimit: number | undefined = memory.serializationLimitBytes;
const boundedEvidence: ToolEvidenceConfig = { storage: memory, maxSerializationBytes: 65536 };
const legacyStore: IEvidenceStorage = {
  scope, durability: 'process', put: memory.put.bind(memory), read: memory.read.bind(memory),
  readRecord: memory.readRecord.bind(memory), list: memory.list.bind(memory),
  delete: memory.delete.bind(memory), pruneExpired: memory.pruneExpired.bind(memory),
};
void [serializationLimit, boundedEvidence, legacyStore];

// Authentic delivery preserves failed-write retention without making outcome mandatory.
async function admitDeliveryOnly(): Promise<void> {
  const observation = await report;
  const result: ToolResult = { tool_use_id: 'call', content: observation.result, evidence: observation.evidence, state: 'completed' as ToolResult['state'] };
  agent.context.addToolResults([result]);
  const snapshot = await agent.getContextState();
  agent.context.restoreState(snapshot);
}
void admitDeliveryOnly;
