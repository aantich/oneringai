/**
 * Merge required scope tokens into a space-separated scope string.
 * Idempotent: returns the input unchanged if the token is already present.
 * Empty / undefined input yields the required token alone (so the IdP at
 * least gets refresh-grant guidance). Preserves token order.
 */
export function mergeOAuthScopes(scope: string | undefined, required: string): string {
  const requiredTrimmed = required.trim();
  const trimmed = scope?.trim() ?? '';
  // Empty/whitespace `required` is a misconfiguration (TypeScript types
  // require `string`, not non-empty), but we never want to inject empty
  // tokens into the wire scope.
  if (!requiredTrimmed) return trimmed;
  if (!trimmed) return [...new Set(requiredTrimmed.split(/\s+/))].join(' ');
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let changed = false;
  for (const token of requiredTrimmed.split(/\s+/)) {
    if (!tokens.includes(token)) {
      tokens.push(token);
      changed = true;
    }
  }
  return changed ? tokens.join(' ') : trimmed;
}

