'use client';

import { useMoney, navigatePeriod } from '@/context/MoneyContext';
import type { ViewPeriod } from '@/types/money';
import { format } from 'date-fns';

const PERIODS: { id: ViewPeriod; label: string }[] = [
  { id: 'daily',   label: 'Day' },
  { id: 'weekly',  label: 'Week' },
  { id: 'monthly', label: 'Month' },
  { id: 'annual',  label: 'Year' },
];

function isCurrentPeriod(anchor: Date, period: ViewPeriod): boolean {
  const now = new Date();
  switch (period) {
    case 'daily':   return format(anchor, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
    case 'weekly':  return format(anchor, 'yyyy-[W]II') === format(now, 'yyyy-[W]II');
    case 'monthly': return format(anchor, 'yyyy-MM') === format(now, 'yyyy-MM');
    case 'annual':  return format(anchor, 'yyyy') === format(now, 'yyyy');
  }
}

export default function PeriodNavigator() {
  const { periodAnchor, setPeriodAnchor, viewPeriod, setViewPeriod, periodLabel } = useMoney();

  const prev = () => setPeriodAnchor(navigatePeriod(periodAnchor, viewPeriod, -1));
  const next = () => setPeriodAnchor(navigatePeriod(periodAnchor, viewPeriod, 1));
  const goToToday = () => setPeriodAnchor(new Date());

  const isCurrent = isCurrentPeriod(periodAnchor, viewPeriod);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Period type selector */}
      <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
        {PERIODS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { setViewPeriod(id); setPeriodAnchor(new Date()); }}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors
              ${viewPeriod === id
                ? 'bg-violet-600 text-white'
                : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Navigation row */}
      <div className="flex items-center gap-1">
        <button onClick={prev}
          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          aria-label="Previous period">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="w-3.5 h-3.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <button onClick={goToToday}
          className="min-w-[130px] text-center text-xs font-semibold text-white hover:text-violet-400 transition-colors flex items-center justify-center gap-1"
          title="Go to current period">
          {periodLabel}
          {isCurrent && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400" />
          )}
        </button>

        <button onClick={next}
          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          aria-label="Next period">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="w-3.5 h-3.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
