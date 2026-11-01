/**
 * SystemPromptSection — Code block display for system prompt.
 */

import React from 'react';

interface SystemPromptSectionProps {
  content: string | null;
}

export const SystemPromptSection: React.FC<SystemPromptSectionProps> = ({
  content,
}) => {
  if (!content) {
    return (
      <div className="look-inside-system-prompt">
        <span className="look-inside-muted">No system prompt configured</span>
      </div>
    );
  }

  return (
    <div className="look-inside-system-prompt">
      <pre className="look-inside-code-block">
        <code>{content}</code>
      </pre>
    </div>
  );
};
