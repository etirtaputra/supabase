'use client';
/**
 * EPC Description Library — owner-only. The texts for proposal lines that are
 * not catalogue items, curated in components/library/LibraryManager (shared
 * with the Sales library, separate data).
 *
 * Replaced 2026-11-04: the old page renamed, merged and deleted by rewriting
 * line text in EVERY proposal — sent ones included — with no log. Now every
 * change goes through the logged, undoable library_* functions and only
 * draft proposals are reworded.
 */
import Link from 'next/link';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useT } from '@/hooks/useT';
import LibraryManager from '@/components/library/LibraryManager';

export default function DescriptionLibraryPage() {
  const { t } = useT();
  const gate = useQuotesGate(false, '/proposals/library');
  const isOwner = gate.profile?.role === 'owner';
  usePageTitle();

  if (!gate.ready) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4 text-slate-400 text-sm">
        <p>{t('The Description Library is only available to Owners.')}</p>
        <Link href="/proposals" className="text-violet-400 hover:text-violet-300 transition-colors">{t('Back to quotes')}</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-slate-200 font-sans text-sm">
      <div className="sticky top-0 z-40 bg-canvas/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/proposals" className="text-slate-500 hover:text-slate-300 transition-colors" aria-label={t('Back to quotes')}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">{t('Description Library')}</h1>
            <p className="text-slate-500 text-[11px] mt-0.5">{t('EPC proposals — one wording per item, every change logged')}</p>
          </div>
        </div>
      </div>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
        <LibraryManager library="epc" />
      </main>
    </div>
  );
}
