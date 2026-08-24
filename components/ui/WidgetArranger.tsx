'use client';
import { Fragment } from 'react';
import { useT } from '@/hooks/useT';
import { useDragReorder, DRAGGING_ROW, REORDER_ROW } from '@/components/ui/dragReorder';
import type { DashboardLayout, DashboardWidget } from '@/constants/dashboardWidgets';

/**
 * Arrange the dashboard: drag a row to move it, tick to show or hide it.
 *
 * ONE component, two callers, on purpose — the owner arranging the house
 * dashboard in Settings and a person arranging their own on the dashboard
 * itself are the same job, and a second copy of it is a second set of bugs.
 * The caller supplies the rows and decides what saving means.
 *
 * Reorder by DRAGGING (the whole row is the handle); the arrows do the same
 * for touch and keyboard, where native drag isn't available. The seam it will
 * land in is drawn as a LINE while you drag — `components/ui/dragReorder`
 * owns that, and every reorderable list in the app now shows the same one.
 */
export default function WidgetArranger({
  rows, onChange, footer, recommended,
}: {
  rows: { widget: DashboardWidget; shown: boolean }[];
  onChange: (next: DashboardLayout) => void;
  footer?: React.ReactNode;
  /**
   * The panels this person's ROLE opens on. They are marked here rather than
   * listed somewhere else, because the same rows are the thing being arranged —
   * a second "recommended" list would be a second list to drift.
   */
  recommended?: Set<string>;
}) {
  const { t } = useT();

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

  const drag = useDragReorder<string>((from, to, after) => move(from, to, after));

  /**
   * How many rows at the TOP are role-recommended, so the group can be drawn
   * as a group. Only a run at the top counts: once someone has dragged their
   * own panel above them the block is no longer a block, and pretending
   * otherwise would draw a heading over rows it does not describe. The chips
   * survive either way, so nothing is lost — only the divider goes.
   */
  const leadRun = (() => {
    if (!recommended?.size) return 0;
    let n = 0;
    while (n < rows.length && recommended.has(rows[n].widget.key)) n++;
    return n >= 2 && n < rows.length ? n : 0;
  })();

  return (
    <div className="space-y-1.5">
      <ol className="space-y-1.5">
        {leadRun > 0 && (
          <li aria-hidden className="flex items-center gap-2 px-1 pt-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/90">{t('For your role')}</span>
            <span className="h-px flex-1 bg-emerald-500/20" />
          </li>
        )}
        {rows.map((r, i) => {
          const { widget: w } = r;
          const dragging = drag.dragKey === w.key;
          const forRole = !!recommended?.has(w.key);
          return (
            <Fragment key={w.key}>
            <li
              {...drag.handleProps(w.key)}
              {...drag.rowProps(w.key)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-950/50 border cursor-grab active:cursor-grabbing ${REORDER_ROW} ${
                forRole ? 'border-emerald-500/30 border-l-2 border-l-emerald-500/70' : 'border-slate-800'} ${
                drag.lineAt(w.key)} ${dragging ? DRAGGING_ROW : ''}`}>
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
                <span className={`flex items-center gap-1.5 min-w-0 text-[13px] font-semibold ${r.shown ? 'text-white' : 'text-slate-500'}`}>
                  <span className="truncate">{w.label}</span>
                  {/* Only where the divider is not already saying it — and
                      never on a phone, where the chip is wider than the space
                      the LABEL needs (measured 2026-08-23: "Needs you today"
                      truncated to "Need…" at 390px). The emerald edge on the
                      row says the same thing and costs no width. */}
                  {forRole && leadRun === 0 && (
                    <span className="hidden sm:inline-flex flex-shrink-0 text-[9px] font-bold uppercase tracking-widest text-emerald-300/90 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
                      {t('For your role')}
                    </span>
                  )}
                </span>
                <span className={`block text-[11px] truncate ${r.shown ? 'text-slate-500' : 'text-slate-600'}`}>{t(w.hint)}</span>
              </button>

              <MoveArrows label={w.label} onUp={() => nudge(i, -1)} onDown={() => nudge(i, 1)}
                upDisabled={i === 0} downDisabled={i === rows.length - 1} />
            </li>
            {leadRun > 0 && i === leadRun - 1 && (
              <li aria-hidden className="flex items-center gap-2 px-1 pt-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{t('Everything else')}</span>
                <span className="h-px flex-1 bg-slate-800" />
              </li>
            )}
            </Fragment>
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
