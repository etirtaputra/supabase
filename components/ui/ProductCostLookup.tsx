/**
 * ProductCostLookup
 * Search for a component and see its full cost history:
 *   Summary dashboard
 *   A) Quote line items (sorted by date desc)
 *   B) PO line items + proportional true-cost allocation (sorted by PO date desc)
 *   C) PO costs reference, visually grouped by PO
 *
 * Cost allocation methodology:
 *   line_share = (unit_cost × qty) / total_po_value_foreign
 *   allocated_cost = line_share × cost_total_idr
 *   true_unit_cost = (alloc_principal + alloc_bank_fees + alloc_landed) / qty
 *
 * Rules:
 *   - True unit cost is only shown for POs that have a balance_payment recorded.
 *   - PPN (local_vat, local_income_tax) is excluded from the true cost calc.
 *   - All amounts are entered ex-tax (ex-PPN).
 */

'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type {
  Component,
  PriceQuote,
  PriceQuoteLineItem,
  PurchaseOrder,
  PurchaseLineItem,
  POCost,
  Supplier,
} from '@/types/database';

// ─── Cost categorisation ──────────────────────────────────────────────────────

const PRINCIPAL_CATS = new Set([
  'down_payment',
  'balance_payment',
  'additional_balance_payment',
  'overpayment_credit',
]);

const BANK_FEE_CATS = new Set([
  'full_amount_bank_fee',
  'telex_bank_fee',
  'value_today_bank_fee',
  'admin_bank_fee',
  'inter_bank_transfer_fee',
]);

// Excluded from true cost (PPN / tax)
const TAX_CATS = new Set(['local_vat', 'local_income_tax']);

// PO is considered "balance paid" if either of these exists
const BALANCE_CATS = new Set(['balance_payment', 'additional_balance_payment']);

const COST_LABELS: Record<string, string> = {
  down_payment: 'Down Payment',
  balance_payment: 'Balance Payment',
  additional_balance_payment: 'Additional Balance',
  overpayment_credit: 'Overpayment Credit',
  full_amount_bank_fee: 'Bank Fee (Full Amount)',
  telex_bank_fee: 'Bank Fee (Telex)',
  value_today_bank_fee: 'Bank Fee (Value Today)',
  admin_bank_fee: 'Bank Fee (Admin)',
  inter_bank_transfer_fee: 'Inter-bank Transfer Fee',
  local_import_duty: 'Import Duty',
  local_vat: 'Local VAT / PPN',
  local_income_tax: 'Income Tax (PPh)',
  local_delivery: 'Local Delivery',
  demurrage_fee: 'Demurrage',
  penalty_fee: 'Penalty',
  dhl_advance_payment_fee: 'DHL Advance Fee',
  local_import_tax: 'Import Tax',
};

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtIdr = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');
const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  components: Component[];
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  suppliers: Supplier[];
  isLoading: boolean;
}

interface Allocation {
  item: PurchaseLineItem;
  po: PurchaseOrder;
  lineValueForeign: number;
  totalPoValueForeign: number;
  lineShare: number;
  principal: number;
  bankFees: number;
  landed: number;
  allocPrincipal: number;
  allocBankFees: number;
  allocLanded: number;
  totalAllocated: number;
  trueUnitCostIdr: number;
  hasBalancePayment: boolean;
}

interface POCostGroup {
  po: PurchaseOrder;
  costs: POCost[];
  hasBalancePayment: boolean;
  subtotalByCurrency: Record<string, number>; // excl. tax
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductCostLookup({
  components,
  quotes,
  quoteItems,
  pos,
  poItems,
  poCosts,
  suppliers,
  isLoading,
}: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Component | null>(null);
  const [showDrop, setShowDrop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Autocomplete ──────────────────────────────────────────────────────────

  const candidates = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return components
      .filter(
        (c) =>
          c.internal_description?.toLowerCase().includes(q) ||
          c.supplier_model?.toLowerCase().includes(q) ||
          c.brand?.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [query, components]);

  const selectComponent = (c: Component) => {
    setSelected(c);
    setQuery(c.internal_description || c.supplier_model);
    setShowDrop(false);
  };

  // ── Filtered data ─────────────────────────────────────────────────────────

  const myQuoteItems = useMemo(
    () =>
      selected
        ? [...quoteItems.filter((qi) => qi.component_id === selected.component_id)].sort((a, b) => {
            const qA = quotes.find((q) => q.quote_id === a.quote_id)?.quote_date || '';
            const qB = quotes.find((q) => q.quote_id === b.quote_id)?.quote_date || '';
            return qB.localeCompare(qA);
          })
        : [],
    [selected, quoteItems, quotes],
  );

  const myPoItems = useMemo(
    () => (selected ? poItems.filter((pi) => pi.component_id === selected.component_id) : []),
    [selected, poItems],
  );

  // ── Cost allocation per PO line, sorted by PO date desc ───────────────────

  const allocations = useMemo<Allocation[]>(() => {
    return myPoItems
      .map((item): Allocation | null => {
        const po = pos.find((p) => p.po_id === item.po_id);
        if (!po) return null;

        const allPoItems = poItems.filter((i) => i.po_id === item.po_id && i.quantity > 0);
        const totalPoValueForeign = allPoItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
        const lineValueForeign = item.unit_cost * item.quantity;
        const lineShare = totalPoValueForeign > 0 ? lineValueForeign / totalPoValueForeign : 0;

        const costs = poCosts.filter((c) => c.po_id === item.po_id);
        const hasBalancePayment = costs.some((c) => BALANCE_CATS.has(c.cost_category));

        const principal = costs
          .filter((c) => PRINCIPAL_CATS.has(c.cost_category))
          .reduce((s, c) => s + c.amount, 0);
        const bankFees = costs
          .filter((c) => BANK_FEE_CATS.has(c.cost_category))
          .reduce((s, c) => s + c.amount, 0);
        const landed = costs
          .filter(
            (c) =>
              !PRINCIPAL_CATS.has(c.cost_category) &&
              !BANK_FEE_CATS.has(c.cost_category) &&
              !TAX_CATS.has(c.cost_category),
          )
          .reduce((s, c) => s + c.amount, 0);

        const allocPrincipal = lineShare * principal;
        const allocBankFees = lineShare * bankFees;
        const allocLanded = lineShare * landed;
        const totalAllocated = allocPrincipal + allocBankFees + allocLanded;
        const trueUnitCostIdr = item.quantity > 0 ? totalAllocated / item.quantity : 0;

        return {
          item,
          po,
          lineValueForeign,
          totalPoValueForeign,
          lineShare,
          principal,
          bankFees,
          landed,
          allocPrincipal,
          allocBankFees,
          allocLanded,
          totalAllocated,
          trueUnitCostIdr,
          hasBalancePayment,
        };
      })
      .filter((a): a is Allocation => a !== null)
      .sort((a, b) => b.po.po_date.localeCompare(a.po.po_date));
  }, [myPoItems, poItems, pos, poCosts]);

  // ── Summary stats ─────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    // True unit cost: weighted avg from paid POs only
    const paidAllocs = allocations.filter((a) => a.hasBalancePayment && a.trueUnitCostIdr > 0);
    const paidTotalWeighted = paidAllocs.reduce(
      (s, a) => s + a.trueUnitCostIdr * a.item.quantity,
      0,
    );
    const paidTotalQty = paidAllocs.reduce((s, a) => s + a.item.quantity, 0);
    const avgTrueUnitCostIdr = paidTotalQty > 0 ? paidTotalWeighted / paidTotalQty : null;
    const lastPaidPoDate =
      paidAllocs.length > 0
        ? paidAllocs.map((a) => a.po.po_date).sort((a, b) => b.localeCompare(a))[0]
        : null;

    // Avg PO unit cost per currency (weighted, all PO lines)
    const poByCurrency: Record<string, { totalValue: number; totalQty: number }> = {};
    myPoItems.forEach((pi) => {
      if (!poByCurrency[pi.currency])
        poByCurrency[pi.currency] = { totalValue: 0, totalQty: 0 };
      poByCurrency[pi.currency].totalValue += pi.unit_cost * pi.quantity;
      poByCurrency[pi.currency].totalQty += pi.quantity;
    });

    // Avg quote unit price per currency (weighted)
    const quoteByCurrency: Record<string, { totalValue: number; totalQty: number }> = {};
    myQuoteItems.forEach((qi) => {
      if (!quoteByCurrency[qi.currency])
        quoteByCurrency[qi.currency] = { totalValue: 0, totalQty: 0 };
      quoteByCurrency[qi.currency].totalValue += qi.unit_price * qi.quantity;
      quoteByCurrency[qi.currency].totalQty += qi.quantity;
    });

    const totalOrderedQty = myPoItems.reduce((s, i) => s + i.quantity, 0);
    const totalQuotedQty = myQuoteItems.reduce((s, i) => s + i.quantity, 0);

    return {
      avgTrueUnitCostIdr,
      paidPoCount: paidAllocs.length,
      lastPaidPoDate,
      poByCurrency,
      quoteByCurrency,
      totalOrderedQty,
      totalQuotedQty,
    };
  }, [allocations, myPoItems, myQuoteItems]);

  // ── PO costs grouped by PO for section C ─────────────────────────────────

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
      const costs = poCosts
        .filter((c) => c.po_id === poId)
        .sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
      const hasBalancePayment = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const subtotalByCurrency: Record<string, number> = {};
      costs
        .filter((c) => !TAX_CATS.has(c.cost_category))
        .forEach((c) => {
          subtotalByCurrency[c.currency] = (subtotalByCurrency[c.currency] || 0) + c.amount;
        });
      return [{ po, costs, hasBalancePayment, subtotalByCurrency }];
    });
  }, [relatedPoIds, pos, poCosts]);

  // ── Lookup helpers ────────────────────────────────────────────────────────

  const getQuote = (id: number) => quotes.find((q) => q.quote_id === id);
  const getSupplier = (id?: number) =>
    suppliers.find((s) => s.supplier_id === id)?.supplier_name || '—';

  const hasData = selected && (myQuoteItems.length > 0 || myPoItems.length > 0);

  const statusBadge = (status?: string) => {
    const cls =
      status === 'Accepted' || status === 'Fully Received'
        ? 'bg-emerald-900/50 text-emerald-300'
        : status === 'Rejected' || status === 'Expired' || status === 'Cancelled'
          ? 'bg-red-900/50 text-red-300'
          : status === 'Partially Received'
            ? 'bg-amber-900/50 text-amber-300'
            : 'bg-slate-700 text-slate-300';
    return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{status || '—'}</span>;
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── Search ── */}
      <div ref={containerRef} className="relative max-w-xl">
        <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
          Product Description / SKU
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDrop(true);
            if (!e.target.value) setSelected(null);
          }}
          onFocus={() => query && setShowDrop(true)}
          placeholder="Type to search e.g. 'inverter', 'MPPT', 'solar panel'…"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          disabled={isLoading}
        />
        {showDrop && candidates.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-auto max-h-72">
            {candidates.map((c) => (
              <li
                key={c.component_id}
                onMouseDown={() => selectComponent(c)}
                className="px-4 py-2.5 hover:bg-slate-700 cursor-pointer border-b border-slate-700/50 last:border-0"
              >
                <div className="text-white text-sm font-medium">{c.internal_description}</div>
                <div className="text-slate-400 text-xs mt-0.5">
                  {c.supplier_model}
                  {c.brand ? ` · ${c.brand}` : ''}
                  {c.category ? ` · ${c.category}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Empty state ── */}
      {selected && !hasData && (
        <p className="text-slate-500 text-sm italic">
          No quote or PO records found for this component.
        </p>
      )}

      {/* ── Component info card ── */}
      {selected && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-5 py-4 flex flex-wrap gap-6">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Description</div>
            <div className="text-white font-semibold">{selected.internal_description}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">SKU</div>
            <div className="text-sky-300 font-mono text-sm">{selected.supplier_model}</div>
          </div>
          {selected.brand && (
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Brand</div>
              <div className="text-slate-200">{selected.brand}</div>
            </div>
          )}
          {selected.category && (
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Category</div>
              <div className="text-slate-200">{selected.category}</div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SUMMARY DASHBOARD
      ══════════════════════════════════════════════════════════════════════ */}
      {hasData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Avg. True Unit Cost */}
          <div
            className={`rounded-xl border px-5 py-4 flex flex-col gap-1 ${
              summary.avgTrueUnitCostIdr != null
                ? 'bg-amber-950/40 border-amber-700/50'
                : 'bg-slate-800/60 border-slate-700'
            }`}
          >
            <div className="text-xs text-slate-400 uppercase tracking-wider">
              Avg. True Unit Cost
            </div>
            {summary.avgTrueUnitCostIdr != null ? (
              <>
                <div className="text-xl font-bold text-amber-300 leading-tight">
                  {fmtIdr(summary.avgTrueUnitCostIdr)}
                </div>
                <div className="text-xs text-slate-400">
                  {summary.paidPoCount} paid PO{summary.paidPoCount !== 1 ? 's' : ''}
                </div>
                <div className="text-xs text-slate-500">Last: {summary.lastPaidPoDate}</div>
              </>
            ) : (
              <>
                <div className="text-xl font-bold text-slate-600">—</div>
                <div className="text-xs text-slate-500">No fully paid POs yet</div>
              </>
            )}
          </div>

          {/* Card 2: Avg. PO Unit Cost (raw, per currency) */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 flex flex-col gap-1">
            <div className="text-xs text-slate-400 uppercase tracking-wider">
              Avg. PO Unit Cost
            </div>
            {Object.keys(summary.poByCurrency).length > 0 ? (
              <>
                {Object.entries(summary.poByCurrency).map(([cur, { totalValue, totalQty }]) => (
                  <div key={cur} className="text-xl font-bold text-white leading-tight">
                    {cur} {fmtNum(totalQty > 0 ? totalValue / totalQty : 0)}
                  </div>
                ))}
                <div className="text-xs text-slate-400">
                  {myPoItems.length} PO line{myPoItems.length !== 1 ? 's' : ''} · excl. overhead
                </div>
              </>
            ) : (
              <div className="text-xl font-bold text-slate-600">—</div>
            )}
          </div>

          {/* Card 3: Avg. Quote Price (per currency) */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 flex flex-col gap-1">
            <div className="text-xs text-slate-400 uppercase tracking-wider">Avg. Quote Price</div>
            {Object.keys(summary.quoteByCurrency).length > 0 ? (
              <>
                {Object.entries(summary.quoteByCurrency).map(([cur, { totalValue, totalQty }]) => (
                  <div key={cur} className="text-xl font-bold text-emerald-300 leading-tight">
                    {cur} {fmtNum(totalQty > 0 ? totalValue / totalQty : 0)}
                  </div>
                ))}
                <div className="text-xs text-slate-400">
                  {myQuoteItems.length} quote line{myQuoteItems.length !== 1 ? 's' : ''}
                </div>
              </>
            ) : (
              <div className="text-xl font-bold text-slate-600">—</div>
            )}
          </div>

          {/* Card 4: Total Qty */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 flex flex-col gap-1">
            <div className="text-xs text-slate-400 uppercase tracking-wider">Total Qty</div>
            {summary.totalOrderedQty > 0 && (
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-white">
                  {summary.totalOrderedQty.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400">ordered</span>
              </div>
            )}
            {summary.totalQuotedQty > 0 && (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold text-slate-300">
                  {summary.totalQuotedQty.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400">quoted</span>
              </div>
            )}
            {summary.totalOrderedQty === 0 && summary.totalQuotedQty === 0 && (
              <div className="text-xl font-bold text-slate-600">—</div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          A: QUOTE LINE ITEMS
      ══════════════════════════════════════════════════════════════════════ */}
      {myQuoteItems.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
            A — Quote Line Items
            <span className="bg-emerald-900/50 text-emerald-300 text-xs px-2 py-0.5 rounded-full">
              {myQuoteItems.length}
            </span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/80 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Quote / PI Ref</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Supplier Desc</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {myQuoteItems.map((qi) => {
                  const quote = getQuote(qi.quote_id);
                  return (
                    <tr
                      key={qi.quote_line_id}
                      className="bg-slate-900/40 hover:bg-slate-800/60 transition-colors"
                    >
                      <td className="px-4 py-3 text-sky-300 font-mono text-xs">
                        {quote?.pi_number || `Quote #${qi.quote_id}`}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{quote?.quote_date || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{getSupplier(quote?.supplier_id)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[180px] truncate">
                        {qi.supplier_description || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-medium">
                        {qi.quantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-white">
                        {qi.currency} {fmtNum(qi.unit_price)}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-300 font-medium">
                        {qi.currency} {fmtNum(qi.quantity * qi.unit_price)}
                      </td>
                      <td className="px-4 py-3">{statusBadge(quote?.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          B: PO LINE ITEMS + TRUE COST ALLOCATION
      ══════════════════════════════════════════════════════════════════════ */}
      {allocations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-amber-400 mb-1 flex items-center gap-2">
            B — Purchase Order Line Items · True Cost Allocation
            <span className="bg-amber-900/50 text-amber-300 text-xs px-2 py-0.5 rounded-full">
              {allocations.length}
            </span>
          </h3>
          <p className="text-slate-500 text-xs mb-3">
            Sorted latest first. Bank fees &amp; landed costs (excl. PPN) apportioned by line
            share of PO total. True cost shown only for POs with balance payment recorded.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/80 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">PO #</th>
                  <th className="px-4 py-3 text-left">PI #</th>
                  <th className="px-4 py-3 text-left">PO Date</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                  <th className="px-4 py-3 text-right">IDR Rate</th>
                  <th className="px-4 py-3 text-right">Line Share</th>
                  <th className="px-4 py-3 text-right">Alloc. Principal</th>
                  <th className="px-4 py-3 text-right">Alloc. Bank Fees</th>
                  <th className="px-4 py-3 text-right">Alloc. Landed</th>
                  <th className="px-4 py-3 text-right text-amber-300">True Unit Cost</th>
                  <th className="px-4 py-3 text-right text-amber-200">Total Line (IDR)</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {allocations.map((a) => (
                  <tr
                    key={a.item.po_item_id}
                    className={`hover:bg-slate-800/60 transition-colors ${
                      a.hasBalancePayment ? 'bg-slate-900/40' : 'bg-slate-900/20 opacity-75'
                    }`}
                  >
                    <td className="px-4 py-3 text-sky-300 font-mono text-xs">{a.po.po_number}</td>
                    <td className="px-4 py-3 text-violet-300 font-mono text-xs">
                      {a.po.pi_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{a.po.po_date}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">
                      {a.item.quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {a.item.currency} {fmtNum(a.item.unit_cost)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs">
                      {a.po.exchange_rate ? a.po.exchange_rate.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300 text-xs">
                      {(a.lineShare * 100).toFixed(1)}%
                    </td>
                    {a.hasBalancePayment ? (
                      <>
                        <td className="px-4 py-3 text-right text-slate-300 text-xs">
                          {a.principal > 0 ? fmtIdr(a.allocPrincipal) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 text-xs">
                          {a.bankFees > 0 ? fmtIdr(a.allocBankFees) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 text-xs">
                          {a.landed > 0 ? fmtIdr(a.allocLanded) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-300 font-semibold">
                          {a.trueUnitCostIdr > 0 ? fmtIdr(a.trueUnitCostIdr) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-200 font-semibold">
                          {a.totalAllocated > 0 ? fmtIdr(a.totalAllocated) : '—'}
                        </td>
                        <td className="px-4 py-3">{statusBadge(a.po.status)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right text-slate-600 text-xs" colSpan={4}>
                          —
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 text-xs">—</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-400">
                            Balance Unpaid
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          C: PO COSTS REFERENCE — grouped by PO
      ══════════════════════════════════════════════════════════════════════ */}
      {poCostGroups.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-rose-400 mb-1 flex items-center gap-2">
            C — PO Costs Reference
            <span className="bg-rose-900/50 text-rose-300 text-xs px-2 py-0.5 rounded-full">
              {poCostGroups.reduce((s, g) => s + g.costs.length, 0)}
            </span>
          </h3>
          <p className="text-slate-500 text-xs mb-3">
            Grouped by PO. Tax rows (PPN / PPh) are greyed out — excluded from true cost.
          </p>

          <div className="space-y-4">
            {poCostGroups.map((group) => {
              const poStatusCls =
                group.po.status === 'Fully Received'
                  ? 'text-emerald-400'
                  : group.po.status === 'Partially Received'
                    ? 'text-amber-400'
                    : group.po.status === 'Cancelled'
                      ? 'text-red-400'
                      : 'text-slate-400';

              return (
                <div
                  key={group.po.po_id}
                  className="rounded-lg border border-slate-700 overflow-hidden"
                >
                  {/* Group header */}
                  <div className="bg-slate-800 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-700">
                    <span className="text-sky-300 font-mono text-xs font-semibold">
                      {group.po.po_number}
                    </span>
                    {group.po.pi_number && (
                      <span className="text-violet-300 font-mono text-xs">
                        PI: {group.po.pi_number}
                      </span>
                    )}
                    <span className="text-slate-400 text-xs">{group.po.po_date}</span>
                    <span className={`text-xs ${poStatusCls}`}>{group.po.status}</span>
                    {group.hasBalancePayment ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 ml-auto">
                        Balance Paid
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-400 ml-auto">
                        Balance Unpaid
                      </span>
                    )}
                  </div>

                  {/* Cost rows */}
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800/50 text-slate-500 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-2 text-left">Date</th>
                        <th className="px-4 py-2 text-left">Category</th>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                        <th className="px-4 py-2 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/40">
                      {group.costs.map((c) => {
                        const isTax = TAX_CATS.has(c.cost_category);
                        const isPayment = PRINCIPAL_CATS.has(c.cost_category);
                        const isBankFee = BANK_FEE_CATS.has(c.cost_category);
                        const typeLabel = isPayment
                          ? 'Payment'
                          : isBankFee
                            ? 'Bank Fee'
                            : isTax
                              ? 'Tax (PPN)'
                              : 'Landed Cost';
                        const typeCls = isPayment
                          ? 'bg-sky-900/50 text-sky-300'
                          : isBankFee
                            ? 'bg-purple-900/50 text-purple-300'
                            : isTax
                              ? 'bg-slate-700/50 text-slate-500'
                              : 'bg-orange-900/50 text-orange-300';
                        return (
                          <tr
                            key={c.cost_id}
                            className={`hover:bg-slate-800/60 transition-colors ${
                              isTax ? 'opacity-40 bg-slate-900/10' : 'bg-slate-900/30'
                            }`}
                          >
                            <td className="px-4 py-2.5 text-slate-400 text-xs">
                              {c.payment_date || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-200">
                              {COST_LABELS[c.cost_category] || c.cost_category}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${typeCls}`}>
                                {typeLabel}
                              </span>
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-medium ${
                                isTax ? 'text-slate-500' : 'text-rose-300'
                              }`}
                            >
                              {c.currency} {fmtNum(c.amount)}
                            </td>
                            <td className="px-4 py-2.5 text-slate-400 text-xs max-w-[200px] truncate">
                              {c.notes || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Subtotal row (excl. tax) */}
                    {Object.keys(group.subtotalByCurrency).length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-800/60 border-t border-slate-600">
                          <td
                            colSpan={3}
                            className="px-4 py-2 text-xs text-slate-400 font-medium"
                          >
                            Subtotal (excl. PPN)
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-rose-200 text-xs">
                            {Object.entries(group.subtotalByCurrency)
                              .map(([cur, amt]) => `${cur} ${fmtNum(amt)}`)
                              .join('  ·  ')}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
