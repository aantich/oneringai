import { useEffect, useRef, useState } from 'react';
import type { InContextEntry } from 'oneringai';

const HIGHLIGHT_DURATION_MS = 1500;

/**
 * Hook to detect new/updated visible entries in the Dynamic UI.
 * Must be used in an always-mounted parent component (NOT inside ContextDisplayPanel,
 * which may be conditionally rendered based on active tab).
 *
 * Returns the key of the most recently changed entry (auto-clears after timeout).
 */
export function useDynamicUIChangeDetection(
  entries: InContextEntry[],
  onEntryChanged?: (key: string) => void,
): string | null {
  const prevEntriesRef = useRef<Map<string, number>>(new Map());
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const visible = entries.filter((e) => e.showInUI);
    const prev = prevEntriesRef.current;
    let changedKey: string | null = null;

    for (const entry of visible) {
      const prevUpdatedAt = prev.get(entry.key);
      if (prevUpdatedAt === undefined || prevUpdatedAt !== entry.updatedAt) {
        changedKey = entry.key;
        break;
      }
    }

    // Update tracking map
    const next = new Map<string, number>();
    for (const entry of visible) {
      next.set(entry.key, entry.updatedAt);
    }
    prevEntriesRef.current = next;

    if (changedKey) {
      onEntryChanged?.(changedKey);
      setHighlightKey(changedKey);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setHighlightKey(null), HIGHLIGHT_DURATION_MS);
    }
  }, [entries, onEntryChanged]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return highlightKey;
}
