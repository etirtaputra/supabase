'use client';

import { useMemo } from 'react';
import { useMoney } from '@/context/MoneyContext';
import type { AccountCategory } from '@/types/money';

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(n)));
}

const CATEGORY_META: Record<AccountCategory, { label: string; icon: string; color: string; bg: string }> = {
  cash:       { label: 'Cash',       icon: '💵', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  debit:      { label: 'Debit',      icon: '🏦', color: 'text-sky-400',     bg: 'bg-sky-500/10' },
  credit:     { label: 'Credit',     icon: '💳', color: 'text-rose-400',    bg: 'bg-rose-500/10' },
  investment: { label: 'Investment', icon: '📈', color: 'text-violet-400',  bg: 'bg-violet-500/10' },
  ewallet:    { label: 'E-Wallet',   icon: '📱', color: 'text-orange-400',  bg: 'bg-orange-500/10' },
};

const CATEGORY_ORDER: AccountCategory[] = ['cash', 'debit', 'credit', 'investment', 'ewallet'];

export default function AccountsView() {
  const { accountBalances, allTransactions, userAccounts } = useMoney();

  // Separate groups (parent_id = null) from subaccounts
  const groups     = useMemo(() => userAccounts.filter(a => a.parent_id === null), [userAccounts]);
  const subOf      = useMemo(() => {
    const m = new Map<string, typeof userAccounts>();
    userAccounts.filter(a => a.parent_id !== null).forEach(sub => {
      const arr = m.get(sub.parent_id!) ?? [];
      arr.push(sub);
      m.set(sub.parent_id!, arr);
    });
    return m;
  }, [userAccounts]);

  // Balance lookup by account name
  const balanceByName = useMemo(() => {
    const m = new Map<string, typeof accountBalances[0]>();
    accountBalances.forEach(ab => m.set(ab.account, ab));
    return m;
  }, [accountBalances]);

  // Known account names (from subaccounts or group itself if no subaccounts)
  const knownNames = useMemo(() => {
    const s = new Set<string>();
    groups.forEach(g => {
      const subs = subOf.get(g.id) ?? [];
      if (subs.length > 0) subs.forEach(s2 => s.add(s2.name));
      else s.add(g.name);
    });
    return s;
  }, [groups, subOf]);

  // Accounts in transactions that aren't in any configured group/subaccount
  const unconfigured = useMemo(
    () => accountBalances.filter(ab => !knownNames.has(ab.account)),
    [accountBalances, knownNames]
  );

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

  // Groups ordered by category
  const sortedGroups = useMemo(() => {
    const order = CATEGORY_ORDER;
    return [...groups].sort((a, b) => {
      const ai = order.indexOf(a.category);
      const bi = order.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [groups]);

  if (accountBalances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 px-4">
        <p className="text-sm">No account data yet. Add transactions to see balances.</p>
      </div>
    );
  }

  function AccountRow({ name, indent }: { name: string; indent?: boolean }) {
    const ab = balanceByName.get(name);
    if (!ab) return null;
    const isNeg = ab.balance < 0;
    const hasTransfers = ab.transferIn > 0 || ab.transferOut > 0;

    return (
      <div className={`bg-slate-800 rounded-2xl p-4 ${indent ? 'ml-3' : ''}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">{ab.account}</p>
            <p className={`text-lg font-bold ${isNeg ? 'text-orange-400' : 'text-white'}`}>
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

      {/* Configured account groups */}
      {sortedGroups.map(group => {
        const subs     = subOf.get(group.id) ?? [];
        const meta     = CATEGORY_META[group.category] ?? CATEGORY_META.debit;
        const names    = subs.length > 0 ? subs.map(s => s.name) : [group.name];
        const groupBal = names.reduce((sum, n) => sum + (balanceByName.get(n)?.balance ?? 0), 0);
        const hasData  = names.some(n => balanceByName.has(n));

        if (!hasData) return null;

        return (
          <div key={group.id}>
            {/* Group header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <span className="text-base">{meta.icon}</span>
                <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>
                  {group.name}
                </span>
                <span className="text-xs text-slate-500">· {meta.label}</span>
              </div>
              <span className={`text-xs font-semibold ${groupBal >= 0 ? 'text-slate-300' : 'text-orange-400'}`}>
                {groupBal < 0 ? '-' : ''}{fmt(groupBal)}
              </span>
            </div>

            <div className="space-y-3">
              {names.map(n => <AccountRow key={n} name={n} indent={subs.length > 0} />)}
            </div>
          </div>
        );
      })}

      {/* Unconfigured accounts (present in transactions but not in settings) */}
      {unconfigured.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Other Accounts</span>
          </div>
          <div className="space-y-3">
            {unconfigured.map(ab => <AccountRow key={ab.account} name={ab.account} />)}
          </div>
        </div>
      )}
    </div>
  );
}
