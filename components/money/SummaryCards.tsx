'use client';

import { useMoney } from '@/context/MoneyContext';

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.abs(Math.round(n)));
}

export default function SummaryCards() {
  const { monthlyIncome, monthlyExpense, monthlyBalance } = useMoney();

  const cards = [
    {
      label: 'Income',
      value: monthlyIncome,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border border-emerald-500/20',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4 text-emerald-400">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
      ),
    },
    {
      label: 'Expense',
      value: monthlyExpense,
      color: 'text-rose-400',
      bg: 'bg-rose-500/10 border border-rose-500/20',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4 text-rose-400">
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
          <polyline points="17 18 23 18 23 12"/>
        </svg>
      ),
    },
    {
      label: 'Balance',
      value: monthlyBalance,
      color: monthlyBalance >= 0 ? 'text-sky-400' : 'text-orange-400',
      bg: monthlyBalance >= 0
        ? 'bg-sky-500/10 border border-sky-500/20'
        : 'bg-orange-500/10 border border-orange-500/20',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke={monthlyBalance >= 0 ? '#38bdf8' : '#fb923c'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4">
          <circle cx="12" cy="12" r="10"/>
          <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>
          <line x1="12" y1="6" x2="12" y2="8"/>
          <line x1="12" y1="16" x2="12" y2="18"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 px-4 py-3">
      {cards.map(({ label, value, color, bg, icon }) => (
        <div key={label} className={`rounded-xl p-3 ${bg}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {icon}
            <span className="text-xs text-slate-400 font-medium">{label}</span>
          </div>
          <p className={`text-sm font-bold ${color} truncate`}>
            {value < 0 ? '-' : ''}{fmt(value)}
          </p>
        </div>
      ))}
    </div>
  );
}
