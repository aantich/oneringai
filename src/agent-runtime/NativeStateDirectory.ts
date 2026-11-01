import { constants } from 'node:fs';
import { mkdtemp, realpath, open, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AgentDriverConfigurationError } from './errors.js';

export async function createNativeStateDirectory(prefix: string, sessionId?: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  try { await writeFile(path.join(directory, '.onering-runtime-owner'), sessionId ?? 'legacy', { mode: 0o600 }); return directory; }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
export async function verifyNativeStateDirectory(directory: unknown, prefix: string, sessionId?: string): Promise<string> {
  if (typeof directory !== 'string') throw new AgentDriverConfigurationError('Incomplete native state directory');
  const root = await realpath(directory);
  const temporaryRoot = await realpath(tmpdir());
  if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith(prefix)) throw new AgentDriverConfigurationError('Foreign native state directory');
  const marker = await open(path.join(root, '.onering-runtime-owner'), constants.O_RDONLY | constants.O_NOFOLLOW);
  let owner: string;
  try { const stat = await marker.stat(); if (!stat.isFile() || stat.size > 1024) throw new AgentDriverConfigurationError('Invalid native ownership marker'); owner = await marker.readFile('utf8'); } finally { await marker.close(); }
  if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith(prefix) || owner !== (sessionId ?? 'legacy')) throw new AgentDriverConfigurationError('Foreign native state directory');
  return root;
}
export async function deleteNativeStateDirectory(directory: unknown, prefix: string, sessionId?: string): Promise<void> {
  try { await rm(await verifyNativeStateDirectory(directory, prefix, sessionId), { recursive: true, force: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Trusted host assertion of complete native transcript/dependency recovery; never send a task to probe. */
export type NativeCheckpointVerifier = (state: { directory: string; nativeSessionId: string }, request: import('./AgentDriver.js').DriverOpenSessionRequest) => Promise<void>;
