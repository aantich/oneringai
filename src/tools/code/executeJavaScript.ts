/**
 * JavaScript Execution Tool
 * Executes JavaScript in a sandboxed VM with connector integration.
 * Connectors provide authenticated access to external APIs (GitHub, Slack, etc.)
 *
 * Key features:
 * - userId auto-injected from ToolContext into authenticatedFetch calls
 * - Connector list always scoped to current userId via global access policy
 * - Dynamic description regenerated at each LLM call with current connectors
 * - Configurable timeout per invocation
 */

import * as vm from 'vm';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { Connector } from '../../core/Connector.js';
import { authenticatedFetch as rawAuthenticatedFetch } from '../../connectors/authenticatedFetch.js';
import type { IConnectorRegistry } from '../../domain/interfaces/IConnectorRegistry.js';

interface ExecuteJSArgs {
  code: string;
  input?: any;
  timeout?: number;
}

interface ExecuteJSResult {
  success: boolean;
  result: any;
  logs: string[];
  error?: string;
  executionTime: number;
}

/**
 * Options for creating the execute_javascript tool.
 */
export interface ExecuteJavaScriptToolOptions {
  /**
   * Maximum allowed timeout in milliseconds for code execution.
   * The LLM can request up to this value via the `timeout` parameter.
   * Default: 30000 (30s). Set higher for long-running API calls.
   */
  maxTimeout?: number;

  /**
   * Default timeout in milliseconds when not specified by the LLM.
   * Default: 10000 (10s).
   */
  defaultTimeout?: number;
}

// Default timeout values
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_TIMEOUT = 30000;

/**
 * Format a single connector for the description.
 * Shows service type, vendor, base URL, and auth — enough for the agent
 * to decide which connector to use for a given task.
 */
function formatConnectorEntry(c: Connector, accountId?: string): string {
  const parts: string[] = [];

  // Service type or vendor (e.g., "github", "openai")
  const serviceOrVendor = c.serviceType ?? c.vendor ?? undefined;
  if (serviceOrVendor) parts.push(`Service: ${serviceOrVendor}`);

  // Account alias (for multi-account identities)
  if (accountId) parts.push(`Account: "${accountId}"`);

  // Description
  if (c.config.description) parts.push(c.config.description);

  // Base URL (skip for LLM connectors without explicit URL)
  if (c.baseURL) parts.push(`URL: ${c.baseURL}`);

  const label = accountId ? `"${c.name}" account "${accountId}"` : `"${c.name}"`;
  const details = parts.map(p => `     ${p}`).join('\n');
  return `   • ${label} (${c.displayName})\n${details}`;
}

/**
 * Build the connector/identity list for the description.
 * If identities are set, list each identity entry (connector + accountId).
 * Otherwise fall back to listing all connectors from the registry.
 */
function buildIdentityList(context: ToolContext | undefined): string {
  const identities = context?.identities;
  const registry = context?.connectorRegistry ?? Connector.asRegistry();

  if (identities?.length) {
    const entries: string[] = [];
    for (const id of identities) {
      try {
        const connector = registry.get(id.connector);
        entries.push(formatConnectorEntry(connector, id.accountId));
      } catch {
        entries.push(`   • "${id.connector}"${id.accountId ? ` account "${id.accountId}"` : ''} — not available`);
      }
    }
    return entries.length > 0 ? entries.join('\n\n') : '   No connectors registered.';
  }

  // Fallback: list all connectors from registry
  const connectors = registry.listAll();
  return connectors.length > 0
    ? connectors.map(c => formatConnectorEntry(c)).join('\n\n')
    : '   No connectors registered.';
}

/**
 * Check if any identity has an accountId (to decide whether to document the 4th param).
 */
function hasAccountIds(context: ToolContext | undefined): boolean {
  return !!context?.identities?.some(id => id.accountId);
}

/**
 * Generate the tool description with current connectors/identities from ToolContext.
 * Called dynamically via descriptionFactory when tools are sent to LLM.
 */
function generateDescription(context: ToolContext | undefined, maxTimeout: number): string {
  const connectorList = buildIdentityList(context);
  const showAccountId = hasAccountIds(context);
  const timeoutSec = Math.round(maxTimeout / 1000);

  const accountIdParam = showAccountId
    ? `
     • accountId (optional): Account alias for multi-account connectors.
       Required when a connector has multiple accounts (see list below).
       Example: authenticatedFetch('/v1.0/me', {}, 'microsoft', 'work')`
    : '';

  const accountIdExamples = showAccountId
    ? `
// Multi-account: specify accountId for connectors with multiple accounts
const resp = await authenticatedFetch('/v1.0/me', { method: 'GET' }, 'microsoft', 'work');
const profile = await resp.json();
output = profile;
`
    : '';

  return `Execute JavaScript code in a secure sandbox with authenticated API access to external services.

Use this tool when you need to:
- Call external APIs (GitHub, Slack, Stripe, etc.) using registered connectors
- Process, transform, or compute data that requires programmatic logic
- Chain multiple API calls or perform complex data manipulation
- Do anything that plain text generation cannot accomplish

SANDBOX API:

1. authenticatedFetch(url, options, connectorName${showAccountId ? ', accountId?' : ''})
   Makes authenticated HTTP requests using the connector's credentials.
   The current user's identity (userId) is automatically included — no need to pass it.
   Auth headers are added automatically — DO NOT set Authorization header manually.

   Parameters:
     • url: Full URL or path relative to the connector's base URL
       - Full: "https://api.github.com/user/repos"
       - Relative: "/user/repos" (resolved against connector's base URL)
     • options: Standard fetch options { method, headers, body }
       - For POST/PUT: set body to JSON.stringify(data) and headers to { 'Content-Type': 'application/json' }
     • connectorName: Name of a registered connector (see list below)${accountIdParam}

   Returns: Promise<Response>
     • response.ok — true if status 200-299
     • response.status — HTTP status code
     • await response.json() — parse JSON body
     • await response.text() — get text body

2. fetch(url, options) — Standard fetch without authentication

3. connectors.list() — Array of available connector names
4. connectors.get(name) — Connector info: { displayName, description, baseURL, serviceType }

VARIABLES:
   • input — data passed via the "input" parameter (default: {}). Always a parsed object/array, never a string.
     CRITICAL: You MUST pass actual data values directly. Template placeholders ({{results}}, {{param.name}}, etc.) are NOT supported and will be passed as literal strings. If you need data from a previous tool call, include the actual returned data in the input object.
   • output — SET THIS to return your result to the caller

GLOBALS: console.log/error/warn, JSON, Math, Date, Buffer, Promise, Array, Object, String, Number, Boolean, setTimeout, setInterval, URL, URLSearchParams, RegExp, Map, Set, Error, TextEncoder, TextDecoder

REGISTERED CONNECTORS:
${connectorList}

EXAMPLES:

// GET request
const resp = await authenticatedFetch('/user/repos', { method: 'GET' }, 'github');
const repos = await resp.json();
output = repos.map(r => r.full_name);

// POST request with JSON body
const resp = await authenticatedFetch('/chat.postMessage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: '#general', text: 'Hello!' })
}, 'slack');
output = await resp.json();
${accountIdExamples}
// Data processing — pass actual data via the input parameter, NOT template references
// e.g. call with: { "code": "...", "input": { "data": [{"score": 0.9}, {"score": 0.5}] } }
const items = input.data;
output = items.filter(i => i.score > 0.8).sort((a, b) => b.score - a.score);

LIMITS: ${timeoutSec}s max timeout, no file system access, no require/import.`;
}

/**
 * Create an execute_javascript tool.
 *
 * The tool uses `descriptionFactory` to generate a dynamic description that
 * always reflects the connectors available to the current user. Connector
 * visibility is determined by the global access policy (if set) scoped by
 * the agent's userId from ToolContext.
 *
 * @param options - Optional configuration for timeout limits
 */
export function createExecuteJavaScriptTool(
  options?: ExecuteJavaScriptToolOptions,
): ToolFunction<ExecuteJSArgs, ExecuteJSResult> {
  const maxTimeout = options?.maxTimeout ?? DEFAULT_MAX_TIMEOUT;
  const defaultTimeout = options?.defaultTimeout ?? DEFAULT_TIMEOUT;

  return {
    definition: {
      type: 'function',
      function: {
        name: 'execute_javascript',
        // Static fallback description (used if descriptionFactory is not supported)
        description: 'Execute JavaScript code in a secure sandbox with authenticated API access via connectors.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'JavaScript code to execute. Set the "output" variable with your result. ' +
                'Code is auto-wrapped in async IIFE — you can use await directly. ' +
                'For explicit async control, wrap in (async () => { ... })().',
            },
            input: {
              description:
                'Optional data available as the "input" variable in your code. ' +
                'IMPORTANT: Pass actual data directly as a JSON object/array. ' +
                'Template placeholders like {{results}} or {{param.name}} are NOT supported here and will be passed as literal strings. ' +
                'You must include the actual data values inline. ' +
                'Correct: "input": {"deals": [{"id":"1"}, ...]}. ' +
                'Wrong: "input": {"deals": "{{results}}"}.',
            },
            timeout: {
              type: 'number',
              description:
                `Execution timeout in milliseconds. Default: ${defaultTimeout}ms, max: ${maxTimeout}ms. ` +
                'Increase for slow API calls or multiple sequential requests.',
            },
          },
          required: ['code'],
        },
      },
      blocking: true,
      timeout: maxTimeout + 5000, // Tool-level timeout slightly above max code timeout
    },

    // Dynamic description — regenerated each time tool definitions are sent to LLM.
    // Receives ToolContext so connector list is scoped to current userId.
    descriptionFactory: (context?: ToolContext) => generateDescription(context, maxTimeout),

    permission: { scope: 'once' as const, riskLevel: 'high' as const, sensitiveArgs: ['code'] },

    execute: async (args: ExecuteJSArgs, context?: ToolContext): Promise<ExecuteJSResult> => {
      const logs: string[] = [];
      const startTime = Date.now();

      try {
        // Resolve timeout: clamp to [0, maxTimeout]
        const timeout = Math.min(Math.max(args.timeout || defaultTimeout, 0), maxTimeout);

        // Get connector registry from context (already scoped by userId + allowed connectors)
        const registry = context?.connectorRegistry ?? Connector.asRegistry();

        // Auto-parse stringified JSON input.
        // LLMs frequently pass input as a JSON string instead of a JSON object
        // (e.g. "input": "{\"deals\":[...]}" instead of "input": {"deals":[...]}).
        // Detect and parse to avoid `undefined` when code accesses input.field.
        let resolvedInput = args.input;
        if (typeof resolvedInput === 'string') {
          const trimmed = resolvedInput.trim();
          if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
          ) {
            try {
              resolvedInput = JSON.parse(trimmed);
            } catch {
              // Not valid JSON — keep as string
            }
          }
        }

        // Execute in VM with userId and scoped registry
        const result = await executeInVM(
          args.code, resolvedInput, timeout, logs,
          context?.userId, registry,
        );

        return {
          success: true,
          result,
          logs,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          result: null,
          logs,
          error: (error as Error).message,
          executionTime: Date.now() - startTime,
        };
      }
    },
  };
}

/**
 * Default executeJavaScript tool instance.
 *
 * Uses the global connector registry (scoped by userId at runtime).
 * For custom timeouts, use createExecuteJavaScriptTool(options).
 */
export const executeJavaScript: ToolFunction<ExecuteJSArgs, ExecuteJSResult> = createExecuteJavaScriptTool();

/**
 * Execute code in Node.js vm module with userId-scoped connector access.
 */
export async function executeInVM(
  code: string,
  input: any,
  timeout: number,
  logs: string[],
  userId: string | undefined,
  registry: IConnectorRegistry,
): Promise<any> {
  // Create sandbox context
  const sandbox: any = {
    // Input/output
    input: input ?? {},
    output: null,

    // Console (captured) — stringify objects for readable logs
    console: {
      log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      error: (...args: any[]) => logs.push('ERROR: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      warn: (...args: any[]) => logs.push('WARN: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    },

    // Authenticated fetch — userId auto-injected from ToolContext.
    // Only connectors visible in the scoped registry are accessible.
    // Optional 4th param accountId for multi-account OAuth identities.
    authenticatedFetch: (url: string | URL, options: RequestInit | undefined, connectorName: string, accountId?: string) => {
      // Verify the connector is accessible in the (possibly scoped) registry
      registry.get(connectorName);
      return rawAuthenticatedFetch(url, options, connectorName, userId, accountId);
    },

    // Standard fetch (no auth)
    fetch: globalThis.fetch,

    // Connector info (userId-scoped)
    connectors: {
      list: () => registry.list(),
      get: (name: string) => {
        try {
          const connector = registry.get(name);
          return {
            displayName: connector.displayName,
            description: connector.config.description || '',
            baseURL: connector.baseURL,
            serviceType: connector.serviceType,
          };
        } catch {
          return null;
        }
      },
    },

    // Standard globals
    Buffer,
    JSON,
    Math,
    Date,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Promise,

    // Built-in types
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Error,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  };

  // Create VM context
  const vmContext = vm.createContext(sandbox);

  // Wrap user code in async IIFE if not already wrapped
  const wrappedCode = code.trim().startsWith('(async')
    ? code
    : `
    (async () => {
      ${code}
      return output;
    })()
  `;

  // Compile and run
  const script = new vm.Script(wrappedCode);
  const resultPromise = script.runInContext(vmContext, {
    timeout,
    displayErrors: true,
  });

  // Wait for completion
  const result = await resultPromise;

  // If result is undefined but output was set, use the output variable
  return result !== undefined ? result : sandbox.output;
}
