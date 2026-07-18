/**
 * ICAPROC — Inventory: Stock
 * Physical (warehouse on-hand) vs Live (Physical − Reserved-by-orders).
 * Owner/data_entry can receive & adjust stock; everyone signed in can view.
 */
'use client';
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SalesMigrationBanner from '@/components/ui/SalesMigrationBanner';

interface Comp { component_id: string; supplier_model: string; brand: string | null; category: string | null; unit: string | null; }
interface Balance { component_id: string; qty_on_hand: number; avg_cost_idr: number; }
interface Movement { movement_id: string; component_id: string; direction: string; quantity: number; unit_cost_idr: number; source_type: string; source_id: string; moved_at: string; notes: string; created_by_email: string; }

const COMMITTED = new Set(['ordered', 'invoiced']);
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
const numOf = (v: unknown): number => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[, ]/g, '')); return isNaN(n) ? 0 : n; };

export default function StockPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageStock;

  const [comps, setComps] = useState<Comp[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Movement[]>([]);
  const [modalComp, setModalComp] = useState<Comp | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  useEffect(() => { document.title = 'Stock — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent('/stock')}`);
  }, [authLoading, user, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [compRes, balRes, qRes, iRes] = await Promise.all([
      supabase.from('3.0_components').select('component_id, supplier_model, brand, category, unit').order('supplier_model').limit(2000),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand, avg_cost_idr'),
      supabase.from('22.0_sales_quotes').select('quote_id, status'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity'),
    ]);
    setComps((compRes.data as Comp[]) ?? []);
    const bal: Record<string, Balance> = {};
    for (const b of (balRes.data as Balance[]) ?? []) bal[b.component_id] = b;
    setBalances(bal);
    const committedQuotes = new Set(((qRes.data as { quote_id: string; status: string }[]) ?? []).filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));
    const res: Record<string, number> = {};
    for (const it of (iRes.data as { quote_id: string; component_id: string | null; quantity: number }[]) ?? []) {
      if (it.component_id && committedQuotes.has(it.quote_id)) res[it.component_id] = (res[it.component_id] ?? 0) + (Number(it.quantity) || 0);
    }
    setReserved(res);
    setLoading(false);
  }, []);

  useEffect(() => { if (user) fetchAll(); }, [user, fetchAll]);

  async function loadHistory(componentId: string) {
    if (expanded === componentId) { setExpanded(null); return; }
    setExpanded(componentId);
    setHistory([]);
    const { data } = await supabase.from('30.0_stock_movements').select('*').eq('component_id', componentId).order('moved_at', { ascending: false }).limit(50);
    setHistory((data as Movement[]) ?? []);
  }

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = s ? comps.filter((c) => `${c.supplier_model} ${c.brand ?? ''} ${c.category ?? ''}`.toLowerCase().includes(s)) : comps;
    return list.map((c) => {
      const phys = balances[c.component_id]?.qty_on_hand ?? 0;
      const rsv = reserved[c.component_id] ?? 0;
      const avg = balances[c.component_id]?.avg_cost_idr ?? 0;
      return { c, phys: Number(phys), rsv, live: Number(phys) - rsv, avg: Number(avg) };
    });
  }, [comps, balances, reserved, search]);

  const totalValue = useMemo(() => rows.reduce((s, r) => s + r.phys * r.avg, 0), [rows]);

  if (authLoading || !user) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Inventory · Stock" />
          <span className="text-[11px] text-slate-500">Total stock value <span className="text-slate-300 font-semibold tabular-nums">IDR {fmtInt(totalValue)}</span></span>
        </div>
      </div>

      <main className="max-w-[1300px] mx-auto px-4 md:px-8 py-6 space-y-5">
        <SalesMigrationBanner />
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <p className="text-[11px] text-slate-600 max-w-md">
            <span className="text-slate-400">Physical</span> = in warehouse. <span className="text-slate-400">Live</span> = Physical − Reserved (qty on open orders). Reserved releases when an order is cancelled.
          </p>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2.5">Item</th>
                <th className="text-right font-semibold px-3 py-2.5">Physical</th>
                <th className="text-right font-semibold px-3 py-2.5">Reserved</th>
                <th className="text-right font-semibold px-3 py-2.5">Live</th>
                <th className="text-right font-semibold px-3 py-2.5">Avg cost</th>
                <th className="text-right font-semibold px-3 py-2.5">Value</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                [...Array(6)].map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-2"><div className="h-9 bg-slate-800/40 rounded-lg animate-pulse" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-600 text-sm">No items.</td></tr>
              ) : rows.map(({ c, phys, rsv, live, avg }) => (
                <Fragment key={c.component_id}>
                  <tr className="hover:bg-slate-800/20">
                    <td className="px-4 py-2">
                      <button onClick={() => loadHistory(c.component_id)} className="text-left">
                        <span className="block text-sm text-slate-100 font-medium truncate max-w-[260px]">{c.supplier_model || '(no model)'}</span>
                        <span className="block text-[11px] text-slate-500 truncate max-w-[260px]">{[c.brand, c.category].filter(Boolean).join(' · ') || '—'}{c.unit ? ` · ${c.unit}` : ''}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">{fmtInt(phys)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-300/80">{rsv ? fmtInt(rsv) : <span className="text-slate-700">0</span>}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-500' : 'text-emerald-300'}`}>{fmtInt(live)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[11px] text-slate-500">{avg ? fmtInt(avg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[11px] text-slate-400">{fmtInt(phys * avg)}</td>
                    <td className="px-3 py-2 text-right">
                      {canManage && <button onClick={() => setModalComp(c)} className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold transition-colors whitespace-nowrap">Receive / Adjust</button>}
                    </td>
                  </tr>
                  {expanded === c.component_id && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-3 pt-0 bg-slate-950/40">
                        <MovementHistory history={history} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {modalComp && (
        <StockModal comp={modalComp} onClose={() => setModalComp(null)} onDone={() => { setModalComp(null); fetchAll(); if (expanded) { const id = expanded; setExpanded(null); setTimeout(() => loadHistory(id), 0); } }} flash={flash} />
      )}
      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{toast}</div>}
    </div>
  );
}

function MovementHistory({ history }: { history: Movement[] }) {
  if (history.length === 0) return <p className="text-[11px] text-slate-600 py-2">No movements recorded.</p>;
  const dirCls: Record<string, string> = { in: 'text-emerald-400', out: 'text-red-400', adjust: 'text-amber-400' };
  return (
    <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60 mt-1">
      {history.map((m) => (
        <div key={m.movement_id} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
          <span className={`font-semibold uppercase w-12 ${dirCls[m.direction] ?? 'text-slate-400'}`}>{m.direction}</span>
          <span className="tabular-nums text-slate-300 w-16 text-right">{m.direction === 'out' ? '−' : ''}{fmtInt(Number(m.quantity))}</span>
          <span className="text-slate-500 flex-1 truncate">{m.source_type}{m.notes ? ` · ${m.notes}` : ''}</span>
          {Number(m.unit_cost_idr) > 0 && <span className="tabular-nums text-slate-500">@ {fmtInt(Number(m.unit_cost_idr))}</span>}
          <span className="text-slate-600 w-16 text-right">{fmtDate(m.moved_at)}</span>
        </div>
      ))}
    </div>
  );
}

function StockModal({ comp, onClose, onDone, flash }: { comp: Comp; onClose: () => void; onDone: () => void; flash: (m: string) => void }) {
  const supabase = createSupabaseClient();
  const [mode, setMode] = useState<'in' | 'adjust'>('in');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const q = numOf(qty);
    if (q === 0) { flash('Enter a quantity'); return; }
    setBusy(true);
    const row = {
      component_id: comp.component_id, location: 'MAIN', direction: mode,
      quantity: mode === 'in' ? Math.abs(q) : q, // adjust may be negative
      unit_cost_idr: mode === 'in' ? numOf(cost) : 0,
      source_type: mode === 'in' ? 'receipt' : 'adjustment', source_id: '', notes: notes.trim(),
    };
    const { error } = await supabase.from('30.0_stock_movements').insert(row);
    setBusy(false);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash(mode === 'in' ? 'Stock received' : 'Stock adjusted');
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-md bg-[#141518] border border-slate-800 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-white mb-1">Stock movement</h3>
        <p className="text-[11px] text-slate-500 mb-4 truncate">{comp.supplier_model}</p>

        <div className="flex gap-0.5 p-0.5 bg-slate-800/60 border border-slate-700/60 rounded-xl mb-4">
          {([['in', 'Receive in'], ['adjust', 'Adjust (+/−)']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === m ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">{mode === 'in' ? 'Quantity received' : 'Adjustment (use − to reduce)'}</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder={mode === 'in' ? 'e.g. 50' : 'e.g. -3'} className={mInp} />
          </div>
          {mode === 'in' && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Landed unit cost (IDR) — updates moving average</label>
              <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 1,250,000" className={mInp} />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Note</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={mode === 'in' ? 'PO / GRN reference' : 'Reason for adjustment'} className={mInp} />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
            Post movement
          </button>
        </div>
      </div>
    </div>
  );
}

const mInp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';

function CenterSpinner() {
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}
