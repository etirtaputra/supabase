/**
 * POCashCycle — Cash Conversion Cycle per Product
 *
 * For each component/product that appears in ≥2 POs with a completed balance
 * payment, we track the reorder cycle:
 *
 *   Cycle gap = days between consecutive balance-paid dates for the same component
 *
 * This answers: "how long does one batch of ICA550 last before we need to
 * order more?" — i.e. from PO1 fully settled → PO2 fully settled.
 *
 * Only POs with a balance_payment or additional_balance_payment entry (with a
 * payment_date) are considered "settled". The settled date = latest balance
 * payment date for that PO (covering split balance payments).
 */
'use client';
import { useMemo, useState } from 'react';
import type {
  PurchaseOrder,
  POCost,
  PurchaseLineItem,
  Component,
  PriceQuote,
  Supplier,
} from '@/types/database';

// ─── Constants ───────────────────────────────────────────────────────────────
const BALANCE_CATS = new Set(['balance_payment', 'additional_balance_payment']);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

const fmtQty = (n: number) => n.toLocaleString('en-US');

function gapColor(days: number | null): string {
  if (days === null) return 'text-slate-500';
  if (days <= 30)  return 'text-red-400';
  if (days <= 60)  return 'text-amber-400';
  if (days <= 120) return 'text-emerald-400';
  return 'text-sky-400';
}
function gapBadge(days: number | null): string {
  if (days === null) return 'bg-slate-800/50 border-slate-700/40 text-slate-500';
  if (days <= 30)  return 'bg-red-500/10 border-red-500/25 text-red-400';
  if (days <= 60)  return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
  if (days <= 120) return 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400';
  return 'bg-sky-500/10 border-sky-500/25 text-sky-400';
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface SettledPOEntry {
  po: PurchaseOrder;
  settledDate: string;       // latest balance payment date for this PO
  quantity: number;          // qty ordered for this component in this PO
  supplierDescription: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  cycleGap: number | null;   // days from previous settled PO for same component
}

interface ComponentCycle {
  component: Component;
  entries: SettledPOEntry[]; // sorted by settledDate ascending
  avgCycle: number | null;
  minCycle: number | null;
  maxCycle: number | null;
  cycleCount: number;        // number of gaps (entries - 1)
}

interface Props {
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  components: Component[];
  quotes: PriceQuote[];
  suppliers: Supplier[];
  isLoading: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function POCashCycle({
  pos,
  poItems,
  poCosts,
  components,
  quotes,
  suppliers,
  isLoading,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Build lookup maps ─────────────────────────────────────────────────────
  const quoteMap = useMemo(
    () => new Map(quotes.map((q) => [q.quote_id, q])),
    [quotes]
  );
  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.supplier_id, s])),
    [suppliers]
  );
  const componentMap = useMemo(
    () => new Map(components.map((c) => [c.component_id, c])),
    [components]
  );

  // ── Compute settled date per PO ───────────────────────────────────────────
  const poSettledDate = useMemo<Map<number, string>>(() => {
    const map = new Map<number, string>();
    poCosts.forEach((cost) => {
      if (!BALANCE_CATS.has(cost.cost_category) || !cost.payment_date) return;
      const existing = map.get(cost.po_id);
      // Take the LATEST balance payment date (fully settled = last cash out)
      if (!existing || cost.payment_date > existing) {
        map.set(cost.po_id, cost.payment_date);
      }
    });
    return map;
  }, [poCosts]);

  // ── Supplier lookup per PO (via quote_id → supplier_id) ──────────────────
  const poSupplierMap = useMemo<Map<number, Supplier | null>>(() => {
    const map = new Map<number, Supplier | null>();
    pos.forEach((po) => {
      if (!po.quote_id) { map.set(po.po_id, null); return; }
      const quote = quoteMap.get(po.quote_id);
      if (!quote) { map.set(po.po_id, null); return; }
      map.set(po.po_id, supplierMap.get(quote.supplier_id) ?? null);
    });
    return map;
  }, [pos, quoteMap, supplierMap]);

  // ── Core computation: group poItems by component, then by settled PO ─────
  const cycles = useMemo<ComponentCycle[]>(() => {
    // component_id → list of (settled) PO entries
    const byComponent = new Map<number, SettledPOEntry[]>();

    poItems.forEach((item) => {
      const settledDate = poSettledDate.get(item.po_id);
      if (!settledDate) return; // PO not yet settled — skip

      const po = pos.find((p) => p.po_id === item.po_id);
      if (!po) return;

      const supplier = poSupplierMap.get(item.po_id) ?? null;

      const entry: SettledPOEntry = {
        po,
        settledDate,
        quantity: item.quantity,
        supplierDescription: item.supplier_description ?? null,
        supplierName: supplier?.supplier_name ?? null,
        supplierCode: supplier?.supplier_code ?? null,
        cycleGap: null,
      };

      const list = byComponent.get(item.component_id) ?? [];
      list.push(entry);
      byComponent.set(item.component_id, list);
    });

    const result: ComponentCycle[] = [];

    byComponent.forEach((entries, componentId) => {
      // Only show components with ≥2 settled POs (need at least one cycle)
      if (entries.length < 2) return;

      const component = componentMap.get(componentId);
      if (!component) return;

      // Sort by settled date ascending
      entries.sort((a, b) => a.settledDate.localeCompare(b.settledDate));

      // Compute cycle gaps
      for (let i = 1; i < entries.length; i++) {
        entries[i].cycleGap = daysBetween(entries[i - 1].settledDate, entries[i].settledDate);
      }

      const gaps = entries.map((e) => e.cycleGap).filter((g): g is number => g !== null);
      const avgCycle = gaps.length > 0 ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;
      const minCycle = gaps.length > 0 ? Math.min(...gaps) : null;
      const maxCycle = gaps.length > 0 ? Math.max(...gaps) : null;

      result.push({
        component,
        entries: [...entries].reverse(), // newest first for display
        avgCycle,
        minCycle,
        maxCycle,
        cycleCount: gaps.length,
      });
    });

    // Sort by avgCycle ascending (fastest-turning products first)
    result.sort((a, b) => (a.avgCycle ?? 9999) - (b.avgCycle ?? 9999));
    return result;
  }, [poItems, poSettledDate, pos, poSupplierMap, componentMap]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const allGaps = cycles.flatMap((c) => c.entries.map((e) => e.cycleGap).filter((g): g is number => g !== null));
    const overallAvg = allGaps.length > 0 ? Math.round(allGaps.reduce((s, g) => s + g, 0) / allGaps.length) : null;
    const overallMin = allGaps.length > 0 ? Math.min(...allGaps) : null;
    const overallMax = allGaps.length > 0 ? Math.max(...allGaps) : null;
    const fastestProduct = cycles[0] ?? null;
    const slowestProduct = cycles[cycles.length - 1] ?? null;
    return { overallAvg, overallMin, overallMax, fastestProduct, slowestProduct };
  }, [cycles]);

  // ─── Render ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-slate-800/40 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (cycles.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-10 text-center ring-1 ring-white/5">
        <div className="text-3xl mb-3">📦</div>
        <p className="text-slate-300 text-sm font-semibold">No reorder cycles found yet.</p>
        <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">
          Cycles appear when the same product has been ordered and fully paid (balance settled) across 2 or more POs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Avg. Reorder Cycle
          </div>
          <div className="text-3xl font-extrabold text-violet-400 leading-none my-1">
            {summary.overallAvg !== null ? `${summary.overallAvg}d` : '—'}
          </div>
          <div className="text-xs text-slate-500 font-medium">across all products</div>
          {summary.overallMin !== null && summary.overallMax !== null && (
            <div className="text-[10px] text-slate-600 mt-1">range: {summary.overallMin}d – {summary.overallMax}d</div>
          )}
        </div>

        <div className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2">Products Tracked</div>
          <div className="text-3xl font-extrabold text-white leading-none my-1">{cycles.length}</div>
          <div className="text-xs text-slate-500 font-medium">with ≥2 settled POs</div>
        </div>

        <div className="bg-red-500/5 rounded-2xl border border-red-500/20 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2">Fastest Reorder</div>
          {summary.fastestProduct ? (
            <>
              <div className="text-2xl font-extrabold text-red-400 leading-none my-1">
                {summary.fastestProduct.avgCycle}d avg
              </div>
              <div className="text-xs text-slate-300 font-semibold truncate">{summary.fastestProduct.component.supplier_model}</div>
              <div className="text-[10px] text-slate-500 truncate">{summary.fastestProduct.component.internal_description}</div>
            </>
          ) : <div className="text-slate-600">—</div>}
        </div>

        <div className="bg-sky-500/5 rounded-2xl border border-sky-500/20 p-5 ring-1 ring-white/5 shadow-lg">
          <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest mb-2">Slowest Reorder</div>
          {summary.slowestProduct ? (
            <>
              <div className="text-2xl font-extrabold text-sky-400 leading-none my-1">
                {summary.slowestProduct.avgCycle}d avg
              </div>
              <div className="text-xs text-slate-300 font-semibold truncate">{summary.slowestProduct.component.supplier_model}</div>
              <div className="text-[10px] text-slate-500 truncate">{summary.slowestProduct.component.internal_description}</div>
            </>
          ) : <div className="text-slate-600">—</div>}
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500 font-medium bg-slate-900/30 rounded-xl px-4 py-3 border border-slate-800/60">
        <span className="text-slate-400 font-bold mr-1">Cycle gap:</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 shrink-0"></span> ≤30d (very fast reorder)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span> ≤60d (fast)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span> ≤120d (moderate)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-400 shrink-0"></span> &gt;120d (slow reorder)</span>
      </div>

      {/* ── Per-Component Cards ─────────────────────────────────────────── */}
      <div className="space-y-4">
        {cycles.map(({ component, entries, avgCycle, minCycle, maxCycle, cycleCount }) => {
          const isExpanded = expandedIds.has(component.component_id);
          // Collect unique suppliers across all entries
          const suppliersInCycle = [...new Set(
            entries.map((e) => e.supplierName).filter(Boolean)
          )] as string[];

          return (
            <div
              key={component.component_id}
              className="bg-slate-900/40 rounded-2xl border border-slate-800/80 ring-1 ring-white/5 shadow-lg overflow-hidden"
            >
              {/* Card header — always visible */}
              <button
                onClick={() => toggleExpand(component.component_id)}
                className="w-full text-left px-5 py-4 hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: component info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-violet-300 font-mono text-sm font-bold bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                        {component.supplier_model}
                      </span>
                      {component.category && (
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50">
                          {component.category.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-200 text-sm font-semibold truncate">{component.internal_description}</div>
                    {suppliersInCycle.length > 0 && (
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                        {suppliersInCycle.join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Right: cycle stats */}
                  <div className="flex items-center gap-5 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Avg cycle</div>
                      <div className={`text-xl font-extrabold ${gapColor(avgCycle)}`}>
                        {avgCycle !== null ? `${avgCycle}d` : '—'}
                      </div>
                      {minCycle !== null && maxCycle !== null && minCycle !== maxCycle && (
                        <div className="text-[10px] text-slate-600">{minCycle}d – {maxCycle}d</div>
                      )}
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Cycles</div>
                      <div className="text-xl font-extrabold text-slate-300">{cycleCount}</div>
                      <div className="text-[10px] text-slate-600">{entries.length} POs</div>
                    </div>
                    <div className={`flex items-center justify-center w-7 h-7 rounded-full border transition-transform duration-200 ${isExpanded ? 'bg-slate-700 border-slate-600 rotate-180' : 'bg-slate-800/60 border-slate-700/60'}`}>
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                </div>

                {/* Mobile stats row */}
                <div className="flex sm:hidden gap-4 mt-2 text-xs">
                  <div>
                    <span className="text-slate-500">Avg: </span>
                    <span className={`font-bold ${gapColor(avgCycle)}`}>{avgCycle !== null ? `${avgCycle}d` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cycles: </span>
                    <span className="font-bold text-slate-300">{cycleCount}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">POs: </span>
                    <span className="font-bold text-slate-300">{entries.length}</span>
                  </div>
                </div>
              </button>

              {/* Expandable PO table */}
              {isExpanded && (
                <div className="border-t border-slate-800/80">
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead className="bg-slate-950/50 text-slate-500 text-[10px] uppercase tracking-widest font-bold border-b border-slate-800/60">
                        <tr>
                          <th className="px-5 py-3 text-left">#</th>
                          <th className="px-4 py-3 text-left">PO #</th>
                          <th className="px-4 py-3 text-left">PI #</th>
                          <th className="px-4 py-3 text-left">Supplier</th>
                          <th className="px-4 py-3 text-left">Description</th>
                          <th className="px-4 py-3 text-right">Qty</th>
                          <th className="px-4 py-3 text-right">Balance Settled</th>
                          <th className="px-5 py-3 text-right text-violet-400">Cycle Gap</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {entries.map((entry, idx) => (
                          <tr key={entry.po.po_id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-5 py-3 text-slate-500 font-bold">{entries.length - idx}</td>
                            <td className="px-4 py-3">
                              <span className="text-sky-400 font-mono font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
                                {entry.po.po_number}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {entry.po.pi_number
                                ? <span className="text-slate-400 font-mono">{entry.po.pi_number}</span>
                                : <span className="text-slate-700">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {entry.supplierName ? (
                                <div>
                                  <div className="text-slate-200 font-semibold">{entry.supplierName}</div>
                                  {entry.supplierCode && (
                                    <div className="text-slate-500 text-[10px]">{entry.supplierCode}</div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-600 italic">Unknown</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">
                              {entry.supplierDescription || '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-200 font-mono font-semibold">
                              {fmtQty(entry.quantity)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-300 font-medium">
                              {entry.settledDate}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {entry.cycleGap !== null ? (
                                <span className={`font-extrabold px-2 py-0.5 rounded border text-xs ${gapBadge(entry.cycleGap)}`}>
                                  {entry.cycleGap}d
                                </span>
                              ) : (
                                <span className="text-slate-600 text-[10px] font-medium">first</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile list */}
                  <div className="sm:hidden divide-y divide-slate-800/60">
                    {entries.map((entry, idx) => (
                      <div key={entry.po.po_id} className="px-5 py-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-bold text-xs">#{entries.length - idx}</span>
                            <span className="text-sky-400 font-mono text-xs font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">{entry.po.po_number}</span>
                            {entry.po.pi_number && <span className="text-slate-400 font-mono text-[10px]">{entry.po.pi_number}</span>}
                          </div>
                          {entry.cycleGap !== null ? (
                            <span className={`font-extrabold text-xs px-2 py-0.5 rounded border ${gapBadge(entry.cycleGap)}`}>{entry.cycleGap}d</span>
                          ) : (
                            <span className="text-slate-600 text-[10px] font-medium">first</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>
                            <span className="text-slate-500">Supplier: </span>
                            <span className="text-slate-200 font-semibold">{entry.supplierName ?? 'Unknown'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Qty: </span>
                            <span className="text-slate-200 font-semibold font-mono">{fmtQty(entry.quantity)}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-500">Settled: </span>
                            <span className="text-slate-300 font-medium">{entry.settledDate}</span>
                          </div>
                          {entry.supplierDescription && (
                            <div className="col-span-2 text-slate-500 truncate">{entry.supplierDescription}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-600 font-medium">
        Cycle gap = days between consecutive balance-settled dates for the same product.
        Sorted by average cycle (fastest reorder first). Only products with ≥2 settled POs shown.
      </p>
    </div>
  );
}
