'use client';

import { useMemo } from 'react';
import { useMoney } from '@/context/MoneyContext';

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(n)));
}

const ACCOUNT_ICONS: Record<string, string> = {
  'Cash':          '💵',
  'Bank BCA':      '🏦',
  'Bank BRI':      '🏦',
  'Bank Mandiri':  '🏦',
  'GoPay':         '📱',
  'OVO':           '📱',
  'ShopeePay':     '📱',
  'Credit Card':   '💳',
};

export default function AccountsView() {
  const { accountBalances, allTransactions } = useMoney();

  const totalBalance = useMemo(
    () => accountBalances.reduce((s, a) => s + a.balance, 0),
    [accountBalances]
  );

  const totalIncome  = useMemo(
    () => allTransactions.filter(t => t.type === 'Inc').reduce((s, t) => s + t.amount, 0),
    [allTransactions]
  );
  const totalExpense = useMemo(
    () => allTransactions.filter(t => t.type === 'Exp').reduce((s, t) => s + t.amount, 0),
    [allTransactions]
  );

  if (accountBalances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 px-4">
        <p className="text-sm">No account data yet. Add transactions to see balances.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-24 lg:pb-4 space-y-4 mt-2">
      {/* Net worth card */}
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-5">
        <p className="text-violet-200 text-xs font-medium mb-1">Total Net Worth</p>
        <p className={`text-3xl font-bold text-white mb-3`}>
          {totalBalance < 0 ? '-' : ''}
          {fmt(totalBalance)}
        </p>
        <div className="flex gap-4">
          <div>
            <p className="text-violet-300 text-xs">All-time Income</p>
            <p className="text-white font-semibold text-sm">+{fmt(totalIncome)}</p>
          </div>
          <div>
            <p className="text-violet-300 text-xs">All-time Expense</p>
            <p className="text-white font-semibold text-sm">-{fmt(totalExpense)}</p>
          </div>
        </div>
      </div>

      {/* Account list */}
      <div className="space-y-3">
        {accountBalances.map((ab) => {
          const icon = ACCOUNT_ICONS[ab.account] ?? '🏧';
          const isNeg = ab.balance < 0;
          return (
            <div key={ab.account} className="bg-slate-800 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center text-lg">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm">{ab.account}</p>
                  <p className={`text-sm font-bold ${isNeg ? 'text-orange-400' : 'text-white'}`}>
                    {isNeg ? '-' : ''}{fmt(ab.balance)}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 bg-emerald-500/10 rounded-xl px-3 py-2">
                  <p className="text-xs text-slate-400 mb-0.5">Income</p>
                  <p className="text-emerald-400 text-xs font-semibold">+{fmt(ab.income)}</p>
                </div>
                <div className="flex-1 bg-rose-500/10 rounded-xl px-3 py-2">
                  <p className="text-xs text-slate-400 mb-0.5">Expense</p>
                  <p className="text-rose-400 text-xs font-semibold">-{fmt(ab.expense)}</p>
                </div>
              </div>

              {/* Balance bar */}
              {ab.income + ab.expense > 0 && (
                <div className="mt-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${Math.min(100, (ab.income / (ab.income + ab.expense)) * 100)}%`
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
