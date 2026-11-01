/**
 * CollapsibleSection — Reusable expand/collapse wrapper.
 * Supports both uncontrolled (defaultExpanded) and controlled (expanded + onToggle) modes.
 */

import React, { useState, useCallback } from 'react';
import type { CollapsibleSectionProps } from './types.js';

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  id,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  badge,
  icon,
  children,
  className,
}) => {
  // Uncontrolled fallback
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const toggle = useCallback(() => {
    if (onToggle) {
      onToggle(id);
    } else {
      setInternalExpanded((prev) => !prev);
    }
  }, [id, onToggle]);

  return (
    <div
      className={`look-inside-section ${expanded ? 'look-inside-section-expanded' : ''} ${className ?? ''}`}
      data-section-id={id}
    >
      <button
        type="button"
        className="look-inside-section-header"
        onClick={toggle}
        aria-expanded={expanded}
      >
        <span className="look-inside-section-chevron">
          {expanded ? '▾' : '▸'}
        </span>
        {icon && <span className="look-inside-section-icon">{icon}</span>}
        <span className="look-inside-section-title">{title}</span>
        {badge !== undefined && badge !== null && (
          <span className="look-inside-section-badge">{badge}</span>
        )}
      </button>
      {expanded && (
        <div className="look-inside-section-content">{children}</div>
      )}
    </div>
  );
};
