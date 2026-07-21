'use client';
import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';

/**
 * Per-item stock panel, opened from the Catalog's Component Editor.
 * Shows Physical / Reserved / Live (+ moving-avg cost & stock value) and the
 * movement history; roles with canManageStock can Receive in (with landed unit
 * cost, updating the moving average) or Adjust (±). Writes go to the
 * 30.0_stock_movements ledger; the DB trigger maintains 30.1_stock_balances.
 * Desktop: popover anchored at its trigger button. Phones: bottom sheet.
 */

interface Movement { movement_id: string; direction: string; quantity: number; unit_cost_idr: number; source_type: string; moved_at: string; notes: string; created_by_email: string; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
const numOf = (v: unknown): number => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[, ]/g, '')); return isNaN(n) ? 0 : n; };

export default function StockModal({ componentId, componentName, unit, anchor, onClose }: {
  componentId: string;
  componentName: string;
  unit?: string | null;
  /** Trigger-button rect: on desktop the panel pops up anchored to it; null / phones → bottom sheet */
  anchor?: { top: number; bottom: number; left: number; right: number } | null;
  onClose: () => void;
}) {
  const supabase = createSupabaseClient();
  const { profile } = useAuth();
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageStock;

  const [physical, setPhysical] = useState(0);
  const [avgCost, setAvgCost] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const [mode, setMode] = useState<'in' | 'adjust' | null>(null);
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [balRes, sqRes, sqiRes, movRes] = await Promise.all([
      supabase.from('30.1_stock_balances').select('qty_on_hand, avg_cost_idr').eq('component_id', componentId),
      supabase.from('22.0_sales_quotes').select('quote_id, status'),
      supabase.from('22.1_sales_quote_items').select('quote_id, quantity, is_section').eq('component_id', componentId),
      supabase.from('30.0_stock_movements').select('*').eq('component_id', componentId).order('moved_at', { ascending: false }).limit(20),
    ]);
    if (balRes.error || movRes.error) { setSchemaMissing(true); setLoading(false); return; }
    let phys = 0, avg = 0;
    for (const b of (balRes.data ?? []) as { qty_on_hand: number; avg_cost_idr: number }[]) { phys += Number(b.qty_on_hand) || 0; avg = Number(b.avg_cost_idr) || avg; }
    setPhysical(phys);
    setAvgCost(avg);
    const committed = new Set((((sqRes.data ?? []) as { quote_id: string; status: string }[])).filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));
    let rsv = 0;
    for (const it of ((sqiRes.data ?? []) as { quote_id: string; quantity: number; is_section: boolean }[])) {
      if (!it.is_section && committed.has(it.quote_id)) rsv += Number(it.quantity) || 0;
    }
    setReserved(rsv);
    setMovements((movRes.data as Movement[]) ?? []);
    setLoading(false);
  }, [componentId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Phones always get the bottom sheet; desktop pops up in place at the button.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const f = () => setIsPhone(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  const asPopover = !isPhone && !!anchor;
  const popStyle = useMemo<CSSProperties | undefined>(() => {
    if (!asPopover || !anchor) return undefined;
    const W = 400;
    const maxH = Math.min(560, window.innerHeight - 24);
    const left = Math.max(8, Math.min(anchor.left - 40, window.innerWidth - W - 12));
    const spaceBelow = window.innerHeight - anchor.bottom;
    if (spaceBelow >= 340 || spaceBelow >= anchor.top) {
      return { position: 'fixed', top: anchor.bottom + 6, left, width: W, maxHeight: Math.min(maxH, spaceBelow - 12) };
    }
    return { position: 'fixed', bottom: window.innerHeight - anchor.top + 6, left, width: W, maxHeight: Math.min(maxH, anchor.top - 12) };
  }, [asPopover, anchor]);

  const live = physical - reserved;

  async function submit(allowNegative = false) {
    if (!mode) return;
    const q = numOf(qty);
    if (q === 0) { flash('Enter a quantity'); return; }
    setBusy(true);
    const row = {
      component_id: componentId, location: 'MAIN', direction: mode,
      quantity: mode === 'in' ? Math.abs(q) : q, // adjust may be negative
      unit_cost_idr: mode === 'in' ? numOf(cost) : 0,
      source_type: mode === 'in' ? 'receipt' : 'adjustment', source_id: '', notes: note.trim(),
      allow_negative: allowNegative,
    };
    const { error } = await supabase.from('30.0_stock_movements').insert(row);
    setBusy(false);
    if (error) {
      // The DB guard blocks movements that would push on-hand negative —
      // let the user override explicitly (stocktake corrections etc).
      if (!allowNegative && /insufficient stock/i.test(error.message)) {
        if (window.confirm(`${error.message}\n\nPost anyway and allow negative on-hand?`)) { submit(true); return; }
        flash('Blocked — would go negative');
        return;
      }
      flash(`Failed: ${error.message}`);
      return;
    }
    flash(mode === 'in' ? 'Stock received' : 'Stock adjusted');
    setMode(null); setQty(''); setCost(''); setNote('');
    load();
  }

  const dirCls: Record<string, string> = { in: 'text-emerald-400', out: 'text-red-400', adjust: 'text-amber-400' };

  return createPortal(
    <div className={`fixed inset-0 z-[120] ${asPopover ? '' : 'flex items-end sm:items-center justify-center sm:px-4'}`} onClick={onClose}>
      <div className={`absolute inset-0 ${asPopover ? 'bg-black/20' : 'bg-black/60'}`} />
      <div
        style={popStyle}
        className={asPopover
          ? 'overflow-y-auto bg-[#141518] border border-slate-700 rounded-2xl shadow-2xl'
          : 'relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-[#141518] border border-slate-800 sm:rounded-2xl rounded-t-2xl shadow-2xl'}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#141518]/95 backdrop-blur border-b border-slate-800 px-5 py-3.5 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">Stock</h3>
            <p className="text-[11px] text-slate-500 truncate">{componentName}</p>
          </div>
          <button onClick={onClose} className="p-2 -m-2 text-slate-500 hover:text-white transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {schemaMissing ? (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200">
              Inventory tables are not set up yet — run <span className="font-mono">migrations/create_sales_and_inventory.sql</span> in Supabase → SQL Editor.
            </div>
          ) : loading ? (
            <div className="space-y-1.5">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-lg animate-pulse" />)}</div>
          ) : (
            <>
              {/* Physical / Reserved / Live */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Physical', v: physical, cls: 'text-slate-200' },
                  { label: 'Reserved', v: reserved, cls: reserved > 0 ? 'text-amber-300' : 'text-slate-500' },
                  { label: 'Live', v: live, cls: live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-500' : 'text-emerald-300' },
                ].map(({ label, v, cls }) => (
                  <div key={label} className="bg-slate-950/50 border border-slate-800 rounded-xl py-2 px-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600 mb-0.5">{label}</p>
                    <p className={`text-base font-bold tabular-nums ${cls}`}>{fmtInt(v)}{unit ? <span className="text-[10px] text-slate-600 font-normal"> {unit}</span> : null}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 -mt-2">
                Live = Physical − reserved on confirmed orders.
                {avgCost > 0 && <> Avg landed cost <span className="text-slate-400 tabular-nums">{fmtInt(avgCost)}</span> · value <span className="text-slate-400 tabular-nums">{fmtInt(physical * avgCost)}</span> (internal).</>}
              </p>

              {/* Receive / Adjust */}
              {canManage && (
                mode === null ? (
                  <div className="flex gap-2">
                    <button onClick={() => setMode('in')} className="flex-1 px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold transition-colors">Receive in</button>
                    <button onClick={() => setMode('adjust')} className="flex-1 px-3 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors">Adjust (±)</button>
                  </div>
                ) : (
                  <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{mode === 'in' ? 'Receive in' : 'Adjust (use − to reduce)'}</p>
                      <button onClick={() => setMode(null)} className="text-[11px] text-slate-600 hover:text-slate-300 transition-colors">Cancel</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} placeholder={mode === 'in' ? 'Qty received' : 'e.g. -3'} className={sInp} autoFocus />
                      {mode === 'in' && (
                        <input value={cost} inputMode="decimal" onChange={(e) => setCost(e.target.value)} placeholder="Landed cost/unit (IDR)" title="Updates the moving-average cost" className={sInp} />
                      )}
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'in' ? 'PO / GRN reference' : 'Reason'} className={`${sInp} ${mode === 'in' ? 'col-span-2' : ''}`} />
                    </div>
                    <button onClick={() => submit()} disabled={busy}
                      className="w-full px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                      {busy && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
                      Post movement
                    </button>
                  </div>
                )
              )}

              {/* Movement history */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1.5">Recent movements</p>
                {movements.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic">No movements recorded.</p>
                ) : (
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {movements.map((m) => (
                      <div key={m.movement_id} className="flex items-center gap-2.5 px-2.5 py-1.5 text-[11px]">
                        <span className={`font-semibold uppercase w-11 flex-shrink-0 ${dirCls[m.direction] ?? 'text-slate-400'}`}>{m.direction}</span>
                        <span className="tabular-nums text-slate-300 w-14 text-right flex-shrink-0">{m.direction === 'out' ? '−' : ''}{fmtInt(Number(m.quantity))}</span>
                        <span className="text-slate-500 flex-1 truncate">{m.source_type}{m.notes ? ` · ${m.notes}` : ''}</span>
                        {Number(m.unit_cost_idr) > 0 && <span className="tabular-nums text-slate-500 flex-shrink-0">@ {fmtInt(Number(m.unit_cost_idr))}</span>}
                        <span className="text-slate-600 w-16 text-right tabular-nums flex-shrink-0">{fmtDate(m.moved_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {toast && (
          <div className="sticky bottom-3 mx-5 mb-3 px-3 py-2 bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-lg shadow-lg text-center">
            {toast}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const sInp = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';
