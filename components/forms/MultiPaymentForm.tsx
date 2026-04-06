/**
 * MultiPaymentForm
 *
 * Log a single bank remittance that covers multiple POs.
 * Creates one payment_batches row + (N POs × M cost entries) po_costs rows.
 *
 * Allocation is proportional by each PO's IDR value. Per-PO total overrides
 * are supported; each cost entry is split using the resulting PO share.
 */
'use client';
import React, { useState, useMemo } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import type { PurchaseOrder, Supplier, PriceQuote, POCost } from '@/types/database';
import { ENUMS } from '@/constants/enums';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
import { fmtIdr } from '@/lib/formatters';

const ALL_COST_CATS = ENUMS.po_cost_category as readonly string[];

interface CostItem {
  uid: string;
  category: string;
  amountStr: string;
}

interface Props {
  pos: PurchaseOrder[];
  suppliers: Supplier[];
  quotes: PriceQuote[];
  poCosts: POCost[];
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export default function MultiPaymentForm({ pos, suppliers, quotes, poCosts, onSuccess, onError }: Props) {
  const [poSearch,    setPoSearch]    = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankRef,     setBankRef]     = useState('');
  const [costItems,   setCostItems]   = useState<CostItem[]>([
    { uid: 'item_0', category: 'balance_payment', amountStr: '' },
  ]);
  const [overrides,   setOverrides]   = useState<Record<string, string>>({});
  const [submitting,  setSubmitting]  = useState(false);

  // ── Payment status per PO: po_id → { paidIdr, totalIdr, pct } ──────────
  const poPaymentStatus = useMemo(() => {
    const r: Record<string, { paidIdr: number; totalIdr: number; pct: number }> = {};
    for (const po of pos) {
      const key = String(po.po_id);
      const val = Number(po.total_value) || 0;
      const xr  = Number(po.exchange_rate) || 1;
      const totalIdr = po.currency === 'IDR' ? val : val * xr;
      const paidIdr = poCosts
        .filter((c) => String(c.po_id) === String(po.po_id) && PRINCIPAL_CATS.has(c.cost_category))
        .reduce((s, c) => s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * xr), 0);
      r[key] = { paidIdr, totalIdr, pct: totalIdr > 0 ? Math.min(100, (paidIdr / totalIdr) * 100) : 0 };
    }
    return r;
  }, [pos, poCosts]);

  // ── Supplier code lookup: po_id → supplier_code ───────────────────────
  const poSupplierCode = useMemo(() => {
    const r: Record<string, string> = {};
    for (const po of pos) {
      if (!po.quote_id) continue;
      const quote = quotes.find((q) => String(q.quote_id) === String(po.quote_id));
      if (!quote) continue;
      const supplier = suppliers.find((s) => s.supplier_id === quote.supplier_id);
      if (supplier?.supplier_code) r[String(po.po_id)] = supplier.supplier_code;
    }
    return r;
  }, [pos, quotes, suppliers]);

  // ── PO list (filtered) ────────────────────────────────────────────────
  const filteredPos = useMemo(() => {
    const q = poSearch.toLowerCase().trim();
    const sorted = [...pos].sort((a, b) => b.po_date.localeCompare(a.po_date));
    if (!q) return sorted.slice(0, 40);
    return sorted.filter((p) => {
      const code = poSupplierCode[String(p.po_id)]?.toLowerCase() ?? '';
      return (
        p.po_number?.toLowerCase().includes(q) ||
        p.pi_number?.toLowerCase().includes(q) ||
        code.includes(q)
      );
    }).slice(0, 40);
  }, [pos, poSearch, poSupplierCode]);

  const selectedPos = useMemo(
    () => pos.filter((p) => selectedIds.includes(String(p.po_id))),
    [pos, selectedIds]
  );

  // ── IDR value per selected PO ─────────────────────────────────────────
  const poIdrValues = useMemo(() => {
    const r: Record<string, number> = {};
    for (const po of selectedPos) {
      const val = Number(po.total_value) || 0;
      const xr  = Number(po.exchange_rate) || 1;
      r[String(po.po_id)] = po.currency === 'IDR' ? val : val * xr;
    }
    return r;
  }, [selectedPos]);

  const totalIdrValue = useMemo(
    () => Object.values(poIdrValues).reduce((s, v) => s + v, 0),
    [poIdrValues]
  );

  // ── Grand total across all cost entries ───────────────────────────────
  const totalAmount = useMemo(
    () => costItems.reduce((s, item) => s + (parseFloat(item.amountStr) || 0), 0),
    [costItems]
  );

  // ── Per-PO total allocations (override-aware) ─────────────────────────
  const allocations = useMemo(() => {
    const r: Record<string, number> = {};
    for (const po of selectedPos) {
      const key = String(po.po_id);
      if (overrides[key] !== undefined) {
        r[key] = parseFloat(overrides[key]) || 0;
      } else {
        const share = totalIdrValue > 0
          ? (poIdrValues[key] ?? 0) / totalIdrValue
          : 1 / (selectedPos.length || 1);
        r[key] = Math.round(totalAmount * share);
      }
    }
    return r;
  }, [selectedPos, overrides, totalAmount, poIdrValues, totalIdrValue]);

  const allocatedTotal = Object.values(allocations).reduce((s, v) => s + v, 0);
  const delta = totalAmount - allocatedTotal;

  // ── Helpers ────────────────────────────────────────────────────────────
  const togglePo = (poId: string) => {
    setSelectedIds((prev) =>
      prev.includes(poId) ? prev.filter((id) => id !== poId) : [...prev, poId]
    );
    setOverrides((prev) => { const n = { ...prev }; delete n[poId]; return n; });
  };

  const addCostItem = () =>
    setCostItems((prev) => [
      ...prev,
      { uid: `item_${Date.now()}`, category: 'balance_payment', amountStr: '' },
    ]);

  const removeCostItem = (uid: string) =>
    setCostItems((prev) => prev.filter((i) => i.uid !== uid));

  const updateCostItem = (uid: string, patch: Partial<CostItem>) =>
    setCostItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  const clearOverride = (poId: string) =>
    setOverrides((prev) => { const n = { ...prev }; delete n[poId]; return n; });

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (selectedPos.length === 0) { onError('Select at least one PO.'); return; }
    if (totalAmount <= 0)         { onError('Add at least one cost entry with an amount.'); return; }
    if (Math.abs(delta) > 1)     {
      onError(`Allocation total (${fmtIdr(allocatedTotal)}) ≠ payment total (${fmtIdr(totalAmount)}). Adjust amounts.`);
      return;
    }

    setSubmitting(true);
    const supabase = createSupabaseClient();

    // 1. Create the batch record
    const { data: batchData, error: batchErr } = await supabase
      .from('payment_batches')
      .insert({
        batch_date:     paymentDate,
        total_amount:   totalAmount,
        currency:       'IDR',
        bank_reference: bankRef || null,
        notes:          null,
      })
      .select('batch_id')
      .single();

    if (batchErr || !batchData) {
      onError(`Failed to create batch: ${batchErr?.message ?? 'unknown error'}`);
      setSubmitting(false);
      return;
    }

    const batchId = batchData.batch_id;

    // 2. Build po_costs rows: for each PO × each cost entry
    // Each cost entry is split using the PO's share of the grand total.
    const costRows: Record<string, unknown>[] = [];

    for (const po of selectedPos) {
      const key = String(po.po_id);
      const poTotal = allocations[key] ?? 0;
      const poShare = totalAmount > 0 ? poTotal / totalAmount : 1 / (selectedPos.length || 1);

      for (const item of costItems) {
        const itemTotal = parseFloat(item.amountStr) || 0;
        if (itemTotal <= 0) continue;
        const amount = Math.round(itemTotal * poShare);
        if (amount <= 0) continue;
        costRows.push({
          po_id:         po.po_id,
          cost_category: item.category,
          amount,
          currency:      'IDR',
          payment_date:  paymentDate,
          notes:         bankRef || null,
          batch_id:      batchId,
        });
      }
    }

    const { error: costsErr } = await supabase.from('6.0_po_costs').insert(costRows);
    if (costsErr) {
      onError(`Failed to insert costs: ${costsErr.message}`);
      setSubmitting(false);
      return;
    }

    // Reset
    setSelectedIds([]);
    setCostItems([{ uid: 'item_0', category: 'balance_payment', amountStr: '' }]);
    setBankRef('');
    setOverrides({});
    setSubmitting(false);
    onSuccess();
  };

  const hasValidCosts = costItems.some((i) => parseFloat(i.amountStr) > 0);
  const canSubmit = selectedPos.length > 0 && hasValidCosts && Math.abs(delta) <= 1 && !submitting;

  return (
    <div className="xl:grid xl:grid-cols-[1fr_1fr] xl:gap-8 xl:items-start">

      {/* ── LEFT COLUMN: Step 1 Select POs ── */}
      <div className="mb-5 xl:mb-0">
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 xl:p-6">
          <h4 className="text-sm font-bold text-white mb-3">1 · Select POs</h4>
          <input
            type="text" value={poSearch} onChange={(e) => setPoSearch(e.target.value)}
            placeholder="Filter by PO number, PI / reference, or supplier code…"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 mb-3"
          />
          <div className="space-y-1.5 max-h-64 xl:max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
            {filteredPos.map((po) => {
              const key      = String(po.po_id);
              const idrVal   = poIdrValues[key] ?? (po.currency === 'IDR' ? Number(po.total_value) : 0);
              const selected = selectedIds.includes(key);
              return (
                <label key={key} className={`flex items-center gap-3 px-3 py-3 xl:py-3.5 rounded-xl cursor-pointer transition-colors border ${selected ? 'bg-rose-500/10 border-rose-500/30' : 'bg-slate-800/40 border-transparent hover:bg-slate-800/60'}`}>
                  <input type="checkbox" checked={selected} onChange={() => togglePo(key)} className="accent-rose-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {poSupplierCode[key] && (
                        <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                          {poSupplierCode[key]}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-white">{po.po_number}</span>
                    </div>
                    {po.pi_number && (
                      <div className="text-xs font-semibold text-slate-200 mt-0.5">{po.pi_number}</div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 min-w-[90px]">
                    <div className="text-xs font-semibold text-slate-300">{po.currency} {Number(po.total_value).toLocaleString()}</div>
                    {po.currency !== 'IDR' && idrVal > 0 && <div className="text-[10px] text-slate-500">≈ {fmtIdr(idrVal)}</div>}
                    {po.currency !== 'IDR' && !po.exchange_rate && <div className="text-[10px] text-amber-500">no XR — add to PO</div>}
                    {poPaymentStatus[key]?.totalIdr > 0 && (
                      <div className="flex items-center gap-1.5 mt-1 justify-end">
                        <div className="w-16 h-1 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${poPaymentStatus[key].pct >= 100 ? 'bg-emerald-500' : poPaymentStatus[key].pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}
                            style={{ width: `${poPaymentStatus[key].pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500">{poPaymentStatus[key].pct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          {selectedIds.length > 0 && (
            <p className="text-xs text-rose-300 font-semibold mt-3">
              {selectedIds.length} PO{selectedIds.length > 1 ? 's' : ''} selected · combined IDR value: {fmtIdr(totalIdrValue)}
            </p>
          )}
        </div>
      </div>

      {/* ── RIGHT COLUMN: Steps 2, 3, 4 ── */}
      <div className="space-y-5">

      {/* ── Step 2: Batch details ── */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5">
          <h4 className="text-sm font-bold text-white mb-4">2 · Batch Details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Payment Date</label>
              <input
                type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Bank Reference</label>
              <input
                type="text" value={bankRef} onChange={(e) => setBankRef(e.target.value)}
                placeholder="Wire / TT reference number"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Cost entries ── */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-bold text-white">3 · Cost Entries</h4>
            <button
              onClick={addCostItem}
              className="px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
            >
              + Add entry
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">Add one row per cost category. All entries are split proportionally across the selected POs.</p>

          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[1fr_180px_32px] gap-3 px-1">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Cost Category</span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Amount (IDR)</span>
              <span />
            </div>

            {costItems.map((item, idx) => (
              <div key={item.uid} className="grid grid-cols-[1fr_180px_32px] gap-3 items-center">
                <select
                  value={item.category}
                  onChange={(e) => updateCostItem(item.uid, { category: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  {ALL_COST_CATS.map((c) => (
                    <option key={c} value={c} className="bg-[#020617] text-white">{c.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <input
                  type="number" min="0" step="1000"
                  value={item.amountStr}
                  onChange={(e) => {
                    updateCostItem(item.uid, { amountStr: e.target.value });
                    setOverrides({});
                  }}
                  placeholder="e.g. 350000000"
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <button
                  onClick={() => removeCostItem(item.uid)}
                  disabled={costItems.length === 1}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-lg leading-none"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Running total */}
          {totalAmount > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-700/60 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400">Total</span>
              <span className="text-sm font-bold text-white tabular-nums">{fmtIdr(totalAmount)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Allocation ── */}
      {selectedIds.length > 0 && totalAmount > 0 && (
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5">
          <h4 className="text-sm font-bold text-white mb-0.5">4 · Allocation</h4>
          <p className="text-xs text-slate-500 mb-4">
            Split is proportional by PO IDR value. Edit any amount to override — the delta indicator shows if totals don&apos;t balance.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase text-slate-500">PO</th>
                  <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase text-slate-500">IDR Value</th>
                  <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase text-slate-500">Share</th>
                  <th className="text-left py-2 text-[11px] font-bold uppercase text-slate-500">Allocated (IDR)</th>
                </tr>
              </thead>
              <tbody>
                {selectedPos.map((po) => {
                  const key        = String(po.po_id);
                  const share      = totalIdrValue > 0 ? ((poIdrValues[key] ?? 0) / totalIdrValue) * 100 : 100 / selectedPos.length;
                  const allocated  = allocations[key] ?? 0;
                  const overridden = overrides[key] !== undefined;
                  return (
                    <tr key={key} className="border-b border-slate-800/60">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {poSupplierCode[key] && (
                            <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                              {poSupplierCode[key]}
                            </span>
                          )}
                          <span className="font-semibold text-white text-xs">{po.po_number}</span>
                        </div>
                        {po.pi_number && <div className="text-[11px] font-medium text-slate-300 mt-0.5">{po.pi_number}</div>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400">{fmtIdr(poIdrValues[key] ?? 0)}</td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400">{share.toFixed(1)}%</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" step="1000"
                            value={overridden ? overrides[key] : String(allocated)}
                            onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value }))}
                            className={`w-44 px-2 py-1 bg-slate-950 border rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 ${overridden ? 'border-amber-500/60' : 'border-slate-700'}`}
                          />
                          {overridden && (
                            <button onClick={() => clearOverride(key)} className="text-[10px] text-slate-500 hover:text-slate-300 whitespace-nowrap">
                              ↺ auto
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-slate-600">
                  <td colSpan={3} className="pt-3 text-xs font-bold text-slate-400">Total allocated</td>
                  <td className="pt-3">
                    <span className={`text-sm font-bold tabular-nums ${Math.abs(delta) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtIdr(allocatedTotal)}
                    </span>
                    {Math.abs(delta) > 1 && (
                      <span className="text-xs text-red-400 ml-2">
                        {delta > 0 ? `${fmtIdr(delta)} unallocated` : `${fmtIdr(Math.abs(delta))} over`}
                      </span>
                    )}
                    {Math.abs(delta) <= 1 && <span className="text-xs text-emerald-600 ml-2">✓ balanced</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Submit ── */}
      {selectedIds.length > 0 && hasValidCosts && (
        <button
          onClick={handleSubmit} disabled={!canSubmit}
          className="w-full py-3.5 bg-rose-500 hover:bg-rose-400 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm"
        >
          {submitting
            ? 'Saving…'
            : `Submit Batch Payment · ${selectedPos.length} PO${selectedPos.length > 1 ? 's' : ''} · ${costItems.filter((i) => parseFloat(i.amountStr) > 0).length} entr${costItems.filter((i) => parseFloat(i.amountStr) > 0).length === 1 ? 'y' : 'ies'} · ${fmtIdr(totalAmount)}`}
        </button>
      )}
      </div>
    </div>
  );
}
