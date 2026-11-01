/**
 * Filesystem Tools
 *
 * A comprehensive set of tools for working with the local filesystem.
 * Mirrors Claude Code's file manipulation capabilities.
 *
 * Available tools:
 * - readFile: Read content from files
 * - writeFile: Write/create files
 * - editFile: Surgical find/replace edits
 * - glob: Find files by pattern
 * - grep: Search file contents
 * - listDirectory: List directory contents
 *
 * @example
 * ```typescript
 * import { tools } from 'oneringai';
 *
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: [
 *     tools.readFile,
 *     tools.writeFile,
 *     tools.editFile,
 *     tools.glob,
 *     tools.grep,
 *     tools.listDirectory,
 *   ]
 * });
 * ```
 */

// Types
export type {
  FilesystemToolConfig,
  FilesystemToolConfigDefaults,
  ReadFileResult,
  WriteFileResult,
  EditFileResult,
  GlobResult,
  GrepResult,
  GrepMatch,
} from './types.js';

export {
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
  isExcludedExtension,
  expandTilde,
  toForwardSlash,
} from './types.js';

// Read File Tool
export { readFile, createReadFileTool } from './readFile.js';

// Write File Tool
export { writeFile, createWriteFileTool } from './writeFile.js';

// Edit File Tool
export { editFile, createEditFileTool } from './editFile.js';

// Glob Tool
export { glob, createGlobTool } from './glob.js';

// Grep Tool
export { grep, createGrepTool } from './grep.js';

// List Directory Tool
export { listDirectory, createListDirectoryTool } from './listDirectory.js';
