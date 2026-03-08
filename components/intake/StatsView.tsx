'use client';

import { useMemo, useState } from 'react';
import { useIntake } from '@/context/IntakeContext';
import { CATEGORY_META } from '@/types/intake';

function fmtNum(n: number): string {
  if (n === 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

const PERIODS = [
  { label: '7d',  days: 7   },
  { label: '30d', days: 30  },
  { label: '1yr', days: 365 },
];

export default function StatsView() {
  const { items, logs, getStreak, getAverage } = useIntake();
  const [period, setPeriod] = useState(30);

  // Filter for items that have at least one log
  const trackedItems = useMemo(
    () => items.filter(item => logs.some(l => l.item_id === item.id)),
    [items, logs]
  );

  // Items sorted by current streak desc, then name
  const sortedItems = useMemo(() => [...trackedItems].sort((a, b) => {
    const sa = getStreak(a.id).current;
    const sb = getStreak(b.id).current;
    return sb - sa || a.name.localeCompare(b.name);
  }), [trackedItems, getStreak]);

  // Global stats
  const totalDaysLogged = useMemo(() => {
    const dates = new Set(logs.map(l => l.date));
    return dates.size;
  }, [logs]);

  const longestOverallStreak = useMemo(() => {
    if (sortedItems.length === 0) return 0;
    return Math.max(...sortedItems.map(i => getStreak(i.id).best));
  }, [sortedItems, getStreak]);

  const currentBestStreak = useMemo(() => {
    if (sortedItems.length === 0) return 0;
    return Math.max(...sortedItems.map(i => getStreak(i.id).current));
  }, [sortedItems, getStreak]);

  // Per-category count for period
  const catCounts = useMemo(() => {
    const cutoff = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
    const acc: Record<string, number> = {};
    for (const log of logs) {
      if (log.date < cutoff) continue;
      const cat = (log.item ?? items.find(i => i.id === log.item_id))?.category ?? 'other';
      acc[cat] = (acc[cat] ?? 0) + 1;
    }
    return acc;
  }, [logs, items, period]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 pb-24">
        <div className="text-5xl mb-4">📊</div>
        <p className="text-white font-semibold text-base">No data yet</p>
        <p className="text-slate-500 text-sm mt-1">Start logging your intake on the Today tab to see stats here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full pb-24">
      <div className="px-4 py-4 space-y-5">

        {/* Period selector */}
        <div className="flex gap-2">
          <span className="text-xs text-slate-500 self-center">Show:</span>
          {PERIODS.map(({ label, days }) => (
            <button key={days} onClick={() => setPeriod(days)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors
                ${period === days ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Overall summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-violet-400">{totalDaysLogged}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Total days logged</p>
          </div>
          <div className="bg-slate-800 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">🔥 {currentBestStreak}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Best current streak</p>
          </div>
          <div className="bg-slate-800 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{longestOverallStreak}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Longest streak ever</p>
          </div>
        </div>

        {/* Category breakdown */}
        {Object.keys(catCounts).length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Last {period} days by category</h2>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(catCounts).map(([cat, count]) => {
                const meta = CATEGORY_META[cat as keyof typeof CATEGORY_META];
                return (
                  <div key={cat} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${meta.bg} ${meta.border} border`}>
                    <span>{meta.icon}</span>
                    <span className={`text-sm font-semibold ${meta.color}`}>{count}</span>
                    <span className="text-xs text-slate-400">{meta.label}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Per-item cards — compact single-row */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Per item</h2>
          <div className="space-y-1.5">
            {sortedItems.map(item => {
              const { current, best } = getStreak(item.id);
              const meta = CATEGORY_META[item.category];
              const avgAll = getAverage(item.id, 0);

              const cutoff = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
              const periodLogs = logs.filter(l => l.item_id === item.id && l.date >= cutoff);
              const totalInPeriod = periodLogs.reduce((s, l) => s + l.amount, 0);
              const daysInPeriod  = new Set(periodLogs.map(l => l.date)).size;

              return (
                <div key={item.id} className="bg-slate-800/70 rounded-xl px-3 py-2.5 flex items-center gap-2.5 min-w-0">
                  {/* Color dot + icon */}
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base shrink-0"
                    style={{ background: item.color + '25' }}>
                    {meta.icon}
                  </div>

                  {/* Name + category */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate leading-tight">{item.name}</p>
                    <p className={`text-[10px] ${meta.color} leading-tight`}>{meta.label}</p>
                  </div>

                  {/* Streak */}
                  <div className="shrink-0 text-right min-w-[2.5rem]">
                    <p className="text-sm font-bold text-amber-400 leading-tight">
                      {current > 0 ? <>🔥{current}</> : <span className="text-slate-600">—</span>}
                    </p>
                    <p className="text-[9px] text-slate-600 leading-tight">best {best}</p>
                  </div>

                  {/* Divider */}
                  <div className="w-px h-7 bg-slate-700/60 shrink-0" />

                  {/* Period total */}
                  <div className="shrink-0 text-right min-w-[3.5rem]">
                    <p className="text-sm font-bold text-white leading-tight">
                      {daysInPeriod > 0 ? fmtNum(totalInPeriod) : <span className="text-slate-600">—</span>}
                      {daysInPeriod > 0 && <span className="text-[10px] text-slate-500 font-normal ml-0.5">{item.default_unit}</span>}
                    </p>
                    <p className="text-[9px] text-slate-600 leading-tight">{daysInPeriod}d · {periodLogs.length} logs</p>
                  </div>

                  {/* Divider */}
                  <div className="w-px h-7 bg-slate-700/60 shrink-0" />

                  {/* All-time daily avg */}
                  <div className="shrink-0 text-right min-w-[3.5rem]">
                    <p className="text-sm font-bold text-violet-300 leading-tight">
                      {avgAll.daysTracked > 0 ? fmtNum(avgAll.avg) : <span className="text-slate-600">—</span>}
                      {avgAll.daysTracked > 0 && <span className="text-[10px] text-slate-500 font-normal ml-0.5">{item.default_unit}</span>}
                    </p>
                    <p className="text-[9px] text-slate-600 leading-tight">avg/day</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Untracked items (have items but no logs) */}
        {items.length > trackedItems.length && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Not logged yet</h2>
            <div className="flex flex-wrap gap-2">
              {items.filter(i => !trackedItems.includes(i)).map(item => {
                const meta = CATEGORY_META[item.category];
                return (
                  <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${meta.bg} ${meta.border} border opacity-50`}>
                    <span className="text-sm">{meta.icon}</span>
                    <span className="text-xs text-white">{item.name}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
