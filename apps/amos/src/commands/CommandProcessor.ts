/**
 * CommandProcessor - Extensible command processing system
 *
 * Handles command registration, parsing, and execution.
 * Commands are registered with names and aliases.
 */

import { ProviderMisalignmentError } from 'oneringai';
import type { CommandContext, CommandResult, ICommand, IAmosApp } from '../config/types.js';

export class CommandProcessor {
  private commands: Map<string, ICommand> = new Map();
  private aliases: Map<string, string> = new Map();
  private commandPrefix: string = '/';

  constructor(private app: IAmosApp) {}

  /**
   * Register a command
   */
  register(command: ICommand): void {
    // Register by name
    this.commands.set(command.name.toLowerCase(), command);

    // Register aliases
    for (const alias of command.aliases) {
      this.aliases.set(alias.toLowerCase(), command.name.toLowerCase());
    }
  }

  /**
   * Register multiple commands
   */
  registerAll(commands: ICommand[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  /**
   * Check if input is a command
   */
  isCommand(input: string): boolean {
    return input.trim().startsWith(this.commandPrefix);
  }

  /**
   * Parse a command string into name and arguments
   */
  parse(input: string): { name: string; args: string[] } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith(this.commandPrefix)) {
      return null;
    }

    const withoutPrefix = trimmed.slice(this.commandPrefix.length);
    const parts = this.tokenize(withoutPrefix);

    if (parts.length === 0) {
      return null;
    }

    return {
      name: parts[0].toLowerCase(),
      args: parts.slice(1),
    };
  }

  /**
   * Execute a command by input string
   */
  async execute(input: string): Promise<CommandResult> {
    const parsed = this.parse(input);

    if (!parsed) {
      return {
        success: false,
        message: 'Invalid command format',
      };
    }

    const command = this.getCommand(parsed.name);

    if (!command) {
      return {
        success: false,
        message: `Unknown command: ${parsed.name}. Type /help for available commands.`,
      };
    }

    const context: CommandContext = {
      app: this.app,
      args: parsed.args,
      rawInput: input,
    };

    try {
      return await command.execute(context);
    } catch (error) {
      if (error instanceof ProviderMisalignmentError) {
        const ids = [
          error.requestId ? `request ${error.requestId}` : '',
          error.responseId ? `response ${error.responseId}` : '',
        ].filter(Boolean).join(', ');
        return {
          success: false,
          message: 'OpenAI stopped this Astra request for misalignment review; AMOS will not retry it.' +
            (ids ? ` (${ids})` : ''),
        };
      }
      return {
        success: false,
        message: `Command error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get a command by name or alias
   */
  getCommand(nameOrAlias: string): ICommand | null {
    const normalized = nameOrAlias.toLowerCase();

    // Try direct lookup
    let command = this.commands.get(normalized);
    if (command) {
      return command;
    }

    // Try alias lookup
    const commandName = this.aliases.get(normalized);
    if (commandName) {
      command = this.commands.get(commandName);
      if (command) {
        return command;
      }
    }

    return null;
  }

  /**
   * Get all registered commands
   */
  getAllCommands(): ICommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get command prefix
   */
  getPrefix(): string {
    return this.commandPrefix;
  }

  /**
   * Set command prefix
   */
  setPrefix(prefix: string): void {
    this.commandPrefix = prefix;
  }

  /**
   * Tokenize input string, respecting quotes
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote: string | null = null;
    let escape = false;

    for (const char of input) {
      if (escape) {
        current += char;
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"' || char === "'") {
        if (inQuote === char) {
          // End quote
          inQuote = null;
        } else if (inQuote === null) {
          // Start quote
          inQuote = char;
        } else {
          // Different quote inside a quote
          current += char;
        }
        continue;
      }

      if (/\s/.test(char) && inQuote === null) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (escape) {
      current += '\\';
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Generate help text for all commands
   */
  generateHelp(): string {
    const commands = this.getAllCommands();
    const lines: string[] = [
      'Available Commands:',
      '',
    ];

    for (const command of commands.sort((a, b) => a.name.localeCompare(b.name))) {
      const aliasStr = command.aliases.length > 0
        ? ` (${command.aliases.map((a) => this.commandPrefix + a).join(', ')})`
        : '';
      lines.push(`  ${this.commandPrefix}${command.name}${aliasStr}`);
      lines.push(`    ${command.description}`);
      lines.push(`    Usage: ${command.usage}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get command suggestions for partial input (for autocomplete)
   */
  getSuggestions(partial: string): string[] {
    if (!partial.startsWith(this.commandPrefix)) {
      return [];
    }

    const search = partial.slice(this.commandPrefix.length).toLowerCase();
    const suggestions: string[] = [];

    // Search command names
    for (const name of this.commands.keys()) {
      if (name.startsWith(search)) {
        suggestions.push(this.commandPrefix + name);
      }
    }

    // Search aliases
    for (const alias of this.aliases.keys()) {
      if (alias.startsWith(search)) {
        suggestions.push(this.commandPrefix + alias);
      }
    }

    return [...new Set(suggestions)].sort();
  }
}
