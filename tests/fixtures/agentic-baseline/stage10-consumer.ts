import { Agent } from '@everworker/oneringai';
import type { AgentConfig, AgentLoopPolicy, AgentLoopDiagnostics, AgentLoopCheckContext, AgentLoopCompletionResult, AgentLoopObservation, AgentLoopReason, LLMResponse, StreamEvent, HelperCallOptions } from '@everworker/oneringai';
import type { AgentLoopPolicy as TypesPolicy, AgentLoopDiagnostics as TypesDiagnostics } from '@everworker/oneringai/types';
const completion = (context: Readonly<AgentLoopCheckContext>): AgentLoopCompletionResult => ({ complete: context.observations.some(o => o.outcome?.status === 'succeeded') });
const policy: AgentLoopPolicy & TypesPolicy = { completion, maxRecoveryAttempts: 1, progressKey: context => String(context.taskState?.revision ?? 0) };
const config: AgentConfig = { connector: 'main', model: 'gpt-4o-mini', loopPolicy: policy };
async function consume(agent: Agent): Promise<AgentLoopDiagnostics | TypesDiagnostics | undefined> {
  const response: LLMResponse = await agent.run('chat', { loopPolicy: null });
  const reason: AgentLoopReason | undefined = response.loop?.reason;
  const observations: readonly AgentLoopObservation[] = [];
  void [reason, observations, config];
  for await (const event of agent.stream('verify', { loopPolicy: policy })) {
    const oldEvent: StreamEvent = event;
    if (oldEvent.type === 'response.complete' || oldEvent.type === 'response.iteration.complete') void oldEvent.loop;
  }
  return agent.getLoopDiagnostics();
}
void consume;

// Structural policies retain prototype callbacks and their private host receiver.
class HostPolicy implements AgentLoopPolicy, TypesPolicy {
  #verified = false;
  progressKey() { return String(this.#verified); }
  completion() { return { complete: this.#verified }; }
  verify() { this.#verified = true; }
}
const classConfig: AgentConfig = { ...config, loopPolicy: new HostPolicy() };
void classConfig;
const helperOptions: HelperCallOptions = { schema: { type: 'object' }, validationSchema: { type: 'object', minProperties: 1 } };
void helperOptions;
