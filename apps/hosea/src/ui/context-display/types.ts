import type { InContextEntry } from 'oneringai';
import type { OnInteractiveAction } from '../interactive-ui/types.js';

export type ExportFormat = 'pdf' | 'docx';

export interface ExportContext {
  /** DOM element containing all entries (for screenshot/capture) */
  element: HTMLElement | null;
  /** Combined markdown content of all entries */
  markdownContent: string;
}

export interface IContextDisplayPanelProps {
  entries: InContextEntry[];
  /** Key of entry to highlight and scroll to (use useDynamicUIChangeDetection hook) */
  highlightKey?: string | null;
  /** Panel title (default: "Current Context") */
  title?: string;
  /** localStorage key prefix for order persistence (default: 'rui-context-order') */
  storageKey?: string;
  className?: string;

  // Feature toggles
  /** Enable drag-and-drop reordering (default: true) */
  enableDragAndDrop?: boolean;
  /** Enable inline markdown editing (default: false, requires onSaveEntry) */
  enableEditing?: boolean;
  /** Enable export dropdown (default: false, requires onExport) */
  enableExport?: boolean;

  // App-specific callbacks
  /** Called when user saves an edited entry */
  onSaveEntry?: (key: string, newValue: string) => Promise<void>;
  /** Called when user exports (app provides PDF/DOCX logic) */
  onExport?: (format: ExportFormat, ctx: ExportContext) => Promise<void>;
  /** If provided, shows pin buttons on each card */
  onPinToggle?: (key: string, pinned: boolean) => void;
  /** Currently pinned entry keys */
  pinnedKeys?: string[];
  /** Called when maximize state changes */
  onMaximizedChange?: (isMaximized: boolean) => void;
  /** Called when user clicks the "Document Mode" button */
  onEnterDocumentMode?: () => void;

  /** Custom filter (overrides default showInUI filter) */
  filterEntries?: (entries: InContextEntry[]) => InContextEntry[];

  /** Ref to the entries container DOM element (for export capture) */
  entriesRef?: React.RefObject<HTMLDivElement>;

  /** Callback when user interacts with an interactive UI block */
  onInteractiveAction?: OnInteractiveAction;
}
