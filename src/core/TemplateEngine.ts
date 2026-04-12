/**
 * Extensible template engine for agent instructions.
 *
 * Supports `{{COMMAND}}` and `{{COMMAND:arg}}` syntax with two-phase processing:
 * - **Static** handlers resolve once at agent creation (e.g., AGENT_ID, MODEL)
 * - **Dynamic** handlers resolve every LLM call (e.g., DATE, TIME, RANDOM)
 *
 * Escaping:
 * - Triple braces: `{{{COMMAND}}}` → literal `{{COMMAND}}`
 * - Raw blocks: `{{raw}}...{{/raw}}` → content preserved verbatim
 *
 * Extensibility:
 * ```typescript
 * TemplateEngine.register('COMPANY', () => 'Acme Corp');
 * TemplateEngine.register('DB_COUNT', async (arg) => {
 *   return String(await db.collection(arg!).countDocuments());
 * }, { dynamic: true });
 * ```
 *
 * @module
 */

import { logger } from '../infrastructure/observability/Logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A template handler function.
 * @param arg - The argument after the colon (e.g., 'YYYY-MM-DD' in `{{DATE:YYYY-MM-DD}}`), or undefined if no colon
 * @param context - Template context with agent/environment info
 * @returns The substitution string (sync or async)
 */
export type TemplateHandler = (arg: string | undefined, context: TemplateContext) => string | Promise<string>;

/**
 * Context passed to template handlers.
 * Built-in fields are optional; custom handlers can read any extra properties.
 */
export interface TemplateContext {
  agentId?: string;
  agentName?: string;
  model?: string;
  vendor?: string;
  userId?: string;
  [key: string]: unknown;
}

/** Options for handler registration. */
export interface TemplateHandlerOptions {
  /** If true, handler runs at prepare() time (every LLM call). Default: false (static, runs once at creation). */
  dynamic?: boolean;
}

/** Options for process/processSync. */
export interface ProcessOptions {
  /** Which handlers to invoke. 'static' = creation-time only, 'dynamic' = prepare-time only, 'all' = both. Default: 'all' */
  phase?: 'static' | 'dynamic' | 'all';
}

// ============================================================================
// Internal types
// ============================================================================

interface RegisteredHandler {
  handler: TemplateHandler;
  dynamic: boolean;
}

interface MatchInfo {
  start: number;
  end: number;
  name: string;
  arg: string | undefined;
  handler: RegisteredHandler;
}

// ============================================================================
// Patterns
// ============================================================================

/** Matches {{COMMAND}} or {{COMMAND:arg}} — command starts with letter/underscore */
const TEMPLATE_RE = /\{\{([A-Za-z_]\w*)(?::(.*?))?\}\}/g;

/** Matches {{{...}}} — triple braces for literal escaping */
const TRIPLE_BRACE_RE = /\{\{\{(.*?)\}\}\}/g;

/** Matches {{raw}}...{{/raw}} — raw blocks for verbatim content */
const RAW_BLOCK_RE = /\{\{raw\}\}([\s\S]*?)\{\{\/raw\}\}/g;

// Sentinel prefix for placeholders (null byte + marker — won't appear in normal text)
const SENTINEL = '\x00TPL';

// ============================================================================
// Date formatting helpers
// ============================================================================

function applyDateFormat(date: Date, format: string): string {
  const tokens: Record<string, string> = {
    'YYYY': String(date.getFullYear()),
    'YY': String(date.getFullYear()).slice(-2),
    'MM': String(date.getMonth() + 1).padStart(2, '0'),
    'DD': String(date.getDate()).padStart(2, '0'),
    'HH': String(date.getHours()).padStart(2, '0'),
    'hh': String(date.getHours() % 12 || 12).padStart(2, '0'),
    'mm': String(date.getMinutes()).padStart(2, '0'),
    'ss': String(date.getSeconds()).padStart(2, '0'),
    'A': date.getHours() >= 12 ? 'PM' : 'AM',
    'a': date.getHours() >= 12 ? 'pm' : 'am',
  };

  let result = format;
  // Sort by length descending so YYYY matches before YY
  const sorted = Object.entries(tokens).sort((a, b) => b[0].length - a[0].length);
  for (const [token, value] of sorted) {
    result = result.replaceAll(token, value);
  }
  return result;
}

function formatDate(format?: string): string {
  const now = new Date();
  if (!format) return now.toISOString().split('T')[0]!; // YYYY-MM-DD
  return applyDateFormat(now, format);
}

function formatTime(format?: string): string {
  const now = new Date();
  if (!format) return now.toTimeString().split(' ')[0]!; // HH:mm:ss
  return applyDateFormat(now, format);
}

function formatDateTime(format?: string): string {
  const now = new Date();
  if (!format) return now.toISOString().replace('T', ' ').split('.')[0]!; // YYYY-MM-DD HH:mm:ss
  return applyDateFormat(now, format);
}

// ============================================================================
// TemplateEngine
// ============================================================================

/**
 * Static, extensible template engine for agent instruction strings.
 *
 * Follows the project's registry pattern (like Connector, StorageRegistry).
 * Built-in handlers are lazily initialized on first use.
 */
export class TemplateEngine {
  private static _handlers = new Map<string, RegisteredHandler>();
  private static _initialized = false;

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Register a template handler. Overrides any existing handler with the same name,
   * including built-ins — so client apps can replace DATE, TIME, etc. with custom logic.
   *
   * @param name - Command name (case-insensitive, stored uppercase). E.g., 'DATE', 'COMPANY'
   * @param handler - The handler function
   * @param options - `{ dynamic: true }` for handlers that should re-run every LLM call
   */
  static register(name: string, handler: TemplateHandler, options?: TemplateHandlerOptions): void {
    // Ensure built-ins are loaded first so user registrations always win.
    // Safe from recursion: ensureBuiltins() sets _initialized=true before calling
    // registerBuiltins(), so the nested register() calls return immediately here.
    this.ensureBuiltins();
    const key = name.toUpperCase();
    this._handlers.set(key, {
      handler,
      dynamic: options?.dynamic ?? false,
    });
    logger.debug({ name: key, dynamic: options?.dynamic ?? false }, 'Template handler registered');
  }

  /** Unregister a template handler (including built-ins). */
  static unregister(name: string): void {
    this.ensureBuiltins();
    this._handlers.delete(name.toUpperCase());
  }

  /** Check if a handler is registered. */
  static has(name: string): boolean {
    this.ensureBuiltins();
    return this._handlers.has(name.toUpperCase());
  }

  /** Get all registered handler names (uppercase). */
  static getRegisteredHandlers(): string[] {
    this.ensureBuiltins();
    return Array.from(this._handlers.keys());
  }

  /**
   * Process a template string asynchronously.
   * Resolves `{{COMMAND}}` and `{{COMMAND:arg}}` patterns.
   *
   * @param text - The template string
   * @param context - Template context (agent info, custom data)
   * @param options - Phase filtering: 'static', 'dynamic', or 'all' (default)
   * @returns The processed string with templates resolved
   */
  static async process(text: string, context?: TemplateContext, options?: ProcessOptions): Promise<string> {
    this.ensureBuiltins();
    if (!text) return text;

    const phase = options?.phase ?? 'all';
    const ctx = context ?? {};
    const { processed, matches, rawBlocks, tripleBraces } = this.extractAndMatch(text, phase);

    if (matches.length === 0 && rawBlocks.length === 0 && tripleBraces.length === 0) {
      return text;
    }

    // Build result piece by piece
    let result = '';
    let lastIndex = 0;
    for (const match of matches) {
      result += processed.slice(lastIndex, match.start);
      const value = await match.handler.handler(match.arg, ctx);
      result += value;
      lastIndex = match.end;
    }
    result += processed.slice(lastIndex);

    return this.restoreSentinels(result, rawBlocks, tripleBraces);
  }

  /**
   * Process a template string synchronously.
   * Throws if any matched handler returns a Promise.
   *
   * @param text - The template string
   * @param context - Template context
   * @param options - Phase filtering
   * @returns The processed string
   * @throws Error if a handler returns a Promise
   */
  static processSync(text: string, context?: TemplateContext, options?: ProcessOptions): string {
    this.ensureBuiltins();
    if (!text) return text;

    const phase = options?.phase ?? 'all';
    const ctx = context ?? {};
    const { processed, matches, rawBlocks, tripleBraces } = this.extractAndMatch(text, phase);

    if (matches.length === 0 && rawBlocks.length === 0 && tripleBraces.length === 0) {
      return text;
    }

    // Build result piece by piece (sync)
    let result = '';
    let lastIndex = 0;
    for (const match of matches) {
      result += processed.slice(lastIndex, match.start);
      const value = match.handler.handler(match.arg, ctx);
      if (value instanceof Promise) {
        throw new Error(
          `Template handler '${match.name}' returned a Promise. Use TemplateEngine.process() instead of processSync() for async handlers.`
        );
      }
      result += value;
      lastIndex = match.end;
    }
    result += processed.slice(lastIndex);

    return this.restoreSentinels(result, rawBlocks, tripleBraces);
  }

  /**
   * Reset all handlers (including built-ins). Primarily for testing.
   */
  static reset(): void {
    this._handlers.clear();
    this._initialized = false;
  }

  // ============================================================================
  // Private
  // ============================================================================

  /**
   * Extract raw blocks and triple braces, then collect template matches.
   */
  private static extractAndMatch(text: string, phase: 'static' | 'dynamic' | 'all'): {
    processed: string;
    matches: MatchInfo[];
    rawBlocks: string[];
    tripleBraces: string[];
  } {
    const rawBlocks: string[] = [];
    const tripleBraces: string[] = [];

    // Step 1: Replace raw blocks with sentinels
    let processed = text.replace(RAW_BLOCK_RE, (_match, content: string) => {
      rawBlocks.push(content);
      return `${SENTINEL}R${rawBlocks.length - 1}${SENTINEL}`;
    });

    // Step 2: Replace triple braces with sentinels
    processed = processed.replace(TRIPLE_BRACE_RE, (_match, content: string) => {
      tripleBraces.push(content);
      return `${SENTINEL}T${tripleBraces.length - 1}${SENTINEL}`;
    });

    // Step 3: Collect template matches
    const matches: MatchInfo[] = [];
    const pattern = new RegExp(TEMPLATE_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(processed)) !== null) {
      const name = m[1]!.toUpperCase();
      const arg = m[2]; // undefined if no colon
      const handler = this._handlers.get(name);
      if (!handler) continue; // Unknown command → leave as-is

      // Phase filtering
      if (phase === 'static' && handler.dynamic) continue;
      if (phase === 'dynamic' && !handler.dynamic) continue;

      matches.push({
        start: m.index,
        end: m.index + m[0]!.length,
        name,
        arg,
        handler,
      });
    }

    return { processed, matches, rawBlocks, tripleBraces };
  }

  /**
   * Restore sentinel placeholders back to their original form.
   */
  private static restoreSentinels(text: string, rawBlocks: string[], tripleBraces: string[]): string {
    let result = text;
    // Restore triple braces → literal {{...}}
    for (let i = 0; i < tripleBraces.length; i++) {
      result = result.replace(`${SENTINEL}T${i}${SENTINEL}`, `{{${tripleBraces[i]!}}}`);
    }
    // Restore raw blocks → verbatim content
    for (let i = 0; i < rawBlocks.length; i++) {
      result = result.replace(`${SENTINEL}R${i}${SENTINEL}`, rawBlocks[i]!);
    }
    return result;
  }

  /**
   * Lazily register built-in handlers on first use.
   */
  private static ensureBuiltins(): void {
    if (this._initialized) return;
    this._initialized = true;
    this.registerBuiltins();
  }

  private static registerBuiltins(): void {
    // --- Static handlers (resolved once at agent creation) ---
    this.register('AGENT_ID', (_, ctx) => ctx.agentId ?? '');
    this.register('AGENT_NAME', (_, ctx) => ctx.agentName ?? '');
    this.register('MODEL', (_, ctx) => ctx.model ?? '');
    this.register('VENDOR', (_, ctx) => ctx.vendor ?? '');
    this.register('USER_ID', (_, ctx) => ctx.userId ?? '');

    // --- Dynamic handlers (resolved every LLM call) ---
    this.register('DATE', (fmt) => formatDate(fmt), { dynamic: true });
    this.register('TIME', (fmt) => formatTime(fmt), { dynamic: true });
    this.register('DATETIME', (fmt) => formatDateTime(fmt), { dynamic: true });
    this.register('RANDOM', (arg) => {
      const parts = (arg ?? '1:100').split(':');
      const min = parseInt(parts[0] ?? '1', 10);
      const max = parseInt(parts[1] ?? '100', 10);
      if (isNaN(min) || isNaN(max) || min > max) {
        return String(Math.floor(Math.random() * 100) + 1);
      }
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }, { dynamic: true });
  }
}
