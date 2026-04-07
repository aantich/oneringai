/**
 * Background Process Output Tool
 *
 * Read output from a background process started with bash run_in_background.
 * Supports tail (last N lines) and incremental reads via sequence numbers.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import { BackgroundProcessManager } from './BackgroundProcessManager.js';

export interface BgProcessOutputArgs {
  /** Background process ID (from bash run_in_background result) */
  id: string;
  /** Number of most recent lines to return (default: 50). Ignored if 'since' is provided. */
  tail?: number;
  /** Sequence number from a previous read. Only returns lines logged after that point.
   *  Use this for incremental monitoring: first call returns nextSequence, pass it back to get only new output. */
  since?: number;
}

export interface BgProcessOutputResult {
  success: boolean;
  /** The output lines */
  output?: string;
  /** Process status */
  status?: string;
  /** The command that was launched */
  command?: string;
  /** Number of lines returned */
  lineCount?: number;
  /** Total lines ever produced by this process */
  totalLines?: number;
  /** Pass this value as 'since' in the next call to get only new output */
  nextSequence?: number;
  /** Exit code (if process has exited) */
  exitCode?: number | null;
  error?: string;
}

export function createBgProcessOutputTool(): ToolFunction<BgProcessOutputArgs, BgProcessOutputResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'bg_process_output',
        description:
          `Read output from a background process started with dev_server or bash run_in_background=true. Use this to monitor dev servers, file watchers, build processes, or any background command. For processes started with dev_server, you can also read the full log file directly via read_file.

READING MODES:
- Default: returns the last 50 lines of output (like "tail -50")
- tail=N: returns the last N lines
- since=SEQ: returns only NEW lines since the given sequence number (for incremental monitoring)

INCREMENTAL MONITORING (recommended for dev servers):
1. First call: bg_process_output(id) → returns output + nextSequence=47
2. Next call: bg_process_output(id, since=47) → returns only lines logged since then + nextSequence=63
3. Continue with the latest nextSequence each time
This way you only see fresh output each time, not the entire history.

Also returns the process status (running/exited/killed/errored) and exit code. If status is "exited" or "errored", the output contains the final lines before the process stopped, including any error messages or stack traces — use this to diagnose what went wrong. Output is preserved even after a process crashes or is killed.`,
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Background process ID returned by bash when run_in_background=true',
            },
            tail: {
              type: 'number',
              description: 'Number of most recent lines to return (default: 50). Ignored when "since" is provided.',
            },
            since: {
              type: 'number',
              description: 'Sequence number from a previous call\'s nextSequence. Returns only lines logged after that point. Use for incremental monitoring.',
            },
          },
          required: ['id'],
        },
      },
    },

    permission: { scope: 'always' as const, riskLevel: 'low' as const },

    describeCall: (args: BgProcessOutputArgs): string => {
      if (args.since !== undefined) return `Reading new output from ${args.id} (since seq ${args.since})`;
      return `Reading output from ${args.id}${args.tail ? ` (last ${args.tail} lines)` : ''}`;
    },

    execute: async (args: BgProcessOutputArgs): Promise<BgProcessOutputResult> => {
      const info = BackgroundProcessManager.getInfo(args.id);
      if (!info) {
        return { success: false, error: `Background process '${args.id}' not found. Use bg_process_list to see available processes.` };
      }

      const readResult = BackgroundProcessManager.readOutput(args.id, {
        tail: args.since !== undefined ? undefined : (args.tail ?? 50),
        since: args.since,
      });

      if (!readResult.success) {
        return { success: false, error: readResult.error };
      }

      const lines = readResult.lines ?? [];

      return {
        success: true,
        output: lines.join('\n'),
        status: info.status,
        command: info.command,
        lineCount: lines.length,
        totalLines: readResult.totalLines,
        nextSequence: readResult.nextSequence,
        exitCode: info.exitCode,
      };
    },
  };
}

/**
 * Default bg_process_output tool instance
 */
export const bgProcessOutput = createBgProcessOutputTool();
