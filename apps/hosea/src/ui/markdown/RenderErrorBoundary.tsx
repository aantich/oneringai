/**
 * Error boundary for safe rendering of markdown special blocks.
 * Catches rendering errors from KaTeX, Mermaid, Vega, Markmap, etc.
 * and shows a friendly fallback instead of crashing the entire UI.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
  rendererType?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class RenderErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    if (!this.isBenignError(error)) {
      console.warn(
        `Renderer error (${this.props.rendererType || 'unknown'}):`,
        error.message,
      );
    }
  }

  private isBenignError(error: Error): boolean {
    const benignPatterns = [
      /translate\(NaN,NaN\)/,
      /Expected number/,
      /katex/i,
      /vega/i,
      /mermaid/i,
      /markmap/i,
    ];
    return benignPatterns.some((pattern) => pattern.test(error.message));
  }

  render() {
    if (this.state.hasError) {
      const rendererType = this.props.rendererType || 'content';
      const fallbackMessage = this.props.fallbackMessage || `Error rendering ${rendererType}`;

      return (
        <div className="render-error-boundary">
          <small>
            <strong>{fallbackMessage}</strong>
            <div className="render-error-boundary__detail">
              The content may contain formatting issues that prevent proper rendering.
            </div>
          </small>
        </div>
      );
    }

    return this.props.children;
  }
}

export default RenderErrorBoundary;
