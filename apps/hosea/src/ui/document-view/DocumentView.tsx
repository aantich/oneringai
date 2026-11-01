import React, { useCallback, useMemo, useRef, useState } from 'react';
import { X, Upload, Loader2, Save, FolderOpen } from 'lucide-react';
import { DocumentBlock } from './DocumentBlock.js';
import { useOrderPersistence } from '../context-display/useOrderPersistence.js';
import { formatValueForDisplay } from '../context-display/utils.js';
import type { IDocumentViewProps, DocumentExportContext, SaveDocumentInput, DocumentVisibility, DocumentSummary } from './types.js';

export const DocumentView: React.FC<IDocumentViewProps> = ({
  entries,
  onClose,
  onSaveEntry,
  onExport,
  storageKey = 'rui-context-order',
  filterEntries,
  pinnedKeys,
  readOnly,
  onSaveDocument,
  onListDocuments,
  onLoadDocument,
  onPrefillMetadata,
  sharedDocsBaseUrl,
}) => {
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveVisibility, setSaveVisibility] = useState<DocumentVisibility>('private');
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loadDocs, setLoadDocs] = useState<DocumentSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<{ slug: string } | null>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const pinnedSet = useMemo(() => new Set(pinnedKeys ?? []), [pinnedKeys]);

  // Filter visible entries (same logic as ContextDisplayPanel)
  const visibleEntries = useMemo(() => {
    if (filterEntries) return filterEntries(entries);
    return entries.filter((e) => e.showInUI || pinnedSet.has(e.key));
  }, [entries, filterEntries, pinnedSet]);

  // Respect drag-and-drop order from ContextDisplayPanel
  const { sortedEntries } = useOrderPersistence(visibleEntries, storageKey);

  const handleToggleExclude = useCallback((key: string) => {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Combined markdown of non-excluded entries
  const combinedMarkdown = useMemo(
    () =>
      sortedEntries
        .filter((e) => !excludedKeys.has(e.key))
        .map((e) => {
          const header = `## ${e.description || e.key}`;
          const priority = e.priority ? ` \`[${e.priority}]\`` : '';
          return `${header}${priority}\n\n${formatValueForDisplay(e.value)}`;
        })
        .join('\n\n---\n\n'),
    [sortedEntries, excludedKeys],
  );

  // Build sections from current visible, non-excluded entries
  const buildSections = useCallback((): SaveDocumentInput['sections'] => {
    return sortedEntries
      .filter((e) => !excludedKeys.has(e.key))
      .map((e, idx) => ({
        key: e.key,
        value: typeof e.value === 'string' ? e.value : JSON.stringify(e.value),
        description: e.description,
        sortOrder: idx,
      }));
  }, [sortedEntries, excludedKeys]);

  const handleOpenSaveModal = useCallback(async () => {
    const sections = buildSections();
    setShowSaveModal(true);
    setSaveTitle('');
    setSaveDescription('');
    setSaveVisibility('private');

    if (onPrefillMetadata && sections.length > 0) {
      setIsPrefilling(true);
      try {
        const prefill = await onPrefillMetadata(sections);
        setSaveTitle(prefill.title);
        setSaveDescription(prefill.description ?? '');
      } catch {
        // Prefill failed — user fills manually
      } finally {
        setIsPrefilling(false);
      }
    }
  }, [buildSections, onPrefillMetadata]);

  const handleSaveDocument = useCallback(async () => {
    if (!onSaveDocument || !saveTitle.trim()) return;
    setIsSaving(true);
    try {
      const result = await onSaveDocument({
        title: saveTitle.trim(),
        description: saveDescription.trim() || undefined,
        visibility: saveVisibility,
        sections: buildSections(),
      });
      setShowSaveModal(false);
      if (result?.slug) {
        setSaveSuccess({ slug: result.slug });
        setTimeout(() => setSaveSuccess(null), 8000);
      }
    } catch (err) {
      console.error('Document save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [onSaveDocument, saveTitle, saveDescription, saveVisibility, buildSections]);

  const handleOpenLoadModal = useCallback(async () => {
    if (!onListDocuments) return;
    setShowLoadModal(true);
    setIsLoadingList(true);
    try {
      const docs = await onListDocuments();
      setLoadDocs(docs);
    } catch (err) {
      console.error('Failed to list documents:', err);
      setLoadDocs([]);
    } finally {
      setIsLoadingList(false);
    }
  }, [onListDocuments]);

  const handleSelectDocument = useCallback(async (docId: string) => {
    if (!onLoadDocument) return;
    setIsLoadingDoc(docId);
    try {
      await onLoadDocument(docId);
      setShowLoadModal(false);
    } catch (err) {
      console.error('Failed to load document:', err);
    } finally {
      setIsLoadingDoc(null);
    }
  }, [onLoadDocument]);

  const handleExport = useCallback(
    async (format: 'pdf' | 'docx') => {
      if (!onExport) return;
      setIsExporting(true);
      setExportDropdownOpen(false);
      try {
        const ctx: DocumentExportContext = {
          element: documentRef.current,
          markdownContent: combinedMarkdown,
        };
        await onExport(format, ctx);
      } catch (err) {
        console.error('Document export failed:', err);
      } finally {
        setIsExporting(false);
      }
    },
    [onExport, combinedMarkdown],
  );

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!exportDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportDropdownOpen]);

  const includedCount = sortedEntries.filter((e) => !excludedKeys.has(e.key)).length;

  return (
    <div className="dv-container">
      {/* Top bar */}
      <div className="dv-topbar">
        <div className="dv-topbar__info">
          <span className="dv-topbar__count">
            {includedCount} of {sortedEntries.length} blocks
          </span>
        </div>

        <div className="dv-topbar__actions">
          {onSaveDocument && !readOnly && (
            <button
              className="dv-topbar__btn"
              onClick={handleOpenSaveModal}
              disabled={isSaving}
              title="Save as document"
            >
              {isSaving ? <Loader2 size={16} className="dv-spinner" /> : <Save size={16} />}
              <span>Save</span>
            </button>
          )}
          {onListDocuments && onLoadDocument && (
            <button
              className="dv-topbar__btn"
              onClick={handleOpenLoadModal}
              title="Load saved document"
            >
              <FolderOpen size={16} />
              <span>Load</span>
            </button>
          )}
          {onExport && (
            <div className="dv-export" ref={dropdownRef}>
              <button
                className="dv-topbar__btn"
                onClick={() => setExportDropdownOpen((prev) => !prev)}
                disabled={isExporting}
                title="Export document"
              >
                {isExporting ? (
                  <Loader2 size={16} className="dv-spinner" />
                ) : (
                  <Upload size={16} />
                )}
                <span>Export</span>
              </button>
              {exportDropdownOpen && (
                <div className="dv-export__menu" role="menu">
                  <button
                    className="dv-export__item"
                    role="menuitem"
                    onClick={() => handleExport('pdf')}
                  >
                    Export as PDF
                  </button>
                  <button
                    className="dv-export__item"
                    role="menuitem"
                    onClick={() => handleExport('docx')}
                  >
                    Export as DOCX
                  </button>
                </div>
              )}
            </div>
          )}
          {!readOnly && (
            <button className="dv-topbar__btn dv-topbar__btn--close" onClick={onClose} title="Exit document mode">
              <X size={16} />
              <span>Exit</span>
            </button>
          )}
        </div>
      </div>

      {/* Document body — centered, Word-like */}
      <div className="dv-scroll">
        <div className="dv-document" ref={documentRef}>
          {sortedEntries.map((entry, index) => (
            <React.Fragment key={entry.key}>
              <DocumentBlock
                entry={entry}
                isExcluded={excludedKeys.has(entry.key)}
                onToggleExclude={handleToggleExclude}
                onSaveEntry={onSaveEntry}
                readOnly={readOnly}
              />
              {/* Faint separator between blocks (not after last) */}
              {index < sortedEntries.length - 1 && (
                <hr className="dv-separator" />
              )}
            </React.Fragment>
          ))}

          {sortedEntries.length === 0 && (
            <div className="dv-empty">
              <p>No context entries to display.</p>
            </div>
          )}
        </div>
      </div>

      {/* Save success toast */}
      {saveSuccess && (
        <div className="dv-toast">
          <span>Document saved!</span>
          {sharedDocsBaseUrl && (
            <a
              className="dv-toast__link"
              href={`${sharedDocsBaseUrl}/${saveSuccess.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open link
            </a>
          )}
          <button className="dv-toast__close" onClick={() => setSaveSuccess(null)}>&times;</button>
        </div>
      )}

      {/* Load Document Picker Modal */}
      {showLoadModal && (
        <div className="dv-modal-overlay" onClick={() => !isLoadingDoc && setShowLoadModal(false)}>
          <div className="dv-modal dv-modal--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="dv-modal__title">Load Document</h3>
            {isLoadingList ? (
              <div className="dv-load-list__loading">
                <Loader2 size={20} className="dv-spinner" />
                <span>Loading documents...</span>
              </div>
            ) : loadDocs.length === 0 ? (
              <div className="dv-load-list__empty">No saved documents found.</div>
            ) : (
              <div className="dv-load-list">
                {loadDocs.map((doc) => (
                  <button
                    key={doc._id}
                    className="dv-load-list__item"
                    onClick={() => handleSelectDocument(doc._id)}
                    disabled={!!isLoadingDoc}
                  >
                    <div className="dv-load-list__info">
                      <span className="dv-load-list__title">{doc.title}</span>
                      {doc.description && (
                        <span className="dv-load-list__desc">{doc.description}</span>
                      )}
                      <span className="dv-load-list__meta">
                        {doc.sectionCount} section{doc.sectionCount !== 1 ? 's' : ''}
                        {' · '}
                        {new Date(doc.updatedAt).toLocaleDateString()}
                        {doc.tags?.length ? ` · ${doc.tags.join(', ')}` : ''}
                      </span>
                    </div>
                    {isLoadingDoc === doc._id && <Loader2 size={16} className="dv-spinner" />}
                  </button>
                ))}
              </div>
            )}
            <div className="dv-modal__actions">
              <button
                className="dv-modal__btn dv-modal__btn--cancel"
                onClick={() => setShowLoadModal(false)}
                disabled={!!isLoadingDoc}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Document Modal */}
      {showSaveModal && (
        <div className="dv-modal-overlay" onClick={() => !isSaving && setShowSaveModal(false)}>
          <div className="dv-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="dv-modal__title">Save Document</h3>
            <div className="dv-modal__field">
              <label className="dv-modal__label">Title *</label>
              <input
                className="dv-modal__input"
                type="text"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder={isPrefilling ? 'Generating title...' : 'Document title'}
                disabled={isPrefilling}
                autoFocus
              />
            </div>
            <div className="dv-modal__field">
              <label className="dv-modal__label">Description</label>
              <textarea
                className="dv-modal__textarea"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder={isPrefilling ? 'Generating description...' : 'Optional description'}
                disabled={isPrefilling}
                rows={3}
              />
            </div>
            <div className="dv-modal__field">
              <label className="dv-modal__label">Visibility</label>
              <div className="dv-visibility">
                {([
                  ['private', 'Only me', 'Only you can view and edit this document'],
                  ['group', 'My team', 'Anyone in your group can view this document'],
                  ['installation', 'All users', 'All authenticated users in this installation'],
                  ['public', 'Public', 'Anyone on the web, no login required'],
                ] as const).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={`dv-visibility__option${saveVisibility === value ? ' dv-visibility__option--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={value}
                      checked={saveVisibility === value}
                      onChange={() => setSaveVisibility(value)}
                      className="dv-visibility__radio"
                    />
                    <div className="dv-visibility__content">
                      <span className="dv-visibility__label">{label}</span>
                      <span className="dv-visibility__hint">{hint}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="dv-modal__actions">
              <button
                className="dv-modal__btn dv-modal__btn--cancel"
                onClick={() => setShowSaveModal(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                className="dv-modal__btn dv-modal__btn--save"
                onClick={handleSaveDocument}
                disabled={isSaving || !saveTitle.trim() || isPrefilling}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
