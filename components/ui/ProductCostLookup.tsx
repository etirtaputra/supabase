/**
 * ProductCostLookup
 * Search for a component and see its full cost history:
 *   A) Quote line items
 *   B) PO line items with proportional true-cost allocation
 *   C) Raw PO costs reference table
 *
 * Cost allocation methodology (mirrors the SQL true-unit-cost query):
 *   line_share = (unit_cost × qty) / total_po_value_foreign
 *   allocated_cost = line_share × cost_total_idr
 *   true_unit_cost = (alloc_principal + alloc_bank_fees + alloc_landed) / qty
 *
 * PPN (local_vat, local_income_tax) is EXCLUDED from the true cost calc,
 * since all amounts in the system are entered ex-tax.
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

// These are excluded from the true cost calculation (PPN / tax)
const TAX_CATS = new Set(['local_vat', 'local_income_tax']);

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

// ─── Formatters ──────────────────────────────────────────────────────────────

const fmtIdr = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');
const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Props ────────────────────────────────────────────────────────────────────

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

// ─── Allocation result per PO line ────────────────────────────────────────────

interface Allocation {
  item: PurchaseLineItem;
  po: PurchaseOrder;
  lineValueForeign: number;
  totalPoValueForeign: number;
  lineShare: number;
  // PO-level cost totals (assumed IDR)
  principal: number;
  bankFees: number;
  landed: number;
  // This line's allocated share
  allocPrincipal: number;
  allocBankFees: number;
  allocLanded: number;
  totalAllocated: number;
  trueUnitCostIdr: number;
  warnings: string[];
}

// ─── Component ───────────────────────────────────────────────────────────────

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

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Autocomplete candidates
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

  // ── Filtered data ────────────────────────────────────────────────────────

  const myQuoteItems = useMemo(
    () => (selected ? quoteItems.filter((qi) => qi.component_id === selected.component_id) : []),
    [selected, quoteItems],
  );

  const myPoItems = useMemo(
    () => (selected ? poItems.filter((pi) => pi.component_id === selected.component_id) : []),
    [selected, poItems],
  );

  // ── Cost allocation per PO line item ─────────────────────────────────────

  const allocations = useMemo<Allocation[]>(() => {
    return myPoItems
      .map((item): Allocation | null => {
        const po = pos.find((p) => p.po_id === item.po_id);
        if (!po) return null;

        // Total PO value in foreign currency across ALL line items
        const allPoItems = poItems.filter((i) => i.po_id === item.po_id && i.quantity > 0);
        const totalPoValueForeign = allPoItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
        const lineValueForeign = item.unit_cost * item.quantity;
        const lineShare = totalPoValueForeign > 0 ? lineValueForeign / totalPoValueForeign : 0;

        // PO costs
        const costs = poCosts.filter((c) => c.po_id === item.po_id);
        const principal = costs
          .filter((c) => PRINCIPAL_CATS.has(c.cost_category))
          .reduce((s, c) => s + c.amount, 0);
        const bankFees = costs
          .filter((c) => BANK_FEE_CATS.has(c.cost_category))
          .reduce((s, c) => s + c.amount, 0);
        // Landed = everything that is NOT a payment, NOT a bank fee, NOT a tax
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

        const warnings: string[] = [];
        if (principal === 0) warnings.push('No payments recorded');
        if (!po.exchange_rate && po.currency !== 'IDR') warnings.push('Missing exchange rate');
        if (totalPoValueForeign === 0) warnings.push('PO total is zero');

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
          warnings,
        };
      })
      .filter((a): a is Allocation => a !== null);
  }, [myPoItems, poItems, pos, poCosts]);

  // All PO costs for the related POs (reference section)
  const relatedPoIds = useMemo(() => new Set(myPoItems.map((i) => i.po_id)), [myPoItems]);
  const relatedPoCosts = useMemo(
    () => poCosts.filter((c) => relatedPoIds.has(c.po_id)),
    [poCosts, relatedPoIds],
  );

  // Lookup helpers
  const getQuote = (id: number) => quotes.find((q) => q.quote_id === id);
  const getPo = (id: number) => pos.find((p) => p.po_id === id);
  const getSupplier = (id?: number) =>
    suppliers.find((s) => s.supplier_id === id)?.supplier_name || '—';

  const hasData = selected && (myQuoteItems.length > 0 || myPoItems.length > 0);

  // ── Status badge helper ──────────────────────────────────────────────────

  const statusBadge = (status?: string) => {
    const cls =
      status === 'Accepted' || status === 'Fully Received'
        ? 'bg-emerald-900/50 text-emerald-300'
        : status === 'Rejected' || status === 'Expired' || status === 'Cancelled'
          ? 'bg-red-900/50 text-red-300'
          : status === 'Partially Received'
            ? 'bg-amber-900/50 text-amber-300'
            : 'bg-slate-700 text-slate-300';
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{status || '—'}</span>
    );
  };

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── Search input ── */}
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
                      <td className="px-4 py-3 text-slate-300">
                        {getSupplier(quote?.supplier_id)}
                      </td>
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
            Bank fees &amp; landed costs (excl. PPN/VAT) are apportioned by each line
            item&apos;s share of the PO&apos;s total foreign-currency value. PO cost amounts
            assumed to be entered in IDR.
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
                    className="bg-slate-900/40 hover:bg-slate-800/60 transition-colors"
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
                    <td className="px-4 py-3">
                      {a.warnings.length > 0 ? (
                        <span className="text-xs text-yellow-400">⚠ {a.warnings[0]}</span>
                      ) : (
                        statusBadge(a.po.status)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          C: PO COSTS REFERENCE
      ══════════════════════════════════════════════════════════════════════ */}
      {relatedPoCosts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-rose-400 mb-1 flex items-center gap-2">
            C — PO Costs Reference
            <span className="bg-rose-900/50 text-rose-300 text-xs px-2 py-0.5 rounded-full">
              {relatedPoCosts.length}
            </span>
          </h3>
          <p className="text-slate-500 text-xs mb-3">
            All costs for the {relatedPoIds.size} PO{relatedPoIds.size !== 1 ? 's' : ''} that
            contain this component. Rows marked Tax (PPN) are greyed out — they are excluded from
            the true cost calculation above.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/80 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">PO #</th>
                  <th className="px-4 py-3 text-left">PI #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {relatedPoCosts.map((c) => {
                  const po = getPo(c.po_id);
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
                      className={`hover:bg-slate-800/60 transition-colors ${isTax ? 'opacity-40' : 'bg-slate-900/40'}`}
                    >
                      <td className="px-4 py-3 text-sky-300 font-mono text-xs">
                        {po?.po_number || `PO #${c.po_id}`}
                      </td>
                      <td className="px-4 py-3 text-violet-300 font-mono text-xs">
                        {po?.pi_number || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{c.payment_date || '—'}</td>
                      <td className="px-4 py-3 text-slate-200">
                        {COST_LABELS[c.cost_category] || c.cost_category}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${typeCls}`}>
                          {typeLabel}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${isTax ? 'text-slate-500' : 'text-rose-300'}`}
                      >
                        {c.currency} {fmtNum(c.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">
                        {c.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
