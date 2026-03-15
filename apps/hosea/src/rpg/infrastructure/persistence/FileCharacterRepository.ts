import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ICharacterRepository } from '../../domain/ports/ICharacterRepository.js';
import type { Character } from '../../domain/entities/Character.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import { CharacterSerializer } from '../serialization/CharacterSerializer.js';

/**
 * File-system implementation of ICharacterRepository.
 * Each character is stored as an individual JSON file:
 *   <basePath>/characters/<id>.json
 */
export class FileCharacterRepository implements ICharacterRepository {
  private readonly dir: string;

  constructor(private readonly basePath: string) {
    this.dir = join(basePath, 'characters');
  }

  async save(character: Character): Promise<void> {
    await this.ensureDir();
    const filePath = this.filePath(character.id);
    const json = CharacterSerializer.toJSON(character);
    await writeFile(filePath, JSON.stringify(json, null, 2), 'utf8');
  }

  async findById(id: CharacterId): Promise<Character | null> {
    const filePath = this.filePath(id);
    try {
      const raw = await readFile(filePath, 'utf8');
      const json = JSON.parse(raw);
      return CharacterSerializer.fromJSON(json);
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async findByName(name: string): Promise<Character | null> {
    const all = await this.findAll();
    return all.find((c) => c.name === name) ?? null;
  }

  async findAll(): Promise<Character[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) {
        return [];
      }
      throw err;
    }

    const characters: Character[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await readFile(join(this.dir, entry), 'utf8');
        const json = JSON.parse(raw);
        characters.push(CharacterSerializer.fromJSON(json));
      } catch {
        // Skip corrupt files
      }
    }
    return characters;
  }

  async delete(id: CharacterId): Promise<void> {
    try {
      await unlink(this.filePath(id));
    } catch (err) {
      if (isNotFound(err)) {
        return;
      }
      throw err;
    }
  }

  async exists(id: CharacterId): Promise<boolean> {
    try {
      await readFile(this.filePath(id), 'utf8');
      return true;
    } catch (err) {
      if (isNotFound(err)) {
        return false;
      }
      throw err;
    }
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
