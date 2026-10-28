import { ConnectorTools } from '@everworker/oneringai';
import type { Agent, EnhancedConnectorOptions, EnhancedConnectorAttempt, ConnectorAcceptedResource } from '@everworker/oneringai';
export function selected(agent: Agent, connector: string): void {
  const attempts: EnhancedConnectorAttempt[] = [];
  const options: EnhancedConnectorOptions = { profile: 'execution-v1', accountId: 'work', timeoutMs: 5000, onAttempt: value => { attempts.push(value); } };
  agent.tools.registerConnectorTools(connector, ConnectorTools.enhanced(connector, options), { accountId: 'work' });
  const accepted: ConnectorAcceptedResource = { kind: 'reply_draft', id: 'accepted-id', state: 'accepted' };
  void accepted; void attempts;
}
// @ts-expect-error Explicit profile selection is mandatory.
ConnectorTools.enhanced('service', {});
