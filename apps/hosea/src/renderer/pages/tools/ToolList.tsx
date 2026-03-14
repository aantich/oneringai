import type { ToolCategoryId, ToolListItem } from './toolTypes.js';
import { getCatIcon, getCatLabel, groupByCategory } from './toolUtils.js';

interface Props {
  tools: ToolListItem[];
  selectedTool: string | null;
  selectedCat: string;
  onSelect: (name: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
}

export function ToolList({ tools, selectedTool, selectedCat, onSelect, onToggle }: Props) {
  const grouped = groupByCategory(tools);

  const title = selectedCat === 'all'
    ? 'All Tools'
    : getCatLabel(selectedCat as ToolCategoryId);

  return (
    <div className="tool-list">
      <div className="tool-list__header">
        <div className="tool-list__title">
          {title}
          <span className="tool-list__title-count">{tools.length}</span>
        </div>
        <div className="tool-list__hint">Click a tool to inspect</div>
      </div>

      {[...grouped.entries()].map(([cat, catTools]) => (
        <div key={cat}>
          <div className="tool-group-header">
            <span>{getCatIcon(cat)}</span>
            <span>{getCatLabel(cat)}</span>
          </div>
          {catTools.map((tool) => (
            <ToolRow
              key={tool.name}
              tool={tool}
              selected={tool.name === selectedTool}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ToolRowProps {
  tool: ToolListItem;
  selected: boolean;
  onSelect: (name: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
}

function ToolRow({ tool, selected, onSelect, onToggle }: ToolRowProps) {
  const rowClass = [
    'tool-row',
    selected ? 'tool-row--selected' : '',
    !tool.enabled ? 'tool-row--disabled' : '',
  ].filter(Boolean).join(' ');

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    onToggle(tool.name, !tool.enabled);
  }

  return (
    <div className={rowClass} onClick={() => onSelect(tool.name)}>
      <div
        className="tool-row__icon"
        style={{ background: `color-mix(in srgb, var(--cat-${tool.category}) 15%, white)` }}
      >
        {getCatIcon(tool.category)}
      </div>
      <div className="tool-row__body">
        <div className="tool-row__name">{tool.name}</div>
        <div className="tool-row__desc">{tool.description}</div>
      </div>
      <div className="tool-row__meta">
        <span className={`perm-badge perm-badge--${tool.safeByDefault ? 'safe' : 'approval'}`}>
          {tool.safeByDefault ? 'Safe' : 'Approval'}
        </span>
        <button
          className={`tool-toggle${tool.enabled ? ' tool-toggle--on' : ''}`}
          onClick={handleToggle}
          title={tool.enabled ? 'Disable tool' : 'Enable tool'}
        >
          <span className="tool-toggle__track" />
          <span className="tool-toggle__thumb" />
        </button>
      </div>
    </div>
  );
}
