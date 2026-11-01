/**
 * LookInsidePanel — Main container that auto-renders plugin sections.
 *
 * Takes a serializable IContextSnapshot and renders all sections.
 * Plugin sections are auto-discovered from the snapshot — no hardcoding.
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import type { LookInsidePanelProps, PluginRenderer, IPluginSnapshot } from './types.js';
import { CollapsibleSection } from './CollapsibleSection.js';
import { ContextWindowSection } from './sections/ContextWindowSection.js';
import { TokenBreakdownSection } from './sections/TokenBreakdownSection.js';
import { SystemPromptSection } from './sections/SystemPromptSection.js';
import { ToolsSection } from './sections/ToolsSection.js';
import { GenericPluginSection } from './sections/GenericPluginSection.js';
import { getPluginRenderer } from './plugins/registry.js';

export const LookInsidePanel: React.FC<LookInsidePanelProps> = ({
  snapshot,
  loading = false,
  agentName,
  headerActions,
  onViewFullContext,
  onForceCompaction,
  className,
  pluginRenderers,
  defaultExpanded = ['context', 'tools'],
  onMemoryEntryClick,
  memoryEntryValues,
  loadingMemoryKey,
}) => {
  // Manage expanded state here so it survives snapshot refreshes.
  // Use a ref to only initialize from defaultExpanded once.
  const initialized = useRef(false);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set(defaultExpanded));
  if (!initialized.current) {
    initialized.current = true;
  }

  const toggleSection = useCallback((id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSectionExpanded = useCallback((id: string) => expandedSet.has(id), [expandedSet]);
  // Merge app-provided renderers with built-in registry
  const resolveRenderer = useMemo(() => {
    return (pluginName: string): PluginRenderer | null => {
      // App-level override first
      if (pluginRenderers?.[pluginName]) return pluginRenderers[pluginName];
      // Then built-in registry
      return getPluginRenderer(pluginName);
    };
  }, [pluginRenderers]);

  if (loading) {
    return (
      <div className={`look-inside-panel look-inside-loading ${className ?? ''}`}>
        <div className="look-inside-spinner">Loading...</div>
      </div>
    );
  }

  if (!snapshot || !snapshot.available) {
    return (
      <div className={`look-inside-panel look-inside-unavailable ${className ?? ''}`}>
        <div className="look-inside-muted">Context not available</div>
      </div>
    );
  }

  return (
    <div className={`look-inside-panel ${className ?? ''}`}>
      {/* Header */}
      <div className="look-inside-header">
        <div className="look-inside-header-title">
          <span className="look-inside-title">
            {agentName ? `${agentName} — Look Inside` : 'Look Inside'}
          </span>
          <span className="look-inside-model-badge">{snapshot.model}</span>
        </div>
        <div className="look-inside-header-actions">
          {onViewFullContext && (
            <button
              type="button"
              className="look-inside-btn look-inside-btn-secondary"
              onClick={onViewFullContext}
            >
              View Full Context
            </button>
          )}
          {onForceCompaction && (
            <button
              type="button"
              className="look-inside-btn look-inside-btn-secondary"
              onClick={onForceCompaction}
            >
              Force Compaction
            </button>
          )}
          {headerActions}
        </div>
      </div>

      {/* Context Window */}
      <CollapsibleSection
        title="Context Window"
        id="context"
        onToggle={toggleSection}
        expanded={isSectionExpanded('context')}
        badge={`${snapshot.budget.utilizationPercent.toFixed(0)}%`}
      >
        <ContextWindowSection
          budget={snapshot.budget}
          messagesCount={snapshot.messagesCount}
          toolCallsCount={snapshot.toolCallsCount}
          strategy={snapshot.strategy}
        />
      </CollapsibleSection>

      {/* Token Breakdown */}
      <CollapsibleSection
        title="Token Breakdown"
        id="tokens"
        onToggle={toggleSection}
        expanded={isSectionExpanded('tokens')}
      >
        <TokenBreakdownSection budget={snapshot.budget} />
      </CollapsibleSection>

      {/* System Prompt */}
      <CollapsibleSection
        title="System Prompt"
        id="system-prompt"
        onToggle={toggleSection}
        expanded={isSectionExpanded('system-prompt')}
      >
        <SystemPromptSection content={snapshot.systemPrompt} />
      </CollapsibleSection>

      {/* Plugin Sections (auto-discovered) */}
      {snapshot.plugins.map((plugin: IPluginSnapshot) => {
        const Renderer = resolveRenderer(plugin.name) ?? GenericPluginSection;
        // Pass memory entry props to working_memory renderer
        const extraProps = plugin.name === 'working_memory'
          ? { onEntryClick: onMemoryEntryClick, entryValues: memoryEntryValues, loadingEntryKey: loadingMemoryKey }
          : {};
        return (
          <CollapsibleSection
            key={plugin.name}
            title={plugin.displayName}
            id={`plugin-${plugin.name}`}
            onToggle={toggleSection}
            expanded={isSectionExpanded(`plugin-${plugin.name}`)}
            badge={plugin.tokenSize > 0 ? `${plugin.tokenSize} tok` : undefined}
          >
            <Renderer plugin={plugin} {...extraProps} />
          </CollapsibleSection>
        );
      })}

      {/* Tools */}
      <CollapsibleSection
        title="Tools"
        id="tools"
        onToggle={toggleSection}
        expanded={isSectionExpanded('tools')}
        badge={snapshot.tools.length}
      >
        <ToolsSection tools={snapshot.tools} />
      </CollapsibleSection>
    </div>
  );
};
