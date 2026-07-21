'use client';
/**
 * ICAPROC — Buy-side: Stock
 * The warehouse truth screen: on-hand per item at moving-average landed cost.
 *  - Summary strip: SKUs in stock, total stock value, negative-stock warnings.
 *  - Table: item, brand, category, on-hand, avg landed cost, stock value,
 *    last movement. Click a row to drill into its movement history (and
 *    receive/adjust from there).
 *  - "Receive against PO" (canManageStock) → /stock/receive.
 * Gated to buy-side roles — avg cost / stock value are buy-side sensitive.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import StockModal from '@/components/ui/StockModal';
import { formatCategory as humanize } from '@/lib/formatCategory';

interface Comp { component_id: string; supplier_model: string; internal_description: string | null; brand: string | null; category: string | null; unit: string | null; }
interface Balance { component_id: string; location: string; qty_on_hand: number; avg_cost_idr: number; updated_at: string | null; }
interface LastMove { direction: string; source_type: string; moved_at: string; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtRp = (n: number) => 'Rp ' + fmtInt(n);
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

type SortKey = 'value' | 'qty' | 'item' | 'moved';

interface Row { c: Comp; loc: string; qty: number; avg: number; value: number; last: LastMove | null; }

export default function StockPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].buySide;
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageStock;

  const [comps, setComps] = useState<Map<string, Comp>>(new Map());
  const [balances, setBalances] = useState<Balance[]>([]);
  const [lastByComp, setLastByComp] = useState<Map<string, LastMove>>(new Map());
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [stockOnly, setStockOnly] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const [drill, setDrill] = useState<Comp | null>(null);

  useEffect(() => { document.title = 'Stock — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/stock')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].buySide) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const fetchAllComponents = async () => {
      const PAGE = 1000;
      let all: Comp[] = [];
      let from = 0;
      for (;;) {
        const { data: page } = await supabase.from('3.0_components')
          .select('component_id, supplier_model, internal_description, brand, category, unit')
          .order('supplier_model').range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        all = all.concat(page as unknown as Comp[]);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [allComps, balRes, movRes] = await Promise.all([
      fetchAllComponents(),
      supabase.from('30.1_stock_balances').select('component_id, location, qty_on_hand, avg_cost_idr, updated_at'),
      supabase.from('30.0_stock_movements').select('component_id, direction, source_type, moved_at').order('moved_at', { ascending: false }).limit(2000),
    ]);
    if (balRes.error || movRes.error) { setSchemaMissing(true); setLoading(false); return; }
    setComps(new Map(allComps.map((c) => [c.component_id, c])));
    setBalances((balRes.data ?? []) as Balance[]);
    const last = new Map<string, LastMove>();
    for (const m of (movRes.data ?? []) as ({ component_id: string } & LastMove)[]) {
      if (!last.has(m.component_id)) last.set(m.component_id, m);
    }
    setLastByComp(last);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (user) load(); }, [user, load]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const b of balances) {
      const c = comps.get(b.component_id);
      if (!c) continue;
      const qty = Number(b.qty_on_hand) || 0;
      const avg = Number(b.avg_cost_idr) || 0;
      out.push({ c, loc: b.location, qty, avg, value: qty * avg, last: lastByComp.get(b.component_id) ?? null });
    }
    return out;
  }, [balances, comps, lastByComp]);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.c.category).filter(Boolean))).sort() as string[], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (stockOnly) list = list.filter((r) => r.qty !== 0);
    if (filterCategory) list = list.filter((r) => r.c.category === filterCategory);
    if (q) list = list.filter((r) => [r.c.supplier_model, r.c.internal_description, r.c.brand, r.c.category].filter(Boolean).join(' ').toLowerCase().includes(q));
    const dir = sort.dir;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case 'qty': return dir * (a.qty - b.qty);
        case 'item': return dir * a.c.supplier_model.localeCompare(b.c.supplier_model);
        case 'moved': return dir * ((a.last?.moved_at ?? '').localeCompare(b.last?.moved_at ?? ''));
        default: return dir * (a.value - b.value);
      }
    });
  }, [rows, search, filterCategory, stockOnly, sort]);

  const totals = useMemo(() => {
    const inStock = rows.filter((r) => r.qty > 0);
    return {
      skus: new Set(inStock.map((r) => r.c.component_id)).size,
      value: inStock.reduce((s, r) => s + r.value, 0),
      negatives: rows.filter((r) => r.qty < 0).length,
    };
  }, [rows]);

  const clickSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'item' ? 1 : -1 }));
  const arrow = (key: SortKey) => sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '';

  if (authLoading || !profile || !canView) {
    return (
      <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1560px] mx-auto px-3 sm:px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Stock · Warehouse" />
          {canManage && (
            <Link href="/stock/receive"
              className="px-3.5 py-2 rounded-xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 text-xs font-semibold whitespace-nowrap transition-colors">
              Receive against PO
            </Link>
          )}
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1560px] mx-auto px-3 sm:px-4 md:px-8 py-6 space-y-5">
        {schemaMissing && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
            <span className="text-amber-300 font-semibold">Inventory tables are behind the app.</span>
            <span className="text-amber-200/80 text-xs ml-2">
              Run <span className="font-mono">migrations/create_sales_and_inventory.sql</span> then{' '}
              <span className="font-mono">migrations/create_goods_receipts.sql</span> in Supabase → SQL Editor.
            </span>
          </div>
        )}

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {[
            { label: 'SKUs in stock', v: fmtInt(totals.skus), cls: 'text-slate-100' },
            { label: 'Stock value (avg landed)', v: fmtRp(totals.value), cls: 'text-sky-300' },
            { label: 'Negative on-hand', v: fmtInt(totals.negatives), cls: totals.negatives > 0 ? 'text-red-400' : 'text-slate-500' },
          ].map(({ label, v, cls }) => (
            <div key={label} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1">{label}</p>
              <p className={`text-lg font-bold tabular-nums ${cls}`}>{v}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, brand, category…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-sky-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <div className="flex gap-2">
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
              className="h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-sky-500/60 outline-none text-slate-300 text-xs">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </select>
            <button onClick={() => setStockOnly((v) => !v)}
              className={`h-11 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors border ${
                stockOnly ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : 'bg-slate-900/80 text-slate-400 border-slate-700/80'
              }`}>
              In stock only
            </button>
          </div>
        </div>

        {/* Table (md+) / cards (mobile) */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_110px_120px_110px_130px_140px_130px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <button onClick={() => clickSort('item')} className="text-left hover:text-slate-300 transition-colors uppercase tracking-widest">Item{arrow('item')}</button>
            <span>Brand</span>
            <span>Category</span>
            <button onClick={() => clickSort('qty')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest">On hand{arrow('qty')}</button>
            <span className="text-right">Avg cost</span>
            <button onClick={() => clickSort('value')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest">Value{arrow('value')}</button>
            <button onClick={() => clickSort('moved')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest">Last move{arrow('moved')}</button>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(8)].map((_, i) => <div key={i} className="h-11 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">
              {rows.length === 0 ? 'No stock recorded yet — receive a PO to get started.' : 'No matches.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((r) => (
                <button key={`${r.c.component_id}·${r.loc}`} onClick={() => setDrill(r.c)}
                  className="w-full text-left hover:bg-white/[0.03] transition-colors">
                  {/* Desktop row */}
                  <div className="hidden md:grid grid-cols-[1fr_110px_120px_110px_130px_140px_130px] gap-3 px-4 py-2.5 items-center">
                    <span className="min-w-0">
                      <span className="block text-slate-100 font-medium truncate">{r.c.supplier_model}</span>
                      {r.c.internal_description && <span className="block text-[11px] text-slate-500 truncate">{r.c.internal_description}</span>}
                      {r.loc !== 'MAIN' && <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{r.loc}</span>}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">{r.c.brand ?? '—'}</span>
                    <span className="text-[11px] text-slate-500 truncate">{r.c.category ? humanize(r.c.category) : '—'}</span>
                    <span className={`text-right tabular-nums font-semibold ${r.qty < 0 ? 'text-red-400' : r.qty === 0 ? 'text-slate-600' : 'text-slate-100'}`}>
                      {fmtInt(r.qty)}{r.c.unit && <span className="text-[10px] text-slate-600 font-normal"> {r.c.unit}</span>}
                    </span>
                    <span className="text-right tabular-nums text-slate-400">{r.avg > 0 ? fmtInt(r.avg) : '—'}</span>
                    <span className="text-right tabular-nums text-slate-200 font-medium">{r.value !== 0 ? fmtRp(r.value) : '—'}</span>
                    <span className="text-right text-[11px] text-slate-500">
                      {r.last ? (
                        <>
                          <span className={`font-semibold uppercase mr-1 ${r.last.direction === 'in' ? 'text-emerald-400' : r.last.direction === 'out' ? 'text-red-400' : 'text-amber-400'}`}>{r.last.direction}</span>
                          {fmtDate(r.last.moved_at)}
                        </>
                      ) : '—'}
                    </span>
                  </div>
                  {/* Mobile card */}
                  <div className="md:hidden px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-slate-100 font-medium truncate">{r.c.supplier_model}</span>
                        {r.c.internal_description && <span className="block text-[11px] text-slate-500 truncate">{r.c.internal_description}</span>}
                      </span>
                      <span className={`tabular-nums font-bold whitespace-nowrap ${r.qty < 0 ? 'text-red-400' : 'text-slate-100'}`}>
                        {fmtInt(r.qty)}{r.c.unit && <span className="text-[10px] text-slate-600 font-normal"> {r.c.unit}</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                      <span>{r.avg > 0 ? `@ ${fmtInt(r.avg)} · ${fmtRp(r.value)}` : '—'}</span>
                      <span>{r.last ? `${r.last.direction} · ${fmtDate(r.last.moved_at)}` : ''}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-600">
          Valuation = moving-average landed cost per item (updated on every receipt). Click a row for its movement ledger.
        </p>
      </main>

      {drill && (
        <StockModal
          componentId={drill.component_id}
          componentName={drill.internal_description || drill.supplier_model}
          unit={drill.unit}
          anchor={null}
          onClose={() => { setDrill(null); load(); }}
        />
      )}
    </div>
  );
}
