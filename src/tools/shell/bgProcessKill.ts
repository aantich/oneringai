/**
 * Background Process Kill Tool
 *
 * Stop a running background process. Sends SIGTERM for graceful shutdown,
 * escalates to SIGKILL after 3 seconds if process doesn't exit.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import { BackgroundProcessManager } from './BackgroundProcessManager.js';

export interface BgProcessKillArgs {
  /** Background process ID to kill */
  id: string;
}

export interface BgProcessKillResult {
  success: boolean;
  /** The command that was killed */
  command?: string;
  message?: string;
  error?: string;
}

export function createBgProcessKillTool(): ToolFunction<BgProcessKillArgs, BgProcessKillResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'bg_process_kill',
        description:
          `Stop a running background process. Sends SIGTERM for graceful shutdown (allows the process to clean up), then SIGKILL after 3 seconds if it hasn't exited. Kills the entire process tree — so "npm run dev" will also stop the child node server, not just the npm wrapper.

Use this to: stop a dev server before restarting it, kill a runaway build, clean up processes you no longer need. Works with processes started by dev_server or bash run_in_background. Use bg_process_list first to find the process ID if you've lost it. After killing, the process output is still available via bg_process_output (and the log file, if started via dev_server) for debugging.`,
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Background process ID to stop (from bash run_in_background result or bg_process_list)',
            },
          },
          required: ['id'],
        },
      },
    },

    permission: { scope: 'session' as const, riskLevel: 'medium' as const },

    describeCall: (args: BgProcessKillArgs): string => `Killing background process ${args.id}`,

    execute: async (args: BgProcessKillArgs): Promise<BgProcessKillResult> => {
      const info = BackgroundProcessManager.getInfo(args.id);
      if (!info) {
        return { success: false, error: `Background process '${args.id}' not found. Use bg_process_list to see available processes.` };
      }

      const result = BackgroundProcessManager.kill(args.id);

      if (result.success) {
        return {
          success: true,
          command: info.command,
          message: `Sent SIGTERM to '${info.command}' (pid: ${info.pid}). Process will be force-killed after 3s if it doesn't exit gracefully.`,
        };
      }

      return { success: false, command: info.command, error: result.error };
    },
  };
}

/**
 * Default bg_process_kill tool instance
 */
export const bgProcessKill = createBgProcessKillTool();
