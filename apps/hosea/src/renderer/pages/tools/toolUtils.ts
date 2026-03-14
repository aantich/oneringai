import type { ToolCategoryId, ToolCategoryMeta, ToolListItem, ToolSchemaParam } from './toolTypes.js';

/** Human-readable label for each category */
export function getCatLabel(category: ToolCategoryId | 'all'): string {
  const labels: Record<string, string> = {
    all: 'All Tools',
    filesystem: 'Filesystem',
    shell: 'Shell',
    web: 'Web',
    code: 'Code',
    json: 'JSON',
    routines: 'Routines',
    desktop: 'Desktop',
    'custom-tools': 'Custom Tools',
    other: 'Other',
  };
  return labels[category] ?? category;
}

/** Emoji icon for each category */
export function getCatIcon(category: ToolCategoryId | 'all'): string {
  const icons: Record<string, string> = {
    all: '⊞',
    filesystem: '📁',
    shell: '💻',
    web: '🌐',
    code: '⚙️',
    json: '{ }',
    routines: '🔄',
    desktop: '🖥',
    'custom-tools': '⭐',
    other: '•',
  };
  return icons[category] ?? '•';
}

/** CSS color token suffix for each category (used as data-cat attribute) */
export function getCatColor(category: ToolCategoryId | string): string {
  const colors: Record<string, string> = {
    filesystem: 'blue',
    shell: 'slate',
    web: 'purple',
    code: 'amber',
    json: 'teal',
    routines: 'violet',
    desktop: 'cyan',
    'custom-tools': 'gold',
    other: 'gray',
  };
  return colors[category] ?? 'gray';
}

/** Group tools by category, preserving insertion order */
export function groupByCategory(tools: ToolListItem[]): Map<ToolCategoryId, ToolListItem[]> {
  const map = new Map<ToolCategoryId, ToolListItem[]>();
  for (const tool of tools) {
    const group = map.get(tool.category);
    if (group) {
      group.push(tool);
    } else {
      map.set(tool.category, [tool]);
    }
  }
  return map;
}

/** Build ToolCategoryMeta list from tools, including the 'all' entry */
export function buildCategoryMeta(tools: ToolListItem[]): ToolCategoryMeta[] {
  const grouped = groupByCategory(tools);
  const all: ToolCategoryMeta = {
    id: 'all',
    label: 'All Tools',
    icon: getCatIcon('all'),
    count: tools.length,
  };
  const cats: ToolCategoryMeta[] = [];
  for (const [id, group] of grouped) {
    cats.push({
      id,
      label: getCatLabel(id),
      icon: getCatIcon(id),
      count: group.length,
    });
  }
  return [all, ...cats];
}

/**
 * Parse a JSON Schema parameters object into a flat ToolSchemaParam array.
 * Handles the standard { type: 'object', properties: {...}, required: [...] } shape.
 */
export function parseSchema(raw: unknown): ToolSchemaParam[] {
  if (!raw || typeof raw !== 'object') return [];
  const schema = raw as Record<string, unknown>;
  const properties = schema['properties'];
  if (!properties || typeof properties !== 'object') return [];
  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];

  return Object.entries(properties as Record<string, unknown>).map(([name, def]) => {
    const d = (def ?? {}) as Record<string, unknown>;
    const type = typeof d['type'] === 'string' ? d['type'] : 'any';
    const description = typeof d['description'] === 'string' ? d['description'] : '';
    return {
      name,
      type,
      required: required.includes(name),
      description,
    };
  });
}

/** Filter tools by search query (name + description) and permission filter */
export function filterTools(
  tools: ToolListItem[],
  query: string,
  filter: 'all' | 'safe' | 'approval',
): ToolListItem[] {
  return tools.filter((t) => {
    if (filter === 'safe' && !t.safeByDefault) return false;
    if (filter === 'approval' && t.safeByDefault) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
  });
}
