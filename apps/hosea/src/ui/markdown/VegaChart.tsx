/**
 * Vega/Vega-Lite Chart Renderer
 * Renders Vega or Vega-Lite JSON specifications as interactive charts.
 *
 * Requires `react-vega` and `vega-lite` as optional peer dependencies.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { VegaChartProps } from './types.js';

export function VegaChart({
  code,
  isLite = true,
  onError,
}: VegaChartProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const [parseError, setParseError] = useState<string | null>(null);
  const [VegaLiteComp, setVegaLiteComp] = useState<React.ComponentType<{ spec: unknown; actions?: Record<string, boolean>; onError?: (error: Error) => void }> | null>(null);

  // Dynamic import of react-vega (optional peer dep)
  useEffect(() => {
    import('react-vega')
      .then((mod) => setVegaLiteComp(() => mod.VegaLite))
      .catch(() => {
        setParseError('react-vega is not installed. Install it to render Vega charts.');
      });
  }, []);

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;

    const measure = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        if (width > 0) {
          setContainerWidth(Math.max(width - 32, 300));
        }
      }
    };

    const timeoutId = setTimeout(measure, 10);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, []);

  // Parse spec
  const spec = useMemo(() => {
    try {
      const parsed = JSON.parse(code);
      if (!parsed.width) parsed.width = containerWidth;
      if (!parsed.height && !parsed.encoding?.row && !parsed.encoding?.column) {
        parsed.height = 300;
      }
      setParseError(null);
      return parsed;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to parse JSON';
      setParseError(errorMsg);
      if (onError) onError(new Error(errorMsg));
      return null;
    }
  }, [code, containerWidth, onError]);

  const handleVegaError = (error: Error) => {
    console.error('Vega render error:', error);
    setParseError(error.message);
    if (onError) onError(error);
  };

  if (parseError) {
    return (
      <div className="vega-chart vega-chart--error">
        <span className="vega-chart__error-text">Error: {parseError}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="vega-chart">
      {spec && VegaLiteComp && (
        <VegaLiteComp
          spec={spec}
          actions={{ export: true, source: false, compiled: false, editor: false }}
          onError={handleVegaError}
        />
      )}
    </div>
  );
}

export default VegaChart;
