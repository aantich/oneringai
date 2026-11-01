import type { AgentRuntime, AgentRun, RuntimeAgentDefinition, RuntimeSessionOptions, RuntimeSession, RuntimeSessionReference, JsonObject } from '@everworker/oneringai/agent-runtime';

/** Trusted main-process bootstrap. Executable credentials/tools stay outside UI messages. */
export interface AmosRuntimeHost {
  runtime: AgentRuntime;
  definition: RuntimeAgentDefinition;
  options: RuntimeSessionOptions;
  resume?: RuntimeSessionReference;
}
export type AmosRuntimeView = { type: string; data: unknown };

/** One UI adapter for every harness, separate from native Agent.context commands. */
export class AmosRuntimeController {
  private session?: RuntimeSession;
  private active?: AgentRun;
  private pending?: Promise<void>;
  private reference?: RuntimeSessionReference;
  private opening = false;
  constructor(private readonly host: AmosRuntimeHost, private readonly render: (view: AmosRuntimeView) => void) { this.reference = host.resume; }
  async open(): Promise<void> {
    if (this.opening || this.session) throw new Error('Runtime observer is already opening/attached');
    this.opening = true;
    try {
      const agent = this.host.runtime.createAgent(this.host.definition);
      if (this.reference) {
        this.session = await this.host.runtime.resumeSession(this.reference, { context: this.host.options.context, observation: this.host.options.observation });
        this.render({ type: 'inspection', data: this.session.capabilities });
      } else {
        this.render({ type: 'inspection', data: await agent.inspect(this.host.options) });
        this.session = await agent.openSession(this.host.options);
      }
      this.reference = this.session.reference(); this.render({ type: 'session', data: this.reference });
      const state = await this.session.inspectState(); this.render({ type: 'state', data: state });
      if (state.activeRunId) this.observe(await this.session.getRun(state.activeRunId));
    } finally { this.opening = false; }
  }
  async input(line: string): Promise<void> {
    if (line === '/help') { this.render({ type: 'help', data: '/inspect /status /stop /detach /resume /exit; ordinary text starts a turn. Native context/routing/routine/helper/tool mutation commands require the standard AMOS mode.' }); return; }
    if (line === '/resume') { await this.open(); return; }
    if (line === '/exit') { await this.close(); return; }
    if (!this.session) throw new Error('Runtime observer is detached; use /resume');
    if (line === '/inspect') { this.render({ type: 'inspection', data: this.session.capabilities }); return; }
    if (line === '/status') { this.render({ type: 'state', data: await this.session.inspectState() }); return; }
    if (line === '/stop') { await this.session.cancelActiveRun('AMOS explicit stop'); return; }
    if (line === '/detach') { await this.session.detach(); this.session = undefined; this.active = undefined; this.render({ type: 'detached', data: this.reference }); return; }
    if (line.startsWith('/')) throw new Error('Command is unavailable in runtime mode; use /help. Native Agent state cannot be edited through an external harness.');
    if (this.active || this.opening) throw new Error('A runtime turn/observer is already active');
    this.observe(await this.session.run(line));
  }
  private observe(run: AgentRun): void {
    this.active = run;
    const events = (async () => { try { for await (const event of run.events()) this.render({ type: 'activity', data: event }); } catch (error) { this.render({ type: 'observation-error', data: String(error) }); } })();
    const pending = (async () => {
      try { this.render({ type: 'result', data: await run.result }); }
      catch (error) { this.render({ type: 'recovery-required', data: { reference: this.reference, runId: run.id, message: String(error) } }); }
      finally { await events; if (this.active === run) this.active = undefined; }
    })();
    this.pending = pending;
  }
  async wait(): Promise<void> { await this.pending; }
  async close(): Promise<void> {
    try {
      if (this.session) {
        await this.session.cancelActiveRun('AMOS exit');
        await this.pending;
        await this.session.destroy();
      }
    } finally { this.session = undefined; this.active = undefined; await this.host.runtime.destroy(); }
  }
  snapshot(): JsonObject { return { reference: this.reference ? { ...this.reference } : null, activeRunId: this.active?.id ?? null, attached: !!this.session }; }
}
