/**
 * Agent display types — shapes consumed by renderer components.
 * Display-subset of the IPC contract from window.hosea.agentConfig.list()
 */

/** Full agent config as returned by the IPC layer */
export interface AgentListItem {
  id: string;
  name: string;
  connector: string;
  model: string;
  agentType: 'basic';
  instructions: string;
  tools: string[];
  workingMemoryEnabled: boolean;
  inContextMemoryEnabled: boolean;
  persistentInstructionsEnabled: boolean;
  lastUsedAt?: number;
  isActive: boolean;
}

/** Connector as returned by window.hosea.connector.list() */
export interface ConnectorListItem {
  name: string;
  vendor: string;
  source?: 'local' | 'everworker' | 'built-in';
  models?: string[];
  createdAt: number;
}

/** A capability chip label shown on an agent card */
export interface CapabilityChip {
  label: string;
}

/** Stats computed from the full agent list */
export interface AgentStats {
  total: number;
  activeToday: number;
  totalTools: number;
}

/** Active filter options for the toolbar */
export interface AgentFilters {
  query: string;
  activeOnly: boolean;
}
