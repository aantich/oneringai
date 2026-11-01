/**
 * UI prop types for Look Inside components.
 * Re-exports snapshot types from core library for convenience.
 */

import type { ReactNode } from 'react';
import type {
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from 'oneringai';

// Re-export snapshot types so consumers don't need to import from core
export type {
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
};

/**
 * Renderer component for a specific plugin type.
 */
export type PluginRenderer = React.ComponentType<PluginRendererProps>;

/**
 * Props passed to plugin renderer components.
 */
export interface PluginRendererProps {
  /** Plugin snapshot data */
  plugin: IPluginSnapshot;
  /** Whether the section is currently expanded */
  expanded?: boolean;
  /** Optional CSS class */
  className?: string;
  /** Optional callback when a memory/entry item is clicked (for lazy value loading) */
  onEntryClick?: (key: string) => void;
  /** Optional map of loaded entry values (key → value) */
  entryValues?: Map<string, unknown>;
  /** Key currently being loaded */
  loadingEntryKey?: string | null;
}

/**
 * Props for the main LookInsidePanel component.
 */
export interface LookInsidePanelProps {
  /** Context snapshot (null while loading or unavailable) */
  snapshot: IContextSnapshot | null;
  /** Loading state */
  loading?: boolean;
  /** Agent display name */
  agentName?: string;
  /** App-specific header actions (buttons, etc.) */
  headerActions?: ReactNode;
  /** Callback when "View Full Context" is requested */
  onViewFullContext?: () => void;
  /** Callback when "Force Compaction" is requested */
  onForceCompaction?: () => void;
  /** Optional CSS class */
  className?: string;
  /** Custom plugin renderers (keyed by plugin name) */
  pluginRenderers?: Record<string, PluginRenderer>;
  /** Section names to expand by default */
  defaultExpanded?: string[];
  /** Callback when a Working Memory entry is clicked (for lazy value loading) */
  onMemoryEntryClick?: (key: string) => void;
  /** Loaded memory entry values */
  memoryEntryValues?: Map<string, unknown>;
  /** Memory entry key currently being loaded */
  loadingMemoryKey?: string | null;
}

/**
 * Props for ViewContextContent component.
 */
export interface ViewContextContentProps {
  /** View context data (from agent.getViewContext()) */
  data: IViewContextData | null;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string | null;
  /** Callback when "Copy All" is clicked */
  onCopyAll?: () => void;
  /** Optional CSS class */
  className?: string;
}

/**
 * Props for CollapsibleSection component.
 */
export interface CollapsibleSectionProps {
  /** Section title */
  title: string;
  /** Section identifier (for expand/collapse state) */
  id: string;
  /** Whether the section starts expanded (uncontrolled mode) */
  defaultExpanded?: boolean;
  /** Controlled expanded state (overrides defaultExpanded) */
  expanded?: boolean;
  /** Callback when toggled (for controlled mode) */
  onToggle?: (id: string) => void;
  /** Optional badge text (shown next to title) */
  badge?: string | number;
  /** Optional icon (ReactNode — app provides its own) */
  icon?: ReactNode;
  /** Children content */
  children: ReactNode;
  /** Optional CSS class */
  className?: string;
}
