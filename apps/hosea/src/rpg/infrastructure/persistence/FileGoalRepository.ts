import { mkdir, readFile, writeFile, unlink, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IGoalRepository } from '../../domain/ports/IGoalRepository.js';
import type { Goal } from '../../domain/entities/Goal.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import type { GoalType } from '../../domain/types/Enums.js';
import { GoalSerializer } from '../serialization/CharacterSerializer.js';

/**
 * File-system implementation of IGoalRepository.
 * Files are organised per character:
 *   <basePath>/goals/<charId>/<id>.json
 *
 * The character-to-goal association is encoded in the directory structure,
 * so no separate index file is required.
 */
export class FileGoalRepository implements IGoalRepository {
  private readonly goalsRoot: string;

  constructor(private readonly basePath: string) {
    this.goalsRoot = join(basePath, 'goals');
  }

  async save(characterId: CharacterId, goal: Goal): Promise<void> {
    const dir = this.charDir(characterId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${goal.id}.json`);
    const json = GoalSerializer.toJSON(goal);
    await writeFile(filePath, JSON.stringify(json, null, 2), 'utf8');
  }

  async findById(id: string): Promise<Goal | null> {
    // Goal id alone does not tell us the character directory, so we search.
    await this.ensureRoot();
    let charDirs: string[];
    try {
      charDirs = await readdir(this.goalsRoot);
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }

    for (const charDirName of charDirs) {
      const filePath = join(this.goalsRoot, charDirName, `${id}.json`);
      try {
        const raw = await readFile(filePath, 'utf8');
        return GoalSerializer.fromJSON(JSON.parse(raw));
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
      }
    }
    return null;
  }

  async findByCharacter(characterId: CharacterId): Promise<Goal[]> {
    const dir = this.charDir(characterId);
    return this.readAllFromDir(dir);
  }

  async findByType(characterId: CharacterId, type: GoalType): Promise<Goal[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((g) => g.type === type);
  }

  async findActive(characterId: CharacterId): Promise<Goal[]> {
    const all = await this.findByCharacter(characterId);
    return all.filter((g) => g.status === 'active');
  }

  async delete(id: string): Promise<void> {
    await this.ensureRoot();
    let charDirs: string[];
    try {
      charDirs = await readdir(this.goalsRoot);
    } catch (err) {
      if (isNotFound(err)) {
        return;
      }
      throw err;
    }

    for (const charDirName of charDirs) {
      const filePath = join(this.goalsRoot, charDirName, `${id}.json`);
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
    return join(this.goalsRoot, characterId);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.goalsRoot, { recursive: true });
  }

  private async readAllFromDir(dir: string): Promise<Goal[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (isNotFound(err)) {
        return [];
      }
      throw err;
    }

    const goals: Goal[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await readFile(join(dir, entry), 'utf8');
        goals.push(GoalSerializer.fromJSON(JSON.parse(raw)));
      } catch {
        // Skip corrupt files
      }
    }
    return goals;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
