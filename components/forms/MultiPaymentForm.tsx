/**
 * MultiPaymentForm
 *
 * Log a single bank remittance that covers multiple POs.
 * Creates one payment_batches row + N po_costs rows (principal + fees).
 *
 * Allocation is proportional by each PO's IDR value (total_value × exchange_rate).
 * Individual amounts are editable — a running delta shows any imbalance.
 */
'use client';
import React, { useState, useMemo } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import type { PurchaseOrder } from '@/types/database';

const PRINCIPAL_CATS = ['down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit'];
const BANK_FEE_CATS  = ['full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee', 'admin_bank_fee', 'inter_bank_transfer_fee'];

const fmtIdr = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');

interface FeeItem {
  uid: string;
  category: string;
  amountStr: string;
}

interface Props {
  pos: PurchaseOrder[];
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export default function MultiPaymentForm({ pos, onSuccess, onError }: Props) {
  const [poSearch,       setPoSearch]       = useState('');
  const [selectedIds,    setSelectedIds]    = useState<string[]>([]);
  const [costCategory,   setCostCategory]   = useState('balance_payment');
  const [totalAmountStr, setTotalAmountStr] = useState('');
  const [paymentDate,    setPaymentDate]    = useState(new Date().toISOString().slice(0, 10));
  const [bankRef,        setBankRef]        = useState('');
  const [overrides,      setOverrides]      = useState<Record<string, string>>({});
  const [fees,           setFees]           = useState<FeeItem[]>([]);
  const [submitting,     setSubmitting]     = useState(false);

  // ── PO list (filtered) ────────────────────────────────────────────────
  const filteredPos = useMemo(() => {
    const q = poSearch.toLowerCase().trim();
    const sorted = [...pos].sort((a, b) => b.po_date.localeCompare(a.po_date));
    if (!q) return sorted.slice(0, 40);
    return sorted.filter((p) =>
      p.po_number?.toLowerCase().includes(q) ||
      p.pi_number?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [pos, poSearch]);

  const selectedPos = useMemo(
    () => pos.filter((p) => selectedIds.includes(String(p.po_id))),
    [pos, selectedIds]
  );

  // ── IDR value of each selected PO (for proportional weights) ─────────
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

  const totalAmount = parseFloat(totalAmountStr) || 0;

  // ── Proportional allocations (override-aware) ─────────────────────────
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

  // ── Fee allocations (always proportional, not editable per-PO) ───────
  const feeAllocations = useMemo(() => {
    const r: Record<string, Record<string, number>> = {};
    for (const fee of fees) {
      const feeTotal = parseFloat(fee.amountStr) || 0;
      r[fee.uid] = {};
      for (const po of selectedPos) {
        const key = String(po.po_id);
        const share = totalIdrValue > 0
          ? (poIdrValues[key] ?? 0) / totalIdrValue
          : 1 / (selectedPos.length || 1);
        r[fee.uid][key] = Math.round(feeTotal * share);
      }
    }
    return r;
  }, [fees, selectedPos, poIdrValues, totalIdrValue]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const togglePo = (poId: string) => {
    setSelectedIds((prev) =>
      prev.includes(poId) ? prev.filter((id) => id !== poId) : [...prev, poId]
    );
    setOverrides((prev) => { const n = { ...prev }; delete n[poId]; return n; });
  };

  const clearOverride = (poId: string) =>
    setOverrides((prev) => { const n = { ...prev }; delete n[poId]; return n; });

  const addFee = () =>
    setFees((prev) => [...prev, { uid: `fee_${Date.now()}`, category: 'telex_bank_fee', amountStr: '' }]);

  const removeFee = (uid: string) =>
    setFees((prev) => prev.filter((f) => f.uid !== uid));

  const updateFee = (uid: string, patch: Partial<FeeItem>) =>
    setFees((prev) => prev.map((f) => f.uid === uid ? { ...f, ...patch } : f));

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (selectedPos.length === 0) { onError('Select at least one PO.'); return; }
    if (!totalAmount)             { onError('Enter a total amount.'); return; }
    if (Math.abs(delta) > 1)     { onError(`Allocation total (${fmtIdr(allocatedTotal)}) ≠ payment total (${fmtIdr(totalAmount)}). Adjust amounts.`); return; }

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

    // 2. Build all po_costs rows
    const costRows: Record<string, unknown>[] = [];

    for (const po of selectedPos) {
      const key    = String(po.po_id);
      const amount = allocations[key] ?? 0;
      if (amount > 0) {
        costRows.push({ po_id: po.po_id, cost_category: costCategory, amount, currency: 'IDR', payment_date: paymentDate, notes: bankRef || null, batch_id: batchId });
      }
    }

    for (const fee of fees) {
      const feeTotal = parseFloat(fee.amountStr) || 0;
      if (feeTotal <= 0) continue;
      for (const po of selectedPos) {
        const key    = String(po.po_id);
        const amount = feeAllocations[fee.uid]?.[key] ?? 0;
        if (amount > 0) {
          costRows.push({ po_id: po.po_id, cost_category: fee.category, amount, currency: 'IDR', payment_date: paymentDate, notes: bankRef || null, batch_id: batchId });
        }
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
    setTotalAmountStr('');
    setBankRef('');
    setOverrides({});
    setFees([]);
    setSubmitting(false);
    onSuccess();
  };

  const canSubmit = selectedPos.length > 0 && totalAmount > 0 && Math.abs(delta) <= 1 && !submitting;

  return (
    <div className="space-y-5 max-w-4xl">

      {/* ── Step 1: Select POs ── */}
      <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-5">
        <h4 className="text-sm font-bold text-white mb-3">1 · Select POs</h4>
        <input
          type="text" value={poSearch} onChange={(e) => setPoSearch(e.target.value)}
          placeholder="Filter by PO number or PI/reference…"
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30 mb-3"
        />
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {filteredPos.map((po) => {
            const key      = String(po.po_id);
            const idrVal   = poIdrValues[key] ?? (po.currency === 'IDR' ? Number(po.total_value) : 0);
            const selected = selectedIds.includes(key);
            return (
              <label key={key} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors border ${selected ? 'bg-rose-500/10 border-rose-500/30' : 'bg-slate-800/40 border-transparent hover:bg-slate-800/60'}`}>
                <input type="checkbox" checked={selected} onChange={() => togglePo(key)} className="accent-rose-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{po.po_number}</div>
                  {po.pi_number && <div className="text-xs text-slate-400">{po.pi_number}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-semibold text-slate-300">{po.currency} {Number(po.total_value).toLocaleString()}</div>
                  {po.currency !== 'IDR' && idrVal > 0 && <div className="text-[10px] text-slate-500">≈ {fmtIdr(idrVal)}</div>}
                  {po.currency !== 'IDR' && !po.exchange_rate && <div className="text-[10px] text-amber-500">no XR — add to PO</div>}
                </div>
              </label>
            );
          })}
        </div>
        {selectedIds.length > 0 && (
          <p className="text-xs text-rose-300 font-semibold mt-2">
            {selectedIds.length} PO{selectedIds.length > 1 ? 's' : ''} selected · combined IDR value: {fmtIdr(totalIdrValue)}
          </p>
        )}
      </div>

      {/* ── Step 2: Payment details ── */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-5">
          <h4 className="text-sm font-bold text-white mb-4">2 · Payment Details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Payment Type</label>
              <select
                value={costCategory} onChange={(e) => setCostCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              >
                {PRINCIPAL_CATS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Total Amount (IDR)</label>
              <input
                type="number" min="0" step="1000" value={totalAmountStr}
                onChange={(e) => { setTotalAmountStr(e.target.value); setOverrides({}); }}
                placeholder="e.g. 350000000"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Payment Date</label>
              <input
                type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Bank Reference</label>
              <input
                type="text" value={bankRef} onChange={(e) => setBankRef(e.target.value)}
                placeholder="Wire / TT reference number"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Allocation ── */}
      {selectedIds.length > 0 && totalAmount > 0 && (
        <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-5">
          <h4 className="text-sm font-bold text-white mb-0.5">3 · Allocation</h4>
          <p className="text-xs text-slate-500 mb-4">Split is proportional by PO IDR value. Edit any amount to override — the delta indicator shows if totals don&apos;t balance.</p>
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
                        <div className="font-semibold text-white text-xs">{po.po_number}</div>
                        {po.pi_number && <div className="text-[10px] text-slate-500">{po.pi_number}</div>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400">{fmtIdr(poIdrValues[key] ?? 0)}</td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400">{share.toFixed(1)}%</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" step="1000"
                            value={overridden ? overrides[key] : String(allocated)}
                            onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value }))}
                            className={`w-44 px-2 py-1 bg-slate-950 border rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 ${overridden ? 'border-amber-500/60' : 'border-slate-700'}`}
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
                    <span className={`text-sm font-bold ${Math.abs(delta) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
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

      {/* ── Bank fees ── */}
      {selectedIds.length > 0 && totalAmount > 0 && (
        <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-bold text-white">Bank Fees <span className="text-xs text-slate-500 font-normal">(optional)</span></h4>
            <button onClick={addFee} className="px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-semibold rounded-lg transition-colors">
              + Add fee
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">Each fee is split proportionally across all selected POs.</p>

          {fees.length === 0 && (
            <p className="text-xs text-slate-600 italic">No fees added yet.</p>
          )}
          <div className="space-y-3">
            {fees.map((fee) => (
              <div key={fee.uid} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <select
                    value={fee.category} onChange={(e) => updateFee(fee.uid, { category: e.target.value })}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    {BANK_FEE_CATS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input
                    type="number" min="0" step="500" value={fee.amountStr}
                    onChange={(e) => updateFee(fee.uid, { amountStr: e.target.value })}
                    placeholder="Total fee (IDR)"
                    className="w-40 px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none"
                  />
                  <button onClick={() => removeFee(fee.uid)} className="text-xs text-slate-500 hover:text-red-400 ml-auto transition-colors">remove</button>
                </div>
                {parseFloat(fee.amountStr) > 0 && selectedPos.length > 1 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 mt-1">
                    {selectedPos.map((po) => (
                      <div key={String(po.po_id)} className="flex justify-between text-[11px]">
                        <span className="text-slate-500 truncate mr-2">{po.po_number}</span>
                        <span className="text-slate-300">{fmtIdr(feeAllocations[fee.uid]?.[String(po.po_id)] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Submit ── */}
      {selectedIds.length > 0 && totalAmount > 0 && (
        <button
          onClick={handleSubmit} disabled={!canSubmit}
          className="w-full py-3.5 bg-rose-500 hover:bg-rose-400 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm"
        >
          {submitting
            ? 'Saving…'
            : `Submit Batch Payment · ${selectedPos.length} PO${selectedPos.length > 1 ? 's' : ''} · ${fmtIdr(totalAmount)}`}
        </button>
      )}
    </div>
  );
}
