'use client';

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { useMoney } from '@/context/MoneyContext';

ChartJS.register(ArcElement, Tooltip, Legend);

const COLORS = [
  '#8b5cf6', '#ec4899', '#f97316', '#eab308',
  '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
  '#f43f5e', '#10b981',
];

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.round(n));
}

interface CategoryBreakdownProps {
  title: string;
  items: { category: string; amount: number }[];
  total: number;
  colorBase: string;
}

function CategoryBreakdown({ title, items, total, colorBase }: CategoryBreakdownProps) {
  if (items.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">{title}</h3>
        <p className="text-slate-500 text-sm">No data this month.</p>
      </div>
    );
  }

  const chartData = {
    labels: items.map(i => i.category || 'Uncategorized'),
    datasets: [{
      data: items.map(i => i.amount),
      backgroundColor: items.map((_, idx) => COLORS[idx % COLORS.length]),
      borderWidth: 0,
      hoverOffset: 6,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; raw: unknown }) =>
            ` ${ctx.label}: ${fmt(ctx.raw as number)}`,
        },
      },
    },
    cutout: '65%',
  };

  return (
    <div className="bg-slate-800 rounded-2xl p-5">
      <h3 className="text-white font-semibold text-sm mb-1">{title}</h3>
      <p className={`text-2xl font-bold mb-4 ${colorBase}`}>{fmt(total)}</p>

      <div className="flex gap-6 items-center">
        {/* Donut chart */}
        <div className="w-32 h-32 shrink-0">
          <Doughnut data={chartData} options={chartOptions as Parameters<typeof Doughnut>[0]['options']} />
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2">
          {items.slice(0, 8).map((item, idx) => {
            const pct = total > 0 ? (item.amount / total) * 100 : 0;
            return (
              <div key={item.category} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: COLORS[idx % COLORS.length] }}
                  />
                  <span className="text-xs text-slate-300 truncate">
                    {item.category || 'Uncategorized'}
                  </span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function StatsView() {
  const { filteredTransactions, monthlyIncome, monthlyExpense, monthlyBalance, selectedMonth } = useMoney();

  const expenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    filteredTransactions
      .filter(t => t.type === 'Exp')
      .forEach(t => {
        const key = t.category || 'Uncategorized';
        map.set(key, (map.get(key) ?? 0) + t.amount);
      });
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  const incomeByCategory = useMemo(() => {
    const map = new Map<string, number>();
    filteredTransactions
      .filter(t => t.type === 'Inc')
      .forEach(t => {
        const key = t.category || 'Uncategorized';
        map.set(key, (map.get(key) ?? 0) + t.amount);
      });
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  return (
    <div className="px-4 pb-24 lg:pb-4 space-y-4">
      {/* Monthly summary header */}
      <div className="grid grid-cols-3 gap-3 mt-2">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 mb-0.5">Income</p>
          <p className="text-emerald-400 font-bold text-sm">{fmt(monthlyIncome)}</p>
        </div>
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 mb-0.5">Expense</p>
          <p className="text-rose-400 font-bold text-sm">{fmt(monthlyExpense)}</p>
        </div>
        <div className={`rounded-xl p-3 text-center border
          ${monthlyBalance >= 0
            ? 'bg-sky-500/10 border-sky-500/20'
            : 'bg-orange-500/10 border-orange-500/20'}`}>
          <p className="text-xs text-slate-400 mb-0.5">Balance</p>
          <p className={`font-bold text-sm ${monthlyBalance >= 0 ? 'text-sky-400' : 'text-orange-400'}`}>
            {monthlyBalance < 0 ? '-' : ''}{fmt(monthlyBalance)}
          </p>
        </div>
      </div>

      {/* Savings rate */}
      {monthlyIncome > 0 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-300">Savings Rate</span>
            <span className="text-sm font-bold text-white">
              {Math.max(0, ((monthlyIncome - monthlyExpense) / monthlyIncome) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all"
              style={{
                width: `${Math.min(100, Math.max(0, ((monthlyIncome - monthlyExpense) / monthlyIncome) * 100))}%`
              }}
            />
          </div>
        </div>
      )}

      {/* Expense breakdown */}
      <CategoryBreakdown
        title="Expenses by Category"
        items={expenseByCategory}
        total={monthlyExpense}
        colorBase="text-rose-400"
      />

      {/* Income breakdown */}
      <CategoryBreakdown
        title="Income by Category"
        items={incomeByCategory}
        total={monthlyIncome}
        colorBase="text-emerald-400"
      />

      {/* Transaction count */}
      <div className="bg-slate-800 rounded-2xl p-4 flex items-center justify-between">
        <span className="text-slate-300 text-sm">Total Transactions</span>
        <span className="text-white font-bold">{filteredTransactions.length}</span>
      </div>
    </div>
  );
}
