/**
 * Mermaid Diagram Renderer
 * Renders mermaid diagram code into SVG.
 *
 * Requires `mermaid` as an optional peer dependency.
 */

import React, { useEffect, useRef, useState, useId } from 'react';
import type { MermaidDiagramProps } from './types.js';

export function MermaidDiagram({ code, onError }: MermaidDiagramProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const uniqueId = useId().replace(/:/g, '_');

  useEffect(() => {
    let mounted = true;

    const renderDiagram = async () => {
      if (!code.trim()) {
        setIsRendering(false);
        return;
      }

      try {
        setIsRendering(true);

        // Dynamic import — mermaid is an optional peer dep
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
        });

        // Preprocess common issues
        let processedCode = code.trim();
        if (processedCode.startsWith('usecase')) {
          processedCode = processedCode.replace(/^usecase/, 'flowchart TD');
        }
        processedCode = processedCode
          .replace(/<br>/gi, '<br/>')
          .replace(/\s*<--\s*/g, ' --> ');

        // Timeline/journey: parentheses break Mermaid's parser (they denote sections)
        // Replace them with brackets in data lines only
        if (/^\s*(timeline|journey)(\s|$)/im.test(processedCode)) {
          processedCode = processedCode
            .split('\n')
            .map((line) => {
              const trimmed = line.trim();
              if (
                /^\s*(timeline|journey|title|section|%%)/i.test(trimmed) ||
                trimmed === ''
              ) {
                return line;
              }
              return line.replace(/\(/g, '[').replace(/\)/g, ']');
            })
            .join('\n');
        }

        const { svg: renderedSvg } = await mermaid.render(
          `mermaid-${uniqueId}`,
          processedCode,
        );

        if (mounted) {
          setSvg(renderedSvg);
          setIsRendering(false);
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
        if (mounted) {
          setIsRendering(false);
          if (onError) {
            onError(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
    };

    renderDiagram();
    return () => { mounted = false; };
  }, [code, uniqueId, onError]);

  if (isRendering) {
    return (
      <div className="mermaid-diagram mermaid-diagram--loading">
        <div className="rui-spinner" role="status">
          <span className="rui-visually-hidden">Rendering diagram...</span>
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-diagram mermaid-diagram--empty">
        <span>No diagram to render</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default MermaidDiagram;
