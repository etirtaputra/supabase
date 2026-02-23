'use client';

import { addMonths, subMonths, format } from 'date-fns';
import { useMoney } from '@/context/MoneyContext';

export default function MonthNavigator() {
  const { selectedMonth, setSelectedMonth } = useMoney();

  const prev = () => setSelectedMonth(subMonths(selectedMonth, 1));
  const next = () => setSelectedMonth(addMonths(selectedMonth, 1));

  const isCurrentMonth =
    format(selectedMonth, 'yyyy-MM') === format(new Date(), 'yyyy-MM');

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={prev}
        className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        aria-label="Previous month"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <button
        onClick={() => setSelectedMonth(new Date())}
        className="min-w-[140px] text-center text-sm font-semibold text-white hover:text-violet-400 transition-colors"
        title="Click to go to current month"
      >
        {format(selectedMonth, 'MMMM yyyy')}
        {isCurrentMonth && (
          <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-violet-400 align-middle" />
        )}
      </button>

      <button
        onClick={next}
        className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        aria-label="Next month"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>
  );
}
