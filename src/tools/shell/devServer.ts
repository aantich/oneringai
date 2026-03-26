/**
 * Dev Server Tool
 *
 * Start a development server or long-running process with automatic
 * log file capture and optional ready-wait pattern matching.
 *
 * This is the preferred tool for starting dev servers, watchers, or
 * any long-running development process. It wraps bash background
 * execution with persistent log files and lifecycle management.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type ShellToolConfig,
  DEFAULT_SHELL_CONFIG,
  isBlockedCommand,
} from './types.js';
import { BackgroundProcessManager } from './BackgroundProcessManager.js';

export interface DevServerArgs {
  /** The command to run (e.g. "npm run dev", "meteor run", "python manage.py runserver") */
  command: string;
  /** What this server is (e.g. "React frontend on port 3000") */
  description?: string;
  /** Path to write logs. Default: auto-generated in .oneringai/logs/ */
  log_file?: string;
  /** Working directory for the server process */
  cwd?: string;
  /** Extra environment variables (e.g. { "PORT": "3001" }) */
  env?: Record<string, string>;
  /** Wait for a pattern in output before returning (e.g. "ready on|listening on") */
  wait_for?: {
    /** Regex pattern to match in output */
    pattern: string;
    /** Max milliseconds to wait (default: 30000) */
    timeout?: number;
  };
}

export interface DevServerResult {
  success: boolean;
  /** Background process ID (use with bg_process_output, bg_process_kill, bg_process_list) */
  id?: string;
  /** PID of the server process */
  pid?: number;
  /** Absolute path to the log file */
  log_file?: string;
  /** Summary message with next steps */
  message?: string;
  /** If wait_for was used, the line that matched the pattern */
  matched_output?: string;
  error?: string;
}

/** Default log directory relative to cwd */
const LOG_DIR = '.oneringai/logs';

function generateLogPath(cwd: string, command: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Sanitize command into a short filename-safe slug
  const slug = command
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .toLowerCase();
  return join(cwd, LOG_DIR, `${slug}-${timestamp}.log`);
}

export function createDevServerTool(config: ShellToolConfig = {}): ToolFunction<DevServerArgs, DevServerResult> {
  const mergedConfig = { ...DEFAULT_SHELL_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'dev_server',
        description: `Start a development server or long-running process with automatic log file capture.

USE THIS TOOL (not bash) whenever you need to start a server, watcher, or any long-running process for development. It starts the process in the background, writes ALL output to a persistent log file, and optionally waits until the server is ready before returning.

AFTER STARTING:
- Check recent output: use bg_process_output with the returned ID
- Read full logs: use read_file on the returned log_file path
- Stop the server: use bg_process_kill with the returned ID
- List all servers: use bg_process_list

WAIT FOR READY:
Use wait_for to block until the server prints a specific pattern (e.g. "listening on", "ready in").
This prevents race conditions where you try to use the server before it's actually ready.
If the pattern isn't seen within the timeout, the server keeps running but you get a warning.

EXAMPLES:
- Start React dev server: { "command": "npm run dev", "description": "React frontend" }
- Wait for ready: { "command": "npm run dev", "wait_for": { "pattern": "ready in|Local:" } }
- Start with custom port: { "command": "meteor run", "env": { "PORT": "4000" }, "description": "Meteor backend" }
- Custom log location: { "command": "npm start", "log_file": "/tmp/myapp.log" }`,
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The server/watcher command to run (e.g. "npm run dev", "python manage.py runserver")',
            },
            description: {
              type: 'string',
              description: 'What this server is (e.g. "React frontend on port 3000"). Logged for identification.',
            },
            log_file: {
              type: 'string',
              description: 'Path to write persistent logs. Default: auto-generated in .oneringai/logs/',
            },
            cwd: {
              type: 'string',
              description: 'Working directory for the server process. Default: current working directory.',
            },
            env: {
              type: 'object',
              description: 'Extra environment variables (e.g. { "PORT": "3001" })',
              additionalProperties: { type: 'string' },
            },
            wait_for: {
              type: 'object',
              description: 'Wait for a pattern in output before returning, to ensure the server is ready.',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Regex pattern to match in server output (e.g. "listening on|ready in")',
                },
                timeout: {
                  type: 'number',
                  description: 'Max milliseconds to wait for pattern (default: 30000)',
                },
              },
              required: ['pattern'],
            },
          },
          required: ['command'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    describeCall: (args: DevServerArgs): string => {
      const desc = args.description ? ` (${args.description})` : '';
      const cmd = args.command.length > 40 ? args.command.slice(0, 37) + '...' : args.command;
      return `Starting dev server: ${cmd}${desc}`;
    },

    execute: async (args: DevServerArgs): Promise<DevServerResult> => {
      const { command, wait_for } = args;
      const cwd = args.cwd || mergedConfig.workingDirectory;

      // Check for blocked commands
      const blockCheck = isBlockedCommand(command, mergedConfig);
      if (blockCheck.blocked) {
        return { success: false, error: `Command blocked for safety: ${blockCheck.reason}` };
      }

      // Determine log file path
      const logFile = args.log_file || generateLogPath(cwd, command);

      // Prepare environment
      const env = {
        ...process.env,
        ...mergedConfig.env,
        ...args.env,
      };

      // Spawn the process
      const childProcess = spawn(command, [], {
        shell: mergedConfig.shell,
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      // Register with BackgroundProcessManager (with log file)
      const regResult = BackgroundProcessManager.register(command, childProcess, { logFile });
      if ('error' in regResult) {
        try { if (childProcess.pid) process.kill(-childProcess.pid, 'SIGTERM'); } catch { /* ignore */ }
        return { success: false, error: regResult.error };
      }

      const id = regResult.id;
      const pid = childProcess.pid;

      // If wait_for is specified, wait for the pattern before returning
      if (wait_for) {
        const timeout = wait_for.timeout ?? 30000;
        const regex = new RegExp(wait_for.pattern, 'i');
        const matchedLine = await waitForPattern(childProcess, regex, timeout);

        if (matchedLine === null) {
          // Timeout — server is still running, just didn't see the pattern
          return {
            success: true,
            id,
            pid,
            log_file: logFile,
            message: `Server started (ID: ${id}) but ready pattern "${wait_for.pattern}" was not seen within ${timeout}ms. The server is still running — check bg_process_output(${id}) for current output. Logs: ${logFile}. Use bg_process_kill(${id}) to stop.`,
          };
        }

        // Check if process died during wait
        const info = BackgroundProcessManager.getInfo(id);
        if (info && info.status !== 'running') {
          const output = BackgroundProcessManager.readOutput(id, { tail: 20 });
          return {
            success: false,
            id,
            pid,
            log_file: logFile,
            error: `Server exited during startup (status: ${info.status}, exitCode: ${info.exitCode}). Last output:\n${output.lines?.join('\n') ?? '(none)'}`,
          };
        }

        return {
          success: true,
          id,
          pid,
          log_file: logFile,
          matched_output: matchedLine,
          message: `Server is ready (ID: ${id}). Matched: "${matchedLine.trim()}". Logs: ${logFile}. Use bg_process_output(${id}) to check output, bg_process_kill(${id}) to stop.`,
        };
      }

      // No wait_for — return immediately
      // Brief delay to catch immediate crashes
      await new Promise((r) => setTimeout(r, 500));

      const info = BackgroundProcessManager.getInfo(id);
      if (info && info.status !== 'running') {
        const output = BackgroundProcessManager.readOutput(id, { tail: 20 });
        return {
          success: false,
          id,
          pid,
          log_file: logFile,
          error: `Server exited immediately (status: ${info.status}, exitCode: ${info.exitCode}). Output:\n${output.lines?.join('\n') ?? '(none)'}`,
        };
      }

      return {
        success: true,
        id,
        pid,
        log_file: logFile,
        message: `Server started (ID: ${id}, PID: ${pid}). Logs: ${logFile}. Use bg_process_output(${id}) to check output, bg_process_kill(${id}) to stop.`,
      };
    },
  };
}

/**
 * Wait for a regex pattern in stdout/stderr.
 * Returns the matched line or null on timeout.
 */
function waitForPattern(
  childProcess: ReturnType<typeof spawn>,
  regex: RegExp,
  timeout: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;

    const finish = (result: string | null): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      childProcess.stdout?.off('data', onData);
      childProcess.stderr?.off('data', onData);
      childProcess.off('close', onClose);
      resolve(result);
    };

    const onData = (data: Buffer): void => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (regex.test(line)) {
          finish(line);
          return;
        }
      }
    };

    const onClose = (): void => {
      finish(null);
    };

    childProcess.stdout?.on('data', onData);
    childProcess.stderr?.on('data', onData);
    childProcess.on('close', onClose);

    const timer = setTimeout(() => finish(null), timeout);
  });
}

/**
 * Default dev_server tool instance
 */
export const devServer = createDevServerTool();
