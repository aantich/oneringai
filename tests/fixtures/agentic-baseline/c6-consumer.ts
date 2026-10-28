import { createOrchestratorWithFactory, AGENT_PACKAGE_PROTOCOL_VERSION } from '@everworker/oneringai';
import type { AgentConstructionRequest, OrchestratedAgentConfig, ChildObservation } from '@everworker/oneringai';
const configure = (request: AgentConstructionRequest): OrchestratedAgentConfig => ({ ...request.baseline, temperature: 0, asyncTools: { autoContinue: false } });
declare const report: ChildObservation;
const role: string = report.parentExecutionId;
void role; void configure; void createOrchestratorWithFactory;
const oldWire: 2 = AGENT_PACKAGE_PROTOCOL_VERSION; void oldWire;
// @ts-expect-error A live tool manager is library-owned even through a variable.
const bad: OrchestratedAgentConfig = { connector: 'main', model: 'main', toolManager: {} };
void bad;
