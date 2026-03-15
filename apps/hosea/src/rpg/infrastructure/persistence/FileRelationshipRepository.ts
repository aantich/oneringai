import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IRelationshipRepository } from '../../domain/ports/IRelationshipRepository.js';
import type { Relationship } from '../../domain/entities/Relationship.js';
import type { CharacterId } from '../../domain/value-objects/CharacterId.js';
import { RelationshipSerializer } from '../serialization/CharacterSerializer.js';

/**
 * Index file structure used for efficient character-based lookups.
 * Stored at <basePath>/relationships/_index.json
 */
interface RelationshipIndex {
  /** Maps characterId → array of relationship ids involving that character. */
  byCharacter: Record<string, string[]>;
}

/**
 * File-system implementation of IRelationshipRepository.
 * Each relationship is stored as an individual JSON file:
 *   <basePath>/relationships/<id>.json
 *
 * An index file at <basePath>/relationships/_index.json tracks which
 * relationships involve each character, enabling efficient character-based
 * queries without scanning all files.
 */
export class FileRelationshipRepository implements IRelationshipRepository {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor(private readonly basePath: string) {
    this.dir = join(basePath, 'relationships');
    this.indexPath = join(this.dir, '_index.json');
  }

  async save(relationship: Relationship): Promise<void> {
    await this.ensureDir();

    const existing = await this.findById(relationship.id);
    const index = await this.loadIndex();

    // Clean up stale index entries if sourceId/targetId changed.
    if (existing !== null) {
      removeFromIndex(index, existing.sourceId, existing.id);
      removeFromIndex(index, existing.targetId, existing.id);
    }

    // Write the relationship file.
    const filePath = this.filePath(relationship.id);
    const json = RelationshipSerializer.toJSON(relationship);
    await writeFile(filePath, JSON.stringify(json, null, 2), 'utf8');

    // Update index.
    addToIndex(index, relationship.sourceId, relationship.id);
    addToIndex(index, relationship.targetId, relationship.id);
    await this.saveIndex(index);
  }

  async findById(id: string): Promise<Relationship | null> {
    const filePath = this.filePath(id);
    try {
      const raw = await readFile(filePath, 'utf8');
      return RelationshipSerializer.fromJSON(JSON.parse(raw));
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async findByCharacter(characterId: CharacterId): Promise<Relationship[]> {
    const index = await this.loadIndex();
    const ids = index.byCharacter[characterId] ?? [];
    const results: Relationship[] = [];
    for (const id of ids) {
      const rel = await this.findById(id);
      if (rel !== null) {
        results.push(rel);
      }
    }
    return results;
  }

  async findBetween(
    sourceId: CharacterId,
    targetId: CharacterId,
  ): Promise<Relationship | null> {
    const index = await this.loadIndex();
    const ids = index.byCharacter[sourceId] ?? [];
    for (const id of ids) {
      const rel = await this.findById(id);
      if (rel !== null && rel.sourceId === sourceId && rel.targetId === targetId) {
        return rel;
      }
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    const relationship = await this.findById(id);
    if (relationship === null) {
      return;
    }

    try {
      await unlink(this.filePath(id));
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }

    const index = await this.loadIndex();
    removeFromIndex(index, relationship.sourceId, id);
    removeFromIndex(index, relationship.targetId, id);
    await this.saveIndex(index);
  }

  async deleteByCharacter(characterId: CharacterId): Promise<void> {
    const index = await this.loadIndex();
    const ids = [...(index.byCharacter[characterId] ?? [])];

    for (const id of ids) {
      const rel = await this.findById(id);
      try {
        await unlink(this.filePath(id));
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
      }
      if (rel !== null) {
        const otherId =
          rel.sourceId === characterId ? rel.targetId : rel.sourceId;
        removeFromIndex(index, otherId, id);
      }
    }

    delete index.byCharacter[characterId];
    await this.saveIndex(index);
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async loadIndex(): Promise<RelationshipIndex> {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      return JSON.parse(raw) as RelationshipIndex;
    } catch (err) {
      if (isNotFound(err)) {
        return { byCharacter: {} };
      }
      throw err;
    }
  }

  private async saveIndex(index: RelationshipIndex): Promise<void> {
    await this.ensureDir();
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }
}

// ─── Index helpers ────────────────────────────────────────────────────────────

function addToIndex(
  index: RelationshipIndex,
  characterId: string,
  relationshipId: string,
): void {
  const existing = index.byCharacter[characterId];
  if (existing === undefined) {
    index.byCharacter[characterId] = [relationshipId];
  } else if (!existing.includes(relationshipId)) {
    existing.push(relationshipId);
  }
}

function removeFromIndex(
  index: RelationshipIndex,
  characterId: string,
  relationshipId: string,
): void {
  const existing = index.byCharacter[characterId];
  if (existing === undefined) {
    return;
  }
  const idx = existing.indexOf(relationshipId);
  if (idx !== -1) {
    existing.splice(idx, 1);
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
