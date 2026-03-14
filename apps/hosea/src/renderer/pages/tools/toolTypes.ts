/**
 * Tool display types — shapes consumed by renderer components.
 * Display-subset of the IPC contract from window.hosea.tool.registry()
 */

/** Tool category identifiers matching ToolCategory in registry.generated.ts */
export type ToolCategoryId =
  | 'filesystem'
  | 'shell'
  | 'web'
  | 'code'
  | 'json'
  | 'routines'
  | 'desktop'
  | 'custom-tools'
  | 'other';

/** Tool as returned by window.hosea.tool.registry() */
export interface ToolListItem {
  name: string;
  displayName: string;
  category: ToolCategoryId;
  description: string;
  safeByDefault: boolean;
  enabled: boolean;
  requiresConnector?: boolean;
  connectorServiceTypes?: string[];
}

/** Category metadata with computed count */
export interface ToolCategoryMeta {
  id: ToolCategoryId | 'all';
  label: string;
  icon: string;
  count: number;
}

/** A single parameter parsed from JSON Schema */
export interface ToolSchemaParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/** Parsed schema for a tool */
export interface ToolSchema {
  params: ToolSchemaParam[];
}

/** Filter options for the toolbar */
export type ToolFilter = 'all' | 'safe' | 'approval';
