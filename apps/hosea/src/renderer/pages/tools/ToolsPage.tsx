import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ToolListItem, ToolCategoryMeta, ToolFilter, ToolSchemaParam } from './toolTypes.js';
import { buildCategoryMeta, filterTools, parseSchema } from './toolUtils.js';
import { ToolCategoryNav } from './ToolCategoryNav.js';
import { ToolList } from './ToolList.js';
import { ToolDetailPanel } from './ToolDetailPanel.js';
import '../../styles/tools.css';

const PANEL_DEFAULT = 380;
const PANEL_MIN = 280;
const PANEL_MAX = 600;

export function ToolsPage(): React.ReactElement {
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [schema, setSchema] = useState<ToolSchemaParam[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);

  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Load tools from IPC
  useEffect(() => {
    async function load() {
      try {
        const [registry, list] = await Promise.all([
          window.hosea.tool.registry(),
          window.hosea.tool.list(),
        ]);
        const enabledMap = new Map(list.map((t: { name: string; enabled: boolean }) => [t.name, t.enabled]));
        const merged: ToolListItem[] = registry.map((r: {
          name: string;
          displayName: string;
          category: string;
          description: string;
          safeByDefault: boolean;
          requiresConnector?: boolean;
          connectorServiceTypes?: string[];
        }) => ({
          name: r.name,
          displayName: r.displayName,
          category: r.category as ToolListItem['category'],
          description: r.description,
          safeByDefault: r.safeByDefault,
          enabled: enabledMap.get(r.name) ?? true,
          requiresConnector: r.requiresConnector,
          connectorServiceTypes: r.connectorServiceTypes,
        }));
        setTools(merged);
      } catch (err) {
        console.error('[ToolsPage] Failed to load tools:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Select tool and load schema
  const handleSelect = useCallback(async (name: string) => {
    if (name === selectedTool) return;
    setSelectedTool(name);
    setSchema(null);
    try {
      const hosea = window.hosea as typeof window.hosea & {
        tool: typeof window.hosea.tool & { getSchema?: (n: string) => Promise<unknown> };
      };
      if (hosea.tool.getSchema) {
        const raw = await hosea.tool.getSchema(name);
        setSchema(parseSchema(raw));
      }
    } catch (err) {
      console.error('[ToolsPage] getSchema error:', err);
    }
  }, [selectedTool]);

  const handleClose = useCallback(() => {
    setSelectedTool(null);
    setSchema(null);
  }, []);

  const handleSelectCat = useCallback((cat: string) => {
    setSelectedCat(cat);
    setSelectedTool(null);
    setSchema(null);
  }, []);

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    setTools((prev) => prev.map((t) => t.name === name ? { ...t, enabled } : t));
    try {
      await window.hosea.tool.toggle(name, enabled);
    } catch (err) {
      console.error('[ToolsPage] toggle error:', err);
      setTools((prev) => prev.map((t) => t.name === name ? { ...t, enabled: !enabled } : t));
    }
  }, []);

  // Resize handle
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - ev.clientX;
      const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, resizeRef.current.startWidth + delta));
      setPanelWidth(next);
    }

    function onMouseUp() {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth]);

  // Derived state
  const categories: ToolCategoryMeta[] = useMemo(() => buildCategoryMeta(tools), [tools]);

  const visibleTools = useMemo(() => {
    const byCat = selectedCat === 'all' ? tools : tools.filter((t) => t.category === selectedCat);
    return filterTools(byCat, search, filter);
  }, [tools, selectedCat, search, filter]);

  const stats = useMemo(() => ({
    total: tools.length,
    autoAllowed: tools.filter((t) => t.safeByDefault).length,
    approval: tools.filter((t) => !t.safeByDefault).length,
    custom: tools.filter((t) => t.category === 'custom-tools').length,
  }), [tools]);

  const selectedToolData = useMemo(
    () => tools.find((t) => t.name === selectedTool) ?? null,
    [tools, selectedTool],
  );

  if (loading) {
    return (
      <div className="page tools-page">
        <div className="page__header">
          <div className="page__header-left">
            <h1 className="page__title">Tool Catalog</h1>
            <p className="page__subtitle">Browse and manage all available tools</p>
          </div>
        </div>
        <div className="page__content page__content--centered">
          <div className="spinner-border text-primary" role="status" />
        </div>
      </div>
    );
  }

  return (
    <div className="page tools-page">
      {/* Header */}
      <div className="page__header">
        <div className="page__header-left">
          <h1 className="page__title">Tool Catalog</h1>
          <p className="page__subtitle">Browse and manage all available tools</p>
        </div>
      </div>

      <div className="page__content">
        {/* Stats bar */}
        <div className="tools-stats-bar">
          <div className="tools-stat-item">
            <div className="tools-stat-icon">⊞</div>
            <div>
              <div className="tools-stat-value">{stats.total}</div>
              <div className="tools-stat-label">Total</div>
            </div>
          </div>
          <div className="tools-stat-item">
            <div className="tools-stat-icon tools-stat-icon--safe">✓</div>
            <div>
              <div className="tools-stat-value">{stats.autoAllowed}</div>
              <div className="tools-stat-label">Auto-allowed</div>
            </div>
          </div>
          <div className="tools-stat-item">
            <div className="tools-stat-icon tools-stat-icon--approval">⚠</div>
            <div>
              <div className="tools-stat-value">{stats.approval}</div>
              <div className="tools-stat-label">Need Approval</div>
            </div>
          </div>
          <div className="tools-stat-item">
            <div className="tools-stat-icon">⭐</div>
            <div>
              <div className="tools-stat-value">{stats.custom}</div>
              <div className="tools-stat-label">Custom Tools</div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="tools-toolbar">
          <div className="tools-search-box">
            <span className="tools-search-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </span>
            <input
              className="tools-search-input"
              type="text"
              placeholder="Search tools…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {(['all', 'safe', 'approval'] as const).map((f) => (
            <button
              key={f}
              className={`tools-filter-btn${filter === f ? ' tools-filter-btn--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f !== 'all' && <span className="tools-filter-dot" />}
              {f === 'all' ? 'All' : f === 'safe' ? 'Auto-allowed' : 'Approval'}
            </button>
          ))}
          <span className="tools-toolbar-count">{visibleTools.length} tools</span>
        </div>

        {/* 3-column content area */}
        <div className="tools-content-area">
          <ToolCategoryNav
            categories={categories}
            selected={selectedCat}
            onSelect={handleSelectCat}
          />

          <ToolList
            tools={visibleTools}
            selectedTool={selectedTool}
            selectedCat={selectedCat}
            onSelect={handleSelect}
            onToggle={handleToggle}
          />

          {selectedTool && (
            <div
              className="resize-handle"
              onMouseDown={handleResizeMouseDown}
            />
          )}

          <ToolDetailPanel
            tool={selectedToolData}
            schema={schema}
            panelWidth={panelWidth}
            onClose={handleClose}
          />
        </div>
      </div>
    </div>
  );
}
