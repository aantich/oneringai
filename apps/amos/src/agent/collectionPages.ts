import type { ConnectorPage } from '@everworker/oneringai';

/** Display only the selected page contract; never turn returnedCount into a total. */
export function describeCollectionPage(name: string, value: unknown): string | null {
  if (!name.endsWith('_page') || !value || typeof value !== 'object') return null;
  const page = value as Partial<ConnectorPage>;
  if (!Array.isArray(page.items) || page.returnedCount !== page.items.length || !page.position
    || !['more', 'end', 'unknown'].includes(page.position.state) || !['complete', 'incomplete', 'unknown'].includes(String(page.searchCoverage))) return null;
  const total = Number.isSafeInteger(page.reportedTotal) && page.reportedTotal! >= 0 ? `; provider reports ${page.reportedTotal}` : '';
  const position = page.position.state === 'more' ? 'more pages available' : page.position.state === 'end' ? 'end of provider pagination' : 'continuation unknown';
  return `Returned ${page.returnedCount} items${total}; ${position}; search coverage ${page.searchCoverage}.`;
}
