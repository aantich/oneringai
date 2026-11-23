/**
 * HelpCommand - Display help information
 *
 * Dynamically generates help from all registered commands.
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult, ICommand } from '../../config/types.js';

export class HelpCommand extends BaseCommand {
  readonly name = 'help';
  readonly aliases = ['h', '?'];
  readonly description = 'Display help information';
  readonly usage = '/help [command]';

  get detailedHelp(): string {
    return `
/help - Display Help Information

USAGE:
  /help              Show all available commands
  /help <command>    Show detailed help for a specific command

EXAMPLES:
  /help
  /help model
  /help connector
`;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { args, app } = context;

    if (args.length === 0) {
      // Show general help with all registered commands
      return this.success(this.generateGeneralHelp(context));
    }

    // Show help for specific command
    const commandName = args[0].toLowerCase().replace(/^\//, '');
    const command = app.getCommand(commandName);

    if (command) {
      return this.success(command.detailedHelp || this.generateDefaultHelp(command));
    }

    return this.error(`Unknown command: ${commandName}. Type /help for available commands.`);
  }

  /**
   * Generate default help text for a command without detailed help
   */
  private generateDefaultHelp(command: ICommand): string {
    const aliasStr = command.aliases.length > 0
      ? `\nAliases: ${command.aliases.map(a => '/' + a).join(', ')}`
      : '';

    return `/${command.name} - ${command.description}${aliasStr}\n\nUsage: ${command.usage}`;
  }

  /**
   * Generate the general help text with all commands
   */
  private generateGeneralHelp(context: CommandContext): string {
    const { app } = context;
    const commands = app.getRegisteredCommands();

    // Group commands by category
    const categories: Record<string, ICommand[]> = {
      'Core': [],
      'Tools': [],
      'Context & Session': [],
      'Utility': [],
    };

    for (const cmd of commands) {
      // Categorize commands
      if (['help', 'image', 'model', 'vendor', 'connector', 'astra'].includes(cmd.name)) {
        categories['Core'].push(cmd);
      } else if (['tool', 'external', 'prompt'].includes(cmd.name)) {
        categories['Tools'].push(cmd);
      } else if (['context', 'session', 'config', 'history', 'status', 'plan'].includes(cmd.name)) {
        categories['Context & Session'].push(cmd);
      } else {
        categories['Utility'].push(cmd);
      }
    }

    const lines: string[] = [
      '╔═══════════════════════════════════════════════════════════════════════════════╗',
      '║                         AMOS - Advanced Multimodal                            ║',
      '║                          Orchestration System                                 ║',
      '╚═══════════════════════════════════════════════════════════════════════════════╝',
      '',
    ];

    // Generate command list by category
    for (const [category, cmds] of Object.entries(categories)) {
      if (cmds.length === 0) continue;

      lines.push(`${category.toUpperCase()}:`);

      // Sort commands by name
      const sortedCmds = cmds.sort((a, b) => a.name.localeCompare(b.name));

      for (const cmd of sortedCmds) {
        const aliasStr = cmd.aliases.length > 0
          ? ` (${cmd.aliases.map(a => '/' + a).join(', ')})`
          : '';
        const nameWithAlias = `/${cmd.name}${aliasStr}`;
        lines.push(`  ${nameWithAlias.padEnd(22)} ${cmd.description}`);
      }

      lines.push('');
    }

    // Add usage section
    lines.push('CHAT:');
    lines.push('  Just type your message to chat with the AI agent.');
    lines.push('  The agent supports planning mode for complex tasks.');
    lines.push('');
    lines.push('CODING AGENT:');
    lines.push('  AMOS includes full developer tools (filesystem + shell).');
    lines.push('  Use "/prompt use coding-agent" for autonomous coding capabilities.');
    lines.push('');
    lines.push('EXTERNAL TOOLS:');
    lines.push('  Web search and scraping require API connectors.');
    lines.push('  Use "/external setup" to configure search/scrape providers.');
    lines.push('');
    lines.push('EXAMPLES:');
    lines.push('  /astra use                Switch to GPT-6 Astra');
    lines.push('  /astra live <prompt>      Start a steerable Astra response');
    lines.push('  /vendor anthropic        Switch to Anthropic');
    lines.push('  /connector list          List all connectors');
    lines.push('  /tool list               List available tools');
    lines.push('  /external setup          Configure web search/scrape');
    lines.push('  /context                 Show context usage');
    lines.push('');
    lines.push('Type /help <command> for detailed help on a specific command.');

    return lines.join('\n');
  }
}
