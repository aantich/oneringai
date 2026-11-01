/**
 * ExportMessage — Export button with dropdown for PDF/DOCX export.
 *
 * The actual export logic is injectable via `onExport` prop so each app
 * can provide its own PDF/DOCX generation (v25 has corporate templates, Hosea may differ).
 * If no onExport is provided, the button is hidden.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Loader } from 'lucide-react';
import type { IExportMessageProps } from './types.js';

export const ExportMessage: React.FC<IExportMessageProps> = ({
  messageElement,
  markdownContent,
  onExport,
  className = '',
  disabled = false,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleExport = useCallback(async (format: 'pdf' | 'docx') => {
    if (!onExport) return;
    try {
      setIsExporting(true);
      setShowMenu(false);
      await onExport(format);
    } catch (err) {
      console.error(`${format.toUpperCase()} export failed:`, err);
    } finally {
      setIsExporting(false);
    }
  }, [onExport]);

  if (!onExport) return null;

  return (
    <div className={`export-message ${className}`} ref={menuRef}>
      <button
        className="export-message__btn"
        onClick={() => setShowMenu(!showMenu)}
        disabled={disabled || isExporting}
        title="Export this message"
      >
        {isExporting ? <Loader size={14} className="export-message__spinner" /> : <Upload size={14} />}
      </button>

      {showMenu && (
        <div className="export-message__menu">
          <button
            className="export-message__menu-item"
            onClick={() => handleExport('pdf')}
            disabled={isExporting}
          >
            Export as PDF
          </button>
          <button
            className="export-message__menu-item"
            onClick={() => handleExport('docx')}
            disabled={isExporting}
          >
            Export as DOCX
          </button>
        </div>
      )}
    </div>
  );
};

ExportMessage.displayName = 'ExportMessage';

export default ExportMessage;
