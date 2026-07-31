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
import { fetchWarehouses, warehouseLabel, type Warehouse } from '@/lib/warehouses';
import { COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';
import { fetchDeliveredByQuoteComp } from '@/lib/reservedStock';
import { fmtDay, fmtInt, fmtRupiah, fmtRupiahShort } from '@/lib/formatters';

/** An order line still waiting on stock — what the shortage is FOR. */
interface DemandRef { quote_id: string; number: string; customer: string; qty: number; date: string }
interface Shortage { c: Comp; physical: number; reserved: number; short: number; orders: DemandRef[] }

interface Comp { component_id: string; supplier_model: string; internal_description: string | null; brand: string | null; category: string | null; unit: string | null; }
interface Balance { component_id: string; location: string; qty_on_hand: number; avg_cost_idr: number; updated_at: string | null; }
interface LastMove { direction: string; source_type: string; moved_at: string; }


type SortKey = 'value' | 'qty' | 'item' | 'moved';

interface Row { c: Comp; loc: string; qty: number; avg: number; value: number; last: LastMove | null; }

export default function StockPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].buySide;
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManageStock;
  const isOwner = !!profile && ROLE_PERMISSIONS[profile.role].canManageUsers;   // owner — Settings
  // Item hub links only for roles that can open it (Analytics is owner-only)
  const canHub = !!profile && ROLE_PERMISSIONS[profile.role].canViewAnalytics;

  const [comps, setComps] = useState<Map<string, Comp>>(new Map());
  const [balances, setBalances] = useState<Balance[]>([]);
  const [lastByComp, setLastByComp] = useState<Map<string, LastMove>>(new Map());
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [filterWh, setFilterWh] = useState('');          // '' = all warehouses
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [transfer, setTransfer] = useState<{ c: Comp; from: string; available: number } | null>(null);
  const [toast, setToast] = useState('');
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
    const [allComps, balRes, movRes, whs, sqRes, sqiRes, custRes, deliveredMap] = await Promise.all([
      fetchAllComponents(),
      supabase.from('30.1_stock_balances').select('component_id, location, qty_on_hand, avg_cost_idr, updated_at'),
      supabase.from('30.0_stock_movements').select('component_id, direction, source_type, moved_at').order('moved_at', { ascending: false }).limit(2000),
      fetchWarehouses(supabase),
      supabase.from('22.0_sales_quotes').select('quote_id, status, order_number, quote_number, ordered_at, updated_at, customer_id'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section'),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      fetchDeliveredByQuoteComp(supabase),
    ]);
    setWarehouses(whs);
    if (balRes.error || movRes.error) { setSchemaMissing(true); setLoading(false); return; }
    setComps(new Map(allComps.map((c) => [c.component_id, c])));
    setBalances((balRes.data ?? []) as Balance[]);
    const last = new Map<string, LastMove>();
    for (const m of (movRes.data ?? []) as ({ component_id: string } & LastMove)[]) {
      if (!last.has(m.component_id)) last.set(m.component_id, m);
    }
    setLastByComp(last);

    // ── Shortages: committed demand that stock cannot cover ────────────────
    // reserved = ordered qty on committed orders MINUS what has already been
    // delivered; physical = on-hand summed across every warehouse. A negative
    // live figure is a genuine shortage — and we keep the specific orders so
    // the buyer knows what to restock and who is waiting.
    const custName = new Map(((custRes.data ?? []) as { customer_id: string; display_name: string; legal_name: string }[])
      .map((c) => [c.customer_id, c.display_name || c.legal_name || '']));
    const docs = ((sqRes.data ?? []) as { quote_id: string; status: string; order_number: string | null; quote_number: string; ordered_at: string | null; updated_at: string | null; customer_id: string | null }[]);
    const committed = new Map(docs.filter((d) => COMMITTED.has(d.status)).map((d) => [d.quote_id, d]));
    const physByComp = new Map<string, number>();
    for (const b of (balRes.data ?? []) as Balance[]) {
      physByComp.set(b.component_id, (physByComp.get(b.component_id) ?? 0) + (Number(b.qty_on_hand) || 0));
    }
    const demand = new Map<string, { qty: number; orders: DemandRef[] }>();
    for (const it of ((sqiRes.data ?? []) as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[])) {
      if (!it.component_id || it.is_section) continue;
      const doc = committed.get(it.quote_id);
      if (!doc) continue;
      const outstanding = (Number(it.quantity) || 0) - (deliveredMap.get(`${it.quote_id}·${it.component_id}`) ?? 0);
      if (outstanding <= 0) continue;
      const e = demand.get(it.component_id) ?? { qty: 0, orders: [] };
      e.qty += outstanding;
      e.orders.push({
        quote_id: doc.quote_id,
        number: doc.order_number || doc.quote_number,
        customer: custName.get(doc.customer_id ?? '') ?? '',
        qty: outstanding,
        date: doc.ordered_at ?? doc.updated_at ?? '',
      });
      demand.set(it.component_id, e);
    }
    const shortList: Shortage[] = [];
    for (const [cid, d] of demand) {
      const c = allComps.find((x) => x.component_id === cid);
      if (!c) continue;
      const physical = physByComp.get(cid) ?? 0;
      const short = d.qty - physical;
      if (short > 0.0001) {
        shortList.push({ c, physical, reserved: d.qty, short,
          orders: d.orders.sort((a, b) => (a.date || '').localeCompare(b.date || '')) });
      }
    }
    setShortages(shortList.sort((a, b) => b.short - a.short));
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
    if (filterWh) list = list.filter((r) => r.loc === filterWh);
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
  }, [rows, search, filterCategory, filterWh, stockOnly, sort]);

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
      <div className="min-h-screen bg-chrome flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row. Side-by-side, two nowrap
            buttons overflowed the row and printed on top of the wordmark. */}
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Stock · Warehouse" />
          <div className="flex items-center gap-2 flex-wrap">
          {canManage && (
            <Link href="/stock/receive"
              className="px-3.5 py-2 rounded-xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 text-xs font-semibold whitespace-nowrap transition-colors">
              Receive against PO
            </Link>
          )}
          {isOwner && (
            <Link href="/settings?tab=defaults"
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              title="The default warehouse — the one preselected when receiving, adjusting or shipping — is set in Settings">
              Default warehouse: Settings →
            </Link>
          )}
          </div>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {schemaMissing && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm">
            <span className="text-amber-300 font-semibold">Inventory tables are behind the app.</span>
            <span className="text-amber-200/80 text-xs ml-2">
              Run <span className="font-mono">migrations/create_sales_and_inventory.sql</span> then{' '}
              <span className="font-mono">migrations/create_goods_receipts.sql</span> in Supabase → SQL Editor.
            </span>
          </div>
        )}

        {/* Shortages — committed demand stock cannot cover, and who is waiting */}
        {shortages.length > 0 && (
          <div className="bg-red-500/[0.06] border border-red-500/30 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-red-300">
                ⚠ Shortages — {shortages.length} item{shortages.length !== 1 ? 's' : ''} short of committed orders
              </h2>
              <span className="text-[10px] text-slate-500">on-hand across all warehouses vs undelivered committed order qty</span>
            </div>
            <div className="space-y-2">
              {shortages.map((sh) => (
                <div key={sh.c.component_id} className="rounded-xl bg-slate-950/40 border border-slate-800 px-3 py-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm text-slate-100 font-medium truncate max-w-[420px]">
                      {sh.c.internal_description || sh.c.supplier_model}
                    </span>
                    <span className="text-[11px] tabular-nums text-red-300 font-bold">
                      short {fmtInt(sh.short)}{sh.c.unit ? ` ${sh.c.unit}` : ''}
                    </span>
                    <span className="text-[10px] tabular-nums text-slate-500">
                      have {fmtInt(sh.physical)} · committed {fmtInt(sh.reserved)}
                    </span>
                  </div>
                  {/* Which sales orders the shortage is for */}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {sh.orders.map((o) => (
                      <Link key={`${o.quote_id}-${o.number}`} href={`/sales/${o.quote_id}`}
                        title={`${o.customer || 'No customer'} — needs ${fmtInt(o.qty)}${sh.c.unit ? ` ${sh.c.unit}` : ''}`}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 transition-colors">
                        <span className="font-mono text-[10px] text-violet-300">{o.number}</span>
                        <span className="text-[10px] text-slate-400 truncate max-w-[140px]">{o.customer || '—'}</span>
                        <span className="text-[10px] tabular-nums text-slate-300 font-semibold">{fmtInt(o.qty)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {[
            { label: 'SKUs in stock', v: fmtInt(totals.skus), title: '', cls: 'text-slate-100' },
            // Compact so the tile never wraps; exact rupiah on hover.
            { label: 'Stock value (avg landed)', v: fmtRupiahShort(totals.value), title: fmtRupiah(totals.value), cls: 'text-sky-300' },
            { label: 'Negative on-hand', v: fmtInt(totals.negatives), title: '', cls: totals.negatives > 0 ? 'text-red-400' : 'text-slate-500' },
          ].map(({ label, v, title, cls }) => (
            <div key={label} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1">{label}</p>
              <p className={`text-lg font-bold tabular-nums ${cls}`} title={title || undefined}>{v}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, brand, category…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-sky-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <div className="flex gap-2">
            <select value={filterWh} onChange={(e) => setFilterWh(e.target.value)}
              title="Show one warehouse or all of them"
              className="h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-sky-500/60 outline-none text-slate-300 text-xs">
              <option value="">All warehouses</option>
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select>
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
                      <span className="inline-flex items-center gap-1.5 mt-0.5">
                        <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{warehouseLabel(warehouses, r.loc)}</span>
                        {canManage && r.qty > 0 && warehouses.length > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); setTransfer({ c: r.c, from: r.loc, available: r.qty }); }}
                            title="Move this stock to another warehouse"
                            className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-colors">⇄ move</button>
                        )}
                        {canHub && (
                          <Link href={`/items/${r.c.component_id}`} onClick={(e) => e.stopPropagation()}
                            title="Open the item hub — buy, sell, stock, specs on one page"
                            className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-500 hover:text-white hover:bg-slate-700 transition-colors">item ↗</Link>
                        )}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">{r.c.brand ?? '—'}</span>
                    <span className="text-[11px] text-slate-500 truncate">{r.c.category ? humanize(r.c.category) : '—'}</span>
                    <span className={`text-right tabular-nums font-semibold ${r.qty < 0 ? 'text-red-400' : r.qty === 0 ? 'text-slate-600' : 'text-slate-100'}`}>
                      {fmtInt(r.qty)}{r.c.unit && <span className="text-[10px] text-slate-600 font-normal"> {r.c.unit}</span>}
                    </span>
                    <span className="text-right tabular-nums text-slate-400">{r.avg > 0 ? fmtInt(r.avg) : '—'}</span>
                    <span className="text-right tabular-nums text-slate-200 font-medium" title={r.value !== 0 ? fmtRupiah(r.value) : undefined}>{r.value !== 0 ? fmtRupiahShort(r.value) : '—'}</span>
                    <span className="text-right text-[11px] text-slate-500">
                      {r.last ? (
                        <>
                          <span className={`font-semibold uppercase mr-1 ${r.last.direction === 'in' ? 'text-emerald-400' : r.last.direction === 'out' ? 'text-red-400' : 'text-amber-400'}`}>{r.last.direction}</span>
                          {fmtDay(r.last.moved_at)}
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
                      <span>{r.avg > 0 ? `@ ${fmtInt(r.avg)} · ${fmtRupiah(r.value)}` : '—'}</span>
                      <span>{r.last ? `${r.last.direction} · ${fmtDay(r.last.moved_at)}` : ''}</span>
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
      {toast && <div className="fixed bottom-6 right-6 z-[130] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{toast}</div>}

      {/* Warehouse transfer — one atomic RPC (two ledger legs at the source's
          moving-average cost), so total stock value never changes. */}
      {transfer && (
        <TransferModal
          item={transfer}
          warehouses={warehouses}
          onClose={() => setTransfer(null)}
          onDone={(msg) => { setTransfer(null); setToast(msg); setTimeout(() => setToast(''), 2600); load(); }}
        />
      )}
    </div>
  );
}

function TransferModal({ item, warehouses, onClose, onDone }: {
  item: { c: Comp; from: string; available: number };
  warehouses: Warehouse[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const supabase = createSupabaseClient();
  const options = warehouses.filter((w) => w.code !== item.from);
  const [to, setTo] = useState(options[0]?.code ?? '');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const n = Number(String(qty).replace(/[, ]/g, ''));
    if (!n || n <= 0) { setErr('Enter a quantity greater than zero'); return; }
    if (n > item.available) { setErr(`Only ${fmtInt(item.available)} available in ${warehouseLabel(warehouses, item.from)}`); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('transfer_stock', {
      p_component_id: item.c.component_id, p_from: item.from, p_to: to, p_quantity: n, p_notes: '',
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone(`Moved ${fmtInt(n)} to ${warehouseLabel(warehouses, to)}`);
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-sm bg-canvas border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-bold text-white">Move stock</h3>
          <p className="text-[11px] text-slate-500 truncate">{item.c.internal_description || item.c.supplier_model}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">From</label>
            <p className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 truncate">
              {warehouseLabel(warehouses, item.from)}
            </p>
            <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">{fmtInt(item.available)} available</p>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">To</label>
            <select value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500/60 outline-none text-white cursor-pointer">
              {options.map((w) => <option key={w.code} value={w.code} className="bg-slate-900">{w.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Quantity</label>
          <input value={qty} inputMode="decimal" autoFocus onChange={(e) => setQty(e.target.value)}
            placeholder={`Max ${fmtInt(item.available)}`}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500/60 outline-none text-white text-sm text-right tabular-nums" />
        </div>
        {err && <p className="text-[11px] text-red-400">{err}</p>}
        <p className="text-[10px] text-slate-600">Moves at the source warehouse&apos;s average cost — total inventory value is unchanged.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy || !to}
            className="px-4 py-2 rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 text-xs font-bold transition-colors disabled:opacity-50">
            {busy ? 'Moving…' : 'Move stock'}
          </button>
        </div>
      </div>
    </div>
  );
}
