import { randomUUID } from '../runtime/primitives.js';
import { promises as fs, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EvidenceStorage } from './EvidenceStorageBase.js';
import type { FileEvidenceStorageOptions } from './EvidenceStorageBase.js';
import { EvidenceError, hash, json } from '../../core/evidence/validation.js';
export { InMemoryEvidenceStorage } from './InMemoryEvidenceStorage.js';
export type { EvidenceStorageOptions, FileEvidenceStorageOptions } from './EvidenceStorageBase.js';

/** Immutable atomic files, hashed scope directories (no sanitization collisions). */
export class FileEvidenceStorage extends EvidenceStorage<Buffer> {
  readonly durability: 'restart' | 'fsync';
  protected readonly queueKey: string;
  private readonly directory: string;
  constructor(options: FileEvidenceStorageOptions) {
    super(options, { encode: text => Buffer.from(text, 'utf8'), decode: bytes => bytes.toString('utf8') });
    if (!options.directory || !['restart', 'fsync'].includes(options.durability ?? 'restart')) throw new EvidenceError('invalid');
    this.durability = options.durability ?? 'restart';
    this.directory = join(resolve(options.directory), hash(json(this.scope)));
    this.queueKey = this.directory;
  }
  protected async inventory(): Promise<Array<{ id: string; bytes: number }>> {
    const entries: Array<{ id: string; bytes: number }> = [];
    let dir;
    try { dir = await fs.opendir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries; throw error; }
    for await (const entry of dir) {
      if (!/^[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
      if (!entry.isFile()) throw new EvidenceError('corrupt');
      if (entries.length >= this.maxRecords) throw new EvidenceError('capacity');
      try { entries.push({ id: entry.name.slice(0, -5), bytes: (await fs.stat(join(this.directory, entry.name))).size }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return entries;
  }
  private async syncDirectory(path: string): Promise<void> {
    const handle = await fs.open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  protected async writeBlob(id: string, bytes: Buffer): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${id}.json`);
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes); if (this.durability === 'fsync') await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temp, path);
      if (this.durability === 'fsync') {
        // Synchronize newly created parent directory entries as well.
        for (let dir = this.directory; ; dir = dirname(dir)) {
          await this.syncDirectory(dir);
          if (dirname(dir) === dir) break;
        }
      }
    } finally { await fs.unlink(temp).catch(() => undefined); }
  }
  protected async readBlob(id: string): Promise<Buffer | null> {
    let handle;
    try { handle = await fs.open(join(this.directory, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > this.maxRecordBytes) throw new EvidenceError('corrupt');
      // Bounded allocation, including a byte to detect growth during the read.
      const buffer = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== stat.size) throw new EvidenceError('corrupt');
      return buffer.subarray(0, offset);
    } finally { await handle.close(); }
  }
  protected async removeBlob(id: string): Promise<boolean> {
    try {
      await fs.unlink(join(this.directory, `${id}.json`));
      if (this.durability === 'fsync') await this.syncDirectory(this.directory);
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
}
