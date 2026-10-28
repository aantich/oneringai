import { Agent, ConnectorTools, AGENT_PACKAGE_PROTOCOL_VERSION } from '@everworker/oneringai';
import type { ConnectorPage, PagePosition } from '@everworker/oneringai';
const selected = ConnectorTools.enhanced('service', { profile: 'collections-v1', accountId: 'work' });
declare const agent: Agent;
agent.tools.registerConnectorTools('service', selected, { accountId: 'work' });
const position: PagePosition = { state: 'unknown', reason: 'provider did not supply a position' };
const page: ConnectorPage<{ id: string }> = { items: [{ id: 'one' }], returnedCount: 1, searchCoverage: 'unknown', position };
const protocol: 2 = AGENT_PACKAGE_PROTOCOL_VERSION;
void page; void protocol;
// @ts-expect-error exhaustion and corpus coverage are separate states
const invalid: PagePosition = { state: 'complete' };
void invalid;
