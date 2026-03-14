// Branded string type for compile-time safety
// The __brand property exists only at the type level and is never present at runtime.
declare const __characterIdBrand: unique symbol;
export type CharacterId = string & { readonly [__characterIdBrand]: never };

/**
 * Creates a CharacterId, generating a UUID if no id is provided.
 */
export function createCharacterId(id?: string): CharacterId {
  return (id ?? crypto.randomUUID()) as CharacterId;
}

/**
 * Type guard for CharacterId. At runtime all CharacterIds are non-empty strings,
 * so this only validates that the value is a non-empty string.
 */
export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && value.length > 0;
}
