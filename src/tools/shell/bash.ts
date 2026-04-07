/**
 * Bash Tool
 *
 * Executes shell commands with timeout and output handling.
 * Provides safe command execution with configurable restrictions.
 *
 * Features:
 * - Configurable timeouts
 * - Output truncation for large outputs
 * - Background execution via BackgroundProcessManager
 * - Blocked command patterns for safety
 * - Working directory persistence
 */

import { spawn } from 'node:child_process';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import {
  type ShellToolConfig,
  type BashResult,
  DEFAULT_SHELL_CONFIG,
  isBlockedCommand,
} from './types.js';
import { BackgroundProcessManager } from './BackgroundProcessManager.js';

/**
 * Arguments for the bash tool
 */
export interface BashArgs {
  /** The command to execute */
  command: string;
  /** Optional timeout in milliseconds (up to 600000ms / 10 minutes) */
  timeout?: number;
  /** Description of what this command does (for clarity) */
  description?: string;
  /** Run the command in the background */
  run_in_background?: boolean;
}

/**
 * Create a Bash tool with the given configuration
 */
export function createBashTool(config: ShellToolConfig = {}): ToolFunction<BashArgs, BashResult> {
  const mergedConfig = { ...DEFAULT_SHELL_CONFIG, ...config };

  return {
    definition: {
      type: 'function',
      function: {
        name: 'bash',
        description: `Execute shell commands with optional timeout.

SHELL: ${mergedConfig.shell}${process.platform === 'win32' ? ' (Windows). Use Windows command syntax.' : ' (Unix).'}

USAGE:
- Execute any shell command (git, npm, docker, build scripts, etc.)
- Working directory persists between commands
- Commands timeout after 2 minutes by default (configurable up to 10 minutes)
- Large outputs (>100KB) will be truncated

DEV SERVERS / LONG-RUNNING PROCESSES:
- For dev servers, watchers, or any long-running process: use the dev_server tool instead
- dev_server provides persistent log files, ready-wait, and better lifecycle management
- The run_in_background option here is for one-off background commands that don't need log files

FILE OPERATIONS: Prefer dedicated tools (read_file, edit_file, write_file, glob, grep) over shell equivalents.

BEST PRACTICES:
- Quote file paths with spaces: cd "/path with spaces"
- Use absolute paths when possible
- Chain with &&, use ; only when failures are acceptable
- Avoid interactive commands (no -i flags)

GIT SAFETY:
- NEVER run destructive commands (push --force, reset --hard, clean -f) without explicit permission
- NEVER update git config or skip hooks without permission
- Always create NEW commits rather than amending
- Stage specific files rather than using "git add -A"`,
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute',
            },
            timeout: {
              type: 'number',
              description: 'Optional timeout in milliseconds (max 600000ms / 10 minutes)',
            },
            description: {
              type: 'string',
              description: 'Clear, concise description of what this command does',
            },
            run_in_background: {
              type: 'boolean',
              description: 'Run the command in the background. Returns immediately with a background ID. Use bg_process_output to read output later, bg_process_kill to stop it.',
            },
          },
          required: ['command'],
        },
      },
    },

    permission: { scope: 'once' as const, riskLevel: 'high' as const, sensitiveArgs: ['command'] },

    describeCall: (args: BashArgs): string => {
      const cmd = args.command;
      const maxLen = 60;
      const prefix = args.run_in_background ? '[bg] ' : '';
      if (cmd.length > maxLen - prefix.length) {
        return prefix + cmd.slice(0, maxLen - prefix.length - 3) + '...';
      }
      return prefix + cmd;
    },

    execute: async (args: BashArgs): Promise<BashResult> => {
      const {
        command,
        timeout = mergedConfig.defaultTimeout,
        run_in_background = false,
      } = args;

      // Check for blocked commands
      const blockCheck = isBlockedCommand(command, mergedConfig);
      if (blockCheck.blocked) {
        return {
          success: false,
          error: `Command blocked for safety: ${blockCheck.reason}`,
        };
      }

      // Validate timeout
      const effectiveTimeout = Math.min(timeout, mergedConfig.maxTimeout);

      // Prepare environment
      const env = {
        ...process.env,
        ...mergedConfig.env,
      };

      return new Promise((resolve) => {
        const startTime = Date.now();

        // Spawn the process in a new process group (detached) so we can
        // kill the entire tree on timeout, not just the shell process.
        // Without this, child processes (e.g. npm run dev → node server)
        // keep stdout/stderr pipes open and the Promise never resolves.
        const childProcess = spawn(command, [], {
          shell: mergedConfig.shell,
          cwd: mergedConfig.workingDirectory,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        });

        // Handle background execution
        if (run_in_background && mergedConfig.allowBackground) {
          const result = BackgroundProcessManager.register(command, childProcess);
          if ('error' in result) {
            try { if (childProcess.pid) process.kill(-childProcess.pid, 'SIGTERM'); } catch { /* ignore */ }
            resolve({
              success: false,
              stdout: '',
              stderr: result.error,
              exitCode: 1,
            });
            return;
          }

          resolve({
            success: true,
            backgroundId: result.id,
            stdout: `Command started in background with ID: ${result.id}. Use bg_process_output to check output, bg_process_list to see all processes, bg_process_kill to stop.`,
          });
          return;
        }

        let stdout = '';
        let stderr = '';
        let killed = false;

        // Helper to kill the entire process group (not just the shell).
        // Uses negative PID to signal the whole group created by detached: true.
        const killProcessGroup = (signal: NodeJS.Signals): void => {
          try {
            if (childProcess.pid) {
              process.kill(-childProcess.pid, signal);
            }
          } catch {
            // Process group may already be gone; fall back to direct kill
            try { childProcess.kill(signal); } catch { /* already dead */ }
          }
        };

        // Set up timeout - kills entire process tree
        const GRACEFUL_KILL_WAIT_MS = 3000;
        const timeoutId = setTimeout(() => {
          killed = true;
          killProcessGroup('SIGTERM');
          setTimeout(() => {
            if (!childProcess.killed) {
              killProcessGroup('SIGKILL');
            }
          }, GRACEFUL_KILL_WAIT_MS);
        }, effectiveTimeout);

        // Collect stdout
        childProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          // Prevent memory issues with huge outputs
          if (stdout.length > mergedConfig.maxOutputSize * 2) {
            stdout = stdout.slice(-mergedConfig.maxOutputSize);
          }
        });

        // Collect stderr
        childProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          if (stderr.length > mergedConfig.maxOutputSize * 2) {
            stderr = stderr.slice(-mergedConfig.maxOutputSize);
          }
        });

        let resolved = false;
        const safeResolve = (result: BashResult): void => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          clearTimeout(hardTimeoutId);
          resolve(result);
        };

        // Hard safety-net timeout: if 'close' event never fires (e.g. orphaned
        // child processes still holding pipes), force-resolve after an extra grace period.
        const HARD_TIMEOUT_GRACE_MS = 5000;
        const hardTimeoutId = setTimeout(() => {
          if (!resolved) {
            // Last resort: try SIGKILL on the group
            killProcessGroup('SIGKILL');
            safeResolve({
              success: false,
              stdout,
              stderr,
              duration: Date.now() - startTime,
              error: `Command timed out after ${effectiveTimeout}ms (hard timeout: process group did not exit)`,
            });
          }
        }, effectiveTimeout + GRACEFUL_KILL_WAIT_MS + HARD_TIMEOUT_GRACE_MS);

        // Handle process completion
        childProcess.on('close', (code, signal) => {
          const duration = Date.now() - startTime;

          // Truncate output if needed
          let truncated = false;
          if (stdout.length > mergedConfig.maxOutputSize) {
            stdout = stdout.slice(0, mergedConfig.maxOutputSize) + '\n... (output truncated)';
            truncated = true;
          }
          if (stderr.length > mergedConfig.maxOutputSize) {
            stderr = stderr.slice(0, mergedConfig.maxOutputSize) + '\n... (output truncated)';
            truncated = true;
          }

          if (killed) {
            safeResolve({
              success: false,
              stdout,
              stderr,
              exitCode: code ?? undefined,
              signal: signal ?? undefined,
              duration,
              truncated,
              error: `Command timed out after ${effectiveTimeout}ms`,
            });
          } else {
            safeResolve({
              success: code === 0,
              stdout,
              stderr,
              exitCode: code ?? undefined,
              signal: signal ?? undefined,
              duration,
              truncated,
              error: code !== 0 ? `Command exited with code ${code}` : undefined,
            });
          }
        });

        // Handle spawn errors
        childProcess.on('error', (error) => {
          safeResolve({
            success: false,
            error: `Failed to execute command: ${error.message}`,
            duration: Date.now() - startTime,
          });
        });
      });
    },
  };
}

/**
 * Get output from a background process
 * @deprecated Use BackgroundProcessManager.readOutput() or bg_process_output tool instead
 */
export function getBackgroundOutput(bgId: string): { found: boolean; output?: string; running?: boolean } {
  const info = BackgroundProcessManager.getInfo(bgId);
  if (!info) return { found: false };

  const result = BackgroundProcessManager.readOutput(bgId, { tail: 1000 });
  return {
    found: true,
    output: result.lines?.join('\n') ?? '',
    running: info.status === 'running',
  };
}

/**
 * Kill a background process
 * @deprecated Use BackgroundProcessManager.kill() or bg_process_kill tool instead
 */
export function killBackgroundProcess(bgId: string): boolean {
  const result = BackgroundProcessManager.kill(bgId);
  return result.success;
}

/**
 * Default Bash tool instance
 */
export const bash = createBashTool();
