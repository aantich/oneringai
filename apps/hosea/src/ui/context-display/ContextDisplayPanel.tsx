import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, Minimize2, Upload, Loader2, FileText } from 'lucide-react';
import type { InContextEntry } from 'oneringai';
import { ContextEntryCard } from './ContextEntryCard.js';
import { useOrderPersistence } from './useOrderPersistence.js';
import { formatValueForDisplay } from './utils.js';
import type { IContextDisplayPanelProps, ExportFormat } from './types.js';

export const ContextDisplayPanel: React.FC<IContextDisplayPanelProps> = ({
  entries,
  highlightKey,
  title = 'Current Context',
  storageKey = 'rui-context-order',
  className,
  enableDragAndDrop = true,
  enableEditing = false,
  enableExport = false,
  onSaveEntry,
  onExport,
  onPinToggle,
  pinnedKeys,
  onMaximizedChange,
  onEnterDocumentMode,
  filterEntries,
  entriesRef: externalEntriesRef,
  onInteractiveAction,
}) => {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [maximizedKey, setMaximizedKey] = useState<string | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; position: 'above' | 'below' } | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const internalEntriesRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const actualEntriesRef = externalEntriesRef || internalEntriesRef;

  const pinnedSet = useMemo(() => new Set(pinnedKeys ?? []), [pinnedKeys]);

  // Filter visible entries
  const visibleEntries = useMemo(() => {
    if (filterEntries) return filterEntries(entries);
    return entries.filter((e) => e.showInUI);
  }, [entries, filterEntries]);

  // Order persistence (only used when drag-and-drop is enabled)
  const { sortedEntries, orderedKeys, setOrderedKeys, saveCurrentOrder } =
    useOrderPersistence(visibleEntries, storageKey);

  const displayedEntries = enableDragAndDrop ? sortedEntries : visibleEntries;

  // Scroll to highlighted entry within the nearest scrollable ancestor
  useEffect(() => {
    if (!highlightKey) return;
    // Double rAF: first rAF runs after React commit, second after browser paint.
    // Needed when panel just mounted (tab switch) and layout isn't computed yet.
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        const el = actualEntriesRef.current?.querySelector(
          `[data-entry-key="${CSS.escape(highlightKey)}"]`,
        ) as HTMLElement | null;
        if (!el) return;

        // Walk up DOM to find nearest scrollable ancestor (not the window)
        let scrollParent: HTMLElement | null = el.parentElement;
        while (scrollParent) {
          const style = getComputedStyle(scrollParent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
          scrollParent = scrollParent.parentElement;
        }
        if (!scrollParent) return;

        // Scroll so the element is visible within the container
        const elRect = el.getBoundingClientRect();
        const parentRect = scrollParent.getBoundingClientRect();
        if (elRect.top < parentRect.top || elRect.bottom > parentRect.bottom) {
          scrollParent.scrollTo({
            top: scrollParent.scrollTop + (elRect.top - parentRect.top) - 16,
            behavior: 'smooth',
          });
        }
      });
    });
    return () => { cancelled = true; };
  }, [highlightKey, actualEntriesRef]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportDropdownOpen]);

  // Combined markdown for export (includes description and priority)
  const combinedMarkdown = useMemo(
    () =>
      displayedEntries
        .map((e) => {
          const header = `## ${e.description || e.key}`;
          const priority = e.priority ? ` \`[${e.priority}]\`` : '';
          return `${header}${priority}\n\n${formatValueForDisplay(e.value)}`;
        })
        .join('\n\n---\n\n'),
    [displayedEntries],
  );

  // Deferred export: waits for React re-render with force-expanded cards, then calls onExport
  useEffect(() => {
    if (!pendingExportFormat || !onExport) return;
    const frameId = requestAnimationFrame(() => {
      const doExport = async () => {
        try {
          await onExport(pendingExportFormat, {
            element: actualEntriesRef.current,
            markdownContent: combinedMarkdown,
          });
        } catch (err) {
          console.error('Export failed:', err);
        } finally {
          setPendingExportFormat(null);
        }
      };
      doExport();
    });
    return () => cancelAnimationFrame(frameId);
  }, [pendingExportFormat, combinedMarkdown, onExport, actualEntriesRef]);

  const handleCollapseToggle = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleMaximizeToggle = useCallback(
    (key: string) => {
      setMaximizedKey((prev) => {
        const next = prev === key ? null : key;
        onMaximizedChange?.(next !== null);
        return next;
      });
    },
    [onMaximizedChange],
  );

  // Drag-and-drop handlers
  const handleDragStart = useCallback((key: string, e: React.DragEvent) => {
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  }, []);

  const handleDragOver = useCallback((key: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropTarget({ key, position: e.clientY < midY ? 'above' : 'below' });
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (targetKey: string, e: React.DragEvent) => {
      e.preventDefault();
      const sourceKey = e.dataTransfer.getData('text/plain');
      if (!sourceKey || sourceKey === targetKey) {
        setDraggedKey(null);
        setDropTarget(null);
        return;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const insertAfter = e.clientY >= rect.top + rect.height / 2;

      setOrderedKeys((prev) => {
        const next = prev.filter((k) => k !== sourceKey);
        const targetIdx = next.indexOf(targetKey);
        if (targetIdx === -1) return prev;
        const insertIdx = insertAfter ? targetIdx + 1 : targetIdx;
        next.splice(insertIdx, 0, sourceKey);
        saveCurrentOrder(next);
        return next;
      });

      setDraggedKey(null);
      setDropTarget(null);
    },
    [setOrderedKeys, saveCurrentOrder],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedKey(null);
    setDropTarget(null);
  }, []);

  if (visibleEntries.length === 0) return null;

  const isExporting = !!pendingExportFormat;
  const isMaximized = maximizedKey !== null;

  // Show ALL entries when exporting (ignore maximizedKey filter)
  const entriesToRender = isExporting
    ? displayedEntries
    : isMaximized
      ? displayedEntries.filter((e) => e.key === maximizedKey)
      : displayedEntries;

  const panelClasses = [
    'cdp-panel',
    isMaximized && !isExporting ? 'cdp-panel--maximized' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClasses}>
      {/* Header — hidden during export */}
      {!isExporting && (
        <div className="cdp-header">
          <Database size={14} className="cdp-header__icon" />
          <span className="cdp-header__title">{title}</span>
          <span className="cdp-header__count">{visibleEntries.length}</span>

          {onEnterDocumentMode && (
            <button
              className="cdp-action-btn"
              onClick={onEnterDocumentMode}
              title="Open document view"
            >
              <FileText size={14} />
            </button>
          )}

          {enableExport && onExport && (
            <div className="cdp-export" ref={dropdownRef}>
              <button
                className="cdp-action-btn cdp-export__trigger"
                onClick={() => setExportDropdownOpen((prev) => !prev)}
                disabled={isExporting}
                title={pendingExportFormat ? `Exporting to ${String(pendingExportFormat).toUpperCase()}...` : 'Export'}
              >
                {isExporting ? (
                  <Loader2 size={14} className="cdp-spinner" />
                ) : (
                  <Upload size={14} />
                )}
              </button>
              {exportDropdownOpen && (
                <div className="cdp-export__menu" role="menu">
                  <button
                    className="cdp-export__item"
                    role="menuitem"
                    onClick={() => {
                      setPendingExportFormat('pdf');
                      setExportDropdownOpen(false);
                    }}
                  >
                    Export as PDF
                  </button>
                  <button
                    className="cdp-export__item"
                    role="menuitem"
                    onClick={() => {
                      setPendingExportFormat('docx');
                      setExportDropdownOpen(false);
                    }}
                  >
                    Export as DOCX
                  </button>
                </div>
              )}
            </div>
          )}

          {isMaximized && (
            <button
              className="cdp-header__exit-maximize"
              onClick={() => {
                setMaximizedKey(null);
                onMaximizedChange?.(false);
              }}
              title="Exit full view"
            >
              <Minimize2 size={12} />
              <span>Exit</span>
            </button>
          )}
        </div>
      )}

      {/* Entries */}
      <div
        ref={actualEntriesRef as React.RefObject<HTMLDivElement>}
        className="cdp-entries"
        role="list"
        aria-label="Context entries"
      >
        {entriesToRender.map((entry) => (
          <ContextEntryCard
            key={entry.key}
            entry={entry}
            isCollapsed={isExporting ? false : collapsedKeys.has(entry.key)}
            isMaximized={isExporting ? false : maximizedKey === entry.key}
            isHighlighted={highlightKey === entry.key}
            forceExpanded={isExporting}
            enableDragAndDrop={enableDragAndDrop && !isExporting && !isMaximized}
            isDragging={draggedKey === entry.key}
            dropPosition={dropTarget?.key === entry.key ? dropTarget.position : null}
            enableEditing={enableEditing && !isExporting}
            onSaveEntry={onSaveEntry}
            isPinned={pinnedSet.has(entry.key)}
            onPinToggle={onPinToggle}
            onCollapseToggle={handleCollapseToggle}
            onMaximizeToggle={handleMaximizeToggle}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onInteractiveAction={onInteractiveAction}
          />
        ))}
      </div>
    </div>
  );
};
