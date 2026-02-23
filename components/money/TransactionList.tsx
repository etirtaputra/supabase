'use client';

import { useMoney } from '@/context/MoneyContext';
import type { Transaction } from '@/types/money';

function fmt(n: number) {
  return new Intl.NumberFormat('id-ID').format(Math.round(n));
}

function typeColor(type: Transaction['type']) {
  switch (type) {
    case 'Inc':    return 'text-emerald-400';
    case 'IncBal': return 'text-teal-400';
    case 'Exp':    return 'text-rose-400';
    case 'ExpBal': return 'text-orange-400';
    case 'TrfIn':  return 'text-indigo-400';
    default:       return 'text-sky-400'; // TrfOut, Trf
  }
}

function typeSign(type: Transaction['type']) {
  switch (type) {
    case 'Inc':    return '+';
    case 'IncBal': return '+';
    case 'Exp':    return '-';
    case 'ExpBal': return '-';
    case 'TrfIn':  return '↓';
    default:       return '↑'; // TrfOut, Trf
  }
}

function typePrefix(type: Transaction['type']) {
  switch (type) {
    case 'Inc':    return 'INC';
    case 'IncBal': return 'INC BAL';
    case 'Exp':    return 'EXP';
    case 'ExpBal': return 'EXP BAL';
    case 'TrfIn':  return 'TRF IN';
    case 'TrfOut': return 'TRF OUT';
    default:       return 'TRF';
  }
}

function typeBadgeBg(type: Transaction['type']) {
  switch (type) {
    case 'Inc':    return 'bg-emerald-500/15 text-emerald-400';
    case 'IncBal': return 'bg-teal-500/15 text-teal-400';
    case 'Exp':    return 'bg-rose-500/15 text-rose-400';
    case 'ExpBal': return 'bg-orange-500/15 text-orange-400';
    case 'TrfIn':  return 'bg-indigo-500/15 text-indigo-400';
    default:       return 'bg-sky-500/15 text-sky-400'; // TrfOut, Trf
  }
}

interface TransactionRowProps {
  transaction: Transaction;
}

function TransactionRow({ transaction: t }: TransactionRowProps) {
  const { openEditModal, openActionMenu } = useMoney();

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60 transition-colors cursor-pointer"
      onClick={() => openEditModal(t)}
      onContextMenu={(e) => { e.preventDefault(); openActionMenu(t); }}
    >
      {/* Type badge */}
      <div className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[10px] font-bold uppercase ${typeBadgeBg(t.type)}`}>
        {typePrefix(t.type)}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-white font-medium truncate">
            {t.note || t.category || '(no note)'}
          </span>
          {t.bookmarked && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
              fill="currentColor" className="w-3 h-3 text-yellow-400 shrink-0">
              <path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 20V4z"/>
            </svg>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-slate-500">{t.category}</span>
          {t.subcategory && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-600">{t.subcategory}</span>
            </>
          )}
          <span className="text-slate-700">·</span>
          <span className="text-xs text-slate-500">{t.account}</span>
        </div>
      </div>

      {/* Amount + time */}
      <div className="text-right shrink-0">
        <p className={`text-sm font-semibold ${typeColor(t.type)}`}>
          {typeSign(t.type)}{fmt(t.amount)}
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          {t.time.slice(0, 5)}
        </p>
      </div>

      {/* Long-press / 3-dot menu */}
      <button
        className="shrink-0 p-1 rounded-md hover:bg-slate-700 text-slate-600 hover:text-slate-400 transition-colors"
        onClick={(e) => { e.stopPropagation(); openActionMenu(t); }}
        aria-label="Actions"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
          className="w-4 h-4">
          <circle cx="12" cy="5"  r="1.5"/>
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
    </div>
  );
}

export default function TransactionList() {
  const { groupedTransactions, isLoading, error, filteredTransactions } = useMoney();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <svg className="animate-spin w-8 h-8 mb-3 text-violet-500" xmlns="http://www.w3.org/2000/svg"
          fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <p className="text-sm">Loading transactions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-rose-400">
        <p className="text-sm">Error: {error}</p>
      </div>
    );
  }

  if (filteredTransactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mb-3 text-slate-700">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <p className="text-sm">No transactions this month</p>
      </div>
    );
  }

  return (
    <div className="pb-24 lg:pb-4">
      {groupedTransactions.map((group) => (
        <div key={group.date}>
          {/* Date header */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 sticky top-0 z-10 backdrop-blur-sm">
            <span className="text-xs font-semibold text-slate-400">{group.displayDate}</span>
            <div className="flex items-center gap-2">
              {group.dailyIncome > 0 && (
                <span className="text-xs text-emerald-400">+{fmt(group.dailyIncome)}</span>
              )}
              {group.dailyExpense > 0 && (
                <span className="text-xs text-rose-400">-{fmt(group.dailyExpense)}</span>
              )}
              {(group.dailyIncome > 0 || group.dailyExpense > 0) && (
                <span className="text-xs text-slate-600">
                  {group.dailyIncome - group.dailyExpense >= 0 ? '+' : ''}
                  {fmt(group.dailyIncome - group.dailyExpense)}
                </span>
              )}
            </div>
          </div>

          {/* Transactions for this date */}
          {group.transactions.map((t) => (
            <TransactionRow key={t.id} transaction={t} />
          ))}
        </div>
      ))}
    </div>
  );
}
