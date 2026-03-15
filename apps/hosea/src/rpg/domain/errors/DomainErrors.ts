/**
 * Base class for all domain errors in the RPG NPC Behavior Framework.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a personality trait value is outside the valid [-1, 1] range.
 */
export class InvalidPersonalityError extends DomainError {
  constructor(trait: string, value: number) {
    super(
      `Personality trait "${trait}" has value ${value}, which is outside the valid range [-1, 1].`,
    );
  }
}

/**
 * Thrown when a character's internal state violates an invariant
 * (e.g. duplicate goal IDs, missing required fields, inconsistent status).
 */
export class CharacterInvariantError extends DomainError {
  constructor(characterId: string, reason: string) {
    super(`Character "${characterId}" violated an invariant: ${reason}`);
  }
}

/**
 * Thrown when goal relationships are invalid
 * (e.g. circular dependencies, a goal being its own parent).
 */
export class GoalHierarchyError extends DomainError {
  constructor(reason: string) {
    super(`Invalid goal hierarchy: ${reason}`);
  }
}

/**
 * Thrown when a numeric value is outside its expected range.
 */
export class InvalidRangeError extends DomainError {
  constructor(field: string, value: number, min: number, max: number) {
    super(
      `Field "${field}" has value ${value}, which is outside the valid range [${min}, ${max}].`,
    );
  }
}
