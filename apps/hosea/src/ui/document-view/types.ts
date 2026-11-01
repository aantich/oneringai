import type { InContextEntry } from 'oneringai';

/**
 * Document visibility level — maps to NimbleAudit Entity/IResource permission fields.
 *
 * - 'private':      only the owner (ownerId) can access
 * - 'group':        owner's group can read (groupId set)
 * - 'installation': all authenticated users can read (permissions.read.all = true)
 * - 'public':       anyone, including unauthenticated users (isPublic = true)
 */
export type DocumentVisibility = 'private' | 'group' | 'installation' | 'public';

/** Sections to persist when saving a document */
export interface SaveDocumentInput {
  title: string;
  description?: string;
  visibility: DocumentVisibility;
  sections: Array<{
    key: string;
    value: string;
    description?: string;
    sortOrder: number;
  }>;
}

/** Metadata prefilled by LLM (optional) */
export interface PrefillMetadata {
  title: string;
  description?: string;
}

/** Summary of a saved document (for the load picker) */
export interface DocumentSummary {
  _id: string;
  title: string;
  description?: string;
  slug: string;
  updatedAt: number | string | Date;
  tags?: string[];
  sectionCount: number;
}

export interface IDocumentViewProps {
  /** All context entries (will be filtered/ordered internally) */
  entries: InContextEntry[];
  /** Called when user closes document mode */
  onClose: () => void;
  /** Called when user saves an edited block */
  onSaveEntry?: (key: string, newValue: string) => Promise<void>;
  /** Called when user exports the document */
  onExport?: (format: 'pdf' | 'docx', ctx: DocumentExportContext) => Promise<void>;
  /** localStorage key for order persistence (shared with ContextDisplayPanel) */
  storageKey?: string;
  /** Custom filter (same as ContextDisplayPanel) */
  filterEntries?: (entries: InContextEntry[]) => InContextEntry[];
  /** Currently pinned entry keys */
  pinnedKeys?: string[];
  /** If true, hides the Edit and Exit buttons (view-only mode) */
  readOnly?: boolean;

  // ─── Document persistence callbacks ────────────────────────────────────
  /** Called when user saves the current entries as a persistent document. App provides storage logic. Returns the saved doc summary (for success feedback). */
  onSaveDocument?: (input: SaveDocumentInput) => Promise<{ slug: string } | void>;
  /** Called to list available documents for the load picker. App provides storage logic. */
  onListDocuments?: () => Promise<DocumentSummary[]>;
  /** Called when user selects a document to load. App loads sections into context. */
  onLoadDocument?: (docId: string) => Promise<void>;
  /** Optional LLM-powered prefill for title/description. Called with current sections. */
  onPrefillMetadata?: (sections: SaveDocumentInput['sections']) => Promise<PrefillMetadata>;
  /** Base URL for shared document links (e.g. "https://app.everworker.ai/shared/docs"). If provided, shows link after save. */
  sharedDocsBaseUrl?: string;
}

export interface DocumentExportContext {
  /** DOM element containing the full document (for screenshot/capture) */
  element: HTMLElement | null;
  /** Combined markdown content of all visible (non-excluded) entries */
  markdownContent: string;
}

export interface IDocumentBlockProps {
  entry: InContextEntry;
  /** Whether this block is excluded from the document */
  isExcluded: boolean;
  /** Toggle exclude state */
  onToggleExclude: (key: string) => void;
  /** Called when user saves edited content */
  onSaveEntry?: (key: string, newValue: string) => Promise<void>;
  /** If true, hides the Edit button (view-only mode) */
  readOnly?: boolean;
}
