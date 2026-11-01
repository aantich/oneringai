/**
 * Markdown rendering components.
 *
 * Usage:
 *   import { MarkdownRenderer, CodeBlock } from '../index.js';
 *   import 'Hosea local UI styles/markdown';
 */

export { MarkdownRenderer, useMarkdownContext } from './MarkdownRenderer.js';
export { CodeBlock } from './CodeBlock.js';
export { MermaidDiagram } from './MermaidDiagram.js';
export { VegaChart } from './VegaChart.js';
export { MarkmapRenderer } from './MarkmapRenderer.js';
export { RenderErrorBoundary } from './RenderErrorBoundary.js';

export type {
  MarkdownRendererProps,
  CodeBlockProps,
  MermaidDiagramProps,
  VegaChartProps,
  MarkmapRendererProps,
  RenderErrorBoundaryProps,
} from './types.js';

// Re-export interactive UI action type for convenience
export type { OnInteractiveAction, InteractiveUIAction } from '../interactive-ui/types.js';
