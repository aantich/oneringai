import { AGENT_PACKAGE_PROTOCOL_VERSION, AGENT_PACKAGE_OUTCOME_PROTOCOL, AgentPackageOutcomeServer, createAgentPackageOutcomeTools, hydrateAgentPackageWithOutcomes } from '@everworker/oneringai';
import type { RemoteOutcomeTransport, RemoteOutcomeReport, OutcomeAgentPackage, SerializedAgentPackage } from '@everworker/oneringai';
const oldWire: 2 = AGENT_PACKAGE_PROTOCOL_VERSION;
const nextWire: 'oneringai.tool-outcomes/1' = AGENT_PACKAGE_OUTCOME_PROTOCOL;
declare const envelope: OutcomeAgentPackage;
// @ts-expect-error The new envelope cannot silently downgrade to v2.
const old: SerializedAgentPackage = envelope;
declare const report: RemoteOutcomeReport;
const external: 'external_unknown' = report.accounting;
// @ts-expect-error All five authenticated transport responsibilities are mandatory.
const incomplete: RemoteOutcomeTransport = { execute: async () => ({ receipt: {}, hasResult: false }) };
void oldWire; void nextWire; void AgentPackageOutcomeServer; void createAgentPackageOutcomeTools; void hydrateAgentPackageWithOutcomes; void old; void external; void incomplete;
