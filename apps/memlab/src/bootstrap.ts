/**
 * Env defaulting — runs BEFORE any `@everworker/oneringai` import so the
 * library's default logger picks up LOG_FILE at module init. Without this,
 * structured logs would garble the chat UI.
 *
 * Must not import oneringai.
 */

import * as path from 'node:path';

if (!process.env.LOG_FILE) {
  process.env.LOG_FILE = path.join(process.cwd(), 'memlab.log');
}
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'info';
}

export const LOG_FILE_PATH = process.env.LOG_FILE;
export const LOG_LEVEL = process.env.LOG_LEVEL;
