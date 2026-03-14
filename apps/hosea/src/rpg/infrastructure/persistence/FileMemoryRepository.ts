import { mkdir, readFile, writeFile, unlink, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IMemoryRepository } from '../../domain/ports/IMemoryRepository.js';
import type { Memory } from '../../domain/entities/Memory.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import type { SimulationTime } from '../../domain/types/SimulationTime.js';
import { MemorySerializer } from '../serialization/CharacterSerializer.js';

/**
 * File-system implementation of IMemoryRepository.
 * Files are organised per character:
 *   <basePath>/memories/<charId>/<id>.json
 */
export class FileMemoryRepository implements IMemoryRepository {
  private readonly memoriesRoot: string;

  constructor(private readonly basePath: string) {
    this.memoriesRoot = join(basePath, 'memories');
  }

  async save(memory: Memory): Promise<void> {
    const dir = this.charDir(memory.perspectiveOf);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${memory.id}.json`);
    const json = MemorySerializer.toJSON(memory);
    await writeFile(filePath, JSON.stringify(json, null, 2), 'utf8');
  }

  async findById(id: string): Promise<Memory | null> {
    // ID alone does not tell us the characterId directory, so we must search.
    // In practice callers usually know the characterId; this is a fallback.
    await this.ensureRoot();
    let charDirs: string[];
    try {
      charDirs = await readdir(this.memoriesRoot);
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }

    for (const charDirName of charDirs) {
      const filePath = join(this.memoriesRoot, charDirName, `${id}.json`);
      try {
        const raw = await readFile(filePath, 'utf8');
        return MemorySerializer.fromJSON(JSON.parse(raw));
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
      }
    }
    return null;
  }

  async findByCharacter(characterId: CharacterId): Promise<Memory[]> {
    const dir = this.charDir(characterId);
    return this.readAllFromDir(dir);
  }

  async findByTag(characterId: CharacterId, tag: string): Promise<Memory[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((m) => m.tags.includes(tag));
  }

  async findByTimeRange(
    characterId: CharacterId,
    from: SimulationTime,
    to: SimulationTime,
  ): Promise<Memory[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter(
      (m) => m.timestamp.tick >= from.tick && m.timestamp.tick <= to.tick,
    );
  }

  async findByParticipant(
    characterId: CharacterId,
    participantId: CharacterId,
  ): Promise<Memory[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((m) => m.participants.includes(participantId));
  }

  async delete(id: string): Promise<void> {
    // We need to find the file first since the directory is not known from the id.
    await this.ensureRoot();
    let charDirs: string[];
    try {
      charDirs = await readdir(this.memoriesRoot);
    } catch (err) {
      if (isNotFound(err)) {
        return;
      }
      throw err;
    }

    for (const charDirName of charDirs) {
      const filePath = join(this.memoriesRoot, charDirName, `${id}.json`);
      try {
        await unlink(filePath);
        return;
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
      }
    }
  }

  async deleteByCharacter(characterId: CharacterId): Promise<void> {
    const dir = this.charDir(characterId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
  }

  private charDir(characterId: CharacterId): string {
    return join(this.memoriesRoot, characterId);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.memoriesRoot, { recursive: true });
  }

  private async readAllFromDir(dir: string): Promise<Memory[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (isNotFound(err)) {
        return [];
      }
      throw err;
    }

    const memories: Memory[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await readFile(join(dir, entry), 'utf8');
        memories.push(MemorySerializer.fromJSON(JSON.parse(raw)));
      } catch {
        // Skip corrupt files
      }
    }
    return memories;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
