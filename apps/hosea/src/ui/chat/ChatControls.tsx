/**
 * ChatControls — Execution control buttons for chat.
 *
 * Provides pause/resume/cancel controls for agent execution.
 * Framework-agnostic: uses plain HTML buttons with CSS classes.
 */

import React, { memo } from 'react';
import { Pause, Play, XCircle, Loader } from 'lucide-react';
import type { IChatControlsProps } from './types.js';

export const ChatControls: React.FC<IChatControlsProps> = memo(
  ({
    isRunning = false,
    isPaused = false,
    hasError = false,
    onPause,
    onResume,
    onCancel,
    disabled = false,
    className = '',
    size,
  }) => {
    if (!isRunning && !isPaused) {
      return null;
    }

    const sizeClass = size ? `chat-controls--${size}` : '';

    return (
      <div className={`chat-controls ${sizeClass} ${className}`}>
        <div className="chat-controls__buttons">
          {isPaused ? (
            <button
              className="chat-controls__btn chat-controls__btn--resume"
              onClick={onResume}
              disabled={disabled || !onResume}
              title="Resume execution"
            >
              <Play size={14} />
              <span>Resume</span>
            </button>
          ) : (
            <button
              className="chat-controls__btn chat-controls__btn--pause"
              onClick={onPause}
              disabled={disabled || !onPause || !isRunning}
              title="Pause execution"
            >
              <Pause size={14} />
              <span>Pause</span>
            </button>
          )}

          <button
            className="chat-controls__btn chat-controls__btn--cancel"
            onClick={onCancel}
            disabled={disabled || !onCancel}
            title="Cancel execution"
          >
            <XCircle size={14} />
            <span>Cancel</span>
          </button>
        </div>

        <div className="chat-controls__status">
          {isPaused ? (
            <span className="chat-controls__status-text chat-controls__status-text--paused">
              <Pause size={14} /> Paused
            </span>
          ) : isRunning ? (
            <span className="chat-controls__status-text chat-controls__status-text--running">
              <Loader size={14} className="chat-controls__spinner" /> Running
            </span>
          ) : hasError ? (
            <span className="chat-controls__status-text chat-controls__status-text--error">Error</span>
          ) : null}
        </div>
      </div>
    );
  },
);

ChatControls.displayName = 'ChatControls';

export default ChatControls;
