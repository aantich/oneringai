import { AgentSessionRecoveryError, AgentEventHistoryExpiredError } from 'oneringai/agent-runtime';
import type { AgentRuntime, AgentRun, AgentRunInput, AgentEventSubscriptionOptions, RuntimeRunOptions, RuntimeAgentDefinition, RuntimeSessionOptions, RuntimeSession, RuntimeSessionReference, JsonObject } from 'oneringai/agent-runtime';
import { commandObject, runtimeHelp, runtimeReference, runtimeRun } from './commands.js';

/** Trusted main-process bootstrap. Executable credentials/tools stay outside UI messages. */
export interface AmosRuntimeHost {
  runtime: AgentRuntime;
  definition: RuntimeAgentDefinition;
  options: RuntimeSessionOptions;
  resume?: RuntimeSessionReference;
  /** Host-owned reference persistence; stores a locator, never credentials or workflow authority. */
  saveReference?: (reference: RuntimeSessionReference | undefined) => void | Promise<void>;
}
export type AmosRuntimeView = { type: string; data: unknown };

/** One UI adapter for every harness, separate from native Agent.context commands. */
export class AmosRuntimeController {
  private session?: RuntimeSession;
  private active?: AgentRun;
  private pending?: Promise<void>;
  private reference?: RuntimeSessionReference;
  private opening = false;
  private admitting = false;
  private observation = 0;
  private closed = false;
  constructor(private readonly host: AmosRuntimeHost, private readonly render: (view: AmosRuntimeView) => void) { this.reference = host.resume; }
  async open(): Promise<void> {
    if (this.closed) throw new Error('Runtime controller is closed');
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
      await this.remember(this.session.reference());
      const state = await this.session.inspectState(); this.render({ type: 'state', data: state });
      if (state.activeRunId) this.observe(await this.session.getRun(state.activeRunId));
    } catch (error) {
      if (error instanceof AgentSessionRecoveryError) {
        try { await this.remember(error.reference); } catch { /* remember already reports persistence failure with the original reference. */ }
        this.render({ type: 'recovery-required', data: { reference: this.reference, runId: error.runId, message: String(error) } });
      }
      throw error;
    } finally { this.opening = false; }
  }
  private async remember(reference?: RuntimeSessionReference): Promise<void> {
    this.reference = reference;
    this.render({ type: reference ? 'session' : 'reference-cleared', data: reference ?? null });
    try { await this.host.saveReference?.(reference); }
    catch (error) { this.render({ type: 'reference-save-error', data: { reference: reference ?? null, message: String(error) } }); throw error; }
  }
  async input(line: string): Promise<void> {
    if (this.closed) throw new Error('Runtime controller is closed');
    if (!line.trim()) return;
    if (!line.trimStart().startsWith('/')) { await this.start(line); return; }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(line.trim())!;
    const command = match[1]!; const argument = match[2] ?? '';
    if (command === '/help') { this.noArgument(argument); this.render({ type: 'help', data: runtimeHelp }); return; }
    if (command === '/exit') { this.noArgument(argument); await this.close(); return; }
    if (command === '/reference') { this.noArgument(argument); this.render({ type: 'reference', data: this.reference ?? null }); return; }
    if (command === '/save') {
      this.noArgument(argument);
      if (!this.host.saveReference) throw new Error('Reference persistence requires a host saveReference callback; use /reference to copy the locator');
      await this.remember(this.reference); this.render({ type: 'reference-saved', data: this.reference ?? null }); return;
    }
    if (command === '/resume' || command === '/new') {
      if (this.opening || this.admitting) throw new Error('Runtime observer/run admission is active');
      if (command === '/new') this.noArgument(argument);
      const requested = argument ? runtimeReference(argument) : this.reference;
      if (this.session) {
        if (command !== '/resume' || argument || this.session.state !== 'failed') throw new Error('Detach or delete the attached session before opening another observer');
        await this.detach();
      }
      if (command === '/new') await this.remember(); else if (requested) await this.remember(requested);
      await this.open(); return;
    }
    if (command === '/delete') {
      if (this.opening || this.admitting) throw new Error('Runtime observer/run admission is active');
      const reference = argument ? runtimeReference(argument) : this.reference;
      if (!reference) throw new Error('No runtime reference to delete');
      if (this.session && reference.id !== this.reference?.id) throw new Error('Detach the attached session before deleting another reference');
      try {
        await this.host.runtime.deleteSession(reference, { context: this.host.options.context });
        this.render({ type: 'deleted', data: reference });
        if (reference.id === this.reference?.id) { this.observation++; this.active = undefined; this.session = undefined; await this.remember(); }
      } catch (error) {
        if (this.session?.isDestroyed) { this.observation++; this.active = undefined; this.session = undefined; }
        throw error;
      }
      return;
    }
    if (!this.session) throw new Error('Runtime observer is detached; use /resume');
    if (command === '/inspect') { this.noArgument(argument); this.render({ type: 'inspection', data: this.session.capabilities }); return; }
    if (command === '/status') { this.noArgument(argument); this.render({ type: 'state', data: await this.session.inspectState() }); return; }
    if (command === '/stop') { this.noArgument(argument); await this.session.cancelActiveRun('AMOS explicit stop'); return; }
    if (command === '/detach') { this.noArgument(argument); await this.detach(); return; }
    if (command === '/run') { const request = runtimeRun(argument); await this.start(request.input, request.options); return; }
    if (command === '/result') {
      if (!argument || /\s/.test(argument)) throw new Error('Usage: /result <run-id>');
      this.render({ type: 'result', data: await (await this.session.getRun(argument)).result }); return;
    }
    if (command === '/observe') {
      const value = commandObject(argument, ['runId', 'afterSequence'], '/observe {"runId":"run_...","afterSequence":123}');
      if (typeof value.runId !== 'string' || !value.runId.trim() || (value.afterSequence !== undefined && (!Number.isSafeInteger(value.afterSequence) || Number(value.afterSequence) < 0))) throw new Error('Observe requires a runId and optional nonnegative integer afterSequence');
      if (this.active && this.active.id !== value.runId) throw new Error('A different runtime turn is already being observed');
      this.observe(await this.session.getRun(value.runId), value.afterSequence === undefined ? undefined : { afterSequence: Number(value.afterSequence) }); return;
    }
    if (command === '/upload') {
      const value = commandObject(argument, ['path', 'name', 'mediaType'], '/upload {"path":"input.txt","mediaType":"text/plain"}');
      if (typeof value.path !== 'string' || typeof value.mediaType !== 'string' || (value.name !== undefined && typeof value.name !== 'string')) throw new Error('Upload requires path/mediaType strings and an optional name');
      this.render({ type: 'upload', data: await this.session.uploadFile({ path: value.path, mediaType: value.mediaType, ...(typeof value.name === 'string' ? { name: value.name } : {}) }) }); return;
    }
    if (command === '/download') {
      const value = commandObject(argument, ['reference', 'path'], '/download {"reference":"scoped-reference","path":"answer.txt"}');
      if (typeof value.path !== 'string' || typeof value.reference !== 'string') throw new Error('Download requires reference/path strings');
      this.render({ type: 'download', data: await this.session.downloadArtifact({ path: value.path, reference: value.reference }) }); return;
    }
    throw new Error('Command is unavailable in runtime mode; use /help. Native Agent state cannot be edited through an external harness.');
  }
  private noArgument(argument: string): void { if (argument) throw new Error('This command accepts no arguments; use /help'); }
  private async start(input: AgentRunInput, options?: RuntimeRunOptions): Promise<void> {
    if (!this.session) throw new Error('Runtime observer is detached; use /resume');
    if (this.admitting || this.opening || (this.active && !options?.requestId)) throw new Error('A runtime turn/observer is already active');
    this.admitting = true;
    try {
      const run = await this.session.run(input, options);
      this.render({ type: 'run', data: { runId: run.id, sessionId: run.sessionId, requestId: options?.requestId ?? null, alreadyObserved: this.active?.id === run.id } });
      if (this.active && this.active.id !== run.id) { this.render({ type: 'result', data: await run.result }); return; }
      if (this.active?.id !== run.id) this.observe(run);
    } finally { this.admitting = false; }
  }
  private async detach(): Promise<void> {
    await this.session!.detach(); this.observation++; this.session = undefined; this.active = undefined;
    this.render({ type: 'detached', data: this.reference });
  }
  private observe(run: AgentRun, options?: AgentEventSubscriptionOptions): void {
    const generation = ++this.observation; this.active = run;
    const display = (view: AmosRuntimeView) => { if (generation === this.observation) this.render(view); };
    const events = (async () => {
      try { for await (const event of run.events(options)) { if (generation !== this.observation) break; display({ type: 'activity', data: event }); } }
      catch (error) {
        display(error instanceof AgentEventHistoryExpiredError
          ? { type: 'activity-gap', data: { runId: run.id, message: String(error) } }
          : { type: 'observation-error', data: String(error) });
      }
    })();
    const pending = (async () => {
      try { display({ type: 'result', data: await run.result }); }
      catch (error) { display({ type: 'recovery-required', data: { reference: this.reference, runId: run.id, message: String(error) } }); }
      finally { await events; if (generation === this.observation) this.active = undefined; }
    })();
    this.pending = pending;
  }
  async wait(): Promise<void> { await this.pending; }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.session) { await this.session.cancelActiveRun('AMOS exit'); await this.pending; await this.session.destroy(); }
    } finally { this.observation++; this.session = undefined; this.active = undefined; await this.host.runtime.destroy(); }
  }
  snapshot(): JsonObject { return { reference: this.reference ? { ...this.reference } : null, activeRunId: this.active?.id ?? null, attached: !!this.session }; }
}
