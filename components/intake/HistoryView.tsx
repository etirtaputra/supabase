'use client';

import { useState, useMemo } from 'react';
import { useIntake } from '@/context/IntakeContext';
import { CATEGORY_META } from '@/types/intake';

// ── Date helpers ──────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Calendar helpers ──────────────────────────────────────────

function getCalendarDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toDateStr(new Date(year, month, d)));
  }
  return cells;
}

// ── History View ──────────────────────────────────────────────

export default function HistoryView() {
  const { logs, items, handleDeleteLog } = useIntake();

  const today = useMemo(() => new Date(), []);
  const [anchor,    setAnchor]    = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected,  setSelected]  = useState<string | null>(toDateStr(today));
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const year  = anchor.getFullYear();
  const month = anchor.getMonth();

  const cells = useMemo(() => getCalendarDays(year, month), [year, month]);

  // Map date → logs
  const logsByDate = useMemo(() => {
    const m = new Map<string, typeof logs>();
    for (const log of logs) {
      if (!m.has(log.date)) m.set(log.date, []);
      m.get(log.date)!.push(log);
    }
    return m;
  }, [logs]);

  const selectedLogs = selected ? (logsByDate.get(selected) ?? []) : [];

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await handleDeleteLog(id); }
    finally { setDeletingId(null); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-y-auto flex-1 pb-24">
        {/* Month navigator */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900/60">
          <button onClick={() => setAnchor(a => addMonths(a, -1))}
            className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <p className="font-bold text-white">
            {anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
          <button onClick={() => setAnchor(a => addMonths(a, 1))}
            disabled={anchor >= new Date(today.getFullYear(), today.getMonth(), 1)}
            className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* Calendar */}
        <div className="px-3 pt-3 pb-2">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[11px] font-semibold text-slate-600 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((dateStr, i) => {
              if (!dateStr) return <div key={`empty-${i}`} />;
              const dayLogs  = logsByDate.get(dateStr) ?? [];
              const hasSome  = dayLogs.length > 0;
              const isToday  = dateStr === toDateStr(today);
              const isSel    = dateStr === selected;
              const isFuture = dateStr > toDateStr(today);

              // Get unique category dots (max 3)
              const cats = [...new Set(dayLogs.map(l => {
                const item = l.item ?? items.find(i => i.id === l.item_id);
                return item?.category ?? 'other';
              }))].slice(0, 3);

              const dayNum = parseInt(dateStr.slice(8), 10);

              return (
                <button
                  key={dateStr}
                  onClick={() => !isFuture && setSelected(isSel ? null : dateStr)}
                  disabled={isFuture}
                  className={`flex flex-col items-center py-1.5 rounded-xl transition-colors
                    ${isSel ? 'bg-violet-600' : isToday ? 'bg-slate-700/60' : hasSome ? 'hover:bg-slate-800' : 'hover:bg-slate-800/40'}
                    ${isFuture ? 'opacity-20 cursor-default' : 'cursor-pointer'}`}
                >
                  <span className={`text-sm font-medium leading-none
                    ${isSel ? 'text-white' : isToday ? 'text-violet-400' : hasSome ? 'text-white' : 'text-slate-600'}`}>
                    {dayNum}
                  </span>
                  <div className="flex gap-0.5 mt-1 h-1.5">
                    {hasSome ? cats.map(cat => (
                      <div key={cat} className="w-1.5 h-1.5 rounded-full"
                        style={{ background: CATEGORY_META[cat as keyof typeof CATEGORY_META].bg
                          .replace('bg-', '').replace('/20', '') === 'violet-500'
                          ? '#8b5cf6' : cat === 'medicine' ? '#3b82f6'
                          : cat === 'caffeine' ? '#f59e0b' : '#64748b' }} />
                    )) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Monthly stats bar */}
        <div className="mx-4 my-2 bg-slate-800/50 rounded-xl px-4 py-3 flex gap-4 text-center">
          <div className="flex-1">
            <p className="text-xl font-bold text-white">{logsByDate.size}</p>
            <p className="text-[11px] text-slate-500">Days logged</p>
          </div>
          <div className="flex-1 border-l border-slate-700/50">
            <p className="text-xl font-bold text-white">{logs.filter(l => l.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length}</p>
            <p className="text-[11px] text-slate-500">Total entries</p>
          </div>
          <div className="flex-1 border-l border-slate-700/50">
            <p className="text-xl font-bold text-white">
              {[...new Set(logs.filter(l => l.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).map(l => l.item_id))].length}
            </p>
            <p className="text-[11px] text-slate-500">Items tracked</p>
          </div>
        </div>

        {/* Selected day details */}
        {selected && (
          <div className="px-4 mt-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {selected === toDateStr(today) ? 'Today'
                : new Date(selected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </h3>

            {selectedLogs.length === 0 ? (
              <div className="bg-slate-800/50 rounded-2xl px-4 py-6 text-center">
                <p className="text-slate-500 text-sm">Nothing logged this day</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedLogs.map(log => {
                  const item = log.item ?? items.find(i => i.id === log.item_id);
                  const cat  = item?.category ?? 'other';
                  const meta = CATEGORY_META[cat];
                  return (
                    <div key={log.id} className="bg-slate-800/70 rounded-xl px-4 py-3 flex items-center gap-3">
                      <span className="text-lg shrink-0">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{item?.name ?? 'Unknown'}</p>
                        <p className="text-[11px] text-slate-400">
                          {log.amount} {log.unit}
                          {log.time_of_day ? ` · ${log.time_of_day}` : ''}
                          {log.notes ? ` · ${log.notes}` : ''}
                        </p>
                      </div>
                      <button onClick={() => handleDelete(log.id)} disabled={deletingId === log.id}
                        className="p-1.5 text-slate-600 hover:text-rose-400 disabled:opacity-30 transition-colors shrink-0">
                        {deletingId === log.id
                          ? <div className="w-4 h-4 rounded-full border border-slate-500 border-t-transparent animate-spin" />
                          : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <path d="M10 11v6"/><path d="M14 11v6"/>
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                          )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!selected && (
          <div className="px-4 mt-4">
            <p className="text-center text-slate-600 text-sm">Tap a day to see its entries</p>
          </div>
        )}
      </div>
    </div>
  );
}
