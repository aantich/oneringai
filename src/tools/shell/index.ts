/**
 * Shell Tools
 *
 * Tools for executing shell commands and managing background processes.
 *
 * Available tools:
 * - bash: Execute shell commands (foreground or background)
 * - dev_server: Start dev servers/watchers with log files and ready-wait
 * - bg_process_output: Read output from background processes
 * - bg_process_list: List all background processes
 * - bg_process_kill: Stop a background process
 *
 * @example
 * ```typescript
 * import { tools } from '@everworker/oneringai';
 *
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: [tools.bash, tools.bgProcessOutput, tools.bgProcessList, tools.bgProcessKill]
 * });
 * ```
 */

// Types
export type {
  ShellToolConfig,
  BashResult,
} from './types.js';

export {
  DEFAULT_SHELL_CONFIG,
  isBlockedCommand,
} from './types.js';

// Background Process Manager
export {
  BackgroundProcessManager,
  OutputRingBuffer,
  type BackgroundProcessInfo,
  type BackgroundProcessStatus,
  type RegisterOptions,
} from './BackgroundProcessManager.js';

// Bash Tool
export {
  bash,
  createBashTool,
  getBackgroundOutput,
  killBackgroundProcess,
} from './bash.js';

// Background Process Tools
export {
  bgProcessOutput,
  createBgProcessOutputTool,
} from './bgProcessOutput.js';

export {
  bgProcessList,
  createBgProcessListTool,
} from './bgProcessList.js';

export {
  bgProcessKill,
  createBgProcessKillTool,
} from './bgProcessKill.js';

// Dev Server Tool
export {
  devServer,
  createDevServerTool,
} from './devServer.js';
