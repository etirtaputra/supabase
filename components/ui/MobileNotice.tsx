'use client';
import { useEffect, useState } from 'react';

/**
 * Small, dismissible banner shown only on phone-width screens (sm:hidden).
 * Sets the expectation that mobile is for searching and viewing, with
 * editing best done on desktop. Dismissal is remembered in localStorage so
 * it never nags twice.
 *
 *   variant="view"  — for browse/search surfaces (Insights, Quotes list)
 *   variant="edit"  — for editing-heavy surfaces (Catalog, quote editor)
 */
export default function MobileNotice({ variant = 'view' }: { variant?: 'view' | 'edit' }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('icaproc_mobile_notice') === 'dismissed') return;
    // Only bother on actual small viewports
    if (window.matchMedia('(min-width: 640px)').matches) return;
    setShow(true);
  }, []);

  if (!show) return null;

  const msg = variant === 'edit'
    ? 'Mobile is tuned for search & viewing. Editing works, but the full experience — spreadsheet entry, drag-and-drop, exports — is best on a desktop.'
    : 'Mobile is tuned for search & viewing. For full editing, open ICAPROC on a desktop.';

  return (
    <div className="sm:hidden flex items-start gap-2.5 mb-3 px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-200/90 text-[11px] leading-snug">
      <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      <span className="flex-1">{msg}</span>
      <button
        onClick={() => { localStorage.setItem('icaproc_mobile_notice', 'dismissed'); setShow(false); }}
        className="flex-shrink-0 text-emerald-300/60 hover:text-emerald-100 transition-colors -mt-0.5"
        aria-label="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}
