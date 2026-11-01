/**
 * ContextDisplayPanel — Everworker Desktop wrapper around Hosea local UI shared component.
 *
 * Everworker Desktop-specific features:
 * - Pin/unpin entries (persisted via IPC)
 * - Custom filter: shows showInUI=true OR pinned entries
 * - Drag-and-drop reorder with own localStorage namespace
 * - Highlight animation on entry changes
 * - Editing and export disabled (no Meteor backend / PDF service)
 */

import React, { useCallback, useMemo } from 'react';
import { ContextDisplayPanel as SharedContextDisplayPanel } from '../../ui/index.js';
import type { InContextEntry } from 'oneringai';
import type { ContextEntryForUI } from '../../preload/index';

interface ContextDisplayPanelProps {
  entries: ContextEntryForUI[];
  highlightKey?: string | null;
  pinnedKeys: string[];
  onPinToggle: (key: string, pinned: boolean) => void;
  onMaximizedChange?: (isMaximized: boolean) => void;
}

export function ContextDisplayPanel({
  entries,
  highlightKey,
  pinnedKeys,
  onPinToggle,
  onMaximizedChange,
}: ContextDisplayPanelProps): React.ReactElement | null {
  const pinnedSet = useMemo(() => new Set(pinnedKeys), [pinnedKeys]);

  const filterEntries = useCallback(
    (allEntries: InContextEntry[]) =>
      allEntries.filter((e) => e.showInUI || pinnedSet.has(e.key)),
    [pinnedSet],
  );

  return (
    <SharedContextDisplayPanel
      entries={entries as unknown as InContextEntry[]}
      highlightKey={highlightKey}
      pinnedKeys={pinnedKeys}
      onPinToggle={onPinToggle}
      onMaximizedChange={onMaximizedChange}
      filterEntries={filterEntries}
      storageKey="hosea-context-order"
      enableDragAndDrop={true}
      enableEditing={false}
      enableExport={false}
    />
  );
}
