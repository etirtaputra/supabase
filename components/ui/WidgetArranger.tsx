'use client';
import { useState } from 'react';
import { useT } from '@/hooks/useT';
import type { DashboardLayout, DashboardWidget } from '@/constants/dashboardWidgets';

/**
 * Arrange the dashboard: drag a row to move it, tick to show or hide it.
 *
 * ONE component, two callers, on purpose — the owner arranging the house
 * dashboard in Settings and a person arranging their own on the dashboard
 * itself are the same job, and a second copy of it is a second set of bugs.
 * The caller supplies the rows and decides what saving means.
 *
 * Reorder by DRAGGING (the whole row is the handle, dropped where the pointer
 * sits — top half before, bottom half after, so any position is reachable);
 * the arrows do the same for touch and keyboard, where native drag isn't
 * available. Native HTML5 DnD, the same mechanism Settings › Menu uses — no
 * library.
 */
export default function WidgetArranger({
  rows, onChange, footer,
}: {
  rows: { widget: DashboardWidget; shown: boolean }[];
  onChange: (next: DashboardLayout) => void;
  footer?: React.ReactNode;
}) {
  const { t } = useT();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const endDrag = () => { setDrag(null); setOver(null); };

  const emit = (list: { widget: DashboardWidget; shown: boolean }[]) =>
    onChange({
      order: list.map((r) => r.widget.key),
      hidden: list.filter((r) => !r.shown).map((r) => r.widget.key),
    });

  const move = (from: string, to: string, after: boolean) => {
    if (from === to) return;
    const out = rows.filter((r) => r.widget.key !== from);
    const moving = rows.find((r) => r.widget.key === from);
    let idx = out.findIndex((r) => r.widget.key === to);
    if (!moving || idx < 0) return;
    if (after) idx += 1;
    out.splice(idx, 0, moving);
    emit(out);
  };
  const nudge = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const out = [...rows];
    [out[i], out[j]] = [out[j], out[i]];
    emit(out);
  };
  const toggle = (key: string) =>
    emit(rows.map((r) => (r.widget.key === key ? { ...r, shown: !r.shown } : r)));

  const dropIsAfter = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  return (
    <div className="space-y-1.5">
      <ol className="space-y-1.5">
        {rows.map((r, i) => {
          const { widget: w } = r;
          const dragging = drag === w.key;
          return (
            <li key={w.key}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag(w.key); }}
              onDragOver={(e) => { if (drag && drag !== w.key) { e.preventDefault(); setOver(w.key); } }}
              onDragLeave={() => setOver((o) => (o === w.key ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (drag) move(drag, w.key, dropIsAfter(e)); endDrag(); }}
              onDragEnd={endDrag}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-950/50 border border-slate-800 cursor-grab active:cursor-grabbing transition-shadow ${
                over === w.key ? 'ring-2 ring-emerald-500/60' : ''} ${dragging ? 'opacity-40' : ''}`}>
              <Grip className="w-2.5 h-4 text-slate-600 flex-shrink-0" />
              <span className="text-[11px] font-bold tabular-nums text-slate-600 w-4 text-center flex-shrink-0">{i + 1}</span>

              {/* The tick IS the show/hide switch — one control, not a row of
                  buttons that each mean something slightly different. */}
              <button onClick={() => toggle(w.key)} role="switch" aria-checked={r.shown}
                aria-label={`${r.shown ? 'Hide' : 'Show'} ${w.label}`}
                className={`w-4 h-4 rounded-[5px] border flex items-center justify-center flex-shrink-0 transition-colors ${
                  r.shown ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                          : 'bg-slate-900 border-slate-700 text-transparent hover:border-slate-500'}`}>
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>

              <button onClick={() => toggle(w.key)} className="min-w-0 flex-1 text-left">
                <span className={`block text-[13px] font-semibold truncate ${r.shown ? 'text-white' : 'text-slate-500'}`}>{w.label}</span>
                <span className={`block text-[11px] truncate ${r.shown ? 'text-slate-500' : 'text-slate-600'}`}>{t(w.hint)}</span>
              </button>

              <MoveArrows label={w.label} onUp={() => nudge(i, -1)} onDown={() => nudge(i, 1)}
                upDisabled={i === 0} downDisabled={i === rows.length - 1} />
            </li>
          );
        })}
      </ol>
      {footer}
    </div>
  );
}

function MoveArrows({ onUp, onDown, upDisabled, downDisabled, label }: {
  onUp: () => void; onDown: () => void; upDisabled: boolean; downDisabled: boolean; label: string;
}) {
  const cls = 'w-6 h-6 flex items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors';
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button onClick={onUp} disabled={upDisabled} aria-label={`Move ${label} up`} className={cls}>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
      </button>
      <button onClick={onDown} disabled={downDisabled} aria-label={`Move ${label} down`} className={cls}>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
    </div>
  );
}

/** The drag grip — six dots, the universal "pick me up and drag" affordance. */
function Grip({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="2" r="1.3" /><circle cx="8" cy="2" r="1.3" />
      <circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
      <circle cx="2" cy="14" r="1.3" /><circle cx="8" cy="14" r="1.3" />
    </svg>
  );
}
