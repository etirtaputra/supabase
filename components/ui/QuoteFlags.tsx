'use client';
import { useState } from 'react';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtDayTime } from '@/lib/formatters';
import { BAR_SELECT, BAR_INPUT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON_SKY } from '@/constants/controls';
import { lineHistory, openFlagByItem, personName, type FlagKind, type QuoteFlag, type WaitingLine } from '@/lib/quoteFlags';

/**
 * The three screen pieces of a WAITING line on an EPC proposal (lib/quoteFlags.ts):
 *   - FlagDialog: raise a flag on one line, change who it is on, or clear it,
 *     with the line's whole story underneath (who raised, who cleared, when);
 *   - WaitingStrip: "2 lines waiting" above the sections, ‹ › to walk them;
 *   - PdfGuard: the pop-up before a PDF is made while lines still wait —
 *     each line one click away, "Save PDF anyway" deliberately the quiet button.
 *
 * Sky blue throughout, so a waiting line never reads as SBO (amber).
 */

export interface Person { email: string; name: string }

/** The flag mark (owner, 2026-10-22: "use flag symbol not hour glass"). Takes the text colour around it. */
export function FlagIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={`${className} inline-block flex-shrink-0 align-[-0.15em]`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 2.75a.75.75 0 0 1 .75.75v.6c1.7-.9 3.7-.95 5.9-.1 1.9.75 3.6.75 5.6-.2a.75.75 0 0 1 1.07.68v9.5a.75.75 0 0 1-.42.67c-2.4 1.17-4.6 1.2-6.8.33-2-.8-3.7-.7-5.35.3v6.72a.75.75 0 0 1-1.5 0V3.5A.75.75 0 0 1 5 2.75Z" />
    </svg>
  );
}

const kindLabel = (k: FlagKind, t: (en: string) => string) => (k === 'price' ? t('Price') : t('Technical'));

export function FlagDialog({ description, flags, itemId, people, busy, error, onRaise, onReassign, onClear, onClose }: {
  description: string;
  flags: QuoteFlag[];
  itemId: string;
  people: Person[];
  busy: boolean;
  error: string | null;
  onRaise: (kind: FlagKind, assigneeEmail: string, note: string) => void;
  onReassign: (flagId: number, assigneeEmail: string) => void;
  onClear: (flagId: number) => void;
  onClose: () => void;
}) {
  const { t, tf } = useT();
  const open = openFlagByItem(flags).get(itemId) ?? null;
  const history = lineHistory(flags, itemId).filter((f) => f.flag_id !== open?.flag_id);
  const [kind, setKind] = useState<FlagKind>('price');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-sky-300 font-semibold flex items-center gap-1.5"><FlagIcon className="w-3 h-3" /> {t('Waiting on someone')}</p>
            <h3 className="font-semibold text-white text-sm mt-1 break-words">{description || t('This line')}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {open ? (
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 space-y-3">
            <p className="text-sm text-sky-200 font-semibold">{kindLabel(open.kind, t)}</p>
            {open.note && <p className="text-[13px] text-slate-200 whitespace-pre-wrap">{open.note}</p>}
            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">{t('Who is on it')}</span>
              <select value={open.assignee_email} disabled={busy}
                onChange={(e) => onReassign(open.flag_id, e.target.value)}
                className={`${BAR_SELECT} w-full`}>
                {!people.some((p) => p.email === open.assignee_email) && <option value={open.assignee_email}>{personName(open.assignee_email)}</option>}
                {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
              </select>
            </label>
            <p className="text-[11px] text-slate-400">
              {tf('Raised by {name} · {when}', { name: personName(open.created_by_email), when: fmtDayTime(open.created_at) })}
            </p>
            <button type="button" disabled={busy} onClick={() => onClear(open.flag_id)}
              className={`${BAR_BTN} ${BAR_BTN_ON_SKY} w-full justify-center px-3 disabled:opacity-50`}>
              ✓ {t('Answered: clear the flag')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['price', 'technical'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                  className={`${BAR_BTN} ${kind === k ? BAR_BTN_ON_SKY : BAR_BTN_OFF} flex-1 justify-center px-3`}>
                  {kindLabel(k, t)}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">{t('Who is on it')}</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className={`${BAR_SELECT} w-full`}>
                <option value="">{t('Choose a person…')}</option>
                {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">{t('Note (optional)')}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
                placeholder={t('e.g. waiting for the updated Schneider price')}
                className={`${BAR_INPUT} w-full`} />
            </label>
            <button type="button" disabled={busy || !who} onClick={() => onRaise(kind, who, note)}
              className={`${BAR_BTN} ${BAR_BTN_ON_SKY} w-full justify-center px-3 disabled:opacity-40`}>
              <FlagIcon className="w-3.5 h-3.5 mr-1.5" /> {t('Flag this line')}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}

        {history.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{t('Earlier on this line')}</p>
            {history.map((f) => (
              <p key={f.flag_id} className="text-[11px] text-slate-400">
                <span className="text-slate-300">{kindLabel(f.kind, t)} · {personName(f.assignee_email)}</span>
                {' — '}{tf('raised by {name} {when}', { name: personName(f.created_by_email), when: fmtDay(f.created_at) })}
                {f.resolved_at && <>, {tf('cleared by {name} {when}', { name: personName(f.resolved_by_email), when: fmtDayTime(f.resolved_at) })}</>}
                {f.note && <span className="block text-slate-500 italic">{f.note}</span>}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** "⚑ 2 lines waiting" — one line at a time, ‹ › to step through them top to bottom. */
export function WaitingStrip({ lines, onGo }: { lines: WaitingLine[]; onGo: (itemId: string) => void }) {
  const { t, tf } = useT();
  const [i, setI] = useState(0);
  if (!lines.length) return null;
  const at = Math.min(i, lines.length - 1);
  const cur = lines[at];
  const step = (d: number) => {
    const next = (at + d + lines.length) % lines.length;
    setI(next);
    onGo(lines[next].itemId);
  };
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[12px]">
      <span className="font-semibold text-sky-200 whitespace-nowrap">
        <FlagIcon className="w-3.5 h-3.5 mr-1" />{lines.length === 1 ? t('1 line waiting') : tf('{n} lines waiting', { n: lines.length })}
      </span>
      <button type="button" onClick={() => onGo(cur.itemId)} title={t('Go to line')}
        className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-white underline-offset-2 hover:underline">
        {cur.description || '—'} · {kindLabel(cur.flag.kind, t)} · {personName(cur.flag.assignee_email)} · {tf('since {date}', { date: fmtDay(cur.flag.created_at) })}
      </button>
      {lines.length > 1 && (
        <span className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => step(-1)} aria-label={t('Previous')} className="px-2 py-0.5 rounded-md text-sky-200 hover:bg-sky-500/20">‹</button>
          <span className="tabular-nums text-slate-400">{at + 1}/{lines.length}</span>
          <button type="button" onClick={() => step(1)} aria-label={t('Next')} className="px-2 py-0.5 rounded-md text-sky-200 hover:bg-sky-500/20">›</button>
        </span>
      )}
    </div>
  );
}

/** Before a PDF is made while lines still wait: what, on whom, and a way straight to each. */
export function PdfGuard({ lines, onGo, onAnyway, onCancel }: {
  lines: WaitingLine[];
  onGo: (itemId: string) => void;
  onAnyway: () => void;
  onCancel: () => void;
}) {
  const { t, tf } = useT();
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-slate-900 border border-sky-500/40 rounded-2xl p-5 max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-white">
          <FlagIcon className="w-4 h-4 mr-1.5 text-sky-300" />{lines.length === 1 ? t('1 line is still waiting') : tf('{n} lines are still waiting', { n: lines.length })}
        </h3>
        <p className="text-[12px] text-slate-400 mt-1 mb-3">{t('Go to a line to finish it, or save the PDF as it is.')}</p>
        <div className="overflow-y-auto space-y-1.5 pr-1">
          {lines.map((w) => (
            <div key={w.flag.flag_id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/50 text-[12px]">
              <div className="min-w-0 flex-1">
                <p className="text-slate-100 font-medium truncate">{w.description || '—'}</p>
                <p className="text-slate-400 truncate">
                  {kindLabel(w.flag.kind, t)} · {personName(w.flag.assignee_email)} · {tf('since {date}', { date: fmtDay(w.flag.created_at) })}
                  {w.flag.note && <span className="italic"> · “{w.flag.note}”</span>}
                </p>
              </div>
              <button type="button" onClick={() => onGo(w.itemId)}
                className="flex-shrink-0 px-2.5 py-1 rounded-lg text-sky-200 border border-sky-500/40 hover:bg-sky-500/15 whitespace-nowrap">
                {t('Go to line')} →
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <button type="button" onClick={onAnyway} className={`${BAR_BTN} ${BAR_BTN_OFF} px-3`}>{t('Save PDF anyway')}</button>
          <button type="button" onClick={onCancel} className={`${BAR_BTN} ${BAR_BTN_ON_SKY} px-3`}>{t('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}
