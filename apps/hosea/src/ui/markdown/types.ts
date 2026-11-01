/**
 * Shared types for the markdown rendering components.
 */

import type { OnInteractiveAction } from '../interactive-ui/types.js';

export interface MarkdownRendererProps {
  /** The markdown content string to render */
  content?: string;
  /** Alternate way to pass content (backwards compat with v25 pattern) */
  children?: string;
  /** Additional CSS class name */
  className?: string;
  /** Whether the content is currently being streamed (delays special block rendering) */
  isStreaming?: boolean;
  /** Callback when user interacts with a ```ui interactive block */
  onInteractiveAction?: OnInteractiveAction;
}

export interface CodeBlockProps {
  /** Programming language identifier */
  language: string;
  /** The code string content */
  code: string;
  /** Whether the parent markdown is streaming */
  isStreaming?: boolean;
  /** Callback for interactive UI actions (passed from MarkdownContext) */
  onInteractiveAction?: OnInteractiveAction;
}

export interface MermaidDiagramProps {
  /** Mermaid diagram code */
  code: string;
  /** Callback when rendering fails */
  onError?: (error: Error) => void;
}

export interface VegaChartProps {
  /** Vega or Vega-Lite JSON specification string */
  code: string;
  /** Whether the spec is Vega-Lite (default: true) */
  isLite?: boolean;
  /** Callback when rendering fails */
  onError?: (error: Error) => void;
}

export interface MarkmapRendererProps {
  /** Markdown content for the mindmap */
  code: string;
  /** Callback when rendering fails */
  onError?: (error: Error) => void;
}

export interface RenderErrorBoundaryProps {
  children: React.ReactNode;
  /** Message shown when rendering fails */
  fallbackMessage?: string;
  /** Label for the renderer type (e.g. "mermaid diagram") */
  rendererType?: string;
}
