import { env } from '../runtime/environment.js';
/**
 * Metrics collection infrastructure
 *
 * Pluggable metrics system with support for various backends.
 */

/**
 * Metric tags
 */
export type MetricTags = Record<string, string | number | boolean>;

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
  /**
   * Increment a counter
   */
  increment(metric: string, value?: number, tags?: MetricTags): void;

  /**
   * Set a gauge value
   */
  gauge(metric: string, value: number, tags?: MetricTags): void;

  /**
   * Record a timing/duration
   */
  timing(metric: string, duration: number, tags?: MetricTags): void;

  /**
   * Record a histogram value
   */
  histogram(metric: string, value: number, tags?: MetricTags): void;
}

/**
 * No-op metrics collector (default - zero overhead)
 */
export class NoOpMetrics implements MetricsCollector {
  increment(): void {}
  gauge(): void {}
  timing(): void {}
  histogram(): void {}
}

/**
 * Console metrics collector (development/debugging)
 */
export class ConsoleMetrics implements MetricsCollector {
  private prefix: string;

  constructor(prefix: string = 'oneringai') {
    this.prefix = prefix;
  }

  increment(metric: string, value: number = 1, tags?: MetricTags): void {
    this.log('COUNTER', metric, value, tags);
  }

  gauge(metric: string, value: number, tags?: MetricTags): void {
    this.log('GAUGE', metric, value, tags);
  }

  timing(metric: string, duration: number, tags?: MetricTags): void {
    this.log('TIMING', metric, `${duration}ms`, tags);
  }

  histogram(metric: string, value: number, tags?: MetricTags): void {
    this.log('HISTOGRAM', metric, value, tags);
  }

  private log(type: string, metric: string, value: any, tags?: MetricTags): void {
    const fullMetric = `${this.prefix}.${metric}`;
    const tagsStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.log(`[METRIC:${type}] ${fullMetric}=${value}${tagsStr}`);
  }
}

/**
 * In-memory metrics aggregator (testing/development)
 */
export class InMemoryMetrics implements MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private timings = new Map<string, number[]>();
  private histograms = new Map<string, number[]>();

  increment(metric: string, value: number = 1, tags?: MetricTags): void {
    const key = this.makeKey(metric, tags);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  gauge(metric: string, value: number, tags?: MetricTags): void {
    const key = this.makeKey(metric, tags);
    this.gauges.set(key, value);
  }

  timing(metric: string, duration: number, tags?: MetricTags): void {
    const key = this.makeKey(metric, tags);
    const timings = this.timings.get(key) || [];
    timings.push(duration);
    this.timings.set(key, timings);
  }

  histogram(metric: string, value: number, tags?: MetricTags): void {
    const key = this.makeKey(metric, tags);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  private makeKey(metric: string, tags?: MetricTags): string {
    if (!tags) return metric;
    const tagStr = Object.entries(tags)
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join(',');
    return `${metric}{${tagStr}}`;
  }

  /**
   * Get all metrics (for testing)
   */
  getMetrics(): {
    counters: Map<string, number>;
    gauges: Map<string, number>;
    timings: Map<string, number[]>;
    histograms: Map<string, number[]>;
  } {
    return {
      counters: new Map(this.counters),
      gauges: new Map(this.gauges),
      timings: new Map(this.timings),
      histograms: new Map(this.histograms),
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.timings.clear();
    this.histograms.clear();
  }

  /**
   * Get summary statistics for timings
   */
  getTimingStats(metric: string, tags?: MetricTags): {
    count: number;
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const key = this.makeKey(metric, tags);
    const timings = this.timings.get(key);

    if (!timings || timings.length === 0) {
      return null;
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      min: sorted[0] ?? 0,
      max: sorted[count - 1] ?? 0,
      mean: sum / count,
      p50: sorted[Math.floor(count * 0.5)] ?? 0,
      p95: sorted[Math.floor(count * 0.95)] ?? 0,
      p99: sorted[Math.floor(count * 0.99)] ?? 0,
    };
  }
}

/**
 * Metrics collector type
 */
export type MetricsCollectorType = 'noop' | 'console' | 'inmemory';

/**
 * Create metrics collector from type
 */
export function createMetricsCollector(type?: MetricsCollectorType, prefix?: string): MetricsCollector {
  const collectorType = type || (env('METRICS_COLLECTOR') as MetricsCollectorType) || 'noop';

  switch (collectorType) {
    case 'console':
      return new ConsoleMetrics(prefix);
    case 'inmemory':
      return new InMemoryMetrics();
    default:
      return new NoOpMetrics();
  }
}

/**
 * Global metrics singleton
 */
export const metrics: MetricsCollector = createMetricsCollector(
  undefined,
  env('METRICS_PREFIX') || 'oneringai'
);

/**
 * Update global metrics collector
 */
export function setMetricsCollector(collector: MetricsCollector): void {
  Object.assign(metrics, collector);
}
