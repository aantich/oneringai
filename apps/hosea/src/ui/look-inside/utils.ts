/**
 * Utility functions for Look Inside components.
 */

/**
 * Format bytes to a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format a number with comma separators.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Get a CSS color class name based on utilization percentage.
 */
export function getUtilizationColor(percent: number): string {
  if (percent >= 90) return 'look-inside-utilization-critical';
  if (percent >= 70) return 'look-inside-utilization-warning';
  return 'look-inside-utilization-normal';
}

/**
 * Get a utilization label.
 */
export function getUtilizationLabel(percent: number): string {
  if (percent >= 90) return 'Critical';
  if (percent >= 70) return 'Warning';
  return 'Normal';
}

/**
 * Truncate text with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format a plugin name to display name.
 * e.g., 'working_memory' → 'Working Memory'
 */
export function formatPluginName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a timestamp to a relative or absolute string.
 */
export function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return new Date(ts).toLocaleDateString();
}
