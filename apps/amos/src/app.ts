/**
 * AmosApp - Main application class
 *
 * Ties together all components: config, connectors, tools, agent, UI.
 */

import { join } from 'node:path';
import type { ToolFunction, ApprovalDecision } from '@everworker/oneringai';
import { ProviderMisalignmentError, defaultDescribeCall } from '@everworker/oneringai';
import { ConfigManager } from './config/ConfigManager.js';
import type { AmosConfig, IAmosApp, IConnectorManager, IToolLoader, IAgentRunner, IPromptManager, ICommand, ToolApprovalContext } from './config/types.js';
import { ConnectorManager } from './connectors/ConnectorManager.js';
import { ToolLoader } from './tools/ToolLoader.js';
import { PromptManager } from './prompts/PromptManager.js';
import { AgentRunner } from './agent/AgentRunner.js';
import { describeToolOutcome } from './agent/toolOutcomes.js';
import { describeLoopDiagnostics } from './agent/loopDiagnostics.js';
import { describeRouting } from './agent/routing.js';
import { Terminal } from './ui/Terminal.js';
import {
  CommandProcessor,
  HelpCommand,
  AstraCommand,
  ModelCommand,
  VendorCommand,
  ConnectorCommand,
  ToolCommand,
  SessionCommand,
  ConfigCommand,
  PromptCommand,
  ContextCommand,
  HelpersCommand,
  RoutineCommand,
  RoutingCommand,
  PresetCommand,
  ExternalCommand,
  ClearCommand,
  ExitCommand,
  StatusCommand,
  HistoryCommand,
  PlanCommand,
} from './commands/index.js';
import { ExternalToolManager } from './tools/ExternalToolManager.js';

export class AmosApp implements IAmosApp {
  private configManager: ConfigManager;
  private connectorManager: ConnectorManager;
  private promptManager!: PromptManager;
  private toolLoader: ToolLoader;
  private agentRunner: AgentRunner | null = null;
  private terminal: Terminal;
  private commandProcessor: CommandProcessor;
  private astraCommand: AstraCommand;
  private routineCommand = new RoutineCommand();
  private dataDir: string;
  private running: boolean = false;
  private creatingAgent = false;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;

    // Initialize components
    this.configManager = new ConfigManager(dataDir);
    this.connectorManager = new ConnectorManager(join(dataDir, 'connectors'));
    this.toolLoader = new ToolLoader(join(dataDir, 'tools'));
    this.terminal = new Terminal();
    this.commandProcessor = new CommandProcessor(this);
    this.astraCommand = new AstraCommand();

    // Register commands
    this.registerCommands();
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    // Load config
    await this.configManager.load();
    const config = this.configManager.get();

    // Initialize terminal
    this.terminal.initialize();
    this.terminal.setColorEnabled(config.ui.colorOutput);

    // Initialize connector manager
    await this.connectorManager.initialize();

    // Initialize prompt manager
    this.promptManager = new PromptManager(config, join(this.dataDir, 'prompts'));
    await this.promptManager.initialize();

    // Register active connector if configured (must be done before tool loading)
    if (config.activeConnector) {
      try {
        this.connectorManager.registerConnector(config.activeConnector);
      } catch {
        // Connector might not exist anymore
        this.configManager.update({ activeConnector: null });
      }
    }

    // Register external tool connectors BEFORE tool loading
    // These connectors are required for web_search and web_scrape tools to work
    await this.registerExternalToolConnectors(config);
    const currentConfig = this.configManager.get();

    // Initialize tool loader (pass config for developer tools settings)
    this.toolLoader.setConfig(currentConfig);

    // Set up external tool manager
    const externalToolManager = new ExternalToolManager(
      currentConfig.externalTools,
      this.connectorManager
    );
    this.toolLoader.setExternalToolManager(externalToolManager);

    await this.toolLoader.initialize();
    this.toolLoader.applyConfig(currentConfig.tools.enabledTools, currentConfig.tools.disabledTools);

    // Create agent if we have an active connector
    if (currentConfig.activeConnector) {
      await this.createAgent();
    }
  }

  /**
   * Run the main REPL loop
   */
  async run(): Promise<void> {
    this.running = true;

    // Print welcome banner
    this.printBanner();

    // Check if we need initial setup
    const connectors = this.connectorManager.list();
    if (connectors.length === 0) {
      this.terminal.printWarning('\nNo connectors configured. Let\'s set one up!\n');
      await this.runInitialSetup();
    }

    // Main REPL loop
    while (this.running) {
      try {
        const input = await this.terminal.readline(this.getPrompt());

        if (input === null) {
          // EOF
          this.running = false;
          break;
        }

        const trimmed = input.trim();
        if (!trimmed) continue;

        await this.processInput(trimmed);
      } catch (error) {
        this.terminal.printError(
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Cleanup
    await this.shutdown();
  }

  /** Request a graceful stop (used by SIGINT/SIGTERM handlers). */
  stop(): void {
    this.running = false;
    this.astraCommand.reset();
    if (this.agentRunner?.isRunning()) {
      this.terminal.printDim('Cancellation requested. External operations may already have occurred or may still complete.');
    }
    this.agentRunner?.cancel();
    this.terminal.close();
  }

  /**
   * Process user input
   */
  private async processInput(input: string): Promise<void> {
    // Check if it's a command
    if (this.commandProcessor.isCommand(input)) {
      const result = await this.commandProcessor.execute(input);

      if (result.clearScreen) {
        this.terminal.clear();
      }

      if (result.message) {
        if (result.success) {
          this.terminal.print(result.message);
        } else {
          this.terminal.printError(result.message);
        }
      }

      if (result.shouldExit) {
        this.running = false;
      }

      return;
    }

    // Otherwise, send to agent
    await this.runAgent(input);
  }

  /**
   * Run the agent with input
   */
  private async runAgent(input: string): Promise<void> {
    if (!this.agentRunner || !this.agentRunner.isReady()) {
      this.terminal.printError(
        'No agent configured. Use /connector add to set up a connector first.'
      );
      return;
    }

    const config = this.configManager.get();

    try {
      if (config.ui.streamResponses) {
        // Streaming mode
        let hasOutput = false;

        for await (const event of this.agentRunner.stream(input)) {
          switch (event.type) {
            case 'text:delta':
              if (!hasOutput) {
                this.terminal.print(''); // New line before response
                hasOutput = true;
              }
              this.terminal.write(event.delta || '');
              break;

            case 'text:done':
              if (hasOutput) {
                this.terminal.print(''); // End the line
              }
              break;

            case 'tool:start':
              if (event.tool && config.ui.showTiming) {
                // Cast args to expected type (safe - args is Record<string, unknown> from library)
                const toolArgs = event.tool.args as Record<string, unknown> | string | undefined;
                const details = this.getToolDescription(event.tool.name, toolArgs);
                if (details) {
                  this.terminal.printDim(`  🔧 ${event.tool.name}: ${details}`);
                } else {
                  this.terminal.printDim(`  🔧 ${event.tool.name}...`);
                }
              }
              break;

            case 'tool:complete':
              if (event.loop) this.terminal.printDim(describeLoopDiagnostics(event.loop));
              if (event.notice) this.terminal.printWarning(event.notice);
              // Tool completed (already shown)
              break;

            case 'error':
              this.terminal.printError(event.error?.message || 'Unknown error');
              break;

            case 'done':
              if (event.routing) this.terminal.printDim(describeRouting(event.routing));
              if (event.loop) this.terminal.printDim(describeLoopDiagnostics(event.loop));
              // If execution completed but no output was shown, display a notice
              if (!hasOutput) {
                this.terminal.printDim('\n[Execution completed]');
              }
              if (config.ui.showTokenUsage && event.usage) {
                this.terminal.printDim(
                  `\n[Tokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out]`
                );
              }
              break;
          }
        }
      } else {
        // Non-streaming mode
        const spinner = this.terminal.showSpinner('Thinking...');

        try {
          const response = await this.agentRunner.run(input);
          spinner.stop();

          this.terminal.print('\n' + response.text);
          if (response.loop) this.terminal.printDim(describeLoopDiagnostics(response.loop));
          if (response.routing) this.terminal.printDim(describeRouting(response.routing));
          for (const outcome of response.toolOutcomes ?? []) {
            const description = describeToolOutcome(outcome);
            if (description) this.terminal.printError(description);
          }

          if (config.ui.showTokenUsage && response.usage) {
            this.terminal.printDim(
              `\n[Tokens: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out]`
            );
          }

          if (config.ui.showTiming && response.duration) {
            this.terminal.printDim(`[Time: ${(response.duration / 1000).toFixed(2)}s]`);
          }
        } catch (error) {
          spinner.stop();
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof ProviderMisalignmentError) {
        this.terminal.printError(
          'OpenAI stopped this Astra request for misalignment review. AMOS will not retry it.'
        );
        if (error.requestId) this.terminal.printDim(`Request ID: ${error.requestId}`);
        if (error.responseId) this.terminal.printDim(`Response ID: ${error.responseId}`);
        return;
      }
      this.terminal.printError(
        `Agent error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      const sessionId = this.agentRunner?.getSessionId();
      const currentSession = this.configManager.get().session;
      if (sessionId && currentSession.activeSessionId !== sessionId) {
        this.configManager.update({
          session: { ...currentSession, activeSessionId: sessionId },
        });
      }
    }
  }

  /**
   * Run initial setup wizard
   */
  private async runInitialSetup(): Promise<void> {
    this.terminal.print('=== Initial Setup ===\n');

    // Execute connector add command
    const result = await this.commandProcessor.execute('/connector add');

    if (result.success && this.agentRunner?.isReady()) {
      this.terminal.printSuccess('\nSetup complete! You can now start chatting.');
      this.terminal.print('Type /help for available commands.\n');
    } else if (result.success) {
      this.terminal.printWarning(
        '\nConnector created but not activated. Use /connector use <name> to activate it.\n'
      );
    } else {
      this.terminal.printWarning(
        '\nSetup incomplete. Use /connector add to configure later.\n'
      );
    }
  }

  /**
   * Print welcome banner
   */
  private printBanner(): void {
    const banner = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     █████╗ ███╗   ███╗ ██████╗ ███████╗                                       ║
║    ██╔══██╗████╗ ████║██╔═══██╗██╔════╝                                       ║
║    ███████║██╔████╔██║██║   ██║███████╗                                       ║
║    ██╔══██║██║╚██╔╝██║██║   ██║╚════██║                                       ║
║    ██║  ██║██║ ╚═╝ ██║╚██████╔╝███████║                                       ║
║    ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝                                       ║
║                                                                               ║
║              Advanced Multimodal Orchestration System                         ║
║                     Powered by OneRing AI Agents                              ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`;
    this.terminal.print(banner);

    const config = this.configManager.get();
    if (config.activeConnector) {
      let statusLine = `Active: ${config.activeConnector} | Model: ${config.activeModel || config.defaults.model}`;
      if (config.prompts.activePrompt) {
        statusLine += ` | Prompt: ${config.prompts.activePrompt}`;
      }
      this.terminal.printDim(statusLine);
    }
    this.terminal.print('');
    this.terminal.print('Type /help for commands, or just start chatting!');
    this.terminal.print('');
  }

  /**
   * Get the prompt string
   */
  private getPrompt(): string {
    const config = this.configManager.get();
    const mode = this.agentRunner?.getMode() || 'interactive';

    const modeIndicator = mode === 'planning' ? '📋 ' : mode === 'executing' ? '⚡ ' : '';
    const connectorPart = config.activeConnector
      ? `[${config.activeConnector}]`
      : '[no connector]';

    return `${modeIndicator}${connectorPart} > `;
  }

  /**
   * Register all commands
   */
  private registerCommands(): void {
    this.commandProcessor.registerAll([
      new HelpCommand(),
      this.astraCommand,
      new ModelCommand(),
      new VendorCommand(),
      new ConnectorCommand(),
      new ToolCommand(),
      new PromptCommand(),
      new SessionCommand(),
      new ConfigCommand(),
      new ContextCommand(),
      new HelpersCommand(),
      this.routineCommand,
      new RoutingCommand(),
      new PresetCommand(),
      new ExternalCommand(),
      new PlanCommand(),
      new ClearCommand(),
      new ExitCommand(),
      new StatusCommand(),
      new HistoryCommand(),
    ]);
  }

  /**
   * Shutdown the application
   */
  private async shutdown(): Promise<void> {
    this.routineCommand.close();
    this.terminal.print('\nShutting down...');
    this.astraCommand.reset();

    // Save config
    if (this.configManager.isDirty()) {
      await this.configManager.save();
    }

    // Destroy agent
    if (this.agentRunner) {
      this.agentRunner.destroy();
    }

    // Close terminal
    this.terminal.close();
  }

  /**
   * Register external tool connectors (search, scrape) on startup
   * These connectors are required for web_search and web_scrape tools to work
   */
  private async registerExternalToolConnectors(config: AmosConfig): Promise<void> {
    const externalTools = config.externalTools;
    if (!externalTools.enabled) return;

    // Register search connector if configured
    if (externalTools.search?.enabled && externalTools.search.connectorName) {
      const connectorName = externalTools.search.connectorName;
      try {
        if (!this.connectorManager.isRegistered(connectorName)) {
          this.connectorManager.registerConnector(connectorName);
        }
      } catch (error) {
        // Connector might not exist anymore - disable the search tool
        console.error(`Failed to register search connector '${connectorName}':`, error);
        this.configManager.update({
          externalTools: {
            ...externalTools,
            search: { ...externalTools.search, enabled: false },
          },
        });
      }
    }

    // Register scrape connector if configured
    if (externalTools.scrape?.enabled && externalTools.scrape.connectorName) {
      const connectorName = externalTools.scrape.connectorName;
      try {
        if (!this.connectorManager.isRegistered(connectorName)) {
          this.connectorManager.registerConnector(connectorName);
        }
      } catch (error) {
        // Connector might not exist anymore - disable the scrape tool
        console.error(`Failed to register scrape connector '${connectorName}':`, error);
        this.configManager.update({
          externalTools: {
            ...externalTools,
            scrape: { ...externalTools.scrape, enabled: false },
          },
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IAmosApp Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  getConfig(): AmosConfig {
    return this.configManager.get();
  }

  updateConfig(partial: Partial<AmosConfig>): void {
    this.configManager.update(partial);
  }

  async saveConfig(): Promise<void> {
    await this.configManager.save();
  }

  getConnectorManager(): IConnectorManager {
    return this.connectorManager;
  }

  getPromptManager(): IPromptManager {
    return this.promptManager;
  }

  getToolLoader(): IToolLoader {
    return this.toolLoader;
  }

  getActiveTools(): ToolFunction[] {
    return this.toolLoader.getEnabledTools();
  }

  getRegisteredCommands(): ICommand[] {
    return this.commandProcessor.getAllCommands();
  }

  getCommand(name: string): ICommand | null {
    return this.commandProcessor.getCommand(name);
  }

  getAgent(): IAgentRunner | null {
    return this.agentRunner;
  }

  async createAgent(options: { freshSession?: boolean } = {}): Promise<void> {
    if (this.creatingAgent || this.agentRunner?.isRunning()) throw new Error('Cannot replace an active or initializing agent');
    this.agentRunner?.assertReplaceable();
    this.creatingAgent = true;
    try {
      await this.replaceAgent(options);
    } finally {
      this.creatingAgent = false;
    }
  }

  private async replaceAgent(options: { freshSession?: boolean }): Promise<void> {
    const config = this.configManager.get();

    if (!config.activeConnector) {
      throw new Error('No active connector configured');
    }

    // Ensure connector is registered
    if (!this.connectorManager.isRegistered(config.activeConnector)) {
      this.connectorManager.registerConnector(config.activeConnector);
    }
    for (const profile of Object.values(config.modelExecution?.helpers ?? {})) {
      if (profile && !this.connectorManager.isRegistered(profile.connector)) this.connectorManager.registerConnector(profile.connector);
    }

    for (const profile of Object.values(config.modelExecution?.routing?.routes ?? {})) {
      if (profile.connector && !this.connectorManager.isRegistered(profile.connector)) this.connectorManager.registerConnector(profile.connector);
    }
    const previousRunner = this.agentRunner;
    const previousSessionId = config.session.activeSessionId;
    // Candidate loading must not mutate the current configuration/session pointer.
    const candidateConfig = { ...config, session: { ...config.session, activeSessionId: options.freshSession ? null : previousSessionId } };
    let candidate: AgentRunner | undefined;
    try {
      if (previousRunner?.isReady()) {
        const metrics = await previousRunner.getContextMetrics();
        if ((!options.freshSession && (metrics?.historyMessageCount ?? 0) > 0) || previousRunner.hasUnstoredObservations()) {
          const checkpoint = await previousRunner.saveSession();
          if (!options.freshSession) candidateConfig.session.activeSessionId = checkpoint;
        }
      }

      // Get model
      const model = config.activeModel || config.defaults.model;

      // Create agent runner
      candidate = new AgentRunner(
        candidateConfig,
        this.toolLoader.getEnabledTools(),
        join(this.dataDir, 'sessions'),
        id => {
          if (this.agentRunner === candidate) this.configManager.update({ session: { ...this.configManager.get().session, activeSessionId: id } });
        },
      );

      // Set instructions from active prompt
      const activePromptContent = this.promptManager.getActiveContent();
      if (activePromptContent) {
        candidate.setInstructions(activePromptContent);
      }

      // Set up interactive approval handler
      if (config.permissions.promptForApproval) {
        candidate.setApprovalHandler(
          async (context: ToolApprovalContext): Promise<ApprovalDecision> => {
            return this.handleToolApproval(context);
          }
        );
      }

      await candidate.initialize(config.activeConnector, model);
    } catch (error) {
      try { candidate?.destroy(); } catch { /* Preserve the initialization error. */ }
      config.session.activeSessionId = previousSessionId;
      this.configManager.update({ session: { ...this.configManager.get().session, activeSessionId: previousSessionId } });
      throw error;
    }
    // Commit the handoff only after the candidate has loaded and validated.
    this.agentRunner = candidate;
    this.configManager.update({ session: { ...config.session, activeSessionId: candidate.getSessionId() } });
    // A steering response is bound to its original connector and model.
    this.astraCommand.reset();
    previousRunner?.destroy();
  }

  /**
   * Format tool details for display
   */
  /**
   * Get a human-readable description of a tool call.
   * Uses the tool's describeCall method if available, otherwise falls back to defaultDescribeCall.
   */
  private getToolDescription(toolName: string, args: Record<string, unknown> | string | undefined): string {
    try {
      const parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args || {});

      // Try to get the tool and use its describeCall method
      const tool = this.toolLoader.getTool(toolName);
      if (tool?.describeCall) {
        try {
          return tool.describeCall(parsedArgs);
        } catch {
          // Fall through to default
        }
      }

      // Fall back to the generic defaultDescribeCall
      return defaultDescribeCall(parsedArgs);
    } catch {
      return '';
    }
  }

  /**
   * Format tool details for display (legacy alias for getToolDescription)
   */
  private formatToolDetails(toolName: string, args: Record<string, unknown> | string): string {
    return this.getToolDescription(toolName, args);
  }

  /**
   * Handle interactive tool approval
   */
  private async handleToolApproval(context: ToolApprovalContext): Promise<ApprovalDecision> {
    const riskIndicator = context.riskLevel === 'critical' ? '⚠️  CRITICAL' :
                          context.riskLevel === 'high' ? '⚠️  HIGH RISK' :
                          context.riskLevel === 'medium' ? '⚡ MEDIUM RISK' : '';

    // Cast args to expected type (safe - args is Record<string, unknown> from ToolApprovalContext)
    const toolArgs = (context.args ?? {}) as Record<string, unknown> | string;
    const details = this.formatToolDetails(context.toolName, toolArgs);

    this.terminal.print('');
    if (details) {
      this.terminal.printWarning(`Tool "${context.toolName}: ${details}" requires approval ${riskIndicator}`);
    } else {
      this.terminal.printWarning(`Tool "${context.toolName}" requires approval ${riskIndicator}`);
    }

    if (context.reason) {
      this.terminal.print(`  Reason: ${context.reason}`);
    }

    if (context.args) {
      try {
        const argsStr = typeof context.args === 'string'
          ? context.args
          : JSON.stringify(context.args, null, 2);
        if (argsStr.length < 500) {
          this.terminal.printDim(`  Arguments: ${argsStr}`);
        } else {
          this.terminal.printDim(`  Arguments: ${argsStr.slice(0, 200)}...`);
        }
      } catch {
        // Ignore JSON stringify errors
      }
    }

    const options = ['yes', 'yes-session', 'yes-always', 'no', 'no-block'] as const;
    type ApprovalOption = typeof options[number];

    this.terminal.print('');
    this.terminal.print('Options:');
    this.terminal.print('  yes         - Allow this call only');
    this.terminal.print('  yes-session - Allow for this session');
    this.terminal.print('  yes-always  - Always allow (add to allowlist)');
    this.terminal.print('  no          - Deny this call');
    this.terminal.print('  no-block    - Always block (add to blocklist)');

    const answer = await this.terminal.select<ApprovalOption>(
      'Allow tool execution?',
      [...options]
    );

    switch (answer) {
      case 'yes':
        return { approved: true, scope: 'once' };

      case 'yes-session':
        return { approved: true, scope: 'session' };

      case 'yes-always':
        // Also add to allowlist in config
        const configAllow = this.configManager.get();
        if (!configAllow.permissions.allowlist.includes(context.toolName)) {
          configAllow.permissions.allowlist.push(context.toolName);
          configAllow.permissions.blocklist = configAllow.permissions.blocklist
            .filter((name) => name !== context.toolName);
          this.configManager.update({ permissions: configAllow.permissions });
          this.agentRunner?.allowlistTool(context.toolName);
          await this.configManager.save();
        }
        return { approved: true, scope: 'always' };

      case 'no-block':
        // Add to blocklist in config
        const configBlock = this.configManager.get();
        if (!configBlock.permissions.blocklist.includes(context.toolName)) {
          configBlock.permissions.blocklist.push(context.toolName);
          configBlock.permissions.allowlist = configBlock.permissions.allowlist
            .filter((name) => name !== context.toolName);
          this.configManager.update({ permissions: configBlock.permissions });
          this.agentRunner?.blocklistTool(context.toolName);
          await this.configManager.save();
        }
        return { approved: false, reason: 'User blocked tool' };

      case 'no':
      default:
        return { approved: false, reason: 'User denied' };
    }
  }

  destroyAgent(): void {
    if (this.agentRunner) {
      this.agentRunner.destroy();
      this.agentRunner = null;
    }
  }

  print(message: string): void {
    this.terminal.print(message);
  }

  printError(message: string): void {
    this.terminal.printError(message);
  }

  printSuccess(message: string): void {
    this.terminal.printSuccess(message);
  }

  printInfo(message: string): void {
    this.terminal.printInfo(message);
  }

  printDim(message: string): void {
    this.terminal.printDim(message);
  }

  write(message: string): void {
    this.terminal.write(message);
  }

  async prompt(question: string): Promise<string> {
    return this.terminal.prompt(question);
  }

  async confirm(question: string): Promise<boolean> {
    return this.terminal.confirm(question);
  }

  async select<T extends string>(question: string, options: T[]): Promise<T> {
    return this.terminal.select(question, options);
  }

  setColorOutput(enabled: boolean): void {
    this.terminal.setColorEnabled(enabled);
  }
}
