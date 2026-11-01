import { constants } from 'node:fs';
import { open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DriverSession } from './AgentDriver.js';
import type { RuntimeFileUpload, RuntimeArtifactDownload } from './types.js';
import { AgentDriverConfigurationError } from './errors.js';

export interface RuntimeFileTransferAccess {
  /** Existing directory owned by the host; keep other processes from renaming its parents. */
  root: string;
  /** Positive bound, at most 16 MiB; default 1 MiB. */
  maxBytes?: number;
  /** Exact MIME allowlist, applied to upload declarations and download response headers. */
  mediaTypes: readonly string[];
}

export function portableFilename(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || name === '.' || name === '..') throw new AgentDriverConfigurationError('File name must be a single portable filename');
  return name;
}

export function checkFileMetadata(size: number, mediaType: string, limits: { maxBytes: number; mediaTypes: readonly string[] }): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxBytes) throw new AgentDriverConfigurationError('Artifact exceeds the authorized byte bound');
  if (!limits.mediaTypes.includes(mediaType)) throw new AgentDriverConfigurationError('File MIME type is outside the host allowlist');
}

/** Read with a hard bound even when Content-Length is missing or incorrect. Never follow a URL. */
export async function readFileResponse(response: Response, limits: { maxBytes: number; mediaTypes: readonly string[] }): Promise<{ data: Uint8Array; mediaType: string }> {
  const mediaType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const size = response.headers.get('content-length');
  try { checkFileMetadata(size === null ? 0 : Number(size), mediaType, limits); }
  catch (error) { await response.body?.cancel(); throw error; }
  if (!response.ok || response.redirected || response.status >= 300) { await response.body?.cancel(); throw new AgentDriverConfigurationError('Artifact download failed or redirected'); }
  const reader = response.body?.getReader();
  if (!reader) throw new AgentDriverConfigurationError('Artifact download has no byte stream');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limits.maxBytes) throw new AgentDriverConfigurationError('Artifact stream exceeded the authorized byte bound');
      chunks.push(item.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (size !== null && Number(size) !== bytes) throw new AgentDriverConfigurationError('Artifact byte count differs from its acknowledged size');
  return { data: Buffer.concat(chunks, bytes), mediaType };
}

/** Host filesystem boundary shared by all drivers; no model-facing transfer tools. */
export class RuntimeFileTransfers {
  constructor(private readonly access: () => RuntimeFileTransferAccess | Promise<RuntimeFileTransferAccess>, private readonly native: DriverSession, private readonly policyBound?: number) {}
  private async target(relative: string) {
    const access = await this.access();
    const maxBytes = Math.min(access.maxBytes ?? 1024 * 1024, this.policyBound ?? 16 * 1024 * 1024);
    if (!path.isAbsolute(access.root) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024 || !access.mediaTypes.length || access.mediaTypes.some(type => !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type))) throw new AgentDriverConfigurationError('Invalid host file-transfer root, byte bound or MIME allowlist');
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '.' || !part)) throw new AgentDriverConfigurationError('Transfer path must be a relative path without traversal');
    portableFilename(path.basename(relative));
    const root = await realpath(access.root); const target = path.join(root, relative);
    const parent = await realpath(path.dirname(target));
    // Disallow symlink parents, including symlinks that happen to stay inside root.
    if (parent !== path.dirname(target) || (parent !== root && !parent.startsWith(`${root}${path.sep}`))) throw new AgentDriverConfigurationError('Transfer destination has a symlink or escapes its authorized directory');
    return { target, limits: { maxBytes, mediaTypes: access.mediaTypes } };
  }
  async upload(request: RuntimeFileUpload) {
    if (!this.native.uploadFile) throw new AgentDriverConfigurationError('This harness does not support explicit file upload');
    const { target, limits } = await this.target(request.path);
    const name = portableFilename(request.name ?? path.basename(target));
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat(); if (!stat.isFile()) throw new AgentDriverConfigurationError('Upload source must be a regular file');
      checkFileMetadata(stat.size, request.mediaType, limits);
      const data = new Uint8Array(stat.size); let position = 0;
      while (position < data.byteLength) { const result = await file.read(data, position, data.byteLength - position, position); if (!result.bytesRead) throw new AgentDriverConfigurationError('Upload source changed during bounded read'); position += result.bytesRead; }
      const after = await file.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new AgentDriverConfigurationError('Upload source changed during bounded read');
      return await this.native.uploadFile({ name, data, mediaType: request.mediaType });
    } finally { await file.close(); }
  }
  async download(request: RuntimeArtifactDownload) {
    if (!this.native.downloadArtifact) throw new AgentDriverConfigurationError('This harness does not support explicit artifact download');
    const { target, limits } = await this.target(request.path);
    // Reserve exclusively before network I/O; never overwrite a file or follow its symlink.
    const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const result = await readFileResponse(await this.native.downloadArtifact(request.reference, limits), limits);
      await file.writeFile(result.data); await file.sync();
      return { path: target, bytes: result.data.byteLength, mediaType: result.mediaType };
    } catch (error) { await unlink(target).catch(() => undefined); throw error; }
    finally { await file.close(); }
  }
}

/** Bind a native metadata byte count to the transfer without trusting an arbitrary download URL. */
export function artifactResponse(response: Response, bytes: number): Response {
  if (!response.ok || response.redirected) return response;
  const headers = new Headers(response.headers); headers.set('content-length', String(bytes));
  return new Response(response.body, { status: response.status, headers });
}
