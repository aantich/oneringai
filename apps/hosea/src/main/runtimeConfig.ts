import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** All app-owned data, including OAuth and Ollama, shares this root. */
export function getHoseaDataDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.HOSEA_DATA_DIR?.trim() ? resolve(env.HOSEA_DATA_DIR) : join(home, '.hosea');
}

export function isDesignPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HOSEA_DESIGN_PREVIEW === '1';
}

/** The retained backend is opt-in and always disabled in the design preview. */
export function isBackendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDesignPreview(env) && env.HOSEA_ENABLE_BACKEND === '1';
}
