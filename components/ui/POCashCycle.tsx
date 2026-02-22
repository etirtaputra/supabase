/**
 * POCashCycle — Cash Conversion Cycle per PO
 *
 * Tracks cash commitment timing across POs:
 * - Down payment date & amount
 * - Balance payment date & amount
 * - Days to settle (DP → balance)
 * - Gap in days between consecutive PO cash events (the "cash cycle")
 *
 * POs sorted by down payment date (newest first).
 * Gap = days from previous PO's down payment to this PO's down payment.
 */
'use client';
import { useMemo } from 'react';
import type { PurchaseOrder, POCost } from '@/types/database';

const DOWN_CATS = new Set(['down_payment']);
const BALANCE_CATS = new Set(['balance_payment', 'additional_balance_payment']);
const PRINCIPAL_CATS = new Set(['down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit']);

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

const fmtNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtByCurrency = (byCurrency: Record<string, number>) =>
  Object.entries(byCurrency).map(([c, a]) => `${c} ${fmtNum(a)}`).join(' + ') || '—';

interface POCashRecord {
  po: PurchaseOrder;
  downDate: string | null;
  downByCurrency: Record<string, number>;
  balanceDate: string | null;
  balanceByCurrency: Record<string, number>;
  daysToSettle: number | null;
  gapFromPrev: number | null;
}

interface Props {
  pos: PurchaseOrder[];
  poCosts: POCost[];
  isLoading: boolean;
}

function gapColor(days: number | null): string {
  if (days === null) return 'text-slate-500';
  if (days <= 14) return 'text-red-400';
  if (days <= 30) return 'text-amber-400';
  if (days <= 60) return 'text-emerald-400';
  return 'text-sky-400';
}

function gapBg(days: number | null): string {
  if (days === null) return 'bg-slate-800/50 border-slate-700/30';
  if (days <= 14) return 'bg-red-500/10 border-red-500/20';
  if (days <= 30) return 'bg-amber-500/10 border-amber-500/20';
  if (days <= 60) return 'bg-emerald-500/10 border-emerald-500/20';
  return 'bg-sky-500/10 border-sky-500/20';
}

export default function POCashCycle({ pos, poCosts, isLoading }: Props) {
  const records = useMemo<POCashRecord[]>(() => {
    // Only POs with at least one principal payment entry
    const posWithPayments = pos.filter((po) =>
      poCosts.some((c) => c.po_id === po.po_id && PRINCIPAL_CATS.has(c.cost_category))
    );

    const mapped: POCashRecord[] = posWithPayments.map((po) => {
      const costs = poCosts.filter((c) => c.po_id === po.po_id);
      const downs = costs.filter((c) => DOWN_CATS.has(c.cost_category));
      const balances = costs.filter((c) => BALANCE_CATS.has(c.cost_category));

      const downDate =
        downs.length > 0
          ? downs.filter((d) => d.payment_date).map((d) => d.payment_date!).sort()[0] || null
          : null;

      const balanceDate =
        balances.length > 0
          ? balances.filter((b) => b.payment_date).map((b) => b.payment_date!).sort()[0] || null
          : null;

      const downByCurrency: Record<string, number> = {};
      downs.forEach((d) => { downByCurrency[d.currency] = (downByCurrency[d.currency] || 0) + d.amount; });

      const balanceByCurrency: Record<string, number> = {};
      balances.forEach((b) => { balanceByCurrency[b.currency] = (balanceByCurrency[b.currency] || 0) + b.amount; });

      const daysToSettle = downDate && balanceDate ? daysBetween(downDate, balanceDate) : null;

      return { po, downDate, downByCurrency, balanceDate, balanceByCurrency, daysToSettle, gapFromPrev: null };
    });

    // Sort ascending by down payment date to compute gaps correctly
    mapped.sort((a, b) => {
      if (!a.downDate) return 1;
      if (!b.downDate) return -1;
      return a.downDate.localeCompare(b.downDate);
    });

    // Compute gap from previous PO's down payment date
    for (let i = 1; i < mapped.length; i++) {
      const prev = mapped[i - 1];
      const curr = mapped[i];
      if (prev.downDate && curr.downDate) {
        curr.gapFromPrev = daysBetween(prev.downDate, curr.downDate);
      }
    }

    // Reverse for display: newest first
    return [...mapped].reverse();
  }, [pos, poCosts]);

  const summary = useMemo(() => {
    const withSettle = records.filter((r) => r.daysToSettle !== null);
    const avgSettleDays =
      withSettle.length > 0
        ? Math.round(withSettle.reduce((s, r) => s + r.daysToSettle!, 0) / withSettle.length)
        : null;

    const withGap = records.filter((r) => r.gapFromPrev !== null);
    const avgGapDays =
      withGap.length > 0
        ? Math.round(withGap.reduce((s, r) => s + r.gapFromPrev!, 0) / withGap.length)
        : null;

    const minGap = withGap.length > 0 ? Math.min(...withGap.map((r) => r.gapFromPrev!)) : null;
    const maxGap = withGap.length > 0 ? Math.max(...withGap.map((r) => r.gapFromPrev!)) : null;
    const awaitingBalance = records.filter((r) => r.downDate && !r.balanceDate).length;

    return { avgSettleDays, avgGapDays, minGap, maxGap, awaitingBalance, total: records.length };
  }, [records]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-slate-800/40 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-10 text-center ring-1 ring-white/5">
        <p className="text-slate-400 text-sm">No POs with payment records found.</p>
        <p className="text-slate-500 text-xs mt-1">Add down payments or balance payments under the Financials tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Avg. Cycle Gap
          </div>
          <div className="text-3xl font-extrabold text-sky-400 leading-none my-1">
            {summary.avgGapDays !== null ? `${summary.avgGapDays}d` : '—'}
          </div>
          <div className="text-xs text-slate-500 font-medium">days between PO payments</div>
          {summary.minGap !== null && summary.maxGap !== null && (
            <div className="text-[10px] text-slate-600 mt-1">range: {summary.minGap}d – {summary.maxGap}d</div>
          )}
        </div>

        <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Avg. Settlement
          </div>
          <div className="text-3xl font-extrabold text-amber-400 leading-none my-1">
            {summary.avgSettleDays !== null ? `${summary.avgSettleDays}d` : '—'}
          </div>
          <div className="text-xs text-slate-500 font-medium">days DP → balance payment</div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2">POs Tracked</div>
          <div className="text-3xl font-extrabold text-white leading-none my-1">{summary.total}</div>
          <div className="text-xs text-slate-500 font-medium">with payment records</div>
        </div>

        <div className={`backdrop-blur-sm rounded-2xl border p-5 ring-1 ring-white/5 shadow-lg transition-colors ${summary.awaitingBalance > 0 ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-slate-900/40 border-slate-800/80'}`}>
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            Awaiting Balance
          </div>
          <div className={`text-3xl font-extrabold leading-none my-1 ${summary.awaitingBalance > 0 ? 'text-yellow-400' : 'text-slate-600'}`}>
            {summary.awaitingBalance}
          </div>
          <div className="text-xs text-slate-500 font-medium">POs with DP but no balance yet</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500 font-medium bg-slate-900/30 rounded-xl px-4 py-3 border border-slate-800/60">
        <span className="text-slate-400 font-bold mr-1">Cycle gap:</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 shrink-0"></span> ≤14 days (very tight)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span> ≤30 days (tight)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span> ≤60 days (comfortable)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-400 shrink-0"></span> &gt;60 days (long cycle)</span>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {records.map((r) => (
          <div key={r.po.po_id} className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-5 ring-1 ring-white/5 shadow-lg">
            {/* PO header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sky-400 font-mono text-sm font-bold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">{r.po.po_number}</span>
                  {r.po.pi_number && <span className="text-violet-400 font-mono text-[10px] font-bold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">PI: {r.po.pi_number}</span>}
                </div>
                <div className="text-xs text-slate-500 font-medium">PO Date: {r.po.po_date}</div>
              </div>
              {r.gapFromPrev !== null && (
                <div className={`text-xs font-bold px-2.5 py-1 rounded-full border ${gapBg(r.gapFromPrev)} ${gapColor(r.gapFromPrev)}`}>
                  +{r.gapFromPrev}d gap
                </div>
              )}
              {r.gapFromPrev === null && (
                <span className="text-[10px] text-slate-600 font-medium bg-slate-800/50 px-2 py-1 rounded-full">first PO</span>
              )}
            </div>

            {/* Payment info */}
            <div className="grid grid-cols-2 gap-3 text-xs mb-4">
              <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/50">
                <div className="text-slate-500 mb-1 font-bold uppercase tracking-wider text-[10px]">Down Payment</div>
                <div className="text-white font-bold text-sm">{fmtByCurrency(r.downByCurrency)}</div>
                <div className="text-slate-400 mt-0.5">{r.downDate || '—'}</div>
              </div>
              <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/50">
                <div className="text-slate-500 mb-1 font-bold uppercase tracking-wider text-[10px]">Balance Payment</div>
                <div className="text-white font-bold text-sm">{fmtByCurrency(r.balanceByCurrency)}</div>
                <div className="text-slate-400 mt-0.5">{r.balanceDate || <span className="text-yellow-500">Pending</span>}</div>
              </div>
            </div>

            {/* Settlement time */}
            {r.daysToSettle !== null ? (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 text-xs flex justify-between items-center">
                <span className="text-slate-400 font-medium">Settlement time</span>
                <span className="text-amber-400 font-extrabold">{r.daysToSettle} days</span>
              </div>
            ) : (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-center text-yellow-500 font-bold uppercase tracking-wider">
                Awaiting balance payment
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800/80 ring-1 ring-white/5 shadow-xl bg-slate-900/30 scrollbar-thin scrollbar-thumb-slate-700 pb-2">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-900/80 text-slate-400 text-[11px] uppercase tracking-widest font-semibold border-b border-slate-800">
            <tr>
              <th className="px-5 py-4 text-left">PO #</th>
              <th className="px-4 py-4 text-left">PI #</th>
              <th className="px-4 py-4 text-left">PO Date</th>
              <th className="px-4 py-4 text-left">Down Payment Date</th>
              <th className="px-4 py-4 text-right">Down Amount</th>
              <th className="px-4 py-4 text-left">Balance Date</th>
              <th className="px-4 py-4 text-right">Balance Amount</th>
              <th className="px-4 py-4 text-right text-amber-400">Settle (days)</th>
              <th className="px-5 py-4 text-right text-sky-400">Cycle Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {records.map((r, idx) => (
              <tr key={r.po.po_id} className="hover:bg-slate-800/40 transition-colors group">
                <td className="px-5 py-4">
                  <span className="text-sky-400 font-mono text-xs font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">{r.po.po_number}</span>
                </td>
                <td className="px-4 py-4">
                  <span className="text-violet-400 font-mono text-[10px] font-semibold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">{r.po.pi_number || '—'}</span>
                </td>
                <td className="px-4 py-4 text-slate-300 text-xs font-medium">{r.po.po_date}</td>
                <td className="px-4 py-4 text-slate-300 text-xs font-medium">{r.downDate || <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-4 text-right text-slate-200 text-xs font-medium">{fmtByCurrency(r.downByCurrency)}</td>
                <td className="px-4 py-4 text-xs font-medium">
                  {r.balanceDate
                    ? <span className="text-slate-300">{r.balanceDate}</span>
                    : <span className="text-yellow-500 font-bold text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 uppercase tracking-wider">Pending</span>
                  }
                </td>
                <td className="px-4 py-4 text-right text-slate-200 text-xs font-medium">
                  {Object.keys(r.balanceByCurrency).length > 0 ? fmtByCurrency(r.balanceByCurrency) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-4 text-right">
                  {r.daysToSettle !== null
                    ? <span className="text-amber-400 font-extrabold">{r.daysToSettle}d</span>
                    : <span className="text-slate-600">—</span>
                  }
                </td>
                <td className="px-5 py-4 text-right">
                  {r.gapFromPrev !== null
                    ? (
                      <span className={`font-extrabold text-sm px-2.5 py-1 rounded-lg border ${gapBg(r.gapFromPrev)} ${gapColor(r.gapFromPrev)}`}>
                        +{r.gapFromPrev}d
                      </span>
                    )
                    : <span className="text-slate-600 text-xs font-medium">first</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-600 font-medium">
        Cycle gap = days from previous PO's down payment date to this PO's down payment date. Sorted newest first.
      </p>
    </div>
  );
}
