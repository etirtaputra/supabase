'use client';
/**
 * ICAPROC — Buy-side: Receive against PO (Goods Receipt)
 * Pick an open PO → confirm received qty per line (prefilled with what's
 * still outstanding) → posts a GRN header (30.2) + 'in' movements (30.0) at
 * landed unit cost. The DB trigger recomputes the moving average; the PO's
 * status advances to Partially/Fully Received and its received date is set.
 *
 * Landed cost prefill per line: when the PO has recorded costs (6.0), spread
 * the non-tax cost pool over line values — same math as computeTUC. Until
 * costs exist, fall back to principal × PO exchange rate. Costs stay editable
 * before posting.
 */
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { TAX_CATS } from '@/constants/costCategories';
import type { PurchaseOrder, PurchaseLineItem, POCost } from '@/types/database';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtRp = (n: number) => 'Rp ' + fmtInt(n);
const fmtDate = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
const numOf = (v: unknown): number => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[, ]/g, '')); return isNaN(n) ? 0 : n; };
const today = () => new Date().toISOString().slice(0, 10);

// PO statuses that can still receive goods
const RECEIVABLE = new Set(['Sent', 'Confirmed', 'Partially Received']);

interface RecLine {
  componentId: string;
  label: string;        // supplier model + description
  unit: string | null;
  ordered: number;
  received: number;     // already in the ledger for this PO
  qty: string;          // receive now (editable)
  cost: string;         // landed unit cost IDR (editable)
  costBasis: 'landed' | 'fx';
}

function ReceivePage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageStock;
  const { data, loading: dataLoading } = useSupabaseData();

  // qty already received per "poId·componentId", from the ledger
  const [receivedMap, setReceivedMap] = useState<Map<string, number>>(new Map());
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const [poId, setPoId] = useState<string>(params.get('po') ?? '');
  const [lines, setLines] = useState<RecLine[]>([]);
  const [recvDate, setRecvDate] = useState(today());
  const [location, setLocation] = useState('MAIN');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null); // GRN number after posting
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  useEffect(() => { document.title = 'Receive PO — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/stock/receive')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canManageStock) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const loadReceived = useCallback(async () => {
    const { data: moves, error } = await supabase.from('30.0_stock_movements')
      .select('component_id, quantity, source_id')
      .eq('source_type', 'receipt').eq('direction', 'in');
    if (error) { setSchemaMissing(true); setLedgerLoaded(true); return; }
    const m = new Map<string, number>();
    for (const r of (moves ?? []) as { component_id: string; quantity: number; source_id: string }[]) {
      if (!r.source_id) continue;
      const k = `${r.source_id}·${r.component_id}`;
      m.set(k, (m.get(k) ?? 0) + (Number(r.quantity) || 0));
    }
    setReceivedMap(m);
    setLedgerLoaded(true);
  }, [supabase]);
  useEffect(() => { if (user) loadReceived(); }, [user, loadReceived]);

  const compById = useMemo(() => new Map(data.components.map((c) => [String(c.component_id), c])), [data.components]);
  const supplierById = useMemo(() => new Map(data.suppliers.map((s) => [String(s.supplier_id), s])), [data.suppliers]);
  const quoteById = useMemo(() => new Map(data.quotes.map((q) => [String(q.quote_id), q])), [data.quotes]);
  const supplierOfPo = useCallback((po: PurchaseOrder) => {
    const sid = po.supplier_id ?? (po.quote_id != null ? quoteById.get(String(po.quote_id))?.supplier_id : null);
    return sid ? supplierById.get(String(sid))?.supplier_name ?? '' : '';
  }, [quoteById, supplierById]);

  const itemsByPo = useMemo(() => {
    const m = new Map<string, PurchaseLineItem[]>();
    for (const i of data.poItems) {
      const k = String(i.po_id);
      (m.get(k) ?? m.set(k, []).get(k)!).push(i);
    }
    return m;
  }, [data.poItems]);
  const costsByPo = useMemo(() => {
    const m = new Map<string, POCost[]>();
    for (const c of data.poCosts) {
      const k = String(c.po_id);
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return m;
  }, [data.poCosts]);

  // Outstanding qty on a PO (ordered − already received, per component, summed)
  const outstandingOf = useCallback((po: PurchaseOrder) => {
    const k = String(po.po_id);
    const byComp = new Map<string, number>();
    for (const li of itemsByPo.get(k) ?? []) {
      if (!li.component_id || li.quantity <= 0) continue;
      byComp.set(li.component_id, (byComp.get(li.component_id) ?? 0) + Number(li.quantity));
    }
    let out = 0;
    for (const [cid, ordered] of byComp) out += Math.max(0, ordered - (receivedMap.get(`${k}·${cid}`) ?? 0));
    return out;
  }, [itemsByPo, receivedMap]);

  // POs that can receive: receivable status, or any outstanding qty left
  const candidates = useMemo(() => {
    return data.pos
      .filter((po) => RECEIVABLE.has(po.status ?? '') || (po.status !== 'Cancelled' && po.status !== 'Replaced' && po.status !== 'Draft' && outstandingOf(po) > 0))
      .sort((a, b) => (b.po_date ?? '').localeCompare(a.po_date ?? ''));
  }, [data.pos, outstandingOf]);

  const selected = useMemo(() => data.pos.find((p) => String(p.po_id) === poId) ?? null, [data.pos, poId]);

  // Landed-cost factor for the selected PO: IDR cost pool ÷ PO line value.
  // Same allocation as computeTUC (taxes excluded), but not gated on settlement —
  // we're receiving now; the moving average refines as costs finalize.
  const landedOf = useCallback((po: PurchaseOrder) => {
    const k = String(po.po_id);
    const fx = Number(po.exchange_rate) || 1;
    const items = itemsByPo.get(k) ?? [];
    const totalValue = items.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
    let pool = 0;
    for (const c of costsByPo.get(k) ?? []) {
      if (TAX_CATS.has(c.cost_category)) continue;
      pool += c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(c.exchange_rate) || fx);
    }
    if (pool > 0 && totalValue > 0) return { factor: pool / totalValue, fx };
    return { factor: null, fx };
  }, [itemsByPo, costsByPo]);

  // Build editable receive lines when a PO is picked (or ledger sums arrive)
  useEffect(() => {
    if (!selected || !ledgerLoaded) { setLines([]); return; }
    const k = String(selected.po_id);
    const { factor, fx } = landedOf(selected);
    // Aggregate PO lines by component (a component can appear on several lines)
    const byComp = new Map<string, { ordered: number; value: number }>();
    for (const li of itemsByPo.get(k) ?? []) {
      if (!li.component_id || li.quantity <= 0) continue;
      const a = byComp.get(li.component_id) ?? { ordered: 0, value: 0 };
      a.ordered += Number(li.quantity);
      a.value += Number(li.unit_cost) * Number(li.quantity);
      byComp.set(li.component_id, a);
    }
    const out: RecLine[] = [];
    for (const [cid, { ordered, value }] of byComp) {
      const c = compById.get(cid);
      const unitCost = ordered > 0 ? value / ordered : 0;
      const landed = factor != null ? unitCost * factor : unitCost * (selected.currency === 'IDR' ? 1 : fx);
      const received = receivedMap.get(`${k}·${cid}`) ?? 0;
      out.push({
        componentId: cid,
        label: c ? `${c.supplier_model}${c.internal_description ? ` — ${c.internal_description}` : ''}` : cid,
        unit: c?.unit ?? null,
        ordered,
        received,
        qty: String(Math.max(0, ordered - received)),
        cost: String(Math.round(landed)),
        costBasis: factor != null ? 'landed' : 'fx',
      });
    }
    setLines(out);
    setPosted(null);
  }, [selected, ledgerLoaded, receivedMap, itemsByPo, compById, landedOf]);

  const setLine = (i: number, patch: Partial<RecLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const receiveNowTotal = lines.reduce((s, l) => s + numOf(l.qty), 0);
  const receiveValue = lines.reduce((s, l) => s + numOf(l.qty) * numOf(l.cost), 0);

  async function post() {
    if (!selected) return;
    const active = lines.filter((l) => numOf(l.qty) > 0);
    if (active.length === 0) { flash('Nothing to receive — enter a quantity'); return; }
    setBusy(true);
    const k = String(selected.po_id);
    // 1) GRN header (trigger stamps GRN-YYYYMMDD-NNNN)
    const { data: grn, error: grnErr } = await supabase.from('30.2_goods_receipts')
      .insert({ po_id: selected.po_id, location, received_at: `${recvDate}T12:00:00`, notes: notes.trim() })
      .select('grn_id, grn_number').single();
    if (grnErr || !grn) {
      setBusy(false);
      flash(`GRN failed: ${grnErr?.message ?? 'unknown error'}`);
      return;
    }
    // 2) 'in' movements at landed cost — the trigger updates 30.1 moving average
    const moves = active.map((l) => ({
      component_id: l.componentId, location, direction: 'in',
      quantity: numOf(l.qty), unit_cost_idr: Math.round(numOf(l.cost)),
      source_type: 'receipt', source_id: k, grn_id: grn.grn_id,
      moved_at: `${recvDate}T12:00:00`,
      notes: `${grn.grn_number} · PO ${selected.po_number || k}`,
    }));
    const { error: movErr } = await supabase.from('30.0_stock_movements').insert(moves);
    if (movErr) { setBusy(false); flash(`Movements failed: ${movErr.message}`); return; }
    // 3) advance the PO: fully or partially received + received date
    const fully = lines.every((l) => l.received + numOf(l.qty) >= l.ordered - 1e-9);
    const patch: Record<string, unknown> = { status: fully ? 'Fully Received' : 'Partially Received' };
    if (fully && !selected.actual_received_date) patch.actual_received_date = recvDate;
    const { error: poErr } = await supabase.from('5.0_purchases').update(patch).eq('po_id', selected.po_id);
    setBusy(false);
    if (poErr) flash(`Stock received (${grn.grn_number}), but PO update failed: ${poErr.message}`);
    else flash(`${grn.grn_number} posted — PO ${fully ? 'fully' : 'partially'} received`);
    setPosted(grn.grn_number);
    loadReceived(); // refresh outstanding numbers
  }

  if (authLoading || !profile || !canManage) {
    return (
      <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1100px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/stock" className="text-slate-500 hover:text-white transition-colors flex-shrink-0" title="Back to Stock">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-extrabold text-white truncate">Receive against PO</h1>
              <p className="text-[11px] text-slate-500">Goods receipt → stock in at landed cost</p>
            </div>
          </div>
          {selected && (
            <button onClick={() => { setPoId(''); router.replace('/stock/receive'); }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold whitespace-nowrap transition-colors">
              Change PO
            </button>
          )}
        </div>
      </div>

      <main className="max-w-[1100px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {schemaMissing && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
            <span className="text-amber-300 font-semibold">Goods-receipt tables are behind the app.</span>
            <span className="text-amber-200/80 text-xs ml-2">Run <span className="font-mono">migrations/create_goods_receipts.sql</span> in Supabase → SQL Editor.</span>
          </div>
        )}

        {!selected ? (
          <>
            <p className="text-[12px] text-slate-500">Pick the purchase order the goods arrived against. Only POs with something left to receive are listed.</p>
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
              <div className="hidden md:grid grid-cols-[150px_1fr_110px_130px_110px_110px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                <span>PO</span><span>Supplier</span><span>Date</span><span>Status</span><span className="text-right">Ordered</span><span className="text-right">Outstanding</span>
              </div>
              {(dataLoading || !ledgerLoaded) ? (
                <div className="p-4 space-y-1.5">{[...Array(5)].map((_, i) => <div key={i} className="h-11 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
              ) : candidates.length === 0 ? (
                <div className="px-4 py-12 text-center text-slate-600 text-sm">No open POs to receive — everything ordered has arrived.</div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {candidates.map((po) => {
                    const k = String(po.po_id);
                    const ordered = (itemsByPo.get(k) ?? []).reduce((s, i) => s + Number(i.quantity), 0);
                    const out = outstandingOf(po);
                    return (
                      <button key={k} onClick={() => setPoId(k)} className="w-full text-left hover:bg-white/[0.03] transition-colors">
                        <div className="hidden md:grid grid-cols-[150px_1fr_110px_130px_110px_110px] gap-3 px-4 py-2.5 items-center">
                          <span className="text-sky-300 font-semibold truncate">{po.po_number || k}</span>
                          <span className="text-slate-300 truncate">{supplierOfPo(po) || '—'}</span>
                          <span className="text-[11px] text-slate-500">{fmtDate(po.po_date)}</span>
                          <span className="text-[11px] text-slate-400">{po.status ?? '—'}</span>
                          <span className="text-right tabular-nums text-slate-300">{fmtInt(ordered)}</span>
                          <span className={`text-right tabular-nums font-semibold ${out > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{fmtInt(out)}</span>
                        </div>
                        <div className="md:hidden px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sky-300 font-semibold truncate">{po.po_number || k}</span>
                            <span className={`tabular-nums text-[11px] font-semibold ${out > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{fmtInt(out)} left</span>
                          </div>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">{supplierOfPo(po) || '—'} · {fmtDate(po.po_date)} · {po.status ?? ''}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Selected PO header */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5 flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">PO</p>
                <p className="text-base font-bold text-sky-300">{selected.po_number || String(selected.po_id)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Supplier</p>
                <p className="text-slate-200 truncate">{supplierOfPo(selected) || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Status</p>
                <p className="text-slate-300">{selected.status ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Currency</p>
                <p className="text-slate-300">{selected.currency}{selected.currency !== 'IDR' && selected.exchange_rate ? ` @ ${fmtInt(Number(selected.exchange_rate))}` : ''}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Cost basis</p>
                <p className={lines[0]?.costBasis === 'landed' ? 'text-emerald-300' : 'text-amber-300'}>
                  {lines[0]?.costBasis === 'landed' ? 'Landed (principal + fees)' : 'Principal × FX — no costs recorded yet'}
                </p>
              </div>
            </div>

            {/* Receive details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 block mb-1">Received date</span>
                <input type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} className={inp} />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 block mb-1">Location</span>
                <input value={location} onChange={(e) => setLocation(e.target.value.toUpperCase() || 'MAIN')} className={inp} />
              </label>
              <label className="block col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 block mb-1">Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Surat Jalan ref, container no…" className={inp} />
              </label>
            </div>

            {/* Lines */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
              <div className="hidden md:grid grid-cols-[1fr_90px_90px_90px_120px_140px_130px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                <span>Item</span><span className="text-right">Ordered</span><span className="text-right">Received</span><span className="text-right">Left</span>
                <span className="text-right">Receive now</span><span className="text-right">Landed cost/unit</span><span className="text-right">Line value</span>
              </div>
              {lines.length === 0 ? (
                <div className="px-4 py-10 text-center text-slate-600 text-sm">This PO has no component lines.</div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {lines.map((l, i) => {
                    const left = Math.max(0, l.ordered - l.received);
                    const over = numOf(l.qty) > left;
                    return (
                      <div key={l.componentId} className="px-4 py-2.5">
                        <div className="md:grid md:grid-cols-[1fr_90px_90px_90px_120px_140px_130px] md:gap-3 md:items-center space-y-1.5 md:space-y-0">
                          <span className="block text-slate-100 truncate">{l.label}</span>
                          <span className="hidden md:block text-right tabular-nums text-slate-400">{fmtInt(l.ordered)}{l.unit && <span className="text-[10px] text-slate-600"> {l.unit}</span>}</span>
                          <span className="hidden md:block text-right tabular-nums text-slate-500">{fmtInt(l.received)}</span>
                          <span className={`hidden md:block text-right tabular-nums font-semibold ${left > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{fmtInt(left)}</span>
                          <span className="flex md:hidden items-center gap-3 text-[11px] text-slate-500">
                            Ordered {fmtInt(l.ordered)} · received {fmtInt(l.received)} · left <span className={left > 0 ? 'text-amber-300 font-semibold' : ''}>{fmtInt(left)}</span>
                          </span>
                          <span className="flex md:block gap-2">
                            <input value={l.qty} inputMode="decimal" onChange={(e) => setLine(i, { qty: e.target.value })}
                              className={`${inp} text-right ${over ? 'border-amber-500/60' : ''}`} placeholder="0" />
                          </span>
                          <span className="flex md:block gap-2">
                            <input value={l.cost} inputMode="decimal" onChange={(e) => setLine(i, { cost: e.target.value })}
                              className={`${inp} text-right`} placeholder="IDR/unit" title="Landed unit cost (IDR) — feeds the moving average" />
                          </span>
                          <span className="block text-right tabular-nums text-slate-200 font-medium">{numOf(l.qty) > 0 ? fmtRp(numOf(l.qty) * numOf(l.cost)) : '—'}</span>
                        </div>
                        {over && <p className="text-[10px] text-amber-400 mt-1 md:text-right">Receiving more than outstanding ({fmtInt(left)}) — over-receipt will be recorded as-is.</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Post bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-[12px] text-slate-500">
                Receiving <span className="text-slate-200 font-semibold tabular-nums">{fmtInt(receiveNowTotal)}</span> units ·
                stock value in <span className="text-sky-300 font-semibold tabular-nums"> {fmtRp(receiveValue)}</span>
              </p>
              <div className="flex items-center gap-2">
                {posted && (
                  <Link href="/stock" className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors">
                    Done — view stock
                  </Link>
                )}
                <button onClick={post} disabled={busy || receiveNowTotal <= 0}
                  className="px-5 py-2.5 rounded-xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 text-xs font-bold transition-colors disabled:opacity-40 flex items-center gap-2">
                  {busy && <span className="w-3.5 h-3.5 border-2 border-sky-500/30 border-t-sky-400 rounded-full animate-spin" />}
                  Post goods receipt
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[130] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-xl shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

const inp = 'w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-sky-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

export default function ReceivePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f1012]" />}>
      <ReceivePage />
    </Suspense>
  );
}
