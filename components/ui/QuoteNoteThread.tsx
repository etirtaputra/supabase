'use client';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { createSupabaseClient } from '@/lib/supabase';
import { fmtDayTime } from '@/lib/formatters';
import {
  fetchThread, addNote, setNoteCleared, threadOrder, isOpen, type QuoteNote,
} from '@/lib/quoteNotes';

/**
 * The follow-up thread on a proposal — what it is waiting on, and since when.
 *
 * A chat thread rather than a notes field (owner's shape, 2026-08-27): short
 * lines, each stamped with who wrote it and when, each TICKED OFF on its own
 * when it stops mattering. The newest line still open is what the EPC
 * Proposals list shows on the row.
 *
 * DELIBERATELY NOT DISABLED BY `locked`. Everything else on this page goes
 * read-only once a proposal is SENT, because the customer has the document and
 * its contents must stop moving. A SENT proposal is exactly the one somebody
 * needs to write "awaiting answer" against, and a note changes nothing the
 * customer ever sees — it is not printed anywhere. The database agrees: the
 * write policy on 10.5 is can_view_epc(), not can_edit_quote().
 *
 * Ticked notes stay, greyed, with both dates. "Chased on the 21st, answered on
 * the 26th" is the sentence the time log exists to keep.
 */
export default function QuoteNoteThread({ quoteId, authorEmail }: {
  quoteId: string;
  authorEmail: string | null;
}) {
  const { t, tf } = useT();
  const supabase = createSupabaseClient();
  const [notes, setNotes] = useState<QuoteNote[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // Settled notes stay folded. This panel now sits ABOVE the proposal's own
  // fields, so a thread with a year of history would push the whole document
  // down the page every time someone opened it. What is open is the state;
  // the rest is the record, one click away.
  const [showSettled, setShowSettled] = useState(false);
  // A note ticked in this sitting stays on screen, struck through, rather than
  // vanishing under the cursor — the tick should read as "settled", not as
  // "deleted". It folds away with the rest next time the panel is opened.
  const [justToggled, setJustToggled] = useState<number[]>([]);

  const load = useCallback(() => {
    fetchThread(supabase, quoteId).then((rows) => setNotes(threadOrder(rows))).catch(() => setNotes([]));
  }, [quoteId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const post = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const saved = await addNote(supabase, quoteId, text, authorEmail);
    setBusy(false);
    if (!saved) return;
    setBody('');
    setNotes((prev) => threadOrder([saved, ...(prev ?? [])]));
  };

  const toggle = async (n: QuoteNote) => {
    const next = isOpen(n);
    setJustToggled((prev) => (prev.includes(n.note_id) ? prev : [...prev, n.note_id]));
    // Optimistic: ticking is the most-repeated action here, and a round trip
    // before the line greys out makes it feel broken.
    setNotes((prev) => (prev ?? []).map((x) => (x.note_id === n.note_id
      ? { ...x, cleared_at: next ? new Date().toISOString() : null, cleared_by_email: next ? authorEmail : null }
      : x)));
    const ok = await setNoteCleared(supabase, n.note_id, next, authorEmail);
    if (!ok) load();   // the database said no — show what it actually holds
  };

  const open = (notes ?? []).filter(isOpen);
  const settled = (notes ?? []).filter((n) => !isOpen(n));
  const hiddenSettled = settled.filter((n) => !justToggled.includes(n.note_id)).length;
  const shown = showSettled
    ? (notes ?? [])
    : (notes ?? []).filter((n) => isOpen(n) || justToggled.includes(n.note_id));

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-2.5 mb-3 flex-wrap">
        <label className="block text-[10px] uppercase tracking-widest text-slate-500">
          {t('Follow-up notes')}
          <span className="ml-2 normal-case tracking-normal text-slate-600">{t('internal — never shown to the customer')}</span>
        </label>
        {open.length > 0 && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-amber-300/90">
            {tf('{n} open', { n: open.length })}
          </span>
        )}
      </div>

      {/* Writing box first: the reason this panel is open is usually to add a
          line, not to read one. */}
      <div className="flex items-start gap-2 mb-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } }}
          rows={2}
          placeholder={t('e.g. Awaiting answer from the customer on the revised scope')}
          className="flex-1 bg-transparent border border-slate-800 focus:border-violet-500 rounded-xl outline-none text-slate-300 p-3 text-xs leading-relaxed placeholder:text-slate-700 transition-colors resize-y"
        />
        <button onClick={() => void post()} disabled={!body.trim() || busy}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-[11px] font-semibold bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-30 disabled:hover:bg-violet-500/15 transition-colors">
          {busy ? t('Saving…') : t('Post')}
        </button>
      </div>

      {notes === null ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
      ) : notes.length === 0 ? (
        <p className="text-[11px] text-slate-600 py-2">
          {t('Nothing noted yet. Anything written here shows on the EPC Proposals list until it is ticked off.')}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-slate-600 py-2">
          {t('Nothing open — this proposal is not waiting on anything.')}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {shown.map((n) => {
            const live = isOpen(n);
            return (
              <li key={n.note_id}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border ${
                  live ? 'bg-slate-950/40 border-amber-500/20' : 'bg-slate-950/20 border-slate-800/70'}`}>
                <button onClick={() => void toggle(n)} role="switch" aria-checked={!live}
                  aria-label={live ? tf('Tick off: {body}', { body: n.body }) : tf('Reopen: {body}', { body: n.body })}
                  title={live ? t('Tick off — takes it off the list, keeps it here') : t('Put this back on the list')}
                  className={`mt-0.5 w-4 h-4 rounded-[5px] border flex items-center justify-center flex-shrink-0 transition-colors ${
                    live ? 'bg-slate-900 border-slate-600 text-transparent hover:border-amber-400'
                         : 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'}`}>
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    live ? 'text-slate-200' : 'text-slate-500 line-through decoration-slate-700'}`}>
                    {n.body}
                  </span>
                  {/* The time log: raised when, by whom — and settled when. */}
                  <span className="block text-[10px] text-slate-600 mt-0.5">
                    {tf('{who} · {when}', { who: n.author_email ?? t('someone'), when: fmtDayTime(n.created_at) })}
                    {!live && n.cleared_at && (
                      <span className="text-emerald-500/70"> · {tf('ticked off {when}', { when: fmtDayTime(n.cleared_at) })}</span>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {hiddenSettled > 0 && (
        <button onClick={() => setShowSettled((v) => !v)}
          className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition-colors">
          {showSettled
            ? t('Hide settled')
            : tf(hiddenSettled === 1 ? 'Show {n} settled note' : 'Show {n} settled notes', { n: hiddenSettled })}
        </button>
      )}
    </div>
  );
}
