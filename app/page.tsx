'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
const fmtIdr = (n: number) =>
  n >= 1_000_000_000
    ? `IDR ${(n / 1_000_000_000).toFixed(2)}B`
    : n >= 1_000_000
    ? `IDR ${(n / 1_000_000).toFixed(1)}M`
    : `IDR ${Math.round(n).toLocaleString('en-US')}`;

function today() { return new Date().toISOString().slice(0, 10); }
function thisMonth() { return new Date().toISOString().slice(0, 7); }

export default function Home() {
  const { data, loading } = useSupabaseData();

  // ── Per-PO payment status ─────────────────────────────────────────────
  const poStatus = useMemo(() => {
    const r: Record<string, { totalIdr: number; paidIdr: number; pct: number }> = {};
    for (const po of data.pos) {
      const val = Number(po.total_value) || 0;
      const xr  = Number(po.exchange_rate) || 1;
      const totalIdr = po.currency === 'IDR' ? val : val * xr;
      const paidIdr = data.poCosts
        .filter((c) => String(c.po_id) === String(po.po_id) && PRINCIPAL_CATS.has(c.cost_category))
        .reduce((s, c) => s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * xr), 0);
      r[String(po.po_id)] = { totalIdr, paidIdr, pct: totalIdr > 0 ? Math.min(100, (paidIdr / totalIdr) * 100) : 0 };
    }
    return r;
  }, [data.pos, data.poCosts]);

  // ── Supplier code map ─────────────────────────────────────────────────
  const poCode = useMemo(() => {
    const r: Record<string, string> = {};
    for (const po of data.pos) {
      if (!po.quote_id) continue;
      const q = data.quotes.find((q) => String(q.quote_id) === String(po.quote_id));
      const s = q ? data.suppliers.find((s) => s.supplier_id === q.supplier_id) : null;
      if (s?.supplier_code) r[String(po.po_id)] = s.supplier_code;
    }
    return r;
  }, [data.pos, data.quotes, data.suppliers]);

  // ── Dashboard stats ───────────────────────────────────────────────────
  const stats = useMemo(() => {
    const todayStr = today();
    const monthStr = thisMonth();
    const activePOs = data.pos.filter((p) => p.status !== 'Cancelled');
    const outstandingIdr = activePOs.reduce((s, p) => {
      const { totalIdr, paidIdr } = poStatus[String(p.po_id)] ?? { totalIdr: 0, paidIdr: 0 };
      return s + Math.max(0, totalIdr - paidIdr);
    }, 0);
    const receivedThisMonth = data.pos.filter(
      (p) => p.actual_received_date?.startsWith(monthStr)
    ).length;
    return {
      activePOs: activePOs.length,
      outstandingIdr,
      receivedThisMonth,
      componentCount: data.components.length,
      // Attention lists
      noPayments: activePOs
        .filter((p) => p.status !== 'Fully Received' && p.status !== 'Partially Received' && !(poStatus[String(p.po_id)]?.paidIdr > 0))
        .slice(0, 5),
      overdue: activePOs
        .filter((p) =>
          p.estimated_delivery_date &&
          p.estimated_delivery_date < todayStr &&
          !p.actual_received_date &&
          p.status !== 'Cancelled'
        )
        .sort((a, b) => a.estimated_delivery_date!.localeCompare(b.estimated_delivery_date!))
        .slice(0, 5),
      noItems: activePOs
        .filter((p) => !data.poItems.find((i) => String(i.po_id) === String(p.po_id)))
        .slice(0, 5),
    };
  }, [data, poStatus]);

  // ── Recent POs ────────────────────────────────────────────────────────
  const recentPos = useMemo(
    () => [...data.pos].sort((a, b) => b.po_date.localeCompare(a.po_date)).slice(0, 15),
    [data.pos]
  );

  const attentionCount = stats.noPayments.length + stats.overdue.length + stats.noItems.length;

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm">
      {/* ── Header ── */}
      <div className="border-b border-slate-800/60 bg-[#0B1120]/80 backdrop-blur-md">
        <div className="max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-5 xl:py-6 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl md:text-3xl xl:text-4xl font-extrabold text-white tracking-tight">
              ICA Supply Chain{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400">
                Dashboard
              </span>
            </h1>
            <p className="text-slate-500 text-xs mt-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/insert"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors border border-emerald-500/50"
            >
              ✏️ Data Entry
            </Link>
            <Link
              href="/database"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors border border-slate-700"
            >
              📈 Intelligence
            </Link>
          </div>
        </div>
      </div>

      <main className="max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-6 xl:py-8 space-y-6 xl:space-y-8">

        {/* ── Stats row ── */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 xl:p-7 animate-pulse h-24 xl:h-32" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-6">
            {[
              {
                label: 'Outstanding',
                value: fmtIdr(stats.outstandingIdr),
                sub: 'unpaid across active POs',
                color: stats.outstandingIdr > 0 ? 'text-amber-300' : 'text-emerald-300',
                bg: stats.outstandingIdr > 0 ? 'border-amber-500/20' : 'border-emerald-500/20',
              },
              {
                label: 'Active POs',
                value: stats.activePOs.toString(),
                sub: 'not cancelled',
                color: 'text-sky-300',
                bg: 'border-sky-500/20',
              },
              {
                label: 'Received This Month',
                value: stats.receivedThisMonth.toString(),
                sub: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                color: 'text-emerald-300',
                bg: 'border-emerald-500/20',
              },
              {
                label: 'Components',
                value: stats.componentCount.toString(),
                sub: 'in catalog',
                color: 'text-violet-300',
                bg: 'border-violet-500/20',
              },
            ].map(({ label, value, sub, color, bg }) => (
              <div key={label} className={`bg-slate-900/40 border ${bg} rounded-2xl p-5 xl:p-7 ring-1 ring-white/5`}>
                <p className="text-[11px] xl:text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 xl:mb-2">{label}</p>
                <p className={`text-2xl xl:text-3xl 2xl:text-4xl font-extrabold ${color} leading-none`}>{value}</p>
                <p className="text-[11px] xl:text-xs text-slate-600 mt-1 xl:mt-2">{sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] 2xl:grid-cols-[1fr_520px] gap-5 xl:gap-7">

          {/* Needs Attention */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5 xl:p-6">
            <div className="flex items-center justify-between mb-4 xl:mb-5">
              <h2 className="text-sm xl:text-base font-bold text-white">Needs Attention</h2>
              {attentionCount === 0 && !loading && (
                <span className="text-xs text-emerald-400 font-semibold">✓ All clear</span>
              )}
            </div>

            {loading && <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>}

            {!loading && attentionCount === 0 && (
              <p className="text-slate-600 text-xs italic">No issues found.</p>
            )}

            {/* On 2xl: show 3 groups side-by-side; smaller: stacked */}
            {!loading && attentionCount > 0 && (
              <div className="2xl:grid 2xl:grid-cols-3 2xl:gap-6 space-y-4 2xl:space-y-0">
                <div>
                  {stats.noPayments.length > 0 ? (
                    <AttentionGroup icon="💳" label="No payments logged" color="text-amber-300" items={stats.noPayments} poCode={poCode} />
                  ) : (
                    <p className="hidden 2xl:block text-[11px] text-emerald-500/70 font-semibold">💳 No payments — ✓ all logged</p>
                  )}
                </div>
                <div>
                  {stats.overdue.length > 0 ? (
                    <AttentionGroup icon="🚨" label="Overdue delivery" color="text-red-400" items={stats.overdue} poCode={poCode} sub={(po) => po.estimated_delivery_date ? `Est. ${po.estimated_delivery_date}` : ''} />
                  ) : (
                    <p className="hidden 2xl:block text-[11px] text-emerald-500/70 font-semibold">🚨 Overdue — ✓ none</p>
                  )}
                </div>
                <div>
                  {stats.noItems.length > 0 ? (
                    <AttentionGroup icon="📋" label="No line items" color="text-slate-400" items={stats.noItems} poCode={poCode} />
                  ) : (
                    <p className="hidden 2xl:block text-[11px] text-emerald-500/70 font-semibold">📋 Line items — ✓ all present</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Recent POs */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5 xl:p-6">
            <div className="flex items-center justify-between mb-4 xl:mb-5">
              <h2 className="text-sm xl:text-base font-bold text-white">Recent POs</h2>
              <Link href="/insert?tab=lookup" className="text-xs text-slate-500 hover:text-sky-300 transition-colors">
                View all →
              </Link>
            </div>
            {loading && <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>}
            {!loading && (
              <div className="space-y-1.5">
                {recentPos.map((po) => {
                  const key = String(po.po_id);
                  const { totalIdr, paidIdr, pct } = poStatus[key] ?? { totalIdr: 0, paidIdr: 0, pct: 0 };
                  const code = poCode[key];
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-2.5 xl:py-3 bg-slate-800/30 rounded-xl hover:bg-slate-800/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {code && (
                            <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                              {code}
                            </span>
                          )}
                          <span className="text-xs font-semibold text-white truncate">
                            {po.pi_number || po.po_number}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{po.po_date}</p>
                      </div>
                      {totalIdr > 0 ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-16 xl:w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-[11px] font-semibold w-9 text-right ${pct >= 100 ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-600 flex-shrink-0">no value</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Quick access ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 xl:gap-6">
          {[
            { href: '/insert?tab=quoting',    icon: '📝', label: 'New Quote',   sub: 'Enter supplier quote / PI',     color: 'hover:border-blue-500/40' },
            { href: '/insert?tab=ordering',   icon: '📦', label: 'New PO',      sub: 'Create purchase order',         color: 'hover:border-violet-500/40' },
            { href: '/insert?tab=financials', icon: '💰', label: 'Log Payment', sub: 'Record payment or bank charges', color: 'hover:border-rose-500/40' },
          ].map(({ href, icon, label, sub, color }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-4 px-4 py-4 xl:px-6 xl:py-5 bg-slate-900/40 border border-slate-800/80 ${color} rounded-2xl ring-1 ring-white/5 transition-colors group`}
            >
              <span className="text-2xl xl:text-3xl flex-shrink-0">{icon}</span>
              <div>
                <p className="text-sm xl:text-base font-bold text-white group-hover:text-slate-100">{label}</p>
                <p className="text-xs xl:text-sm text-slate-500">{sub}</p>
              </div>
              <span className="ml-auto text-slate-600 group-hover:text-slate-400 text-lg xl:text-xl">→</span>
            </Link>
          ))}
        </div>

      </main>
    </div>
  );
}

// ── Attention group sub-component ──────────────────────────────────────────

import type { PurchaseOrder } from '@/types/database';

function AttentionGroup({
  icon, label, color, items, poCode, sub,
}: {
  icon: string;
  label: string;
  color: string;
  items: PurchaseOrder[];
  poCode: Record<string, string>;
  sub?: (po: PurchaseOrder) => string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${color} mb-1.5 flex items-center gap-1.5`}>
        <span>{icon}</span>{label}
        <span className="text-slate-600 font-normal normal-case">({items.length})</span>
      </p>
      <div className="space-y-1">
        {items.map((po) => {
          const code = poCode[String(po.po_id)];
          return (
            <div key={String(po.po_id)} className="flex items-center gap-2 px-3 py-2 bg-slate-800/30 rounded-xl text-xs">
              {code && (
                <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                  {code}
                </span>
              )}
              <span className="text-slate-200 font-medium truncate">
                {po.pi_number || po.po_number}
              </span>
              {sub?.(po) && <span className="text-slate-500 flex-shrink-0 ml-auto">{sub(po)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
