import { useEffect, useMemo, useState } from 'react';
import type { InContextEntry } from 'oneringai';

const DEFAULT_STORAGE_KEY = 'rui-context-order';

/** Load saved order from localStorage. */
function loadSavedOrder(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* ignore corrupt data */
  }
  return [];
}

/** Save order to localStorage. */
function saveOrder(storageKey: string, keys: string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    /* quota exceeded, ignore */
  }
}

/**
 * Reconcile saved order with current visible entries.
 * Keeps order for existing keys, appends new keys at the end, removes stale keys.
 */
function reconcileOrder(savedOrder: string[], currentKeys: string[]): string[] {
  const currentSet = new Set(currentKeys);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const key of savedOrder) {
    if (currentSet.has(key) && !seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }

  for (const key of currentKeys) {
    if (!seen.has(key)) {
      result.push(key);
    }
  }

  return result;
}

export interface UseOrderPersistenceResult {
  sortedEntries: InContextEntry[];
  orderedKeys: string[];
  setOrderedKeys: React.Dispatch<React.SetStateAction<string[]>>;
  saveCurrentOrder: (keys: string[]) => void;
}

/**
 * Hook for persisting drag-and-drop order to localStorage.
 * Returns sorted entries respecting persisted order.
 */
export function useOrderPersistence(
  visibleEntries: InContextEntry[],
  storageKey: string = DEFAULT_STORAGE_KEY,
): UseOrderPersistenceResult {
  const [orderedKeys, setOrderedKeys] = useState<string[]>(() => loadSavedOrder(storageKey));

  // Pure computation: reconcile and sort
  const { sortedEntries, reconciledOrder } = useMemo(() => {
    const currentKeys = visibleEntries.map((e) => e.key);
    const reconciled = reconcileOrder(orderedKeys, currentKeys);
    const entryMap = new Map(visibleEntries.map((e) => [e.key, e]));
    const sorted = reconciled
      .map((key) => entryMap.get(key))
      .filter((e): e is InContextEntry => e !== undefined);
    return { sortedEntries: sorted, reconciledOrder: reconciled };
  }, [visibleEntries, orderedKeys]);

  // Side-effect: sync state when reconciliation detects order changes
  useEffect(() => {
    if (
      reconciledOrder.length !== orderedKeys.length ||
      reconciledOrder.some((k, i) => k !== orderedKeys[i])
    ) {
      setOrderedKeys(reconciledOrder);
      saveOrder(storageKey, reconciledOrder);
    }
  }, [reconciledOrder, orderedKeys, storageKey]);

  const saveCurrentOrder = (keys: string[]) => {
    setOrderedKeys(keys);
    saveOrder(storageKey, keys);
  };

  return { sortedEntries, orderedKeys, setOrderedKeys, saveCurrentOrder };
}
