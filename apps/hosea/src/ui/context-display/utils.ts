const MAX_JSON_LENGTH = 50_000;

/**
 * Format a value for markdown display.
 * - Strings are rendered as markdown directly.
 * - Objects/arrays are shown as JSON code blocks (truncated if too large).
 * - Primitives are shown as inline text.
 * - Handles circular references and non-serializable values gracefully.
 */
export function formatValueForDisplay(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length > MAX_JSON_LENGTH) {
      return '```json\n' + json.slice(0, MAX_JSON_LENGTH) + '\n... (truncated)\n```';
    }
    return '```json\n' + json + '\n```';
  } catch {
    return '`[Object — cannot serialize]`';
  }
}

/** CSS class suffixes for priority badge styling */
export const PRIORITY_CLASSES: Record<string, string> = {
  low: 'cdp-priority--low',
  normal: 'cdp-priority--normal',
  high: 'cdp-priority--high',
  critical: 'cdp-priority--critical',
};
