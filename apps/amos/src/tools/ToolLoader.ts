/**
 * ToolLoader - Dynamic tool loading and management
 *
 * Loads built-in tools and custom tools from the filesystem.
 * Manages enabled/disabled state.
 * Includes developer tools (filesystem + shell) for coding agent capabilities.
 * Includes external tools (web search, scrape, fetch) with connector support.
 *
 * Phase 1.3 Improvements:
 * - Extracted developer tools config building to dedicated function (DRY)
 * Phase 2: External Tools
 * - Added external tools integration (web_search, web_scrape, web_fetch)
 */

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolFunction } from 'oneringai';
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createGlobTool,
  createGrepTool,
  createListDirectoryTool,
  createBashTool,
  type FilesystemToolConfig,
  type ShellToolConfig,
  tools as agentTools,
} from 'oneringai';
import type { IToolLoader, AmosConfig } from '../config/types.js';
import { ExternalToolManager, type ExternalToolInfo } from './ExternalToolManager.js';

const { webFetch } = agentTools;

// ─────────────────────────────────────────────────────────────────────────────
// Developer Tools Configuration (Phase 1.3 - Extracted)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build configuration for developer tools (filesystem + shell)
 *
 * Extracted to a separate function for:
 * 1. DRY - Reusable configuration logic
 * 2. Testability - Can be unit tested independently
 * 3. Clarity - Configuration logic is isolated
 */
export function buildDeveloperToolsConfig(config: AmosConfig | null): {
  filesystem: FilesystemToolConfig;
  shell: ShellToolConfig;
} {
  const devToolsConfig = config?.developerTools;
  const workingDir = devToolsConfig?.workingDirectory || process.cwd();

  return {
    filesystem: {
      workingDirectory: workingDir,
      allowedDirectories: devToolsConfig?.allowedDirectories || [],
      blockedDirectories: devToolsConfig?.blockedDirectories || ['node_modules', '.git', 'dist', 'build'],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxResults: 100,
    },
    shell: {
      workingDirectory: workingDir,
      defaultTimeout: devToolsConfig?.commandTimeout || 30000,
      blockedCommands: devToolsConfig?.blockedCommands || ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:'],
      allowBackground: true,
      maxOutputSize: 1024 * 1024, // 1MB
    },
  };
}

/**
 * Create all developer tools with given configuration
 *
 * Returns an array of all developer tools:
 * - Filesystem: read_file, write_file, edit_file, glob, grep, list_directory
 * - Shell: bash
 */
export function createDeveloperTools(config: AmosConfig | null): ToolFunction[] {
  const { filesystem: fsConfig, shell: shellConfig } = buildDeveloperToolsConfig(config);

  return [
    // Filesystem tools
    createReadFileTool(fsConfig),
    createWriteFileTool(fsConfig),
    createEditFileTool(fsConfig),
    createGlobTool(fsConfig),
    createGrepTool(fsConfig),
    createListDirectoryTool(fsConfig),
    // Shell tool
    createBashTool(shellConfig),
  ];
}

export class ToolLoader implements IToolLoader {
  private tools: Map<string, ToolFunction> = new Map();
  private enabledTools: Set<string> = new Set();
  private customToolsDir: string;
  private readonly defaultCustomToolsDir: string;
  private config: AmosConfig | null = null;
  private externalToolManager: ExternalToolManager | null = null;
  private customImportVersion = 0;

  constructor(customToolsDir: string = './data/tools') {
    this.customToolsDir = customToolsDir;
    this.defaultCustomToolsDir = customToolsDir;
  }

  /**
   * Set configuration (allows updating config after construction)
   */
  setConfig(config: AmosConfig): void {
    this.config = config;
    this.customToolsDir = config.tools.customToolsDir === './data/tools'
      ? this.defaultCustomToolsDir
      : config.tools.customToolsDir;
    // Update external tool manager config if it exists
    if (this.externalToolManager && config.externalTools) {
      this.externalToolManager.updateConfig(config.externalTools);
    }
  }

  /**
   * Set the external tool manager
   */
  setExternalToolManager(manager: ExternalToolManager): void {
    this.externalToolManager = manager;
  }

  /**
   * Get external tool info (for status display)
   */
  getExternalToolInfo(): ExternalToolInfo[] {
    return this.externalToolManager?.getAllToolInfo() || [];
  }

  /**
   * Get the external tool manager
   */
  getExternalToolManager(): ExternalToolManager | null {
    return this.externalToolManager;
  }

  /**
   * Initialize - load all tools
   */
  async initialize(): Promise<void> {
    // Load built-in tools
    const builtinTools = this.loadBuiltinTools();
    for (const tool of builtinTools) {
      const name = tool.definition.function.name;
      this.tools.set(name, tool);
      this.enabledTools.add(name); // Enable by default
    }

    // Load custom tools
    await this.loadCustomTools(this.customToolsDir);
  }

  /**
   * Load built-in tools
   */
  loadBuiltinTools(): ToolFunction[] {
    const tools: ToolFunction[] = [];

    // Calculator tool
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'calculate',
          description: 'Perform mathematical calculations. Supports basic arithmetic and common functions.',
          parameters: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: 'The mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(3.14)")',
              },
            },
            required: ['expression'],
          },
        },
      },
      execute: async (args: { expression: string }) => {
        try {
          // Safe math evaluation (no eval)
          const result = this.evaluateMath(args.expression);
          return { result, expression: args.expression };
        } catch (error) {
          return { error: `Failed to evaluate: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    });

    // Current time tool
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: 'Get the current date and time',
          parameters: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'Timezone (e.g., "America/New_York", "UTC"). Defaults to local timezone.',
              },
            },
          },
        },
      },
      execute: async (args: { timezone?: string }) => {
        const now = new Date();
        const options: Intl.DateTimeFormatOptions = {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: args.timezone || undefined,
        };

        try {
          const formatted = now.toLocaleDateString('en-US', options);
          return {
            formatted,
            iso: now.toISOString(),
            timestamp: now.getTime(),
            timezone: args.timezone || 'local',
          };
        } catch (error) {
          return {
            formatted: now.toString(),
            iso: now.toISOString(),
            timestamp: now.getTime(),
            timezone: 'local',
            error: `Invalid timezone '${args.timezone}': ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    // Random number generator
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'random_number',
          description: 'Generate a random number within a range',
          parameters: {
            type: 'object',
            properties: {
              min: {
                type: 'number',
                description: 'Minimum value (inclusive)',
              },
              max: {
                type: 'number',
                description: 'Maximum value (inclusive)',
              },
              integer: {
                type: 'boolean',
                description: 'Whether to return an integer (default: true)',
              },
            },
            required: ['min', 'max'],
          },
        },
      },
      execute: async (args: { min: number; max: number; integer?: boolean }) => {
        const { min, max, integer = true } = args;
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          return { error: 'min and max must be finite numbers' };
        }
        if (max < min) {
          return { error: 'max must be greater than or equal to min' };
        }
        const integerMin = Math.ceil(min);
        const integerMax = Math.floor(max);
        if (integer && integerMin > integerMax) {
          return { error: 'range does not contain an integer' };
        }
        const result = integer
          ? Math.floor(Math.random() * (integerMax - integerMin + 1)) + integerMin
          : Math.random() * (max - min) + min;
        return { result, min, max, integer };
      },
    });

    // Echo tool (useful for testing)
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'echo',
          description: 'Echo back the input message (useful for testing)',
          parameters: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message to echo',
              },
            },
            required: ['message'],
          },
        },
      },
      execute: async (args: { message: string }) => {
        return { echo: args.message };
      },
    });

    // Developer tools (filesystem + shell) - only if enabled
    if (this.config?.developerTools?.enabled !== false) {
      // Use extracted helper function (Phase 1.3 - DRY)
      const devTools = createDeveloperTools(this.config);
      tools.push(...devTools);
    }

    // External tools (web search, scrape, fetch) - based on config
    this.loadExternalTools(tools);

    return tools;
  }

  /**
   * Load external tools based on configuration
   * External tools require connectors to be configured
   */
  private loadExternalTools(tools: ToolFunction[]): void {
    const externalConfig = this.config?.externalTools;

    if (!externalConfig?.enabled) {
      return;
    }

    // web_fetch - Always available (no connector needed)
    if (externalConfig.webFetchEnabled) {
      tools.push(webFetch);
    }

    // web_search - Requires connector
    if (this.externalToolManager) {
      const searchTool = this.externalToolManager.createSearchTool();
      if (searchTool) {
        tools.push(searchTool);
      }

      const scrapeTool = this.externalToolManager.createScrapeTool();
      if (scrapeTool) {
        tools.push(scrapeTool);
      }
    }
  }

  /**
   * Load custom tools from a directory
   */
  async loadCustomTools(directory: string): Promise<ToolFunction[]> {
    const tools: ToolFunction[] = [];

    if (!existsSync(directory)) {
      return tools;
    }

    try {
      const files = await readdir(directory);

      for (const file of files) {
        if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;

        try {
          // Handle both absolute and relative paths
          const baseDir = isAbsolute(directory) ? directory : resolve(process.cwd(), directory);
          const filePath = join(baseDir, file);
          const fileUrl = `${pathToFileURL(filePath).href}?amosReload=${this.customImportVersion++}`;
          const module = await import(fileUrl);

          // Expect default export or named 'tool' export
          const tool = module.default || module.tool;

          if (this.isValidTool(tool)) {
            const name = tool.definition.function.name;
            this.tools.set(name, tool);
            this.enabledTools.add(name);
            tools.push(tool);
          }
        } catch (error) {
          console.error(`Failed to load custom tool ${file}:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to read custom tools directory:`, error);
    }

    return tools;
  }

  /**
   * Reload all tools
   */
  async reloadTools(): Promise<void> {
    // Remember enabled state
    const wasEnabled = new Set(this.enabledTools);

    // Clear and reload
    this.tools.clear();
    this.enabledTools.clear();

    await this.initialize();

    // Restore enabled state where possible
    for (const name of wasEnabled) {
      if (this.tools.has(name)) {
        this.enabledTools.add(name);
      }
    }
  }

  /**
   * Get all tools
   */
  getAllTools(): ToolFunction[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): ToolFunction | null {
    return this.tools.get(name) || null;
  }

  /**
   * Enable a tool
   */
  enableTool(name: string): void {
    if (this.tools.has(name)) {
      this.enabledTools.add(name);
    }
  }

  /**
   * Disable a tool
   */
  disableTool(name: string): void {
    this.enabledTools.delete(name);
  }

  /**
   * Check if a tool is enabled
   */
  isEnabled(name: string): boolean {
    return this.enabledTools.has(name);
  }

  /**
   * Get all enabled tools
   */
  getEnabledTools(): ToolFunction[] {
    return Array.from(this.tools.entries())
      .filter(([name]) => this.enabledTools.has(name))
      .map(([, tool]) => tool);
  }

  /**
   * Apply enable/disable state from config
   */
  applyConfig(enabledTools: string[], disabledTools: string[]): void {
    // Disable specified tools
    for (const name of disabledTools) {
      this.disableTool(name);
    }

    // Enable specified tools (overrides disabled)
    for (const name of enabledTools) {
      this.enableTool(name);
    }
  }

  /**
   * Validate that an object is a valid ToolFunction
   */
  private isValidTool(obj: unknown): obj is ToolFunction {
    if (!obj || typeof obj !== 'object') return false;
    const tool = obj as Record<string, unknown>;
    if (!tool.definition || typeof tool.definition !== 'object') return false;
    if (typeof tool.execute !== 'function') return false;

    const def = tool.definition as Record<string, unknown>;
    if (def.type !== 'function') return false;
    if (!def.function || typeof def.function !== 'object') return false;

    const func = def.function as Record<string, unknown>;
    if (typeof func.name !== 'string') return false;

    return true;
  }

  /**
   * Safe math expression evaluator
   */
  private evaluateMath(expression: string): number {
    // Define allowed functions
    const mathFunctions: Record<string, (...args: number[]) => number> = {
      abs: Math.abs,
      acos: Math.acos,
      asin: Math.asin,
      atan: Math.atan,
      ceil: Math.ceil,
      cos: Math.cos,
      exp: Math.exp,
      floor: Math.floor,
      log: Math.log,
      log10: Math.log10,
      max: Math.max,
      min: Math.min,
      pow: Math.pow,
      random: Math.random,
      round: Math.round,
      sin: Math.sin,
      sqrt: Math.sqrt,
      tan: Math.tan,
    };

    type Token = { type: 'number' | 'identifier' | 'symbol'; value: string };
    const tokens: Token[] = [];
    const source = expression.toLowerCase();
    let position = 0;

    while (position < source.length) {
      const rest = source.slice(position);
      const whitespace = rest.match(/^\s+/)?.[0];
      if (whitespace) {
        position += whitespace.length;
        continue;
      }
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?/)?.[0];
      if (number) {
        tokens.push({ type: 'number', value: number });
        position += number.length;
        continue;
      }
      const identifier = rest.match(/^[a-z][a-z0-9_]*/)?.[0];
      if (identifier) {
        tokens.push({ type: 'identifier', value: identifier });
        position += identifier.length;
        continue;
      }
      const symbol = rest[0];
      if ('+\-*/^%(),'.includes(symbol)) {
        tokens.push({ type: 'symbol', value: symbol });
        position += 1;
        continue;
      }
      throw new Error(`Unexpected character '${symbol}' at position ${position + 1}`);
    }

    if (tokens.length === 0) throw new Error('Expression is empty');
    let index = 0;
    const current = (): Token | undefined => tokens[index];
    const peek = (value: string): boolean => tokens[index]?.value === value;
    const consume = (value?: string): Token => {
      const token = tokens[index];
      if (!token || (value !== undefined && token.value !== value)) {
        throw new Error(value ? `Expected '${value}'` : 'Unexpected end of expression');
      }
      index += 1;
      return token;
    };

    const parseExpression = (): number => {
      let value = parseTerm();
      while (peek('+') || peek('-')) {
        const op = consume().value;
        const right = parseTerm();
        value = op === '+' ? value + right : value - right;
      }
      return value;
    };
    const parseTerm = (): number => {
      let value = parseUnary();
      while (peek('*') || peek('/') || peek('%')) {
        const op = consume().value;
        const right = parseUnary();
        if ((op === '/' || op === '%') && right === 0) throw new Error('Division by zero');
        value = op === '*' ? value * right : op === '/' ? value / right : value % right;
      }
      return value;
    };
    const parseUnary = (): number => {
      if (peek('+')) {
        consume('+');
        return parseUnary();
      }
      if (peek('-')) {
        consume('-');
        return -parseUnary();
      }
      return parsePower();
    };
    const parsePower = (): number => {
      const base = parsePrimary();
      if (peek('^')) {
        consume('^');
        return Math.pow(base, parseUnary());
      }
      return base;
    };
    const parsePrimary = (): number => {
      const token = current();
      if (!token) throw new Error('Unexpected end of expression');
      if (token.type === 'number') {
        consume();
        return Number(token.value);
      }
      if (peek('(')) {
        consume('(');
        const value = parseExpression();
        consume(')');
        return value;
      }
      if (token.type === 'identifier') {
        const name = consume().value;
        if (name === 'pi') return Math.PI;
        if (name === 'e') return Math.E;
        const fn = mathFunctions[name];
        if (!fn) throw new Error(`Unknown function or constant '${name}'`);
        consume('(');
        const args: number[] = [];
        if (!peek(')')) {
          args.push(parseExpression());
          while (peek(',')) {
            consume(',');
            args.push(parseExpression());
          }
        }
        consume(')');
        const unaryFunctions = new Set([
          'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'exp', 'floor',
          'log', 'log10', 'round', 'sin', 'sqrt', 'tan',
        ]);
        if (unaryFunctions.has(name) && args.length !== 1) {
          throw new Error(`${name} requires exactly one argument`);
        }
        if (name === 'pow' && args.length !== 2) {
          throw new Error('pow requires exactly two arguments');
        }
        if ((name === 'min' || name === 'max') && args.length === 0) {
          throw new Error(`${name} requires at least one argument`);
        }
        if (name === 'random' && args.length > 0) {
          throw new Error('random does not accept arguments');
        }
        return fn(...args);
      }
      throw new Error(`Unexpected token '${token.value}'`);
    };

    const result = parseExpression();
    if (index !== tokens.length) throw new Error(`Unexpected token '${tokens[index].value}'`);
    if (!Number.isFinite(result)) throw new Error('Result is not finite');
    return result;
  }
}
