/**
 * ProductCostLookup — mobile-first
 *
 * Summary dashboard → A) Quotes → B) PO allocations → C) PO cost reference
 *
 * Cost allocation:
 * line_share = (unit_cost × qty) / total_po_value_foreign
 * true_unit_cost_idr = (alloc_principal + alloc_bank_fees + alloc_landed) / qty
 * PPN (local_vat, local_income_tax) excluded. All amounts entered ex-tax.
 * True cost only shown when balance_payment exists for that PO.
 */
'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import type {
  Component,
  PriceQuote,
  PriceQuoteLineItem,
  PurchaseOrder,
  PurchaseLineItem,
  POCost,
  Supplier,
} from '@/types/database';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS, BALANCE_CATS } from '@/constants/costCategories';
import { fmtIdr, fmtNum } from '@/lib/formatters';
const COST_LABELS: Record<string, string> = {
  down_payment: 'Down Payment', balance_payment: 'Balance Payment',
  additional_balance_payment: 'Additional Balance', overpayment_credit: 'Overpayment Credit',
  full_amount_bank_fee: 'Bank Fee (Full Amount)', telex_bank_fee: 'Bank Fee (Telex)',
  value_today_bank_fee: 'Bank Fee (Value Today)', admin_bank_fee: 'Bank Fee (Admin)',
  inter_bank_transfer_fee: 'Inter-bank Transfer Fee', local_import_duty: 'Import Duty',
  local_vat: 'Local VAT / PPN', local_income_tax: 'Income Tax (PPh)',
  local_delivery: 'Local Delivery', demurrage_fee: 'Demurrage', penalty_fee: 'Penalty',
  dhl_advance_payment_fee: 'DHL Advance Fee', local_import_tax: 'Import Tax',
};
interface Props {
  components: Component[]; quotes: PriceQuote[]; quoteItems: PriceQuoteLineItem[];
  pos: PurchaseOrder[]; poItems: PurchaseLineItem[]; poCosts: POCost[];
  suppliers: Supplier[]; isLoading: boolean;
}
interface Allocation {
  item: PurchaseLineItem; po: PurchaseOrder; lineValueForeign: number;
  totalPoValueForeign: number; lineShare: number; principal: number; bankFees: number;
  landed: number; allocPrincipal: number; allocBankFees: number; allocLanded: number;
  totalAllocated: number; trueUnitCostIdr: number; hasBalancePayment: boolean;
}
interface POCostGroup {
  po: PurchaseOrder; costs: POCost[]; hasBalancePayment: boolean;
  subtotalByCurrency: Record<string, number>;
  principalIdr: number; bankFeesIdr: number; landedIdr: number; totalExclTaxIdr: number;
}
function StatusBadge({ status }: { status?: string }) {
  const cls =
    status === 'Accepted' || status === 'Fully Received' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    status === 'Rejected' || status === 'Expired' || status === 'Cancelled' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
    status === 'Partially Received' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-slate-500/10 text-slate-300 border-slate-500/20';
  return <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${cls}`}>{status || '—'}</span>;
}
// Highlight matching substring within a string
function hl(text: string | null | undefined, q: string): React.ReactNode {
  if (!text) return '—';
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return <>{text.slice(0, idx)}<mark className="bg-sky-500/30 text-sky-200 rounded-sm not-italic">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

export default function ProductCostLookup({ components, quotes, quoteItems, pos, poItems, poCosts, suppliers, isLoading }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Component | null>(null);
  const [showDrop, setShowDrop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { history, push: pushHistory, clear: clearHistory } = useSearchHistory('cost-lookup-history');
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Last quoted price per component (for dropdown preview)
  const lastQuoteByComp = useMemo(() => {
    const qMap = new Map(quotes.map((q) => [q.quote_id, q]));
    const map = new Map<string, { price: number; currency: string; date: string }>();
    quoteItems.forEach((item) => {
      if (!item.component_id) return;
      const q = qMap.get(item.quote_id);
      if (!q) return;
      const ex = map.get(item.component_id);
      if (!ex || q.quote_date > ex.date) map.set(item.component_id, { price: item.unit_price, currency: item.currency, date: q.quote_date });
    });
    return map;
  }, [quoteItems, quotes]);

  const candidates = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const scoreOf = (c: Component) => {
      const mod = c.supplier_model?.toLowerCase() ?? '';
      const desc = c.internal_description?.toLowerCase() ?? '';
      if (mod.startsWith(q) || desc.startsWith(q)) return 0;
      if (mod.includes(q) || desc.includes(q)) return 1;
      return 2; // brand / category match
    };
    return components
      .filter((c) =>
        c.supplier_model?.toLowerCase().includes(q) ||
        c.internal_description?.toLowerCase().includes(q) ||
        c.brand?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      )
      .sort((a, b) => scoreOf(a) - scoreOf(b))
      .slice(0, 20);
  }, [query, components]);
  const selectComponent = (c: Component) => {
    setSelected(c); setQuery(c.internal_description || c.supplier_model); setShowDrop(false);
    pushHistory({ componentId: c.component_id, label: c.internal_description || c.supplier_model, sublabel: c.supplier_model });
  };
  const myQuoteItems = useMemo(() =>
    selected ? [...quoteItems.filter((qi) => qi.component_id === selected.component_id)].sort((a, b) => {
      const dA = quotes.find((q) => q.quote_id === a.quote_id)?.quote_date || '';
      const dB = quotes.find((q) => q.quote_id === b.quote_id)?.quote_date || '';
      return dB.localeCompare(dA);
    }) : [],
  [selected, quoteItems, quotes]);
  const myPoItems = useMemo(() =>
    selected ? poItems.filter((pi) => pi.component_id === selected.component_id) : [],
  [selected, poItems]);
  const allocations = useMemo<Allocation[]>(() => {
    return myPoItems.map((item): Allocation | null => {
      const po = pos.find((p) => p.po_id === item.po_id);
      if (!po) return null;
      const allPoItems = poItems.filter((i) => i.po_id === item.po_id && i.quantity > 0);
      const totalPoValueForeign = allPoItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
      const lineValueForeign = item.unit_cost * item.quantity;
      const lineShare = totalPoValueForeign > 0 ? lineValueForeign / totalPoValueForeign : 0;
      const costs = poCosts.filter((c) => c.po_id === item.po_id);
      const hasBalancePayment = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      // Convert every cost to IDR at the actual payment rate (cost.exchange_rate if recorded,
      // else PO rate). This makes TUC reflect what was truly paid in IDR, not the committed rate.
      const toIdr = (c: typeof costs[number]) => {
        if (c.currency === 'IDR') return Number(c.amount);
        const rate = Number(c.exchange_rate) || Number(po.exchange_rate) || 1;
        return Number(c.amount) * rate;
      };
      const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const bankFees = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const landed = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdr(c), 0);
      const allocPrincipal = lineShare * principal, allocBankFees = lineShare * bankFees, allocLanded = lineShare * landed;
      const totalAllocated = allocPrincipal + allocBankFees + allocLanded;
      const trueUnitCostIdr = item.quantity > 0 ? totalAllocated / item.quantity : 0;
      return { item, po, lineValueForeign, totalPoValueForeign, lineShare, principal, bankFees, landed, allocPrincipal, allocBankFees, allocLanded, totalAllocated, trueUnitCostIdr, hasBalancePayment };
    }).filter((a): a is Allocation => a !== null).sort((a, b) => b.po.po_date.localeCompare(a.po.po_date));
  }, [myPoItems, poItems, pos, poCosts]);
  const summary = useMemo(() => {
    const paidAllocs = allocations.filter((a) => a.hasBalancePayment && a.trueUnitCostIdr > 0);
    const paidWeighted = paidAllocs.reduce((s, a) => s + a.trueUnitCostIdr * a.item.quantity, 0);
    const paidQty = paidAllocs.reduce((s, a) => s + a.item.quantity, 0);
    const avgTrueUnitCostIdr = paidQty > 0 ? paidWeighted / paidQty : null;
    // Most recent paid PO TUC
    const sortedPaid = [...paidAllocs].sort((a, b) => b.po.po_date.localeCompare(a.po.po_date));
    const lastPoTucIdr = sortedPaid[0]?.trueUnitCostIdr ?? null;
    // Actual TUC = max(last, avg) — conservative cost floor
    const actualTucIdr =
      lastPoTucIdr != null && avgTrueUnitCostIdr != null ? Math.max(lastPoTucIdr, avgTrueUnitCostIdr) :
      lastPoTucIdr ?? avgTrueUnitCostIdr;
    const lastPaidPoDate = paidAllocs.length > 0 ? paidAllocs.map((a) => a.po.po_date).sort((a, b) => b.localeCompare(a))[0] : null;
    const poByCurrency: Record<string, { totalValue: number; totalQty: number }> = {};
    myPoItems.forEach((pi) => {
      if (!poByCurrency[pi.currency]) poByCurrency[pi.currency] = { totalValue: 0, totalQty: 0 };
      poByCurrency[pi.currency].totalValue += pi.unit_cost * pi.quantity;
      poByCurrency[pi.currency].totalQty += pi.quantity;
    });
    const quoteByCurrency: Record<string, { totalValue: number; totalQty: number }> = {};
    myQuoteItems.forEach((qi) => {
      if (!quoteByCurrency[qi.currency]) quoteByCurrency[qi.currency] = { totalValue: 0, totalQty: 0 };
      quoteByCurrency[qi.currency].totalValue += qi.unit_price * qi.quantity;
      quoteByCurrency[qi.currency].totalQty += qi.quantity;
    });
    return {
      avgTrueUnitCostIdr, lastPoTucIdr, actualTucIdr, paidPoCount: paidAllocs.length, lastPaidPoDate, poByCurrency, quoteByCurrency,
      totalOrderedQty: myPoItems.reduce((s, i) => s + i.quantity, 0),
      totalQuotedQty: myQuoteItems.reduce((s, i) => s + i.quantity, 0),
    };
  }, [allocations, myPoItems, myQuoteItems]);
  const relatedPoIds = useMemo(() => new Set(myPoItems.map((i) => i.po_id)), [myPoItems]);
  const poCostGroups = useMemo<POCostGroup[]>(() => {
    const sortedPoIds = [...relatedPoIds].sort((a, b) => {
      const dA = pos.find((p) => p.po_id === a)?.po_date || '';
      const dB = pos.find((p) => p.po_id === b)?.po_date || '';
      return dB.localeCompare(dA);
    });
    return sortedPoIds.flatMap((poId) => {
      const po = pos.find((p) => p.po_id === poId);
      if (!po) return [];
      const costs = poCosts.filter((c) => c.po_id === poId).sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
      const hasBalancePayment = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const subtotalByCurrency: Record<string, number> = {};
      costs.filter((c) => !TAX_CATS.has(c.cost_category)).forEach((c) => {
        subtotalByCurrency[c.currency] = (subtotalByCurrency[c.currency] || 0) + c.amount;
      });
      // IDR equivalents for % breakdown (using actual payment rate)
      const toIdrG = (c: POCost) => {
        if (c.currency === 'IDR') return Number(c.amount);
        return Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
      };
      const principalIdr     = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrG(c), 0);
      const bankFeesIdr      = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrG(c), 0);
      const landedIdr        = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrG(c), 0);
      const totalExclTaxIdr  = principalIdr + bankFeesIdr + landedIdr;
      return [{ po, costs, hasBalancePayment, subtotalByCurrency, principalIdr, bankFeesIdr, landedIdr, totalExclTaxIdr }];
    });
  }, [relatedPoIds, pos, poCosts]);
  const getQuote = (id: number) => quotes.find((q) => q.quote_id === id);
  const getSupplier = (id?: number) => suppliers.find((s) => s.supplier_id === id)?.supplier_name || '—';
  const hasData = selected && (myQuoteItems.length > 0 || myPoItems.length > 0);
  return (
    <div className="space-y-8 md:space-y-10">
      {/* Search Container */}
      <div ref={containerRef} className="relative z-20 max-w-3xl">
        <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-widest">Lookup Component / SKU</label>
        <div className="relative shadow-xl shadow-black/20 rounded-2xl">
          <input type="text" value={query}
            onChange={(e) => { setQuery(e.target.value); setShowDrop(true); if (!e.target.value) setSelected(null); }}
            onFocus={() => setShowDrop(true)}
            placeholder="Search e.g. 'inverter', 'MPPT', 'solar panel'…"
            className="w-full bg-slate-900/80 border border-slate-700/80 backdrop-blur-md rounded-2xl px-5 py-4 pl-12 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20 transition-all text-sm md:text-base"
            disabled={isLoading}
          />
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        {showDrop && (candidates.length > 0 || (!query.trim() && history.length > 0)) && (
          <ul className="absolute z-50 mt-2 w-full bg-slate-800/95 backdrop-blur-xl border border-slate-700 rounded-xl shadow-2xl overflow-auto max-h-80 ring-1 ring-white/10">
            {!query.trim() && history.length > 0 && (
              <>
                <li className="px-4 pt-3 pb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recent Searches</span>
                  <button onMouseDown={clearHistory} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
                </li>
                {history.map((h) => {
                  const comp = components.find((c) => c.component_id === h.componentId);
                  if (!comp) return null;
                  return (
                    <li key={h.componentId} onMouseDown={() => selectComponent(comp)} className="px-4 py-3 hover:bg-slate-700/50 cursor-pointer border-b border-slate-700/50 last:border-0 transition-colors group flex items-start gap-3">
                      <span className="text-slate-500 text-xs mt-0.5 flex-shrink-0">🕐</span>
                      <div>
                        <p className="text-white text-sm font-semibold group-hover:text-sky-300 transition-colors">{h.label}</p>
                        {h.sublabel && h.sublabel !== h.label && <p className="text-slate-400 text-xs mt-0.5">{h.sublabel}</p>}
                      </div>
                    </li>
                  );
                })}
              </>
            )}
            {query.trim() && (
              <>
                <li className="px-4 pt-2.5 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {candidates.length === 0 ? 'No results' : `${candidates.length} result${candidates.length === 1 ? '' : 's'}`}
                  </span>
                </li>
                {candidates.map((c) => {
                  const lp = lastQuoteByComp.get(c.component_id);
                  const q = query.trim();
                  return (
                    <li key={c.component_id} onMouseDown={() => selectComponent(c)} className="px-5 py-3 hover:bg-slate-700/50 cursor-pointer border-b border-slate-700/50 last:border-0 transition-colors group">
                      <div className="text-white text-sm font-semibold group-hover:text-sky-300 transition-colors">{hl(c.internal_description, q)}</div>
                      <div className="text-slate-400 text-xs mt-0.5 font-medium">
                        {hl(c.supplier_model, q)}
                        {c.brand && <> · <span className="text-slate-500">{hl(c.brand, q)}</span></>}
                        {c.category && <span className="ml-1.5 px-1.5 py-0.5 bg-slate-700/60 text-slate-400 text-[10px] rounded">{c.category}</span>}
                      </div>
                      {lp && (
                        <div className="text-sky-400/80 text-[11px] mt-0.5 tabular-nums">
                          {lp.currency} {lp.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span className="text-slate-600 ml-1.5">last quoted {new Date(lp.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        )}
      </div>
      {selected && !hasData && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 text-center">
          <p className="text-slate-400 text-sm">No quote or PO records found for this component.</p>
        </div>
      )}
      {/* Component Info Card */}
      {selected && (
        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 md:p-6 grid grid-cols-2 sm:flex sm:flex-wrap gap-6 sm:gap-10 ring-1 ring-white/5 shadow-lg">
          <div className="col-span-2 sm:col-span-1 min-w-[200px]">
            <div className="text-[11px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">Description</div>
            <div className="text-white font-bold text-base md:text-lg leading-tight">{selected.internal_description}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">SKU</div>
            <div className="text-sky-400 font-mono text-sm md:text-base font-medium bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20 inline-block">{selected.supplier_model}</div>
          </div>
          {selected.brand && <div><div className="text-[11px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">Brand</div><div className="text-slate-200 text-sm md:text-base font-medium">{selected.brand}</div></div>}
          {selected.category && <div><div className="text-[11px] text-slate-500 uppercase font-bold tracking-widest mb-1.5">Category</div><div className="text-slate-200 text-sm md:text-base font-medium">{selected.category}</div></div>}
        </div>
      )}
      {/* Summary Dashboard Grid */}
      {hasData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <div className={`rounded-2xl border p-5 md:p-6 flex flex-col justify-center gap-2 col-span-2 sm:col-span-1 shadow-lg transition-colors ${summary.actualTucIdr != null ? 'bg-gradient-to-br from-amber-500/10 to-amber-900/20 border-amber-500/30 ring-1 ring-amber-500/20' : 'bg-slate-900/40 border-slate-800/80 ring-1 ring-white/5'}`}>
            <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Actual TUC
            </div>
            {summary.actualTucIdr != null ? (
              <>
                <div className="text-2xl md:text-3xl font-extrabold text-amber-400 leading-none break-all tracking-tight my-1">{fmtIdr(summary.actualTucIdr)}</div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2 text-slate-300 font-medium">
                    <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">{summary.paidPoCount} Paid PO{summary.paidPoCount !== 1 ? 's' : ''}</span>
                    <span className="text-slate-500">Last: {summary.lastPaidPoDate}</span>
                  </div>
                  <div className="flex gap-3 text-[11px] text-slate-500">
                    <span>
                      Last PO TUC: <span className={`font-semibold tabular-nums ${summary.lastPoTucIdr === summary.actualTucIdr ? 'text-amber-400' : 'text-slate-400'}`}>
                        {summary.lastPoTucIdr != null ? fmtIdr(summary.lastPoTucIdr) : '—'}
                        {summary.lastPoTucIdr === summary.actualTucIdr && <span className="ml-0.5 text-amber-600">↑</span>}
                      </span>
                    </span>
                    <span>
                      Avg ({summary.paidPoCount}): <span className={`font-semibold tabular-nums ${summary.avgTrueUnitCostIdr === summary.actualTucIdr && summary.avgTrueUnitCostIdr !== summary.lastPoTucIdr ? 'text-amber-400' : 'text-slate-400'}`}>
                        {summary.avgTrueUnitCostIdr != null ? fmtIdr(summary.avgTrueUnitCostIdr) : '—'}
                        {summary.avgTrueUnitCostIdr === summary.actualTucIdr && summary.avgTrueUnitCostIdr !== summary.lastPoTucIdr && <span className="ml-0.5 text-amber-600">↑</span>}
                      </span>
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <><div className="text-2xl font-bold text-slate-600 my-1">—</div><div className="text-xs text-slate-500 font-medium">No fully paid POs yet</div></>
            )}
          </div>
          <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-5 md:p-6 flex flex-col gap-2 ring-1 ring-white/5 shadow-lg">
            <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest">Avg. PO Cost</div>
            {Object.keys(summary.poByCurrency).length > 0 ? (
              <div className="space-y-1 my-1">
                {Object.entries(summary.poByCurrency).map(([cur, { totalValue, totalQty }]) => (
                  <div key={cur} className="text-xl md:text-2xl font-bold text-white tracking-tight">{cur} {fmtNum(totalQty > 0 ? totalValue / totalQty : 0)}</div>
                ))}
              </div>
            ) : <div className="text-2xl font-bold text-slate-600 my-1">—</div>}
            <div className="text-xs text-slate-500 font-medium">{myPoItems.length} lines <span className="text-slate-600 mx-1">•</span> excl. overhead</div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-5 md:p-6 flex flex-col gap-2 ring-1 ring-white/5 shadow-lg border-t-2 border-t-emerald-500/50">
            <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest">Avg. Quote Price</div>
            {Object.keys(summary.quoteByCurrency).length > 0 ? (
              <div className="space-y-1 my-1">
                {Object.entries(summary.quoteByCurrency).map(([cur, { totalValue, totalQty }]) => (
                  <div key={cur} className="text-xl md:text-2xl font-bold text-emerald-400 tracking-tight">{cur} {fmtNum(totalQty > 0 ? totalValue / totalQty : 0)}</div>
                ))}
              </div>
            ) : <div className="text-2xl font-bold text-slate-600 my-1">—</div>}
            <div className="text-xs text-slate-500 font-medium">{myQuoteItems.length} quotes</div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-5 md:p-6 flex flex-col gap-2 ring-1 ring-white/5 shadow-lg">
            <div className="text-[11px] text-slate-400 uppercase font-bold tracking-widest">Volume</div>
            <div className="space-y-2 my-1">
              {summary.totalOrderedQty > 0 && (
                <div className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-slate-400 font-medium">Ordered</span>
                  <span className="text-lg font-bold text-white">{summary.totalOrderedQty.toLocaleString()}</span>
                </div>
              )}
              {summary.totalQuotedQty > 0 && (
                <div className="flex items-center justify-between bg-slate-800/30 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-slate-500 font-medium">Quoted</span>
                  <span className="text-base font-semibold text-slate-300">{summary.totalQuotedQty.toLocaleString()}</span>
                </div>
              )}
            </div>
            {summary.totalOrderedQty === 0 && summary.totalQuotedQty === 0 && <div className="text-2xl font-bold text-slate-600 my-1">—</div>}
          </div>
        </div>
      )}
      {/* A: Quote Line Items */}
      {myQuoteItems.length > 0 && (
        <div className="pt-4 border-t border-slate-800/60">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm">A</div>
            <div>
              <h3 className="text-base font-bold text-slate-200 flex items-center gap-2 tracking-tight">
                Quote Line Items
                <span className="bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full ring-1 ring-slate-700">{myQuoteItems.length}</span>
              </h3>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-4">
            {myQuoteItems.map((qi) => {
              const quote = getQuote(qi.quote_id);
              return (
                <div key={qi.quote_line_id} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 ring-1 ring-white/5 shadow-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sky-400 font-mono text-xs font-bold bg-sky-500/10 px-2 py-0.5 rounded inline-block mb-1">{quote?.pi_number || `Quote #${qi.quote_id}`}</div>
                      <div className="text-slate-300 text-sm font-semibold">{getSupplier(quote?.supplier_id)}</div>
                    </div>
                    <StatusBadge status={quote?.status} />
                  </div>
                  <div className="text-slate-400 text-xs mb-4 line-clamp-2 bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/50">{qi.supplier_description || 'No supplier description'}</div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div><div className="text-slate-500 mb-0.5 font-medium">Date</div><div className="text-slate-200 font-medium">{quote?.quote_date || '—'}</div></div>
                    <div><div className="text-slate-500 mb-0.5 font-medium">Qty</div><div className="text-white font-bold text-sm">{qi.quantity.toLocaleString()}</div></div>
                    <div><div className="text-slate-500 mb-0.5 font-medium">Unit Price</div><div className="text-white font-semibold">{qi.currency} {fmtNum(qi.unit_price)}</div></div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex justify-between items-center bg-emerald-500/5 -mx-5 -mb-5 px-5 py-3 rounded-b-2xl">
                    <span className="text-xs text-slate-400 font-medium">Line Total</span>
                    <span className="text-emerald-400 font-bold text-base">{qi.currency} {fmtNum(qi.quantity * qi.unit_price)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-800/80 ring-1 ring-white/5 shadow-xl bg-slate-900/30">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-slate-400 text-[11px] uppercase tracking-widest font-semibold border-b border-slate-800">
                <tr>
                  <th className="px-5 py-4 text-left">Quote / PI Ref</th><th className="px-5 py-4 text-left">Date</th>
                  <th className="px-5 py-4 text-left">Supplier</th><th className="px-5 py-4 text-left">Supplier Desc</th>
                  <th className="px-5 py-4 text-right">Qty</th><th className="px-5 py-4 text-right">Unit Price</th>
                  <th className="px-5 py-4 text-right text-emerald-400">Total</th><th className="px-5 py-4 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {myQuoteItems.map((qi) => {
                  const quote = getQuote(qi.quote_id);
                  return (
                    <tr key={qi.quote_line_id} className="hover:bg-slate-800/40 transition-colors group">
                      <td className="px-5 py-3.5"><span className="text-sky-400 font-mono text-xs font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">{quote?.pi_number || `Quote #${qi.quote_id}`}</span></td>
                      <td className="px-5 py-3.5 text-slate-300 text-xs font-medium">{quote?.quote_date || '—'}</td>
                      <td className="px-5 py-3.5 text-slate-200 font-medium">{getSupplier(quote?.supplier_id)}</td>
                      <td className="px-5 py-3.5 text-slate-400 text-xs max-w-[200px] truncate">{qi.supplier_description || '—'}</td>
                      <td className="px-5 py-3.5 text-right text-white font-bold">{qi.quantity.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-slate-200 font-medium">{qi.currency} {fmtNum(qi.unit_price)}</td>
                      <td className="px-5 py-3.5 text-right text-emerald-400 font-bold bg-emerald-500/5 group-hover:bg-emerald-500/10 transition-colors">{qi.currency} {fmtNum(qi.quantity * qi.unit_price)}</td>
                      <td className="px-5 py-3.5"><StatusBadge status={quote?.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* B: PO Line Items + True Cost */}
      {allocations.length > 0 && (
        <div className="pt-4 border-t border-slate-800/60">
          <div className="flex items-start md:items-center justify-between gap-4 mb-4 flex-col md:flex-row">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm">B</div>
              <div>
                <h3 className="text-base font-bold text-slate-200 flex items-center gap-2 tracking-tight">
                  Purchase Order Lines · True Cost
                  <span className="bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full ring-1 ring-slate-700">{allocations.length}</span>
                </h3>
              </div>
            </div>
            <p className="text-slate-500 text-xs font-medium bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-800/80">
              Overhead split by line share. <span className="text-amber-500/80">True cost requires balance payment.</span>
            </p>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-4">
            {allocations.map((a) => (
              <div key={a.item.po_item_id} className={`rounded-2xl border p-5 transition-opacity ring-1 ring-white/5 shadow-lg ${a.hasBalancePayment ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-900/30 border-slate-800/50 opacity-80'}`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sky-400 font-mono text-sm font-bold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">{a.po.po_number}</span>
                      {a.po.pi_number && <span className="text-violet-400 font-mono text-[10px] font-bold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">PI: {a.po.pi_number}</span>}
                    </div>
                    <div className="text-slate-400 text-xs font-medium">{a.po.po_date}</div>
                  </div>
                  {a.hasBalancePayment ? <StatusBadge status={a.po.status} /> : <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 uppercase tracking-wider">Balance Unpaid</span>}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-slate-950/40 rounded-xl border border-slate-800/50 text-xs">
                  <div><div className="text-slate-500 mb-0.5">Qty</div><div className="text-white font-bold text-sm">{a.item.quantity.toLocaleString()}</div></div>
                  <div><div className="text-slate-500 mb-0.5">Unit Cost</div><div className="text-white font-medium">{a.item.currency} {fmtNum(a.item.unit_cost)}</div></div>
                  <div><div className="text-slate-500 mb-0.5">Line Share</div><div className="text-slate-300 font-medium">{(a.lineShare * 100).toFixed(1)}%</div></div>
                </div>
                {a.hasBalancePayment && a.trueUnitCostIdr > 0 && (
                  <div className="bg-gradient-to-br from-amber-500/10 to-amber-900/10 rounded-xl p-4 border border-amber-500/20 shadow-inner">
                    <div className="flex items-end justify-between mb-3 border-b border-amber-500/10 pb-3">
                      <div><div className="text-[10px] uppercase tracking-widest text-amber-500/80 font-bold mb-1">True Unit Cost (IDR)</div><div className="text-2xl font-extrabold text-amber-400 leading-none">{fmtIdr(a.trueUnitCostIdr)}</div></div>
                      <div className="text-right"><div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Total Line</div><div className="text-sm font-bold text-amber-200/80">{fmtIdr(a.totalAllocated)}</div></div>
                    </div>
                    <div className="text-[11px] font-medium text-amber-200/60 flex flex-wrap gap-x-4 gap-y-1">
                      {a.allocPrincipal > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span> Principal: {fmtIdr(a.allocPrincipal)}</span>}
                      {a.allocBankFees > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span> Fees: {fmtIdr(a.allocBankFees)}</span>}
                      {a.allocLanded > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span> Landed: {fmtIdr(a.allocLanded)}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800/80 ring-1 ring-white/5 shadow-xl bg-slate-900/30 scrollbar-thin scrollbar-thumb-slate-700 pb-2">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-slate-900/80 text-slate-400 text-[11px] uppercase tracking-widest font-semibold border-b border-slate-800">
                <tr>
                  <th className="px-5 py-4 text-left">PO #</th><th className="px-4 py-4 text-left">PI #</th>
                  <th className="px-4 py-4 text-left">PO Date</th><th className="px-4 py-4 text-right">Qty</th>
                  <th className="px-4 py-4 text-right">Unit Cost</th><th className="px-4 py-4 text-right">IDR Rate</th>
                  <th className="px-4 py-4 text-right">Line Share</th><th className="px-4 py-4 text-right text-slate-500">Alloc. Principal</th>
                  <th className="px-4 py-4 text-right text-slate-500">Alloc. Bank Fees</th><th className="px-4 py-4 text-right text-slate-500">Alloc. Landed</th>
                  <th className="px-5 py-4 text-right text-amber-400 bg-amber-500/5">True Unit Cost</th>
                  <th className="px-4 py-4 text-right text-amber-200/60 bg-amber-500/5">Total Line (IDR)</th>
                  <th className="px-5 py-4 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {allocations.map((a) => (
                  <tr key={a.item.po_item_id} className={`hover:bg-slate-800/40 transition-colors group ${a.hasBalancePayment ? 'bg-transparent' : 'bg-slate-900/40 opacity-75'}`}>
                    <td className="px-5 py-4"><span className="text-sky-400 font-mono text-xs font-semibold bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">{a.po.po_number}</span></td>
                    <td className="px-4 py-4"><span className="text-violet-400 font-mono text-[10px] font-semibold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">{a.po.pi_number || '—'}</span></td>
                    <td className="px-4 py-4 text-slate-300 text-xs font-medium">{a.po.po_date}</td>
                    <td className="px-4 py-4 text-right text-white font-bold">{a.item.quantity.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right text-slate-200 font-medium">{a.item.currency} {fmtNum(a.item.unit_cost)}</td>
                    <td className="px-4 py-4 text-right text-slate-400 text-xs font-medium">{a.po.exchange_rate ? a.po.exchange_rate.toLocaleString() : '—'}</td>
                    <td className="px-4 py-4 text-right text-slate-300 text-xs font-medium bg-slate-900/30">{(a.lineShare * 100).toFixed(1)}%</td>
                    {a.hasBalancePayment ? (
                      <>
                        <td className="px-4 py-4 text-right text-slate-400 text-xs">{a.principal > 0 ? fmtIdr(a.allocPrincipal) : '—'}</td>
                        <td className="px-4 py-4 text-right text-slate-400 text-xs">{a.bankFees > 0 ? fmtIdr(a.allocBankFees) : '—'}</td>
                        <td className="px-4 py-4 text-right text-slate-400 text-xs">{a.landed > 0 ? fmtIdr(a.allocLanded) : '—'}</td>
                        <td className="px-5 py-4 text-right text-amber-400 font-extrabold bg-amber-500/5 group-hover:bg-amber-500/10 transition-colors text-[13px]">{a.trueUnitCostIdr > 0 ? fmtIdr(a.trueUnitCostIdr) : '—'}</td>
                        <td className="px-4 py-4 text-right text-amber-200/80 font-bold bg-amber-500/5 group-hover:bg-amber-500/10 transition-colors text-xs">{a.totalAllocated > 0 ? fmtIdr(a.totalAllocated) : '—'}</td>
                        <td className="px-5 py-4"><StatusBadge status={a.po.status} /></td>
                      </>
                    ) : (
                      <>
                        <td colSpan={5} className="px-4 py-4 text-center text-slate-600 text-xs font-medium italic bg-slate-950/20">— Pending Balance Payment —</td>
                        <td className="px-5 py-4"><span className="text-[10px] font-bold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 uppercase tracking-wider">Balance Unpaid</span></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* C: PO Costs Reference */}
      {poCostGroups.length > 0 && (
        <div className="pt-4 border-t border-slate-800/60 pb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 font-bold text-sm">C</div>
            <div>
              <h3 className="text-base font-bold text-slate-200 flex items-center gap-2 tracking-tight">
                PO Costs Reference
                <span className="bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full ring-1 ring-slate-700">{poCostGroups.reduce((s, g) => s + g.costs.length, 0)}</span>
              </h3>
            </div>
          </div>
          <p className="text-slate-500 text-xs font-medium mb-4">Grouped by PO. Tax rows (PPN / PPh) are greyed out — excluded from true cost.</p>

          {/* Aggregate cost breakdown across all POs */}
          {(() => {
            const aggPrincipal = poCostGroups.reduce((s, g) => s + g.principalIdr, 0);
            const aggBankFees  = poCostGroups.reduce((s, g) => s + g.bankFeesIdr, 0);
            const aggLanded    = poCostGroups.reduce((s, g) => s + g.landedIdr, 0);
            const aggTotal     = poCostGroups.reduce((s, g) => s + g.totalExclTaxIdr, 0);
            if (aggTotal === 0 || (aggBankFees === 0 && aggLanded === 0)) return null;
            const bfPct  = (aggBankFees  / aggTotal) * 100;
            const ldPct  = (aggLanded    / aggTotal) * 100;
            const prPct  = (aggPrincipal / aggTotal) * 100;
            return (
              <div className="mb-6 bg-slate-900/60 border border-slate-700/60 rounded-xl p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
                  Aggregate cost breakdown across {poCostGroups.length} PO{poCostGroups.length !== 1 ? 's' : ''} (excl. VAT &amp; import tax)
                </p>
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm bg-sky-500/70 flex-shrink-0" />
                    <span className="text-[11px] text-slate-400">Principal</span>
                    <span className="text-xs font-bold text-white tabular-nums">{prPct.toFixed(1)}%</span>
                    <span className="text-[10px] text-slate-600 tabular-nums">{fmtIdr(aggPrincipal)}</span>
                  </div>
                  {aggBankFees > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm bg-purple-500/70 flex-shrink-0" />
                      <span className="text-[11px] text-slate-400">Bank Fees</span>
                      <span className="text-xs font-bold text-purple-300 tabular-nums">{bfPct.toFixed(2)}%</span>
                      <span className="text-[10px] text-slate-600 tabular-nums">{fmtIdr(aggBankFees)}</span>
                    </div>
                  )}
                  {aggLanded > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm bg-orange-500/70 flex-shrink-0" />
                      <span className="text-[11px] text-slate-400">Landed Costs</span>
                      <span className="text-xs font-bold text-orange-300 tabular-nums">{ldPct.toFixed(2)}%</span>
                      <span className="text-[10px] text-slate-600 tabular-nums">{fmtIdr(aggLanded)}</span>
                    </div>
                  )}
                  {/* Stacked bar */}
                  <div className="flex-1 min-w-[120px] h-2 bg-slate-800 rounded-full overflow-hidden flex ml-2">
                    <div className="h-full bg-sky-500/60"    style={{ width: `${prPct}%` }} />
                    <div className="h-full bg-purple-500/70" style={{ width: `${bfPct}%` }} />
                    <div className="h-full bg-orange-500/70" style={{ width: `${ldPct}%` }} />
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="space-y-6">
            {poCostGroups.map((group) => {
              const poStatusCls = group.po.status === 'Fully Received' ? 'text-emerald-400' : group.po.status === 'Partially Received' ? 'text-amber-400' : group.po.status === 'Cancelled' ? 'text-red-400' : 'text-slate-400';
              return (
                <div key={group.po.po_id} className="rounded-2xl border border-slate-800/80 overflow-hidden shadow-xl ring-1 ring-white/5 bg-slate-900/30">
                  <div className="bg-slate-800/60 px-5 py-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-700/80 backdrop-blur-sm">
                    <span className="text-sky-400 font-mono text-sm font-bold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">{group.po.po_number}</span>
                    {group.po.pi_number && <span className="text-violet-400 font-mono text-xs font-bold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">PI: {group.po.pi_number}</span>}
                    <span className="text-slate-300 text-xs font-medium bg-slate-900/50 px-2 py-1 rounded">{group.po.po_date}</span>
                    <span className={`text-xs font-bold ${poStatusCls}`}>{group.po.status}</span>
                    <span className={`ml-auto text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full border ${group.hasBalancePayment ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}`}>
                      {group.hasBalancePayment ? 'Balance Paid' : 'Balance Unpaid'}
                    </span>
                  </div>
                  <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
                    <table className="w-full text-sm min-w-[500px]">
                      <thead className="bg-slate-900/80 text-slate-400 text-[10px] uppercase tracking-widest font-semibold border-b border-slate-800">
                        <tr>
                          <th className="px-5 py-3 text-left">Date</th><th className="px-5 py-3 text-left">Category</th>
                          <th className="px-5 py-3 text-left hidden sm:table-cell">Type</th>
                          <th className="px-5 py-3 text-right">Amount</th>
                          <th className="px-5 py-3 text-left hidden md:table-cell">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {group.costs.map((c) => {
                          const isTax = TAX_CATS.has(c.cost_category);
                          const isPayment = PRINCIPAL_CATS.has(c.cost_category);
                          const isBankFee = BANK_FEE_CATS.has(c.cost_category);
                          const typeLabel = isPayment ? 'Payment' : isBankFee ? 'Bank Fee' : isTax ? 'Tax (PPN)' : 'Landed Cost';
                          const typeCls = isPayment ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : isBankFee ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : isTax ? 'bg-slate-800 text-slate-500 border-slate-700' : 'bg-orange-500/10 text-orange-400 border-orange-500/20';
                          return (
                            <tr key={c.cost_id} className={`hover:bg-slate-800/40 transition-colors ${isTax ? 'opacity-50 bg-slate-950/50' : ''}`}>
                              <td className="px-5 py-3.5 text-slate-400 text-xs font-medium whitespace-nowrap">{c.payment_date || '—'}</td>
                              <td className="px-5 py-3.5 text-slate-200 text-xs font-medium">{COST_LABELS[c.cost_category] || c.cost_category}</td>
                              <td className="px-5 py-3.5 hidden sm:table-cell"><span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeCls}`}>{typeLabel}</span></td>
                              <td className={`px-5 py-3.5 text-right font-bold text-[13px] whitespace-nowrap ${isTax ? 'text-slate-500' : 'text-rose-400'}`}>{c.currency} {fmtNum(c.amount)}</td>
                              <td className="px-5 py-3.5 text-slate-400 text-xs max-w-[200px] truncate hidden md:table-cell">{c.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {Object.keys(group.subtotalByCurrency).length > 0 && (
                        <tfoot>
                          <tr className="bg-slate-900/80 border-t border-slate-700/80">
                            <td colSpan={2} className="px-5 py-4 text-[11px] uppercase tracking-widest text-slate-400 font-bold">Subtotal <span className="text-slate-500 normal-case tracking-normal text-xs ml-1">(excl. PPN)</span></td>
                            <td className="px-5 py-4 hidden sm:table-cell" />
                            <td className="px-5 py-4 text-right font-bold text-rose-300 text-[13px] whitespace-nowrap">
                              {Object.entries(group.subtotalByCurrency).map(([cur, amt]) => `${cur} ${fmtNum(amt)}`).join(' · ')}
                            </td>
                            <td className="hidden md:table-cell" />
                          </tr>
                          {group.totalExclTaxIdr > 0 && (group.bankFeesIdr > 0 || group.landedIdr > 0) && (
                            <tr className="bg-slate-950/60 border-t border-slate-800/60">
                              <td colSpan={5} className="px-5 py-3">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Cost mix</span>
                                  {group.bankFeesIdr > 0 && (
                                    <span className="flex items-center gap-1.5 text-[11px]">
                                      <span className="w-2 h-2 rounded-sm bg-purple-500/70 flex-shrink-0" />
                                      <span className="text-slate-500">Bank Fees</span>
                                      <span className="font-bold text-purple-300 tabular-nums">
                                        {((group.bankFeesIdr / group.totalExclTaxIdr) * 100).toFixed(2)}%
                                      </span>
                                      <span className="text-slate-600 tabular-nums text-[10px]">{fmtIdr(group.bankFeesIdr)}</span>
                                    </span>
                                  )}
                                  {group.landedIdr > 0 && (
                                    <span className="flex items-center gap-1.5 text-[11px]">
                                      <span className="w-2 h-2 rounded-sm bg-orange-500/70 flex-shrink-0" />
                                      <span className="text-slate-500">Landed</span>
                                      <span className="font-bold text-orange-300 tabular-nums">
                                        {((group.landedIdr / group.totalExclTaxIdr) * 100).toFixed(2)}%
                                      </span>
                                      <span className="text-slate-600 tabular-nums text-[10px]">{fmtIdr(group.landedIdr)}</span>
                                    </span>
                                  )}
                                  {/* Mini stacked bar */}
                                  <div className="flex h-1.5 w-24 bg-slate-800 rounded-full overflow-hidden ml-1">
                                    <div className="h-full bg-sky-500/50" style={{ width: `${(group.principalIdr / group.totalExclTaxIdr) * 100}%` }} />
                                    <div className="h-full bg-purple-500/70" style={{ width: `${(group.bankFeesIdr / group.totalExclTaxIdr) * 100}%` }} />
                                    <div className="h-full bg-orange-500/70" style={{ width: `${(group.landedIdr / group.totalExclTaxIdr) * 100}%` }} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
