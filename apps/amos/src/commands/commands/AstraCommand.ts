/**
 * AstraCommand - OpenAI GPT-6 Astra protocol demos for AMOS.
 */

import {
  ContentType,
  MessageRole,
  OpenAIResponsesWebSocketSession,
  OpenAISafetyAPI,
  getModelInfo,
  type InputItem,
  type ResponsesServerEvent,
} from 'oneringai';
import { BaseCommand } from '../BaseCommand.js';
import type {
  AstraReasoningEffort,
  CommandContext,
  CommandResult,
  IAmosApp,
} from '../../config/types.js';

const ASTRA_MODEL = 'gpt-6-astra';
const ASTRA_EFFORTS = new Set<AstraReasoningEffort>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export class AstraCommand extends BaseCommand {
  readonly name = 'astra';
  readonly aliases = ['gpt6'];
  readonly description = 'Use and demonstrate GPT-6 Astra APIs';
  readonly usage = '/astra [status|use|ask|reasoning|async|live|steer|alert|close]';

  private directResponseId: string | null = null;
  private directStateKey: string | null = null;
  private liveSession: OpenAIResponsesWebSocketSession | null = null;
  private liveResponseId: string | null = null;
  private awaitingSuccessor = false;
  private liveHasText = false;

  get detailedHelp(): string {
    return `
/astra - GPT-6 Astra Support and API Demonstrations

USAGE:
  /astra status                         Show Astra readiness and capabilities
  /astra use                            Switch the active agent to gpt-6-astra
  /astra ask <prompt>                   Start a stored Responses continuation
  /astra reasoning <effort> <prompt>    Continue with configuration_update
  /astra async <tool> <prompt>          Run an async tool and return its call_id result
  /astra live <prompt>                  Start a WebSocket response in the background
  /astra steer <instruction>            Steer the active WebSocket response mid-turn
  /astra alert <alert_id>               Retrieve an OpenAI safety alert
  /astra close                          Close the live WebSocket response

REASONING EFFORTS:
  low, medium, high, xhigh, max (Astra does not support none or minimal)

EXAMPLES:
  /astra use
  /astra ask Compare two migration strategies briefly
  /astra reasoning high Now evaluate the riskiest edge cases
  /astra async web_fetch Fetch the OneRingAI npm page and summarize it
  /astra live Write a detailed launch plan for a developer tool
  /astra steer Focus only on the rollout and rollback strategy

The /astra ask + /astra reasoning flow uses previous_response_id so the
configuration update preserves the stored prompt prefix. The live demo is
text-only; close it before switching connectors or models.
`;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const [subcommand = 'status', ...args] = context.args;
    switch (subcommand.toLowerCase()) {
      case 'status':
      case 'info':
        return this.showStatus(context);
      case 'use':
        return this.useAstra(context);
      case 'ask':
        return this.ask(context, args);
      case 'reasoning':
      case 'reason':
        return this.changeReasoning(context, args);
      case 'async':
        return this.runAsyncTool(context, args);
      case 'live':
        return this.startLive(context, args);
      case 'steer':
        return this.steer(context, args);
      case 'alert':
        return this.retrieveAlert(context, args);
      case 'close':
        this.close();
        return this.success('Closed the Astra WebSocket session.');
      default:
        return this.error(`Unknown Astra action '${subcommand}'. Use /help astra.`);
    }
  }

  close(): void {
    const session = this.liveSession;
    this.liveSession = null;
    this.liveResponseId = null;
    this.awaitingSuccessor = false;
    this.liveHasText = false;
    session?.close(1000, 'AMOS closed the Astra demo');
  }

  /** Drop protocol state when AMOS replaces the underlying Agent. */
  reset(): void {
    this.close();
    this.resetDirectState();
  }

  private showStatus(context: CommandContext): CommandResult {
    const { app } = context;
    const config = app.getConfig();
    const info = getModelInfo(ASTRA_MODEL);
    const connector = config.activeConnector
      ? app.getConnectorManager().get(config.activeConnector)
      : null;
    const features = info?.features;
    const lines = [
      'GPT-6 Astra in AMOS:',
      '',
      `  Active connector: ${config.activeConnector ?? '(none)'}`,
      `  OpenAI connector: ${connector?.vendor === 'openai' ? 'yes' : 'no'}`,
      `  Active model: ${config.activeModel ?? config.defaults.model}`,
      `  Astra active: ${(config.activeModel ?? config.defaults.model) === ASTRA_MODEL ? 'yes' : 'no'}`,
      `  Availability: ${info?.availability ?? 'unknown'}`,
      `  Reasoning effort: ${app.getAgent()?.getReasoningEffort() ?? config.defaults.reasoningEffort}`,
      '',
      'Protocol support:',
      `  ${features?.asyncToolCalling ? '✓' : '✗'} Async tool calling (/astra async)`,
      `  ${features?.midTurnSteering ? '✓' : '✗'} Mid-turn steering (/astra live, /astra steer)`,
      `  ${features?.configurationUpdates ? '✓' : '✗'} In-band reasoning updates (/astra ask, /astra reasoning)`,
      `  ${features?.misalignmentMonitoring ? '✓' : '✗'} Safety alert lookup (/astra alert)`,
      '',
      'Use /astra use to activate Astra, then /help astra for demos.',
    ];
    return this.success(lines.join('\n'));
  }

  private async useAstra(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const connectorError = this.requireOpenAIConnector(app);
    if (connectorError) return this.error(connectorError);

    this.reset();
    app.updateConfig({ activeModel: ASTRA_MODEL, activeVendor: 'openai' });
    await app.createAgent();
    await app.saveConfig();
    return this.success(
      `Switched to ${ASTRA_MODEL} with ${app.getAgent()?.getReasoningEffort() ?? 'medium'} reasoning.`,
    );
  }

  private async ask(context: CommandContext, args: string[]): Promise<CommandResult> {
    const prompt = args.join(' ').trim();
    if (!prompt) return this.error('Prompt required. Usage: /astra ask <prompt>');
    const readiness = this.requireReadyAstra(context.app);
    if (readiness) return this.error(readiness);

    const effort = this.getConfiguredAstraEffort(context.app);
    const response = await context.app.getAgent()!.runAstraDirect(prompt, { effort });
    this.directResponseId = response.responseId;
    this.directStateKey = this.getStateKey(context.app);
    return this.success(
      `${response.text || '[No text output]'}\n\n[Response: ${response.responseId}; reasoning: ${effort}]`,
    );
  }

  private async changeReasoning(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const effort = args[0] as AstraReasoningEffort | undefined;
    const prompt = args.slice(1).join(' ').trim();
    if (!effort || !ASTRA_EFFORTS.has(effort)) {
      return this.error('Effort must be one of: low, medium, high, xhigh, max.');
    }
    if (!prompt) {
      return this.error('Prompt required. Usage: /astra reasoning <effort> <prompt>');
    }
    const readiness = this.requireReadyAstra(context.app);
    if (readiness) return this.error(readiness);
    if (!this.directResponseId || this.directStateKey !== this.getStateKey(context.app)) {
      return this.error('Start a stored continuation first with /astra ask <prompt>.');
    }

    const input: InputItem[] = [
      { type: 'configuration_update', reasoning: { effort } },
      {
        type: 'message',
        role: MessageRole.USER,
        content: [{ type: ContentType.INPUT_TEXT, text: prompt }],
      },
    ];
    const response = await context.app.getAgent()!.runAstraDirect(input, {
      previousResponseId: this.directResponseId,
    });
    this.directResponseId = response.responseId;
    return this.success(
      `${response.text || '[No text output]'}\n\n[Response: ${response.responseId}; reasoning updated to ${effort}]`,
    );
  }

  private async runAsyncTool(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const toolName = args[0];
    const prompt = args.slice(1).join(' ').trim();
    if (!toolName || !prompt) {
      return this.error('Usage: /astra async <enabled-tool> <prompt>');
    }
    const readiness = this.requireReadyAstra(context.app);
    if (readiness) return this.error(readiness);

    const response = await context.app.getAgent()!.runAstraAsyncTool(toolName, prompt);
    const initial = response.initialText ? `${response.initialText}\n\n` : '';
    return this.success([
      `${initial}${response.text || '[No final text output]'}`,
      '',
      `[Async tool: ${response.toolName}; call_id: ${response.callId}; ${response.duration}ms]`,
    ].join('\n'));
  }

  private async startLive(context: CommandContext, args: string[]): Promise<CommandResult> {
    const prompt = args.join(' ').trim();
    if (!prompt) return this.error('Prompt required. Usage: /astra live <prompt>');
    const readiness = this.requireReadyAstra(context.app);
    if (readiness) return this.error(readiness);
    if (this.liveSession) {
      return this.error('A live Astra response is already active. Use /astra close first.');
    }

    const connectorName = context.app.getConfig().activeConnector!;
    const session = new OpenAIResponsesWebSocketSession({ connector: connectorName });
    this.liveSession = session;
    this.liveResponseId = null;
    this.awaitingSuccessor = false;
    this.liveHasText = false;
    session.on('event', (event) => this.handleLiveEvent(context.app, session, event));
    session.on('error', (error) => this.failLive(context.app, session, error.message));
    session.on('close', (_code, reason) => {
      if (this.liveSession !== session) return;
      this.clearLiveState();
      if (reason && reason !== 'OK') context.app.printDim(`[Astra WebSocket closed: ${reason}]`);
    });

    try {
      await session.connect();
      session.createResponse({
        model: ASTRA_MODEL,
        input: prompt,
        reasoning: { effort: this.getConfiguredAstraEffort(context.app) },
        max_output_tokens: context.app.getConfig().defaults.maxOutputTokens,
      });
    } catch (error) {
      this.failLive(
        context.app,
        session,
        error instanceof Error ? error.message : String(error),
      );
      return this.error('Could not start the Astra WebSocket response.');
    }

    return this.success(
      'Astra is responding over WebSocket. Use /astra steer <instruction> while it is working.',
    );
  }

  private steer(context: CommandContext, args: string[]): CommandResult {
    const instruction = args.join(' ').trim();
    if (!instruction) return this.error('Instruction required. Usage: /astra steer <instruction>');
    if (!this.liveSession || !this.liveResponseId) {
      return this.error('No steerable Astra response is active. Start one with /astra live.');
    }
    if (this.awaitingSuccessor) {
      return this.error('A steering update is already pending; wait for the successor response.');
    }

    this.liveSession.steer(this.liveResponseId, instruction);
    this.awaitingSuccessor = true;
    return this.success(`Steering response ${this.liveResponseId}...`);
  }

  private async retrieveAlert(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const alertId = args[0]?.trim();
    if (!alertId) return this.error('Alert ID required. Usage: /astra alert <alert_id>');
    const connectorError = this.requireOpenAIConnector(context.app);
    if (connectorError) return this.error(connectorError);

    const alert = await new OpenAISafetyAPI(
      context.app.getConfig().activeConnector!,
    ).retrieveAlert(alertId);
    return this.success([
      `Safety alert: ${alert.id}`,
      `  Model: ${alert.model}`,
      `  Type: ${alert.error_type}`,
      `  Reason: ${alert.reason ?? '(hidden by data-retention policy)'}`,
      `  Request: ${alert.request_id}`,
      `  Response: ${alert.response_id}`,
      `  Request paused: ${alert.request_paused ? 'yes' : 'no'}`,
    ].join('\n'));
  }

  private handleLiveEvent(
    app: IAmosApp,
    session: OpenAIResponsesWebSocketSession,
    event: ResponsesServerEvent,
  ): void {
    if (this.liveSession !== session) return;
    switch (event.type) {
      case 'response.created': {
        const previousId = this.liveResponseId;
        this.liveResponseId = event.response.id;
        if (this.awaitingSuccessor && previousId && previousId !== event.response.id) {
          this.awaitingSuccessor = false;
          app.printDim(`\n[Astra applied steering in successor ${event.response.id}]`);
        }
        break;
      }
      case 'response.output_text.delta':
        if (!this.liveHasText) {
          app.write('\n');
          this.liveHasText = true;
        }
        app.write(event.delta);
        break;
      case 'response.steer.accepted':
        app.printDim(`\n[Steering accepted: ${event.steer.id}]`);
        break;
      case 'response.steer.pending':
        app.printDim('\n[Steering is waiting for required tool output or approval]');
        break;
      case 'response.steer.failed':
        this.awaitingSuccessor = false;
        app.printError(`Astra steering failed (${event.error.code}): ${event.error.message}`);
        break;
      case 'response.incomplete':
        if (event.response.incomplete_details?.reason === 'steered') {
          app.printDim('\n[Original response stopped at a safe boundary; awaiting successor]');
        } else {
          this.finishLive(app, session, `incomplete: ${event.response.incomplete_details?.reason ?? 'unknown'}`);
        }
        break;
      case 'response.completed':
        if (!this.awaitingSuccessor) this.finishLive(app, session, `completed: ${event.response.id}`);
        break;
      case 'response.failed':
        this.failLive(app, session, event.response.error?.message ?? 'OpenAI response failed');
        break;
      case 'error':
        this.failLive(app, session, 'message' in event ? event.message : event.error.message);
        break;
    }
  }

  private finishLive(
    app: IAmosApp,
    session: OpenAIResponsesWebSocketSession,
    status: string,
  ): void {
    if (this.liveSession !== session) return;
    if (this.liveHasText) app.write('\n');
    app.printDim(`[Astra WebSocket ${status}]`);
    this.clearLiveState();
    session.close(1000, 'OK');
  }

  private failLive(
    app: IAmosApp,
    session: OpenAIResponsesWebSocketSession,
    message: string,
  ): void {
    if (this.liveSession !== session) return;
    if (this.liveHasText) app.write('\n');
    app.printError(`Astra WebSocket: ${message}`);
    this.clearLiveState();
    session.close(1011, 'Astra response failed');
  }

  private clearLiveState(): void {
    this.liveSession = null;
    this.liveResponseId = null;
    this.awaitingSuccessor = false;
    this.liveHasText = false;
  }

  private requireOpenAIConnector(app: IAmosApp): string | null {
    const connectorName = app.getConfig().activeConnector;
    if (!connectorName) return 'No active connector. Configure one with /connector add.';
    const connector = app.getConnectorManager().get(connectorName);
    if (connector?.vendor !== 'openai') {
      return `Active connector '${connectorName}' is not an OpenAI connector.`;
    }
    return null;
  }

  private requireReadyAstra(app: IAmosApp): string | null {
    const connectorError = this.requireOpenAIConnector(app);
    if (connectorError) return connectorError;
    if ((app.getConfig().activeModel ?? app.getConfig().defaults.model) !== ASTRA_MODEL) {
      return `Astra is not active. Run /astra use first.`;
    }
    if (!app.getAgent()?.isReady()) return 'The AMOS agent is not initialized.';
    return null;
  }

  private getConfiguredAstraEffort(app: IAmosApp): AstraReasoningEffort {
    const effort = app.getConfig().defaults.reasoningEffort;
    return ASTRA_EFFORTS.has(effort as AstraReasoningEffort)
      ? effort as AstraReasoningEffort
      : 'medium';
  }

  private getStateKey(app: IAmosApp): string {
    const config = app.getConfig();
    return `${config.activeConnector ?? ''}:${config.activeModel ?? config.defaults.model}`;
  }

  private resetDirectState(): void {
    this.directResponseId = null;
    this.directStateKey = null;
  }
}
