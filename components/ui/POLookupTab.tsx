/**
 * POLookupTab
 *
 * Procurement-safe document view for any PI or PO.
 * Shows: header, line items, and full payment/cost history with outstanding balance.
 * No TUC or margin data — safe for procurement staff.
 */
'use client';
import { useState, useMemo } from 'react';
import type {
  PurchaseOrder, PurchaseLineItem, POCost,
  Supplier, PriceQuote, Component,
} from '@/types/database';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRINCIPAL_CATS = new Set([
  'down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit',
]);
const BANK_FEE_CATS = new Set([
  'full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee',
  'admin_bank_fee', 'inter_bank_transfer_fee',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtIdr = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');
const fmtCcy = (n: number, ccy: string) =>
  `${ccy} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function poTotalIdr(po: PurchaseOrder): number {
  const val = Number(po.total_value) || 0;
  if (po.currency === 'IDR') return val;
  return val * (Number(po.exchange_rate) || 1);
}

function costToIdr(cost: POCost, po: PurchaseOrder): number {
  if (cost.currency === 'IDR') return Number(cost.amount) || 0;
  return (Number(cost.amount) || 0) * (Number(po.exchange_rate) || 1);
}

function statusBadge(status?: string) {
  const map: Record<string, string> = {
    Draft:               'bg-slate-700 text-slate-300',
    Sent:                'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    Confirmed:           'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
    Replaced:            'bg-slate-600/40 text-slate-400 border border-slate-600/40',
    'Partially Received': 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    'Fully Received':    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    Cancelled:           'bg-red-500/20 text-red-300 border border-red-500/30',
  };
  return map[status ?? ''] ?? 'bg-slate-700/60 text-slate-400';
}

const PO_STATUSES = ['Draft', 'Sent', 'Confirmed', 'Replaced', 'Partially Received', 'Fully Received', 'Cancelled'] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  suppliers: Supplier[];
  quotes: PriceQuote[];
  components: Component[];
  onStatusChange?: (poId: string, status: string) => Promise<void>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function POLookupTab({
  pos, poItems, poCosts, suppliers, quotes, components, onStatusChange,
}: Props) {
  const [search, setSearch]   = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  // ── Supplier code map ─────────────────────────────────────────────────────
  const poSupplierCode = useMemo(() => {
    const r: Record<string, string> = {};
    for (const po of pos) {
      if (!po.quote_id) continue;
      const q = quotes.find((q) => String(q.quote_id) === String(po.quote_id));
      if (!q) continue;
      const s = suppliers.find((s) => s.supplier_id === q.supplier_id);
      if (s?.supplier_code) r[String(po.po_id)] = s.supplier_code;
      else if (s?.supplier_name) r[String(po.po_id)] = s.supplier_name.slice(0, 8).toUpperCase();
    }
    return r;
  }, [pos, quotes, suppliers]);

  // ── Filtered / sorted PO list ─────────────────────────────────────────────
  const sorted = useMemo(
    () => [...pos].sort((a, b) => b.po_date.localeCompare(a.po_date)),
    [pos]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return sorted.slice(0, 60);
    return sorted.filter((p) => {
      const code = poSupplierCode[String(p.po_id)]?.toLowerCase() ?? '';
      return (
        p.po_number?.toLowerCase().includes(q) ||
        p.pi_number?.toLowerCase().includes(q) ||
        code.includes(q)
      );
    });
  }, [sorted, search, poSupplierCode]);

  // ── Selected PO ───────────────────────────────────────────────────────────
  const po = useMemo(
    () => (selectedId ? pos.find((p) => String(p.po_id) === selectedId) ?? null : null),
    [pos, selectedId]
  );

  const items = useMemo(
    () => (po ? poItems.filter((i) => String(i.po_id) === String(po.po_id)) : []),
    [po, poItems]
  );

  const costs = useMemo(
    () => (po ? poCosts.filter((c) => String(c.po_id) === String(po.po_id)) : []),
    [po, poCosts]
  );

  const principal  = useMemo(() => costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)), [costs]);
  const bankFees   = useMemo(() => costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)),  [costs]);
  const landed     = useMemo(() => costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category)), [costs]);

  const totalIdr    = po ? poTotalIdr(po) : 0;
  const paidIdr     = useMemo(
    () => po
      ? principal
          .filter((c) => c.cost_category !== 'overpayment_credit')
          .reduce((s, c) => s + costToIdr(c, po), 0)
      : 0,
    [principal, po]
  );
  const outstandingIdr = totalIdr > 0 ? Math.max(0, totalIdr - paidIdr) : 0;
  const paidPct        = totalIdr > 0 ? Math.min(100, (paidIdr / totalIdr) * 100) : 0;

  const quote    = po?.quote_id ? quotes.find((q) => String(q.quote_id) === String(po.quote_id)) : null;
  const supplier = quote ? suppliers.find((s) => s.supplier_id === quote.supplier_id) : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-5 items-start">

      {/* ── Left: search + list ── */}
      <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4">
        <h3 className="text-sm font-bold text-white mb-3">Find a PO / PI</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="PO #, PI #, or supplier code…"
          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 mb-3"
        />
        <div className="space-y-1 max-h-[calc(100vh-260px)] overflow-y-auto pr-0.5">
          {filtered.length === 0 && (
            <p className="text-xs text-slate-600 italic px-1 py-4 text-center">No results</p>
          )}
          {filtered.map((p) => {
            const key  = String(p.po_id);
            const code = poSupplierCode[key];
            const sel  = selectedId === key;
            const pCosts   = poCosts.filter((c) => String(c.po_id) === String(p.po_id));
            const pPaid    = pCosts
              .filter((c) => PRINCIPAL_CATS.has(c.cost_category) && c.cost_category !== 'overpayment_credit')
              .reduce((s, c) => s + costToIdr(c, p), 0);
            const pTotal   = poTotalIdr(p);
            const pPaidPct = pTotal > 0 ? Math.min(100, (pPaid / pTotal) * 100) : 0;
            return (
              <div
                key={key}
                className={`w-full px-3 py-2.5 rounded-xl transition-colors border ${
                  sel
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                    : 'bg-slate-800/30 border-transparent hover:bg-slate-800/60 text-slate-300'
                }`}
              >
                {/* Clickable header row */}
                <button
                  className="w-full text-left"
                  onClick={() => setSelectedId(sel ? null : key)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {code && (
                      <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                        {code}
                      </span>
                    )}
                    <span className="text-xs font-semibold truncate">{p.po_number}</span>
                  </div>
                  <div className="text-[11px] mt-0.5 flex flex-wrap gap-x-2">
                    {p.pi_number && <span className="text-slate-200 font-medium">{p.pi_number}</span>}
                    <span className="text-slate-500">{p.po_date}</span>
                  </div>
                  {pTotal > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pPaidPct >= 100 ? 'bg-emerald-500' : pPaidPct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}
                          style={{ width: `${pPaidPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">{pPaidPct.toFixed(0)}% paid</span>
                    </div>
                  )}
                </button>
                {/* Inline status selector */}
                {onStatusChange && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <select
                      value={p.status ?? ''}
                      disabled={updatingStatus === key}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        e.stopPropagation();
                        setUpdatingStatus(key);
                        try { await onStatusChange(key, e.target.value); } finally { setUpdatingStatus(null); }
                      }}
                      className={`flex-1 text-[11px] font-semibold rounded-lg px-2 py-1 border bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 cursor-pointer disabled:opacity-60 ${statusBadge(p.status)}`}
                    >
                      {PO_STATUSES.map((s) => (
                        <option key={s} value={s} className="bg-slate-900 text-slate-200">{s}</option>
                      ))}
                    </select>
                    {updatingStatus === key && (
                      <span className="text-[10px] text-slate-500 animate-pulse flex-shrink-0">saving…</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: document view ── */}
      {!po ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-10 flex flex-col items-center justify-center text-center min-h-[300px]">
          <span className="text-4xl mb-3 opacity-40">📋</span>
          <p className="text-slate-500 text-sm">Select a PO from the list to view its details</p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* Header card */}
          <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  {poSupplierCode[String(po.po_id)] && (
                    <span className="inline-block px-2 py-1 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-bold rounded">
                      {poSupplierCode[String(po.po_id)]}
                    </span>
                  )}
                  {po.status && (
                    <span className={`inline-block px-2 py-1 text-xs font-bold rounded ${statusBadge(po.status)}`}>
                      {po.status}
                    </span>
                  )}
                </div>
                {/* PI# is the primary vendor reference — lead with it */}
                {po.pi_number
                  ? <h2 className="text-xl font-bold text-white mt-1">{po.pi_number}</h2>
                  : <h2 className="text-xl font-bold text-white mt-1">{po.po_number}</h2>
                }
                <p className="text-sm text-slate-400 mt-0.5">{po.pi_number ? `PO: ${po.po_number}` : ''}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {po.total_value && (
                  <p className="text-base font-bold text-white">{fmtCcy(po.total_value, po.currency)}</p>
                )}
                {po.currency !== 'IDR' && po.exchange_rate && po.total_value && (
                  <p className="text-xs text-slate-500">≈ {fmtIdr(poTotalIdr(po))}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'PO Date',    value: po.po_date },
                { label: 'PI Date',    value: po.pi_date },
                { label: 'Supplier',   value: supplier?.supplier_name },
                { label: 'Incoterms', value: po.incoterms },
                { label: 'Est. Delivery', value: po.estimated_delivery_date },
                { label: 'Actual Delivery', value: po.actual_delivery_date },
                { label: 'Received',  value: po.actual_received_date },
                { label: 'Ship Via',  value: po.method_of_shipment },
              ].map(({ label, value }) =>
                value ? (
                  <div key={label}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                    <p className="text-slate-200 mt-0.5">{value}</p>
                  </div>
                ) : null
              )}
            </div>
          </div>

          {/* Payment balance */}
          {totalIdr > 0 && (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Payment Status</h4>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                    style={{ width: `${paidPct}%` }}
                  />
                </div>
                <span className={`text-sm font-bold flex-shrink-0 ${paidPct >= 100 ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {paidPct.toFixed(1)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-800/40 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">PO Total</p>
                  <p className="font-bold text-white">{fmtIdr(totalIdr)}</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">Paid</p>
                  <p className="font-bold text-emerald-300">{fmtIdr(paidIdr)}</p>
                </div>
                <div className={`rounded-xl p-3 ${outstandingIdr > 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-800/40'}`}>
                  <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">Outstanding</p>
                  <p className={`font-bold ${outstandingIdr > 0 ? 'text-amber-300' : 'text-slate-400'}`}>
                    {fmtIdr(outstandingIdr)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Line items */}
          {items.length > 0 && (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Line Items <span className="text-slate-600 font-normal normal-case">({items.length})</span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700/60">
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase text-slate-500">Component</th>
                      <th className="text-right py-2 pr-4 text-[11px] font-bold uppercase text-slate-500">Qty</th>
                      <th className="text-right py-2 pr-4 text-[11px] font-bold uppercase text-slate-500">Unit Cost</th>
                      <th className="text-right py-2 text-[11px] font-bold uppercase text-slate-500">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const comp = components.find((c) => c.component_id === item.component_id);
                      const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0);
                      return (
                        <tr key={item.po_item_id} className="border-b border-slate-800/40">
                          <td className="py-2.5 pr-4">
                            <p className="font-semibold text-white">{comp?.supplier_model ?? '—'}</p>
                            {comp?.internal_description && (
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">{comp.internal_description}</p>
                            )}
                            {item.supplier_description && !comp && (
                              <p className="text-[11px] text-slate-500 mt-0.5">{item.supplier_description}</p>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-slate-300">
                            {Number(item.quantity).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-slate-300">
                            {fmtCcy(item.unit_cost, item.currency)}
                          </td>
                          <td className="py-2.5 text-right font-semibold text-white">
                            {fmtCcy(lineTotal, item.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Costs & payments */}
          {costs.length > 0 && (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Payments & Costs <span className="text-slate-600 font-normal normal-case">({costs.length} entries)</span>
              </h4>
              <div className="space-y-4">
                {[
                  { label: 'Principal Payments', rows: principal },
                  { label: 'Bank Fees',           rows: bankFees },
                  { label: 'Landed Costs',         rows: landed },
                ].map(({ label, rows }) =>
                  rows.length === 0 ? null : (
                    <div key={label}>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{label}</p>
                      <div className="space-y-1">
                        {rows.map((c) => (
                          <div key={c.cost_id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-slate-800/40 last:border-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-400 capitalize">{c.cost_category.replace(/_/g, ' ')}</span>
                              {c.notes && <span className="text-slate-600 truncate text-[11px]">· {c.notes}</span>}
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {c.payment_date && (
                                <span className="text-slate-500 text-[11px]">{c.payment_date}</span>
                              )}
                              <span className="font-semibold text-white">{fmtCcy(c.amount, c.currency)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {items.length === 0 && costs.length === 0 && (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 text-center">
              <p className="text-slate-600 text-sm">No line items or payment records yet for this PO.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
