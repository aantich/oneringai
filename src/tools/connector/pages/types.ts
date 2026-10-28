/** Position in a provider collection, independent of search coverage. */
export type PagePosition =
  | { state: 'more'; continuation: string; positionId: string }
  | { state: 'end' }
  | { state: 'unknown'; reason: string };

export interface ConnectorPage<T = unknown> {
  items: T[];
  returnedCount: number;
  reportedTotal?: number;
  searchCoverage: 'complete' | 'incomplete' | 'unknown';
  position: PagePosition;
}

export type Coverage = ConnectorPage['searchCoverage'];
export interface ProviderPage {
  items: unknown[];
  reportedTotal?: number;
  coverage: Coverage;
  next?: unknown;
  end?: boolean;
  unknown?: string;
  /** Retained only when a provider position cannot be represented safely. */
  source?: unknown;
}
