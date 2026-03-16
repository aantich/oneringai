import type { AgentListItem, AgentStats, AgentFilters, CapabilityChip } from './agentTypes.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Extract up to 2 initials from an agent name.
 * "Research Assistant" → "RA", "GPT" → "GP", "X" → "X"
 */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Derive a deterministic hue (0–360) from an agent name.
 * Used to give each agent a unique but stable avatar color.
 */
export function getAvatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

/**
 * Extract a short description from the agent's system prompt (instructions).
 * Takes the first non-empty line, truncated to maxLen chars.
 */
export function getDescription(instructions: string, maxLen = 120): string {
  const firstLine = instructions.trim().split('\n').find((l) => l.trim().length > 0) ?? '';
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen - 1) + '…' : firstLine;
}

/**
 * Build capability chip labels from agent config.
 * Order: tool count → specific tool types → memory features
 */
export function getCapabilityChips(agent: Pick<AgentListItem,
  'tools' | 'workingMemoryEnabled' | 'inContextMemoryEnabled' | 'persistentInstructionsEnabled'
>): CapabilityChip[] {
  const chips: CapabilityChip[] = [];
  const t = agent.tools;

  if (t.length > 0) chips.push({ label: `${t.length} tools` });
  if (t.includes('web_search')) chips.push({ label: 'Web search' });
  if (t.includes('web_fetch') && !t.includes('web_search')) chips.push({ label: 'Web fetch' });
  if (t.includes('bash')) chips.push({ label: 'Bash' });
  if (t.includes('write_file') || t.includes('edit_file')) chips.push({ label: 'Filesystem' });
  if (t.includes('execute_javascript')) chips.push({ label: 'JS Executor' });
  if (agent.workingMemoryEnabled) chips.push({ label: 'Working memory' });
  if (agent.inContextMemoryEnabled) chips.push({ label: 'In-context memory' });
  if (agent.persistentInstructionsEnabled) chips.push({ label: 'Persistent memory' });

  return chips;
}

/**
 * Format a timestamp as a human-readable "time ago" string.
 */
export function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return `${Math.floor(hours / 24)}d ago`;
}

/** Returns true if the agent was active within the last 24 hours */
export function isActiveToday(agent: Pick<AgentListItem, 'lastUsedAt'>): boolean {
  return !!(agent.lastUsedAt && Date.now() - agent.lastUsedAt < DAY_MS);
}

/** Compute aggregate stats from the full agent list */
export function computeStats(agents: AgentListItem[]): AgentStats {
  return {
    total: agents.length,
    activeToday: agents.filter(isActiveToday).length,
    totalTools: agents.reduce((sum, a) => sum + a.tools.length, 0),
  };
}

/** Sort agents: pinned → default (isActive) → lastUsedAt descending */
export function sortAgents(agents: AgentListItem[]): AgentListItem[] {
  return [...agents].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
  });
}

/**
 * Filter agents by query string (name, model, connector), active-only flag,
 * and archived visibility.
 * Note: `activeOnly` filters on `agent.isActive` (user-set stored flag),
 * NOT on `isActiveToday()` (recency from lastUsedAt).
 */
export function filterAgents(agents: AgentListItem[], filters: AgentFilters): AgentListItem[] {
  return agents.filter((a) => {
    if (!filters.showArchived && a.isArchived) return false;
    if (filters.showArchived && !a.isArchived) return false;
    if (filters.activeOnly && !a.isActive) return false;
    if (!filters.query) return true;
    const q = filters.query.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q) ||
      a.connector.toLowerCase().includes(q)
    );
  });
}
