'use client';

import { useMemo } from 'react';
import { useMoney } from '@/context/MoneyContext';
import type { AccountCategory } from '@/types/money';

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(n)));
}

const CATEGORY_META: Record<AccountCategory, { label: string; icon: string; color: string }> = {
  cash:       { label: 'Cash',        icon: '💵', color: 'text-emerald-400' },
  debit:      { label: 'Debit',       icon: '🏦', color: 'text-sky-400' },
  credit:     { label: 'Credit',      icon: '💳', color: 'text-rose-400' },
  investment: { label: 'Investment',  icon: '📈', color: 'text-violet-400' },
  ewallet:    { label: 'E-Wallet',    icon: '📱', color: 'text-orange-400' },
};

const CATEGORY_ORDER: AccountCategory[] = ['cash', 'debit', 'credit', 'investment', 'ewallet'];

function getAccountIcon(name: string, category?: AccountCategory): string {
  if (category) return CATEGORY_META[category].icon;
  const lower = name.toLowerCase();
  if (lower.includes('credit') || lower.includes('cc')) return '💳';
  if (lower.includes('cash'))   return '💵';
  if (lower.includes('gopay') || lower.includes('ovo') || lower.includes('shopee')) return '📱';
  return '🏦';
}

export default function AccountsView() {
  const { accountBalances, allTransactions, userAccounts } = useMoney();

  // Build a category map from user accounts settings
  const categoryMap = useMemo(() => {
    const m = new Map<string, AccountCategory>();
    userAccounts.forEach(a => m.set(a.name, a.category));
    return m;
  }, [userAccounts]);

  const totalBalance = useMemo(
    () => accountBalances.reduce((s, a) => s + a.balance, 0),
    [accountBalances]
  );

  const totalIncome = useMemo(
    () => allTransactions.filter(t => t.type === 'Inc' || t.type === 'IncBal').reduce((s, t) => s + t.amount, 0),
    [allTransactions]
  );
  const totalExpense = useMemo(
    () => allTransactions.filter(t => t.type === 'Exp' || t.type === 'ExpBal').reduce((s, t) => s + t.amount, 0),
    [allTransactions]
  );

  // Group accounts by category (using settings, fallback to 'debit')
  const grouped = useMemo(() => {
    const groups = new Map<AccountCategory, typeof accountBalances>();
    for (const ab of accountBalances) {
      const cat: AccountCategory = categoryMap.get(ab.account) ?? 'debit';
      const arr = groups.get(cat) ?? [];
      arr.push(ab);
      groups.set(cat, arr);
    }
    return groups;
  }, [accountBalances, categoryMap]);

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
          {totalBalance < 0 ? '-' : ''}{fmt(totalBalance)}
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

      {/* Accounts grouped by category */}
      {CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => {
        const accounts = grouped.get(cat)!;
        const meta = CATEGORY_META[cat];
        const groupTotal = accounts.reduce((s, a) => s + a.balance, 0);

        return (
          <div key={cat}>
            {/* Category header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <span className="text-base">{meta.icon}</span>
                <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>
                  {meta.label}
                </span>
              </div>
              <span className={`text-xs font-semibold ${groupTotal >= 0 ? 'text-slate-300' : 'text-orange-400'}`}>
                {groupTotal < 0 ? '-' : ''}{fmt(groupTotal)}
              </span>
            </div>

            <div className="space-y-3">
              {accounts.map((ab) => {
                const icon = getAccountIcon(ab.account, categoryMap.get(ab.account));
                const isNeg = ab.balance < 0;
                const hasTransfers = ab.transferIn > 0 || ab.transferOut > 0;

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

                    {/* Inc / Exp */}
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

                    {/* Transfers row */}
                    {hasTransfers && (
                      <div className="flex gap-3 mt-2">
                        {ab.transferIn > 0 && (
                          <div className="flex-1 bg-indigo-500/10 rounded-xl px-3 py-2">
                            <p className="text-xs text-slate-400 mb-0.5">Trf In</p>
                            <p className="text-indigo-400 text-xs font-semibold">+{fmt(ab.transferIn)}</p>
                          </div>
                        )}
                        {ab.transferOut > 0 && (
                          <div className="flex-1 bg-sky-500/10 rounded-xl px-3 py-2">
                            <p className="text-xs text-slate-400 mb-0.5">Trf Out</p>
                            <p className="text-sky-400 text-xs font-semibold">-{fmt(ab.transferOut)}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Balance bar */}
                    {ab.income + ab.expense > 0 && (
                      <div className="mt-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${Math.min(100, (ab.income / (ab.income + ab.expense)) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
