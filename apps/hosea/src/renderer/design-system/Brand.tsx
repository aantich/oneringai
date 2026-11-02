import React from 'react';

/** The open arch: an original, single-color h that stays legible at 16px. */
export function HoseaMark({ size = 32, className = '' }: { size?: number; className?: string }): React.ReactElement {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <path d="M11 8v24m0-13c0-10 18-10 18 0v13" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
  </svg>;
}

export function HoseaBrand({ compact = false }: { compact?: boolean }): React.ReactElement {
  return <span className="hosea-brand" aria-label="hosea"><HoseaMark size={34} />{!compact && <span>hosea</span>}</span>;
}
