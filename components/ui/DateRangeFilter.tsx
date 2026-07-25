'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ALL_TIME, PRESET_LABELS, describeRange, isOpenRange, rangeForMonth, rangeForPreset, rangeForYear,
  type DateRange, type RangePreset,
} from '@/lib/dateRange';
import { fmtDay } from '@/lib/formatters';

/**
 * The date filter every list shares: quick presets (this week / month /
 * quarter / year and the rolling windows), a month picker, a year picker, and
 * a free from–to range.
 *
 * The button always states the range in force, so a filtered list can never be
 * mistaken for the whole list. Portaled to <body>: page headers use
 * backdrop-blur, which WebKit treats as a containing block for fixed/absolute
 * descendants, so a popover rendered in place gets clipped by the header.
 */

const QUICK: RangePreset[] = ['all', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last90', 'lastMonth', 'lastYear'];

export default function DateRangeFilter({
  value, onChange, label = 'Dates', accent = 'emerald', align = 'right',
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  label?: string;
  accent?: 'emerald' | 'sky' | 'violet';
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const active = !isOpenRange(value);
  const summary = useMemo(() => describeRange(value, (d) => fmtDay(d)), [value]);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 16);
    setPos({
      top: r.bottom + 6,
      left: align === 'right' ? Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) : Math.max(8, r.left),
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const tone = accent === 'sky'
    ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
    : accent === 'violet'
      ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
      : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';

  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const monthValue = value.from && value.to && value.from.slice(0, 7) === value.to.slice(0, 7) ? value.from.slice(0, 7) : '';

  const panel = pos && (
    <>
      <div className="fixed inset-0 z-[130]" onClick={() => setOpen(false)} />
      <div className="fixed z-[131] w-[320px] max-w-[calc(100vw-16px)] max-h-[70vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 space-y-3"
        style={{ top: pos.top, left: pos.left }}>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1.5">Quick ranges</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((p) => {
              const r = rangeForPreset(p);
              const on = r.from === value.from && r.to === value.to;
              return (
                <button key={p}
                  onClick={() => { onChange(r); setOpen(false); }}
                  className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                    on ? tone : 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}>
                  {PRESET_LABELS[p as Exclude<RangePreset, 'custom'>]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Month</p>
            <input type="month" value={monthValue}
              onChange={(e) => { if (e.target.value) { onChange(rangeForMonth(e.target.value)); setOpen(false); } }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Year</p>
            <div className="flex flex-wrap gap-1">
              {years.map((y) => {
                const r = rangeForYear(y);
                const on = r.from === value.from && r.to === value.to;
                return (
                  <button key={y} onClick={() => { onChange(r); setOpen(false); }}
                    className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                      on ? tone : 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}>
                    {y}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Custom range</p>
          <div className="flex items-center gap-2">
            <input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value || null })}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
            <span className="text-slate-600 text-xs">→</span>
            <input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value || null })}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800">
          <button onClick={() => { onChange(ALL_TIME); setOpen(false); }}
            className="text-[11px] text-slate-500 hover:text-white transition-colors">Clear</button>
          <button onClick={() => setOpen(false)}
            className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">Done</button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen((o) => !o)}
        title={`${label}: ${summary}`}
        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap transition-colors ${
          active ? tone : 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'
        }`}>
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="max-w-[190px] truncate">{summary}</span>
        {active && (
          <span onClick={(e) => { e.stopPropagation(); onChange(ALL_TIME); }}
            className="text-slate-500 hover:text-white ml-0.5" title="Clear the date filter">×</span>
        )}
      </button>
      {open && mounted && createPortal(panel, document.body)}
    </>
  );
}
